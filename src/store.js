import { getTheme, themes } from "./themes.js";
import { starRating, hash, seeded } from "./engine.js";
export const SAVE_KEY = "sdvig.save.v1";
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function previousDay(day) {
  const d = new Date(day + "T12:00:00");
  d.setDate(d.getDate() - 1);
  return dayKey(d);
}
export const freshSave = () => ({
  version: 1,
  coins: 150,
  hints: 3,
  undos: 5,
  economy: 3,
  auto: 0,
  freeze: 0,
  theme: "studio",
  owned: ["studio"],
  completed: {},
  daily: {},
  zen: {},
  claimed: [],
  streak: 0,
  lastDaily: null,
  sprintBest: 0,
  settings: { sound: true, haptic: true, motion: true },
  session: null,
  stats: { moves: 0, perfect: 0 },
  created: Date.now(),
});
const int = (v, max = 1000000) => Number.isInteger(v) && v >= 0 && v <= max;
export function validateSave(v) {
  if (
    !v ||
    v.version !== 1 ||
    !int(v.coins) ||
    !int(v.hints, 9999) ||
    (v.undos !== undefined && !int(v.undos, 9999)) ||
    !int(v.auto, 9999) ||
    !int(v.freeze, 9999) ||
    !themes.some((t) => t.id === v.theme) ||
    !Array.isArray(v.owned) ||
    !v.owned.includes(v.theme) ||
    v.owned.some((id) => !themes.some((t) => t.id === id))
  )
    return false;
  if (
    !v.completed ||
    typeof v.completed !== "object" ||
    Array.isArray(v.completed) ||
    Object.entries(v.completed).some(
      ([id, c]) =>
        !int(Number(id), 420) ||
        Number(id) < 1 ||
        !c ||
        !int(c.stars, 3) ||
        c.stars < 1 ||
        !int(c.moves, 100000),
    )
  )
    return false;
  if (
    !v.daily ||
    typeof v.daily !== "object" ||
    Array.isArray(v.daily) ||
    Object.entries(v.daily).some(
      ([key, d]) =>
        !/^\d{4}-\d{2}-\d{2}$/.test(key) ||
        !d ||
        !Array.isArray(d.done) ||
        d.done.some((n) => !int(n, 2)) ||
        typeof d.claimed !== "boolean",
    )
  )
    return false;
  if (
    !v.zen ||
    typeof v.zen !== "object" ||
    Array.isArray(v.zen) ||
    Object.entries(v.zen).some(
      ([k, val]) => !int(Number(k), 100000) || val !== true,
    )
  )
    return false;
  if (
    !Array.isArray(v.claimed) ||
    v.claimed.some((id) => typeof id !== "string") ||
    !int(v.streak, 100000) ||
    !int(v.sprintBest, 100000) ||
    !(
      v.lastDaily === null ||
      (typeof v.lastDaily === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(v.lastDaily))
    )
  )
    return false;
  if (
    !v.settings ||
    ["sound", "haptic", "motion"].some(
      (k) => typeof v.settings[k] !== "boolean",
    ) ||
    !v.stats ||
    !int(v.stats.moves, 1e9) ||
    !int(v.stats.perfect, 1e6)
  )
    return false;
  return true;
}
export function loadSave(storage = localStorage, key = SAVE_KEY) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return freshSave();
    const parsed = JSON.parse(raw);
    if (validateSave(parsed)) {
      // Refund retired helpers once. Purchases, coins and completed slots survive.
      if (!parsed.economy || parsed.economy < 2) {
        parsed.coins = Math.min(
          1000000,
          parsed.coins + parsed.auto * 40 + parsed.freeze * 20,
        );
        parsed.auto = 0;
        parsed.freeze = 0;
      }
      // Existing players keep every purchase and receive the same starter undos.
      if (parsed.undos === undefined) parsed.undos = 5;
      parsed.economy = 3;
      saveData(parsed, storage, key);
      return parsed;
    }
    storage.setItem(key + ".damaged", raw);
  } catch {}
  return freshSave();
}
export function saveData(data, storage = localStorage, key = SAVE_KEY) {
  try {
    storage.setItem(key, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
export function dailyLevels(pool, day = dayKey()) {
  const r = seeded(hash(day)),
    groups = [
      pool.filter((l) => l.par <= 8),
      pool.filter((l) => l.par > 8 && l.par <= 13),
      pool.filter((l) => l.par > 13),
    ];
  return groups.map(
    (g) => (g.length ? g : pool)[Math.floor(r() * (g.length || pool.length))],
  );
}
export function completeCampaign(save, level, moves, hints) {
  const stars = starRating(moves, level.par, hints),
    old = save.completed[level.id],
    delta = Math.max(0, stars - (old?.stars || 0));
  const reward = (old ? 0 : 20) + delta * 8;
  save.coins += reward;
  save.completed[level.id] = {
    stars: Math.max(stars, old?.stars || 0),
    moves: Math.min(moves, old?.moves ?? Infinity),
  };
  if (stars === 3 && old?.stars !== 3) save.stats.perfect++;
  return { stars, reward };
}
export function claimDaily(save, day = dayKey()) {
  const d = save.daily[day];
  if (!d || new Set(d.done).size !== 3 || d.claimed) return 0;
  d.claimed = true;
  save.streak =
    save.lastDaily === previousDay(day)
      ? save.streak + 1
      : save.lastDaily === day
        ? save.streak
        : 1;
  save.lastDaily = day;
  const reward = 100 + Math.min(save.streak - 1, 6) * 10;
  save.coins += reward;
  save.hints++;
  return reward;
}
export const offers = {
  hint: {
    price: 300,
    key: "hints",
    count: 3,
    name: "Подсказки",
    desc: "Покажут следующий ход",
  },
  undo: {
    price: 200,
    key: "undos",
    count: 5,
    name: "Отмены",
    desc: "Вернут последний ход",
  },
};
export function buy(save, item) {
  if (offers[item]) {
    const o = offers[item];
    if (save.coins < o.price || save[o.key] + o.count > 9999) return false;
    save.coins -= o.price;
    save[o.key] += o.count;
    return true;
  }
  const t = themes.find((t) => t.id === item);
  if (!t || save.owned.includes(item) || save.coins < t.price) return false;
  save.coins -= t.price;
  save.owned.push(item);
  save.theme = item;
  return true;
}
export const achievements = [
  {
    id: "first",
    name: "Первый сдвиг",
    desc: "Пройти первый уровень",
    icon: "play",
    target: 1,
    value: (s) => Object.keys(s.completed).length,
    reward: 40,
    bonus: { undos: 2 },
  },
  {
    id: "ten",
    name: "В своём ритме",
    desc: "Пройти 10 уровней",
    icon: "grid",
    target: 10,
    value: (s) => Object.keys(s.completed).length,
    reward: 80,
    bonus: { hints: 1 },
  },
  {
    id: "perfect",
    name: "Точность",
    desc: "10 уровней на 3 звезды",
    icon: "star",
    target: 10,
    value: (s) => s.stats.perfect,
    reward: 100,
    bonus: { undos: 3 },
  },
  {
    id: "sixty",
    name: "Новая глава",
    desc: "Пройти 60 уровней",
    icon: "leaf",
    target: 60,
    value: (s) => Object.keys(s.completed).length,
    reward: 160,
    bonus: { hints: 2 },
  },
  {
    id: "streak",
    name: "Добрая привычка",
    desc: "Ежедневный набор 3 дня подряд",
    icon: "flame",
    target: 3,
    value: (s) => s.streak,
    reward: 120,
    bonus: { undos: 3 },
  },
  {
    id: "collector",
    name: "Свой стиль",
    desc: "Открыть 3 темы",
    icon: "palette",
    target: 3,
    value: (s) => s.owned.length,
    reward: 120,
  },
  {
    id: "sprint",
    name: "На одном дыхании",
    desc: "5 задач за один спринт",
    icon: "bolt",
    target: 5,
    value: (s) => s.sprintBest,
    reward: 150,
    bonus: { hints: 2 },
  },
  {
    id: "master",
    name: "Мастер сдвига",
    desc: "Пройти все 420 уровней",
    icon: "trophy",
    target: 420,
    value: (s) => Object.keys(s.completed).length,
    reward: 1000,
    bonus: { hints: 10, undos: 15 },
  },
  {
    id: "twenty-five",
    name: "Есть маршрут",
    desc: "Пройти 25 уровней",
    icon: "arrow",
    target: 25,
    value: (s) => Object.keys(s.completed).length,
    reward: 100,
    bonus: { undos: 3 },
  },
  {
    id: "perfect-30",
    name: "Без лишних движений",
    desc: "30 уровней на 3 звезды",
    icon: "star",
    target: 30,
    value: (s) => s.stats.perfect,
    reward: 150,
    bonus: { hints: 2 },
  },
  {
    id: "daily-first",
    name: "Сегодня получилось",
    desc: "Забрать первую награду дня",
    icon: "sun",
    target: 1,
    value: (s) => Object.values(s.daily).filter((d) => d.claimed).length,
    reward: 60,
    bonus: { undos: 2 },
  },
  {
    id: "daily-ten",
    name: "Десять хороших дней",
    desc: "Забрать 10 наград дня",
    icon: "gift",
    target: 10,
    value: (s) => Object.values(s.daily).filter((d) => d.claimed).length,
    reward: 250,
    bonus: { hints: 3 },
  },
  {
    id: "week",
    name: "Неделя сдвигов",
    desc: "Ежедневный набор 7 дней подряд",
    icon: "flame",
    target: 7,
    value: (s) => s.streak,
    reward: 300,
    bonus: { hints: 2, undos: 5 },
  },
  {
    id: "explorer",
    name: "Другой ритм",
    desc: "20 новых задач в Дзене и Спринте",
    icon: "infinity",
    target: 20,
    value: (s) => Object.keys(s.zen).length,
    reward: 150,
    bonus: { undos: 5 },
  },
  {
    id: "sprint-ten",
    name: "Скорость мысли",
    desc: "10 задач за один спринт",
    icon: "bolt",
    target: 10,
    value: (s) => s.sprintBest,
    reward: 300,
    bonus: { hints: 3 },
  },
  {
    id: "halfway",
    name: "Половина пути",
    desc: "Пройти 210 уровней",
    icon: "grid",
    target: 210,
    value: (s) => Object.keys(s.completed).length,
    reward: 400,
    bonus: { hints: 4, undos: 6 },
  },
  {
    id: "perfect-100",
    name: "Чистая логика",
    desc: "100 уровней на 3 звезды",
    icon: "trophy",
    target: 100,
    value: (s) => s.stats.perfect,
    reward: 400,
    bonus: { hints: 5 },
  },
  {
    id: "all-themes",
    name: "Семь миров",
    desc: "Открыть все 7 тем",
    icon: "palette",
    target: 7,
    value: (s) => s.owned.length,
    reward: 500,
    bonus: { hints: 5, undos: 10 },
  },
];
export function claimAchievement(save, id) {
  const a = achievements.find((a) => a.id === id);
  if (!a || save.claimed.includes(id) || a.value(save) < a.target) return 0;
  save.claimed.push(id);
  save.coins += a.reward;
  for (const [key, count] of Object.entries(a.bonus || {}))
    save[key] = Math.min(9999, save[key] + count);
  return a.reward;
}
export function applyTheme(id) {
  const t = getTheme(id),
    names = [
      "bg",
      "surface",
      "text",
      "muted",
      "line",
      "board",
      "accent",
      "target",
      "secondary",
    ];
  names.forEach((name, i) =>
    document.documentElement.style.setProperty("--" + name, t.colors[i]),
  );
  document.documentElement.dataset.theme = t.id;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", t.colors[0]);
}
