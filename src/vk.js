// VK Bridge is loaded only inside VK. Ordinary web/PWA sessions stay independent.
const unsupported = (e) => [3, 4].includes(Number(e?.error_data?.error_code));
export class VKPlatform {
  constructor({
    onPause = () => {},
    onResume = () => {},
    onBanner = () => {},
    onReady = () => {},
    now = () => Date.now(),
    hidden = () => false,
  } = {}) {
    Object.assign(this, { onPause, onResume, onBanner, onReady, now, hidden });
    this.ready = false;
    this.busy = false;
    this.bannerVisible = false;
    this.bannerPending = false;
    this.lastBanner = -Infinity;
    this.lastAd = this.now();
    this.completed = 0;
    this.retry = null;
  }
  async send(method, params = {}, timeout = 120000) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => this.bridge.send(method, params)),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("VK timeout: " + method)),
            timeout,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async init(bridge) {
    this.bridge = bridge;
    try {
      await this.send("VKWebAppInit", {}, 7000);
      this.ready = true;
      bridge.subscribe?.((event) => this.event(event.detail || event));
      this.onReady();
      void this.banner();
      // Unsupported desktop clients simply ignore this optional request.
      void this.send(
        "VKWebAppSetOrientation",
        { orientation: "portrait" },
        3000,
      ).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }
  layout(data = {}) {
    const height =
      data.result !== false && data.layout_type === "overlay"
        ? Math.min(150, Math.max(0, Number(data.banner_height) || 0))
        : 0;
    this.onBanner(height);
  }
  retryBanner(delay = 60000) {
    clearTimeout(this.retry);
    this.retry = setTimeout(() => {
      if (!this.hidden()) void this.banner(true);
    }, delay);
  }
  async banner(force = false) {
    if (
      !this.ready ||
      this.busy ||
      this.bannerPending ||
      this.hidden() ||
      (!force && this.bannerVisible) ||
      this.now() - this.lastBanner < 15000
    )
      return;
    this.lastBanner = this.now();
    this.bannerPending = true;
    try {
      let data;
      try {
        data = await this.send(
          "VKWebAppShowBannerAd",
          {
            banner_location: "bottom",
            layout_type: "resize",
            can_close: false,
          },
          10000,
        );
      } catch (e) {
        if (!unsupported(e)) throw e;
        data = await this.send(
          "VKWebAppShowBannerAd",
          { banner_location: "bottom" },
          10000,
        );
      }
      this.bannerVisible = data?.result === true;
      this.layout(data);
      if (!this.bannerVisible) this.retryBanner();
    } catch {
      this.bannerVisible = false;
      this.onBanner(0);
      this.retryBanner();
    } finally {
      this.bannerPending = false;
    }
  }
  event({ type, data = {} }) {
    if (type === "VKWebAppViewHide") this.onPause("view");
    if (type === "VKWebAppViewRestore") {
      this.onResume("view");
      void this.banner(true);
    }
    if (type === "VKWebAppBannerAdUpdated") {
      this.bannerVisible = data.result !== false;
      this.layout(data);
    }
    if (type === "VKWebAppBannerAdClosedByUser") {
      this.bannerVisible = false;
      this.onBanner(0);
      this.retryBanner(15000);
    }
  }
  completedLevel(duration) {
    if (duration >= 15000) this.completed++;
  }
  async interstitial() {
    if (
      !this.ready ||
      this.busy ||
      this.hidden() ||
      this.completed < 2 ||
      this.now() - this.lastAd < 120000
    )
      return false;
    this.completed = 0;
    return this.ad("interstitial");
  }
  async reward() {
    return this.ad("reward");
  }
  async ad(format) {
    if (!this.ready || this.busy || this.hidden()) return false;
    this.busy = true;
    this.lastAd = this.now();
    this.onPause("ad");
    try {
      let result;
      if (
        format === "interstitial" &&
        this.bridge.supports?.("VKWebAppShowInterstitialAd")
      ) {
        try {
          result = await this.send("VKWebAppShowInterstitialAd");
        } catch (e) {
          if (!unsupported(e)) throw e;
          result = await this.send("VKWebAppShowNativeAds", {
            ad_format: format,
          });
        }
      } else
        result = await this.send("VKWebAppShowNativeAds", {
          ad_format: format,
        });
      // A fulfilled Promise alone is not evidence that the rewarded video finished.
      return result?.result === true;
    } catch {
      return false;
    } finally {
      this.busy = false;
      this.onResume("ad");
      void this.banner(true);
    }
  }
  dispose() {
    clearTimeout(this.retry);
  }
}
export async function connectVK(platform) {
  if (
    !new URLSearchParams(location.search).has("vk_app_id") &&
    !window.vkBridge
  )
    return false;
  try {
    const bridge =
      window.vkBridge || (await import("@vkontakte/vk-bridge")).default;
    return platform.init(bridge);
  } catch {
    return false;
  }
}
