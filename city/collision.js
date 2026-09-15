import { pedestrianPreparing } from "./traffic-signals.js";
// Conservative swept car footprint against actual OSM building polygons.
function pointSegment(p, a, b) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    l = dx * dx + dz * dz;
  const t = l
    ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l))
    : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}
function orient(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function segmentDistance(a, b, c, d) {
  const o1 = orient(a, b, c),
    o2 = orient(a, b, d),
    o3 = orient(c, d, a),
    o4 = orient(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return 0;
  return Math.min(
    pointSegment(a, c, d),
    pointSegment(b, c, d),
    pointSegment(c, a, b),
    pointSegment(d, a, b),
  );
}
function inside(p, poly) {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      yes = !yes;
  }
  return yes;
}
export class BuildingIndex {
  constructor(buildings) {
    this.cells = new Map();
    for (const b of buildings) {
      const xs = b.points.map((p) => p[0]),
        zs = b.points.map((p) => p[1]);
      for (const key of this.keys(
        Math.min(...xs),
        Math.min(...zs),
        Math.max(...xs),
        Math.max(...zs),
      )) {
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push(b);
      }
    }
  }
  *keys(x1, z1, x2, z2) {
    for (let x = Math.floor(x1 / 32); x <= Math.floor(x2 / 32); x++)
      for (let z = Math.floor(z1 / 32); z <= Math.floor(z2 / 32); z++)
        yield `${x}:${z}`;
  }
  hits(from, to, radius = 1.3) {
    const candidates = new Set();
    for (const key of this.keys(
      Math.min(from.x, to.x) - radius,
      Math.min(from.z, to.z) - radius,
      Math.max(from.x, to.x) + radius,
      Math.max(from.z, to.z) + radius,
    ))
      for (const b of this.cells.get(key) || []) candidates.add(b);
    const a = [from.x, from.z],
      b = [to.x, to.z];
    for (const building of candidates) {
      if (Math.min(from.y, to.y) > building.height + 0.2) continue;
      const poly = building.points;
      if (inside(a, poly) || inside(b, poly)) return true;
      for (let i = 0; i < poly.length; i++)
        if (
          segmentDistance(a, b, poly[i], poly[(i + 1) % poly.length]) <= radius
        )
          return true;
    }
    return false;
  }
}

// Includes the whole travelled segment, so faster simulation cannot skip a person.
export function pedestrianConflict(from, to, people, radius = 1.6) {
  return people.some(
    (p) =>
      Math.min(from.y, to.y) <= p.y + 1.7 &&
      Math.max(from.y, to.y) >= p.y - 1.7 &&
      pointSegment([p.x, p.z], [from.x, from.z], [to.x, to.z]) <= radius,
  );
}
export function crossingNeedsYield(position, heading, crossing, phase, time) {
  if (Math.abs(position.y) > 1.7) return false;
  const dx = crossing.x - position.x,
    dz = crossing.z - position.z;
  const ahead = dx * Math.sin(heading) + dz * Math.cos(heading),
    side = Math.abs(dx * Math.cos(heading) - dz * Math.sin(heading));
  const crossingNow = phase > 0.01 && phase < 0.99;
  const preparing = pedestrianPreparing(crossing.node.id,time);
  return ahead > 0 && ahead < 10 && side < 4 && (crossingNow || preparing);
}

// Gap acceptance uses approaching speed, not just a snapshot of an empty crossing.
export function crossingGapClear(crossing, vehicles, opportunistic = false) {
  let nearby = 0;
  for (const v of vehicles) {
    if (Math.abs(v.y) > 1.7) continue;
    const dx = crossing.x - v.x,
      dz = crossing.z - v.z,
      dist = Math.hypot(dx, dz);
    if (dist < 25) nearby++;
    // Stopped cars are local obstacles: an admitted walker may route around
    // them. Informal crossings retain the stricter admission rule.
    if (dist < 1.9 && (opportunistic || v.speed > 0.05)) return false;
    const approach =
      (dx * Math.sin(v.heading) + dz * Math.cos(v.heading)) /
      Math.max(0.01, dist);
    if (v.speed > 0.05 && approach > 0.25 && dist < 5 + v.speed * (opportunistic ? 4 : 2.5))
      return false;
  }
  return !opportunistic || nearby <= 1;
}

function carCorners(p, yaw) {
  const right = [Math.cos(yaw) * 0.63, -Math.sin(yaw) * 0.63],
    front = [Math.sin(yaw) * 1.2, Math.cos(yaw) * 1.2];
  return [-1, 1].flatMap((a) =>
    [-1, 1].map((b) => [
      p.x + a * right[0] + b * front[0],
      p.z + a * right[1] + b * front[1],
    ]),
  );
}
function convexHull(points) {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower = [],
    upper = [];
  for (const p of sorted) {
    while (lower.length >= 2 && orient(lower.at(-2), lower.at(-1), p) <= 0)
      lower.pop();
    lower.push(p);
  }
  for (const p of sorted.reverse()) {
    while (upper.length >= 2 && orient(upper.at(-2), upper.at(-1), p) <= 0)
      upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
function polygonsOverlap(a, b) {
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i],
        q = poly[(i + 1) % poly.length],
        axis = [q[1] - p[1], p[0] - q[0]];
      const pa = a.map((v) => v[0] * axis[0] + v[1] * axis[1]),
        pb = b.map((v) => v[0] * axis[0] + v[1] * axis[1]);
      if (
        Math.max(...pa) < Math.min(...pb) ||
        Math.max(...pb) < Math.min(...pa)
      )
        return false;
    }
  return true;
}
export function vehicleConflict(from, to, oldHeading, newHeading, vehicles) {
  // Straight motion has an exact rectangular swept footprint. Project its
  // four separating axes directly, avoiding convex-hull allocations per car.
  const fx = Math.sin(oldHeading), fz = Math.cos(oldHeading),
    rx = fz, rz = -fx, dx = to.x-from.x, dz = to.z-from.z;
  if (Math.abs(oldHeading-newHeading)<1e-9 && Math.abs(dx*rx+dz*rz)<1e-8) {
    const cx=(from.x+to.x)/2, cz=(from.z+to.z)/2,
      halfLength=1.2+Math.abs(dx*fx+dz*fz)/2;
    for (const v of vehicles) {
      if (v.y < Math.min(from.y,to.y)-1.5 || v.y > Math.max(from.y,to.y)+1.5) continue;
      const vx=v.x-cx, vz=v.z-cz,
        ofx=Math.sin(v.heading), ofz=Math.cos(v.heading), orx=ofz, orz=-ofx;
      const c=Math.abs(fx*ofx+fz*ofz), d=Math.abs(fx*orx+fz*orz);
      if (Math.abs(vx*fx+vz*fz)>halfLength+1.2*c+.63*d ||
          Math.abs(vx*rx+vz*rz)>.63+1.2*d+.63*c ||
          Math.abs(vx*ofx+vz*ofz)>1.2+halfLength*c+.63*d ||
          Math.abs(vx*orx+vz*orz)>.63+halfLength*d+.63*c) continue;
      return true;
    }
    return false;
  }
  const swept = convexHull([
    ...carCorners(from, oldHeading),
    ...carCorners(to, newHeading),
  ]);
  for (const v of vehicles) {
    if (
      v.y < Math.min(from.y, to.y) - 1.5 ||
      v.y > Math.max(from.y, to.y) + 1.5
    )
      continue;
    if (polygonsOverlap(swept, convexHull(carCorners(v, v.heading))))
      return true;
  }
  return false;
}

// Swept car footprint plus the pedestrian's body radius, rather than a large
// circle around the car that incorrectly includes adjacent sidewalk space.
export function vehiclePedestrianConflict(from,to,oldHeading,newHeading,people,radius=.24) {
  const fx=Math.sin(oldHeading),fz=Math.cos(oldHeading);
  const dx=to.x-from.x,dz=to.z-from.z;
  const straight=Math.abs(oldHeading-newHeading)<1e-9 && Math.abs(dx*fz-dz*fx)<1e-8;
  const hull=straight?null:convexHull([...carCorners(from,oldHeading),...carCorners(to,newHeading)]);
  return people.some(p=> {
    if(p.y<Math.min(from.y,to.y)-1.7||p.y>Math.max(from.y,to.y)+1.7)return false;
    if(straight) {
      const x=p.x-(from.x+to.x)/2,z=p.z-(from.z+to.z)/2;
      const side=Math.max(0,Math.abs(x*fz-z*fx)-.63);
      const ahead=Math.max(0,Math.abs(x*fx+z*fz)-1.2-Math.abs(dx*fx+dz*fz)/2);
      return Math.hypot(side,ahead)<=radius;
    }
    const point=[p.x,p.z];
    return inside(point,hull)||hull.some((a,i)=>pointSegment(point,a,hull[(i+1)%hull.length])<=radius);
  });
}

export function pedestrianVehicleConflict(from,to,vehicles) {
  // Relative motion: translate each stationary car opposite to the walking step.
  return vehicles.some(v=>vehiclePedestrianConflict(v,
    {x:v.x-(to.x-from.x),y:v.y-(to.y-from.y),z:v.z-(to.z-from.z)},
    v.heading,v.heading,[from]));
}
