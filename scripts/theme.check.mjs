import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function htmlFiles(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "functions" || name === "scripts" || name === "node_modules") continue;
      htmlFiles(path, files);
    } else if (name.endsWith(".html")) files.push(path);
  }
  return files;
}

const css = readFileSync(join(root, "css/style.css"), "utf8");
const rootBlock = css.slice(0, css.indexOf("html[data-theme=\"dark\"]"));
assert(rootBlock.includes("--bg: #f5f7fb"), "default surface is light");
assert(!rootBlock.includes("--bg: #050508"), "dark background is not the default token");
assert(css.includes("html[data-theme=\"dark\"]") && css.includes("--bg: #050508"), "dark theme keeps the existing background");
assert(css.includes("color-scheme: light") && css.includes("color-scheme: dark"), "native controls follow the theme");
assert(css.includes("prefers-reduced-motion") && css.includes("--focus-ring"), "motion and focus are covered");
assert(!/filter:\s*invert/.test(css), "theme does not invert the page");
assert(css.includes("logo-horizontal-light.png"), "light logo uses the same artwork");
assert(css.includes("aspect-ratio: 420 / 128"), "header logo box is shared by both themes");

const nav = readFileSync(join(root, "js/site-nav.js"), "utf8");
assert(nav.includes("localStorage") && nav.includes("es-appearance"), "preference is stored locally");
assert(nav.includes("Appearance") && nav.includes("radiogroup"), "one appearance group is in the menu");
assert(nav.includes("Logout") && nav.includes("My Orders"), "existing menu actions stay");

const pages = htmlFiles(root);
assert(pages.length >= 14, "expected the public pages");
for (const page of pages) {
  const text = readFileSync(page, "utf8");
  assert(text.includes("es-appearance"), `${page} applies the theme before paint`);
  assert(/\/css\/style\.css\?v=20261017[a-z]/.test(text), `${page} loads the themed stylesheet`);
  assert(text.indexOf("es-appearance") < text.indexOf("/css/style.css"), `${page} sets the theme before the stylesheet`);
}

function resolve(pref, dark) {
  const choice = pref === "dark" || pref === "auto" ? pref : "light";
  if (choice === "auto") return dark ? "dark" : "light";
  return choice;
}
assert(resolve(null, true) === "light", "missing preference defaults to light even on a dark system");
assert(resolve("dark", false) === "dark", "manual dark wins");
assert(resolve("auto", true) === "dark" && resolve("auto", false) === "light", "auto follows the system");
assert(resolve("nope", true) === "light", "unknown values fall back to light");

console.log("theme ok");
