// Nearby OSM signal/ junction nodes share one physical intersection controller.
export function buildJunctions(nodes, edges) {
  const groups = [],
    byNode = new Map();
  for (const n of nodes) {
    if (n.y !== 0 || !(n.signal || n.junction)) continue;
    let g = groups.find(
      (g) => Math.hypot(n.x - g.anchor.x, n.z - g.anchor.z) < 6,
    );
    if (!g) {
      g = { id: n.id, anchor: n, members: [], x: n.x, z: n.z, angle: 0 };
      groups.push(g);
    }
    g.members.push(n.id);
    byNode.set(n.id, g);
  }
  for (const g of groups) {
    g.x = g.members.reduce((s, id) => s + nodes[id].x, 0) / g.members.length;
    g.z = g.members.reduce((s, id) => s + nodes[id].z, 0) / g.members.length;
    const links = edges
      .filter(
        (e) =>
          e.type === "ground" &&
          (g.members.includes(e.a) || g.members.includes(e.b)),
      )
      .sort((a, b) => b.length - a.length);
    if (links[0]) {
      const a = nodes[links[0].a],
        b = nodes[links[0].b];
      g.angle = Math.atan2(b.x - a.x, b.z - a.z);
    }
  }
  return { groups, byNode };
}
// Two vehicle phases followed by a pedestrian batch and 24 seconds to clear.
// A 7.3-unit crossing takes up to 21 seconds at the slowest walking speed.
export const signalCycle=72;
export function phaseSeconds(controller, t) {
  return (((t + controller * 1.7) % signalCycle) + signalCycle) % signalCycle;
}
export function pedestrianMayStart(controller,t) {
  const p=phaseSeconds(controller,t);
  return p>=46 && p<48;
}
export function pedestrianPreparing(controller,t) {
  const p=phaseSeconds(controller,t);
  return p>=44 && p<48;
}
export function lightColor(controller, axis, t) {
  const p = phaseSeconds(controller, t);
  if (axis === 0) return p < 20 ? "green" : p < 22 ? "yellow" : "red";
  return p >= 24 && p < 44 ? "green" : p >= 44 && p < 46 ? "yellow" : "red";
}
export function approachAxis(angle, heading) {
  return Math.abs(Math.cos(heading - angle)) >=
    Math.abs(Math.sin(heading - angle))
    ? 0
    : 1;
}
export function signalFaces(junction) {
  return Array.from({ length: 4 }, (_, i) => ({
    heading: junction.angle + (i * Math.PI) / 2,
    axis: i % 2,
    controller: junction.id,
  }));
}
export function stopAllowance(length, progress, blocked, stopAt = length - Math.min(3, length * 0.5)) {
  const remaining = Math.max(0, length - progress);
  if (!blocked || progress > stopAt + 0.001) return remaining;
  const gap=stopAt-progress;
  return gap<1e-6?0:gap;
}

// Centre of car stops before the near edge of the crosswalk, with room
// for its 1.2-unit front half and a 0.5-unit gap. Conservative across approaches.
export function crosswalkStopPosition(a,b,crossing) {
  const length=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
  if(!crossing || !length)return Math.max(0,length-4.5);
  const fx=(b.x-a.x)/length,fz=(b.z-a.z)/length;
  const centre=(crossing.x-a.x)*fx+(crossing.z-a.z)*fz;
  const extent=3*Math.abs(crossing.dx*fx+crossing.dz*fz)+
    .75*Math.abs(-crossing.dz*fx+crossing.dx*fz);
  return Math.max(0,Math.min(length-4.5,centre-extent-1.2-.5));
}

export function junctionEntryAllowance(length,progress,red,stopAt,exitClear) {
  // Once committed, clear the junction even after the signal changes.
  return stopAllowance(length,progress,red || !exitClear,stopAt);
}

// Simulation seconds until this approach changes colour.
export function lightRemaining(controller,axis,t) {
  const p=phaseSeconds(controller,t);
  const boundaries=axis===0?[20,22,72]:[24,44,46,96];
  return boundaries.find(end=>end>p)-p;
}

// Clustered OSM nodes represent one physical intersection. Stop before its
// first conflict area, not only before the destination node of this link.
export function junctionStopPosition(a,b,crossing,junction,nodes) {
  let stop=crosswalkStopPosition(a,b,crossing);
  if(!junction)return stop;
  const dx=b.x-a.x,dz=b.z-a.z,flat=Math.hypot(dx,dz);
  if(!flat)return stop;
  for(const id of junction.members) {
    const p=nodes[id],along=((p.x-a.x)*dx+(p.z-a.z)*dz)/flat;
    const lateral=Math.abs((p.x-a.x)*dz-(p.z-a.z)*dx)/flat;
    if(along>=0 && lateral<=3)stop=Math.min(stop,Math.max(0,along-4.5));
  }
  return stop;
}
