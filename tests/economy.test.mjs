import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  freshSave,
  validateSave,
  saveData,
  loadSave,
  SAVE_KEY,
  completeCampaign,
  buy,
  claimDaily,
  dailyLevels,
  claimAchievement,
  previousDay,
  achievements,
  offers,
} from "../src/store.js";
const data = JSON.parse(readFileSync("src/data/levels.json", "utf8"));
test("first win, replay and improved stars do not duplicate rewards", () => {
  const s = freshSave(),
    l = data.campaign[0];
  assert.equal(completeCampaign(s, l, 100, 0).reward, 28);
  assert.equal(completeCampaign(s, l, 100, 0).reward, 0);
  assert.equal(completeCampaign(s, l, l.par, 0).reward, 16);
  assert.equal(completeCampaign(s, l, l.par, 0).reward, 0);
  assert.equal(s.coins, 194);
  assert.equal(s.stats.perfect, 1);
});
test("purchases are atomic and owned themes cannot be charged twice", () => {
  const s = freshSave();
  assert.equal(buy(s, "orbit"), false);
  assert.equal(s.coins, 150);
  assert.equal(buy(s, "hint"), false);
  s.coins = 360;
  assert.equal(buy(s, "hint"), true);
  assert.equal(s.hints, 6);
  assert.equal(s.coins, 60);
  assert.equal(buy(s, "hint"), false);
  s.coins = 6200;
  assert.equal(buy(s, "grove"), true);
  assert.equal(s.coins, 600);
  assert.equal(buy(s, "grove"), false);
  assert.equal(s.coins, 600);
  assert.equal(buy(s, "bogus"), false);
});
test("daily rewards require all puzzles, pay once, increment/reset streak", () => {
  const s = freshSave();
  s.daily["2026-10-01"] = { done: [0, 1], claimed: false };
  assert.equal(claimDaily(s, "2026-10-01"), 0);
  s.daily["2026-10-01"].done.push(2);
  assert.equal(claimDaily(s, "2026-10-01"), 100);
  assert.equal(claimDaily(s, "2026-10-01"), 0);
  s.daily["2026-10-02"] = { done: [0, 1, 2], claimed: false };
  assert.equal(claimDaily(s, "2026-10-02"), 110);
  assert.equal(s.streak, 2);
  s.daily["2026-10-04"] = { done: [0, 1, 2], claimed: false };
  assert.equal(claimDaily(s, "2026-10-04"), 100);
  assert.equal(s.streak, 1);
  assert.equal(previousDay("2026-03-01"), "2026-02-28");
});
test("deterministic daily selection provides three distinct puzzles", () => {
  for (let day = 1; day <= 28; day++) {
    const date = `2026-10-${String(day).padStart(2, "0")}`,
      a = dailyLevels(data.extra, date),
      b = dailyLevels(data.extra, date);
    assert.deepEqual(a, b);
    assert.equal(new Set(a.map((l) => l.id)).size, 3);
    assert.ok(a[0].par <= 8);
    assert.ok(a[2].par > 13);
  }
});
test("achievements pay once and cannot be claimed before unlock", () => {
  const s = freshSave();
  assert.equal(claimAchievement(s, "first"), 0);
  completeCampaign(s, data.campaign[0], 2, 0);
  assert.equal(claimAchievement(s, "first"), 40);
  assert.equal(s.undos, 7);
  assert.equal(claimAchievement(s, "first"), 0);
});
test("save validation and corrupted-storage recovery", () => {
  const s = freshSave();
  assert.ok(validateSave(s));
  for (const change of [
    { coins: -1 },
    { undos: -1 },
    { undos: 1.5 },
    { owned: ["invalid"] },
    { completed: { 1: { moves: -1, stars: 3 } } },
    { daily: { x: { done: [], claimed: false } } },
    { settings: {} },
    { version: 2 },
  ])
    assert.equal(validateSave({ ...s, ...change }), false);
  const storage = new Map();
  const adapter = {
    getItem: (k) => storage.get(k),
    setItem: (k, v) => storage.set(k, v),
  };
  assert.ok(saveData(s, adapter));
  assert.deepEqual(loadSave(adapter), s);
  storage.set(SAVE_KEY, "bad json");
  assert.ok(validateSave(loadSave(adapter)));
  storage.set(SAVE_KEY, JSON.stringify({ version: 1 }));
  assert.ok(validateSave(loadSave(adapter)));
  assert.equal(
    storage.get(SAVE_KEY + ".damaged"),
    JSON.stringify({ version: 1 }),
  );
});

test("legacy helper refund preserves purchases and happens only once", () => {
  const old = {
    ...freshSave(),
    auto: 3,
    freeze: 2,
    owned: ["studio", "grove"],
    theme: "grove",
    completed: { 1: { stars: 3, moves: 2 } },
  };
  delete old.economy;
  let raw = JSON.stringify(old);
  const storage = {
    getItem: () => raw,
    setItem: (_, v) => {
      raw = v;
    },
  };
  const migrated = loadSave(storage);
  assert.equal(migrated.coins, 310);
  assert.equal(migrated.auto, 0);
  assert.equal(migrated.freeze, 0);
  assert.deepEqual(migrated.owned, old.owned);
  assert.deepEqual(migrated.completed, old.completed);
  assert.deepEqual(loadSave(storage), migrated);
  assert.equal(buy(migrated, "auto"), false);
  assert.equal(buy(migrated, "freeze"), false);
});

test("fifty perfect campaign levels cannot buy the entire theme collection", () => {
  const s = freshSave();
  for (const l of data.campaign.slice(0, 50)) completeCampaign(s, l, l.par, 0);
  for (const id of ["first", "ten", "perfect"]) claimAchievement(s, id);
  for (const a of achievements) claimAchievement(s, a.id);
  assert.ok(buy(s, "timber"));
  assert.equal(buy(s, "grove"), false);
  for (const id of ["tide", "ink", "orbit"]) assert.equal(buy(s, id), false);
  assert.equal(s.owned.length, 2);
});

test("version two receives starter undos once without changing balances or progress", () => {
  const old = {
    ...freshSave(),
    economy: 2,
    coins: 4321,
    hints: 17,
    theme: "orbit",
    owned: ["studio", "orbit"],
    completed: { 1: { stars: 3, moves: 2 } },
  };
  delete old.undos;
  let raw = JSON.stringify(old);
  const storage = {
    getItem: () => raw,
    setItem: (_, value) => {
      raw = value;
    },
  };
  const s = loadSave(storage);
  assert.equal(s.undos, 5);
  assert.equal(s.coins, 4321);
  assert.equal(s.hints, 17);
  assert.deepEqual(s.completed, old.completed);
  s.undos = 0;
  saveData(s, storage);
  assert.equal(loadSave(storage).undos, 0);
});

test("undo packs charge exactly once; mixed achievement rewards cannot be farmed", () => {
  const s = freshSave();
  s.coins = offers.undo.price;
  assert.equal(buy(s, "undo"), true);
  assert.equal(s.coins, 0);
  assert.equal(s.undos, 10);
  assert.equal(buy(s, "undo"), false);
  s.undos = 9998;
  s.coins = 500;
  assert.equal(buy(s, "undo"), false);
  assert.equal(s.coins, 500);
  s.streak = 7;
  claimAchievement(s, "week");
  assert.equal(s.undos, 9999);
  assert.equal(s.hints, 5);
  const snapshot = structuredClone(s);
  assert.equal(claimAchievement(s, "week"), 0);
  assert.deepEqual(s, snapshot);
});
