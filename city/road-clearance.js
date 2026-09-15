// Shared by the road renderer and building sanitation (visual units).
export function roadWidth(edge) {
  return edge.highway.includes('link') ? 3.5 : edge.highway === 'residential' ? 4 : 6;
}
function pointDistance(p,a,b) {
  const dx=b.x-a.x,dz=b.z-a.z, length=dx*dx+dz*dz;
  const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/length)):0;
  return Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t);
}
function side(a,b,p) { return (b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x); }
function distance(a,b,c,d) {
  if(side(a,b,c)*side(a,b,d)<0 && side(c,d,a)*side(c,d,b)<0)return 0;
  return Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b));
}
function inside(p,poly) {
  let yes=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const a=poly[i],b=poly[j];
    if((a.z>p.z)!==(b.z>p.z) && p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)yes=!yes;
  }
  return yes;
}
export function clearRoadBuildings(buildings,nodes,edges) {
  const roads=edges.map(e=> {
    const a=nodes[e.a],b=nodes[e.b],radius=roadWidth(e)/2+.3;
    return {a,b,radius,minX:Math.min(a.x,b.x)-radius,maxX:Math.max(a.x,b.x)+radius,
      minZ:Math.min(a.z,b.z)-radius,maxZ:Math.max(a.z,b.z)+radius,
      bottom:Math.min(a.y,b.y)-.125};
  });
  const kept=[],removed=[];
  for(const building of buildings) {
    const poly=building.points.map(([x,z])=>({x,z}));
    const minX=Math.min(...poly.map(p=>p.x)),maxX=Math.max(...poly.map(p=>p.x)),
      minZ=Math.min(...poly.map(p=>p.z)),maxZ=Math.max(...poly.map(p=>p.z));
    const conflict=roads.some(r=> {
      if(building.height<r.bottom-.3 || maxX<r.minX||minX>r.maxX||maxZ<r.minZ||minZ>r.maxZ)return false;
      if(inside(r.a,poly)||inside(r.b,poly))return true;
      return poly.some((p,i)=>distance(r.a,r.b,p,poly[(i+1)%poly.length])<=r.radius);
    });
    (conflict?removed:kept).push(building);
  }
  return {kept,removed};
}
