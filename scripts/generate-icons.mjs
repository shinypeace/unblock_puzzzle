import fs from "node:fs/promises";
import sharp from "sharp";
await fs.mkdir("public/icons", { recursive: true });
for (const size of [192, 512]) {
  const logo = await sharp("public/art/icons/logo.webp")
    .resize(Math.round(size * 0.72), Math.round(size * 0.72), { fit: "inside" })
    .toBuffer();
  const png = await sharp({
    create: { width: size, height: size, channels: 4, background: "#d9edf6" },
  })
    .composite([{ input: logo, gravity: "centre" }])
    .png()
    .toBuffer();
  await fs.writeFile("public/icons/icon-" + size + ".png", png);
  if (size === 512) await fs.writeFile("public/icons/maskable-512.png", png);
}
