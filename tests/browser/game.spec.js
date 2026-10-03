import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { staticServer } from "./static-server.js";
import { freshSave, SAVE_KEY, dayKey, dailyLevels } from "../../src/store.js";
const data = JSON.parse(readFileSync("src/data/levels.json", "utf8"));
async function themePage(page, target) {
  const index = ["studio", "grove", "tide", "ink", "orbit"].indexOf(target);
  let current =
    Number(
      (await page.locator(".shop-page .pager > span").innerText()).split(
        "/",
      )[0],
    ) - 1;
  while (current !== index) {
    current += Math.sign(index - current);
    await page.locator('[data-action="theme-page:' + current + '"]').click();
  }
}
async function seed(page, change = {}) {
  await page.addInitScript(
    ({ key, save }) => {
      localStorage.setItem(key, JSON.stringify(save));
    },
    { key: SAVE_KEY, save: { ...freshSave(), ...change } },
  );
}
async function playSolution(page, level) {
  for (const step of level.solution) {
    const block = page.locator(`[data-block="${step.i}"]`);
    const box = await block.boundingBox(),
      board = await page.locator("#board").boundingBox();
    const current =
      Number(
        (await block.getAttribute("aria-label")).match(/Позиция (\d+)/)[1],
      ) - 1;
    const offset = ((step.to - current) * board.width) / 6;
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(
      x + (level.blocks[step.i].a === "h" ? offset : 0),
      y + (level.blocks[step.i].a === "v" ? offset : 0),
      { steps: 5 },
    );
    await page.mouse.up();
    await page.waitForTimeout(180);
  }
}

test("sixty consecutive campaign puzzles keep input and saves working", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "One sustained pointer-input run");
  test.setTimeout(120000);
  await page.goto("/");
  await page.locator("#board").waitFor();
  for (const level of data.campaign.slice(0, 60)) {
    for (const step of level.solution) {
      const block = page.locator('[data-block="' + step.i + '"]'),
        rect = await block.boundingBox(),
        board = await page.locator("#board").boundingBox();
      const current =
        Number(
          (await block.getAttribute("aria-label")).match(/Позиция (\d+)/)[1],
        ) - 1;
      const delta = ((step.to - current) * board.width) / 6,
        a = level.blocks[step.i].a,
        x = rect.x + rect.width / 2,
        y = rect.y + rect.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(
        x + (a === "h" ? delta : 0),
        y + (a === "v" ? delta : 0),
      );
      await page.mouse.up();
      await expect(block, `level ${level.id}, block ${step.i}`).toHaveAttribute(
        "aria-label",
        new RegExp("Позиция " + (step.to + 1) + "$"),
      );
    }
    await expect(page.locator(".win-stats")).toContainText("+44");
    await page.locator('[data-action="next"]').click();
    await expect(page.locator("h1")).toContainText(
      String(level.id + 1).padStart(2, "0"),
    );
  }
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    SAVE_KEY,
  );
  expect(Object.keys(saved.completed)).toHaveLength(60);
  expect(saved.session.levelId).toBe(61);
  expect(saved.coins).toBe(150 + 60 * 44);
  await page.reload();
  await expect(page.locator("h1")).toContainText("61");
});
test("first level: actual drag, victory, reward, next, reload", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#board")).toBeVisible();
  const boardShape = await page.locator("#board").boundingBox();
  expect(Math.abs(boardShape.width - boardShape.height)).toBeLessThan(1);
  await playSolution(page, data.campaign[0]);
  await expect(
    page.getByRole("heading", { name: "Идеальный сдвиг" }),
  ).toBeVisible();
  await expect(page.locator(".win-stats")).toContainText("+44");
  await page.locator('[data-action="next"]').click();
  await expect(page.locator("h1")).toContainText("02");
  await page.reload();
  await expect(page.locator("h1")).toContainText("02");
  expect(errors).toEqual([]);
});
test("keyboard, undo, restart, hint worker and persistence", async ({
  page,
}) => {
  await page.goto("/");
  const step = data.campaign[0].solution[0],
    b = data.campaign[0].blocks[step.i],
    key =
      b.a === "h"
        ? step.to > b.p
          ? "ArrowRight"
          : "ArrowLeft"
        : step.to > b.p
          ? "ArrowDown"
          : "ArrowUp";
  await page.locator(`[data-block="${step.i}"]`).focus();
  await page.keyboard.press(key);
  await expect(page.locator("#moves")).toHaveText("1");
  await page.locator('[data-action="undo"]').click();
  await expect(page.locator("#moves")).toHaveText("0");
  await page.locator('[data-action="hint"]').click();
  await page.locator('[data-action="use-hint"]').click();
  await expect(page.locator(".hinted")).toBeVisible();
  const s = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    SAVE_KEY,
  );
  expect(s.hints).toBe(2);
  await page.reload();
  const restored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    SAVE_KEY,
  );
  expect(restored.hints).toBe(2);
  expect(restored.session.hints).toBe(1);
});
test("all pages and themes fit viewport, no errors", async ({
  page,
}, testInfo) => {
  await seed(page, {
    coins: 3000,
    owned: ["studio", "grove", "tide", "ink", "orbit"],
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  for (const route of ["levels", "daily", "modes", "shop", "achievements"]) {
    await page.locator(`[data-action="nav:${route}"]:visible`).first().click();
    await expect(page.locator("h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.local/${testInfo.project.name}-${route}.png`,
      fullPage: true,
    });
  }
  await page.locator('[data-action="nav:shop"]:visible').first().click();
  for (const theme of ["grove", "tide", "ink", "orbit", "studio"]) {
    await themePage(page, theme);
    await page.locator(`[data-action="theme:${theme}"]`).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.locator('[data-action="home"]:visible').first().click();
    await expect(page.locator("#board")).toBeVisible();
    await page.screenshot({
      path: `.local/${testInfo.project.name}-play-${theme}.png`,
      fullPage: true,
    });
    await page.locator('[data-action="nav:shop"]:visible').first().click();
  }
  expect(errors).toEqual([]);
});
test("theme purchase and boost insufficient funds", async ({ page }) => {
  await seed(page, { coins: 1460 });
  await page.goto("/");
  await page.locator('[data-action="nav:shop"]:visible').first().click();
  await themePage(page, "grove");
  await page.locator('[data-action="theme:grove"]').click();
  await page.locator('[data-action="purchase-theme:grove"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "grove");
  await page.locator('.modal [data-action="close-modal"]').first().click();
  await page.locator('[data-action="shop-tab:boosts"]').click();
  await page.locator('[data-action="buy:hint"]').click();
  await expect(page.locator("#toast")).toHaveText("Пока не хватает монет");
  await expect(page.locator(".shop-balance")).toContainText("60");
});
test("daily completion and one-time set reward", async ({ page }) => {
  const day = dayKey();
  await seed(page, { daily: { [day]: { done: [0, 1], claimed: false } } });
  await page.goto("/");
  await page.locator('[data-action="nav:daily"]:visible').first().click();
  await page.locator('[data-action="daily:2"]').click();
  await playSolution(page, dailyLevels(data.extra)[2]);
  await expect(page.locator('[data-action="next"]')).toHaveText(
    "Забрать награду",
  );
  await page.locator('[data-action="next"]').click();
  await page.locator('[data-action="claim-daily"]').click();
  await expect(page.locator('[data-action="claim-daily"]')).toBeDisabled();
  const s = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    SAVE_KEY,
  );
  expect(s.coins).toBe(270);
  expect(s.streak).toBe(1);
  expect(s.hints).toBe(4);
});
test("sprint timer, finish and repeat; only hint and undo helpers", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-action="nav:modes"]:visible').first().click();
  await page.locator('[data-action="sprint"]').click();
  await expect(page.locator("#sprint-clock")).toBeVisible();
  await expect(
    page.locator('[data-action="freeze"],[data-action="use-auto"]'),
  ).toHaveCount(0);
  await page.locator('[data-action="end-sprint"]').click();
  await expect(
    page.getByRole("heading", { name: "Ещё одна попытка?" }),
  ).toBeVisible();
  await page.locator('[data-action="sprint-again"]').click();
  await expect(page.locator("#sprint-clock")).toHaveText(/2:5\d|3:00/);
});
test("offline reload after all assets cached", async ({
  page,
  context,
  browserName,
}) => {
  const origin = browserName === "webkit" ? await staticServer() : null;
  await page.goto(origin?.url || "/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  if (origin) {
    await origin.stop();
    await expect(fetch(origin.url)).rejects.toThrow();
  } else await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#board")).toBeVisible();
  await page.locator('[data-action="nav:shop"]:visible').first().click();
  await expect(
    page.getByRole("heading", { name: "Магазин", exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator("img")
      .evaluateAll((imgs) =>
        imgs.every((i) => i.complete && i.naturalWidth > 0),
      ),
  ).toBe(true);
  await context.setOffline(false);
});
test("board and controls stay visible at supported screen sizes", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "One pass through all viewport sizes",
  );
  for (const [width, height] of [
    [320, 568],
    [360, 640],
    [390, 664],
    [430, 932],
    [768, 1024],
    [1366, 768],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.locator("#board").waitFor();
    const layout = await page.evaluate(() => {
      const b = document.querySelector(".board-frame").getBoundingClientRect(),
        c = document.querySelector(".game-controls").getBoundingClientRect(),
        n = document.querySelector(".mobile-nav").getBoundingClientRect();
      return {
        boardBottom: b.bottom,
        controlsBottom: c.bottom,
        controlsTop: c.top,
        navTop: n.height ? n.top : innerHeight,
        wide: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(layout.wide, `${width}×${height} horizontal overflow`).toBe(false);
    expect(layout.boardBottom, `${width}×${height} board`).toBeLessThanOrEqual(
      layout.navTop + 1,
    );
    expect(
      layout.controlsBottom,
      `${width}×${height} controls`,
    ).toBeLessThanOrEqual(layout.navTop + 1);
    await page.screenshot({ path: `.local/viewport-${width}-${height}.png` });
  }
});
test("touch gesture moves a block and cancellation does not commit", async ({
  page,
  context,
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== "chromium" || testInfo.project.name !== "mobile",
    "Chromium touch device",
  );
  await page.goto("/");
  const step = data.campaign[0].solution[0],
    block = page.locator(`[data-block="${step.i}"]`),
    b = await block.boundingBox(),
    board = await page.locator("#board").boundingBox();
  const x = b.x + b.width / 2,
    y = b.y + b.height / 2,
    offset = ((step.to - data.campaign[0].blocks[step.i].p) * board.width) / 6,
    a = data.campaign[0].blocks[step.i].a;
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: x + (a === "h" ? offset : 0), y: y + (a === "v" ? offset : 0) },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await expect(page.locator("#moves")).toHaveText("0");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: x + (a === "h" ? offset : 0), y: y + (a === "v" ? offset : 0) },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator("#moves")).toHaveText("1");
});
