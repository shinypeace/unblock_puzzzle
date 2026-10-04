import { test, expect } from "@playwright/test";
import { SAVE_KEY, freshSave } from "../../src/store.js";

test("VK account sync across isolated devices, offline purchase, reload and account switch", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const accounts = new Map(),
    failures = new Set();
  const contexts = [];
  async function device(label, seed) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    contexts.push(context);
    await context.exposeBinding(
      "cloudBridge",
      async (_, { method, params, uid }) => {
        const values = accounts.get(uid) || new Map();
        accounts.set(uid, values);
        if (method.startsWith("VKWebAppStorage") && failures.has(label))
          throw Error("offline");
        if (method === "VKWebAppStorageGetKeys")
          return {
            keys: [...values.keys()]
              .sort()
              .slice(params.offset, params.offset + params.count),
          };
        if (method === "VKWebAppStorageGet")
          return {
            keys: params.keys.map((key) => ({
              key,
              value: values.get(key) || "",
            })),
          };
        if (method === "VKWebAppStorageSet") {
          values.set(params.key, params.value);
          return { result: true };
        }
        if (method === "VKWebAppShowBannerAd")
          return { result: true, layout_type: "resize" };
        return { result: true };
      },
    );
    await context.addInitScript(
      ({ seed, key }) => {
        if (seed && !localStorage.getItem(key))
          localStorage.setItem(key, JSON.stringify(seed));
        window.vkListeners = [];
        window.vkBridge = {
          subscribe: (fn) => window.vkListeners.push(fn),
          supports: () => false,
          send: (method, params = {}) =>
            window.cloudBridge({
              method,
              params,
              uid: new URLSearchParams(location.search).get("vk_user_id"),
            }),
        };
      },
      { seed, key: SAVE_KEY },
    );
    return context.newPage();
  }
  const profile = `${SAVE_KEY}.vk.1.7`;
  const read = (page) =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key)), profile);
  const refresh = (page) =>
    page.evaluate(() =>
      window.vkListeners.forEach((fn) =>
        fn({ detail: { type: "VKWebAppViewRestore" } }),
      ),
    );
  try {
    const s = {
      ...freshSave(),
      coins: 600,
      owned: ["studio", "grove"],
      theme: "grove",
      completed: { 1: { stars: 3, moves: 2 } },
    };
    const pc = await device("pc", s);
    await pc.goto("/?vk_app_id=1&vk_user_id=7");
    await expect(pc.locator("#board")).toBeVisible();
    await expect
      .poll(
        () =>
          [...(accounts.get("7")?.keys() || [])].filter((k) =>
            /_[a-f0-9]{24}$/.test(k),
          ).length,
      )
      .toBe(1);
    const legacyPhone = {
      ...freshSave(),
      coins: 450,
      owned: ["studio", "tide"],
      theme: "tide",
      completed: { 2: { stars: 3, moves: 3 } },
    };
    const phone = await device("phone", legacyPhone);
    await phone.goto("/?vk_app_id=1&vk_user_id=7");
    await expect(phone.locator("#board")).toBeVisible();
    await expect
      .poll(async () => Object.keys((await read(phone)).completed).length)
      .toBe(2);
    await phone.locator('[data-action="nav:shop"]').last().click();
    await phone.locator('[data-action="shop-tab:boosts"]').click();
    await phone.locator('[data-action="buy:hint"]').click();
    await expect.poll(async () => (await read(phone)).coins).toBe(300);
    await expect
      .poll(
        async () => {
          await refresh(pc);
          return (await read(pc)).coins;
        },
        { timeout: 20000 },
      )
      .toBe(300);
    expect((await read(pc)).owned).toEqual(["grove", "studio", "tide"]);
    await pc.locator('[data-action="hint"]').click();
    await expect(pc.locator(".hinted")).toBeVisible();
    await expect
      .poll(
        async () => {
          await refresh(phone);
          return (await read(phone)).hints;
        },
        { timeout: 20000 },
      )
      .toBe(5);
    failures.add("phone");
    await phone.locator('[data-action="buy:undo"]').click();
    await expect.poll(async () => (await read(phone)).coins).toBe(100);
    await phone.reload();
    await expect(phone.locator("#board")).toBeVisible();
    expect((await read(phone)).coins).toBe(100);
    expect((await read(phone)).undos).toBe(10);
    failures.delete("phone");
    await refresh(phone);
    await expect
      .poll(
        async () => {
          await refresh(pc);
          return (await read(pc)).coins;
        },
        { timeout: 20000 },
      )
      .toBe(100);
    expect((await read(pc)).undos).toBe(10);
    await phone.goto("/?vk_app_id=1&vk_user_id=8");
    await expect(phone.locator("#board")).toBeVisible();
    const other = await phone.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      `${SAVE_KEY}.vk.1.8`,
    );
    expect(other.coins).toBe(150);
    expect(other.owned).toEqual(["studio"]);
    expect(other.completed).toEqual({});
    await phone.goto("/?vk_app_id=1&vk_user_id=7");
    await expect(phone.locator("#board")).toBeVisible();
    expect((await read(phone)).coins).toBe(100);
    expect((await read(phone)).hints).toBe(5);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
