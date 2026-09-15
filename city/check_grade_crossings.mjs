import fs from 'node:fs';
import map from './data/shanghai.json' with {type:'json'};
import raw from './data/shanghai-api.json' with {type:'json'};
const ways=new Map(raw.elements.filter(e=>e.type==='way').map(e=>[String(e.id),e.tags||{}]));
const cross=(a,b)=>a.x*b.z-a.z*b.x;
const conflicts=[];
for(let i=0;i<map.edges.length;i++)for(let j=i+1;j<map.edges.length;j++){
 const e=map.edges[i],f=map.edges[j];if([e.a,e.b].some(id=>id===f.a||id===f.b))continue;
 const et=ways.get(e.osm_id)||{},ft=ways.get(f.osm_id)||{};
 if(e.type==='ground'&&f.type==='ground'&&!et.bridge&&!ft.bridge&&!et.layer&&!ft.layer)continue;
 const a=map.nodes[e.a],b=map.nodes[e.b],c=map.nodes[f.a],d=map.nodes[f.b];
 const v={x:b.x-a.x,z:b.z-a.z},w={x:d.x-c.x,z:d.z-c.z},q={x:c.x-a.x,z:c.z-a.z};
 const determinant=cross(v,w);if(Math.abs(determinant)<1e-8)continue;
 const t=cross(q,w)/determinant,u=cross(q,v)/determinant;
 if(t<=.001||t>=.999||u<=.001||u>=.999)continue;
 const y=a.y+(b.y-a.y)*t,z=c.y+(d.y-c.y)*u,gap=Math.abs(y-z);
 if(gap>=1.7)continue;
 conflicts.push({edges:[i,j],point:{x:a.x+v.x*t,z:a.z+v.z*t},gap,roads:[e,f].map((edge,k)=>({nodes:[edge.a,edge.b],name:edge.name,way:edge.osm_id,type:edge.type,bridge:[et,ft][k].bridge,layer:[et,ft][k].layer,height:k?z:y}))});
}
const liftedRoads=map.edges.filter(e=>{
 const tags=ways.get(e.osm_id)||{};
 return e.type!=='ground'&&!tags.bridge&&(tags.layer||'0')==='0'&&!e.highway.endsWith('_link');
}).map(e=>({nodes:[e.a,e.b],name:e.name,way:e.osm_id,heights:[map.nodes[e.a].y,map.nodes[e.b].y]}));
const report={liftedRoadCount:liftedRoads.length,liftedRoads,method:'Unconnected road centreline intersections with bridge/layer metadata and less than 1.7 visual units of vertical clearance; geometric candidates, not confirmed real-world errors.',count:conflicts.length,conflicts};
fs.writeFileSync('artifacts/city/grade-crossings.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
