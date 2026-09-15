// Bounded local A*: unlike forward-only steering, this can take a sideways
// or backward step around a stopped car, a pole, or a queue. Every edge is swept.
export function pedestrianDetour(start,target,clear) {
  const distance=Math.hypot(target.x-start.x,target.z-start.z);
  if(distance<.15)return [];
  const scale=Math.min(1,4/distance),goal={x:start.x+(target.x-start.x)*scale,y:0,z:start.z+(target.z-start.z)*scale};
  const first={x:start.x,y:0,z:start.z,ix:0,iz:0,g:0,parent:null};
  const open=[first],best=new Map([['0:0',0]]);
  let fallback=null;
  for(let iterations=0;open.length&&iterations<480;iterations++) {
    let index=0;
    const score=p=>p.g+Math.hypot(p.x-goal.x,p.z-goal.z);
    for(let i=1;i<open.length;i++)if(score(open[i])<score(open[index]))index=i;
    const current=open.splice(index,1)[0];
    const remaining=Math.hypot(current.x-goal.x,current.z-goal.z);
    if(current.parent && (!fallback||remaining<Math.hypot(fallback.x-goal.x,fallback.z-goal.z)))fallback=current;
    if(remaining<.7&&clear(current,goal)) {
      const path=[goal];let p=current;
      while(p.parent){path.unshift({x:p.x,y:0,z:p.z});p=p.parent;}return path;
    }
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const ix=current.ix+dx,iz=current.iz+dz;
      if(Math.abs(ix)>20||Math.abs(iz)>20)continue;
      const next={x:start.x+ix*.25,y:0,z:start.z+iz*.25,ix,iz,g:current.g+Math.hypot(dx,dz)*.25,parent:current};
      const key=`${ix}:${iz}`;
      if(next.g>=(best.get(key)??Infinity)||!clear(current,next))continue;
      best.set(key,next.g);open.push(next);
    }
  }
  if(!fallback || Math.hypot(fallback.x-goal.x,fallback.z-goal.z)>Math.hypot(start.x-goal.x,start.z-goal.z)-.5)return null;
  const path=[];for(let p=fallback;p.parent;p=p.parent)path.unshift({x:p.x,y:0,z:p.z});return path;
}
