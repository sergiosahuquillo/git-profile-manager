// Sirve site/ en local tal como queda publicado: /shots/ sale de .github/assets/, igual que en
// el workflow de Pages, para no duplicar las capturas.  node scripts/site/serve.mjs  →  http://localhost:4321
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const mounts = [
  ["/shots/", join(root, ".github/assets")],
  ["/", join(root, "site")],
];
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const port = Number(process.env.PORT) || 4321;

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const [prefix, dir] = mounts.find(([p]) => path.startsWith(p));
  let file = normalize(join(dir, path.slice(prefix.length)));
  if (!file.startsWith(dir + sep) && file !== dir) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
    statSync(file);
  } catch {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`http://localhost:${port}`));
