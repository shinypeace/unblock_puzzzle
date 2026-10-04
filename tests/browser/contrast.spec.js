import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { themes } from "../../src/themes.js";
import { freshSave, SAVE_KEY } from "../../src/store.js";
const luminance = (c) =>
  c
    .map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
test("level numbers contrast with their raster tiles in every theme and state", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "desktop",
    "Raster colors are identical across browsers; layout is covered separately",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of themes) {
    const save = {
      ...freshSave(),
      theme: theme.id,
      owned: themes.map((t) => t.id),
      completed: { 1: { stars: 3, moves: 2 } },
    };
    await page.addInitScript(
      ({ key, save }) => localStorage.setItem(key, JSON.stringify(save)),
      { key: SAVE_KEY, save },
    );
    await page.goto("/");
    await page.locator("#board").waitFor();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme.id);
    await page.locator('[data-action="nav:levels"]').last().click();
    await expect(page.locator(".level-tile")).toHaveCount(420);
    await page.screenshot({ path: info.outputPath(`${theme.id}-levels.png`) });
    const labels = await page.locator(".level-tile strong").evaluateAll((es) =>
      es.slice(0, 3).map((el) => {
        const r = el.getBoundingClientRect(),
          color = getComputedStyle(el)
            .color.match(/\d+/g)
            .slice(0, 3)
            .map(Number);
        el.style.visibility = "hidden";
        return {
          x: Math.ceil(r.x),
          y: Math.ceil(r.y),
          width: Math.floor(r.width) - 1,
          height: Math.floor(r.height) - 1,
          color,
        };
      }),
    );
    const screenshot = await page.screenshot();
    for (const label of labels) {
      const { data, info: pixels } = await sharp(screenshot)
        .extract({
          left: label.x,
          top: label.y,
          width: label.width,
          height: label.height,
        })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const foreground = luminance(label.color),
        ratios = [];
      for (let i = 0; i < data.length; i += pixels.channels) {
        const bg = luminance([...data.subarray(i, i + 3)]);
        ratios.push(
          (Math.max(bg, foreground) + 0.05) / (Math.min(bg, foreground) + 0.05),
        );
      }
      ratios.sort((a, b) => a - b);
      expect(
        ratios[Math.floor(ratios.length * 0.05)],
        `${theme.id} tile text contrast`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});
