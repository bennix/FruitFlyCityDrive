import { simulationDuration } from "./simulation-duration.js";
import { SpikeTimeline, spikeGlow } from "./spike-timeline.js";
import { PedestrianBrain } from "./pedestrian-brain.js";
import {crossingCrowds, continuingCrossing, straightCrossing} from './pedestrian-crowd.js';
import {findTrafficExit,canClaimJunction,clearedJunction,downstreamBlocked} from './traffic-routing.js';
import { pedestrianDetour } from "./pedestrian-detour.js";
import { cooperativeTarget as baseCooperativeTarget } from "./cooperative-control.js";
import { PedestrianNetwork, pedestrianObstacles } from "./pedestrian-navigation.js";
import { clearRoadBuildings, roadWidth } from "./road-clearance.js";
import { ObstacleRouter } from "./navigation.js";
import { AgentGrid, directedLanes, lanePoint, pedestrianSlots } from "./population.js";
import signalLayout from "./data/signal-layout.json" with { type: "json" };
import { lightRemaining, lightColor, approachAxis, stopAllowance, junctionStopPosition, crosswalkStopPosition, junctionEntryAllowance, pedestrianMayStart, pedestrianPreparing } from "./traffic-signals.js";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  nodes,
  edges,
  buildings,
  buildingClearance,
  mapMeta,
  metresPerUnit,
  closestNode,
  route,
  junctions,
  redLight,
  motor,
  nearestRoad,
} from "./simulation.js";
import "./style.css";
import {
  BuildingIndex,
  pedestrianConflict,
  crossingNeedsYield,
  crossingGapClear,
  vehicleConflict,
  vehiclePedestrianConflict,
  pedestrianVehicleConflict,
} from "./collision.js";
// Decorative bridge piers must clear every road, including streets below.
const bridgeCandidates=edges.filter(e=>e.type!=="ground"&&e.length>5).map(e=>{
  const a=nodes[e.a],b=nodes[e.b],x=(a.x+b.x)/2,z=(a.z+b.z)/2;
  return {points:[[x-.4,z-.5],[x+.4,z-.5],[x+.4,z+.5],[x-.4,z+.5]],height:(a.y+b.y)/2-.5,x,z};
}).filter(p=>p.height>0);
const bridgeBuildingIndex=new BuildingIndex(buildings);
const bridgeSupports=clearRoadBuildings(bridgeCandidates,nodes,edges).kept.filter(p=>
  !bridgeBuildingIndex.hits({x:p.x,y:0,z:p.z},{x:p.x,y:0,z:p.z},.7));
const singleCarriageways=new Set(edges.filter(e=>e.oneway).map(e=>`${e.a}:${e.b}`));
function cooperativeTarget(a,b,t,turn=0) {
  return baseCooperativeTarget(a,b,t,turn,singleCarriageways.has(`${a.id}:${b.id}`)?0:.7);
}
const vehicleObstacles=[...buildings,...bridgeSupports,...signalLayout.placed.map(({pole,poleTop})=>({
  points:[[pole.x-.12,pole.z-.12],[pole.x+.12,pole.z-.12],
    [pole.x+.12,pole.z+.12],[pole.x-.12,pole.z+.12]],height:poleTop.y,
}))];
const buildingIndex = new BuildingIndex(vehicleObstacles);
const obstacleRouter = new ObstacleRouter(nodes, edges, buildingIndex);
let recoveryAssist=false, detours=0, lastReplan=-Infinity;
const blockedRoads=new Set();
import { Learner, rewardFor } from "./learning.js";
const $ = (id) => document.getElementById(id);
document.querySelector("#app").innerHTML = `
<header><a class="brand" href="/">F<span>↗</span>C <i>FLY / CITY</i></a><div class="title">果蝇城市驾驶实验 <span>OPENSTREETMAP / SHANGHAI</span></div><div class="live"><b></b> LOCAL NEURAL LAB</div></header>
<main><aside class="left"><div class="eyebrow">CONNECTOME × URBAN MOBILITY</div><h1>让一颗果蝇大脑<br>驶入<span>上海。</span></h1><p class="intro">从神经脉冲到城市道路。观察生物神经网络在复杂交通中的运动响应。</p>
<section><div class="section-title"><span>01 / 行程设定</span><button id="random" class="text-btn">随机起终点 ↗</button></div><label>起点 <span class="dot mint"></span><select id="start"></select></label><label>终点 <span class="dot orange"></span><select id="end"></select></label><button id="pick" class="secondary">◎ 在三维地图上选点</button><div id="pickHint" class="hint">点击地图节点依次指定起点、终点</div><div class="route-meta"><span id="distance">—</span><span id="roadType">地面路网</span></div></section>
<section><div class="section-title">02 / 驾驶实验</div><div class="badge">默认协同控制 · 始终开启</div><p id="modeInfo" class="hint">导航规划路线，P9 放电控制速度，DNa 放电参与车道内转向；红绿灯、绕行和碰撞保护同时生效。</p><div class="button-row"><button id="run" class="primary">▶ 启动实验</button><button id="reset" class="secondary" title="重置行程">↺</button></div><label class="range-label">仿真速度 <output id="speedLabel">5×</output><select id="speed" aria-label="仿真倍速"><option value="5">5×</option><option value="10">10×</option><option value="15">15×</option><option value="20">20×</option></select></label><label>仿真时长（秒）<input id="duration" type="number" min="1" step="1" value="1000"></label><p class="hint">按仿真时间计时；到达终点或发生碰撞时会提前结束。</p></section>
<section class="learning-panel"><div class="section-title">03 / 学习与记忆 <span class="badge">Q-LEARNING</span></div><label class="check"><input id="learn" type="checkbox" checked> 边开边学 · 在线更新</label><p class="hint">每次神经反馈后，在线学习刺激强度和转向偏置。进展获得奖励，碰撞与偏离受到惩罚。记忆保存在本机浏览器。</p><div class="learning-stats"><b id="learnCount">0</b><span>次策略更新</span><b id="episodeReward">0.00</b><span>本轮奖励</span></div><canvas id="rewardChart" width="460" height="100"></canvas><div id="policyInfo" class="hint">等待首次神经输出</div><div class="button-row"><button id="train" class="primary">循环训练 · 10 轮</button><button id="clearLearning" class="secondary" title="清除学习记忆">×</button></div><p id="trainingInfo" class="hint">关闭学习可冻结策略，进行对照评估。</p></section><div class="map-note"><b>地图来源</b><p>真实 OSM 路网与单行方向；模拟中剔除侵入道路的建筑，保留 ${buildings.length.toLocaleString()} 栋，剔除 ${buildingClearance.removed.length.toLocaleString()} 栋。高架高度、交通配时与人车行为为模拟。</p></div></aside>
<div class="viewport"><div id="scene"></div><div class="scene-top"><span class="tag">上海 · 黄浦 / 静安</span><span class="tag subtle">3D ROAD NETWORK</span></div><div class="view-controls"><button id="overview" class="active">全景</button><button id="follow">跟随车辆</button><button id="top">俯视</button></div><div class="pov-panel"><div>车载第一视角 <span>CAM 01</span></div><div id="pov"></div><small id="signalHint">本方向信号：—</small><small id="walkingHint">行人：等待仿真启动</small><small>摄像头画面 · 当前输入为结构化信号</small></div><div class="minimap-panel"><div>实时地图 <span>N ↑</span></div><canvas id="minimap" width="400" height="340"></canvas><small>点击地图选起点，再次点击选终点</small></div><div class="scene-bottom"><div><span class="eyebrow">LIVE VEHICLE</span><h2 id="status">等待出发</h2><p id="reason">选择一段旅程，启动全脑驾驶实验</p></div><div class="speedometer"><strong id="velocity">0</strong><span>km/h</span></div></div><div class="legend"><span><i class="mint"></i>实验车辆 / 地图路线</span><span><i class="orange"></i>终点</span><span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL</a></span></div></div>
<aside class="right"><div class="section-title">04 / 神经活动 <span id="brainBadge" class="badge">待连接</span></div><select id="brainSubject" aria-label="神经活动观察对象"><option value="car">实验车 · 真实全脑</option></select><div class="brain-heading"><strong id="neuronCount">138,639</strong><span id="neuronModel">全脑模型神经元</span></div><canvas id="brain" width="560" height="340"></canvas><div id="brainCaption" class="brain-caption">神经元活动 · 等待数据</div><div class="stats"><div><b id="active">—</b><span>活跃神经元</span></div><div><b id="spikes">—</b><span>窗口脉冲数</span></div></div><div class="section-title small">运动输出 <span id="motorUnits">Hz</span></div><div id="bars"></div><div class="section-title small">实际放电时序 <span id="rasterWindow">400 ms 独立窗口</span></div><canvas id="raster" width="560" height="150"></canvas><p id="brainInfo" class="hint">启动后运行 Brian2 全脑仿真。等待期间保留上一窗口输出。</p><div class="section-title small">05 / 本次观测</div><div class="observations"><span>行人 / 其他车辆<b id="population">—</b></span><span>行人行程<b id="pedestrianMoving">—</b></span><span>其他车辆状态<b id="trafficMoving">—</b></span><span>人车更新耗时<b id="populationTiming">—</b></span><span>初始路口分布<b>100 人 · 分散到路口</b></span><span>路口统一控制<b>四灯联动 · 交叉互锁</b></span><span>障碍绕行<b id="detours">0</b></span><span>已行驶<b id="travelled">0 m</b></span><span>等待红灯<b id="waitTime">0 s</b></span><span>守灯 / 观察空隙<b id="pedestrianTypes">—</b></span><span>非信号过街<b id="informalCrossings">0 次</b></span><span>车辆让行<b id="vehicleWait">0 s</b></span><span>行人让行<b id="pedestrianWait">0 s</b></span><span>碰撞 / 越线<b id="incidents">0 / 0</b></span><span>到达 / 已结束<b id="success">0 / 0</b></span></div><button id="export" class="secondary">↓ 导出实验记录</button><details><summary>模型与实验边界</summary><p>实验车：真实连接组 + Brian2 LIF 模型。100 名行人：各自独立的 24 神经元果蝇启发 LIF 简化网络，持续保留膜电位，影响步速和转向；不是完整果蝇连接组，交通规则及碰撞保护由外部导航执行。每次输入重建一个 400 ms 窗口，窗口之间不保留膜电位。外部适配器将期望速度、转向和危险转换为刺激；不是学习过交通规则的自动驾驶系统。导航与神经运动输出协同工作，转向校正受车道范围和碰撞保护约束。点图仅展示最多 160 个实际活跃神经元。无响应时车辆停止。</p></details></aside></main><footer><span>FLY-BRAIN / BRIAN2 · CONNECTOME IN THE LOOP</span><span id="backend">全脑接口待启动</span><span>实验环境 · 非道路驾驶系统</span></footer>`;
for (const id of ["start", "end"])
  for (const n of nodes) {
    const o = document.createElement("option");
    o.value = n.id;
    o.textContent = `${n.name} · ${n.id}${n.y > 0 ? " / 高架" : ""}`;
    $(id).append(o);
  }
const high = edges.filter(
  (e) => e.type === "elevated" && e.name.includes("延安"),
);
const defaultStart = high.length ? high[0].a : closestNode(-80, 80),
  defaultEnd = high.length ? high.at(-1).b : closestNode(120, 0);
$("start").value = defaultStart;
$("end").value = defaultEnd;
const scene = new THREE.Scene();
scene.background = new THREE.Color("#101d25");
scene.fog = new THREE.Fog("#101d25", 1000, 2200);
const camera = new THREE.PerspectiveCamera(43, 1, 0.5, 2500);
camera.position.set(660, 820, 760);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor("#101d25");
$("scene").appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 20);
controls.maxPolarAngle = Math.PI / 2.1;
controls.minDistance = 35;
controls.maxDistance = 1800;
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xc9e9ee, 0x263f44, 2.4));
const sun = new THREE.DirectionalLight(0xffe6c4, 3);
sun.position.set(-180, 400, 200);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {
  left: -500,
  right: 500,
  top: 400,
  bottom: -400,
  far: 1000,
});
sun.shadow.bias = -0.001;
scene.add(sun);
const materials = new Map();
function mat(color) {
  if (!materials.has(color))
    materials.set(
      color,
      new THREE.MeshStandardMaterial({ color, roughness: 0.82 }),
    );
  return materials.get(color);
}
function box(w, h, d, color, x, y, z, parent = scene) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function sphere(r, color, x, y, z, parent = scene) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), mat(color));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function lineBetween(a, b, color, width = 1, yOffset = 0) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(width, width, dir.length(), 6),
    mat(color),
  );
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.position.y += yOffset;
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  scene.add(m);
  return m;
}
box(1200, 2, 1000, "#243b40", 0, -3, 0);
const grid = new THREE.GridHelper(1400, 70, 0x29434b, 0x1c3039);
grid.position.y = -1.5;
scene.add(grid);
let rngSeed = 81;
function rnd() {
  rngSeed = (rngSeed * 1664525 + 1013904223) >>> 0;
  return rngSeed / 4294967296;
}
function tree(x, z) {
  box(0.4, 2, 0.4, "#665e49", x, 1, z);
  sphere(1.8, "#4e806c", x, 3, z);
}
function road(e) {
  const a = nodes[e.a],
    b = nodes[e.b],
    av = new THREE.Vector3(a.x, a.y, a.z),
    bv = new THREE.Vector3(b.x, b.y, b.z),
    len = av.distanceTo(bv);
  if (len < 0.01) return;
  const width = roadWidth(e);
  const m = box(
    width,
    0.25,
    len,
    e.type === "ground" ? "#364a52" : "#718181",
    (a.x + b.x) / 2,
    (a.y + b.y) / 2,
    (a.z + b.z) / 2,
  );
  m.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    bv.clone().sub(av).normalize(),
  );
  if (!e.oneway)
    for (let t = 2; t < len - 1; t += 5) {
      const p = av.clone().lerp(bv, t / len),
        dash = box(0.13, 0.06, 1.8, "#a9b7aa", p.x, p.y + 0.16, p.z);
      dash.quaternion.copy(m.quaternion);
    }
  if (e.type !== "ground") {
    for (const side of [-1, 1]) {
      const offset = new THREE.Vector3(1, 0, 0)
        .applyQuaternion(m.quaternion)
        .multiplyScalar(width / 2);
      lineBetween(
        av.clone().add(offset),
        bv.clone().add(offset),
        "#9aacaa",
        0.12,
        0.5,
      );
    }
  }
}
edges.forEach(road);
for(const p of bridgeSupports)box(.8,p.height,1,"#778a89",p.x,p.height/2,p.z);
for (const building of buildings) {
  const pts = building.points;
  if (pts.length < 4) continue;
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], -pts[0][1]);
  for (const p of pts.slice(1)) shape.lineTo(p[0], -p[1]);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: building.height,
    bevelEnabled: false,
  });
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(
    geo,
    mat(["#738789", "#81928f", "#5d777d", "#9da69e"][Math.floor(rnd() * 4)]),
  );
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
}
// Merge static city surfaces by material to keep the real map responsive.
const grouped = new Map();
for (const m of [...scene.children])
  if (m.isMesh) {
    m.updateMatrixWorld();
    const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
    const key = m.material;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(geo);
    scene.remove(m);
    m.geometry.dispose();
  }
for (const [material, geos] of grouped) {
  const merged = mergeGeometries(
    geos.map((g) => (g.index ? g.toNonIndexed() : g)),
  );
  const m = new THREE.Mesh(merged, material);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  geos.forEach((g) => g.dispose());
}
function label(text, x, z, size = 65) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 80;
  const c = canvas.getContext("2d");
  c.font = "28px sans-serif";
  c.textAlign = "center";
  c.fillStyle = "#d3e3da";
  c.fillText(text, 256, 48);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      depthTest: false,
      transparent: true,
      opacity: 0.85,
    }),
  );
  sprite.position.set(x, 25, z);
  sprite.scale.set(size, 10, 1);
  scene.add(sprite);
}
for (const name of [
  "南京西路",
  "南京东路",
  "延安高架路",
  "淮海中路",
  "西藏中路",
  "成都北路",
]) {
  const e = edges.find((e) => e.name === name);
  if (e) label(name, nodes[e.a].x, nodes[e.a].z);
}
// Place ground crosswalks perpendicular to their actual OSM approach road.
const crossings = junctions.groups
  .map((junction) => {
    const node = { id: junction.id, x: junction.x, z: junction.z, y: 0 };
    const edge = edges.find(
      (e) =>
        e.type === "ground" &&
        (junction.members.includes(e.a) || junction.members.includes(e.b)),
    );
    if (!edge) return null;
    const other = nodes[junction.members.includes(edge.a) ? edge.b : edge.a];
    const length = Math.hypot(other.x - node.x, other.z - node.z);
    const dx = (other.x - node.x) / length,
      dz = (other.z - node.z) / length;
    return {
      node,
      x: node.x + dx * 3,
      z: node.z + dz * 3,
      dx: dz,
      dz: -dx,
      angle: Math.atan2(dx, dz),
    };
  })
  .filter(Boolean);
const pedestrianObstacleIndex=new BuildingIndex(pedestrianObstacles([...buildings,...bridgeSupports],nodes,edges,signalLayout));
const pedestrianNetwork=new PedestrianNetwork(nodes,edges,pedestrianObstacleIndex,junctions);
const pedestrianAnchors=new Map();
const pedestrianSpawnCache=new Map();
const lights = [];
const signalStatics = [];
const darkSignalMaterial = new THREE.MeshBasicMaterial({ color: 0x263735 });
for (const c of crossings) {
  const n = c.node;
  for (let k = -2.8; k <= 2.8; k += 0.7) {
    const stripe = box(
      0.4,
      0.06,
      1.5,
      "#d0d6c7",
      c.x + c.dx * k,
      0.2,
      c.z + c.dz * k,
    );
    stripe.rotation.y = c.angle;
  }
}
// Four one-sided signal heads, suspended over the far side of each approach.
for (const placement of signalLayout.placed) {
  const face = placement;
  const centre = new THREE.Vector3(
    placement.centre.x,
    placement.centre.y,
    placement.centre.z,
  );
  const pole = placement.pole;
  signalStatics.push(
    box(
      0.16,
      placement.top.y,
      0.16,
      "#607575",
      pole.x,
      placement.top.y / 2,
      pole.z,
    ),
  );
  signalStatics.push(
    lineBetween(
      new THREE.Vector3(pole.x, placement.top.y, pole.z),
      new THREE.Vector3(centre.x, placement.top.y, centre.z),
      "#607575",
      0.08,
    ),
  );
  const head = new THREE.Group();
  head.position.copy(centre);
  head.scale.setScalar(placement.scale);
  head.rotation.y = face.heading + Math.PI;
  scene.add(head);
  signalStatics.push(box(0.85, 1.85, 0.38, "#111d22", 0, 0, 0, head));
  signalStatics.push(box(0.92, 0.15, 0.7, "#203035", 0, 1, 0.1, head));
  const bulbs = {};
  for (const [color, y, value] of [
    ["red", 0.57, 0xff4032],
    ["yellow", 0, 0xffc247],
    ["green", -0.57, 0x49ff85],
  ]) {
    const dark = new THREE.Mesh(
      new THREE.CircleGeometry(0.23, 16),
      darkSignalMaterial,
    );
    dark.position.set(0, y, 0.2);
    head.add(dark);
    signalStatics.push(dark);
    const bulb = new THREE.Mesh(
      new THREE.CircleGeometry(0.22, 16),
      new THREE.MeshBasicMaterial({ color: value, toneMapped: false }),
    );
    bulb.position.set(0, y, 0.21);
    head.add(bulb);
    bulbs[color] = bulb;
  }
  lights.push({ ...face, bulbs });
}
// Batch fixture structures and bulb colors: thousands of heads use only a few draw calls.
const signalBatches = new Map();
scene.updateMatrixWorld(true);
for (const mesh of signalStatics) {
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  if (!signalBatches.has(mesh.material)) signalBatches.set(mesh.material, []);
  signalBatches
    .get(mesh.material)
    .push(geometry.index ? geometry.toNonIndexed() : geometry);
  mesh.removeFromParent();
  mesh.geometry.dispose();
}
for (const [material, geometries] of signalBatches) {
  const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
  mesh.castShadow = true;
  scene.add(mesh);
  geometries.forEach((g) => g.dispose());
}
const lampInstances = {};
for (const [key, color] of [
  ["red", 0xff4032],
  ["yellow", 0xffc247],
  ["green", 0x49ff85],
]) {
  const batch = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.22, 16),
    new THREE.MeshBasicMaterial({ color, toneMapped: false }),
    lights.length,
  );
  batch.frustumCulled = false;
  scene.add(batch);
  lampInstances[key] = batch;
  lights.forEach((light) => {
    light.matrices ??= {};
    light.matrices[key] = light.bulbs[key].matrixWorld.clone();
    light.bulbs[key].removeFromParent();
    light.bulbs[key].geometry.dispose();
    light.bulbs[key].material.dispose();
  });
}
const hiddenLamp = new THREE.Matrix4().makeScale(0, 0, 0);
function updateSignalHint() {
  const a = nodes[path[segment]],
    b = nodes[path[segment + 1]],
    g = b && junctions.byNode.get(b.id);
  let label = "无信控路段",
    color = "#8daa9f";
  if (
    a &&
    b &&
    a.y === 0 &&
    b.y === 0 &&
    g &&
    junctions.byNode.get(a.id) !== g
  ) {
    const state = lightColor(
      g.id,
      approachAxis(g.angle, Math.atan2(b.x - a.x, b.z - a.z)),
      simTime,
    );
    label = {
      red: "红灯 · 停车等候",
      yellow: "黄灯 · 准备停车",
      green: "绿灯 · 确认安全后通行",
    }[state];
    label += ` · ${Math.ceil(lightRemaining(g.id, approachAxis(g.angle, Math.atan2(b.x-a.x,b.z-a.z)), simTime))} 仿真秒后变灯`;
    color = { red: "#ff7269", yellow: "#ffd17b", green: "#83edbd" }[state];
  }
  if(label === "无信控路段") {
    const ahead=junctions.groups.filter(j=> {
      const dx=j.x-car.position.x,dz=j.z-car.position.z;
      return Math.hypot(dx,dz)<30 && dx*Math.sin(heading)+dz*Math.cos(heading)>0;
    }).sort((a,b)=>Math.hypot(a.x-car.position.x,a.z-car.position.z)-Math.hypot(b.x-car.position.x,b.z-car.position.z))[0];
    if(ahead) {
      const axis=approachAxis(ahead.angle,heading),state=lightColor(ahead.id,axis,simTime);
      label+=` · 附近前方灯：${{red:"红",yellow:"黄",green:"绿"}[state]} · ${Math.ceil(lightRemaining(ahead.id,axis,simTime))} 仿真秒后变灯`;
    }
  }
  $("signalHint").textContent = "本方向：" + label + (running ? "" : " · 仿真暂停，灯控暂停");
  $("signalHint").style.color = color;
}
function updateTrafficLights() {
  lights.forEach((light, i) => {
    const color = lightColor(light.controller, light.axis, simTime);
    if (light.color === color) return;
    light.color = color;
    for (const key of ["red", "yellow", "green"]) {
      lampInstances[key].setMatrixAt(
        i,
        key === color ? light.matrices[key] : hiddenLamp,
      );
      lampInstances[key].instanceMatrix.needsUpdate = true;
    }
  });
}

function makeCar(color) {
  const g = new THREE.Group();
  box(3.8, 1.7, 7, color, 0, 1.4, 0, g);
  box(3.2, 1.3, 3.8, "#c0dadd", 0, 2.85, -0.3, g);
  box(3.35, 0.35, 2.5, color, 0, 3.6, -0.3, g);
  for (const x of [-1.9, 1.9])
    for (const z of [-2.1, 2.1]) box(0.7, 1.35, 1.5, "#162228", x, 0.9, z, g);
  for (const x of [-1.2, 1.2]) box(0.8, 0.5, 0.12, "#f4e4ab", x, 1.6, 3.55, g);
  g.scale.setScalar(0.3);
  scene.add(g);
  return g;
}
const car = makeCar("#80f3bb");
car.rotation.order="YXZ";
const povCamera = new THREE.PerspectiveCamera(74, 16 / 9, 0.08, 1400);
const povRenderer = new THREE.WebGLRenderer({ antialias: true });
povRenderer.setSize(256, 144);
povRenderer.setPixelRatio(1);
$("pov").appendChild(povRenderer.domElement);
const mapBounds = {
  minX: Math.min(...nodes.map((n) => n.x)) - 20,
  maxX: Math.max(...nodes.map((n) => n.x)) + 20,
  minZ: Math.min(...nodes.map((n) => n.z)) - 20,
  maxZ: Math.max(...nodes.map((n) => n.z)) + 20,
};
function mapPoint(n) {
  return [
    ((n.x - mapBounds.minX) / (mapBounds.maxX - mapBounds.minX)) * 400,
    ((n.z - mapBounds.minZ) / (mapBounds.maxZ - mapBounds.minZ)) * 340,
  ];
}
function drawMap() {
  const c = $("minimap").getContext("2d");
  c.fillStyle = "#17292e";
  c.fillRect(0, 0, 400, 340);
  c.lineWidth = 1.2;
  c.strokeStyle = "#56716f";
  c.beginPath();
  for (const e of edges) {
    const a = mapPoint(nodes[e.a]),
      b = mapPoint(nodes[e.b]);
    c.moveTo(...a);
    c.lineTo(...b);
  }
  c.stroke();
  c.strokeStyle = "#acffd0";
  c.lineWidth = 2.6;
  c.beginPath();
  path.forEach((id, i) => {
    const p = mapPoint(nodes[id]);
    i ? c.lineTo(...p) : c.moveTo(...p);
  });
  c.stroke();
  for (const [p, color] of [
    [nodes[path[0]], "#aeffd0"],
    [nodes[path.at(-1)], "#f4a77e"],
    [car.position, "#ffffff"],
  ]) {
    if (!p) continue;
    const xy = mapPoint(p);
    c.fillStyle = color;
    c.beginPath();
    c.arc(...xy, p === car.position ? 4 : 5, 0, 7);
    c.fill();
  }
  const [x, y] = mapPoint(car.position);
  c.strokeStyle = "#fff";
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x + Math.sin(heading) * 12, y + Math.cos(heading) * 12);
  c.stroke();
}
const arrow = new THREE.ArrowHelper(
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 9, -3),
  10,
  0xb0ffda,
  4,
  3,
);
car.add(arrow);
// One GPU instance per actual agent, sharing geometry instead of 100,000 meshes.
function instancePopulation(template, count) {
  template.updateMatrixWorld(true);
  const geometries = [], materials = [];
  template.traverse((part) => {
    if (!part.isMesh) return;
    const geometry = part.geometry.clone().applyMatrix4(part.matrixWorld);
    geometry.clearGroups();
    geometries.push(geometry); materials.push(part.material);
  });
  const geometry = mergeGeometries(geometries, true);
  geometries.forEach((g) => g.dispose());
  scene.remove(template);
  const mesh = new THREE.InstancedMesh(geometry, materials, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
  const orientation = new THREE.Euler(0,0,0,"YXZ"), scale = new THREE.Vector3(1, 1, 1);
  return (agents) => {
    agents.forEach((agent, i) => {
      rotation.setFromEuler(orientation.set(agent.mesh.rotation.x||0,agent.mesh.rotation.y,0,"YXZ"));
      matrix.compose(agent.mesh.position, rotation, scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
}
const pedestrianTemplate = new THREE.Group();
box(1, 2, 1, "#ecb27c", 0, 2, 0, pedestrianTemplate);
sphere(.65, "#e3bda3", 0, 3.5, 0, pedestrianTemplate);
for (const x of [-.3,.3]) box(.35,1,.5,"#243841",x,.6,0,pedestrianTemplate);
pedestrianTemplate.scale.setScalar(.3);
const renderTraffic = instancePopulation(makeCar("#8facc7"), 1000);
const renderWalkers = instancePopulation(pedestrianTemplate, 100);
const trafficGrid = new AgentGrid(), walkerGrid = new AgentGrid();
const junctionOwners=new Map();
let walkerTick=0;
const { lanes, outgoing } = directedLanes(nodes, edges);
for (const lane of lanes) {
  lane.buildingClear = !buildingIndex.hits(lanePoint(nodes,lane,0),lanePoint(nodes,lane,1));
  const controller=junctions.byNode.get(lane.to);
  lane.controlled=!!controller && junctions.byNode.get(lane.from)!==controller;
  lane.stopAt=junctionStopPosition(nodes[lane.from],nodes[lane.to],crossings.find(c=>c.node.id===controller?.id),controller,nodes);
}
const crossingGrid = new AgentGrid();
const vehicleData = (v) => ({...v.mesh.position, heading:v.mesh.rotation.y, speed:v.movingSpeed || 0});
const agentMesh = () => ({position:new THREE.Vector3(), rotation:{y:0}});
const spawnSlots = [];
for (const lane of lanes) {
  for (let d=junctions.byNode.has(lane.from)?5.5:3; d<lane.length-3; d+=2.7) {
    if(lane.controlled && d>lane.stopAt)continue;
    const t=d/lane.length, position=lanePoint(nodes,lane,t);
    if (buildingIndex.hits(position,position) || vehicleConflict(position,position,lane.angle,lane.angle,
      trafficGrid.near(position,3).map(vehicleData))) continue;
    const slot={lane,t,mesh:agentMesh()};
    slot.mesh.position.copy(position); slot.mesh.rotation.y=lane.angle;
    spawnSlots.push(slot); trafficGrid.add(slot);
  }
}
if (spawnSlots.length < 1000) throw new Error("道路安全容量不足 1,000 辆");
trafficGrid.clear();
const traffic = Array.from({length:1000},(_,i)=> {
  const spawn=spawnSlots[Math.floor(i*spawnSlots.length/1000)];
  const mesh=agentMesh(); mesh.position.copy(spawn.mesh.position); mesh.rotation.y=spawn.lane.angle;mesh.rotation.x=spawn.lane.pitch;
  return {lane:spawn.lane,t:spawn.t,mesh,initialLane:spawn.lane,initialT:spawn.t,speed:2+rnd()*1.5,movingSpeed:0};
});
const walkers = pedestrianSlots(crossings.filter((_,i)=>i%Math.max(1,Math.floor(crossings.length/100))===0).slice(0,100),100).map((slot,i)=>({
  ...slot,homeCrossing:slot.crossing,mesh:agentMesh(),phase:slot.side,target:slot.side,
  obeysSignal:i%10!==0,crossingActive:false,nextAttempt:3+(slot.slot%10)*.25,
}));
const markers = new THREE.Group();
scene.add(markers);
const pickTargets = [];
for (const n of nodes) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(1.8, 8, 6),
    new THREE.MeshBasicMaterial({
      color: 0x87e8c1,
      transparent: true,
      opacity: 0.1,
    }),
  );
  m.position.set(n.x, n.y + 2, n.z);
  m.userData.id = n.id;
  scene.add(m);
  pickTargets.push(m);
}
let savedLearning = {};
try {
  savedLearning = JSON.parse(
    localStorage.getItem("fly-city-learning-v1") || "{}",
  );
} catch {}
const learners = {
  cooperative: new Learner(savedLearning.cooperative ?? savedLearning.assist),
  assist: new Learner(savedLearning.assist),
  neural: new Learner(savedLearning.neural),
};
let pendingLearning = null,
  episodeReward = 0,
  trainingLeft = 0;
let path = [],
  running = false,
  started = false,
  simTime = 0,
  segment = 0,
  progress = 0,
  velocity = 0,
  travelled = 0,
  waitTime = 0,
  collisions = 0,
  buildingStops = 0,
  pedestrianWait = 0,
  informalCrossings = 0,
  vehicleWait = 0,
  departures = 0,
  completed = 0,
  arrived = 0,
  heading = 0,
  view = "overview",
  pickStep = 0,
  brain = null,
  brainBusy = false,
  nextBrain = 0,
  epoch = 0,
  record = [],
  lastStim = null,
  neuralAt = 0;
let spikeTimeline=new SpikeTimeline(),timelineTime=0;
let brainReplayAt=0;
let brainReceivedAt=0, brainRequestedAt=0, brainWindow=0, brainDisplayAt=0;
function learningUI() {
  const l = learners["cooperative"];
  $("learnCount").textContent = l.updates;
  $("episodeReward").textContent = episodeReward.toFixed(2);
  const c = $("rewardChart").getContext("2d");
  c.clearRect(0, 0, 460, 100);
  c.strokeStyle = "#355052";
  c.beginPath();
  c.moveTo(0, 50);
  c.lineTo(460, 50);
  c.stroke();
  const history = l.episodes.slice(-40);
  c.strokeStyle = "#a3f0c7";
  c.beginPath();
  history.forEach((e, i) => {
    const x = 8 + (i * 444) / Math.max(1, history.length - 1),
      y = 50 - Math.max(-40, Math.min(40, e.reward)) * 1.1;
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  });
  c.stroke();
  c.fillStyle = "#8ca8a2";
  c.font = "14px monospace";
  c.fillText("EPISODE REWARD / " + history.length, 8, 95);
}
function saveLearning() {
  try {
    localStorage.setItem(
      "fly-city-learning-v1",
      JSON.stringify({
        cooperative: learners.cooperative.snapshot(),
        assist: learners.assist.snapshot(),
        neural: learners.neural.snapshot(),
      }),
    );
  } catch {
    $("trainingInfo").textContent = "浏览器无法保存记忆，请导出实验记录。";
  }
  learningUI();
}
function rewardTransition(nextState, terminal = false, success = false) {
  if (!pendingLearning) return;
  const p = pendingLearning;
  const reward = rewardFor({
    progress: (travelled - p.distance) * metresPerUnit,
    lateral: nearestRoad(car.position),
    collision: collisions > 0,
    blocked: buildingStops > 0,
    departure: departures > 0,
    arrived: success,
  });
  episodeReward += reward;
  if (p.train && $("learn").checked)
    learners[p.mode].update(p.state, p.action, reward, nextState, terminal);
  record.push({
    event: "learning",
    reward,
    state: p.state,
    action: p.action,
    trained: p.train,
  });
  if (!terminal) pendingLearning = { ...p, distance: travelled };
  else pendingLearning = null;
  saveLearning();
}
function setup() {
  rngSeed = 81;
  recoveryAssist=false; detours=0; lastReplan=-Infinity; blockedRoads.clear();
  pendingLearning = null;
  episodeReward = 0;
  learningUI();
  running = false;
  started = false;
  epoch++;
  segment = 0;
  progress = 0;
  velocity = 0;
  travelled = 0;
  waitTime = 0;
  collisions = 0;
  buildingStops = 0;
  pedestrianWait = 0;
  informalCrossings = 0;
  vehicleWait = 0;
  departures = 0;
  record = [];
  brain = null;
  brainReceivedAt=0;brainWindow=0;spikeTimeline=new SpikeTimeline();timelineTime=0;
  $("active").textContent = "—";
  $("spikes").textContent = "—";
  $("bars").innerHTML = "";
  $("raster").getContext("2d").clearRect(0, 0, 560, 150);
  $("brainBadge").textContent = "待连接";
  drawNeurons();
  nextBrain = 0;
  simTime = 0;
  updateTrafficLights();
  const originalRoute=route(+$("start").value,+$("end").value);
  const safePlan=obstacleRouter.route(+$("start").value,+$("end").value);
  path=safePlan?.path || [+$("start").value];
  if (safePlan && path.join(",")!==originalRoute.join(",")) detours++;
  $("detours").textContent=detours;
  const spawnA=nodes[path[0]],spawnB=nodes[path[1]??path[0]];
  const egoSpawn=cooperativeTarget(spawnA,spawnB,0);
  car.position.set(egoSpawn.x,egoSpawn.y,egoSpawn.z);car.rotation.y=heading=egoSpawn.heading;car.rotation.x=egoSpawn.pitch;
  trafficGrid.clear(); walkerGrid.clear(); junctionOwners.clear(); walkerTick=0;
  traffic.forEach((v) => {
    v.lane=v.initialLane; v.t=v.initialT; v.movingSpeed=0; v.nextLanes=[]; v.junctionLock=null; v.blockedFor=0; v.retryRouteAt=0;v.retryGreenAt=0;v.exitMemory=new Map();v.recoveryReroutes=0;
    v.mesh.position.copy(lanePoint(nodes,v.lane,v.t));
    v.mesh.rotation.y=v.lane.angle;v.mesh.rotation.x=v.lane.pitch; trafficGrid.add(v);
  });
  walkers.forEach((w,i) => {
    w.flyBrain=new PedestrianBrain(i+1);
    w.crossing=w.homeCrossing;
    w.crossingActive=false; w.phase=w.target=w.side;
    w.nextAttempt=3+(w.slot%10)*.25; w.walkSteps=null; w.walkIndex=0; w.trips=0; w.walking=false;
    w.crossingStart=null; w.crossingPermit=null; w.crossingPace=null; w.walkSpeed=.4375+(i%7)*.03125; w.walkUpdated=0; w.detour=null; w.stuckTime=0; w.retryDetour=0;w.progressKey=null;w.bestTargetDistance=Infinity;
    const c=w.crossing;
    let placed=false;
    if(!pedestrianSpawnCache.has(c.node.id))
      pedestrianSpawnCache.set(c.node.id,pedestrianNetwork.spawnCandidates(c));
    for(const candidate of pedestrianSpawnCache.get(c.node.id)) {
      const point=candidate.point;
      if(pedestrianConflict(point,point,[car.position],1.6) || walkerGrid.near(point,.55).length ||
        pedestrianConflict(point,point,trafficGrid.near(point,3).map(v=>v.mesh.position)))continue;
      const start=i%2?candidate.from:candidate.to;
      const plan=pedestrianNetwork.plan(start,rnd);
      if(!plan)continue;
      w.mesh.position.copy(point);walkerGrid.add(w);placed=true;
      w.walkSteps=[{point:pedestrianNetwork.points[start],crossing:null},...plan.steps];
      w.walkIndex=0;w.destination=plan.destination;w.nextAttempt=0;
      break;
    }
    if(!placed)throw new Error("路口行人安全出生空间不足："+c.node.id);
  });
  trafficStep(0);
  while (markers.children.length) {
    const m = markers.children[0];
    markers.remove(m);
    m.geometry.dispose();
  }
  for (const [id, color] of [
    [path[0], "#9affce"],
    [+$("end").value, "#ff9d70"],
  ]) {
    const n = nodes[id];
    const m = new THREE.Mesh(
      new THREE.TorusGeometry(3, 0.4, 8, 30),
      mat(color),
    );
    m.rotation.x = Math.PI / 2;
    m.position.set(n.x, n.y + 2, n.z);
    markers.add(m);
    box(0.3, 9, 0.3, color, n.x, n.y + 5, n.z, markers);
    sphere(1.5, color, n.x, n.y + 10, n.z, markers);
  }
  const a = nodes[path[0]],
    b = nodes[path[1] ?? path[0]];
  heading = Math.atan2(b.x - a.x, b.z - a.z);
  car.position.set(
    a.x + Math.cos(heading) * 0.7,
    a.y + 0.3,
    a.z - Math.sin(heading) * 0.7,
  );
  car.rotation.y = heading;
  for (const v of trafficGrid.near(car.position,4)) {
    if (!vehicleConflict(car.position,car.position,heading,heading,[vehicleData(v)])) continue;
    const free=spawnSlots.find(slot=>slot.mesh.position.distanceTo(car.position)>5 &&
      !vehiclePedestrianConflict(slot.mesh.position,slot.mesh.position,slot.lane.angle,slot.lane.angle,
        walkerGrid.near(slot.mesh.position,3).map(w=>w.mesh.position)) &&
      !vehicleConflict(slot.mesh.position,slot.mesh.position,slot.lane.angle,slot.lane.angle,
        trafficGrid.near(slot.mesh.position,3).filter(o=>o!==v).map(vehicleData)));
    if (free) {
      v.lane=free.lane; v.t=free.t;
      v.mesh.position.copy(lanePoint(nodes,free.lane,free.t)); v.mesh.rotation.y=free.lane.angle;v.mesh.rotation.x=free.lane.pitch;
      trafficGrid.add(v);
    }
  }
  renderTraffic(traffic);
  const distance = path
    .slice(1)
    .reduce(
      (s, id, i) =>
        s +
        Math.hypot(
          nodes[id].x - nodes[path[i]].x,
          nodes[id].z - nodes[path[i]].z,
        ),
      0,
    );
  $("distance").textContent =
    `${Math.round(distance * metresPerUnit)} m / ${path.length - 1} 路段`;
  $("roadType").textContent = path.some((id) => nodes[id].y > 0)
    ? "含延安高架"
    : "地面路网";
  $("run").textContent = "▶ 启动实验";
  $("status").textContent = !safePlan ? "没有安全绕行路线" : path.length < 2 ? "起终点相同" : "等待出发";
  $("reason").textContent =
    !safePlan ? "路网中没有保持建筑净距的合法路径，请换一个起终点" : path.length < 2 ? "请指定不同的起点和终点" : detours ? "已绕开建筑物影响的路段，地图显示安全路线" : "规划路线已更新";
  $("run").disabled = path.length < 2;
  $("train").disabled = path.length < 2;
  updateStats();
}
function updateStats() {
  $("vehicleWait").textContent = `${Math.round(vehicleWait)} s`;
  $("pedestrianTypes").textContent =
    `${walkers.filter((w) => w.obeysSignal).length} / ${walkers.filter((w) => !w.obeysSignal).length}`;
  $("informalCrossings").textContent = `${informalCrossings} 次`;
  $("pedestrianWait").textContent = `${Math.round(pedestrianWait)} s`;
  $("velocity").textContent = Math.round(velocity * 3.6 * metresPerUnit);
  $("travelled").textContent = `${Math.round(travelled * metresPerUnit)} m`;
  $("waitTime").textContent = `${Math.round(waitTime)} s`;
  $("incidents").textContent = `${collisions} / ${departures}`;
  $("success").textContent = `${arrived} / ${completed}`;
}
function finish(success, reason) {
  running = false;
  completed++;
  if (success) arrived++;
  velocity = 0;
  $("status").textContent = success ? "抵达终点" : "实验结束";
  $("reason").textContent = reason;
  $("run").textContent = "↺ 再次实验";
  record.push({ event: success ? "arrived" : "failed", simTime, reason });
  rewardTransition("terminal", true, success);
  if ($("learn").checked)
    learners["cooperative"].episode(episodeReward, success);
  saveLearning();
  updateStats();
  if (trainingLeft > 0) {
    trainingLeft--;
    $("trainingInfo").textContent = `循环训练剩余 ${trainingLeft} 轮`;
    if (trainingLeft > 0)
      setTimeout(() => {
        if (trainingLeft > 0) {
          setup();
          running = true;
          started = true;
          $("run").textContent = "Ⅱ 暂停实验";
        }
      }, 1000);
    else $("train").textContent = "循环训练 · 10 轮";
  }
}
async function requestBrain(stim) {
  if (brainBusy) return;
  brainBusy = true;
  brainRequestedAt=performance.now();
  const version = epoch;
  const mode = "cooperative",
    l = learners[mode],
    state = l.state(stim);
  rewardTransition(state);
  const choice = l.choose(state, $("learn").checked);
  const encoded = {
    ...stim,
    speed: stim.speed * choice.speed,
    turn: Math.max(-1, Math.min(1, stim.turn + choice.bias)),
  };
  $("policyInfo").textContent =
    `${choice.name} · 探索率 ${Math.round(choice.epsilon * 100)}% · ${Object.keys(l.q).length} 个状态`;
  $("brainBadge").textContent = "计算中";
  $("backend").textContent = "Brian2 正在运行 400 ms 全脑窗口";
  try {
    const res = await fetch("/api/brain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(encoded),
    });
    const data = await res.json();
    if (res.status === 429) {
      $("brainBadge").textContent = "排队中";
      $("backend").textContent = "全脑正在处理上一请求，稍后重试";
      return;
    }
    if (!res.ok) throw Error(data.error);
    if (version !== epoch || !running) return;
    brain = data;
    brainReceivedAt=performance.now();brainWindow++;brainReplayAt=timelineTime;
    spikeTimeline.append(data,timelineTime);
    lastStim = encoded;
    neuralAt = simTime;
    pendingLearning = {
      mode,
      state,
      action: choice.action,
      distance: travelled,
      train: $("learn").checked,
    };
    record.push({ event: "brain", simTime, ...data });
    $("brainBadge").textContent = "真实放电";
    $("active").textContent = data.active_neurons.toLocaleString();
    $("spikes").textContent = data.total_spikes.toLocaleString();
    $("brainInfo").textContent =
      `400 ms 独立窗口 · 计算 ${data.wall_time_sec} s · 显示 ${data.raster.length} 个活跃神经元`;
    $("backend").textContent = `全脑已连接 / ${data.wall_time_sec} s 每窗口`;
    drawNeurons();
  } catch (e) {
    if (version === epoch) {
      brain = null;
      $("brainBadge").textContent = "接口错误";
      $("backend").textContent = e.message;
      $("brainInfo").textContent =
        "全脑接口不可用，车辆停止。请启动 city_server.py。";
    }
  } finally {
    brainBusy = false;
    nextBrain = performance.now() + 100;
  }
}
function drawNeurons() {
  const subject=$("brainSubject").value;
  const selected=subject==="car"?null:walkers[Number(subject)]?.flyBrain;
  const display=selected?selected.snapshot():brain;
  const activityTime=selected?Math.min(.4,selected.time):Math.max(0,timelineTime-brainReplayAt);
  $("brainCaption").textContent=selected
    ?"24 个简化神经元 · 按当前脉冲亮起与衰减 · 布局和连线为示意"
    :`真实放电窗口回放 · 显示 ${display?.raster.length??0}/138,639 个神经元（最多 160 个） · ${display?(activityTime<=.4?`${Math.round(activityTime*1000)} / 400 ms`:"回放结束，等待新窗口"):"等待数据"} · 布局和连线为示意`;
  $("neuronCount").textContent=selected?"24":"138,639";
  $("neuronModel").textContent=selected?"果蝇启发 LIF · 简化模型":"真实连接组 · Brian2";
  $("rasterWindow").textContent=selected?"滚动 400 ms":"横向滚动 20 s · 接收时间";
  $("active").textContent=display?.active_neurons.toLocaleString()??"—";
  $("spikes").textContent=display?.total_spikes.toLocaleString()??"—";
  $("brainBadge").textContent=selected?(running?"实时简化脑":"已暂停"):(brainBusy?"计算中":display?"真实放电":"待连接");
  $("brainInfo").textContent=selected
    ?`行人 ${Number(subject)+1} · 独立神经状态 · 仿真 ${selected.time.toFixed(1)} s · ${running?"实时滚动":"已暂停"} · 脑输出步速 ${(selected.drive*100).toFixed(0)}%`
    :`非实时全脑 · 空白处无计算数据 · 第 ${brainWindow} 个窗口 · ${brainReceivedAt?`数据距今 ${((performance.now()-brainReceivedAt)/1000).toFixed(1)} 秒`:"等待首个结果"} · ${brainBusy?`正在计算 ${((performance.now()-brainRequestedAt)/1000).toFixed(1)} 秒`:running?"等待下一窗口":"已暂停"}`;
  $("raster").getContext("2d").clearRect(0,0,560,150);
  if(!display)$("bars").innerHTML="";
  const c = $("brain").getContext("2d"),
    w = 560,
    h = 340;
  c.clearRect(0, 0, w, h);
  c.strokeStyle = "#32484d";
  for (const side of [-1, 1]) {
    c.beginPath();
    c.ellipse(280 + side * 102, 155, 114, 125, side * 0.35, 0, Math.PI * 2);
    c.stroke();
  }
  c.fillStyle = "#5b777c";
  c.font = "18px monospace";
  c.fillText("L", 32, 28);
  c.fillText("R", 515, 28);
  if (!display) return;
  const points = display.raster.map((n, i) => {
    const seed = Number(BigInt(n.id) % 100000n);
    const angle = seed * 0.618;
    const radius = 20 + (seed % 85);
    return {
      x: 280 + (seed % 2 ? 1 : -1) * (60 + Math.abs(Math.cos(angle)) * radius),
      y: 160 + Math.sin(angle) * radius,
      n,
    };
  });
  c.strokeStyle = "#5a9a852b";
  for (let i = 1; i < points.length; i++) {
    const p = points[i],
      q = points[i - 1];
    c.beginPath();
    c.moveTo(p.x, p.y);
    c.lineTo(q.x, q.y);
    c.stroke();
  }
  for (const p of points) {
    const glow=spikeGlow(p.n.times,activityTime);
    c.fillStyle = `rgba(151,255,202,${.12+.88*glow})`;
    c.shadowColor="#97ffca";c.shadowBlur=12*glow;
    c.beginPath();
    c.arc(p.x, p.y, 2 + 4*glow, 0, 7);
    c.fill();
  }
  c.shadowBlur=0;
  const r = $("raster").getContext("2d");
  r.clearRect(0, 0, 560, 150);
  const end=selected?selected.time:timelineTime,span=selected?.4:spikeTimeline.span;
  r.font="11px monospace";
  for(let tick=Math.ceil((end-span)/(span/4))*(span/4);tick<=end;tick+=span/4) {
    const x=(tick-end+span)/span*560;
    r.strokeStyle="#304449";r.beginPath();r.moveTo(x,0);r.lineTo(x,132);r.stroke();
    r.fillStyle="#8daa9f";r.fillText(`${tick.toFixed(1)}s`,Math.min(518,Math.max(0,x+3)),147);
  }
  r.fillStyle="#94edc1";
  if(selected)display.raster.forEach((n,i)=>n.times.forEach(t=>
    r.fillRect(((Math.max(0,selected.time-.4)+t-end+span)/span)*560,i/24*130,1.4,1.8)));
  else {
    // Shade received 400 ms windows; blank areas have no computed data.
    r.fillStyle="#94edc112";
    for(const window of spikeTimeline.windows)r.fillRect((window.end-.4-end+span)/span*560,0,.4/span*560,132);
    r.fillStyle="#94edc1";
    for(const point of spikeTimeline.points(end))r.fillRect(point.x*560,point.row/Math.max(1,spikeTimeline.rows.size)*130,1.4,1.8);
  }
  $("motorUnits").textContent=selected?"%":"Hz";
  if(selected) {
    const outputs=[["步行驱动",selected.drive*100],["左转倾向",Math.max(0,-selected.turn)*100],["右转倾向",Math.max(0,selected.turn)*100]];
    $("bars").innerHTML=outputs.map(([name,value])=>`<div class="bar"><span>${name}</span><i><em style="width:${value}%"></em></i><b>${value.toFixed(0)}</b></div>`).join("");
    return;
  }
  const names = [
    "P9_oDN1_left",
    "P9_oDN1_right",
    "DNa01_left",
    "DNa01_right",
    "DNa02_left",
    "DNa02_right",
  ];
  $("bars").innerHTML = names
    .map((n) => {
      const v = display.output_neuron_activity[n]?.rate_hz || 0;
      return `<div class="bar"><span>${n.replace("_oDN1", "")}</span><i><em style="width:${Math.min(100, v)}%"></em></i><b>${v.toFixed(1)}</b></div>`;
    })
    .join("");
}
function trafficStep(dt) {
  const tickStarted=performance.now();
  const ego={...car.position,heading:car.rotation.y,speed:velocity};
  crossingGrid.clear();
  const occupiedStrips=new Set();
  for (const w of walkers) {
    const c=w.walkSteps?w.walkSteps[w.walkIndex]?.crossing:w.crossing;
    if(!c || Math.hypot(w.mesh.position.x-c.x,w.mesh.position.z-c.z)>10)continue;
    if (!w.crossingActive && !pedestrianPreparing(c.node.id,simTime)) continue;
    const key=`${c.node.id}:${c.x}:${c.z}`;
    if (occupiedStrips.has(key)) continue;
    occupiedStrips.add(key);
    crossingGrid.add({mesh:{position:{x:c.x,y:0,z:c.z}},crossing:c});
  }
  for (const v of traffic) {
    if (!dt) continue;
    if(v.junctionLock!==null && clearedJunction(junctions.byNode.get(v.junctionLock),nodes,v.mesh.position,v.mesh.rotation.y)) {
      if(junctionOwners.get(v.junctionLock)===v)junctionOwners.delete(v.junctionLock);
      v.junctionLock=null;
    }
    const {lane}=v, a=nodes[lane.from], b=nodes[lane.to];
    const nearCars=trafficGrid.near(v.mesh.position,6).filter(o=>o!==v).map(vehicleData);
    if (car.position.distanceTo(v.mesh.position)<8) nearCars.push(ego);
    const nearPeople=walkerGrid.near(v.mesh.position,4);
    // Yield to actual/predicted people in this lane, not to a whole crossing
    // whose last pedestrian may already be waiting safely on the sidewalk.
    const lookAhead=lanePoint(nodes,lane,Math.min(1,v.t+3/lane.length));
    const yieldPeople=walkerGrid.near(v.mesh.position,5).some(w=> {
      const p=w.mesh.position;
      const predicted=w.walking?{x:p.x+Math.sin(w.mesh.rotation.y)*(w.crossingPace||w.walkSpeed)*.6,y:p.y,z:p.z+Math.cos(w.mesh.rotation.y)*(w.crossingPace||w.walkSpeed)*.6}:p;
      return vehiclePedestrianConflict(v.mesh.position,lookAhead,lane.angle,lane.angle,[p,predicted]);
    });
    if(!v.nextLanes?.length) {
      v.nextLanes=[];
      let previous=lane, distance=0;
      for(let i=0;i<12&&distance<12;i++) {
        const choices=outgoing[previous.to].filter(l=>l.buildingClear&&l.to!==previous.from);
        const options=choices.length?choices:outgoing[previous.to].filter(l=>l.buildingClear);
        if(!options.length)break;
        const next=options[Math.floor(rnd()*options.length)];
        v.nextLanes.push(next);distance+=next.length;previous=next;
      }
    }
    const exitBlocked=(next,distance)=>{
      const owner=junctionOwners.get(junctions.byNode.get(next.to)?.id);
      return downstreamBlocked(next,distance,redLight(nodes[next.from],nodes[next.to],simTime),!!owner&&owner!==v);
    };
    const findExit=()=>findTrafficExit(lane,outgoing,(previous,next,distance)=> {
        if(exitBlocked(next,distance))return false;
        const end=lanePoint(nodes,previous,1),from=lanePoint(nodes,next,0);
        const to=lanePoint(nodes,next,distance/next.length);
        const neighbours=trafficGrid.near(from,9).filter(o=>o!==v).map(vehicleData);
        if(car.position.distanceTo(new THREE.Vector3(from.x,from.y,from.z))<10)neighbours.push(ego);
        return !buildingIndex.hits(end,from) &&
          !vehicleConflict(end,from,previous.angle,next.angle,neighbours) &&
          !vehicleConflict(from,to,next.angle,next.angle,neighbours);
      },rnd,next=>(v.exitMemory?.get(`${next.from}:${next.to}`)??0)>simTime?1:0);
    if(v.blockedFor>=3 && simTime>=v.retryRouteAt &&
      (!redLight(a,b,simTime)||v.t*lane.length>lane.stopAt+.001)) {
      v.retryRouteAt=simTime+3;
      const previousExit=v.nextLanes[0];
      if(v.blockedFor>=8 && previousExit) {
        v.exitMemory??=new Map();
        for(const [key,until] of v.exitMemory)if(until<=simTime)v.exitMemory.delete(key);
        v.exitMemory.set(`${previousExit.from}:${previousExit.to}`,simTime+45);
      }
      const alternative=findExit();
      if(alternative) {
        if(previousExit && alternative[0]!==previousExit)v.recoveryReroutes=(v.recoveryReroutes||0)+1;
        v.nextLanes=alternative;
      }
    }
    const controller=junctions.byNode.get(lane.to)?.id;
    const beforeLine=v.t*lane.length<=lane.stopAt+.001;
    const entering=lane.controlled&&beforeLine&&v.t*lane.length+dt*v.speed>lane.stopAt;
    let exitClear=true;
    if(entering) {
      exitClear=!junctionOwners.has(controller)||junctionOwners.get(controller)===v;
      let clearance=0, previous=lane;
      for(const next of v.nextLanes) {
        if(!exitClear||clearance>=5.5)break;
        const from=lanePoint(nodes,next,0),to=lanePoint(nodes,next,Math.min(1,(5.5-clearance)/next.length));
        const neighbours=trafficGrid.near(from,8).filter(o=>o!==v).map(vehicleData);
        if(car.position.distanceTo(new THREE.Vector3(from.x,from.y,from.z))<10)neighbours.push(ego);
        const end=lanePoint(nodes,previous,1);
        if(exitBlocked(next,Math.min(next.length,5.5-clearance)) || buildingIndex.hits(end,from) ||
          vehicleConflict(end,from,previous.angle,next.angle,neighbours) ||
          vehicleConflict(from,to,next.angle,next.angle,neighbours))exitClear=false;
        clearance+=next.length;previous=next;
      }
      if(clearance<5.5)exitClear=false;
    }
    // A safe alternative should release this green now, not after the generic
    // three-second congestion retry. Never bypass another car's junction lock.
    if(entering && !exitClear && !redLight(a,b,simTime) &&
      (!junctionOwners.has(controller)||junctionOwners.get(controller)===v) &&
      simTime>=(v.retryGreenAt??-Infinity)) {
      v.retryGreenAt=simTime+.5;
      const alternative=findExit();
      if(alternative){v.nextLanes=alternative;exitClear=true;}
    }
    const committed=v.junctionLock!==null;
    const advance=yieldPeople&&!committed?0:Math.min(dt*v.speed,
      junctionEntryAllowance(lane.length,v.t*lane.length,redLight(a,b,simTime),lane.stopAt,exitClear));
    const nextT=Math.min(1,v.t+advance/lane.length);
    let nextLane=lane, nextPosition=lanePoint(nodes,lane,nextT), nextHeading=lane.angle;
    if (nextT>=1) {
      if (v.nextLanes.length) {
        nextLane=v.nextLanes[0];
        nextPosition=lanePoint(nodes,nextLane,0); nextHeading=nextLane.angle;
      }
    }
    const blocked=advance===0 || ((!lane.buildingClear || nextLane!==lane) && buildingIndex.hits(v.mesh.position,nextPosition)) ||
      vehiclePedestrianConflict(v.mesh.position,nextPosition,v.mesh.rotation.y,nextHeading,nearPeople.map(w=>w.mesh.position)) ||
      vehicleConflict(v.mesh.position,nextPosition,v.mesh.rotation.y,nextHeading,nearCars);
    v.blockedFor=blocked?(v.blockedFor||0)+dt:0;
    v.movingSpeed=blocked?0:v.mesh.position.distanceTo(nextPosition)/dt;
    if (!blocked) {
      if(canClaimJunction(entering,exitClear,redLight(a,b,simTime),nextT*lane.length,lane.stopAt)&&v.junctionLock===null) {
        junctionOwners.set(controller,v);v.junctionLock=controller;
        v.clearanceRemaining=lane.length-v.t*lane.length+5.5;
      }
      const moved=v.mesh.position.distanceTo(nextPosition);
      v.mesh.position.copy(nextPosition); v.mesh.rotation.y=nextHeading;v.mesh.rotation.x=nextLane.pitch;
      if(nextLane!==lane)v.nextLanes.shift();
      v.lane=nextLane; v.t=nextLane===lane?nextT:0; trafficGrid.add(v);
      if(v.junctionLock!==null) {
        v.clearanceRemaining-=moved;
        if(v.clearanceRemaining<=0) {
          if(junctionOwners.get(v.junctionLock)===v)junctionOwners.delete(v.junctionLock);
          v.junctionLock=null;
        }
      }
    }
  }
  // Spread pedestrian decisions over four ticks; all agents retain swept
  // collision checks and advance by their actual elapsed simulation time.
  for(const w of walkers) {
    if(!w.flyBrain)continue;
    const p=w.mesh.position,step=w.walkSteps?.[w.walkIndex];
    const target=step?.point||{x:w.crossing.x+w.crossing.dx*(w.side?-4:4),z:w.crossing.z+w.crossing.dz*(w.side?-4:4)};
    const desired=Math.atan2(target.x-p.x,target.z-p.z);
    const probe={x:p.x+Math.sin(desired)*.5,y:0,z:p.z+Math.cos(desired)*.5};
    const vehicles=trafficGrid.near(p,3).map(vehicleData);
    if(car.position.distanceTo(p)<4)vehicles.push(ego);
    const c=step?.crossing||(!w.walkSteps?w.crossing:null);
    w.flyBrain.step(dt,{turn:Math.sin(desired-w.mesh.rotation.y),
      hazard:pedestrianVehicleConflict(p,probe,vehicles)||pedestrianObstacleIndex.hits(p,probe,.24),
      waiting:!!c&&c.controlled!==false&&!w.crossingActive&&!continuingCrossing(w,c)&&!pedestrianMayStart(c.node.id,simTime)});
  }
  const crowds=crossingCrowds(walkers,
    c=>!c.controlled||pedestrianMayStart(c.node.id,simTime),
    c=> {
      const vehicles=trafficGrid.near({x:c.x,y:0,z:c.z},30).map(vehicleData);
      if(Math.hypot(car.position.x-c.x,car.position.z-c.z)<30)vehicles.push(ego);
      return crossingGapClear(c,vehicles,false);
    });
  // Admit the whole waiting group together, before any member moves.
  for(const [w,group] of crowds) {
    if(group.admit){if(!w.crossingPermit)w.crossingStart={...w.mesh.position};w.crossingActive=true;w.crossingPermit=group.crossing;}
    if(w.crossingActive)w.crossingPace=group.speed;
  }
  const cohort=walkerTick++%4;
  let detourBudget=12;
  const walkStart=(Math.floor(walkerTick/4)*997)%Math.max(1,walkers.length);
  for (let offset=0;offset<walkers.length;offset++) {
    const i=(walkStart+offset)%walkers.length, w=walkers[i];
    if(!dt || (!w.crossingActive && !w.crossingPace && i%4!==cohort))continue;
    const walkDt=Math.min(.4,Math.max(0,simTime-w.walkUpdated));
    w.walkUpdated=simTime;w.walking=false;
    let targetPoint, crossing;
    if(w.walkSteps) {
      const next=w.walkSteps[w.walkIndex];
      if(!next) {
        if(!w.walkSteps.length)continue;
        w.trips++;
        const plan=pedestrianNetwork.plan(w.destination,rnd);
        w.walkSteps=plan?.steps || []; w.walkIndex=0; w.destination=plan?.destination??w.destination;
        continue;
      }
      targetPoint=next.point;crossing=next.crossing;
    } else {
      const c=w.crossing;
      targetPoint={x:c.x+c.dx*(w.side? -4:4),y:0,z:c.z+c.dz*(w.side? -4:4)};
      crossing={...c,controlled:true};
    }
    if(crossing && w.walkSteps)w.crossing={...crossing,dx:0,dz:1};
    if(w.crossingPermit && Math.hypot(w.mesh.position.x-w.crossingPermit.x,w.mesh.position.z-w.crossingPermit.z)>8)w.crossingPermit=null;
    if(crossing && continuingCrossing(w,crossing))w.crossingActive=true;
    if(crossing && !w.crossingActive) {
      const green=!crossing.controlled || pedestrianMayStart(crossing.node.id,simTime);
      if(!green && simTime<w.nextAttempt)continue;
      const opportunity=!w.obeysSignal&&!green;
      const vehicles=trafficGrid.near({x:crossing.x,y:0,z:crossing.z},30).map(vehicleData);
      if(Math.hypot(car.position.x-crossing.x,car.position.z-crossing.z)<30)vehicles.push(ego);
      if((green||opportunity)&&crossingGapClear(crossing,vehicles,opportunity)) {
        if(!w.crossingPermit)w.crossingStart={...w.mesh.position};
        w.crossingActive=true;w.crossingPermit=crossing;
        if(opportunity)informalCrossings++;
      } else {w.nextAttempt=simTime+.5;continue;}
    }
    // Internal crossing vertices are route geometry, not stopping/meeting points.
    // Aim for the far sidewalk directly when the entire connector is clear.
    if(w.crossingActive && w.walkSteps) {
      let following=w.walkSteps[w.walkIndex+1];
      while(following?.crossing && continuingCrossing(w,following.crossing) &&
        straightCrossing(w.walkSteps[w.walkIndex-1]?.point||w.crossingStart||w.mesh.position,targetPoint,following.point) &&
        !pedestrianObstacleIndex.hits(w.mesh.position,following.point,.24)) {
        w.walkIndex++;targetPoint=following.point;crossing=following.crossing;w.detour=null;
        following=w.walkSteps[w.walkIndex+1];
      }
    }
    const bankTarget=targetPoint, afterCrossing=w.walkSteps?.[w.walkIndex+1];
    const exitTarget=crossing && afterCrossing && !afterCrossing.crossing &&
      Math.hypot(w.mesh.position.x-bankTarget.x,w.mesh.position.z-bankTarget.z)<1.5 &&
      straightCrossing(w.walkSteps[w.walkIndex-1]?.point||w.crossingStart||w.mesh.position,bankTarget,afterCrossing.point) &&
      !pedestrianObstacleIndex.hits(w.mesh.position,afterCrossing.point,.24) ? afterCrossing.point : null;
    if(exitTarget)targetPoint=exitTarget;
    const routeTarget=targetPoint;
    const followingDetour=!!w.detour?.length;
    if(followingDetour)targetPoint=w.detour[0];
    const position=w.mesh.position, dx=targetPoint.x-position.x,dz=targetPoint.z-position.z,
      distance=Math.hypot(dx,dz), advance=Math.min(distance,walkDt*(w.crossingPace||w.walkSpeed)*(w.crossingActive?Math.max(.85,w.flyBrain?.drive??1):(w.flyBrain?.drive??1)));
    const arrivalRadius=followingDetour ? .1 : crossing ? .5 : .58;
    if(distance>arrivalRadius) {
      const angle=Math.atan2(dx,dz)+(w.flyBrain?.turn??0)*.12;
      const people=walkerGrid.near(position,1.3).filter(other=>other!==w).map(other=>other.mesh.position);
      const vehicles=trafficGrid.near(position,3).map(vehicleData);
      if(car.position.distanceTo(position)<4)vehicles.push(ego);
      // Small sidesteps around a person; every candidate retains swept protection.
      for(const offset of (w.crossingPace?[0,.25,.5,-.25,-.5,1,-1]:[0,.6,-.6,1.1,-1.1])) {
        const next={x:position.x+Math.sin(angle+offset)*advance,y:0,z:position.z+Math.cos(angle+offset)*advance};
        if(pedestrianObstacleIndex.hits(position,next,.24)||pedestrianConflict(position,next,people,.48)||
          pedestrianVehicleConflict(position,next,vehicles))continue;
        position.copy(next);w.mesh.rotation.y=angle+offset;w.walking=true;walkerGrid.add(w);break;
      }
    }
    const progressKey=`${targetPoint.x}:${targetPoint.z}`;
    const remainingDistance=Math.hypot(position.x-targetPoint.x,position.z-targetPoint.z);
    if(w.progressKey!==progressKey){w.progressKey=progressKey;w.bestTargetDistance=distance;}
    // Sideways oscillation is not progress: request a detour unless the walker
    // gets closer than its previous best position for this waypoint.
    if(w.walking && remainingDistance<w.bestTargetDistance-.01) {
      w.bestTargetDistance=remainingDistance;w.stuckTime=0;
    } else w.stuckTime+=walkDt;
    if(w.stuckTime>=(w.crossingActive?.4:1.6) && simTime>=w.retryDetour && (detourBudget>0 || position.distanceTo(car.position)<15)) {
      detourBudget--;w.retryDetour=simTime+(w.crossingActive?1:4);
      const people=walkerGrid.near(position,9).filter(o=>o!==w).map(o=>o.mesh.position);
      const vehicles=trafficGrid.near(position,9).map(vehicleData);
      if(car.position.distanceTo(position)<10)vehicles.push(ego);
      const origin={x:position.x,y:0,z:position.z};
      const dx=routeTarget.x-origin.x,dz=routeTarget.z-origin.z,length=Math.hypot(dx,dz);
      const clear=(from,to)=> {
        // Stay near the sidewalk unless already authorised to cross the road.
        if(!w.crossingActive&&length>.1&&Math.abs((to.x-origin.x)*dz-(to.z-origin.z)*dx)/length>1.1)return false;
        return !pedestrianObstacleIndex.hits(from,to,.24)&&!pedestrianConflict(from,to,people,.48)&&
          !pedestrianVehicleConflict(from,to,vehicles);
      };
      const detour=pedestrianDetour(origin,routeTarget,clear);
      if(detour?.length)w.detour=detour;
    }
    w.phase=w.crossingActive ? .5 : 0;
    const clearedBank=exitTarget && (position.x-bankTarget.x)*(exitTarget.x-bankTarget.x)+
      (position.z-bankTarget.z)*(exitTarget.z-bankTarget.z)>=0;
    if(clearedBank || Math.hypot(position.x-targetPoint.x,position.z-targetPoint.z)<=arrivalRadius) {
      if(followingDetour && !clearedBank){w.detour.shift();continue;}
      w.detour=null;
      w.crossingActive=false;w.crossingPace=null;w.phase=0;w.nextAttempt=simTime;
      if(w.walkSteps)w.walkIndex++;
      else {
        const key=`${w.crossing.node.id}:${w.side}`;
        if(!pedestrianAnchors.has(key))pedestrianAnchors.set(key,pedestrianNetwork.nearest(position));
        const start=pedestrianAnchors.get(key),plan=pedestrianNetwork.plan(start,rnd);
        if(plan) {
          w.destination=plan.destination;w.walkIndex=0;
          w.walkSteps=[{point:pedestrianNetwork.points[start],crossing:{...w.crossing,controlled:true}},...plan.steps];
        }
      }
    }
    // Update yielding location as the pedestrian visits other intersections.
    if(crossing && w.walkSteps)w.crossing={...crossing,dx:0,dz:1};
  }
  const nearbyPedestrians=walkerGrid.near(car.position,30);
  const movingNearby=nearbyPedestrians.filter(w=>w.walking).length;
  $("walkingHint").textContent=`附近行人：${movingNearby} 步行 / ${nearbyPedestrians.length-movingNearby} 等灯或避让 · 仿真 ${simTime.toFixed(1)} s`;
  $("pedestrianMoving").textContent=`${walkers.filter(w=>w.walking).length.toLocaleString()} 步行 / ${walkers.reduce((sum,w)=>sum+w.trips,0)} 次到达`;
  renderTraffic(traffic); renderWalkers(walkers);
  $("populationTiming").textContent = `${(performance.now()-tickStarted).toFixed(0)} ms / 步`;
  $("population").textContent = `${walkers.length.toLocaleString()} 人 / ${traffic.length.toLocaleString()} 辆`;
  const nearbyTraffic=trafficGrid.near(car.position,30);
  $("trafficMoving").textContent = `${traffic.filter(v=>v.movingSpeed>0).length.toLocaleString()} 行驶 / ${traffic.filter(v=>!v.movingSpeed).length.toLocaleString()} 等待 · 附近 ${nearbyTraffic.filter(v=>v.movingSpeed>0).length}/${nearbyTraffic.length} 辆行驶 · 安全改道 ${traffic.reduce((sum,v)=>sum+(v.recoveryReroutes||0),0)} 次`;
}
function yieldToVehicles(dt) {
  velocity = 0;
  heading = car.rotation.y;
  vehicleWait += dt;
  $("status").textContent = "减速停车 · 避让车辆";
  $("reason").textContent = "保持车距，等待前方车辆或交叉车流通过";
  updateStats();
}
function yieldToPedestrians(dt) {
  velocity = 0;
  heading = car.rotation.y;
  pedestrianWait += dt;
  $("status").textContent = "停车礼让行人";
  $("reason").textContent = "等待行人通过斑马线，通道空出后自动继续";
  updateStats();
}
function stopForBuilding() {
  velocity=0; heading=car.rotation.y;
  if(simTime-lastReplan<2) return;
  lastReplan=simTime;
  buildingStops++;
  const a=nodes[path[segment]], b=nodes[path[segment+1]];
  let plan=null;
  // At a junction we can choose another outgoing lane without reversing.
  if(a && car.position.distanceTo(new THREE.Vector3(a.x,a.y+.3,a.z))<2) {
    blockedRoads.add(`${a.id}:${b.id}`);
    plan=obstacleRouter.route(a.id,+$("end").value,car.position,blockedRoads);
    if(plan && plan.path.length>1) {
      path=plan.path;segment=0;progress=0;recoveryAssist=true;
    } else plan=null;
  } else if(a && b) {
    // A neural steering deviation can rejoin the current clear lane ahead.
    const lane=obstacleRouter.outgoing[a.id].find(l=>l.to===b.id);
    if(lane?.clear) {
      const dx=b.x-a.x,dz=b.z-a.z;
      const t=Math.max(0,Math.min(.99,((car.position.x-a.x)*dx+(car.position.z-a.z)*dz)/(dx*dx+dz*dz)));
      const join=lanePoint(nodes,lane,t);
      if(car.position.distanceTo(new THREE.Vector3(join.x,join.y,join.z))<2.5 && !buildingIndex.hits(car.position,join)) {
        plan={path};progress=t*lane.length;recoveryAssist=true;
      }
    }
  }
  if(plan) {
    detours++;$("detours").textContent=detours;
    $("status").textContent="障碍绕行 · 路线已更新";
    $("reason").textContent="外部避障导航接管至下个路口；通行前仍检查红灯、行人和车辆";
    record.push({event:"obstacle_detour",simTime,path:[...path],position:car.position.toArray()});
  } else {
    $("status").textContent="障碍前安全停车";
    $("reason").textContent="当前位置没有可安全接入的合法绕行路线，等待通路；不逆行、不穿越建筑";
  }
  updateStats();
}
function step(dt) {
  const duration=simulationDuration($("duration").value);
  if(simTime>=duration-1e-8)return finish(false,`已达到设定仿真时长 ${duration} 秒`);
  dt=Math.min(dt,duration-simTime);
  simTime += dt;
  trafficStep(dt);
  updateTrafficLights();
  if (!running) return;
  const nearTraffic=trafficGrid.near(car.position,30), nearWalkers=walkerGrid.near(car.position,30);
  const a = nodes[path[segment]],
    b = nodes[path[segment + 1]];
  if (!b) return;
  const dx = b.x - car.position.x,
    dz = b.z - car.position.z;
  const distance = Math.hypot(dx, dz);
  let error = Math.atan2(dx, dz) - heading;
  error = Math.atan2(Math.sin(error), Math.cos(error));
  let obstacle = Infinity;
  for (const obj of [
    ...nearTraffic.map((v) => v.mesh),
    ...nearWalkers.map((v) => v.mesh),
  ]) {
    const p = obj.position.clone().sub(car.position);
    if (
      Math.abs(p.y) < 1.7 &&
      p.x * Math.sin(heading) + p.z * Math.cos(heading) > 0 &&
      Math.abs(p.x * Math.cos(heading) - p.z * Math.sin(heading)) < 1.2
    )
      obstacle = Math.min(obstacle, p.length());
  }
  // Contact detection uses the same footprints as movement protection.
  // A pedestrian safely beside the car must not trigger the old 1.1-unit circle.
  if (vehicleConflict(car.position,car.position,heading,heading,nearTraffic.map(vehicleData)) ||
      vehiclePedestrianConflict(car.position,car.position,heading,heading,nearWalkers.map(w=>w.mesh.position))) {
    collisions++;
    finish(false, "发生碰撞，已停止并记录本次实验");
    return;
  }
  const segmentLength = Math.hypot(b.x - a.x, b.z - a.z, b.y - a.y);
  const along = Math.max(
    0,
    Math.min(
      segmentLength,
      ((car.position.x - a.x) * (b.x - a.x) +
        (car.position.z - a.z) * (b.z - a.z)) /
        Math.max(0.01, Math.hypot(b.x - a.x, b.z - a.z)),
    ),
  );
  const egoCrossing=crossings.find(c=>c.node.id===junctions.byNode.get(b.id)?.id);
  const egoStopAt=crosswalkStopPosition(a,b,egoCrossing);
  const red =
    redLight(a, b, simTime) &&
    stopAllowance(segmentLength, along, true,egoStopAt) < segmentLength - along - 0.001;
  const redNear = red && distance < 8;
  const pedestrianYield = nearWalkers.some((w) =>
    (!w.walkSteps || w.walkSteps[w.walkIndex]?.crossing) && crossingNeedsYield(car.position, heading, w.crossing, w.phase, simTime),
  );
  const hazard = redNear || obstacle < 6 || pedestrianYield;
  const stimulus = {
    speed: hazard ? 0 : 1,
    turn: Math.max(-1, Math.min(1, error)),
    hazard,
  };
  if (performance.now() > nextBrain) requestBrain(stimulus);
  if (pedestrianYield) return yieldToPedestrians(dt);
  const m = brain ? motor(brain.output_neuron_activity) : { drive: 0, turn: 0 };
  const previousHeading = car.rotation.y;
  const signalController=junctions.byNode.get(b.id);
  const greenLaunch=!!brain && !hazard && a.y===0 && b.y===0 && !!signalController &&
    lightColor(signalController.id,approachAxis(signalController.angle,Math.atan2(b.x-a.x,b.z-a.z)),simTime)==="green";
  let target = 4.5 * m.drive;
  // External traffic assistance releases a safe green without waiting for a
  // fresh Brian2 window. The swept movement guards below still have final say.
  if(greenLaunch)target=Math.max(target,3.15);
  if (hazard || redNear) target = 0;
  if (!brain) target = 0;
  if (simTime - neuralAt > 40 && !greenLaunch) target = 0;
  velocity += (target - velocity) * Math.min(1, dt * 3);
  {
    const length = Math.hypot(b.x - a.x, b.z - a.z, b.y - a.y);
    const advance = Math.max(
      0,
      Math.min(
        velocity * dt,
        length - progress,
        stopAllowance(length, progress, red,egoStopAt),
        obstacle < 6 ? obstacle - 2 : Infinity,
      ),
    );
    const t = (progress + advance) / length;
    const proposed=cooperativeTarget(a,b,t,m.turn);
    heading=proposed.heading;
    const nextPosition=new THREE.Vector3(proposed.x,proposed.y,proposed.z);
    if (recoveryAssist) {
      const joinDistance=car.position.distanceTo(nextPosition);
      if(joinDistance>advance && joinDistance>0)
        nextPosition.lerpVectors(car.position,nextPosition,advance/joinDistance);
    }
    if (
      vehiclePedestrianConflict(
        car.position,
        nextPosition,
        previousHeading,
        heading,
        nearWalkers.map((w) => w.mesh.position),
      )
    )
      return yieldToPedestrians(dt);
    if (
      vehicleConflict(
        car.position,
        nextPosition,
        previousHeading,
        heading,
        nearTraffic.map((v) => ({
          ...v.mesh.position,
          heading: v.mesh.rotation.y,
        })),
      )
    )
      return yieldToVehicles(dt);
    if (buildingIndex.hits(car.position, nextPosition))
      return stopForBuilding();
    const moved=car.position.distanceTo(nextPosition);
    car.position.copy(nextPosition);
    car.rotation.x=proposed.pitch;
    if(recoveryAssist) {
      progress=Math.max(0,Math.min(length,((car.position.x-a.x)*(b.x-a.x)+
        (car.position.y-a.y-.3)*(b.y-a.y)+(car.position.z-a.z)*(b.z-a.z))/length));
    } else progress += advance;
    travelled += moved;
    if (progress >= length - 0.05) {
      segment++;
      progress = 0;
      recoveryAssist=false;
    }
  }
  car.rotation.y = heading;
  if (red && velocity < 1) waitTime += dt;
  $("status").textContent = !brain
    ? "等待全脑响应"
    : greenLaunch
      ? "绿灯通行 · 安全加速"
      : simTime - neuralAt > 40
      ? "等待新神经窗口"
      : hazard
        ? "让行 / 等待"
        : "实验车辆行驶中";
  $("reason").textContent = !brain
    ? "首次编译与加载连接组可能需要几十秒"
    : greenLaunch
      ? "通道安全，交通辅助立即起步；神经输出继续更新"
      : simTime - neuralAt > 40
      ? "上一窗口已超时，车辆等待新输出"
      : redNear
        ? "前方红灯，外部交通保护生效"
        : obstacle < 6
          ? "前方车辆或行人，外部交通保护生效"
          : b.y > 0
            ? "驶入延安高架 · 神经运动输出驱动车速"
            : `${b.name}`;
  if (segment >= path.length - 1)
    return finish(true, "本次路线完成；导航、规则与神经运动输出共同作用");
  updateStats();
}
$("run").onclick = () => {
  if (
    (started && !running && segment >= path.length - 1) ||
    (started &&
      !running &&
      (collisions || departures || buildingStops || simTime >= simulationDuration($("duration").value)))
  )
    setup();
  running = !running;
  started = true;
  $("run").textContent = running ? "Ⅱ 暂停实验" : "▶ 继续实验";
};
$("reset").onclick = () => {
  trainingLeft = 0;
  $("train").textContent = "循环训练 · 10 轮";
  setup();
};
for (const id of ["start", "end"])
  $(id).onchange = () => {
    trainingLeft = 0;
    setup();
  };
$("random").onclick = () => {
  trainingLeft = 0;
  $("train").textContent = "循环训练 · 10 轮";
  const a = Math.floor(Math.random() * nodes.length);
  let b = Math.floor(Math.random() * (nodes.length - 1));
  if (b >= a) b++;
  $("start").value = a;
  $("end").value = b;
  setup();
};
$("duration").onchange=()=>{$("duration").value=simulationDuration($("duration").value);};
$("speed").onchange = () =>
  ($("speedLabel").textContent = $("speed").value + "×");
$("pick").onclick = () => {
  pickStep = 1;
  pickTargets.forEach((m) => (m.material.opacity = 0.65));
  $("pickHint").textContent = "请点击一个发光路口作为起点";
};
let down = null;
renderer.domElement.addEventListener(
  "pointerdown",
  (e) => (down = [e.clientX, e.clientY]),
);
renderer.domElement.addEventListener("pointerup", (e) => {
  if (
    !pickStep ||
    !down ||
    Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5
  )
    return;
  const r = renderer.domElement.getBoundingClientRect(),
    ray = new THREE.Raycaster();
  ray.setFromCamera(
    new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      (-(e.clientY - r.top) / r.height) * 2 + 1,
    ),
    camera,
  );
  const hit = ray.intersectObjects(pickTargets)[0];
  if (!hit) return;
  $(pickStep === 1 ? "start" : "end").value = hit.object.userData.id;
  if (pickStep === 1) {
    pickStep = 2;
    $("pickHint").textContent = "再点击一个发光路口作为终点";
  } else {
    pickStep = 0;
    pickTargets.forEach((m) => (m.material.opacity = 0.1));
    $("pickHint").textContent = "起终点已更新";
    setup();
  }
});
for (const id of ["overview", "follow", "top"])
  $(id).onclick = () => {
    view = id;
    for (const k of ["overview", "follow", "top"])
      $(k).classList.toggle("active", k === id);
    if (id !== "follow") {
      camera.position.set(
        id === "top" ? 0 : 660,
        id === "top" ? 1100 : 820,
        id === "top" ? 1 : 760,
      );
      controls.target.set(0, 0, 20);
    }
  };
$("export").onclick = () => {
  const payload = {
    learning: learners["cooperative"].snapshot(),
    map: "OpenStreetMap Shanghai centre / 2026-09-15",
    mode: "cooperative",
    start: nodes[path[0]],
    end: nodes[+$("end").value],
    population: {pedestrians:walkers.length, vehicles:traffic.length, intersections:crossings.length, movingVehicles:traffic.filter(v=>v.movingSpeed>0).length},
    metrics: {
      travelled,
      waitTime,
      collisions,
      buildingStops,
      detours,
      pedestrianWait,
      informalCrossings,
      vehicleWait,
      departures,
      arrived,
      completed,
      simTime,
      duration:simulationDuration($("duration").value),
    },
    neuralMethod:
      "Fresh 400ms Brian2 windows; no membrane state continuity; external sensory encoder and route planner",
    record,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "fly-city-experiment.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
let miniPick = 0;
$("minimap").onclick = (e) => {
  const r = $("minimap").getBoundingClientRect();
  const x =
      mapBounds.minX +
      ((e.clientX - r.left) / r.width) * (mapBounds.maxX - mapBounds.minX),
    z =
      mapBounds.minZ +
      ((e.clientY - r.top) / r.height) * (mapBounds.maxZ - mapBounds.minZ);
  $(miniPick === 0 ? "start" : "end").value = closestNode(x, z);
  miniPick = 1 - miniPick;
  trainingLeft = 0;
  setup();
  $("pickHint").textContent = miniPick
    ? "已设起点，请在地图上选择终点"
    : "地图行程已更新";
};
new ResizeObserver(() => {
  const w = $("scene").clientWidth,
    h = $("scene").clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}).observe($("scene"));
$("train").onclick = () => {
  if (trainingLeft) {
    trainingLeft = 0;
    running = false;
    $("run").textContent = "▶ 继续实验";
    $("train").textContent = "循环训练 · 10 轮";
    return;
  }
  setup();
  trainingLeft = 10;
  $("learn").checked = true;
  running = true;
  started = true;
  $("run").textContent = "Ⅱ 暂停实验";
  $("train").textContent = "停止训练";
  $("trainingInfo").textContent =
    "同一路线重复 10 轮；导航辅助与直控记忆分开保存。";
};
$("clearLearning").onclick = () => {
  learners["cooperative"] = new Learner();
  pendingLearning = null;
  episodeReward = 0;
  saveLearning();
  $("policyInfo").textContent = "当前模式的学习记忆已清除";
};
walkers.forEach((_,i)=>$("brainSubject").add(new Option(`行人 ${i+1} · 简化脑`,String(i))));
$("brainSubject").onchange=()=>drawNeurons();
setup();
trafficStep(0);
drawNeurons();
let last = performance.now(), physicsPending = 0;
function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  if (running) {
    timelineTime+=dt;
    physicsPending = Math.min(5,physicsPending + dt * +$("speed").value);
    // Keep 100 ms collision steps at every playback speed, including 20x.
    // Bound catch-up work so a slow frame cannot monopolize the browser.
    for(let steps=0;running && physicsPending>=.1-1e-9 && steps<50;steps++) {
      physicsPending=Math.max(0,physicsPending-.1);
      step(.1);
    }
  } else physicsPending=0;
  if (view === "follow") {
    const desired = car.position
      .clone()
      .add(
        new THREE.Vector3(-Math.sin(heading) * 24, 18, -Math.cos(heading) * 24),
      );
    camera.position.lerp(desired, 0.06);
    controls.target.lerp(
      car.position.clone().add(new THREE.Vector3(0, 4, 0)),
      0.1,
    );
  }
  controls.update();
  arrow.position.y = 9 + Math.sin(now * 0.003) * 0.5;
  if(now-brainDisplayAt>33){drawNeurons();brainDisplayAt=now;}
  updateSignalHint();
  renderer.render(scene, camera);
  // Camera follows the same pitched vehicle frame on ascending/descending ramps.
  const eye=new THREE.Vector3(0,1.4,.9).applyEuler(car.rotation);
  const look=new THREE.Vector3(0,1.4,30).applyEuler(car.rotation);
  povCamera.position.copy(car.position).add(eye);
  povCamera.lookAt(car.position.clone().add(look));
  car.visible = false;
  markers.visible = false;
  povRenderer.render(scene, povCamera);
  markers.visible = true;
  car.visible = true;
  drawMap();
}
requestAnimationFrame(animate);
// Read-only hooks for reproducible browser checks.
window.cityLab = {
  getState: () => ({
    path,
    running,
    segment,
    travelled,
    collisions,
    departures,
    brain: brain?.total_spikes,
    car: car.position.toArray(),
  }),
};
