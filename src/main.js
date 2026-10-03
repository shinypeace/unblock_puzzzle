import "@fontsource/nunito/cyrillic-700.css";
import "@fontsource/nunito/cyrillic-900.css";
import "@fontsource/nunito/latin-700.css";
import "@fontsource/nunito/latin-900.css";
import "./raster.css";
import { preloadArt } from "./preload.js";
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
  levelPage = 0,
  themePage = 0,
  awardPage = 0,
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
const boardObserver = new ResizeObserver((entries) => {
  for (const { target, contentRect } of entries) {
    measureBoard(target, contentRect);
  }
});
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
    catalog: data.version,
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
    s.catalog !== data.version ||
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
  cancelDrag();
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
let renderRevision = 0;
async function render() {
  const revision = ++renderRevision;
  cancelDrag();
  applyTheme(save.theme);
  document.documentElement.dataset.motion = save.settings.motion ? "on" : "off";
  const art = (name) => `url("${base}art/${save.theme}/${name}.webp")`;
  for (const name of [
    "background",
    "board",
    "frame",
    "cell",
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
  const stage = document.createElement("div");
  stage.innerHTML = `<div class="app-shell"><header class="topbar"><button class="brand" data-action="home" aria-label="Сдвиг — играть">${logo()}</button><div class="topbar-right"><span class="streak-counter">${icon("flame")} ${currentStreak()}</span><button class="wallet" data-action="nav:shop" aria-label="${save.coins} монет. Открыть магазин">${coin(save.coins)}</button>${button("settings", "", "settings", "icon-button", 'aria-label="Настройки"')}</div></header><main id="main">${route === "play" ? playView() : route === "levels" ? levelsView() : route === "daily" ? dailyView() : route === "modes" ? modesView() : route === "shop" ? shopView() : achievementsView()}</main><nav class="mobile-nav" aria-label="Меню">${navItem("levels", "Играть", "grid")}${navItem("daily", "Сегодня", "sun")}${navItem("modes", "Режимы", "infinity")}${navItem("shop", "Магазин", "shop")}${navItem("achievements", "Награды", "trophy")}</nav></div>`;
  if (route === "play") paintBoard(stage);
  await Promise.all(
    [...stage.querySelectorAll("img")].map((img) =>
      img.decode().catch(() => {}),
    ),
  );
  if (revision !== renderRevision) return;
  app.replaceChildren(...stage.childNodes);
  if (route === "play") {
    fitBoard();
    updateClock();
  }
  if (route === "daily") updateDailyClock();
}
function pageHeading(_eyebrow, title, aside = "") {
  return `<div class="page-heading"><h1>${title}</h1>${aside}</div>`;
}

function playView() {
  const g = game,
    sprint = g.mode === "sprint",
    zen = g.mode === "zen";
  const title =
    g.mode === "campaign"
      ? "Уровень <b>" + String(g.level.id).padStart(2, "0") + "</b>"
      : g.mode === "daily"
        ? "Задача <b>" + (g.dailyIndex + 1) + "/3</b>"
        : sprint
          ? "Спринт"
          : "Дзен";
  return (
    '<section class="play-layout"><div class="game-top panel">' +
    button(
      "nav:levels",
      "",
      "grid",
      "icon-button",
      'aria-label="Выбор уровня"',
    ) +
    "<h1>" +
    title +
    '</h1><div class="game-stats"><div><span>' +
    (sprint ? "Время" : "Ходы") +
    '</span><strong id="moves">' +
    (sprint ? '<span id="sprint-clock"></span>' : zen ? "∞" : g.moves) +
    "</strong></div><div><span>" +
    (sprint ? "Решено" : zen ? "Ритм" : "Цель") +
    "</span><strong>" +
    (sprint ? g.score : zen ? "Свой" : g.level.par) +
    '</strong></div></div></div><div class="board-slot"><div class="board-frame"><div id="board" class="board" role="group" aria-label="Игровое поле 6 на 6. Выведите целевой блок вправо."><div class="board-cells" aria-hidden="true">' +
    Array.from({ length: 36 }, () => '<i class="board-cell"></i>').join("") +
    '</div><div id="blocks"></div></div><div class="exit-marker">' +
    icon("arrow") +
    '</div></div></div><div class="game-controls">' +
    button(
      "undo",
      "<span>Отмена</span>",
      "undo",
      "control-button",
      g.history.length ? "" : "disabled",
    ) +
    button(
      "hint",
      "<span>Подсказка</span><b>" + save.hints + "</b>",
      "hint",
      "control-button hint-button",
    ) +
    "</div>" +
    (sprint
      ? button("end-sprint", "Завершить", "", "text-button sprint-finish")
      : "") +
    "</section>"
  );
}
function pager(action, page, total, label = "") {
  return (
    '<div class="pager">' +
    button(
      action + ":" + (page - 1),
      "",
      "back",
      "icon-button",
      page === 0
        ? 'disabled aria-label="Предыдущая страница"'
        : 'aria-label="Предыдущая страница"',
    ) +
    "<span>" +
    (label || page + 1 + " / " + total) +
    "</span>" +
    button(
      action + ":" + (page + 1),
      "",
      "arrow",
      "icon-button",
      page === total - 1
        ? 'disabled aria-label="Следующая страница"'
        : 'aria-label="Следующая страница"',
    ) +
    "</div>"
  );
}
function levelsView() {
  const levels = data.campaign.slice(
    chapter * 60 + levelPage * 12,
    chapter * 60 + levelPage * 12 + 12,
  );
  return (
    '<div class="content-page levels-page">' +
    pageHeading(
      "",
      "Уровни",
      '<span class="pill">' + icon("star") + totalStars() + "</span>",
    ) +
    '<div class="continue-banner panel"><h2>Уровень ' +
    nextLevel().id +
    "</h2>" +
    button("continue", "Продолжить", "play") +
    '</div><div class="chapter-picker">' +
    button(
      "chapter:" + Math.max(0, chapter - 1),
      "",
      "back",
      "icon-button",
      chapter === 0
        ? 'disabled aria-label="Предыдущая глава"'
        : 'aria-label="Предыдущая глава"',
    ) +
    "<h2>" +
    chapterNames[chapter] +
    "</h2>" +
    button(
      "chapter:" + Math.min(6, chapter + 1),
      "",
      "arrow",
      "icon-button",
      chapter === 6
        ? 'disabled aria-label="Следующая глава"'
        : 'aria-label="Следующая глава"',
    ) +
    '</div><div class="levels-grid">' +
    levels
      .map(
        (l) =>
          '<button class="level-tile ' +
          (save.completed[l.id] ? "complete " : "") +
          (l.id === nextLevel().id ? "current" : "") +
          '" data-action="level:' +
          l.id +
          '" ' +
          (unlocked(l.id) ? "" : "disabled") +
          ' aria-label="Уровень ' +
          l.id +
          '"><strong>' +
          l.id +
          "</strong>" +
          (unlocked(l.id)
            ? stars(save.completed[l.id]?.stars || 0)
            : icon("lock")) +
          "</button>",
      )
      .join("") +
    "</div>" +
    pager("level-page", levelPage, 5) +
    "</div>"
  );
}
function dailyView() {
  const d = daily(),
    ls = dailyLevels(data.extra),
    date = new Date().toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
    });
  const week = Array.from({ length: 7 }, (_, i) => {
    const dt = new Date();
    dt.setDate(dt.getDate() - 6 + i);
    return (
      '<div class="' +
      (save.daily[dayKey(dt)]?.claimed ? "done" : "") +
      '"><span>' +
      dt.toLocaleDateString("ru-RU", { weekday: "short" }) +
      "</span><b>" +
      (save.daily[dayKey(dt)]?.claimed ? "✓" : dt.getDate()) +
      "</b></div>"
    );
  }).join("");
  return (
    '<div class="content-page daily-page">' +
    pageHeading(
      "",
      date,
      '<span class="pill"><span id="daily-clock"></span></span>',
    ) +
    '<div class="daily-hero panel"><div class="daily-title"><img src="' +
    base +
    "art/" +
    save.theme +
    '/chest.webp" alt=""><div><h2>Задачи дня</h2><p>3 задачи — 1 награда</p></div></div><div class="daily-week">' +
    week +
    '</div></div><div class="daily-puzzles">' +
    ls
      .map(
        (l, i) =>
          '<button class="daily-puzzle panel" data-action="daily:' +
          i +
          '"><span class="daily-number">0' +
          (i + 1) +
          "</span><span><strong>" +
          ["Разминка", "Поток", "Вызов"][i] +
          "</strong><small>" +
          (d.done.includes(i) ? "Пройдено" : l.par + " ходов") +
          "</small></span>" +
          icon(d.done.includes(i) ? "check" : "play") +
          "</button>",
      )
      .join("") +
    '</div><div class="daily-reward panel"><div><h3>' +
    (d.claimed ? "До завтра" : "Награда") +
    "</h3><small>" +
    (d.claimed
      ? "Серия: " + currentStreak() + " дн."
      : d.done.length + "/3 · " + coin(100) + " + " + icon("hint")) +
    "</small></div>" +
    button(
      "claim-daily",
      d.claimed ? "Получено" : "Забрать",
      "",
      "button",
      d.claimed || new Set(d.done).size < 3 ? "disabled" : "",
    ) +
    "</div></div>"
  );
}
function modesView() {
  return (
    '<div class="content-page modes-page">' +
    pageHeading("", "Режимы") +
    '<div class="mode-grid">' +
    [
      ["zen", "leaf", "Дзен", "Без времени и звёзд.", "В своём ритме"],
      [
        "sprint",
        "bolt",
        "Спринт",
        "Три минуты на рекорд.",
        "Рекорд: " + save.sprintBest,
      ],
    ]
      .map(
        ([id, ico, title, desc, meta]) =>
          '<article class="mode-card panel"><div class="mode-title">' +
          icon(ico) +
          "<h2>" +
          title +
          "</h2></div><p>" +
          desc +
          '</p><span class="mode-meta">' +
          meta +
          "</span>" +
          button(id, "Играть", "play", "button full") +
          "</article>",
      )
      .join("") +
    "</div></div>"
  );
}
function miniBoard(theme) {
  if (!save.owned.includes(theme.id))
    return (
      '<div class="mystery-cover"><img src="' +
      base +
      "art/" +
      save.theme +
      '/chest.webp" alt="Закрытая тема">' +
      icon("lock") +
      "</div>"
    );
  return (
    '<div class="theme-cover" aria-label="Тема ' +
    theme.name +
    '"><img class="theme-scene" src="' +
    base +
    "art/" +
    theme.id +
    '/background.webp" alt=""><img class="preview-piece" src="' +
    base +
    "art/" +
    theme.id +
    '/target.webp" alt=""></div>'
  );
}
function shopView() {
  const t = themes[themePage],
    owned = save.owned.includes(t.id);
  return (
    '<div class="content-page shop-page">' +
    pageHeading(
      "",
      "Магазин",
      '<span class="shop-balance pill">' + coin(save.coins) + "</span>",
    ) +
    '<div class="segmented">' +
    button(
      "shop-tab:themes",
      "Темы",
      "",
      "button " + (shopTab === "themes" ? "" : "secondary"),
    ) +
    button(
      "shop-tab:boosts",
      "Подсказки",
      "",
      "button " + (shopTab === "boosts" ? "" : "secondary"),
    ) +
    "</div>" +
    (shopTab === "themes"
      ? '<article class="theme-card panel">' +
        miniBoard(t) +
        '<div class="theme-card-content"><h2>' +
        (owned ? t.name : "Тема " + String(themePage + 1).padStart(2, "0")) +
        "</h2><p>" +
        (owned ? t.tag : "Откройте новый мир") +
        "</p>" +
        button(
          "theme:" + t.id,
          save.theme === t.id ? "Выбрана" : owned ? "Применить" : coin(t.price),
          "",
          "button full",
          save.theme === t.id ? "disabled" : "",
        ) +
        "</div></article>" +
        pager("theme-page", themePage, 5)
      : '<article class="boost-card panel"><div class="boost-art">' +
        icon("hint") +
        '</div><h2>Подсказки ×5</h2><p>Покажут следующий ход</p><span class="pill">В запасе: ' +
        save.hints +
        "</span>" +
        button("buy:hint", coin(90), "", "button full") +
        rewardButton() +
        "</article>") +
    "</div>"
  );
}
function achievementsView() {
  return (
    '<div class="content-page awards-page">' +
    pageHeading(
      "",
      "Награды",
      '<span class="pill">' +
        save.claimed.length +
        " / " +
        achievements.length +
        "</span>",
    ) +
    '<div class="profile-stats panel"><div><strong>' +
    Object.keys(save.completed).length +
    "</strong><span>Уровней</span></div><div><strong>" +
    totalStars() +
    "</strong><span>Звёзд</span></div><div><strong>" +
    currentStreak() +
    '</strong><span>Дней</span></div></div><div class="achievements-list">' +
    achievements
      .slice(awardPage * 2, awardPage * 2 + 2)
      .map((a) => {
        const value = Math.min(a.value(save), a.target),
          claimed = save.claimed.includes(a.id),
          ready = value >= a.target;
        return (
          '<article class="achievement panel"><div class="achievement-heading">' +
          icon(a.icon) +
          "<h3>" +
          a.name +
          "</h3></div><p>" +
          a.desc +
          '</p><div class="achievement-bottom"><span>' +
          value +
          " / " +
          a.target +
          "</span>" +
          button(
            "achievement:" + a.id,
            claimed ? "Готово" : ready ? "Забрать" : coin(a.reward),
            claimed ? "check" : "",
            "button small " + (ready && !claimed ? "" : "secondary"),
            !ready || claimed ? "disabled" : "",
          ) +
          "</div></article>"
        );
      })
      .join("") +
    "</div>" +
    pager("award-page", awardPage, 4) +
    "</div>"
  );
}
function fitBoard() {
  boardObserver.disconnect();
  const slot = document.querySelector(".board-slot");
  if (slot) {
    // The first visible frame must already have usable geometry. Observer
    // delivery is asynchronous and can arrive after the player's first touch.
    measureBoard(slot, slot.getBoundingClientRect());
    boardObserver.observe(slot);
  }
}
function measureBoard(slot, rect) {
  const frame = slot.querySelector(".board-frame");
  if (!frame) return;
  const size = Math.floor(Math.min(rect.width, rect.height)) + "px";
  if (frame.style.getPropertyValue("--board-size") === size) return;
  cancelDrag();
  frame.style.setProperty("--board-size", size);
}

function paintBoard(scope = document) {
  cancelDrag();
  const root = scope.querySelector("#blocks");
  if (!root || !game) return;
  const artKey = game.level.id + ":" + save.theme;
  if (root.dataset.artKey !== artKey) {
    root.innerHTML = game.level.blocks
      .map(
        (b, i) =>
          `<button class="block ${i === 0 ? "target-block" : ""} ${hint?.i === i ? "hinted" : ""}" data-block="${i}" style="left:${((b.a === "h" ? game.state[i] : b.f) / 6) * 100}%;top:${((b.a === "v" ? game.state[i] : b.f) / 6) * 100}%;width:${((b.a === "h" ? b.n : 1) / 6) * 100}%;height:${((b.a === "v" ? b.n : 1) / 6) * 100}%" aria-label="${i === 0 ? "Целевой" : b.a === "h" ? "Горизонтальный" : "Вертикальный"} блок ${i + 1}. ${b.n} клетки. Позиция ${game.state[i] + 1}" ${game.won ? "disabled" : ""}><img class="block-art ${b.a === "v" ? "vertical" : ""}" style="--length:${b.n}" src="${base}art/${save.theme}/${i === 0 ? "target" : `${b.n === 2 ? "short" : "long"}-${(i - 1) % 3}`}.webp" alt="" draggable="false">${hint?.i === i ? `<span class="hint-arrow ${b.a === "v" ? "vertical" : ""} ${hint.to < game.state[i] ? "reverse" : ""}">${icon("arrow")}</span>` : ""}</button>`,
      )
      .join("");
    root.dataset.artKey = artKey;
  }
  for (const [i, el] of [...root.children].entries()) {
    const b = game.level.blocks[i];
    el.style.left = ((b.a === "h" ? game.state[i] : b.f) / 6) * 100 + "%";
    el.style.top = ((b.a === "v" ? game.state[i] : b.f) / 6) * 100 + "%";
    el.setAttribute(
      "aria-label",
      el
        .getAttribute("aria-label")
        .replace(/Позиция \d+/, "Позиция " + (game.state[i] + 1)),
    );
    el.disabled = game.won;
    el.classList.toggle("hinted", hint?.i === i);
    el.querySelector(".hint-arrow")?.remove();
    if (hint?.i === i)
      el.insertAdjacentHTML(
        "beforeend",
        '<span class="hint-arrow ' +
          (b.a === "v" ? "vertical " : "") +
          (hint.to < game.state[i] ? "reverse" : "") +
          '">' +
          icon("arrow") +
          "</span>",
      );
  }
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
async function showModal(type, props = {}) {
  cancelDrag();
  if (!modal) focusBeforeModal = document.activeElement;
  modal = { type, props };
  const expectedModal = modal;
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
      )}</div>${button("help", "Как играть", "help", "button secondary full")}${game && !game.won ? button("restart", "Заново", "restart", "button secondary full", game.moves ? "" : "disabled") : ""}`;
  if (type === "help")
    html = `${close}<h2>Как играть</h2><div class="help-demo"><img src="${base}art/${save.theme}/target.webp" alt="">${icon("arrow")}</div><ol class="help-steps"><li>Двигайте блоки вдоль их длины.</li><li>Выведите яркий блок вправо.</li><li>Решите за цель — получите 3 звезды.</li></ol><p class="modal-note">Любое расстояние — один ход. Подсказка: до 2 звёзд. Отмена бесплатна.</p>${button("close-modal", "Понятно", "", "button full")}`;
  if (type === "win")
    html = `<div class="win-emblem">${icon(game.mode === "zen" ? "leaf" : "check")}</div><span class="eyebrow">${game.mode === "campaign" ? `УРОВЕНЬ ${game.level.id} ПРОЙДЕН` : "ПУТЬ СВОБОДЕН"}</span><h2>${game.mode === "zen" ? "И стало чуть тише" : props.stars === 3 ? "Идеальный сдвиг" : props.stars === 2 ? "Красивое решение" : "Получилось!"}</h2>${game.mode === "zen" ? "" : `<div class="win-stars">${stars(props.stars)}</div>`}<div class="win-stats"><div><strong>${game.moves}</strong><span>Ходов</span></div><div><strong>${game.level.par}</strong><span>Цель</span></div><div><strong>+${props.reward}</strong><span>Монет</span></div></div>${game.hints ? '<p class="modal-note">С помощью подсказки · до 2 звёзд</p>' : ""}${button("next", game.mode === "campaign" && game.level.id === 420 ? "Весь путь пройден" : game.mode === "daily" && daily().done.length === 3 ? "Забрать награду" : game.mode === "zen" ? "Ещё момент" : "Дальше", "", "button full")}${button("replay", "Ещё раз", "restart", "text-button")}`;
  if (type === "hint")
    html =
      close +
      '<div class="modal-symbol">' +
      icon("hint") +
      '</div><h2>Подсказка</h2><p class="modal-note">Следующий ход · до двух звёзд</p>' +
      button(
        "use-hint",
        "Показать ход ×" + save.hints,
        "hint",
        "button full",
        save.hints ? "" : "disabled",
      ) +
      rewardButton() +
      button("boost-shop", "Пополнить запас", "", "text-button");
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
  const stage = document.createElement("div");
  stage.innerHTML = `<div class="modal-backdrop"><section class="modal panel ${["win", "sprint-end"].includes(type) ? "result-modal" : ""}" role="dialog" aria-modal="true" aria-label="${type === "settings" ? "Настройки" : type === "win" ? "Победа" : "Диалог"}">${html}</section></div>`;
  await Promise.all(
    [...stage.querySelectorAll("img")].map((img) =>
      img.decode().catch(() => {}),
    ),
  );
  if (modal !== expectedModal) return;
  modalRoot.replaceChildren(...stage.childNodes);
  requestAnimationFrame(() =>
    modalRoot.querySelector("button:not([disabled])")?.focus(),
  );
}

async function handle(action) {
  if (pausedReasons.size || rewardPending) return;
  const [kind, arg] = action.split(":");
  if (kind === "reward") {
    const field = { hint: "hints" }[arg];
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
    chapter = Math.max(0, Math.min(6, Number(arg)));
    levelPage = 0;
    render();
    return;
  }
  if (kind === "level-page" || kind === "theme-page" || kind === "award-page") {
    const page = Number(arg);
    if (!Number.isInteger(page)) return;
    if (kind === "level-page") levelPage = Math.max(0, Math.min(4, page));
    if (kind === "theme-page") themePage = Math.max(0, Math.min(4, page));
    if (kind === "award-page") awardPage = Math.max(0, Math.min(3, page));
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
  if (kind === "use-hint") {
    const key = "hints";
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
    game.hints++;
    hint = path[0];
    paintBoard();
    refreshGameStats();
    toast("Сдвиньте подсвеченный блок по стрелке");
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
  if (drag && (!drag.el.isConnected || e.isPrimary)) cancelDrag();
  const el = e.target.closest("[data-block]");
  if (
    !el ||
    !game ||
    game.won ||
    modal ||
    e.button !== 0 ||
    drag ||
    pausedReasons.size
  )
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
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    cancelDrag();
    return;
  }
  el.classList.add("dragging");
});
document.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.pointer) return;
  if (!drag.el.isConnected || (e.pointerType === "mouse" && e.buttons === 0)) {
    cancelDrag();
    return;
  }
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
function cancelDrag() {
  if (drag) endDrag({ pointerId: drag.pointer }, true);
}
document.addEventListener("lostpointercapture", (e) => {
  if (drag?.el === e.target && !drag.el.hasPointerCapture(e.pointerId))
    endDrag(e, true);
});
window.addEventListener("blur", cancelDrag);
window.addEventListener("pagehide", cancelDrag);
document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("gesturestart", (e) => e.preventDefault(), {
  passive: false,
});
document.addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey) e.preventDefault();
  },
  { passive: false },
);
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
  if (document.hidden) {
    cancelDrag();
    persist();
  } else {
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
async function boot() {
  try {
    await preloadArt(base, (n) => {
      document.querySelector("#loading-progress").textContent = n + "%";
    });
    if (!restoreGame()) startGame(nextLevel());
    else render();
    document.documentElement.dataset.ready = "true";
    void connectVK(vk);
  } catch {
    app.innerHTML =
      '<div class="loading"><p>Не удалось загрузить игру</p><button onclick="location.reload()">Повторить</button></div>';
  }
}
app.innerHTML =
  '<div class="loading"><img src="' +
  base +
  'art/icons/logo.webp" alt=""><strong>СДВИГ</strong><span id="loading-progress">0%</span></div>';
void boot();
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
