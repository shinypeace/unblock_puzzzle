import {
  freshSave,
  validateSave,
  achievements,
  previousDay,
  SAVE_KEY,
  loadSave,
} from "./store.js";
import { themes } from "./themes.js";

const PREFIX = "sdvig_sync_v1_";
const clone = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const emptyProgress = () => ({
  completed: {},
  daily: {},
  zen: {},
  owned: ["studio"],
  claimed: [],
  sprintBest: 0,
});
const fields = ["coins", "hints", "undos"];
const progress = (s) =>
  Object.fromEntries(Object.keys(emptyProgress()).map((k) => [k, clone(s[k])]));
const unique = (a, b) => [...new Set([...a, ...b])].sort();
const clamp = (n, max) => Math.min(max, Math.max(0, Math.round(n)));
function streak(daily, date, limit = Infinity) {
  let n = 0;
  while (n < limit && daily[date]?.claimed) {
    n++;
    date = previousDay(date);
  }
  return n;
}
export function mergeProgress(a, b) {
  const p = clone(a);
  for (const [id, v] of Object.entries(b.completed)) {
    const old = p.completed[id];
    p.completed[id] = {
      stars: Math.max(v.stars, old?.stars || 0),
      moves: Math.min(v.moves, old?.moves ?? Infinity),
    };
  }
  for (const [date, d] of Object.entries(b.daily)) {
    const old = p.daily[date] || { done: [], claimed: false };
    p.daily[date] = {
      done: unique(old.done, d.done),
      claimed: old.claimed || d.claimed,
    };
  }
  p.zen = { ...p.zen, ...b.zen };
  p.owned = unique(p.owned, b.owned);
  p.claimed = unique(p.claimed, b.claimed);
  p.sprintBest = Math.max(p.sprintBest, b.sprintBest);
  return p;
}
// Rewards and one-time purchases are valued from their IDs, so two devices
// completing/claiming the same task cannot mint the reward twice.
function value(p) {
  const v = { coins: 0, hints: 0, undos: 0 };
  for (const c of Object.values(p.completed)) v.coins += 20 + c.stars * 8;
  for (const [date, d] of Object.entries(p.daily)) {
    v.coins += new Set(d.done).size * 20;
    if (d.claimed) {
      v.coins += 100 + Math.max(0, streak(p.daily, date, 7) - 1) * 10;
      v.hints++;
    }
  }
  v.coins += Object.keys(p.zen).length * 12;
  for (const id of p.claimed) {
    const a = achievements.find((a) => a.id === id);
    if (a) {
      v.coins += a.reward;
      for (const k of ["hints", "undos"]) v[k] += a.bonus?.[k] || 0;
    }
  }
  for (const id of p.owned)
    v.coins -= themes.find((t) => t.id === id)?.price || 0;
  return v;
}
function meaningful(s) {
  const f = freshSave();
  return (
    fields.some((k) => s[k] !== f[k]) ||
    s.stats.moves > 0 ||
    s.theme !== f.theme ||
    !same(s.settings, f.settings) ||
    !same(progress(s), progress(f))
  );
}
export function newReplica(save, id) {
  const seed = meaningful(save) ? { ...clone(save), session: null } : null;
  return {
    v: 1,
    id,
    seq: 0,
    seed,
    p: emptyProgress(),
    extra: [0, 0, 0],
    moves: 0,
    prefs: {
      time: seed ? 1 : 0,
      theme: save.theme,
      settings: clone(save.settings),
    },
  };
}
export function validReplica(r) {
  if (
    !r ||
    r.v !== 1 ||
    !/^[a-f0-9]{24}$/.test(r.id) ||
    !Number.isSafeInteger(r.seq) ||
    r.seq < 0 ||
    (r.seed !== null &&
      (!validateSave(r.seed) || !Number.isInteger(r.seed.undos))) ||
    !r.p ||
    Object.keys(emptyProgress()).some((k) => !Object.hasOwn(r.p, k)) ||
    !Array.isArray(r.extra) ||
    r.extra.length !== 3 ||
    r.extra.some((n) => !Number.isSafeInteger(n) || Math.abs(n) > 1e12) ||
    !Number.isSafeInteger(r.moves) ||
    r.moves < 0 ||
    !r.prefs ||
    !Number.isSafeInteger(r.prefs.time) ||
    r.prefs.time < 0
  )
    return false;
  return (
    validateSave({ ...freshSave(), ...r.p, theme: "studio" }) &&
    validateSave({
      ...freshSave(),
      owned: themes.map((t) => t.id),
      theme: r.prefs.theme,
      settings: r.prefs.settings,
    })
  );
}
export function projectReplicas(records, local = freshSave()) {
  const rows = Object.values(records)
    .filter(validReplica)
    .sort((a, b) => a.id.localeCompare(b.id));
  const seeds = rows.filter((r) => r.seed).map((r) => r.seed);
  const baseline = seeds.reduce(
    (p, s) => mergeProgress(p, progress(s)),
    emptyProgress(),
  );
  const p = rows.reduce((p, r) => mergeProgress(p, r.p), baseline);
  const before = value(baseline),
    after = value(p),
    result = { ...freshSave(), ...p };
  fields.forEach((k, i) => {
    const initial = seeds.length
      ? Math.max(...seeds.map((s) => s[k]))
      : freshSave()[k];
    result[k] = clamp(
      initial + after[k] - before[k] + rows.reduce((n, r) => n + r.extra[i], 0),
      i ? 9999 : 1000000,
    );
  });
  const pref = rows.reduce(
    (best, r) => (!best || r.prefs.time >= best.time ? r.prefs : best),
    null,
  );
  if (pref) {
    result.theme = p.owned.includes(pref.theme) ? pref.theme : "studio";
    result.settings = clone(pref.settings);
  }
  result.lastDaily =
    Object.keys(p.daily)
      .filter((d) => p.daily[d].claimed)
      .sort()
      .at(-1) || null;
  result.streak = result.lastDaily ? streak(p.daily, result.lastDaily) : 0;
  result.stats = {
    moves: clamp(
      Math.max(0, ...seeds.map((s) => s.stats.moves)) +
        rows.reduce((n, r) => n + r.moves, 0),
      1e9,
    ),
    perfect: Object.values(p.completed).filter((c) => c.stars === 3).length,
  };
  result.created = Math.min(
    local.created || Date.now(),
    ...seeds.map((s) => s.created || Date.now()),
  );
  // A remote refresh must never replace a board under the player's finger.
  result.session = local.session;
  return result;
}
export function captureReplica(
  record,
  before,
  after,
  logicalTime = Date.now(),
) {
  const r = clone(record),
    a = progress(before),
    b = progress(after);
  const va = value(a),
    vb = value(b);
  fields.forEach((k, i) => {
    r.extra[i] += after[k] - before[k] - (vb[k] - va[k]);
  });
  r.moves += Math.max(0, after.stats.moves - before.stats.moves);
  if (!same(a, b)) r.p = mergeProgress(r.p, b);
  if (after.theme !== before.theme || !same(after.settings, before.settings))
    r.prefs = {
      time: Math.max(logicalTime, r.prefs.time + 1),
      theme: after.theme,
      settings: clone(after.settings),
    };
  if (!same(r, record)) r.seq++;
  return r;
}
export function accountSave(storage, appId, userId) {
  const account = `${appId}.${userId}`,
    key = `${SAVE_KEY}.vk.${account}`;
  // Claim the old browser save once. Switching VK accounts cannot import it again.
  if (!storage.getItem(key)) {
    if (!storage.getItem(SAVE_KEY + ".owner")) {
      const old = storage.getItem(SAVE_KEY);
      if (old) storage.setItem(key, old);
      storage.setItem(SAVE_KEY + ".owner", account);
    }
  }
  return { account, key, save: loadSave(storage, key) };
}
const randomId = () =>
  [...crypto.getRandomValues(new Uint8Array(12))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
async function encode(record) {
  const text = JSON.stringify(record);
  if (typeof CompressionStream === "undefined") return "j" + text;
  const bytes = new Uint8Array(
    await new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );
  return "z" + btoa(String.fromCharCode(...bytes));
}
async function decode(text) {
  if (text[0] === "j") return JSON.parse(text.slice(1));
  if (text[0] !== "z") throw Error("Unknown cloud format");
  const bytes = Uint8Array.from(atob(text.slice(1)), (c) => c.charCodeAt(0));
  const json = await new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
  ).text();
  return JSON.parse(json);
}
async function digest(text) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}

export class CloudSync {
  constructor({
    account,
    save,
    storage = localStorage,
    onApply = () => {},
    onStatus = () => {},
    id = randomId(),
  }) {
    Object.assign(this, { account, storage, onApply, onStatus });
    this.key = `${SAVE_KEY}.sync.${account}`;
    let cached;
    try {
      cached = JSON.parse(storage.getItem(this.key));
    } catch {}
    this.records = Object.fromEntries(
      Object.entries(cached?.records || {}).filter(
        ([id, r]) => validReplica(r) && id === r.id,
      ),
    );
    this.id = validReplica(this.records[cached?.id]) ? cached.id : id;
    this.records[this.id] ||= newReplica(save, this.id);
    this.last = clone(save);
    this.stopped = false;
    this.failures = 0;
    this.lastRequest = 0;
    this.persist();
  }
  persist() {
    this.storage.setItem(
      this.key,
      JSON.stringify({ id: this.id, records: this.records }),
    );
  }
  capture(save) {
    // Re-read our replica for other tabs on the same installation.
    try {
      const cached = JSON.parse(this.storage.getItem(this.key));
      this.merge(cached?.records || {});
    } catch {}
    const time = Math.max(
      Date.now(),
      ...Object.values(this.records).map((r) => r.prefs.time + 1),
    );
    const old = this.records[this.id];
    this.records[this.id] = captureReplica(old, this.last, save, time);
    this.last = clone(save);
    this.persist();
    if (old.seq !== this.records[this.id].seq) this.schedule(1500);
  }
  merge(records) {
    for (const [id, r] of Object.entries(records))
      if (
        validReplica(r) &&
        id === r.id &&
        (!this.records[id] || r.seq > this.records[id].seq)
      )
        this.records[id] = r;
  }
  schedule(ms = 30000) {
    if (this.stopped || !this.send) return;
    const due = Math.max(Date.now() + ms, this.retryAt || 0);
    // Continuous moves must not postpone an already scheduled upload forever.
    if (this.timer && this.due <= due) return;
    clearTimeout(this.timer);
    this.due = due;
    this.timer = setTimeout(
      () => void this.sync(),
      Math.max(0, due - Date.now()),
    );
  }
  connect(send) {
    this.send = send;
    return this.sync();
  }
  async request(method, params) {
    const delay = 350 - (Date.now() - this.lastRequest);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    this.lastRequest = Date.now();
    return this.send(method, params);
  }
  async get(keys) {
    const result = {};
    for (let i = 0; i < keys.length; i += 100) {
      const part = keys.slice(i, i + 100),
        r = await this.request("VKWebAppStorageGet", { keys: part });
      if (
        !Array.isArray(r?.keys) ||
        part.some(
          (k) =>
            !r.keys.some((v) => v.key === k && typeof v.value === "string"),
        )
      )
        throw Error("Incomplete cloud response");
      for (const { key, value } of r.keys) result[key] = value;
    }
    return result;
  }
  async read() {
    let keys = [],
      offset = 0;
    while (true) {
      const r = await this.request("VKWebAppStorageGetKeys", {
        count: 1000,
        offset,
      });
      if (!Array.isArray(r?.keys) || r.keys.some((k) => typeof k !== "string"))
        throw Error("Invalid cloud listing");
      keys.push(
        ...r.keys.filter((k) => new RegExp(`^${PREFIX}[a-f0-9]{24}$`).test(k)),
      );
      if (r.keys.length < 1000) break;
      offset += r.keys.length;
      if (offset > 20000) throw Error("Cloud key limit");
    }
    const heads = await this.get([...new Set(keys)]),
      records = {};
    for (const [key, raw] of Object.entries(heads)) {
      if (!raw) continue;
      const head = JSON.parse(raw),
        id = key.slice(PREFIX.length);
      if (
        head.v !== 1 ||
        !["a", "b"].includes(head.bank) ||
        !Number.isInteger(head.parts) ||
        head.parts < 1 ||
        head.parts > 128 ||
        !/^[a-f0-9]{64}$/.test(head.hash)
      )
        throw Error("Damaged cloud header");
      const names = Array.from(
        { length: head.parts },
        (_, i) => `${key}_${head.bank}_${i}`,
      );
      const chunks = await this.get(names),
        encoded = names.map((n) => chunks[n]).join("");
      if ((await digest(encoded)) !== head.hash)
        throw Error("Cloud changed during read");
      const r = await decode(encoded);
      if (!validReplica(r) || r.id !== id || r.seq !== head.seq)
        throw Error("Damaged cloud save");
      records[id] = r;
    }
    return { records, heads };
  }
  async write(record, rawHead) {
    const key = PREFIX + this.id,
      old = rawHead ? JSON.parse(rawHead) : null;
    const encoded = await encode(record),
      hash = await digest(encoded);
    if (old?.hash === hash) return;
    const bank = old?.bank === "a" ? "b" : "a",
      chunks = encoded.match(/.{1,1800}/g);
    if (chunks.length > 128) throw Error("Cloud save too large");
    // Write an inactive bank first; the final small header is the commit point.
    for (let i = 0; i < chunks.length; i++) {
      const r = await this.request("VKWebAppStorageSet", {
        key: `${key}_${bank}_${i}`,
        value: chunks[i],
      });
      if (r?.result !== true) throw Error("Cloud write rejected");
    }
    const value = JSON.stringify({
      v: 1,
      seq: record.seq,
      bank,
      parts: chunks.length,
      hash,
    });
    const result = await this.request("VKWebAppStorageSet", { key, value });
    if (result?.result !== true) throw Error("Cloud commit rejected");
  }
  async sync() {
    if (this.stopped || !this.send) return false;
    if (this.running) {
      this.again = true;
      return this.running;
    }
    clearTimeout(this.timer);
    this.timer = null;
    const run = async () => {
      try {
        const { records, heads } = await this.read();
        try {
          this.merge(JSON.parse(this.storage.getItem(this.key))?.records || {});
        } catch {}
        this.merge(records);
        this.persist();
        const merged = projectReplicas(this.records, this.last);
        if (!same(merged, this.last)) {
          this.last = clone(merged);
          this.onApply(merged, { initial: !this.readOnce });
        }
        this.readOnce = true;
        const sent = clone(this.records[this.id]);
        await this.write(sent, heads[PREFIX + this.id]);
        this.failures = 0;
        this.retryAt = 0;
        this.onStatus("saved");
        if (sent.seq !== this.records[this.id].seq) this.again = true;
        return true;
      } catch {
        this.failures++;
        this.retryAt =
          Date.now() +
          Math.min(60000, 5000 * 2 ** Math.min(this.failures - 1, 4));
        this.onStatus("offline");
        return false;
      }
    };
    // Network writes by tabs of this browser share one writer lock.
    this.running = globalThis.navigator?.locks
      ? navigator.locks.request(this.key, run)
      : run();
    try {
      return await this.running;
    } finally {
      this.running = null;
      this.schedule(
        this.failures
          ? Math.min(60000, 5000 * 2 ** Math.min(this.failures - 1, 4))
          : this.again
            ? 1500
            : 30000,
      );
      this.again = false;
    }
  }
  dispose() {
    this.stopped = true;
    clearTimeout(this.timer);
  }
}
