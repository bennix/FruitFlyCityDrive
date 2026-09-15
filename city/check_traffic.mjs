import {PedestrianBrain} from "./pedestrian-brain.js";
import {clearRoadBuildings} from "./road-clearance.js";
import {crossingCrowds,continuingCrossing,straightCrossing} from './pedestrian-crowd.js';
import {pedestrianMayStart,pedestrianPreparing} from './traffic-signals.js';
import {vehiclePedestrianConflict,pedestrianVehicleConflict} from './collision.js';
import {findTrafficExit,canClaimJunction,clearedJunction,downstreamBlocked} from './traffic-routing.js';
import {pedestrianDetour} from './pedestrian-detour.js';
import assert from 'node:assert/strict';
import signalLayout from './data/signal-layout.json' with {type:'json'};
// Exercise the same population initialization and update code without rendering.
import fs from 'node:fs';
import * as THREE from 'three';
import {nodes,edges,junctions,buildings,signalTime,redLight} from './simulation.js';
import {AgentGrid,directedLanes,lanePoint,pedestrianSlots} from './population.js';
import {BuildingIndex,pedestrianConflict,vehicleConflict,crossingNeedsYield,crossingGapClear} from './collision.js';
import {PedestrianNetwork,pedestrianObstacles} from './pedestrian-navigation.js';
import {junctionStopPosition,stopAllowance,crosswalkStopPosition,junctionEntryAllowance} from './traffic-signals.js';
const source=fs.readFileSync(new URL('./main.js',import.meta.url),'utf8');
const obstaclesCode=source.slice(source.indexOf('const bridgeCandidates='),source.indexOf('const obstacleRouter ='));
const crossingCode=source.slice(source.indexOf('const crossings ='),source.indexOf('const pedestrianNetwork='));
const populationCode=source.slice(source.indexOf('const trafficGrid ='),source.indexOf('const markers ='));
const initialize=source.slice(source.indexOf('  trafficGrid.clear(); walkerGrid.clear();'),source.indexOf('  trafficStep(0);',source.indexOf('  trafficGrid.clear(); walkerGrid.clear();')));
let tick=source.slice(source.indexOf('function trafficStep(dt)'),source.indexOf('function yieldToVehicles'));
tick=tick.replace('v.movingSpeed=blocked?', `v.blockReason=!blocked?'moving':advance===0?(yieldPeople&&!committed?'pedestrian-yield':!exitClear?'exit-or-lock':'signal'):buildingIndex.hits(v.mesh.position,nextPosition)?'static':vehiclePedestrianConflict(v.mesh.position,nextPosition,v.mesh.rotation.y,nextHeading,nearPeople.map(w=>w.mesh.position))?'person':'vehicle';
    v.movingSpeed=blocked?`);
const run=new Function('straightCrossing','continuingCrossing','crossingCrowds','pedestrianMayStart','pedestrianPreparing','vehiclePedestrianConflict','pedestrianVehicleConflict','THREE','nodes','edges','junctions','buildings','signalTime','redLight','AgentGrid','directedLanes','lanePoint','pedestrianSlots','BuildingIndex','pedestrianConflict','vehicleConflict','crossingNeedsYield','crossingGapClear','PedestrianNetwork','stopAllowance','pedestrianObstacles','signalLayout','crosswalkStopPosition','junctionEntryAllowance','findTrafficExit','canClaimJunction','pedestrianDetour','clearedJunction','junctionStopPosition','processMode','ticks','PedestrianBrain','clearRoadBuildings','downstreamBlocked',`
${obstaclesCode}
let simTime=0,velocity=0,informalCrossings=0;
const car={position:new THREE.Vector3(1e5,0,1e5),rotation:{y:0}}, record=[];
const rnd=()=>.37, $=()=>({textContent:''}),renderTraffic=()=>{},renderWalkers=()=>{};
${crossingCode}
const pedestrianNetwork=new PedestrianNetwork(nodes,edges,pedestrianObstacleIndex,junctions),pedestrianAnchors=new Map(),pedestrianSpawnCache=new Map();
${populationCode}
${initialize}
${tick}
trafficStep(0);
if(processMode==='isolated'){walkers.length=0;walkerGrid.clear();}
const initial=traffic.map(v=>v.mesh.position.clone());
let recent=initial, recentPeople=walkers.map(w=>w.mesh.position.clone());const lateJunctions=new Set();
const transitions=new Set();
for(let i=0;i<ticks;i++){
 if(i===ticks-200){recent=traffic.map(v=>v.mesh.position.clone());recentPeople=walkers.map(w=>w.mesh.position.clone());}
 const before=traffic.map(v=>v.lane);
 simTime+=.1;trafficStep(.1);
 if(i%240===239)console.log('sim seconds',simTime.toFixed(0),'moving',traffic.filter(v=>v.movingSpeed>.01).length);
 traffic.forEach((v,j)=>{if(v.lane!==before[j]){transitions.add(j);if(i>=ticks-200&&before[j].controlled)lateJunctions.add(before[j].to);}});
}
const summary={vehicles:traffic.length,moved:traffic.filter((v,i)=>v.mesh.position.distanceTo(initial[i])>.1).length,recent:traffic.filter((v,i)=>v.mesh.position.distanceTo(recent[i])>.1).length,transitions:transitions.size,locks:junctionOwners.size,reasons:{},samples:[],ends:0,staleOwners:0,lateJunctions:lateJunctions.size,carOverlaps:traffic.filter(v=>vehicleConflict(v.mesh.position,v.mesh.position,v.lane.angle,v.lane.angle,trafficGrid.near(v.mesh.position,3).filter(o=>o!==v).map(vehicleData))).length,people:walkers.length,pedestriansWalking:walkers.filter(w=>w.walking).length,
 pedestrianCarOverlaps:walkers.filter(w=>pedestrianVehicleConflict(w.mesh.position,w.mesh.position,trafficGrid.near(w.mesh.position,3).map(vehicleData))).length,
 pedestrianOverlaps:walkers.filter(w=>walkerGrid.near(w.mesh.position,.479).some(o=>o!==w)).length,
 pedestrianInBuildings:walkers.filter(w=>pedestrianObstacleIndex.hits(w.mesh.position,w.mesh.position,.24)).length,
 recentlyWalking:walkers.filter((w,i)=>w.mesh.position.distanceTo(recentPeople[i])>.1).length,
 local:[2,26,35,110].map(id=>({node:id,movedRecently:traffic.filter((v,i)=>Math.hypot(recent[i].x-nodes[id].x,recent[i].z-nodes[id].z)<30 && v.mesh.position.distanceTo(recent[i])>.1).length}))};
for(const [id,v] of junctionOwners)if(v.junctionLock!==id)summary.staleOwners++;
for(const v of traffic){if(v.t>.95&&v.movingSpeed===0)summary.ends++;const reason=v.blockReason||'moving';summary.reasons[reason]=(summary.reasons[reason]||0)+1;if(v.junctionLock!==null&&v.movingSpeed===0&&summary.samples.length<8)summary.samples.push({lane:[v.lane.from,v.lane.to],t:v.t,lock:v.junctionLock,remaining:v.clearanceRemaining,reason});}
return summary;`);
const result=run(straightCrossing,continuingCrossing,crossingCrowds,pedestrianMayStart,pedestrianPreparing,vehiclePedestrianConflict,pedestrianVehicleConflict,THREE,nodes,edges,junctions,buildings,signalTime,redLight,AgentGrid,directedLanes,lanePoint,pedestrianSlots,BuildingIndex,pedestrianConflict,vehicleConflict,crossingNeedsYield,crossingGapClear,PedestrianNetwork,stopAllowance,pedestrianObstacles,signalLayout,crosswalkStopPosition,junctionEntryAllowance,findTrafficExit,canClaimJunction,pedestrianDetour,clearedJunction,junctionStopPosition,process.argv[2]||'mixed',Number(process.argv[3]||1200),PedestrianBrain,clearRoadBuildings,downstreamBlocked);
console.log(JSON.stringify(result,null,2));
assert.equal(result.vehicles,1000);
assert.equal(result.staleOwners,0);
assert.equal(result.carOverlaps,0);
assert.ok(result.recent>result.vehicles*.2,'Traffic must still move in the final 20 seconds');
assert.ok(result.lateJunctions>5,'Traffic must still pass multiple junctions after 100 seconds');
assert.equal(result.pedestrianCarOverlaps,0);
assert.equal(result.pedestrianOverlaps,0);
assert.equal(result.pedestrianInBuildings,0);
if(result.people)assert.ok(result.recentlyWalking>result.people*.2,'Pedestrians also continue walking');
