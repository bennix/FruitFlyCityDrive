import { writeFileSync } from "node:fs";
import { junctions, nodes, edges, buildings } from "./simulation.js";
import { createSignalLayout } from "./signal-layout.js";
const layout = createSignalLayout(junctions.groups, nodes, edges, buildings);
if (layout.missing.length)
  throw new Error(
    `No clear position for ${layout.missing.length} signal heads`,
  );
writeFileSync(
  new URL("./data/signal-layout.json", import.meta.url),
  JSON.stringify(layout),
);
console.log(
  `${junctions.groups.length} junctions / ${layout.placed.length} heads; all placements clear`,
);
