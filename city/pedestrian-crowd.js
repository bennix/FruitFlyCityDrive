// A small local crowd shares a crossing decision, not collision permission.
// Opposite banks and different physical crossings form separate groups.
export function crossingCrowds(walkers, mayStart, gapClear) {
  const groups=new Map(), membership=new Map();
  for(const w of walkers) {
    const step=w.walkSteps?.[w.walkIndex], c=step?.crossing;
    if(!c)continue;
    const p=w.mesh.position, target=step.point;
    if(Math.hypot(p.x-c.x,p.z-c.z)>6 || Math.hypot(p.x-target.x,p.z-target.z)<=.45)continue;
    const dx=target.x-c.x,dz=target.z-c.z;
    const direction=Math.abs(dx)>Math.abs(dz)?(dx>0?'east':'west'):(dz>0?'south':'north');
    const key=`${c.node.id}:${c.x.toFixed(1)}:${c.z.toFixed(1)}:${direction}`;
    if(!groups.has(key))groups.set(key,{crossing:c,members:[]});
    groups.get(key).members.push(w);
  }
  for(const group of groups.values()) {
    if(group.members.length<3)continue;
    group.speed=Math.min(.625,Math.max(.5625,group.members.reduce((s,w)=>s+w.walkSpeed,0)/group.members.length+.075));
    group.admit=mayStart(group.crossing)&&gapClear(group.crossing);
    for(const w of group.members)membership.set(w,group);
  }
  return membership;
}

// OSM splits a physical crossing into multiple links. Changing links must not
// make an already admitted pedestrian wait for a second green in the road.
export function continuingCrossing(w,crossing) {
  const permit=w.crossingPermit,p=w.mesh.position;
  if(w.walkSteps && !w.crossingActive) {
    const previous=w.walkSteps[w.walkIndex-1];
    if(previous && !previous.crossing)return false;
  }
  return !!permit && permit.node.id===crossing.node.id &&
    Math.hypot(p.x-permit.x,p.z-permit.z)<=8 &&
    Math.hypot(crossing.x-permit.x,crossing.z-permit.z)<=6;
}

export function straightCrossing(a,b,c) {
  const ux=b.x-a.x,uz=b.z-a.z,vx=c.x-b.x,vz=c.z-b.z;
  const lengths=Math.hypot(ux,uz)*Math.hypot(vx,vz);
  return lengths<1e-8 || (ux*vx+uz*vz>0 && Math.abs(ux*vz-uz*vx)<lengths*.15);
}
