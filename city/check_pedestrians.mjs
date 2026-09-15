import {crossingCrowds,continuingCrossing,straightCrossing} from './pedestrian-crowd.js';
import {pedestrianMayStart,pedestrianPreparing} from './traffic-signals.js';
import {vehiclePedestrianConflict,pedestrianVehicleConflict} from './collision.js';
import {findTrafficExit,canClaimJunction} from './traffic-routing.js';
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
import {stopAllowance,crosswalkStopPosition,junctionEntryAllowance} from './traffic-signals.js';
const source=fs.readFileSync(new URL('./main.js',import.meta.url),'utf8');
const obstaclesCode=source.slice(source.indexOf('const vehicleObstacles='),source.indexOf('const obstacleRouter ='));
const crossingCode=source.slice(source.indexOf('const crossings ='),source.indexOf('const pedestrianNetwork='));
const populationCode=source.slice(source.indexOf('const trafficGrid ='),source.indexOf('const markers ='));
const initialize=source.slice(source.indexOf('  trafficGrid.clear(); walkerGrid.clear();'),source.indexOf('  trafficStep(0);',source.indexOf('  trafficGrid.clear(); walkerGrid.clear();')));
const tick=source.slice(source.indexOf('function trafficStep(dt)'),source.indexOf('function yieldToVehicles'));
const run=new Function('straightCrossing','continuingCrossing','crossingCrowds','pedestrianMayStart','pedestrianPreparing','vehiclePedestrianConflict','pedestrianVehicleConflict','THREE','nodes','edges','junctions','buildings','signalTime','redLight','AgentGrid','directedLanes','lanePoint','pedestrianSlots','BuildingIndex','pedestrianConflict','vehicleConflict','crossingNeedsYield','crossingGapClear','PedestrianNetwork','stopAllowance','pedestrianObstacles','signalLayout','crosswalkStopPosition','junctionEntryAllowance','findTrafficExit','canClaimJunction','pedestrianDetour',`
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
const initial=walkers.map(w=>w.mesh.position.clone());
let recent=initial;
for(let i=0;i<1200;i++){if(i===1000)recent=walkers.map(w=>w.mesh.position.clone());simTime+=.1;trafficStep(.1);}
const summary={recentlyMoved:walkers.filter((w,i)=>w.mesh.position.distanceTo(recent[i])>.1).length,people:walkers.length,vehicles:traffic.length,moved:walkers.filter((w,i)=>w.mesh.position.distanceTo(initial[i])>.1).length,
 routed:walkers.filter(w=>w.walkSteps?.length).length, arrivals:walkers.reduce((s,w)=>s+w.trips,0),
 inBuildings:walkers.filter(w=>pedestrianObstacleIndex.hits(w.mesh.position,w.mesh.position,.24)).length,
 overlaps:walkers.filter(w=>walkerGrid.near(w.mesh.position,.479).some(o=>o!==w)).length};
// Isolate one routed pedestrian to check two complete destination cycles without traffic queues.
const chosen=walkers.find(w=>w.walkSteps?.length>1);
if(chosen) {
  walkers.splice(0,walkers.length,chosen);traffic.length=0;trafficGrid.clear();walkerGrid.clear();
  chosen.mesh.position.copy(chosen.walkSteps[0].point);chosen.walkIndex=1;chosen.walkSpeed=1;
  chosen.crossingActive=false;chosen.nextAttempt=simTime;walkerGrid.add(chosen);
  for(let i=0;i<10000&&chosen.trips<2;i++){simTime+=.1;trafficStep(.1);}
  summary.continuousArrivals=chosen.trips;
}
return summary;`);
const result=run(straightCrossing,continuingCrossing,crossingCrowds,pedestrianMayStart,pedestrianPreparing,vehiclePedestrianConflict,pedestrianVehicleConflict,THREE,nodes,edges,junctions,buildings,signalTime,redLight,AgentGrid,directedLanes,lanePoint,pedestrianSlots,BuildingIndex,pedestrianConflict,vehicleConflict,crossingNeedsYield,crossingGapClear,PedestrianNetwork,stopAllowance,pedestrianObstacles,signalLayout,crosswalkStopPosition,junctionEntryAllowance,findTrafficExit,canClaimJunction,pedestrianDetour);
console.log(result);
assert.equal(result.people,20000);assert.equal(result.vehicles,10000);
assert.ok(result.moved>10000,"Most pedestrians should start a real walking trip, not all wait for an initial crossing");assert.ok(result.routed>0);
assert.equal(result.inBuildings,0);assert.equal(result.overlaps,0);

assert.equal(result.continuousArrivals,2);

assert.ok(result.recentlyMoved>1000,"Pedestrians must continue moving after two minutes");
