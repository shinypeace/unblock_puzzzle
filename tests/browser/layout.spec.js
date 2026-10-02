import { test, expect } from "@playwright/test";
import { freshSave, SAVE_KEY } from "../../src/store.js";
import { readFileSync } from "node:fs";
const data = JSON.parse(readFileSync("src/data/levels.json", "utf8"));
const themes = ["studio", "grove", "tide", "ink", "orbit"];
for (const theme of themes)
  test(`${theme}: exact cells, static pages and safe panel contents`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const save = { ...freshSave(), theme, owned: themes };
    await page.addInitScript(
      ({ key, save }) => localStorage.setItem(key, JSON.stringify(save)),
      { key: SAVE_KEY, save },
    );
    await page.goto("/");
    await page.locator("#board").waitFor();
    await page.evaluate(() =>
      document.documentElement.style.setProperty("--vk-banner-space", "64px"),
    );
    await page.waitForTimeout(100);
    const geometry = await page.locator("#board").evaluate((board, level) => {
      const b = board.getBoundingClientRect(),
        cells = [...board.querySelectorAll(".board-cell")].map((e) =>
          e.getBoundingClientRect(),
        );
      const errors = [];
      cells.forEach((r, i) => {
        if (
          Math.abs(r.left - (b.left + ((i % 6) * b.width) / 6)) > 0.1 ||
          Math.abs(r.top - (b.top + (Math.floor(i / 6) * b.height) / 6)) > 0.1
        )
          errors.push("cell " + i);
      });
      board.querySelectorAll(".block").forEach((el, i) => {
        const r = el.getBoundingClientRect(),
          a = el.querySelector("img").getBoundingClientRect(),
          block = level.blocks[i];
        const x = block.a === "h" ? block.p : block.f,
          y = block.a === "v" ? block.p : block.f;
        if (
          Math.abs(r.left - (b.left + (x * b.width) / 6)) > 0.1 ||
          Math.abs(r.top - (b.top + (y * b.width) / 6)) > 0.1
        )
          errors.push("block " + i);
        if (
          a.left < r.left - 0.1 ||
          a.top < r.top - 0.1 ||
          a.right > r.right + 0.1 ||
          a.bottom > r.bottom + 0.1
        )
          errors.push("art " + i);
      });
      return { errors, width: b.width, height: b.height };
    }, data.campaign[0]);
    expect(geometry.errors).toEqual([]);
    expect(geometry.width).toBeGreaterThan(160);
    expect(Math.abs(geometry.width - geometry.height)).toBeLessThan(0.1);
    for (const route of [
      "play",
      "levels",
      "daily",
      "modes",
      "shop",
      "achievements",
      "settings",
      "help",
    ]) {
      if (route === "settings" || route === "help")
        await page.locator('[data-action="' + route + '"]').click();
      else if (route !== "play")
        await page
          .locator('[data-action="nav:' + route + '"]')
          .last()
          .click();
      await page.waitForTimeout(70);
      const problems = await page.evaluate(() => {
        const issues = [],
          main = document.querySelector("#main"),
          m = main.getBoundingClientRect();
        if (main.scrollHeight > main.clientHeight + 1)
          issues.push(
            "main scroll " + main.scrollHeight + "/" + main.clientHeight,
          );
        if (document.documentElement.scrollHeight > innerHeight)
          issues.push("document scroll");
        const panels = document.querySelector("#modal-root").children.length
          ? document.querySelectorAll(".modal")
          : document.querySelectorAll("#main .panel");
        for (const p of panels) {
          const r = p.getBoundingClientRect(),
            style = getComputedStyle(p);
          for (const child of p.children) {
            const c = child.getBoundingClientRect();
            if (
              c.width &&
              c.height &&
              (c.left < r.left + parseFloat(style.paddingLeft) - 1 ||
                c.right > r.right - parseFloat(style.paddingRight) + 1 ||
                c.top < r.top + parseFloat(style.paddingTop) - 1 ||
                c.bottom > r.bottom - parseFloat(style.paddingBottom) + 1)
            )
              issues.push(
                p.className + " > " + child.className + " outside safe inset",
              );
          }
        }
        for (const el of document.querySelectorAll("#main button,#main h1")) {
          const r = el.getBoundingClientRect();
          if (
            r.top < m.top - 1 ||
            r.bottom > m.bottom + 1 ||
            r.left < m.left - 1 ||
            r.right > m.right + 1
          )
            issues.push(el.className + " outside main");
        }
        for (const i of document.images)
          if (!i.complete || !i.naturalWidth) issues.push("unloaded " + i.src);
        return issues;
      });
      await page.screenshot({
        path:
          ".local/check-" +
          info.project.name +
          "-" +
          theme +
          "-" +
          route +
          ".png",
      });
      expect(problems, theme + " " + route).toEqual([]);
    }
  });

test("drag recovers after lost capture, focus loss and route replacement", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#board").waitFor();
  const step = data.campaign[0].solution[0],
    b = data.campaign[0].blocks[step.i];
  for (const reason of ["capture", "blur", "route"]) {
    const block = page.locator('[data-block="' + step.i + '"]'),
      box = await block.boundingBox();
    await block.evaluate((el) =>
      el.addEventListener(
        "pointerdown",
        (e) => {
          el.dataset.testPointer = String(e.pointerId);
        },
        { once: true },
      ),
    );
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    if (reason === "capture")
      await block.evaluate((el) =>
        el.releasePointerCapture(Number(el.dataset.testPointer)),
      );
    if (reason === "blur")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    if (reason === "route")
      await page.evaluate(() =>
        document.querySelector('[data-action="nav:daily"]').click(),
      );
    await page.mouse.up();
    if (reason === "route") await page.locator('[data-action="home"]').click();
    const r = await block.boundingBox(),
      board = await page.locator("#board").boundingBox(),
      delta = ((step.to - b.p) * board.width) / 6;
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      r.x + r.width / 2 + (b.a === "h" ? delta : 0),
      r.y + r.height / 2 + (b.a === "v" ? delta : 0),
      { steps: 4 },
    );
    await page.mouse.up();
    await expect(page.locator("#moves")).toHaveText("1");
    await page.locator('[data-action="undo"]').click();
    await expect(page.locator("#moves")).toHaveText("0");
  }
});
