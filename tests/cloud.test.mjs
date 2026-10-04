import test from "node:test";
import assert from "node:assert/strict";
import {
  freshSave,
  completeCampaign,
  claimAchievement,
  buy,
  SAVE_KEY,
  validateSave,
} from "../src/store.js";
import {
  newReplica,
  captureReplica,
  projectReplicas,
  CloudSync,
  accountSave,
} from "../src/cloud.js";

const A = "a".repeat(24),
  B = "b".repeat(24),
  C = "c".repeat(24);
const copy = (v) => structuredClone(v);
const mem = () => {
  const data = new Map();
  return {
    getItem: (k) => data.get(k) || null,
    setItem: (k, v) => data.set(k, v),
    data,
  };
};
function change(r, base, fn) {
  const next = copy(base);
  fn(next);
  return captureReplica(r, base, next, 1000);
}
const win = (s, id = 1) => completeCampaign(s, { id, par: 6 }, 6, 0);

test("two devices merge levels, purchases and records, not duplicate rewards", () => {
  const initial = { ...freshSave(), coins: 6000 };
  const seed = newReplica(initial, A),
    empty = newReplica(freshSave(), B);
  const base = projectReplicas({ [A]: seed, [B]: empty });
  const a = change(seed, base, (s) => {
    win(s);
    claimAchievement(s, "first");
    buy(s, "timber");
    s.stats.moves += 6;
  });
  const b = change(empty, base, (s) => {
    win(s);
    win(s, 2);
    claimAchievement(s, "first");
    buy(s, "timber");
    s.stats.moves += 12;
    s.sprintBest = 7;
  });
  const merged = projectReplicas({ [A]: a, [B]: b });
  assert.equal(merged.coins, 6000 + 88 + 40 - 2600);
  assert.equal(merged.undos, 7);
  assert.equal(merged.stats.moves, 18);
  assert.equal(merged.stats.perfect, 2);
  assert.equal(merged.sprintBest, 7);
  assert.deepEqual(merged.owned, ["studio", "timber"]);
  assert.equal(merged.theme, "timber");
  assert.ok(validateSave(merged));
  assert.deepEqual(projectReplicas({ [B]: b, [A]: a }, merged), merged);
});
test("spent helpers and coins never return on stale or fresh-device imports", () => {
  const initial = { ...freshSave(), coins: 1000 };
  let a = newReplica(initial, A),
    b = newReplica(freshSave(), B);
  let base = projectReplicas({ [A]: a, [B]: b });
  a = change(a, base, (s) => {
    buy(s, "hint");
    s.hints -= 2;
    s.undos--;
  });
  b = change(b, base, (s) => {
    buy(s, "undo");
    s.hints--;
    s.undos -= 2;
  });
  const merged = projectReplicas({
    [A]: a,
    [B]: b,
    [C]: newReplica(freshSave(), C),
  });
  assert.equal(merged.coins, 500);
  assert.equal(merged.hints, 3);
  assert.equal(merged.undos, 7);
  const again = change(a, merged, (s) => {
    s.hints--;
  });
  assert.equal(projectReplicas({ [A]: again, [B]: b }).hints, 2);
});
test("legacy migration unions best results and owned themes without summing wallets", () => {
  const pc = {
    ...freshSave(),
    coins: 450,
    owned: ["studio", "grove"],
    theme: "grove",
  };
  const phone = {
    ...freshSave(),
    coins: 800,
    owned: ["studio", "tide"],
    theme: "tide",
  };
  win(pc, 1);
  win(phone, 2);
  win(phone, 1);
  pc.completed[1] = { stars: 2, moves: 9 };
  const merged = projectReplicas({
    [A]: newReplica(pc, A),
    [B]: newReplica(phone, B),
  });
  assert.equal(merged.coins, phone.coins);
  assert.deepEqual(merged.completed[1], { stars: 3, moves: 6 });
  assert.deepEqual(merged.owned, ["grove", "studio", "tide"]);
});
test("profile isolation claims legacy only once and retains each account on switching", () => {
  const storage = mem(),
    old = freshSave();
  win(old);
  storage.setItem(SAVE_KEY, JSON.stringify(old));
  assert.equal(accountSave(storage, 1, 100).save.coins, 194);
  assert.equal(accountSave(storage, 1, 200).save.coins, 150);
  assert.equal(accountSave(storage, 2, 100).save.coins, 150);
  assert.equal(accountSave(storage, 1, 100).save.coins, 194);
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).coins, 194);
});
test("fresh devices cannot reset a migrated theme or sound preference", () => {
  const old = { ...freshSave(), theme: "grove", owned: ["studio", "grove"] };
  old.settings.sound = false;
  const state = projectReplicas({
    [A]: newReplica(old, A),
    [B]: newReplica(freshSave(), B),
  });
  assert.equal(state.theme, "grove");
  assert.equal(state.settings.sound, false);
});
function server() {
  const values = new Map(),
    calls = [];
  let offline = false,
    rejectHead = false;
  return {
    values,
    calls,
    set offline(v) {
      offline = v;
    },
    set rejectHead(v) {
      rejectHead = v;
    },
    send: async (method, params) => {
      calls.push({ method, params });
      if (offline) throw Error("No network");
      if (method.endsWith("GetKeys"))
        return {
          keys: [...values.keys()]
            .sort()
            .slice(params.offset, params.offset + params.count),
        };
      if (method.endsWith("Get"))
        return {
          keys: params.keys.map((key) => ({
            key,
            value: values.get(key) || "",
          })),
        };
      if (method.endsWith("Set")) {
        assert.ok(new TextEncoder().encode(params.value).length <= 1800);
        if (rejectHead && /_[a-f0-9]{24}$/.test(params.key))
          throw Error("Interrupted commit");
        values.set(params.key, params.value);
        return { result: true };
      }
      throw Error("Unexpected method");
    },
  };
}
function device(id, s = freshSave(), storage = mem()) {
  let state = copy(s);
  const sync = new CloudSync({
    account: "1.100",
    save: state,
    storage,
    id,
    onApply: (s) => {
      state = s;
    },
  });
  // Unit transport has no API rate limit; production still spaces requests.
  sync.request = (m, p) => sync.send(m, p);
  sync.schedule = () => {};
  return {
    sync,
    storage,
    get state() {
      return state;
    },
    update(fn) {
      fn(state);
      sync.capture(state);
    },
    dispose: () => sync.dispose(),
  };
}
test("isolated devices converge after concurrent writes and offline restart", async () => {
  const cloud = server(),
    a = device(A),
    b = device(B);
  await a.sync.connect(cloud.send);
  await b.sync.connect(cloud.send);
  a.update((s) => {
    win(s, 1);
    s.hints--;
  });
  b.update((s) => {
    win(s, 2);
    s.undos--;
  });
  await Promise.all([a.sync.sync(), b.sync.sync()]);
  await a.sync.sync();
  await b.sync.sync();
  assert.deepEqual(a.state.completed, b.state.completed);
  assert.equal(a.state.coins, 238);
  assert.equal(b.state.hints, 2);
  assert.equal(a.state.undos, 4);
  cloud.offline = true;
  a.update((s) => {
    win(s, 3);
    s.hints--;
  });
  const writes = cloud.calls.filter((c) => c.method.endsWith("Set")).length;
  assert.equal(await a.sync.sync(), false);
  assert.equal(
    cloud.calls.filter((c) => c.method.endsWith("Set")).length,
    writes,
  );
  a.dispose();
  const restored = device(C, a.state, a.storage);
  assert.equal(restored.sync.id, A);
  cloud.offline = false;
  await restored.sync.connect(cloud.send);
  await b.sync.sync();
  assert.equal(b.state.coins, 282);
  assert.equal(b.state.hints, 1);
  assert.ok(b.state.completed[3]);
  restored.dispose();
  b.dispose();
});
test("partial upload cannot replace a valid save; failed read never uploads defaults", async () => {
  const cloud = server(),
    a = device(A),
    b = device(B);
  await a.sync.connect(cloud.send);
  cloud.rejectHead = true;
  a.update((s) => win(s));
  assert.equal(await a.sync.sync(), false);
  cloud.rejectHead = false;
  await b.sync.connect(cloud.send);
  assert.equal(b.state.coins, 150);
  await a.sync.sync();
  await b.sync.sync();
  assert.equal(b.state.coins, 194);
  const blank = device(C);
  cloud.offline = true;
  const writes = cloud.calls.filter((c) => c.method.endsWith("Set")).length;
  await blank.sync.connect(cloud.send);
  assert.equal(
    writes,
    cloud.calls.filter((c) => c.method.endsWith("Set")).length,
  );
  a.dispose();
  b.dispose();
  blank.dispose();
});
test("large complete save is chunked, checksummed and restored without losing history", async () => {
  const s = freshSave();
  for (let i = 1; i <= 420; i++) win(s, i);
  for (let i = 0; i < 1000; i++) {
    const date = new Date(Date.UTC(2022, 0, i + 1)).toISOString().slice(0, 10);
    s.daily[date] = { done: [0, 1, 2], claimed: true };
  }
  const cloud = server(),
    a = device(A, s),
    b = device(B);
  assert.equal(await a.sync.connect(cloud.send), true);
  assert.ok(cloud.values.size > 2);
  assert.equal(await b.sync.connect(cloud.send), true);
  assert.equal(Object.keys(b.state.completed).length, 420);
  assert.equal(Object.keys(b.state.daily).length, 1000);
  assert.equal(b.state.coins, s.coins);
  a.dispose();
  b.dispose();
});
test("overspending offline stays nonnegative and daily claim is awarded once", () => {
  const start = freshSave();
  start.hints = 1;
  const a = newReplica(start, A),
    b = newReplica(freshSave(), B),
    base = projectReplicas({ [A]: a, [B]: b });
  const spend = (s) => {
    s.hints--;
    s.daily["2026-10-03"] = { done: [0, 1, 2], claimed: true };
    s.coins += 160;
    s.hints++;
  };
  const state = projectReplicas({
    [A]: change(a, base, spend),
    [B]: change(b, base, spend),
  });
  assert.equal(state.coins, 310);
  assert.equal(state.hints, 0);
  assert.ok(validateSave(state));
});
