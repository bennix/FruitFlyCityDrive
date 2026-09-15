import { directedLanes, lanePoint } from './population.js';

// Plan over directed road lanes, including the swept connection at each turn.
// The same building clearance as the driving guard applies to the entire route.
export class ObstacleRouter {
  constructor(nodes, edges, obstacles) {
    this.nodes=nodes; this.obstacles=obstacles;
    const {lanes,outgoing}=directedLanes(nodes,edges);
    this.outgoing=outgoing;
    for (const [id,lane] of lanes.entries()) {
      lane.id=id; lane.start=lanePoint(nodes,lane,0); lane.end=lanePoint(nodes,lane,1);
      lane.clear=!obstacles.hits(lane.start,lane.end);
    }
    this.turns=new Map();
  }
  route(start,end,position=null,blocked=new Set()) {
    if(start===end) return {path:[start],length:0};
    const open=new Set(), costs=new Map(), previous=new Map();
    for(const lane of this.outgoing[start]) {
      if(!lane.clear||blocked.has(`${lane.from}:${lane.to}`))continue;
      if(position && (Math.hypot(position.x-lane.start.x,position.z-lane.start.z)>2.5 ||
        this.obstacles.hits(position,lane.start)))continue;
      open.add(lane);costs.set(lane,lane.length);
    }
    while(open.size) {
      let lane;
      for(const candidate of open) if(!lane||costs.get(candidate)<costs.get(lane))lane=candidate;
      open.delete(lane);
      if(lane.to===end) {
        const path=[lane.to]; let cursor=lane;
        while(cursor) {path.unshift(cursor.from);cursor=previous.get(cursor);}
        return {path,length:costs.get(lane)};
      }
      for(const next of this.outgoing[lane.to]) {
        if(!next.clear||blocked.has(`${next.from}:${next.to}`))continue;
        const key=`${lane.id}:${next.id}`;
        if(!this.turns.has(key))this.turns.set(key,!this.obstacles.hits(lane.end,next.start));
        if(!this.turns.get(key))continue;
        const cost=costs.get(lane)+next.length;
        if(cost >= (costs.get(next)??Infinity))continue;
        costs.set(next,cost);previous.set(next,lane);open.add(next);
      }
    }
    return null;
  }
}
