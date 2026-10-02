import test from "node:test";
import assert from "node:assert/strict";
import { VKPlatform } from "../src/vk.js";
function setup(respond, options = {}) {
  const calls = [],
    pauses = [],
    resumes = [],
    heights = [];
  const vk = new VKPlatform({
    onPause: (r) => pauses.push(r),
    onResume: (r) => resumes.push(r),
    onBanner: (h) => heights.push(h),
    ...options,
  });
  vk.bridge = {
    send: async (method, params) => {
      calls.push({ method, params });
      return respond(method, params);
    },
    supports: () => false,
  };
  vk.ready = true;
  return { vk, calls, pauses, resumes, heights };
}
test("reward requires explicit success; cancellation and rejection never grant", async () => {
  for (const response of [
    { result: true },
    { result: false },
    {},
    null,
    new Error("cancel"),
  ]) {
    const { vk, pauses, resumes } = setup(() => {
      if (response instanceof Error) throw response;
      return response;
    });
    vk.bannerVisible = true;
    vk.lastBanner = Date.now();
    assert.equal(await vk.reward(), response?.result === true);
    assert.equal(vk.busy, false);
    assert.deepEqual(pauses, ["ad"]);
    assert.deepEqual(resumes, ["ad"]);
    vk.dispose();
  }
});
test("concurrent requests show only one video and cannot duplicate its reward", async () => {
  let finish;
  const { vk, calls } = setup(
    () => new Promise((resolve) => (finish = resolve)),
  );
  vk.lastBanner = Date.now();
  const first = vk.reward();
  await Promise.resolve();
  assert.equal(await vk.reward(), false);
  assert.equal(calls.length, 1);
  finish({ result: true });
  assert.equal(await first, true);
  assert.equal(vk.busy, false);
  vk.dispose();
});
test("interstitial waits for three sufficiently long levels and cooldown", async () => {
  let time = 1000;
  const { vk, calls } = setup(() => ({ result: true }), { now: () => time });
  vk.lastBanner = Infinity;
  vk.completedLevel(14999);
  assert.equal(vk.completed, 0);
  for (let i = 0; i < 3; i++) vk.completedLevel(15000);
  assert.equal(await vk.interstitial(), false);
  time += 180000;
  assert.equal(await vk.interstitial(), true);
  assert.equal(vk.completed, 0);
  assert.deepEqual(calls[0], {
    method: "VKWebAppShowNativeAds",
    params: { ad_format: "interstitial" },
  });
  assert.equal(await vk.interstitial(), false);
  vk.dispose();
});
test("banner handles resize, overlay, old clients and close events", async () => {
  let first = true;
  const { vk, calls, heights } = setup(() => {
    if (first) {
      first = false;
      throw { error_data: { error_code: 4 } };
    }
    return { result: true, layout_type: "overlay", banner_height: 70 };
  });
  await vk.banner();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].params, { banner_location: "bottom" });
  assert.equal(heights.at(-1), 70);
  vk.layout({ result: true, layout_type: "resize", banner_height: 70 });
  assert.equal(heights.at(-1), 0);
  vk.event({ type: "VKWebAppBannerAdClosedByUser" });
  assert.equal(vk.bannerVisible, false);
  assert.equal(heights.at(-1), 0);
  vk.dispose();
});
test("failed init stays independent and a timed-out bridge request settles", async () => {
  const vk = new VKPlatform();
  assert.equal(
    await vk.init({ send: () => Promise.reject(Error("offline")) }),
    false,
  );
  vk.bridge = { send: () => new Promise(() => {}) };
  await assert.rejects(vk.send("test", {}, 5), /timeout/);
  vk.dispose();
});
test("legacy interstitial falls back only for unsupported method", async () => {
  const { vk, calls } = setup((method) => {
    if (method === "VKWebAppShowInterstitialAd")
      throw { error_data: { error_code: 3 } };
    return { result: true };
  });
  vk.bridge.supports = () => true;
  vk.lastBanner = Infinity;
  assert.equal(await vk.ad("interstitial"), true);
  assert.equal(calls[1].method, "VKWebAppShowNativeAds");
  vk.dispose();
});
