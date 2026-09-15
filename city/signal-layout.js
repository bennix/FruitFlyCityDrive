import { roadWidth } from "./road-clearance.js";
import { signalFaces } from "./traffic-signals.js";
import { BuildingIndex } from "./collision.js";
function distanceToSegment(p, a, b) {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    l = dx * dx + dz * dz,
    t = l
      ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l))
      : 0;
  return {
    distance: Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz),
    y: a.y + t * (b.y - a.y),
  };
}
export function createSignalLayout(junctions, nodes, edges, buildings) {
  const obstacles = new BuildingIndex(buildings),
    elevated = edges.filter((e) => e.type !== "ground"),
    placed = [],
    missing = [];
  function clear(a, b, radius) {
    if (obstacles.hits(a, b, radius)) return false;
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.5),
    );
    for (let i = 0; i <= steps; i++) {
      const t = i / steps,
        p = {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          z: a.z + (b.z - a.z) * t,
        };
      for (const e of elevated) {
        const q = distanceToSegment(p, nodes[e.a], nodes[e.b]);
        if (q.distance < 3.2 + radius && Math.abs(p.y - q.y) < 0.4 + radius)
          return false;
      }
    }
    return true;
  }
  function candidate(g, face, along, lateral, height, side) {
    const f = { x: Math.sin(face.heading), z: Math.cos(face.heading) },
      r = { x: Math.cos(face.heading), z: -Math.sin(face.heading) };
    const scale = height === 1.8 ? 0.6 : 1;
    const centre = {
        x: g.x + f.x * along + r.x * lateral,
        y: height,
        z: g.z + f.z * along + r.z * lateral,
      },
      pole = { x: centre.x + r.x * side, y: 0, z: centre.z + r.z * side },
      top = { x: centre.x, y: height + 1.05 * scale, z: centre.z },
      poleTop = { ...pole, y: top.y };
    // Poles must stand outside every ground road, including cross streets.
    if(edges.some(e=>e.type==='ground' &&
      distanceToSegment(pole,nodes[e.a],nodes[e.b]).distance<roadWidth(e)/2+.12+.35))return null;
    const parts = [
      {
        a: { ...centre, y: height - 0.95 * scale },
        b: top,
        radius: 0.62 * scale,
      },
      { a: pole, b: poleTop, radius: 0.12 },
      { a: poleTop, b: top, radius: 0.12 },
    ];
    if (!parts.every((p) => clear(p.a, p.b, p.radius))) return null;
    // Keep fixtures from neighboring intersection controllers separated as well.
    for (const old of placed) {
      if (Math.hypot(old.centre.x - centre.x, old.centre.z - centre.z) > 10)
        continue;
      if (
        Math.hypot(old.centre.x - centre.x, old.centre.z - centre.z) < 1.3 &&
        Math.abs(old.centre.y - height) < 2.1
      )
        return null;
      for (const p of parts)
        for (const q of old.parts) {
          if (
            Math.max(p.a.y, p.b.y) + p.radius <
              Math.min(q.a.y, q.b.y) - q.radius ||
            Math.min(p.a.y, p.b.y) - p.radius >
              Math.max(q.a.y, q.b.y) + q.radius
          )
            continue;
          const count = Math.max(
            1,
            Math.ceil(Math.hypot(p.b.x - p.a.x, p.b.z - p.a.z) / 0.4),
          );
          for (let i = 0; i <= count; i++) {
            const t = i / count,
              v = {
                x: p.a.x + (p.b.x - p.a.x) * t,
                y: p.a.y + (p.b.y - p.a.y) * t,
                z: p.a.z + (p.b.z - p.a.z) * t,
              };
            const d = distanceToSegment(v, q.a, q.b);
            if (
              d.distance < p.radius + q.radius &&
              v.y >= Math.min(q.a.y, q.b.y) - p.radius - q.radius &&
              v.y <= Math.max(q.a.y, q.b.y) + p.radius + q.radius
            )
              return null;
          }
        }
    }
    return { ...face, scale, centre, pole, top, poleTop, parts };
  }
  for (const g of junctions)
    for (const face of signalFaces(g)) {
      let result = null;
      search: for (const along of [
        3, 4.5, 6, 1.5, -1.5, 8, -3, 10, -5, 12, 16, -8, 20, 24, -12, 28,
      ])
        for (const lateral of [
          0.7, -0.7, 0, 1.5, -1.5, 2.5, -2.5, 3.5, -3.5, 5, -5,
        ])
          for (const height of [3.6, 1.8, 4.8])
            for (const side of [4.5, -4.5, 6, -6, 8, -8, 10, -10, 12, -12]) {
              result = candidate(g, face, along, lateral, height, side);
              if (result) break search;
            }
      if (result) placed.push(result);
      else missing.push({ controller: g.id, heading: face.heading });
    }
  return { placed, missing };
}
