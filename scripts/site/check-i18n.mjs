// Comprueba los textos de la web: los dos idiomas con las mismas claves y los mismos huecos {{x}},
// ninguna clave usada sin texto y ningún texto sin usar. Lo ejecuta el workflow de Pages.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const site = resolve(import.meta.dirname, "../../site");
const langs = ["en", "es"];

const flatten = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "string" ? [[prefix + k, v]] : flatten(v, `${prefix}${k}.`),
  );
const catalogs = Object.fromEntries(
  langs.map((l) => [l, new Map(flatten(JSON.parse(readFileSync(join(site, "i18n", `${l}.json`), "utf8"))))]),
);

const html = readFileSync(join(site, "index.html"), "utf8");
const js = readFileSync(join(site, "app.js"), "utf8");
const used = new Set([
  ...[...html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)].map((m) => m[1]),
  ...[...html.matchAll(/data-i18n-attr="([^"]+)"/g)].flatMap((m) => m[1].split(";").map((p) => p.split(":")[1].trim())),
  ...[...js.matchAll(/\bt\("([^"]+)"/g)].map((m) => m[1]),
]);

const errors = [];
const holes = (s) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(",");
const [base, ...others] = langs;
for (const other of others) {
  for (const k of catalogs[base].keys()) if (!catalogs[other].has(k)) errors.push(`${other}.json: falta ${k}`);
  for (const k of catalogs[other].keys()) if (!catalogs[base].has(k)) errors.push(`${base}.json: falta ${k}`);
  for (const [k, v] of catalogs[base]) {
    const o = catalogs[other].get(k);
    if (o !== undefined && holes(v) !== holes(o)) errors.push(`${k}: huecos distintos en ${base} y ${other}`);
  }
}
for (const k of used) if (!catalogs[base].has(k)) errors.push(`la página usa ${k}, que no existe`);
for (const k of catalogs[base].keys()) if (!used.has(k)) errors.push(`${k} no se usa en la página`);

if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  process.exit(1);
}
console.log(`✓ ${catalogs[base].size} textos en ${langs.join(" y ")}, todos usados`);
