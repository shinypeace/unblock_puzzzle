import "@fontsource/nunito/cyrillic-700.css";
import "@fontsource/nunito/cyrillic-900.css";
import "@fontsource/nunito/latin-700.css";
import "@fontsource/nunito/latin-900.css";
import "./raster.css";
import data from "./data/levels.json";
import {
  positions,
  bounds,
  move,
  solved,
  validBoard,
  starRating,
  seeded,
  hash,
} from "./engine.js";
import { themes, getTheme } from "./themes.js";
import {
  SAVE_KEY,
  loadSave,
  saveData,
  applyTheme,
  dayKey,
  previousDay,
  dailyLevels,
  completeCampaign,
  claimDaily,
  buy,
  achievements,
  claimAchievement,
} from "./store.js";
import { sound, muteAudio } from "./audio.js";
import { VKPlatform, connectVK } from "./vk.js";

const app = document.querySelector("#app"),
  modalRoot = document.querySelector("#modal-root"),
  base = new URL(import.meta.env.BASE_URL, document.baseURI).href;
let save = loadSave(),
  route = "play",
  chapter = 0,
  shopTab = "themes",
  game = null,
  modal = null,
  drag = null,
  hint = null,
  busy = false,
  toastTimer,
  focusBeforeModal;
let solver = new Worker(new URL("./solver.worker.js", import.meta.url), {
    type: "module",
  }),
  requestId = 0;
const pausedReasons = new Set();
let pauseStarted = 0,
  pausedGame = null,
  rewardPending = false;
const vk = new VKPlatform({
  hidden: () => document.hidden,
  onBanner: (height) =>
    document.documentElement.style.setProperty(
      "--vk-banner-space",
      height + "px",
    ),
  onReady: () => {
    render();
    if (modal) showModal(modal.type, modal.props);
  },
  onPause: (reason) => {
    if (!pausedReasons.size) {
      pauseStarted = Date.now();
      pausedGame = game;
    }
    pausedReasons.add(reason);
    muteAudio(true);
    if (drag) endDrag({ pointerId: drag.pointer }, true);
    document.querySelector("#ad-shield").hidden = !pausedReasons.has("ad");
    app.inert = true;
    modalRoot.inert = true;
    persist();
  },
  onResume: (reason) => {
    if (!pausedReasons.has(reason)) return;
    pausedReasons.delete(reason);
    if (!pausedReasons.size) {
      if (game === pausedGame && game?.mode === "sprint" && !game.won)
        game.deadline += Date.now() - pauseStarted;
      muteAudio(document.hidden);
      app.inert = !!modal;
      modalRoot.inert = false;
      persist();
      updateClock();
    }
    document.querySelector("#ad-shield").hidden = !pausedReasons.has("ad");
  },
});
const rewardButton = (kind = "hint") =>
  vk.ready
    ? button(
        "reward:" + kind,
        "Видео · +1",
        "play",
        "button secondary full reward-ad",
        'aria-label="Смотреть рекламу за один буст"',
      )
    : "";
const pending = new Map();
solver.onmessage = ({ data }) => {
  const p = pending.get(data.id);
  if (p) {
    pending.delete(data.id);
    clearTimeout(p.timeout);
    p.resolve(data.path);
  }
};
solver.onerror = () => {
  for (const p of pending.values()) {
    clearTimeout(p.timeout);
    p.resolve(null);
  }
  pending.clear();
  busy = false;
  toast("Не удалось найти ход. Попробуйте ещё раз.");
};
const findSolution = (g) =>
  new Promise((resolve) => {
    const id = ++requestId;
    const timeout = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, 20000);
    pending.set(id, { resolve, timeout });
    solver.postMessage({ id, blocks: g.level.blocks, state: g.state });
  });
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (name, cls = "") =>
  `<img class="icon ${cls}" src="${base}art/icons/${name}.webp" alt="" aria-hidden="true" draggable="false">`;
const coin = (n) =>
  `<span class="coin-inline">${icon("coin")}<span>${n}</span></span>`;
const stars = (n = 0) =>
  `<span class="stars" aria-label="${n} из 3 звёзд">${[1, 2, 3].map((i) => icon("star", i <= n ? "filled" : "")).join("")}</span>`;
const button = (action, label, ico = "", cls = "button", extra = "") =>
  `<button class="${cls}" data-action="${action}" ${extra}>${ico ? icon(ico) : ""}${label}</button>`;
const totalStars = () =>
  Object.values(save.completed).reduce((a, b) => a + b.stars, 0);
const nextLevel = () =>
  data.campaign.find((l) => !save.completed[l.id]) || data.campaign.at(-1);
const unlocked = (id) =>
  id === 1 || !!save.completed[id - 1] || !!save.completed[id];
const chapterNames = [
  "Первый шаг",
  "Найти ритм",
  "Новый взгляд",
  "На полпути",
  "Тонкий расчёт",
  "Глубже",
  "Мастерство",
];
const daily = () => save.daily[dayKey()] || { done: [], claimed: false };
const currentStreak = () =>
  save.lastDaily === dayKey() || save.lastDaily === previousDay(dayKey())
    ? save.streak
    : 0;
const playSound = (kind) => sound(kind, save.settings.sound);
function persist() {
  if (game) save.session = serializeGame();
  if (!saveData(save))
    toast("Не удалось сохранить прогресс. Проверьте свободное место.");
}
function serializeGame() {
  const {
    level,
    state,
    history,
    moves,
    hints,
    mode,
    dailyIndex,
    date,
    deadline,
    score,
    seed,
    round,
    won,
    freezeUsed,
  } = game;
  return {
    levelId: level.id,
    state,
    history,
    moves,
    hints,
    mode,
    dailyIndex,
    date,
    deadline,
    score,
    seed,
    round,
    won,
    freezeUsed,
  };
}
function restoreGame() {
  const s = save.session;
  if (!s || !["campaign", "daily", "zen", "sprint"].includes(s.mode))
    return false;
  const level = [...data.campaign, ...data.extra].find(
    (l) => l.id === s.levelId,
  );
  if (
    !level ||
    !validBoard(level.blocks, s.state) ||
    !Number.isInteger(s.moves) ||
    s.moves < 0 ||
    !Array.isArray(s.history) ||
    s.history.length > 10000 ||
    s.history.some((h) => !validBoard(level.blocks, h)) ||
    !Number.isInteger(s.hints) ||
    s.hints < 0
  )
    return false;
  if (s.mode === "campaign" && !unlocked(level.id)) return false;
  if (
    s.mode === "daily" &&
    (s.date !== dayKey() ||
      !Number.isInteger(s.dailyIndex) ||
      dailyLevels(data.extra)[s.dailyIndex]?.id !== level.id)
  )
    return false;
  if (
    s.mode === "sprint" &&
    (!Number.isFinite(s.deadline) ||
      !Number.isInteger(s.score) ||
      !Number.isInteger(s.round) ||
      !Number.isInteger(s.seed))
  )
    return false;
  if (s.won || solved(s.state)) return false;
  game = { ...s, level, state: [...s.state], startedAt: Date.now() };
  return true;
}
function startGame(level, mode = "campaign", extra = {}) {
  game = {
    level,
    startedAt: Date.now(),
    mode,
    state: positions(level.blocks),
    history: [],
    moves: 0,
    hints: 0,
    won: false,
    date: dayKey(),
    ...extra,
  };
  hint = null;
  busy = false;
  route = "play";
  persist();
  render();
}
function openCampaign() {
  if (game?.mode === "campaign" && !game.won) {
    route = "play";
    render();
  } else startGame(nextLevel());
}
function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), 3200);
}
function navigate(next) {
  route = next;
  hint = null;
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
}
function logo() {
  return icon("logo") + "<span>СДВИГ</span>";
}
function navItem(id, label, ico) {
  return `<button class="nav-item ${route === id || (id === "levels" && route === "play") ? "active" : ""}" data-action="nav:${id}" ${route === id ? 'aria-current="page"' : ""}>${icon(ico)}<span>${label}</span>${id === "daily" && !daily().claimed ? '<i class="nav-dot"></i>' : ""}</button>`;
}
function render() {
  applyTheme(save.theme);
  document.documentElement.dataset.motion = save.settings.motion ? "on" : "off";
  const art = (name) => `url("${base}art/${save.theme}/${name}.webp")`;
  for (const name of [
    "background",
    "board",
    "primary",
    "secondary",
    "round",
    "panel",
    "tab-on",
    "tab-off",
    "tile",
    "chest",
  ])
    document.documentElement.style.setProperty("--art-" + name, art(name));
  document.documentElement.style.setProperty(
    "--board-inset",
    getTheme(save.theme).inset + "%",
  );
  app.innerHTML = `<div class="app-shell"><header class="topbar"><button class="brand" data-action="home" aria-label="Сдвиг — играть">${logo()}</button><div class="topbar-right"><span class="streak-counter">${icon("flame")} ${currentStreak()}</span><button class="wallet" data-action="nav:shop" aria-label="${save.coins} монет. Открыть магазин">${coin(save.coins)}</button>${button("settings", "", "settings", "icon-button", 'aria-label="Настройки"')}</div></header><main id="main">${route === "play" ? playView() : route === "levels" ? levelsView() : route === "daily" ? dailyView() : route === "modes" ? modesView() : route === "shop" ? shopView() : achievementsView()}</main><nav class="mobile-nav" aria-label="Меню">${navItem("levels", "Играть", "grid")}${navItem("daily", "Сегодня", "sun")}${navItem("modes", "Режимы", "infinity")}${navItem("shop", "Магазин", "shop")}${navItem("achievements", "Награды", "trophy")}</nav></div>`;
  if (route === "play") {
    paintBoard();
    updateClock();
  }
  if (route === "daily") updateDailyClock();
}
function pageHeading(_eyebrow, title, aside = "") {
  return `<div class="page-heading"><h1>${title}</h1>${aside}</div>`;
}
function playView() {
  const g = game,
    campaign = g.mode === "campaign",
    sprint = g.mode === "sprint",
    zen = g.mode === "zen";
  const title = campaign
    ? `Уровень <b>${String(g.level.id).padStart(2, "0")}</b>`
    : g.mode === "daily"
      ? `Задача <b>${g.dailyIndex + 1}/3</b>`
      : sprint
        ? "Спринт"
        : "Дзен";
  return `<div class="play-layout"><section class="play-column"><div class="game-top">${button("nav:levels", "", "grid", "icon-button", 'aria-label="Выбор уровня"')}<h1>${title}</h1><div class="game-stats"><div><span>${sprint ? "Время" : "Ходы"}</span><strong id="moves">${sprint ? '<span id="sprint-clock"></span>' : zen ? "∞" : g.moves}</strong></div><div><span>${sprint ? "Решено" : zen ? "Ритм" : "Цель"}</span><strong>${sprint ? g.score : zen ? "Свой" : g.level.par}</strong></div></div></div><div class="board-wrap"><div class="board-frame"><div id="board" class="board" role="group" aria-label="Игровое поле 6 на 6. Выведите целевой блок вправо."><div id="blocks"></div></div><div class="exit-marker">${icon("arrow")}</div></div></div><div class="board-caption"><span>Выведите яркий блок</span></div><div class="game-controls">${button("undo", "<span>Назад</span>", "undo", "control-button", g.history.length ? "" : "disabled")}${button("restart", "<span>Заново</span>", "restart", "control-button", g.moves ? "" : "disabled")}${button("hint", `<span>Подсказка</span><b>${save.hints}</b>`, "hint", "control-button hint-button")}</div>${sprint ? `<div class="sprint-tools">${button("freeze", `+30 сек. ×${save.freeze}`, "snow", "button secondary", g.freezeUsed ? "disabled" : "")}${button("end-sprint", "Финиш", "", "button secondary")}</div>` : ""}</section><aside class="play-aside"><div class="daily-card"><img class="daily-chest" src="${base}art/${save.theme}/chest.webp" alt="Ежедневная награда"><h2>Задача дня</h2><div class="daily-card-bottom"><span>${daily().done.length}/3</span>${coin(100)}</div>${button("nav:daily", daily().claimed ? "Пройдено" : "Играть", "play", "button full")}</div><button class="theme-mini" data-action="nav:shop">${miniBoard(getTheme(save.theme))}<span>${getTheme(save.theme).name}</span>${icon("palette")}</button></aside></div>`;
}
function levelsView() {
  const levels = data.campaign.slice(chapter * 60, chapter * 60 + 60),
    done = levels.filter((l) => save.completed[l.id]).length;
  return `<div class="content-page">${pageHeading("", "Уровни", `<span class="total-stars">${icon("star")} ${totalStars()}</span>`)}<div class="continue-banner"><h2>Уровень ${nextLevel().id}</h2>${button("continue", "Продолжить", "play", "button")}</div><div class="chapter-picker">${button("chapter:" + Math.max(0, chapter - 1), "", "back", "icon-button", chapter === 0 ? 'disabled aria-label="Предыдущая глава"' : 'aria-label="Предыдущая глава"')}<div><h2>${chapterNames[chapter]}</h2><span>${done}/60</span></div>${button("chapter:" + Math.min(6, chapter + 1), "", "arrow", "icon-button", chapter === 6 ? 'disabled aria-label="Следующая глава"' : 'aria-label="Следующая глава"')}</div><div class="levels-grid">${levels.map((l) => `<button class="level-tile ${save.completed[l.id] ? "complete" : ""} ${l.id === nextLevel().id ? "current" : ""}" data-action="level:${l.id}" ${unlocked(l.id) ? "" : "disabled"} aria-label="Уровень ${l.id}${save.completed[l.id] ? `, ${save.completed[l.id].stars} звезды` : unlocked(l.id) ? ", доступен" : ", закрыт"}"><strong>${l.id}</strong>${unlocked(l.id) ? stars(save.completed[l.id]?.stars || 0) : icon("lock")}</button>`).join("")}</div></div>`;
}
function dailyView() {
  const d = daily(),
    ls = dailyLevels(data.extra),
    date = new Date().toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
    });
  return `<div class="content-page">${pageHeading("ВАШ ЕЖЕДНЕВНЫЙ РИТУАЛ", date, `<span class="pill">${icon("clock")}<span id="daily-clock"></span></span>`)}<div class="daily-hero"><div><span class="eyebrow">НЕБОЛЬШАЯ ПРИВЫЧКА</span><h2>Задачи дня</h2><p>3 задачи — 1 награда</p><div class="daily-week">${Array.from(
    { length: 7 },
    (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - 6 + i);
      const key = dayKey(date);
      return `<div class="${save.daily[key]?.claimed ? "done" : ""} ${i === 6 ? "today" : ""}"><span>${date.toLocaleDateString("ru-RU", { weekday: "short" })}</span><i>${save.daily[key]?.claimed ? icon("check") : date.getDate()}</i></div>`;
    },
  ).join(
    "",
  )}</div></div><div class="daily-hero-art"><img src="${base}art/${save.theme}/chest.webp" alt=""></div></div><div class="daily-puzzles">${ls.map((l, i) => `<button class="daily-puzzle ${d.done.includes(i) ? "done" : ""}" data-action="daily:${i}"><div class="card-topline"><span class="eyebrow">0${i + 1}</span>${icon(d.done.includes(i) ? "check" : i === 0 ? "leaf" : i === 1 ? "spark" : "bolt")}</div><h3>${["Разминка", "Поток", "Вызов"][i]}</h3><span>${d.done.includes(i) ? "Пройдено" : `${l.par} ходов до выхода`}</span><div class="daily-puzzle-foot">${d.done.includes(i) ? `Готово ${icon("check")}` : `Играть ${icon("play")}`}</div></button>`).join("")}</div><div class="daily-reward"><div class="reward-symbol">${icon("gift")}</div><div><h3>${d.claimed ? "До встречи завтра" : "Награда за набор"}</h3><span>${d.claimed ? `Серия: ${currentStreak()} дн.` : `${d.done.length}/3 задач · 100+ монет и подсказка`}</span></div>${button("claim-daily", d.claimed ? "Получено" : "Забрать", d.claimed ? "check" : "coin", "button", d.claimed || new Set(d.done).size < 3 ? "disabled" : "")}</div></div>`;
}
function modesView() {
  return `<div class="content-page">${pageHeading("ПОД ВАШЕ НАСТРОЕНИЕ", "Режимы")}<div class="mode-grid"><article class="mode-card zen-card"><div class="mode-illustration">${icon("leaf")}${icon("infinity")}</div><div class="eyebrow">МОМЕНТ СПОКОЙСТВИЯ</div><h2>Дзен</h2><p>Без времени и звёзд.<br>Только вы и головоломка.</p><div class="mode-meta">${icon("infinity")} Без ограничений</div>${button("zen", "Играть", "leaf", "button full")}</article><article class="mode-card sprint-card"><div class="mode-illustration">${icon("bolt")}${icon("clock")}</div><div class="eyebrow">ПОЙМАТЬ МОМЕНТ</div><h2>Спринт</h2><p>Сколько задач за три минуты?<br>Побейте свой рекорд.</p><div class="mode-meta">${icon("trophy")} Рекорд: ${save.sprintBest} задач</div>${button("sprint", "Играть", "bolt", "button full")}</article></div><div class="mode-bottom">${icon("heart")} Никаких жизней и ожидания. Играйте сколько хочется.</div></div>`;
}
function miniBoard(theme) {
  if (!save.owned.includes(theme.id))
    return `<div class="mystery-cover">${icon("lock")}<span>?</span></div>`;
  return `<div class="theme-cover" aria-label="Тема ${theme.name}"><img class="preview-board" src="${base}art/${theme.id}/board.webp" alt=""><img class="preview-piece one" src="${base}art/${theme.id}/target.webp" alt=""><img class="preview-piece two" src="${base}art/${theme.id}/short-0.webp" alt=""><img class="preview-piece three" src="${base}art/${theme.id}/long-1.webp" alt=""></div>`;
}
function shopView() {
  return `<div class="content-page">${pageHeading("СОБЕРИТЕ СВОЮ КОЛЛЕКЦИЮ", "Магазин", `<span class="shop-balance">${coin(save.coins)}</span>`)}<div class="segmented"><button class="${shopTab === "themes" ? "active" : ""}" data-action="shop-tab:themes">Темы</button><button class="${shopTab === "boosts" ? "active" : ""}" data-action="shop-tab:boosts">Помощники</button></div>${
    shopTab === "themes"
      ? `<div class="themes-grid">${themes.map((t) => `<article class="theme-card ${save.theme === t.id ? "equipped" : ""}"><div class="theme-cover-wrap">${miniBoard(t)}${save.theme === t.id ? `<span class="equipped-tag">${icon("check")} В игре</span>` : ""}</div><div class="theme-card-content"><div><h3>${save.owned.includes(t.id) ? t.name : `Тема ${String(themes.indexOf(t) + 1).padStart(2, "0")}`}</h3><p>${save.owned.includes(t.id) ? t.tag : "Закрыта"}</p></div>${button(`theme:${t.id}`, save.theme === t.id ? "Выбрана" : save.owned.includes(t.id) ? "Применить" : coin(t.price), "", save.owned.includes(t.id) ? "button small secondary" : "button small", save.theme === t.id ? "disabled" : "")}</div></article>`).join("")}</div>`
      : `<div class="boost-grid">${[
          {
            id: "hint",
            icon: "hint",
            name: "Подсказки",
            desc: "Покажут следующий верный ход.",
            count: 5,
            owned: save.hints,
            price: 90,
          },
          {
            id: "auto",
            icon: "spark",
            name: "Лёгкий шаг",
            desc: "Сделают один верный ход за вас.",
            count: 3,
            owned: save.auto,
            price: 120,
          },
          {
            id: "freeze",
            icon: "snow",
            name: "Ещё мгновение",
            desc: "+30 секунд в спринте. Один раз за забег.",
            count: 3,
            owned: save.freeze,
            price: 60,
          },
        ]
          .map(
            (b) =>
              `<article class="boost-card"><div class="boost-art">${icon(b.icon)}</div><span class="pill">В запасе: ${b.owned}</span><h3>${b.name} <span>×${b.count}</span></h3><p>${b.desc}</p>${button(`buy:${b.id}`, coin(b.price), "", "button full")}${rewardButton(b.id)}</article>`,
          )
          .join("")}</div>`
  }</div>`;
}
function achievementsView() {
  return `<div class="content-page">${pageHeading("ЕСТЬ ЧЕМ ГОРДИТЬСЯ", "Награды", `<span class="pill">${save.claimed.length} / ${achievements.length}</span>`)}<div class="profile-stats"><div><strong>${Object.keys(save.completed).length}</strong><span>Пройдено</span></div><div><strong>${totalStars()}</strong><span>Звёзд</span></div><div><strong>${currentStreak()}</strong><span>Дней подряд</span></div></div><div class="achievements-list">${achievements
    .map((a) => {
      const value = Math.min(a.value(save), a.target),
        claimed = save.claimed.includes(a.id),
        ready = value >= a.target;
      return `<article class="achievement ${claimed ? "claimed" : ""}"><div class="achievement-icon">${icon(a.icon)}</div><div class="achievement-info"><h3>${a.name}</h3><p>${a.desc}</p><div class="achievement-progress"><div class="progress-track"><i style="width:${(value / a.target) * 100}%"></i></div><span>${value}/${a.target}</span></div></div>${button(`achievement:${a.id}`, claimed ? "" : ready ? "Забрать" : coin(a.reward), claimed ? "check" : "", "button small " + (ready && !claimed ? "" : "secondary"), !ready || claimed ? "disabled" : "")}</article>`;
    })
    .join("")}</div></div>`;
}

function paintBoard() {
  const root = document.querySelector("#blocks");
  if (!root || !game) return;
  const caption = document.querySelector(".board-caption span");
  if (caption)
    caption.textContent = hint
      ? `Сдвиньте подсвеченный блок на ${Math.abs(hint.to - game.state[hint.i])} кл.`
      : "Освободите путь яркому блоку";
  root.innerHTML = game.level.blocks
    .map(
      (b, i) =>
        `<button class="block ${i === 0 ? "target-block" : ""} ${hint?.i === i ? "hinted" : ""}" data-block="${i}" style="left:${((b.a === "h" ? game.state[i] : b.f) / 6) * 100}%;top:${((b.a === "v" ? game.state[i] : b.f) / 6) * 100}%;width:${((b.a === "h" ? b.n : 1) / 6) * 100}%;height:${((b.a === "v" ? b.n : 1) / 6) * 100}%" aria-label="${i === 0 ? "Целевой" : b.a === "h" ? "Горизонтальный" : "Вертикальный"} блок ${i + 1}. ${b.n} клетки. Позиция ${game.state[i] + 1}" ${game.won ? "disabled" : ""}><img class="block-art ${b.a === "v" ? "vertical" : ""}" style="--length:${b.n}" src="${base}art/${save.theme}/${i === 0 ? "target" : `${b.n === 2 ? "short" : "long"}-${(i - 1) % 3}`}.webp" alt="" draggable="false">${hint?.i === i ? `<span class="hint-arrow ${b.a === "v" ? "vertical" : ""} ${hint.to < game.state[i] ? "reverse" : ""}">${icon("arrow")}</span>` : ""}</button>`,
    )
    .join("");
}
function refreshGameStats() {
  const el = document.querySelector("#moves");
  if (el && game.mode !== "sprint" && game.mode !== "zen")
    el.textContent = game.moves;
  const undo = document.querySelector('[data-action="undo"]');
  if (undo) undo.disabled = !game.history.length;
  const count = document.querySelector(".hint-button b");
  if (count) count.textContent = save.hints;
  const restart = document.querySelector('[data-action="restart"]');
  if (restart) restart.disabled = !game.moves;
}
function applyMove(index, to, assisted = false) {
  if (!game || game.won || modal || pausedReasons.size) return false;
  if (game.mode === "sprint" && Date.now() >= game.deadline) {
    finishSprint();
    return false;
  }
  const next = move(game.level.blocks, game.state, index, to);
  if (!next) return false;
  game.history.push([...game.state]);
  game.state = next;
  game.moves++;
  save.stats.moves++;
  if (assisted) game.hints++;
  hint = null;
  playSound("move");
  if (save.settings.haptic) navigator.vibrate?.(8);
  paintBoard();
  refreshGameStats();
  if (solved(next)) win();
  else persist();
  return true;
}
function win() {
  game.won = true;
  if (game.mode !== "sprint") vk.completedLevel(Date.now() - game.startedAt);
  document.querySelector("#board")?.classList.add("won");
  if (save.settings.haptic) navigator.vibrate?.([15, 30, 25]);
  playSound("win");
  let result = {
    stars: starRating(game.moves, game.level.par, game.hints),
    reward: 0,
  };
  if (game.mode === "campaign")
    result = completeCampaign(save, game.level, game.moves, game.hints);
  else if (game.mode === "daily") {
    const d = (save.daily[game.date] ||= { done: [], claimed: false });
    if (!d.done.includes(game.dailyIndex)) {
      d.done.push(game.dailyIndex);
      result.reward = 20;
      save.coins += 20;
    }
  } else if (game.mode === "zen") {
    if (!save.zen[game.level.id]) {
      save.zen[game.level.id] = true;
      result.reward = 12;
      save.coins += 12;
    }
  } else if (game.mode === "sprint") {
    game.score++;
    save.sprintBest = Math.max(save.sprintBest, game.score);
    if (!save.zen[game.level.id]) {
      save.zen[game.level.id] = true;
      result.reward = 12;
      save.coins += 12;
    }
    persist();
    const expected = game;
    setTimeout(() => {
      if (game === expected && game.mode === "sprint") {
        if (Date.now() >= game.deadline) finishSprint();
        else nextSprint();
      }
    }, 420);
    return;
  }
  persist();
  const expected = game;
  setTimeout(() => {
    if (game !== expected) return;
    showModal("win", { ...result });
  }, 280);
}
function zenLevel() {
  const pool = data.extra.filter((l) => !save.zen[l.id]);
  const candidates = pool.length ? pool : data.extra;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
function sprintLevel(seed, round) {
  const pool = data.extra.filter((l) => l.par <= 8),
    r = seeded(seed);
  const order = [...pool];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order[round % order.length];
}
function nextSprint() {
  const { seed, round, score, deadline, freezeUsed } = game;
  startGame(sprintLevel(seed, round + 1), "sprint", {
    seed,
    round: round + 1,
    score,
    deadline,
    freezeUsed,
  });
}
function finishSprint() {
  if (game?.mode !== "sprint" || modal?.type === "sprint-end") return;
  game.won = true;
  save.sprintBest = Math.max(save.sprintBest, game.score);
  persist();
  showModal("sprint-end");
}
function updateClock() {
  if (
    game?.mode !== "sprint" ||
    game.won ||
    route !== "play" ||
    pausedReasons.size
  )
    return;
  const left = Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000));
  const el = document.querySelector("#sprint-clock");
  if (el) {
    el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    el.classList.toggle("urgent", left <= 30);
  }
  if (left === 0) finishSprint();
}
function updateDailyClock() {
  const el = document.querySelector("#daily-clock");
  if (!el) return;
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  const sec = Math.ceil((midnight - Date.now()) / 1000);
  el.textContent = `${Math.floor(sec / 3600)} ч ${Math.floor((sec % 3600) / 60)} мин`;
}

function closeModal() {
  modal = null;
  modalRoot.innerHTML = "";
  document.body.classList.remove("has-modal");
  app.inert = pausedReasons.size > 0;
  if (focusBeforeModal?.isConnected) focusBeforeModal.focus();
  else document.querySelector("main button")?.focus();
}
function showModal(type, props = {}) {
  if (!modal) focusBeforeModal = document.activeElement;
  modal = { type, props };
  document.body.classList.add("has-modal");
  app.inert = true;
  const close = button(
    "close-modal",
    "",
    "close",
    "icon-button modal-close",
    'aria-label="Закрыть"',
  );
  let html = "";
  if (type === "settings")
    html = `${close}<h2>Настройки</h2><div class="settings-list">${[
      ["sound", "Звуки", "sound"],
      ["haptic", "Вибрация", "bolt"],
      ["motion", "Анимации", "spark"],
    ]
      .map(
        ([key, label, ico]) =>
          `<button class="setting-row" data-action="setting:${key}" role="switch" aria-checked="${save.settings[key]}"><span>${icon(ico)}${label}</span><img class="toggle" src="${base}art/icons/toggle-${save.settings[key] ? "on" : "off"}.webp" alt=""></button>`,
      )
      .join(
        "",
      )}</div>${button("help", "Как играть", "help", "button secondary full")}`;
  if (type === "help")
    html = `${close}<span class="eyebrow">ВСЁ ПРОСТО</span><h2>Освободите путь</h2><div class="help-demo"><img src="${base}art/${save.theme}/target.webp" alt="">${icon("arrow")}</div><ol class="help-steps"><li>Передвигайте блоки вдоль их длины.</li><li>Доведите яркий блок до выхода справа.</li><li>Уложитесь в цель — получите три звезды.</li></ol><p class="modal-note">Любое расстояние за одно движение — один ход. Подсказки и «Лёгкий шаг» снижают оценку на одну звезду. «Назад» отменяет ход бесплатно.</p>${button("close-modal", "Понятно", "", "button full")}`;
  if (type === "win")
    html = `<div class="win-emblem">${icon(game.mode === "zen" ? "leaf" : "check")}</div><span class="eyebrow">${game.mode === "campaign" ? `УРОВЕНЬ ${game.level.id} ПРОЙДЕН` : "ПУТЬ СВОБОДЕН"}</span><h2>${game.mode === "zen" ? "И стало чуть тише" : props.stars === 3 ? "Идеальный сдвиг" : props.stars === 2 ? "Красивое решение" : "Получилось!"}</h2>${game.mode === "zen" ? "" : `<div class="win-stars">${stars(props.stars)}</div>`}<div class="win-stats"><div><strong>${game.moves}</strong><span>Ходов</span></div><div><strong>${game.level.par}</strong><span>Цель</span></div><div><strong>+${props.reward}</strong><span>Монет</span></div></div>${game.hints ? '<p class="modal-note">С помощью подсказки · до 2 звёзд</p>' : ""}${button("next", game.mode === "campaign" && game.level.id === 420 ? "Весь путь пройден" : game.mode === "daily" && daily().done.length === 3 ? "Забрать награду" : game.mode === "zen" ? "Ещё момент" : "Дальше", "", "button full")}${button("replay", "Ещё раз", "restart", "text-button")}`;
  if (type === "hint")
    html = `${close}<div class="modal-symbol">${icon("hint")}</div><h2>Маленькая помощь</h2><p class="modal-note">Подсветить следующий ход или сделать его автоматически?</p>${button("use-hint", `Показать ход <span>×${save.hints}</span>`, "hint", "button full", save.hints ? "" : "disabled")}${button("use-auto", `Лёгкий шаг <span>×${save.auto}</span>`, "spark", "button secondary full", save.auto ? "" : "disabled")}<p class="modal-note">Помощь снижает оценку на одну звезду.</p>${rewardButton("hint")}${button("boost-shop", "Пополнить запас", "", "text-button")}`;
  if (type === "confirm")
    html = `${close}<h2>${esc(props.title)}</h2><p class="modal-note">${esc(props.text)}</p>${button(props.action, props.label || "Подтвердить", "", "button full")}${button("close-modal", "Отмена", "", "button secondary full")}`;
  if (type === "theme") {
    const t = getTheme(props.id);
    html = `${close}${miniBoard(t)}<h2>Тема ${String(themes.indexOf(t) + 1).padStart(2, "0")}</h2>${button("purchase-theme:" + t.id, `Открыть ${coin(t.price)}`, "", "button full", save.coins < t.price ? "disabled" : "")}${save.coins < t.price ? `<p class="modal-note">Не хватает ${t.price - save.coins} монет</p>` : ""}`;
  }
  if (type === "unlocked") {
    const t = getTheme(props.id);
    html = `${close}${miniBoard(t)}<h2>${t.name}</h2>${button("close-modal", "В игру", "play", "button full")}`;
  }
  if (type === "sprint-end")
    html = `<div class="win-emblem">${icon("bolt")}</div><span class="eyebrow">СПРИНТ ЗАВЕРШЁН</span><h2>${game.score > 0 ? "Хороший темп!" : "Ещё одна попытка?"}</h2><div class="win-stats"><div><strong>${game.score}</strong><span>Решено</span></div><div><strong>${save.sprintBest}</strong><span>Рекорд</span></div></div>${button("sprint-again", "Ещё спринт", "", "button full")}${button("finish-modes", "К режимам", "", "button secondary full")}`;
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal ${["win", "sprint-end"].includes(type) ? "result-modal" : ""}" role="dialog" aria-modal="true" aria-label="${type === "settings" ? "Настройки" : type === "win" ? "Победа" : "Диалог"}">${html}</section></div>`;
  requestAnimationFrame(() =>
    modalRoot.querySelector("button:not([disabled])")?.focus(),
  );
}

async function handle(action) {
  if (pausedReasons.size || rewardPending) return;
  const [kind, arg] = action.split(":");
  if (kind === "reward") {
    const field = { hint: "hints", auto: "auto", freeze: "freeze" }[arg];
    if (!field || !vk.ready || save[field] >= 9999) return;
    rewardPending = true;
    const earned = await vk.reward();
    rewardPending = false;
    if (earned) {
      save[field]++;
      persist();
      playSound("buy");
      render();
      if (modal) showModal(modal.type, modal.props);
      toast(
        "+1 " +
          { hint: "подсказка", auto: "лёгкий шаг", freeze: "запас времени" }[
            arg
          ],
      );
    } else toast("Видео недоступно или просмотр не завершён");
    return;
  }
  if (kind === "nav") {
    if (game?.mode === "sprint" && !game.won && route === "play") {
      showModal("confirm", {
        title: "Выйти из спринта?",
        text: "Таймер продолжит идти. Результат сохранится.",
        action: `leave:${arg}`,
        label: "Выйти",
      });
      return;
    }
    navigate(arg);
    return;
  }
  if (kind === "leave") {
    closeModal();
    navigate(arg);
    return;
  }
  if (kind === "home" || kind === "continue") {
    closeModal();
    openCampaign();
    return;
  }
  if (kind === "chapter") {
    chapter = Number(arg);
    render();
    return;
  }
  if (kind === "level") {
    const level = data.campaign[Number(arg) - 1];
    if (level && unlocked(level.id)) startGame(level);
    return;
  }
  if (kind === "daily") {
    const i = Number(arg);
    startGame(dailyLevels(data.extra)[i], "daily", { dailyIndex: i });
    return;
  }
  if (kind === "claim-daily") {
    const reward = claimDaily(save);
    if (reward) {
      persist();
      playSound("buy");
      toast(`+${reward} монет и подсказка`);
      render();
    }
    return;
  }
  if (kind === "zen") {
    startGame(zenLevel(), "zen");
    return;
  }
  if (kind === "sprint" || kind === "sprint-again") {
    if (
      kind === "sprint" &&
      game?.mode === "sprint" &&
      !game.won &&
      game.deadline > Date.now()
    ) {
      route = "play";
      render();
      return;
    }
    closeModal();
    const seed = hash(String(Date.now()));
    startGame(sprintLevel(seed, 0), "sprint", {
      seed,
      round: 0,
      score: 0,
      deadline: Date.now() + 180000,
      freezeUsed: false,
    });
    return;
  }
  if (kind === "finish-modes") {
    closeModal();
    navigate("modes");
    return;
  }
  if (kind === "end-sprint") {
    finishSprint();
    return;
  }
  if (kind === "freeze") {
    if (
      game?.mode === "sprint" &&
      !game.won &&
      save.freeze > 0 &&
      !game.freezeUsed &&
      Date.now() < game.deadline
    ) {
      save.freeze--;
      game.deadline += 30000;
      game.freezeUsed = true;
      persist();
      render();
      toast("+30 секунд");
    } else if (!save.freeze) toast("Запас можно пополнить в магазине");
    return;
  }
  if (kind === "undo") {
    if (game && !game.won && game.history.length) {
      game.state = game.history.pop();
      game.moves--;
      hint = null;
      persist();
      paintBoard();
      refreshGameStats();
      playSound("move");
    }
    return;
  }
  if (kind === "restart") {
    if (game.moves)
      showModal("confirm", {
        title: "Начать заново?",
        text: "Текущая расстановка будет сброшена.",
        action: "do-restart",
        label: "Заново",
      });
    return;
  }
  if (kind === "do-restart" || kind === "replay") {
    closeModal();
    const g = game;
    startGame(g.level, g.mode, {
      dailyIndex: g.dailyIndex,
      date: g.date,
      seed: g.seed,
      round: g.round,
      score: g.score,
      deadline: g.deadline,
      freezeUsed: g.freezeUsed,
    });
    return;
  }
  if (kind === "hint") {
    if (game && !game.won) showModal("hint");
    return;
  }
  if (kind === "use-hint" || kind === "use-auto") {
    const auto = kind === "use-auto",
      key = auto ? "auto" : "hints";
    if (busy || !save[key] || !game || game.won) return;
    closeModal();
    busy = true;
    toast("Ищем короткий путь…");
    const expected = game,
      state = game.state.join(","),
      path = await findSolution(game);
    busy = false;
    if (
      game !== expected ||
      game.state.join(",") !== state ||
      game.won ||
      route !== "play" ||
      modal
    )
      return;
    if (!path?.length) {
      toast("Попробуйте заново — запас помощи сохранён.");
      return;
    }
    if (game.mode === "sprint" && Date.now() >= game.deadline) {
      finishSprint();
      return;
    }
    save[key]--;
    if (auto) {
      applyMove(path[0].i, path[0].to, true);
      toast("Один шаг ближе");
    } else {
      game.hints++;
      hint = path[0];
      paintBoard();
      refreshGameStats();
      toast("Сдвиньте подсвеченный блок по стрелке");
    }
    persist();
    return;
  }
  if (kind === "next") {
    const g = game;
    await vk.interstitial();
    if (game !== g) return;
    closeModal();
    if (g.mode === "campaign") {
      if (g.level.id < 420) startGame(data.campaign[g.level.id]);
      else navigate("achievements");
    } else if (g.mode === "daily") {
      const next = [0, 1, 2].find((i) => !daily().done.includes(i));
      if (next !== undefined)
        startGame(dailyLevels(data.extra)[next], "daily", { dailyIndex: next });
      else navigate("daily");
    } else startGame(zenLevel(), "zen");
    return;
  }
  if (kind === "shop-tab") {
    shopTab = arg;
    render();
    return;
  }
  if (kind === "theme") {
    if (save.owned.includes(arg)) {
      save.theme = arg;
      persist();
      render();
      playSound("tap");
    } else showModal("theme", { id: arg });
    return;
  }
  if (kind === "purchase-theme") {
    if (buy(save, arg)) {
      persist();
      closeModal();
      render();
      playSound("buy");
      showModal("unlocked", { id: arg });
    }
    return;
  }
  if (kind === "buy") {
    if (buy(save, arg)) {
      persist();
      render();
      playSound("buy");
      toast("Запас пополнен");
    } else toast("Пока не хватает монет");
    return;
  }
  if (kind === "boost-shop") {
    closeModal();
    shopTab = "boosts";
    navigate("shop");
    return;
  }
  if (kind === "achievement") {
    const reward = claimAchievement(save, arg);
    if (reward) {
      persist();
      render();
      playSound("buy");
      toast(`+${reward} монет`);
    }
    return;
  }
  if (kind === "settings" || kind === "help") {
    showModal(kind);
    return;
  }
  if (kind === "setting") {
    if (!["sound", "haptic", "motion"].includes(arg)) return;
    save.settings[arg] = !save.settings[arg];
    persist();
    render();
    showModal("settings");
    return;
  }
  if (kind === "close-modal") {
    closeModal();
    return;
  }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-action]");
  if (b && !b.disabled) handle(b.dataset.action);
  else if (
    e.target.classList.contains("modal-backdrop") &&
    modal &&
    !["win", "sprint-end"].includes(modal.type)
  )
    closeModal();
});
document.addEventListener("pointerdown", (e) => {
  const el = e.target.closest("[data-block]");
  if (!el || game.won || modal || e.button !== 0 || drag || pausedReasons.size)
    return;
  const index = Number(el.dataset.block),
    b = game.level.blocks[index],
    cell = document.querySelector("#board").getBoundingClientRect().width / 6;
  drag = {
    index,
    el,
    start: b.a === "h" ? e.clientX : e.clientY,
    cell,
    p: game.state[index],
    ...bounds(game.level.blocks, game.state, index),
    axis: b.a,
    pointer: e.pointerId,
  };
  el.setPointerCapture(e.pointerId);
  el.classList.add("dragging");
});
document.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pointer) return;
  const raw =
    ((drag.axis === "h" ? e.clientX : e.clientY) - drag.start) / drag.cell;
  const offset = Math.max(drag.min - drag.p, Math.min(drag.max - drag.p, raw));
  drag.offset = offset;
  const transform = `translate${drag.axis === "h" ? "X" : "Y"}(${offset * drag.cell}px)`;
  drag.el.style.setProperty("--drag-transform", transform);
  drag.el.style.transform = transform;
});
function endDrag(e, cancel = false) {
  if (!drag || e.pointerId !== drag.pointer) return;
  const d = drag;
  drag = null;
  d.el.classList.remove("dragging");
  d.el.style.transform = "";
  if (d.el.hasPointerCapture(e.pointerId))
    d.el.releasePointerCapture(e.pointerId);
  if (!cancel) applyMove(d.index, d.p + Math.round(d.offset || 0));
}
document.addEventListener("pointerup", (e) => endDrag(e));
document.addEventListener("pointercancel", (e) => endDrag(e, true));
document.addEventListener("keydown", (e) => {
  if (pausedReasons.size) return;
  if (modal) {
    if (e.key === "Escape" && !["win", "sprint-end"].includes(modal.type)) {
      closeModal();
      return;
    }
    if (e.key === "Tab") {
      const list = [
        ...modalRoot.querySelectorAll("button:not([disabled]),input"),
      ];
      const first = list[0],
        last = list.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    return;
  }
  const el = e.target.closest("[data-block]");
  if (el && game && !game.won) {
    const i = Number(el.dataset.block),
      b = game.level.blocks[i];
    const delta =
      b.a === "h"
        ? { ArrowLeft: -1, ArrowRight: 1 }[e.key]
        : { ArrowUp: -1, ArrowDown: 1 }[e.key];
    if (delta) {
      e.preventDefault();
      applyMove(i, game.state[i] + delta);
      document.querySelector(`[data-block="${i}"]`)?.focus();
    }
  }
});
window.addEventListener("storage", (e) => {
  if (e.key === SAVE_KEY && e.newValue) {
    save = loadSave();
    closeModal();
    game = null;
    if (!restoreGame()) startGame(nextLevel());
    else render();
    toast("Прогресс обновлён из другой вкладки");
  }
});
document.addEventListener("visibilitychange", () => {
  muteAudio(document.hidden || pausedReasons.size > 0);
  if (document.hidden) persist();
  else {
    if (
      game?.mode === "sprint" &&
      !game.won &&
      !pausedReasons.size &&
      Date.now() >= game.deadline
    )
      finishSprint();
    updateClock();
  }
});
let lastDay = dayKey();
setInterval(() => {
  updateClock();
  if (route === "daily") updateDailyClock();
  if (lastDay !== dayKey()) {
    lastDay = dayKey();
    if (route === "daily") render();
  }
}, 1000);
if (!restoreGame()) startGame(nextLevel());
else render();
void connectVK(vk);
if ("serviceWorker" in navigator && import.meta.env.PROD)
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
      .then((reg) => {
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          worker?.addEventListener("statechange", () => {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller
            )
              toast("Обновление готово. Оно появится после закрытия игры.");
          });
        });
      })
      .catch(() =>
        toast("Офлайн-режим пока недоступен. Проверьте соединение."),
      );
  });
