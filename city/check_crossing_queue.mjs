import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {crossingCrowds,continuingCrossing,straightCrossing} from './pedestrian-crowd.js';
import {AgentGrid} from './population.js';
import {BuildingIndex,pedestrianConflict,pedestrianVehicleConflict,crossingGapClear} from './collision.js';
import {pedestrianMayStart} from './traffic-signals.js';
import {pedestrianDetour} from './pedestrian-detour.js';
const source=fs.readFileSync(new URL('./main.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('  const crowds=crossingCrowds'),source.indexOf('  const nearbyPedestrians='));
const run=new Function('straightCrossing','continuingCrossing','THREE','crossingCrowds','AgentGrid','BuildingIndex','pedestrianConflict','pedestrianVehicleConflict','crossingGapClear','pedestrianMayStart','pedestrianDetour','count','blocked','chained',`
 const car={position:new THREE.Vector3(100,0,100)},ego={...car.position,heading:0};
 const crossing={node:{id:0},x:0,z:0,controlled:true};
 const walkers=Array.from({length:count},(_,i)=>({mesh:{position:new THREE.Vector3(-3,0,i*.52),rotation:{y:Math.PI/2}},walkSpeed:.35,walkIndex:0,walkSteps:[{point:{x:3,y:0,z:i*.52},crossing}],crossingActive:false,nextAttempt:0,obeysSignal:true,walkUpdated:46,walking:false,stuckTime:0,retryDetour:0,trips:0}));
 if(chained)for(const w of walkers)w.walkSteps.unshift({point:{x:0,y:0,z:w.mesh.position.z},crossing});
 if(count>=90)walkers.forEach((w,i)=> {
   const side=i%2?1:-1,row=Math.floor(i/6),column=Math.floor(i/2)%3;
   w.mesh.position.set(side*(3+row*.6),0,(column-1)*.6);
   w.walkSteps=[...[side,0,-side,-side*3].map(x=>({point:{x,y:0,z:(column-1)*.6},crossing})),
     {point:{x:-side*25,y:0,z:(column-1)*.6},crossing:null}];
 });
 const trafficGrid=new AgentGrid(),walkerGrid=new AgentGrid(),pedestrianObstacleIndex=new BuildingIndex([]);
 if(blocked)trafficGrid.add({mesh:{position:new THREE.Vector3(0,.3,0),rotation:{y:0}},movingSpeed:0});
 walkers.forEach(w=>walkerGrid.add(w));
 const vehicleData=v=>({...v.mesh.position,heading:v.mesh.rotation.y,speed:v.movingSpeed});
 const pedestrianNetwork={plan:()=>null},rnd=()=>.37;
 let simTime=46,walkerTick=0,informalCrossings=0;
 function tick(dt){${code}}
 let firstStart=null,finished=null;
 for(let i=0;i<3000;i++) {
   simTime+=.1;tick(.1);
   if(firstStart===null&&walkers.every(w=>w.crossingActive))firstStart=simTime-46;
   if(finished===null&&walkers.every(w=>Math.abs(w.mesh.position.x)>20))finished=simTime-46;
   for(const w of walkers)assertOverlap(w);
 }
 function assertOverlap(w){if(walkerGrid.near(w.mesh.position,.479).some(o=>o!==w))throw Error('crowd overlap');}
 return {firstStart,finished,cleared:walkers.filter((w,i)=>w.mesh.position.x*(i%2?-1:1)>2.5).length,simulated:simTime-46};
`);
const check=(n,blocked=false,chained=false)=>run(straightCrossing,continuingCrossing,THREE,crossingCrowds,AgentGrid,BuildingIndex,pedestrianConflict,pedestrianVehicleConflict,crossingGapClear,pedestrianMayStart,pedestrianDetour,n,blocked,chained);
const queue=check(93);console.log(JSON.stringify(queue,null,2));assert.equal(queue.cleared,93,'All pedestrians must leave the crossing within 300 seconds');
