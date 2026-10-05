/** One move is one uninterrupted slide, irrespective of distance. */
export const SIZE = 6;
export function positions(blocks) {
  return blocks.map((b) => b.p);
}
export function occupancy(blocks, state) {
  const grid = new Int8Array(36).fill(-1);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    for (let k = 0; k < b.n; k++)
      grid[b.a === "h" ? b.f * 6 + state[i] + k : (state[i] + k) * 6 + b.f] = i;
  }
  return grid;
}
export function bounds(blocks, state, index, grid = occupancy(blocks, state)) {
  const b = blocks[index],
    p = state[index];
  let min = p,
    max = p;
  const cell = (v) => (b.a === "h" ? b.f * 6 + v : v * 6 + b.f);
  while (min > 0 && grid[cell(min - 1)] < 0) min--;
  while (max + b.n < 6 && grid[cell(max + b.n)] < 0) max++;
  return { min, max };
}
export function move(blocks, state, index, destination) {
  if (
    !Number.isInteger(index) ||
    !blocks[index] ||
    !Number.isInteger(destination)
  )
    return null;
  const { min, max } = bounds(blocks, state, index);
  if (destination < min || destination > max || destination === state[index])
    return null;
  const next = [...state];
  next[index] = destination;
  return next;
}
export const solved = (state) => state[0] === 4;
export function validBoard(blocks, state = positions(blocks)) {
  if (
    !Array.isArray(blocks) ||
    !Array.isArray(state) ||
    !blocks.length ||
    blocks.length !== state.length ||
    blocks.length > 16
  )
    return false;
  if (blocks[0].a !== "h" || blocks[0].f !== 2 || blocks[0].n !== 2)
    return false;
  const cells = new Set();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (
      !["h", "v"].includes(b.a) ||
      ![2, 3].includes(b.n) ||
      !Number.isInteger(b.f) ||
      b.f < 0 ||
      b.f > 5 ||
      !Number.isInteger(state[i]) ||
      state[i] < 0 ||
      state[i] + b.n > 6
    )
      return false;
    for (let k = 0; k < b.n; k++) {
      const c = b.a === "h" ? b.f * 6 + state[i] + k : (state[i] + k) * 6 + b.f;
      if (cells.has(c)) return false;
      cells.add(c);
    }
  }
  return true;
}
export function encode(state) {
  let key = 0,
    scale = 1;
  for (const p of state) {
    key += p * scale;
    scale *= 6;
  }
  return key;
}
export function decode(key, length) {
  const p = [];
  for (let i = 0; i < length; i++) {
    p.push(key % 6);
    key = Math.floor(key / 6);
  }
  return p;
}
export function solve(blocks, initial = positions(blocks), limit = 250000) {
  if (!validBoard(blocks, initial)) return null;
  if (solved(initial)) return [];
  const powers = blocks.map((_, i) => 6 ** i);
  const keys = [encode(initial)],
    parents = [-1],
    moves = [null],
    seen = new Set(keys);
  for (let head = 0; head < keys.length && head < limit; head++) {
    const state = decode(keys[head], blocks.length),
      grid = occupancy(blocks, state);
    for (let i = 0; i < blocks.length; i++) {
      const { min, max } = bounds(blocks, state, i, grid);
      for (let to = min; to <= max; to++) {
        if (to === state[i]) continue;
        const key = keys[head] + (to - state[i]) * powers[i];
        if (seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
        parents.push(head);
        moves.push({ i, to });
        if (i === 0 && to === 4) {
          const path = [];
          let at = keys.length - 1;
          while (parents[at] !== -1) {
            path.push(moves[at]);
            at = parents[at];
          }
          return path.reverse();
        }
      }
    }
  }
  return null;
}
export function seeded(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash(text) {
  let h = 2166136261;
  for (const c of text) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export const threeStarLimit = (par) =>
  par + (par <= 10 ? 0 : par <= 15 ? 3 : 6);
export const starRating = (moves, par, hints = 0) =>
  Math.max(
    1,
    (moves <= threeStarLimit(par)
      ? 3
      : moves <= par + Math.max(3, Math.ceil(par * 0.3))
        ? 2
        : 1) - (hints > 0 ? 1 : 0),
  );
