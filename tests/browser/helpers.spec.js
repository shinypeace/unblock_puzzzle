import { test, expect } from "@playwright/test";
import { freshSave, SAVE_KEY } from "../../src/store.js";

test("empty undo runs a rewarded video, commits once, and survives reload", async ({
  page,
}) => {
  await page.addInitScript(
    ({ save, key }) => {
      localStorage.setItem(key, JSON.stringify(save));
      window.adCount = 0;
      window.vkBridge = {
        subscribe() {},
        supports: () => false,
        send: async (method) => {
          if (method === "VKWebAppShowNativeAds") {
            window.adCount++;
            return new Promise((resolve) => {
              window.finishAd = (result) => resolve({ result });
            });
          }
          return { result: true };
        },
      };
    },
    { save: { ...freshSave(), undos: 0 }, key: SAVE_KEY },
  );
  await page.goto("/");
  await expect(page.locator(".undo-button .ad-badge")).toBeVisible();
  await page.locator('[data-block="1"]').press("ArrowUp");
  await expect(page.locator("#moves")).toHaveText("1");
  await page.locator('[data-action="undo"]').click();
  await expect(page.locator("#ad-shield")).toBeVisible();
  await page.evaluate(() => window.finishAd(false));
  await expect(page.locator("#ad-shield")).toBeHidden();
  await expect(page.locator("#moves")).toHaveText("1");
  await page.locator('[data-action="undo"]').click();
  await expect(page.locator("#ad-shield")).toBeVisible();
  await page.evaluate(() => {
    document.querySelector('[data-action="undo"]').click();
    window.finishAd(true);
  });
  await expect(page.locator("#moves")).toHaveText("0");
  await expect(page.locator('[data-action="undo"]')).toBeDisabled();
  const s = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    SAVE_KEY,
  );
  expect(s.undos).toBe(0);
  expect(s.session.history).toHaveLength(0);
  expect(await page.evaluate(() => window.adCount)).toBe(2);
});

test("hint is immediate, repeat tap does not spend again, campaign hides target", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-action="hint"]').click();
  await expect(page.locator(".hinted")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".hint-button b")).toHaveText("2");
  await page.locator('[data-action="hint"]').click();
  await expect(page.locator(".hint-button b")).toHaveText("2");
  await expect(page.getByText("Цель", { exact: true })).toHaveCount(0);
});

test("lists scroll within the shell, reveal final entries and retain position", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto("/");
  for (const [route, final] of [
    ["levels", '[data-action="level:420"]'],
    ["shop", '[data-action="theme:orbit"]'],
    ["achievements", '[data-action="achievement:all-themes"]'],
  ]) {
    await page
      .locator('[data-action="nav:' + route + '"]')
      .last()
      .click();
    await page.locator(final).scrollIntoViewIfNeeded();
    await expect(page.locator(final)).toBeInViewport();
    const top = await page
      .locator(".scroll-list")
      .evaluate((el) => el.scrollTop);
    expect(top).toBeGreaterThan(100);
    await page.locator('[data-action="nav:daily"]').click();
    await expect(page.locator(".daily-page")).toBeVisible();
    await page
      .locator('[data-action="nav:' + route + '"]')
      .last()
      .click();
    await expect(page.locator(final)).toBeInViewport();
    expect(
      await page.locator(".scroll-list").evaluate((el) => el.scrollTop),
    ).toBeCloseTo(top, 0);
    expect(await page.evaluate(() => scrollY)).toBe(0);
  }
});

test("a real touch swipe scrolls levels without moving the app shell", async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== "mobile", "Chromium touch device");
  await page.goto("/");
  await page.locator('[data-action="nav:levels"]').last().click();
  const list = page.locator(".levels-scroll");
  const r = await list.boundingBox();
  const cdp = await context.newCDPSession(page),
    x = r.x + r.width / 2,
    y = r.y + r.height * 0.8;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - i * 22 }],
    });
    await page.waitForTimeout(18);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() => list.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(80);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});
