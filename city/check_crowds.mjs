import {PedestrianBrain} from "./pedestrian-brain.js";
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {crossingCrowds,continuingCrossing,straightCrossing} from './pedestrian-crowd.js';
import {AgentGrid} from './population.js';
import {BuildingIndex,pedestrianConflict,pedestrianVehicleConflict,crossingGapClear} from './collision.js';
import {pedestrianMayStart} from './traffic-signals.js';
import {pedestrianDetour} from './pedestrian-detour.js';
const source=fs.readFileSync(new URL('./main.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('  for(const w of walkers) {\n    if(!w.flyBrain)'),source.indexOf('  const nearbyPedestrians='));
const run=new Function('straightCrossing','continuingCrossing','THREE','crossingCrowds','AgentGrid','BuildingIndex','pedestrianConflict','pedestrianVehicleConflict','crossingGapClear','pedestrianMayStart','pedestrianDetour','count','blocked','chained','withBrain','PedestrianBrain',`
 const car={position:new THREE.Vector3(100,0,100)},ego={...car.position,heading:0};
 const crossing={node:{id:0},x:0,z:0,controlled:true};
 const walkers=Array.from({length:count},(_,i)=>({mesh:{position:new THREE.Vector3(-3,0,i*.52),rotation:{y:Math.PI/2}},walkSpeed:.35,walkIndex:0,walkSteps:[{point:{x:3,y:0,z:i*.52},crossing}],crossingActive:false,nextAttempt:0,obeysSignal:true,walkUpdated:46,walking:false,stuckTime:0,retryDetour:0,trips:0}));
 if(withBrain)walkers.forEach((w,i)=>w.flyBrain=new PedestrianBrain(i+1));
 if(chained)for(const w of walkers)w.walkSteps.unshift({point:{x:0,y:0,z:w.mesh.position.z},crossing});
 const trafficGrid=new AgentGrid(),walkerGrid=new AgentGrid(),pedestrianObstacleIndex=new BuildingIndex([]);
 if(blocked)trafficGrid.add({mesh:{position:new THREE.Vector3(0,.3,0),rotation:{y:0}},movingSpeed:0});
 walkers.forEach(w=>walkerGrid.add(w));
 const vehicleData=v=>({...v.mesh.position,heading:v.mesh.rotation.y,speed:v.movingSpeed});
 const pedestrianNetwork={plan:()=>null},rnd=()=>.37;
 let simTime=46,walkerTick=0,informalCrossings=0;
 function tick(dt){${code}}
 let firstStart=null,finished=null;
 for(let i=0;i<240;i++) {
   simTime+=.1;tick(.1);
   if(firstStart===null&&walkers.every(w=>w.crossingActive))firstStart=simTime-46;
   if(walkers.every(w=>w.mesh.position.x>2.5)){finished=simTime-46;break;}
   for(const w of walkers)assertOverlap(w);
 }
 function assertOverlap(w){if(pedestrianVehicleConflict(w.mesh.position,w.mesh.position,trafficGrid.near(w.mesh.position,4).map(vehicleData)))throw Error('pedestrian/car overlap');if(walkerGrid.near(w.mesh.position,.479).some(o=>o!==w))throw Error('crowd overlap');}
 return {firstStart,finished,moved:walkers.some(w=>w.mesh.position.x>-2.9)};
`);
const check=(n,blocked=false,chained=false,withBrain=false)=>run(straightCrossing,continuingCrossing,THREE,crossingCrowds,AgentGrid,BuildingIndex,pedestrianConflict,pedestrianVehicleConflict,crossingGapClear,pedestrianMayStart,pedestrianDetour,n,blocked,chained,withBrain,PedestrianBrain);
const group=check(3),individual=check(2),blocked=check(3,true);
assert.ok(group.firstStart<.2,'group starts together in one tick');
assert.ok(group.finished<individual.finished-2,'coordinated crowd clears at least two seconds sooner');
assert.ok(blocked.moved,'an admitted crowd can seek a path around a stopped car');
const chained=check(1,false,true);
assert.ok(chained.finished<24,'an admitted pedestrian must clear split links after the walk signal ends');
console.log({group,individual,blocked,chained});

const neural=check(3,true,false,true);assert.ok(neural.finished!==null,'pedestrian brains drive walkers around a stopped car');console.log({neural});

const single=check(1,true,false,true);
assert.ok(single.firstStart<=.11,'a single pedestrian starts promptly when admitted');
assert.ok(single.finished!==null,'a single pedestrian clears the crossing around a parked car');
console.log({single});
