import { test, expect } from "@playwright/test";
import { SAVE_KEY } from "../../src/store.js";
async function bridge(page, result = true) {
  await page.addInitScript((result) => {
    window.vkCalls = [];
    window.vkListeners = [];
    window.adResult = result;
    window.vkBridge = {
      supports: () => false,
      subscribe: (fn) => window.vkListeners.push(fn),
      send: async (method, params) => {
        window.vkCalls.push({ method, params });
        if (method === "VKWebAppShowNativeAds")
          return new Promise((resolve) => {
            window.finishAd = () => resolve({ result: window.adResult });
          });
        if (method === "VKWebAppShowBannerAd")
          return { result: true, layout_type: "overlay", banner_height: 64 };
        return { result: true };
      },
    };
  }, result);
}
test("VK reserves banner space and rewards a completed video once", async ({
  page,
}) => {
  await bridge(page);
  await page.goto("/?vk_app_id=1");
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue(
          "--vk-banner-space",
        ),
      ),
    )
    .toBe("64px");
  const layout = await page.evaluate(() => ({
    bottom: document.querySelector(".mobile-nav").getBoundingClientRect()
      .bottom,
    screen: innerHeight,
  }));
  expect(layout.bottom).toBeLessThanOrEqual(layout.screen - 64 + 1);
  await page.locator('[data-action="hint"]').click();
  await page.locator('[data-action="reward:hint"]').click();
  await expect(page.locator("#ad-shield")).toBeVisible();
  await page.evaluate(() =>
    document.querySelector('[data-action="reward:hint"]').click(),
  );
  expect(
    await page.evaluate(
      () =>
        window.vkCalls.filter((c) => c.method === "VKWebAppShowNativeAds")
          .length,
    ),
  ).toBe(1);
  await page.evaluate(() => window.finishAd());
  await expect(page.locator("#ad-shield")).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)).hints,
        SAVE_KEY,
      ),
    )
    .toBe(4);
});
test("VK cancelled video grants nothing; view pause preserves sprint time", async ({
  page,
}) => {
  await bridge(page, false);
  await page.goto("/?vk_app_id=1");
  await page.locator('[data-action="nav:modes"]').click();
  await page.locator('[data-action="sprint"]').click();
  await page.locator('[data-action="hint"]').click();
  await page.locator('[data-action="reward:hint"]').click();
  const deadline = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)).session.deadline,
    SAVE_KEY,
  );
  await page.waitForTimeout(400);
  await page.evaluate(() => window.finishAd());
  await expect(page.locator("#ad-shield")).toBeHidden();
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    SAVE_KEY,
  );
  expect(saved.hints).toBe(3);
  expect(saved.session.deadline).toBeGreaterThan(deadline + 300);
  await page.evaluate(() =>
    window.vkListeners.forEach((fn) =>
      fn({ detail: { type: "VKWebAppViewRestore" } }),
    ),
  );
  const noExtra = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)).session.deadline,
    SAVE_KEY,
  );
  expect(noExtra).toBe(saved.session.deadline);
});
test("locked themes conceal art; settings stay compact; desktop keeps phone width", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('[data-action="nav:shop"]').first().click();
  await page.locator('[data-action="theme-page:1"]').click();
  await expect(page.locator(".mystery-cover")).toHaveCount(1);
  await expect(page.getByText("Автопарк", { exact: true })).toHaveCount(0);
  await expect(page.locator('img[src*="art/grove/"]')).toHaveCount(0);
  await page.locator('[data-action="settings"]').click();
  await expect(page.getByRole("switch")).toHaveCount(3);
  await expect(
    page.locator(
      '[data-action="export"],[data-action="import"],[data-action="reset-save"]',
    ),
  ).toHaveCount(0);
  expect(
    await page
      .locator(".app-shell")
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(460);
});
