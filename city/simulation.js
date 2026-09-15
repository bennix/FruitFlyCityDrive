import { clearRoadBuildings } from "./road-clearance.js";
import {
  buildJunctions,
  phaseSeconds,
  lightColor,
  approachAxis,
} from "./traffic-signals.js";
import mapData from "./data/shanghai.json" with { type: "json" };
export const nodes = mapData.nodes,
  edges = mapData.edges,
  buildingClearance = clearRoadBuildings(mapData.buildings, mapData.nodes, mapData.edges),
  buildings = buildingClearance.kept,
  mapMeta = mapData;
export const metresPerUnit = mapData.metresPerUnit;
export const junctions = buildJunctions(nodes, edges);
export function signalTime(node, t) {
  return phaseSeconds(junctions.byNode.get(node)?.id ?? node, t);
}
const adjacency = nodes.map(() => []);
for (const e of edges) {
  adjacency[e.a].push({ to: e.b, edge: e });
  if (!e.oneway) adjacency[e.b].push({ to: e.a, edge: e });
}
export function route(start, end) {
  const d = nodes.map(() => Infinity),
    prev = [];
  d[start] = 0;
  const open = new Set([start]),
    done = new Set();
  while (open.size) {
    const u = [...open].reduce((a, b) => (d[a] < d[b] ? a : b));
    open.delete(u);
    if (u === end) break;
    done.add(u);
    for (const { to: v, edge: e } of adjacency[u]) {
      if (done.has(v)) continue;
      const alt = d[u] + e.length * (e.type === "elevated" ? 0.8 : 1);
      if (alt < d[v]) {
        d[v] = alt;
        prev[v] = u;
        open.add(v);
      }
    }
  }
  if (!Number.isFinite(d[end])) return [];
  const path = [end];
  while (path[0] !== start) path.unshift(prev[path[0]]);
  return path;
}
export function signal(node, t) {
  const p = signalTime(node, t);
  return p < 22 ? "ns" : p < 24 ? "all" : p < 46 ? "ew" : "all";
}
export function redLight(a, b, t) {
  if (a.y !== 0 || b.y !== 0) return false;
  const g = junctions.byNode.get(b.id);
  if (g) {
    if (junctions.byNode.get(a.id) === g) return false;
    return (
      lightColor(
        g.id,
        approachAxis(g.angle, Math.atan2(b.x - a.x, b.z - a.z)),
        t,
      ) !== "green"
    );
  }
  return (
    !!b.signal &&
    lightColor(b.id, Math.abs(b.x - a.x) > Math.abs(b.z - a.z) ? 1 : 0, t) !==
      "green"
  );
}
export function motor(activity) {
  const r = (n) => activity[n]?.rate_hz || 0;
  return {
    drive: Math.min(1, (r("P9_oDN1_left") + r("P9_oDN1_right")) / 70),
    turn: Math.max(
      -1,
      Math.min(
        1,
        (r("DNa01_right") +
          r("DNa02_right") -
          r("DNa01_left") -
          r("DNa02_left")) /
          100,
      ),
    ),
  };
}
export function nearestRoad(p) {
  let best = Infinity;
  for (const e of edges) {
    const a = nodes[e.a],
      b = nodes[e.b],
      dx = b.x - a.x,
      dz = b.z - a.z;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)),
    );
    if (Math.abs(p.y - (a.y + (b.y - a.y) * t)) > 2) continue;
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t));
  }
  return best;
}
export function closestNode(x, z, groundOnly = false) {
  return nodes.reduce(
    (best, n) =>
      (!groundOnly || n.y === 0) &&
      Math.hypot(n.x - x, n.z - z) < Math.hypot(best.x - x, best.z - z)
        ? n
        : best,
    nodes.find((n) => !groundOnly || n.y === 0),
  ).id;
}
