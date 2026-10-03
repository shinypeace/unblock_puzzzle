// Retain decoded sprites across route changes, including CSS-only surfaces.
import { themes } from "./themes.js";
const decoded = [];
export async function preloadArt(base, progress) {
  const names = [
    "background",
    "frame",
    "cell",
    "target",
    "short-0",
    "short-1",
    "short-2",
    "long-0",
    "long-1",
    "long-2",
    "primary",
    "secondary",
    "round",
    "panel",
    "tab-on",
    "tab-off",
    "tile",
    "chest",
  ];
  const icons = [
    "coin",
    "star",
    "trophy",
    "settings",
    "hint",
    "undo",
    "restart",
    "arrow",
    "back",
    "chevron",
    "play",
    "pause",
    "grid",
    "sun",
    "infinity",
    "shop",
    "leaf",
    "bolt",
    "close",
    "check",
    "lock",
    "clock",
    "sound",
    "mute",
    "help",
    "flame",
    "gift",
    "spark",
    "palette",
    "heart",
    "logo",
    "toggle-on",
    "toggle-off",
  ];
  const urls = themes
    .flatMap((t) => names.map((n) => `${base}art/${t.id}/${n}.webp`))
    .concat(icons.map((n) => `${base}art/icons/${n}.webp`));
  let cursor = 0,
    complete = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (cursor < urls.length) {
        const img = new Image();
        img.src = urls[cursor++];
        await img.decode();
        decoded.push(img);
        progress(Math.round((++complete / urls.length) * 100));
      }
    }),
  );
  await Promise.all(
    [700, 900].map((w) =>
      document.fonts.load(`${w} 16px Nunito`, "Сдвиг 0123456789"),
    ),
  );
  await document.fonts.ready;
  // Prime CSS image resources too: those have a separate first-use lifecycle.
  const surfaces = document.createElement("div");
  surfaces.setAttribute("aria-hidden", "true");
  surfaces.inert = true;
  surfaces.style.cssText =
    "position:fixed;inset:0;z-index:-100;opacity:0;pointer-events:none;overflow:hidden";
  for (const url of urls) {
    const tile = document.createElement("i");
    tile.style.cssText = `display:block;width:1px;height:1px;background-image:url("${url}");border:1px solid transparent;border-image:url("${url}") 20 fill / 1px`;
    surfaces.append(tile);
  }
  document.body.append(surfaces);
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
}
