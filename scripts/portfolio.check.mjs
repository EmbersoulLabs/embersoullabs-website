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
assert(index.includes("/js/portfolio-manifest.js"), "auto manifest is loaded");
assert(index.includes("/js/portfolio-data.js"), "portfolio data is loaded");
assert(index.includes("/js/portfolio.js"), "portfolio script is loaded");
assert(index.includes("Your Photos → Ready-to-Run Ad Videos") || index.includes("Your Photos"), "section explains photo to video");
assert(index.includes("Create a Video Like This"), "CTA copy is present");

const css = readFileSync(join(root, "css/style.css"), "utf8");
assert(css.includes(".portfolio-card"), "portfolio card styles exist");
assert(css.includes(".portfolio-before"), "before pane styles exist");
assert(css.includes("has-before-after"), "before/after expansion styles exist");
assert(css.includes(".portfolio-empty"), "empty portfolio state exists");
assert(css.includes("@media (max-width: 768px)"), "mobile layout rules remain");

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert(packageJson.scripts && packageJson.scripts.build === "node scripts/generate-portfolio.mjs", "build generates the portfolio manifest");

const dataSource = readFileSync(join(root, "js/portfolio-data.js"), "utf8");
const scriptSource = readFileSync(join(root, "js/portfolio.js"), "utf8");
const manifestSource = readFileSync(join(root, "js/portfolio-manifest.js"), "utf8");
assert(dataSource.includes("EmberSoulPortfolioManifest"), "runtime reads the auto manifest");
assert(!/id:\s*"fnb-short"/.test(dataSource), "placeholder projects are not hard-coded");
assert(scriptSource.includes("preload=\"none\""), "videos are not preloaded");
assert(scriptSource.includes("pauseOthers") || scriptSource.includes("pause"), "only one video plays");
assert(scriptSource.includes("Create a Video Like This"), "card CTA targets the order flow");
assert(scriptSource.includes("portfolio-empty"), "empty state is rendered when no pairs exist");
assert(manifestSource.includes("EmberSoulPortfolioManifest"), "manifest file is generated");

const sandbox = { window: {}, globalThis: {} };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.runInNewContext(manifestSource, sandbox);
vm.runInNewContext(dataSource, sandbox);
const portfolio = sandbox.window.EmberSoulPortfolio || sandbox.EmberSoulPortfolio;
assert(portfolio && Array.isArray(portfolio.projects), "projects array exists");
assert(portfolio.source === "auto-manifest", "projects come from auto discovery");

for (const project of portfolio.projects) {
  assert(project.videoUrl && project.originalImages.length, `${project.id} is a complete pair`);
  assert(String(project.videoUrl).startsWith("/assets/portfolio/after/"), `${project.id} video path is local`);
  for (const src of project.originalImages) {
    assert(String(src).startsWith("/assets/portfolio/before/"), `${project.id} before path is local`);
  }
}

const ads = readFileSync(join(root, "ai-ads/index.html"), "utf8");
assert(ads.includes("params.get(\"style\")"), "ai-ads accepts style prefills");
assert(ads.includes("params.get(\"ref\")"), "ai-ads accepts portfolio ref prefills");

console.log("portfolio ok");
console.log("AUTO_PROJECT_COUNT=" + portfolio.projects.length);
