import { defineConfig } from "vite";
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
const musicFile = [
  "public/music.png",
  "music.png",
  "public/music.mp3",
  "music.mp3",
].find(existsSync);
const musicName = musicFile?.split("/").at(-1) || null;
export default defineConfig({
  base: "./",
  define: { __MUSIC_FILE__: JSON.stringify(musicName) },
  build: { target: "es2020", chunkSizeWarningLimit: 750 },
  plugins: [
    {
      name: "offline-manifest",
      closeBundle() {
        // A root-level upload is accepted as well as the normal public/ location.
        if (musicFile) copyFileSync(musicFile, join("dist", musicName));
        const list = [];
        function walk(path = "") {
          for (const entry of readdirSync(join("dist", path), {
            withFileTypes: true,
          })) {
            const p = path ? `${path}/${entry.name}` : entry.name;
            if (entry.isDirectory()) walk(p);
            else if (p !== "sw.js") list.push(p);
          }
        }
        walk();
        const digest = createHash("sha256");
        for (const f of list) digest.update(readFileSync(join("dist", f)));
        const version = digest.digest("hex").slice(0, 12);
        writeFileSync(
          "dist/sw.js",
          `const CACHE='sdvig-${version}';const FILES=${JSON.stringify(list.map((f) => "./" + f))};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('sdvig-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;event.respondWith(caches.open(CACHE).then(async cache=>{const key=event.request.mode==='navigate'?new URL('index.html',self.registration.scope).href:event.request;return (await cache.match(key,{ignoreVary:true}))||fetch(event.request);}));});`,
        );
      },
    },
  ],
});
