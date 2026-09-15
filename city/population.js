// Dynamic spatial index: update a car immediately after moving so subsequent
// vehicles see its new position, including at cell boundaries.
export class AgentGrid {
  constructor(size = 12) { this.size = size; this.cells = new Map(); this.keys = new Map(); }
  key(p) { return `${Math.floor(p.x / this.size)}:${Math.floor(p.z / this.size)}`; }
  add(agent) {
    const key = this.key(agent.mesh.position), old = this.keys.get(agent);
    if (key === old) return;
    if (old !== undefined) this.cells.get(old).delete(agent);
    if (!this.cells.has(key)) this.cells.set(key, new Set());
    this.cells.get(key).add(agent); this.keys.set(agent, key);
  }
  clear() { this.cells.clear(); this.keys.clear(); }
  near(p, radius) {
    const result = [];
    for (let x = Math.floor((p.x-radius)/this.size); x <= Math.floor((p.x+radius)/this.size); x++)
      for (let z = Math.floor((p.z-radius)/this.size); z <= Math.floor((p.z+radius)/this.size); z++)
        for (const agent of this.cells.get(`${x}:${z}`) || []) {
          const q = agent.mesh.position;
          if (Math.abs(q.y-p.y) < 2 && Math.hypot(q.x-p.x,q.z-p.z) <= radius) result.push(agent);
        }
    return result;
  }
}
export function directedLanes(nodes, edges) {
  const lanes = [], outgoing = nodes.map(() => []);
  for (const edge of edges) {
    for (const [from,to] of edge.oneway ? [[edge.a,edge.b]] : [[edge.a,edge.b],[edge.b,edge.a]]) {
      const a=nodes[from], b=nodes[to];
      const length=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
      if (length < 0.01) continue;
      const lane={from,to,length,offset:edge.oneway?0:1,pitch:-Math.atan2(b.y-a.y,Math.hypot(b.x-a.x,b.z-a.z)),angle:Math.atan2(b.x-a.x,b.z-a.z)};
      lanes.push(lane); outgoing[from].push(lane);
    }
  }
  return {lanes,outgoing};
}
export function lanePoint(nodes,lane,t) {
  const a=nodes[lane.from],b=nodes[lane.to];
  return {x:a.x+(b.x-a.x)*t+Math.cos(lane.angle)*(lane.offset??1),
    y:a.y+(b.y-a.y)*t+.3,z:a.z+(b.z-a.z)*t-Math.sin(lane.angle)*(lane.offset??1)};
}
export function pedestrianSlots(crossings,count=20000) {
  return Array.from({length:count},(_,i)=> {
    const base=crossings[i%crossings.length], slot=Math.floor(i/crossings.length);
    // Separate walking strips and queue rows on both sidewalks.
    const strip=(Math.floor(slot/2)%5-2)*.48, row=Math.floor(slot/10);
    return {crossing:{...base,x:base.x-base.dz*strip,z:base.z+base.dx*strip},
      side:slot%2, reach:4+row*.65, slot};
  });
}
