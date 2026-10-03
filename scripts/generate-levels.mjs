import { writeFileSync, mkdirSync } from "node:fs";
import {
  seeded,
  positions,
  occupancy,
  bounds,
  encode,
  decode,
  solve,
  validBoard,
} from "../src/engine.js";
const random = seeded(20261001),
  pick = (n) => Math.floor(random() * n);
const seenLayouts = new Set(),
  levels = [];
const tutorial = [
  [
    { a: "h", f: 2, p: 0, n: 2 },
    { a: "v", f: 3, p: 1, n: 2 },
    { a: "h", f: 0, p: 0, n: 3 },
    { a: "h", f: 4, p: 0, n: 2 },
    { a: "v", f: 5, p: 3, n: 3 },
  ],
  [
    { a: "h", f: 2, p: 0, n: 2 },
    { a: "v", f: 2, p: 1, n: 3 },
    { a: "h", f: 4, p: 1, n: 2 },
    { a: "v", f: 4, p: 0, n: 2 },
    { a: "h", f: 5, p: 3, n: 3 },
  ],
];
for (const blocks of tutorial) {
  const solution = solve(blocks);
  if (solution) levels.push({ blocks, par: solution.length, solution });
}
// Enumerate a complete connected component, then multi-source BFS from ALL
// solved states. This yields exact shortest distances, not scramble lengths.
function makeLevel() {
  const blocks = [{ a: "h", f: 2, p: 4, n: 2 }];
  const target = 8 + pick(6);
  for (let tries = 0; tries < 160 && blocks.length < target; tries++) {
    const b = {
      a: random() < 0.5 ? "h" : "v",
      f: pick(6),
      n: random() < 0.24 ? 3 : 2,
    };
    b.p = pick(7 - b.n);
    if (b.a === "h" && b.f === 2) continue;
    const next = [...blocks, b];
    if (validBoard(next)) blocks.push(b);
  }
  if (blocks.length < 7) return;
  const signature = blocks
    .slice(1)
    .map((b) => `${b.a}${b.f}${b.n}`)
    .sort()
    .join("|");
  if (seenLayouts.has(signature)) return;
  const powers = blocks.map((_, i) => 6 ** i),
    keys = [encode(positions(blocks))],
    ids = new Map([[keys[0], 0]]),
    adj = [],
    goals = [];
  for (let head = 0; head < keys.length; head++) {
    if (keys.length > 24000) return;
    const state = decode(keys[head], blocks.length),
      grid = occupancy(blocks, state),
      edges = [];
    if (state[0] === 4) goals.push(head);
    for (let i = 0; i < blocks.length; i++) {
      const { min, max } = bounds(blocks, state, i, grid);
      for (let to = min; to <= max; to++) {
        if (to === state[i]) continue;
        const key = keys[head] + (to - state[i]) * powers[i];
        let id = ids.get(key);
        if (id === undefined) {
          id = keys.length;
          keys.push(key);
          ids.set(key, id);
        }
        edges.push(id);
      }
    }
    adj.push(edges);
  }
  const dist = new Int16Array(keys.length).fill(-1),
    queue = [...goals];
  for (const id of goals) dist[id] = 0;
  let best = 0;
  for (let head = 0; head < queue.length; head++)
    for (const next of adj[queue[head]])
      if (dist[next] < 0) {
        dist[next] = dist[queue[head]] + 1;
        queue.push(next);
        if (dist[next] > dist[best]) best = next;
      }
  const par = dist[best];
  if (par < 4) return;
  const state = decode(keys[best], blocks.length),
    result = blocks.map((b, i) => ({ ...b, p: state[i] }));
  const path = [];
  let current = best;
  while (dist[current] > 0) {
    const next = adj[current].find((id) => dist[id] === dist[current] - 1);
    const a = decode(keys[current], blocks.length),
      b = decode(keys[next], blocks.length),
      i = a.findIndex((p, j) => p !== b[j]);
    path.push({ i, to: b[i] });
    current = next;
  }
  seenLayouts.add(signature);
  return { blocks: result, par, solution: path };
}
let attempts = 0;
// Twelve onboarding puzzles; six moves at level 13, ten moves at level 55.
const capacities = [10, 20, 22, 88, 94, 96, 88],
  reserves = [50, 50, 50, 40, 20, 20, 10],
  buckets = capacities.map(() => []);
const bucket = (par) =>
  par <= 5
    ? 0
    : par <= 7
      ? 1
      : par <= 9
        ? 2
        : par <= 11
          ? 3
          : par <= 13
            ? 4
            : par <= 16
              ? 5
              : 6;
while (buckets.some((b, i) => b.length < capacities[i] + reserves[i])) {
  const level = makeLevel();
  attempts++;
  if (level) {
    const i = bucket(level.par);
    if (buckets[i].length < capacities[i] + reserves[i]) buckets[i].push(level);
  }
  if (attempts % 500 === 0)
    console.log(
      `${attempts} layouts · buckets ${buckets.map((b) => b.length).join("/")} · max ${Math.max(0, ...buckets.flat().map((l) => l.par))}`,
    );
  if (attempts > 50000) throw Error("Insufficient unique levels");
}
const campaign = [...levels],
  extra = [];
for (let i = 0; i < buckets.length; i++) {
  buckets[i].sort((a, b) => a.par - b.par);
  for (let j = 0; j < buckets[i].length; j++) {
    (Math.floor(((j + 1) * capacities[i]) / buckets[i].length) >
    Math.floor((j * capacities[i]) / buckets[i].length)
      ? campaign
      : extra
    ).push(buckets[i][j]);
  }
}
campaign.sort((a, b) => a.par - b.par);
const output = {
  version: 3,
  seed: 20261001,
  campaign: campaign.map((l, i) => ({ ...l, id: i + 1 })),
  extra: extra.map((l, i) => ({ ...l, id: 1001 + i })),
};
mkdirSync("src/data", { recursive: true });
writeFileSync("src/data/levels.json", JSON.stringify(output));
console.log(
  JSON.stringify({
    campaign: campaign.length,
    extra: extra.length,
    min: campaign[0].par,
    max: campaign.at(-1).par,
    histogram: campaign.reduce(
      (o, l) => ((o[l.par] = (o[l.par] || 0) + 1), o),
      {},
    ),
  }),
);
