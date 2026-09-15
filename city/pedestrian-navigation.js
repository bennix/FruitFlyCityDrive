import { roadWidth } from './road-clearance.js';

// Two sidewalks per ground road. At junctions, sidewalk connections are
// explicit crossing movements; every segment is checked against buildings.
export class PedestrianNetwork {
  constructor(nodes,edges,obstacles,junctions) {
    this.points=[];this.links=[];this.obstacles=obstacles;this.cache=new Map();
    const ends=new Map();
    const add=(p,node)=> {
      const id=this.points.length;this.points.push({...p,node});this.links.push([]);
      if(!ends.has(node))ends.set(node,[]);ends.get(node).push(id);return id;
    };
    const connect=(a,b,crossing,block)=> {
      if(obstacles.hits(this.points[a],this.points[b],.24))return;
      this.links[a].push({to:b,crossing,block});this.links[b].push({to:a,crossing,block});
    };
    for(const e of edges) {
      if(e.type!=='ground')continue;
      const a=nodes[e.a],b=nodes[e.b],length=Math.hypot(b.x-a.x,b.z-a.z);
      if(length<.1)continue;
      const dx=(b.z-a.z)/length,dz=-(b.x-a.x)/length;
      for(const side of [-1,1]) {
        const offset=(roadWidth(e)/2+.65)*side;
        const p={x:a.x+dx*offset,y:0,z:a.z+dz*offset},q={x:b.x+dx*offset,y:0,z:b.z+dz*offset};
        if(obstacles.hits(p,q,.24))continue;
        connect(add(p,e.a),add(q,e.b),null,1);
      }
    }
    for(const [node,ids] of ends) {
      const n=nodes[node],g=junctions.byNode.get(node);
      const crossing={node:{id:g?.id??node},x:n.x,z:n.z,controlled:!!g};
      for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++) {
        const a=this.points[ids[i]],b=this.points[ids[j]];
        const ax=a.x-n.x,az=a.z-n.z,bx=b.x-n.x,bz=b.z-n.z;
        const dot=(ax*bx+az*bz)/Math.max(.01,Math.hypot(ax,az)*Math.hypot(bx,bz));
        if(Math.hypot(a.x-b.x,a.z-b.z)<.5)connect(ids[i],ids[j],null,0);
        else if(dot>-.2) {
          // Walk around the outside corner, rather than cutting across the road
          // and unnecessarily waiting for the pedestrian crossing phase.
          const corner={x:n.x+ax+bx,y:0,z:n.z+az+bz,node};
          if(obstacles.hits(a,corner,.24)||obstacles.hits(corner,b,.24))continue;
          const id=this.points.length;this.points.push(corner);this.links.push([]);
          connect(ids[i],id,null,0);connect(id,ids[j],null,0);
        } else connect(ids[i],ids[j],crossing,0);
      }
    }
  }
  spawnCandidates(home) {
    const candidates=[];
    for(let id=0;id<this.points.length;id++) {
      const a=this.points[id];
      for(const link of this.links[id]) {
        if(link.crossing || link.to<id)continue;
        const b=this.points[link.to],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
        const t=Math.max(0,Math.min(1,((home.x-a.x)*dx+(home.z-a.z)*dz)/(length*length)));
        if(Math.hypot(a.x+dx*t-home.x,a.z+dz*t-home.z)>80)continue;
        for(let distance=.6;distance<length-.6;distance+=.65) {
          const point={x:a.x+dx*distance/length,y:0,z:a.z+dz*distance/length};
          const range=Math.hypot(point.x-home.x,point.z-home.z);
          if(range<=80)candidates.push({point,from:id,to:link.to,range});
        }
      }
    }
    return candidates.sort((a,b)=>a.range-b.range);
  }
  nearest(p) {
    let best=null,distance=Infinity;
    for(let i=0;i<this.points.length;i++) {
      if(!this.links[i].length)continue;
      const q=this.points[i],d=Math.hypot(q.x-p.x,q.z-p.z);
      if(d<distance && !this.obstacles.hits(p,q,.24)) {best=i;distance=d;}
    }
    return best;
  }
  plan(start,random=Math.random) {
    if(start===null)return null;
    if(!this.cache.has(start)) {
      const distance=new Map([[start,0]]),previous=new Map(),queue=[start];
      for(let i=0;i<queue.length;i++) {
        const at=queue[i],depth=distance.get(at);
        for(const link of this.links[at]) {
          const next=depth+link.block;
          if(next>6 || next >= (distance.get(link.to)??Infinity))continue;
          distance.set(link.to,next);previous.set(link.to,{from:at,link});queue.push(link.to);
        }
      }
      let candidates=[...distance].filter(([,d])=>d>=5&&d<=6).map(([id])=>id);
      if(!candidates.length)candidates=[...distance].filter(([,d])=>d>0).map(([id])=>id);
      this.cache.set(start,{candidates,previous,distance});
    }
    const {candidates,previous,distance}=this.cache.get(start);
    if(!candidates.length)return null;
    const destination=candidates[Math.floor(random()*candidates.length)],steps=[];
    let cursor=destination;
    while(cursor!==start) {const p=previous.get(cursor);steps.unshift({...p.link,point:this.points[cursor]});cursor=p.from;}
    return {destination,blocks:distance.get(destination),steps};
  }
}

export function pedestrianObstacles(buildings,nodes,edges,layout) {
  const result=[...buildings];
  const add=(x,z,r,height)=>result.push({points:[[x-r,z-r],[x+r,z-r],[x+r,z+r],[x-r,z+r]],height});
  for(const fixture of layout.placed) add(fixture.pole.x,fixture.pole.z,.12,fixture.poleTop.y);
  for(const e of edges) {
    const a=nodes[e.a],b=nodes[e.b];
    if(e.type!=='ground'&&Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)>5)
      add((a.x+b.x)/2,(a.z+b.z)/2,.5,(a.y+b.y)/2);
  }
  return result;
}
