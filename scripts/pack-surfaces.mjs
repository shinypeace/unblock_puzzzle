import fs from "node:fs/promises";
import sharp from "sharp";

// Split only authored raster sprites; preserve transparency and all visible art.
async function regions(file, columns, rows) {
  const {
    data,
    info: { width: w, height: h },
  } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const seen = new Uint8Array(w * h),
    queue = new Int32Array(w * h),
    groups = Array.from({ length: columns * rows }, () => []);
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || data[start * 4 + 3] < 48) continue;
    let head = 0,
      tail = 1,
      x0 = start % w,
      x1 = x0,
      y0 = Math.floor(start / w),
      y1 = y0;
    queue[0] = start;
    seen[start] = 1;
    while (head < tail) {
      const p = queue[head++],
        x = p % w,
        y = Math.floor(p / w);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const q of [
        x ? p - 1 : -1,
        x < w - 1 ? p + 1 : -1,
        y ? p - w : -1,
        y < h - 1 ? p + w : -1,
      ])
        if (q >= 0 && !seen[q] && data[q * 4 + 3] >= 48) {
          seen[q] = 1;
          queue[tail++] = q;
        }
    }
    if (tail < 1000) continue;
    const col = Math.min(
        columns - 1,
        Math.floor(((x0 + x1) / 2 / w) * columns),
      ),
      row = Math.min(rows - 1, Math.floor(((y0 + y1) / 2 / h) * rows));
    groups[row * columns + col].push({ x0, x1, y0, y1, area: tail });
  }
  return groups.map((g) => {
    g.sort((a, b) => b.area - a.area);
    if (!g[0]) throw Error("Missing sprite in " + file);
    const { x0, x1, y0, y1 } = g[0],
      left = Math.max(0, x0 - 2),
      top = Math.max(0, y0 - 2);
    return {
      left,
      top,
      width: Math.min(w, x1 + 3) - left,
      height: Math.min(h, y1 + 3) - top,
    };
  });
}
const file = "art/source/board-surfaces.png",
  rects = await regions(file, 2, 5);
for (const [i, id] of ["studio", "grove", "tide", "ink", "orbit"].entries()) {
  for (const [j, name] of ["frame", "cell"].entries()) {
    const buffer = await sharp(file)
      .extract(rects[i * 2 + j])
      .resize(j ? 96 : 384, j ? 96 : 384, { fit: "fill" })
      .webp({ quality: 95, alphaQuality: 100 })
      .toBuffer();
    await fs.writeFile(`public/art/${id}/${name}.webp`, buffer);
  }
}
const neon = "art/source/orange-blocks.png",
  blocks = await regions(neon, 1, 2);
for (const [i, name] of ["short-0", "long-0"].entries()) {
  await fs.writeFile(
    `public/art/orbit/${name}.webp`,
    await sharp(neon)
      .extract(blocks[i])
      .resize({ width: 480 })
      .webp({ quality: 95, alphaQuality: 100 })
      .toBuffer(),
  );
}
console.log("Packed five frames, five cells and orange neon blocks.");
const newCellSource = "art/source/new-cells.png";
const newCells = await regions(newCellSource, 2, 1);
for (const [i, id] of ["timber", "zenith"].entries()) {
  await fs.writeFile(
    `public/art/${id}/frame.webp`,
    await sharp(`public/art/${id}/board.webp`)
      .resize(384, 384, { fit: "fill" })
      .webp({ quality: 95, alphaQuality: 100 })
      .toBuffer(),
  );
  await fs.writeFile(
    `public/art/${id}/cell.webp`,
    await sharp(newCellSource)
      .extract(newCells[i])
      .resize(96, 96, { fit: "fill" })
      .webp({ quality: 95, alphaQuality: 100 })
      .toBuffer(),
  );
}
const manifest = JSON.parse(
  await fs.readFile("public/art/manifest.json", "utf8"),
);
manifest.version = 4;
manifest.additionalSurfaces = {
  source: newCellSource,
  regions: newCells,
  themes: ["timber", "zenith"],
  framesFromAtlas: "board",
};
manifest.surfaces = {
  source: file,
  columns: 2,
  rows: 5,
  regions: rects,
  frameSize: 384,
  cellSize: 96,
  boardInset: 30,
  frameWidth: 28,
};
manifest.overrides = {
  source: neon,
  regions: blocks,
  sprites: ["orbit/short-0", "orbit/long-0"],
};
await fs.writeFile(
  "public/art/manifest.json",
  JSON.stringify(manifest, null, 2),
);
