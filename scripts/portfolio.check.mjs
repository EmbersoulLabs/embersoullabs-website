import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const index = readFileSync(join(root, "index.html"), "utf8");
assert(index.includes("id=\"showcase-grid\""), "existing showcase grid is reused");
assert(index.includes("id=\"portfolio-filters\""), "product/story filters exist");
assert(index.includes("/js/portfolio-data.js"), "portfolio data is loaded");
assert(index.includes("/js/portfolio.js"), "portfolio script is loaded");
assert(index.includes("Your Photos → Ready-to-Run Ad Videos") || index.includes("Your Photos"), "section explains photo to video");
assert(index.includes("Create a Video Like This"), "CTA copy is present");

const css = readFileSync(join(root, "css/style.css"), "utf8");
assert(css.includes(".portfolio-card"), "portfolio card styles exist");
assert(css.includes(".portfolio-before"), "before pane styles exist");
assert(css.includes("has-before-after"), "before/after expansion styles exist");
assert(css.includes("@media (max-width: 768px)"), "mobile layout rules remain");

const dataSource = readFileSync(join(root, "js/portfolio-data.js"), "utf8");
const scriptSource = readFileSync(join(root, "js/portfolio.js"), "utf8");
assert(dataSource.includes("originalImages"), "data model includes originalImages");
assert(dataSource.includes("generationType"), "data model includes generationType");
assert(dataSource.includes("videoUrl"), "data model includes videoUrl");
assert(scriptSource.includes("preload=\"none\""), "videos are not preloaded");
assert(scriptSource.includes("pauseOthers") || scriptSource.includes("pause"), "only one video plays");
assert(scriptSource.includes("Create a Video Like This"), "card CTA targets the order flow");
assert(scriptSource.includes("/ai-ads/?"), "CTA routes into existing ai-ads flow");

const sandbox = { window: {}, globalThis: {} };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.runInNewContext(dataSource, sandbox);
const portfolio = sandbox.window.EmberSoulPortfolio || sandbox.EmberSoulPortfolio;
assert(portfolio && Array.isArray(portfolio.projects) && portfolio.projects.length >= 5, "projects are available");

for (const project of portfolio.projects) {
  assert(project.id && project.title && project.category, `${project.id || "project"} keeps identity fields`);
  assert(Array.isArray(project.originalImages), `${project.id} keeps originalImages array`);
  assert(project.generationType === "photo_to_product" || project.generationType === "photos_to_story", `${project.id} has a known generation type`);
  if (!project.videoUrl) {
    assert(project.originalImages.length === 0, `${project.id} does not invent originals without a video`);
  }
}

for (const project of portfolio.projects) {
  for (const src of project.originalImages) {
    assert(String(src).startsWith("/assets/"), `${project.id} originals must be local verified assets`);
  }
  if (project.videoUrl) {
    assert(String(project.videoUrl).startsWith("/assets/"), `${project.id} video must be a local verified asset`);
  }
}

const missingMedia = portfolio.projects.filter((project) => !project.videoUrl && project.originalImages.length === 0);

const ads = readFileSync(join(root, "ai-ads/index.html"), "utf8");
assert(ads.includes("params.get(\"style\")"), "ai-ads accepts style prefills");
assert(ads.includes("params.get(\"ref\")"), "ai-ads accepts portfolio ref prefills");

console.log("portfolio ok");
console.log("MISSING_MEDIA_PROJECTS=" + missingMedia.map((p) => p.id).join(","));
