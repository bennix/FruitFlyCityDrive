import test from "node:test";
import assert from "node:assert/strict";
import {
  nodes,
  edges,
  buildings,
  route,
  signal,
  redLight,
  motor,
  nearestRoad,
  metresPerUnit,
} from "./simulation.js";
import { Learner, rewardFor } from "./learning.js";
test("actual OSM routes respect directed edges and connect sampled endpoints", () => {
  assert.ok(nodes.length > 1000);
  assert.equal(metresPerUnit, 4);
  for (let a = 0; a < nodes.length; a += 83) {
    const b = (a + 629) % nodes.length,
      p = route(a, b);
    assert.equal(p[0], a);
    assert.equal(p.at(-1), b);
    for (let i = 1; i < p.length; i++)
      assert.ok(
        edges.some(
          (e) =>
            (e.a === p[i - 1] && e.b === p[i]) ||
            (!e.oneway && e.b === p[i - 1] && e.a === p[i]),
        ),
      );
  }
});
test("actual high road exists and road distance considers elevation", () => {
  const e = edges.find((e) => e.type === "elevated"),
    a = nodes[e.a],
    b = nodes[e.b];
  assert.ok(e);
  assert.ok(
    nearestRoad({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      z: (a.z + b.z) / 2,
    }) < 0.001,
  );
  assert.ok(edges.some((e) => e.type === "ramp"));
});
test("signals provide two axes and all-red crossing; unmarked nodes never stop traffic", () => {
  assert.equal(signal(0, 0), "ns");
  assert.equal(signal(0, 22.5), "all");
  assert.equal(signal(0, 30), "ew");
  assert.equal(signal(0, 60), "all");
  const a = { x: 10, z: 0, y: 0 },
    b = { id: 0, x: 0, z: 0, y: 0, signal: true };
  assert.equal(redLight(a, b, 0), true);
  assert.equal(redLight(a, { ...b, signal: false }, 0), false);
});
test("zero motor spikes never cause drive; asymmetric spikes determine turning", () => {
  assert.deepEqual(motor({}), { drive: 0, turn: 0 });
  assert.equal(motor({ DNa01_left: { rate_hz: 50 } }).turn, -0.5);
  assert.equal(
    motor({ P9_oDN1_left: { rate_hz: 35 }, P9_oDN1_right: { rate_hz: 35 } })
      .drive,
    1,
  );
});
test("online reward immediately changes next choice; punishment and persistence work", () => {
  const l = new Learner(),
    s = "clear:straight:fast";
  for (let i = 0; i < 15; i++) l.update(s, 2, 2, s, true);
  assert.equal(l.choose(s, false).action, 2);
  for (let i = 0; i < 15; i++) l.update(s, 2, -10, s, true);
  assert.notEqual(l.choose(s, false).action, 2);
  assert.deepEqual(
    new Learner(JSON.parse(JSON.stringify(l.snapshot()))).snapshot(),
    l.snapshot(),
  );
});
test("failure feedback outweighs progress", () => {
  assert.ok(rewardFor({ progress: 100, lateral: 0, collision: true }) < 0);
  assert.ok(rewardFor({ progress: 100, lateral: 0, departure: true }) < 0);
  assert.ok(rewardFor({ progress: 10, lateral: 0, arrived: true }) > 10);
});
import { BuildingIndex } from "./collision.js";
test("building guard stops swept movement through walls, including thin-wall tunnelling", () => {
  const index = new BuildingIndex([
    {
      height: 10,
      points: [
        [0, 0],
        [5, 0],
        [5, 5],
        [0, 5],
        [0, 0],
      ],
    },
  ]);
  assert.ok(index.hits({ x: -5, y: 0.3, z: 2 }, { x: 10, y: 0.3, z: 2 }));
  assert.ok(index.hits({ x: -2, y: 0.3, z: 2 }, { x: -1, y: 0.3, z: 2 }));
  assert.equal(
    index.hits({ x: -5, y: 0.3, z: -3 }, { x: 10, y: 0.3, z: -3 }),
    false,
  );
  assert.equal(
    index.hits({ x: -5, y: 15, z: 2 }, { x: 10, y: 15, z: 2 }),
    false,
  );
});
import { pedestrianConflict, crossingNeedsYield } from "./collision.js";
test("pedestrian guard catches crossing a person between frames and allows a cleared road", () => {
  const a = { x: 0, y: 0.3, z: 0 },
    b = { x: 0, y: 0.3, z: 10 };
  assert.ok(pedestrianConflict(a, b, [{ x: 0, y: 0, z: 5 }]));
  assert.ok(pedestrianConflict(a, b, [{ x: 1, y: 0, z: 5 }]));
  assert.equal(pedestrianConflict(a, b, [{ x: 4, y: 0, z: 5 }]), false);
  assert.equal(
    pedestrianConflict({ ...a, y: 6 }, { ...b, y: 6 }, [{ x: 0, y: 0, z: 5 }]),
    false,
  );
});
test("vehicle yields before crossing and resumes once crossing phase ends", () => {
  const c = { x: 0, z: 8, node: { id: 0 } },
    p = { x: 0, y: 0.3, z: 0 };
  assert.ok(crossingNeedsYield(p, 0, c, 0.5, 5));
  assert.ok(crossingNeedsYield(p, 0, c, 0, 45));
  assert.equal(crossingNeedsYield(p, 0, c, 1, 13), false);
  assert.equal(crossingNeedsYield({ ...p, y: 6 }, 0, c, 0.5, 10), false);
});
import { crossingGapClear } from "./collision.js";
test("opportunistic crossing requires sparse traffic and enough time before approaching vehicles", () => {
  const c = { x: 0, z: 0 };
  assert.ok(crossingGapClear(c, [], true));
  assert.equal(
    crossingGapClear(c, [{ x: 0, y: 0.3, z: -12, heading: 0, speed: 4 }], true),
    false,
  );
  assert.ok(
    crossingGapClear(
      c,
      [{ x: 0, y: 0.3, z: -20, heading: Math.PI, speed: 4 }],
      true,
    ),
  );
  assert.equal(
    crossingGapClear(
      c,
      [
        { x: 10, y: 0.3, z: 0, heading: 0, speed: 0 },
        { x: -10, y: 0.3, z: 0, heading: 0, speed: 0 },
      ],
      true,
    ),
    false,
  );
});
test("pedestrian movement also detects a nearby stopped vehicle", () => {
  assert.ok(
    pedestrianConflict({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, [
      { x: 1, y: 0.3, z: 0 },
    ]),
  );
});
import { vehicleConflict } from "./collision.js";
test("vehicle protection stops rear-end, oncoming and crossing collisions without blocking adjacent lanes", () => {
  const a = { x: 0, y: 0.3, z: 0 },
    b = { x: 0, y: 0.3, z: 5 };
  assert.ok(vehicleConflict(a, b, 0, 0, [{ x: 0, y: 0.3, z: 4, heading: 0 }]));
  assert.ok(
    vehicleConflict(a, b, 0, 0, [{ x: 0, y: 0.3, z: 4, heading: Math.PI }]),
  );
  assert.ok(
    vehicleConflict(a, b, 0, 0, [{ x: 0, y: 0.3, z: 4, heading: Math.PI / 2 }]),
  );
  assert.equal(
    vehicleConflict(a, b, 0, 0, [{ x: 1.4, y: 0.3, z: 4, heading: Math.PI }]),
    false,
  );
  assert.equal(
    vehicleConflict(a, b, 0, 0, [{ x: 0, y: 6, z: 4, heading: 0 }]),
    false,
  );
});
import {
  lightColor,
  signalFaces,
  stopAllowance,
  approachAxis,
} from "./traffic-signals.js";
import { junctions } from "./simulation.js";
import signalLayout from "./data/signal-layout.json" with { type: "json" };
test("each intersection has four matching faces; opposite approaches always have the same color", () => {
  for (const g of junctions.groups) {
    const faces = signalFaces(g);
    assert.equal(faces.length, 4);
    for (let t = 0; t < 72; t += 0.5) {
      assert.equal(
        lightColor(g.id, faces[0].axis, t),
        lightColor(g.id, faces[2].axis, t),
      );
      assert.equal(
        lightColor(g.id, faces[1].axis, t),
        lightColor(g.id, faces[3].axis, t),
      );
      assert.ok(
        !(
          lightColor(g.id, 0, t) === "green" &&
          lightColor(g.id, 1, t) === "green"
        ),
      );
    }
  }
});
test("displayed incoming signal and road permission agree for every ground approach", () => {
  for (const e of edges) {
    const a = nodes[e.a],
      b = nodes[e.b],
      g = junctions.byNode.get(b.id);
    if (!g || a.y || b.y || junctions.byNode.get(a.id) === g) continue;
    const axis = approachAxis(g.angle, Math.atan2(b.x - a.x, b.z - a.z));
    for (let t = 0; t < 72; t += 3)
      assert.equal(redLight(a, b, t), lightColor(g.id, axis, t) !== "green");
  }
});
test("red stop line cannot be skipped by a large step, while green releases waiting traffic", () => {
  assert.equal(stopAllowance(20, 16, true), 1);
  assert.equal(stopAllowance(20, 17, true), 0);
  assert.equal(stopAllowance(20, 17, false), 3);
  assert.equal(stopAllowance(20, 18, true), 2);
  assert.equal(stopAllowance(2, 1, true), 0);
});
test("all four physical heads are placed and their supports clear actual building volumes", () => {
  assert.equal(signalLayout.missing.length, 0);
  assert.equal(signalLayout.placed.length, junctions.groups.length * 4);
  const index = new BuildingIndex(buildings);
  for (const g of junctions.groups)
    assert.equal(
      signalLayout.placed.filter((p) => p.controller === g.id).length,
      4,
    );
  for (const p of signalLayout.placed)
    for (const part of p.parts)
      assert.equal(index.hits(part.a, part.b, part.radius), false);
});

import { AgentGrid, directedLanes, lanePoint, pedestrianSlots } from './population.js';
test('20,000 pedestrians are balanced across all 588 junctions with distinct queue slots', () => {
  const crossings=Array.from({length:588},(_,id)=>({node:{id},x:id*100,z:0,dx:1,dz:0}));
  const people=pedestrianSlots(crossings);
  const counts=new Map(), positions=new Set();
  for (const p of people) {
    counts.set(p.crossing.node.id,(counts.get(p.crossing.node.id)||0)+1);
    positions.add(`${p.crossing.x+(p.side*2-1)*p.reach}:${p.crossing.z}`);
  }
  assert.equal(people.length,20000); assert.equal(counts.size,588);
  assert.equal(Math.min(...counts.values()),34); assert.equal(Math.max(...counts.values()),35);
  assert.equal(positions.size,20000);
});
test('agent grid agrees with full search and moves agents across negative cell boundaries', () => {
  const grid=new AgentGrid(), agents=Array.from({length:10000},(_,i)=>({mesh:{position:{x:(i%100)*3-150,z:Math.floor(i/100)*3-150,y:i%7===0?8:0}}}));
  agents.forEach(a=>grid.add(a));
  for(const p of [{x:0,z:0,y:0},{x:-12,z:-24,y:0},{x:149,z:140,y:8}]) {
    assert.deepEqual(new Set(grid.near(p,16)),new Set(agents.filter(a=>Math.abs(a.mesh.position.y-p.y)<2&&Math.hypot(a.mesh.position.x-p.x,a.mesh.position.z-p.z)<=16)));
  }
  const a=agents[0]; a.mesh.position={x:0,z:0,y:0}; grid.add(a);
  assert.ok(grid.near({x:0,z:0,y:0},1).includes(a));
  assert.ok(!grid.near({x:-150,z:-150,y:8},1).includes(a));
});
test('OSM directed lanes provide at least 10,000 nonoverlapping building-clear car positions', () => {
  const {lanes,outgoing}=directedLanes(nodes,edges), grid=new AgentGrid(), buildingsIndex=new BuildingIndex(buildings);
  let count=0;
  const data=v=>({...v.mesh.position,heading:v.heading});
  for(const lane of lanes) {
    assert.ok(outgoing[lane.from].includes(lane));
    assert.ok(edges.some(e=>e.a===lane.from&&e.b===lane.to||!e.oneway&&e.b===lane.from&&e.a===lane.to));
    for(let d=3;d<lane.length-3;d+=2.7) {
      const p=lanePoint(nodes,lane,d/lane.length);
      if(buildingsIndex.hits(p,p)||vehicleConflict(p,p,lane.angle,lane.angle,grid.near(p,3).map(data)))continue;
      grid.add({mesh:{position:p},heading:lane.angle});count++;
    }
  }
  assert.ok(count>=10000,`Only ${count} safe slots`);
});

test('straight-motion SAT optimization agrees with general swept polygons for rotated crossing traffic', () => {
  let seed=19;
  const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
  for(let i=0;i<2000;i++) {
    const angle=random()*Math.PI*2, distance=random()*8,
      from={x:0,y:0,z:0},to={x:Math.sin(angle)*distance,y:0,z:Math.cos(angle)*distance};
    const others=[{x:random()*16-8,z:random()*16-8,y:0,heading:random()*Math.PI*2}];
    assert.equal(vehicleConflict(from,to,angle,angle,others),vehicleConflict(from,to,angle,angle+1e-8,others));
  }
});

import { ObstacleRouter } from './navigation.js';
test('building obstacle causes a legal detour and unreachable destinations return no route', () => {
  const ns=[{id:0,x:0,y:0,z:0},{id:1,x:20,y:0,z:0},{id:2,x:0,y:0,z:20},{id:3,x:20,y:0,z:20}];
  const es=[[0,1],[0,2],[2,3],[3,1]].map(([a,b])=>({a,b,oneway:true}));
  const obstacles=new BuildingIndex([{points:[[8,-2],[12,-2],[12,2],[8,2]],height:10}]);
  const router=new ObstacleRouter(ns,es,obstacles);
  assert.deepEqual(router.route(0,1).path,[0,2,3,1]);
  assert.equal(router.route(1,0),null);
  assert.equal(router.route(0,1,null,new Set(['2:3'])),null);
  assert.equal(router.route(0,1,{x:10,y:.3,z:0}),null,'must not teleport back to a junction');
  assert.deepEqual(router.route(0,0).path,[0]);
});
test('actual OSM obstacle routes keep every lane and junction connection clear', () => {
  const obstacles=new BuildingIndex(buildings), router=new ObstacleRouter(nodes,edges,obstacles);
  let checked=0;
  for(let start=0;start<nodes.length;start+=71) {
    const plan=router.route(start,(start+217)%nodes.length);
    if(!plan) continue;
    let previous=null;
    for(let i=1;i<plan.path.length;i++) {
      const lane=router.outgoing[plan.path[i-1]].find(l=>l.to===plan.path[i]);
      assert.ok(lane);
      assert.equal(obstacles.hits(lane.start,lane.end),false);
      if(previous)assert.equal(obstacles.hits(previous.end,lane.start),false);
      previous=lane;
    }
    checked++;
  }
  assert.ok(checked>5);
});

import { clearRoadBuildings, roadWidth } from './road-clearance.js';
test('building sanitation removes crossing and enclosing footprints but preserves clear and below-bridge buildings', () => {
  const ns=[{x:0,y:0,z:0},{x:20,y:0,z:0}];
  const es=[{a:0,b:1,highway:'primary'}];
  const make=(points,height=5)=>({points,height});
  const crossing=make([[8,2],[9,2],[9,5],[8,5]]);
  const enclosing=make([[-10,-10],[30,-10],[30,10],[-10,10]]);
  const clear=make([[8,4],[9,4],[9,5],[8,5]]);
  assert.deepEqual(clearRoadBuildings([crossing,enclosing,clear],ns,es).kept,[clear]);
  const bridge=ns.map(n=>({...n,y:10}));
  assert.deepEqual(clearRoadBuildings([crossing],bridge,es).kept,[crossing]);
  assert.equal(clearRoadBuildings([make(crossing.points,12)],bridge,es).kept.length,0);
});
test('all displayed buildings clear every full-width road using independent collision geometry', () => {
  const index=new BuildingIndex(buildings);
  for(const edge of edges) {
    const a=nodes[edge.a],b=nodes[edge.b];
    assert.equal(index.hits({...a,y:a.y-.325},{...b,y:b.y-.325},roadWidth(edge)/2),false,`Road ${edge.a}-${edge.b}`);
  }
});

import { PedestrianNetwork } from './pedestrian-navigation.js';
test('pedestrians choose a destination five to six street segments away and can choose another after arrival', () => {
  const ns=Array.from({length:15},(_,id)=>({id,x:id*20,y:0,z:0}));
  const es=ns.slice(1).map((n,i)=>({a:i,b:i+1,type:'ground',highway:'residential'}));
  const network=new PedestrianNetwork(ns,es,new BuildingIndex([]),{byNode:new Map()});
  const first=network.plan(0,()=>.5);
  assert.ok(first.blocks>=5&&first.blocks<=6);
  assert.ok(first.steps.length);
  const second=network.plan(first.destination,()=>.7);
  assert.ok(second.blocks>=5&&second.blocks<=6);
  assert.notEqual(second.destination,first.destination);
});
test('all pedestrian network segments clear buildings and stay on the ground network', () => {
  const obstacles=new BuildingIndex(buildings);
  const network=new PedestrianNetwork(nodes,edges,obstacles,{byNode:new Map()});
  assert.ok(network.points.length>1000);
  for(let i=0;i<network.points.length;i++)for(const link of network.links[i]) {
    assert.equal(network.points[i].y,0);
    assert.equal(obstacles.hits(network.points[i],network.points[link.to],.24),false);
  }
});

import { crosswalkStopPosition, junctionEntryAllowance } from './traffic-signals.js';
test('NPC red stopping keeps the entire car before the near crosswalk edge', () => {
  const a={x:0,y:0,z:-20},b={x:0,y:0,z:0},crossing={x:0,z:-3,dx:1,dz:0};
  const stop=crosswalkStopPosition(a,b,crossing);
  assert.ok(stop+1.2<=17-.75-.5+1e-9);
  let progress=0;
  for(let i=0;i<100;i++)progress+=Math.min(5,junctionEntryAllowance(20,progress,true,stop,true));
  assert.equal(progress,stop);
  assert.equal(junctionEntryAllowance(20,progress,true,stop,true),0);
  assert.ok(junctionEntryAllowance(20,progress,false,stop,true)>0);
});
test('green entry waits before zebra crossing when exit is queued; committed cars clear on red', () => {
  const stop=14.55;
  assert.equal(junctionEntryAllowance(20,stop,false,stop,false),0);
  assert.equal(junctionEntryAllowance(20,stop-1,false,stop,false),1);
  assert.ok(junctionEntryAllowance(20,stop+.1,true,stop,false)>0);
});

test('a car properly stopped before the crosswalk does not prevent pedestrians from crossing', () => {
  const crossing={x:0,z:0};
  assert.ok(crossingGapClear(crossing,[{x:0,y:.3,z:-2.45,heading:0,speed:0}]));
  assert.equal(crossingGapClear(crossing,[{x:0,y:.3,z:-2.45,heading:0,speed:2}]),false);
  assert.ok(crossingGapClear(crossing,[{x:0,y:.3,z:-1,heading:0,speed:0}]));
  assert.equal(crossingGapClear(crossing,[{x:0,y:.3,z:-1,heading:0,speed:0}],true),false);
});

import { cooperativeTarget } from './cooperative-control.js';
test('default cooperative control combines route geometry with bounded neural steering', () => {
  const a={x:0,y:0,z:0},b={x:0,y:0,z:20};
  const left=cooperativeTarget(a,b,.5,-1),right=cooperativeTarget(a,b,.5,1);
  assert.equal(left.z,10);assert.equal(right.z,10);
  assert.ok(left.x<right.x);assert.ok(left.heading<right.heading);
  assert.ok(left.x>=.66-1e-9&&right.x<=.74+1e-9);
  assert.deepEqual(cooperativeTarget(a,b,.5,100),right);
});

test('walking around a street corner does not require a pedestrian green phase', () => {
  const ns=[{id:0,x:0,y:0,z:0},{id:1,x:20,y:0,z:0},{id:2,x:0,y:0,z:20}];
  const es=[{a:0,b:1,type:'ground',highway:'primary'},{a:0,b:2,type:'ground',highway:'primary'}];
  const network=new PedestrianNetwork(ns,es,new BuildingIndex([]),{byNode:new Map([[0,{id:0}]])});
  const a=network.points.findIndex(p=>Math.abs(p.x)<.01&&Math.abs(p.z-3.65)<.01);
  const b=network.points.findIndex(p=>Math.abs(p.x-3.65)<.01&&Math.abs(p.z)<.01);
  const seen=new Set([a]),queue=[a];
  for(let i=0;i<queue.length;i++)for(const link of network.links[queue[i]]) {
    if(link.crossing||link.block||seen.has(link.to))continue;
    seen.add(link.to);queue.push(link.to);
  }
  assert.ok(seen.has(b),'same-side corner must have a signal-free sidewalk connection');
  assert.ok(network.links.some(links=>links.some(link=>link.crossing?.controlled)),'actual road crossings still obey signals');
});

import { pedestrianDetour } from './pedestrian-detour.js';
test('a blocked pedestrian finds a swept path around a stationary obstacle without teleporting', () => {
  const obstacles=new BuildingIndex([{points:[[-.6,.5],[.6,.5],[.6,2],[-.6,2]],height:3}]);
  const start={x:0,y:0,z:0},goal={x:0,y:0,z:3};
  const clear=(a,b)=>!obstacles.hits(a,b,.24);
  const path=pedestrianDetour(start,goal,clear);
  assert.ok(path?.length>2);
  let previous=start;
  for(const point of path) {assert.ok(clear(previous,point));assert.ok(Math.hypot(point.x-previous.x,point.z-previous.z)<=1);previous=point;}
  assert.ok(Math.hypot(previous.x-goal.x,previous.z-goal.z)<.01);
  assert.equal(pedestrianDetour(start,goal,()=>false),null);
});

test('all 2,352 signal poles are outside every ground road with a safety margin', () => {
  for(const fixture of signalLayout.placed) {
    const p=fixture.pole;
    for(const edge of edges) {
      if(edge.type!=='ground')continue;
      const a=nodes[edge.a],b=nodes[edge.b],dx=b.x-a.x,dz=b.z-a.z,length=dx*dx+dz*dz;
      const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/length)):0;
      assert.ok(Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz)>=roadWidth(edge)/2+.12+.35-1e-8);
    }
  }
});

test('a pedestrian can walk around a stopped car while maintaining clearance', () => {
  const start={x:0,y:0,z:0},goal={x:0,y:0,z:4};
  const car={x:0,y:.3,z:2};
  const clear=(a,b)=>!pedestrianConflict(a,b,[car],1.6);
  const path=pedestrianDetour(start,goal,clear);
  assert.ok(path?.length);
  assert.ok(path.some(p=>Math.abs(p.x)>1.6));
  let previous=start;
  for(const point of path){assert.ok(clear(previous,point));previous=point;}
});

import {findTrafficExit,canClaimJunction} from './traffic-routing.js';
test('a red-light stop rounded above the line cannot steal a junction reservation', () => {
  const stopAt=15.45, rounded=(stopAt/19.95)*19.95;
  assert.equal(canClaimJunction(true,false,true,rounded,stopAt),false);
  assert.equal(canClaimJunction(true,true,false,stopAt+1e-12,stopAt),false);
  assert.equal(canClaimJunction(true,false,false,stopAt+.2,stopAt),false);
  assert.equal(canClaimJunction(true,true,false,stopAt+.2,stopAt),true);
});
test('traffic chooses a clear alternate turn instead of retaining a blocked exit', () => {
  const incoming={from:0,to:1,length:10,buildingClear:true};
  const blocked={from:1,to:2,length:10,buildingClear:true};
  const open={from:1,to:3,length:10,buildingClear:true};
  const outgoing=[[],[blocked,open],[],[]];
  assert.deepEqual(findTrafficExit(incoming,outgoing,(_,next)=>next!==blocked,()=>0),[open]);
  assert.equal(findTrafficExit(incoming,outgoing,()=>false,()=>0),null);
  open.buildingClear=false;
  assert.equal(findTrafficExit(incoming,outgoing,(_,next)=>next!==blocked,()=>0),null);
});
test('exit search checks each short connector and rejects a downstream dead end', () => {
  const incoming={from:0,to:1,length:10,buildingClear:true};
  const short={from:1,to:2,length:1,buildingClear:true};
  const exit={from:2,to:3,length:8,buildingClear:true};
  const outgoing=[[],[short],[exit],[]];
  const inspected=[];
  assert.deepEqual(findTrafficExit(incoming,outgoing,(a,b,d)=>{inspected.push(d);return true;},()=>0),[short,exit]);
  assert.deepEqual(inspected,[1,4.5]);
  outgoing[2]=[];
  assert.equal(findTrafficExit(incoming,outgoing,()=>true,()=>0),null);
});

import {vehiclePedestrianConflict,pedestrianVehicleConflict} from './collision.js';
test('a pedestrian beside the car does not block its lane, while front and side contact do', () => {
  const a={x:0,y:.3,z:0},b={x:0,y:.3,z:.3};
  assert.equal(vehiclePedestrianConflict(a,b,0,0,[{x:1.43,y:0,z:.82}]),false);
  assert.equal(vehiclePedestrianConflict(a,b,0,0,[{x:0,y:0,z:1.6}]),true);
  assert.equal(vehiclePedestrianConflict(a,b,0,0,[{x:.8,y:0,z:0}]),true);
  assert.equal(vehiclePedestrianConflict(a,{...b,z:10},0,0,[{x:0,y:0,z:5}]),true);
  assert.equal(vehiclePedestrianConflict(a,b,0,Math.PI/2,[{x:.9,y:0,z:.4}]),true);
});
test('walking uses the same vehicle footprint and cannot tunnel through a stopped car', () => {
  const cars=[{x:0,y:.3,z:0,heading:0}];
  assert.equal(pedestrianVehicleConflict({x:1.43,y:0,z:1},{x:1.43,y:0,z:0},cars),false);
  assert.equal(pedestrianVehicleConflict({x:-2,y:0,z:0},{x:2,y:0,z:0},cars),true);
  assert.equal(pedestrianVehicleConflict({x:0,y:0,z:2},{x:0,y:0,z:1.4},cars),true);
});
test('floating point residue at a stop line counts as waiting rather than perpetual microscopic driving', () => {
  assert.equal(stopAllowance(20,15.45-1e-12,true,15.45),0);
  assert.equal(stopAllowance(20,15.45-1e-12,false,15.45)>4,true);
});

import {pedestrianMayStart,signalCycle} from './traffic-signals.js';
test('pedestrian batches leave enough all-red clearance before the next vehicle green', () => {
  for(let t=0;t<signalCycle;t+=.1) {
    if(!pedestrianMayStart(0,t))continue;
    // Slowest walker, widest standard sidewalk-to-sidewalk crossing.
    for(let elapsed=0;elapsed<7.3/.35;elapsed+=.1) {
      assert.equal(lightColor(0,0,t+elapsed),'red');
      assert.equal(lightColor(0,1,t+elapsed),'red');
    }
  }
});
test('opposing lanes leave turning clearance without shrinking the vehicles', () => {
  const map=[{x:0,y:0,z:0},{x:0,y:0,z:10},{x:2,y:0,z:10}];
  const lane={from:0,to:1,angle:0},from=lanePoint(map,lane,0);
  const turned={...from,x:Math.cos(.2),z:-Math.sin(.2)};
  const other={x:-1,y:.3,z:0,heading:Math.PI};
  assert.equal(vehicleConflict(from,turned,0,.2,[other]),false);
  assert.ok(Math.abs(from.x)+.63<1.75,'car stays inside even a 3.5-unit road');
  assert.equal(vehicleConflict({...from,x:.7},{...turned,x:Math.cos(.2)*.7,z:-Math.sin(.2)*.7},0,.2,[{...other,x:-.7}]),true);
});
test('a safe pedestrian within the old start collision radius does not end the experiment', () => {
  const car={x:0,y:.3,z:0},person={x:1,y:0,z:0};
  assert.ok(Math.hypot(person.x-car.x,person.y-car.y,person.z-car.z)<1.1);
  assert.equal(vehiclePedestrianConflict(car,car,0,0,[person]),false);
  assert.equal(vehiclePedestrianConflict(car,{...car,z:.1},0,0,[person]),false);
  assert.equal(vehiclePedestrianConflict(car,car,0,0,[{...person,x:.7}]),true);
});

import fs from 'node:fs';
import * as THREE from 'three';
test('the real first driving tick survives a safe nearby pedestrian and still records real contact', () => {
  const source=fs.readFileSync(new URL('./main.js',import.meta.url),'utf8');
  const tick=source.slice(source.indexOf('function step(dt)'),source.indexOf('$("run").onclick'));
  const run=new Function('THREE','vehicleConflict','vehiclePedestrianConflict','cooperativeTarget','stopAllowance','crosswalkStopPosition','personOffset','simulationDuration',`
    let simTime=0,running=true,collisions=0,heading=0,progress=0,segment=0,velocity=0,
      brain=null,nextBrain=Infinity,neuralAt=0,recoveryAssist=false,travelled=0,waitTime=0;
    const car={position:new THREE.Vector3(.7,.3,0),rotation:{y:0}};
    const nodes=[{id:0,x:0,y:0,z:0},{id:1,x:0,y:0,z:100}],path=[0,1],crossings=[],junctions={byNode:new Map()};
    const walker={mesh:{position:new THREE.Vector3(.7+personOffset,0,0)},walkSteps:[],walkIndex:0};
    const trafficGrid={near:()=>[]},walkerGrid={near:()=>[walker]},buildingIndex={hits:()=>false};
    const trafficStep=()=>{},updateTrafficLights=()=>{},updateStats=()=>{},redLight=()=>false,
      vehicleData=v=>({...v.mesh.position,heading:v.mesh.rotation.y}),$=()=>({textContent:''}),
      finish=()=>{running=false;},yieldToPedestrians=()=>{},yieldToVehicles=()=>{};
    ${tick}
    step(.1);
    return {running,collisions,simTime};
  `);
  const invoke=offset=>run(THREE,vehicleConflict,vehiclePedestrianConflict,cooperativeTarget,stopAllowance,crosswalkStopPosition,offset,simulationDuration);
  assert.deepEqual(invoke(1),{running:true,collisions:0,simTime:.1});
  assert.deepEqual(invoke(.7),{running:false,collisions:1,simTime:.1});
});

import {crossingCrowds} from './pedestrian-crowd.js';
test('three nearby pedestrians share a prompt crossing decision and walking pace', () => {
  const crossing={node:{id:1},x:0,z:0,controlled:true};
  const people=Array.from({length:3},(_,i)=>({mesh:{position:{x:-3,z:i*.52}},walkSpeed:.35+i*.025,walkIndex:0,walkSteps:[{crossing,point:{x:3,z:0}}]}));
  assert.equal(crossingCrowds(people.slice(0,2),()=>true,()=>true).size,0);
  let checks=0;
  const groups=crossingCrowds(people,()=>true,()=>{checks++;return true;});
  assert.equal(groups.size,3);assert.equal(checks,1);
  assert.equal(groups.get(people[0]),groups.get(people[2]));
  assert.equal(groups.get(people[0]).admit,true);
  assert.ok(groups.get(people[0]).speed>=.5625 && groups.get(people[0]).speed<=.625);
  assert.equal(crossingCrowds(people,()=>false,()=>true).get(people[0]).admit,false);
  assert.equal(crossingCrowds(people,()=>true,()=>false).get(people[0]).admit,false);
  people[2].walkSteps=[{crossing,point:{x:-3,z:0}}];people[2].mesh.position.x=3;
  assert.equal(crossingCrowds(people,()=>true,()=>true).size,0);
});

import {continuingCrossing} from './pedestrian-crowd.js';
test('crossing permission survives internal links but never authorizes a different intersection', () => {
  const c={node:{id:4},x:0,z:0};
  const w={mesh:{position:{x:1,z:0}},crossingPermit:c};
  assert.equal(continuingCrossing(w,{...c,x:2}),true);
  assert.equal(continuingCrossing(w,{...c,node:{id:5}}),false);
  w.mesh.position.x=20;
  assert.equal(continuingCrossing(w,c),false);
});
test('pedestrian detours can take a short side step through a narrow open route', () => {
  const allowed=p=>(Math.abs(p.z)<.05||Math.abs(p.z-1)<.05)?p.x>=-.05&&p.x<=.3:Math.abs(p.x-.25)<.05&&p.z>=0&&p.z<=1;
  const clear=(a,b)=>Array.from({length:21},(_,i)=>({x:a.x+(b.x-a.x)*i/20,z:a.z+(b.z-a.z)*i/20})).every(allowed);
  const start={x:0,y:0,z:0},target={x:0,y:0,z:1};
  const path=pedestrianDetour(start,target,clear);
  assert.ok(path?.length);
  let previous=start;for(const point of path){assert.ok(clear(previous,point));previous=point;}
  assert.deepEqual(path.at(-1),target);
});

import {straightCrossing} from './pedestrian-crowd.js';
test('crossing simplification keeps real turns instead of cutting diagonally across the junction', () => {
  assert.equal(straightCrossing({x:0,z:0},{x:1,z:0},{x:2,z:0}),true);
  assert.equal(straightCrossing({x:0,z:0},{x:1,z:0},{x:1,z:1}),false);
  assert.equal(straightCrossing({x:0,z:0},{x:1,z:0},{x:0,z:0}),false);
});
test('a pedestrian who has returned to the sidewalk must wait for a new crossing permission', () => {
  const c={node:{id:4},x:0,z:0};
  const w={mesh:{position:{x:3,z:0}},crossingPermit:c,crossingActive:false,crossingStart:{x:-3,z:0},walkIndex:1,
    walkSteps:[{point:{x:3,z:0},crossing:null},{point:{x:3,z:4},crossing:c}]};
  assert.equal(continuingCrossing(w,c),false);
});

import { lightRemaining } from './traffic-signals.js';
test('signal countdown agrees with the actual next colour change on both axes',()=>{
  for(const controller of [0,19,588])for(const axis of [0,1])for(let t=0;t<144;t+=.5){
    const remaining=lightRemaining(controller,axis,t),color=lightColor(controller,axis,t);
    assert.ok(remaining>0 && remaining<=52);
    assert.equal(lightColor(controller,axis,t+remaining-.00001),color);
    assert.notEqual(lightColor(controller,axis,t+remaining+.00001),color);
  }
});
test('pedestrians can route through a passable gap between parked cars without clipping',()=>{
  const start={x:-3,y:0,z:0},target={x:3,y:0,z:0};
  const vehicles=[{x:0,y:.3,z:0,heading:0,speed:0},{x:0,y:.3,z:3.2,heading:0,speed:0}];
  const clear=(a,b)=>!pedestrianVehicleConflict(a,b,vehicles);
  assert.equal(clear(start,target),false);
  const path=pedestrianDetour(start,target,clear);
  assert.ok(path?.length);
  let previous=start;
  for(const point of path){assert.ok(clear(previous,point));previous=point;}
  assert.ok(previous.x>0);
  assert.ok(clear(previous,target));
  assert.equal(clear({x:-1,y:0,z:1.6},{x:1,y:0,z:1.6}),true);
  const tight=[vehicles[0],{...vehicles[1],z:2.8}];
  assert.equal(pedestrianVehicleConflict({x:-1,y:0,z:1.4},{x:1,y:0,z:1.4},tight),true);
});

import { PedestrianBrain } from './pedestrian-brain.js';
test('pedestrian brains have independent persistent state and a rolling real spike window',()=>{
  const a=new PedestrianBrain(1),b=new PedestrianBrain(2);
  a.step(.2,{turn:.8});
  assert.equal(b.time,0);
  assert.ok(a.snapshot().total_spikes>0);
  const before=a.time;
  a.step(.3,{turn:-.8});
  assert.ok(a.time>before);
  assert.ok(a.snapshot().raster.every(n=>n.times.every(t=>t>=0&&t<=.400001)));
  assert.ok(a.drive>0);
  const voltage=Array.from(a.voltage);a.step(0);
  assert.deepEqual(Array.from(a.voltage),voltage);
});
test('pedestrian waiting input inhibits walking motor activity',()=>{
  const walking=new PedestrianBrain(9),waiting=new PedestrianBrain(9);
  walking.step(1,{waiting:false});waiting.step(1,{waiting:true});
  assert.ok(walking.drive>waiting.drive);
  assert.equal(waiting.drive,0);
  waiting.step(.4,{waiting:false});assert.ok(waiting.drive>0);
});

import { SpikeTimeline } from './spike-timeline.js';
test('received brain spikes scroll left without repeating the previous window',()=>{
  const timeline=new SpikeTimeline(20);
  const data={duration_sec:.4,raster:[{id:'1',times:[.1,.3]}]};
  timeline.append(data,2);
  const first=timeline.points(2),later=timeline.points(3);
  assert.equal(later.length,2);
  assert.ok(Math.abs(first[0].x-later[0].x-.05)<1e-8);
  timeline.append({duration_sec:.4,raster:[{id:'2',times:[.2]},{id:'1',times:[.1]}]},4);
  assert.equal(timeline.points(4).length,4);
  assert.equal(timeline.points(4).filter(p=>p.id==='1').every(p=>p.row===0),true);
  assert.equal(timeline.points(25).length,0);
});
test('bridge piers below an elevated road must not invade the street underneath',()=>{
  const roadNodes=[{x:0,y:8,z:-10},{x:0,y:8,z:10},{x:-10,y:0,z:0},{x:10,y:0,z:0}];
  const roadEdges=[{a:0,b:1,highway:'primary',type:'elevated'},{a:2,b:3,highway:'primary',type:'ground'}];
  const pier={points:[[-.4,-.5],[.4,-.5],[.4,.5],[-.4,.5]],height:7.5};
  assert.equal(clearRoadBuildings([pier],roadNodes,roadEdges).kept.length,0);
  const offStreet={...pier,points:pier.points.map(([x,z])=>[x,z+6])};
  assert.equal(clearRoadBuildings([offStreet],roadNodes,roadEdges).kept.length,1);
});

import {clearedJunction} from './traffic-routing.js';
test('a downstream stopped car releases a cleared junction but approaching cars retain it',()=>{
  const nodes=[{x:0,z:0},{x:0,z:2}],junction={members:[0,1]};
  assert.equal(clearedJunction(junction,nodes,{x:0,z:7},0),true);
  assert.equal(clearedJunction(junction,nodes,{x:0,z:6},0),false);
  assert.equal(clearedJunction(junction,nodes,{x:0,z:-7},0),false);
  assert.equal(clearedJunction(junction,nodes,{x:7,z:1},Math.PI/2),true);
});

test('separately mapped one-way carriageways do not push opposing cars together',()=>{
  const {lanes}=directedLanes(nodes,edges);
  const east=lanes.find(l=>l.from===110&&l.to===111),west=lanes.find(l=>l.from===628&&l.to===629);
  assert.equal(east.offset,0);assert.equal(west.offset,0);
  const a=lanePoint(nodes,east,.1);
  const origin=nodes[west.from],end=nodes[west.to];
  const t=((a.x-origin.x)*(end.x-origin.x)+(a.z-origin.z)*(end.z-origin.z))/((end.x-origin.x)**2+(end.z-origin.z)**2);
  const b=lanePoint(nodes,west,t);
  assert.equal(vehicleConflict(a,a,east.angle,east.angle,[{...b,heading:west.angle}]),false);
  const before=lanePoint(nodes,{...east,offset:1},.1),opposite=lanePoint(nodes,{...west,offset:1},t);
  assert.equal(vehicleConflict(before,before,east.angle,east.angle,[{...opposite,heading:west.angle}]),true);
  const ego=cooperativeTarget(nodes[110],nodes[111],.1,0,0);
  assert.ok(Math.hypot(ego.x-a.x,ego.z-a.z)<1e-8);
});

test('5x playback executes five safe physics steps rather than dropping elapsed time',()=>{
  const source=fs.readFileSync(new URL('./main.js',import.meta.url),'utf8');
  const block=source.slice(source.indexOf('    physicsPending = Math.min(5,'),source.indexOf('  } else physicsPending=0;'));
  const run=new Function('speed','elapsed','stopAfter',`
    let physicsPending=0,running=true;const dt=elapsed,steps=[];
    const $=()=>({value:speed}),step=dt=>{steps.push(dt);if(steps.length===stopAfter)running=false;};
    ${block}
    return {steps,physicsPending};
  `);
  assert.deepEqual(run(5,.1,Infinity).steps,[.1,.1,.1,.1,.1]);
  assert.deepEqual(run(1,.1,Infinity).steps,[.1]);
  for(const speed of [5,10,15,20])assert.equal(run(speed,.1,Infinity).steps.length,speed);
  assert.equal(run(20,3,Infinity).steps.length,50);
  assert.equal(run(5,.1,1).steps.length,1);
});

test('safe green accelerates immediately despite an old braking brain window',()=>{
  const source=fs.readFileSync(new URL('./main.js',import.meta.url),'utf8');
  const begin=source.indexOf('  const m = brain ? motor(');
  const code=source.slice(begin,source.indexOf('  {\n    const length',begin));
  const run=new Function('color','hazard','brain','controlled',`
    const motor=()=>({drive:0,turn:0}),car={rotation:{y:0}},
      a={x:0,y:0,z:0},b={id:1,x:0,y:0,z:10},
      junctions={byNode:new Map(controlled?[[1,{id:1,angle:0}]]:[])},
      lightColor=()=>color,approachAxis=()=>0,simTime=100,neuralAt=0,redNear=color!=="green",dt=.1;
    let velocity=0;
    ${code}
    return velocity;
  `);
  assert.ok(run('green',false,{},true)>0);
  assert.equal(run('green',true,{},true),0);
  assert.equal(run('red',false,{},true),0);
  assert.equal(run('yellow',false,{},true),0);
  assert.equal(run('green',false,null,true),0);
  assert.equal(run('green',false,{},false),0);
});

import {spikeGlow} from './spike-timeline.js';
test('neuron animation follows each recorded spike and fades instead of staying lit',()=>{
  assert.equal(spikeGlow([.1,.3],.05),0);
  assert.equal(spikeGlow([.1,.3],.1),1);
  assert.ok(spikeGlow([.1,.3],.2)<.5);
  assert.equal(spikeGlow([.1,.3],.3),1);
  assert.ok(spikeGlow([.1,.3],1)<.01);
  assert.equal(spikeGlow([],1),0);
});

import {simulationDuration} from './simulation-duration.js';
test('duration defaults to 1000 seconds and accepts a custom positive duration',()=>{
  assert.equal(simulationDuration('1000'),1000);
  assert.equal(simulationDuration('1800'),1800);
  for(const value of ['',0,-1,Infinity,'invalid'])assert.equal(simulationDuration(value),1000);
});
test('duration limit stops centrally even if traffic waiting would return early',()=>{
  const source=fs.readFileSync(new URL('./main.js',import.meta.url),'utf8');
  const begin=source.indexOf('  const duration=simulationDuration(');
  const code=source.slice(begin,source.indexOf('  trafficStep(dt);',begin));
  const run=new Function('simulationDuration','simTime','value','dt',`
    const $=()=>({value}),finish=(success,reason)=>({finished:true,reason,simTime});
    ${code}
    return {finished:false,simTime};
  `);
  assert.equal(run(simulationDuration,600,1000,.1).finished,false);
  assert.equal(run(simulationDuration,999.95,1000,.1).simTime,1000);
  assert.equal(run(simulationDuration,1000,1000,.1).finished,true);
  assert.equal(run(simulationDuration,10,10,.1).finished,true);
});

test('ramp vehicle pitch follows the road tangent in both travel directions',()=>{
  for(const height of [-6,0,6]) {
    const a={x:3,y:0,z:2},b={x:13,y:height,z:22};
    const pose=cooperativeTarget(a,b,.5,0);
    const forward=new THREE.Vector3(0,0,1).applyEuler(new THREE.Euler(pose.pitch,pose.heading,0,'YXZ'));
    const tangent=new THREE.Vector3(b.x-a.x,b.y-a.y,b.z-a.z).normalize();
    assert.ok(forward.distanceTo(tangent)<1e-9);
    const lane=directedLanes([a,b],[{a:0,b:1,oneway:true}]).lanes[0];
    assert.equal(lane.pitch,pose.pitch);
  }
});

test('NPC green release immediately chooses a safe exit while retaining locks and red stops',()=>{
  const source=fs.readFileSync(new URL('./main.js',import.meta.url),'utf8');
  const begin=source.indexOf('    if(entering && !exitClear');
  const block=source.slice(begin,source.indexOf('    const committed=',begin));
  const run=new Function('red','occupied','safe',`
    const v={nextLanes:['blocked']},controller=1,a={},b={},simTime=10,entering=true;
    let exitClear=false,calls=0;
    const junctionOwners=new Map(occupied?[[1,{}]]:[]),redLight=()=>red,
      findExit=()=>{calls++;return safe?['clear']:null;};
    ${block}
    return {exitClear,calls,next:v.nextLanes};
  `);
  assert.deepEqual(run(false,false,true),{exitClear:true,calls:1,next:['clear']});
  assert.equal(run(true,false,true).calls,0);
  assert.equal(run(false,true,true).calls,0);
  assert.equal(run(false,false,false).exitClear,false);
});

import {junctionStopPosition} from './traffic-signals.js';
test('red stop stays outside the first node of a clustered intersection',()=>{
  const a={x:0,y:0,z:0},b={x:0,y:0,z:20},nodes=[{x:0,z:16},b];
  const stop=junctionStopPosition(a,b,null,{members:[0,1]},nodes);
  assert.equal(stop,11.5);
  assert.ok(stop+1.2<16);
  assert.equal(junctionStopPosition(a,b,null,null,nodes),15.5);
});

test('pedestrian back-and-forth motion does not reset the blocked timer',()=>{
  const source=fs.readFileSync(new URL('./main.js',import.meta.url),'utf8');
  const begin=source.indexOf('    const progressKey=');
  const block=source.slice(begin,source.indexOf('    if(w.stuckTime>=',begin));
  const run=new Function(`
    const w={walking:true,stuckTime:0},targetPoint={x:0,z:0},walkDt=.1;
    for(const x of [.9,1,.9,1,.9,1]){
      const position={x,z:0},distance=1;
      ${block}
    }
    return w.stuckTime;
  `);
  assert.ok(run()>=.4);
});

import {downstreamBlocked} from './traffic-routing.js';
test('a short downstream red-light queue cannot be counted as a clear junction exit',()=>{
  const short={controlled:true,stopAt:2};
  assert.equal(downstreamBlocked(short,5.5,true,false),true);
  assert.equal(downstreamBlocked(short,5.5,false,true),true);
  assert.equal(downstreamBlocked(short,5.5,false,false),false);
  assert.equal(downstreamBlocked(short,1,true,false),false);
  assert.equal(downstreamBlocked({controlled:false,stopAt:2},5.5,true,true),false);
});

test('traffic recovery remembers blocked exits while retaining safe fallback routes',()=>{
  const incoming={from:0,to:1},a={from:1,to:2,length:8,buildingClear:true},b={from:1,to:3,length:8,buildingClear:true};
  const outgoing=[[],[a,b],[],[]];
  assert.equal(findTrafficExit(incoming,outgoing,()=>true,()=>0)[0],a);
  assert.equal(findTrafficExit(incoming,outgoing,()=>true,()=>0,l=>l===a?1:0)[0],b);
  assert.equal(findTrafficExit(incoming,outgoing,(_,next)=>next===a,()=>0,l=>l===a?1:0)[0],a);
  assert.equal(findTrafficExit(incoming,outgoing,()=>false,()=>0,()=>1),null);
});

test('ordinary roads retain ground-level junctions instead of inheriting bridge layers',()=>{
  const raw=JSON.parse(fs.readFileSync(new URL('./data/shanghai-api.json',import.meta.url),'utf8'));
  const ways=new Map(raw.elements.filter(e=>e.type==='way').map(e=>[String(e.id),e.tags||{}]));
  for(const edge of edges){
    const tags=ways.get(edge.osm_id);
    if(tags.bridge==='yes')continue;
    assert.equal(nodes[edge.a].y,0,`${edge.name} start lifted into a false ramp`);
    assert.equal(nodes[edge.b].y,0,`${edge.name} end lifted into a false ramp`);
  }
  assert.equal(nodes[124].y,0);
  assert.ok(junctions.byNode.has(124));
});
