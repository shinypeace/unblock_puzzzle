import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  solve,
  move,
  positions,
  validBoard,
  solved,
  bounds,
  starRating,
} from "../src/engine.js";
const data = JSON.parse(readFileSync("src/data/levels.json", "utf8"));
test("420 campaign + 240 bonus boards: valid, unique, legal solutions, optimal par", () => {
  assert.equal(data.campaign.length, 420);
  assert.equal(data.extra.length, 240);
  const signatures = new Set();
  for (const level of [...data.campaign, ...data.extra]) {
    assert.ok(validBoard(level.blocks), `valid ${level.id}`);
    const signature = level.blocks
      .map((b) => `${b.a}${b.f}${b.p}${b.n}`)
      .sort()
      .join("|");
    assert.ok(!signatures.has(signature), `unique ${level.id}`);
    signatures.add(signature);
    let state = positions(level.blocks);
    assert.ok(!solved(state));
    for (const step of level.solution) {
      state = move(level.blocks, state, step.i, step.to);
      assert.ok(state, `legal step ${level.id}`);
      assert.ok(validBoard(level.blocks, state));
    }
    assert.ok(solved(state), `solved ${level.id}`);
    assert.equal(level.par, level.solution.length);
    const optimal = solve(level.blocks);
    assert.ok(optimal, `solvable ${level.id}`);
    assert.equal(optimal.length, level.par, `optimal ${level.id}`);
  }
});
test("campaign gets harder across seven chapters", () => {
  assert.equal(data.campaign[12].par, 6);
  assert.equal(data.campaign.find((level) => level.par >= 10).id, 55);
  assert.equal(data.campaign[54].par, 10);
  assert.equal(data.campaign.filter((l) => l.par < 6).length, 12);
  for (let i = 1; i < data.campaign.length; i++)
    assert.ok(data.campaign[i].par >= data.campaign[i - 1].par);
  const means = [];
  for (let i = 0; i < 7; i++) {
    const levels = data.campaign.slice(i * 60, i * 60 + 60);
    means.push(levels.reduce((n, l) => n + l.par, 0) / 60);
  }
  for (let i = 1; i < 7; i++) assert.ok(means[i] > means[i - 1]);
  assert.ok(data.campaign.at(-1).par >= 24);
});
test("movement rejects overlap, fractional steps, invalid indexes and bounds", () => {
  const l = data.campaign[0],
    p = positions(l.blocks);
  assert.equal(move(l.blocks, p, 0, -1), null);
  assert.equal(move(l.blocks, p, 0, 5), null);
  assert.equal(move(l.blocks, p, 0, 0.5), null);
  assert.equal(move(l.blocks, p, 99, 0), null);
  assert.equal(move(l.blocks, p, 0, p[0]), null);
  for (let i = 0; i < l.blocks.length; i++) {
    const b = bounds(l.blocks, p, i);
    if (b.min > 0) assert.equal(move(l.blocks, p, i, b.min - 1), null);
    if (b.max < 6 - l.blocks[i].n)
      assert.equal(move(l.blocks, p, i, b.max + 1), null);
  }
});
test("rating respects par and assistance", () => {
  assert.equal(starRating(10, 10), 3);
  assert.equal(starRating(13, 10), 2);
  assert.equal(starRating(14, 10), 1);
  assert.equal(starRating(10, 10, 1), 2);
  assert.equal(starRating(50, 10, 20), 1);
});
test("three stars allow a small margin only on longer puzzles", () => {
  for (const [par, limit, nextRating] of [
    [2, 2, 2],
    [9, 9, 2],
    [10, 10, 2],
    [11, 14, 2],
    [15, 18, 2],
    [16, 22, 1],
    [20, 26, 1],
    [29, 35, 2],
  ]) {
    assert.equal(starRating(limit, par), 3, `par ${par}, ${limit} moves`);
    assert.equal(
      starRating(limit + 1, par),
      nextRating,
      `par ${par}: margin stops at ${limit}`,
    );
    assert.equal(
      starRating(limit, par, 1),
      2,
      `par ${par}: hints still cap the rating`,
    );
    const twoStarLimit = par + Math.max(3, Math.ceil(par * 0.3));
    assert.equal(starRating(twoStarLimit, par), twoStarLimit <= limit ? 3 : 2);
    assert.equal(starRating(Math.max(limit, twoStarLimit) + 1, par), 1);
  }
});
