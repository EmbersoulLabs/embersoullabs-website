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
assert(index.includes("story_series") || index.includes("Story Series"), "story series filter exists");
assert(index.includes("/js/portfolio-manifest.js"), "auto manifest is loaded");
assert(index.includes("/js/portfolio-data.js"), "portfolio data is loaded");
assert(index.includes("/js/portfolio.js"), "portfolio script is loaded");
assert(
  index.includes("Turn Your Product Photos Into AI Video Ads") ||
    index.includes("Real Before / After Examples") ||
    index.includes("Your Photos"),
  "homepage explains photo to video"
);
assert(index.includes("White-label AI Video Production for Agencies"), "agency white-label CTA exists");
assert(!index.includes("Finished examples will publish here as campaigns go live"), "outdated portfolio placeholder copy is removed");
assert(index.includes("Create a Video Like This"), "CTA copy is present");

const css = readFileSync(join(root, "css/style.css"), "utf8");
assert(css.includes(".portfolio-card"), "portfolio card styles exist");
assert(css.includes(".portfolio-media-compact"), "compact before/after preview exists");
assert(css.includes(".portfolio-modal"), "comparison modal styles exist");
assert(css.includes(".series-viewer"), "series viewer styles exist");
assert(css.includes("object-fit: cover"), "thumbnails use object-fit cover");
assert(css.includes("repeat(auto-fit, minmax(260px, 340px))"), "desktop cards stay compact with up to 3 per row");
assert(css.includes("repeat(auto-fit, minmax(240px, 320px))"), "large tablet cards stay compact");
assert(css.includes("repeat(auto-fit, minmax(220px, 300px))"), "tablet shows up to 2 compact cards per row");
assert(css.includes("@media (max-width: 560px)"), "mobile collapses to one card per row");
assert(css.includes(".portfolio-empty"), "empty portfolio state exists");
assert(css.includes("@media (max-width: 768px)"), "mobile layout rules remain");

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert(packageJson.scripts && packageJson.scripts.build === "node scripts/generate-portfolio.mjs", "build generates the portfolio manifest");

const dataSource = readFileSync(join(root, "js/portfolio-data.js"), "utf8");
const scriptSource = readFileSync(join(root, "js/portfolio.js"), "utf8");
const manifestSource = readFileSync(join(root, "js/portfolio-manifest.js"), "utf8");
assert(dataSource.includes("EmberSoulPortfolioManifest"), "runtime reads the auto manifest");
assert(dataSource.includes("Luxury Rose Bouquet Commercial"), "floral title overlay exists");
assert(dataSource.includes("Beauty Product Commercial"), "beauty title overlay exists");
assert(dataSource.includes("Not an official brand partnership"), "beauty concept disclaimer exists");
assert(dataSource.includes("story_series"), "story series filter is defined");
assert(!/id:\s*"fnb-short"/.test(dataSource), "placeholder projects are not hard-coded");
assert(scriptSource.includes("preload=\"none\""), "modal videos are not fully preloaded");
assert(scriptSource.includes("preload=\"metadata\""), "card after previews load metadata only");
assert(scriptSource.includes("data-portfolio-preview"), "after preview uses native video");
assert(scriptSource.includes("Request a Story Campaign"), "series CTA exists");
assert(scriptSource.includes("selectEpisode"), "episode navigation exists");
assert(scriptSource.includes("ArrowLeft"), "series keyboard navigation exists");
assert(!scriptSource.includes("afterPreviewSrc"), "after preview does not reuse before image helpers");
assert(!/poster=\"\s*'\s*\+\s*escapeAttr\(project\.poster\)/.test(scriptSource), "before image is not used as video poster");
assert(scriptSource.includes("pauseOthers") || scriptSource.includes("pause"), "only one video plays");
assert(scriptSource.includes("Create a Video Like This"), "card CTA targets the order flow");
assert(scriptSource.includes("portfolio-empty"), "empty state is rendered when no pairs exist");
assert(scriptSource.includes("portfolio-modal"), "modal comparison is implemented");
assert(scriptSource.includes("Escape"), "modal supports Escape to close");
assert(scriptSource.includes("openModal"), "modal opens from compact cards");
assert(!scriptSource.includes("is-expanded"), "cards no longer rely on oversized expanded layout");
assert(css.includes("portfolio-after-preview"), "after preview video styles exist");
assert(manifestSource.includes("EmberSoulPortfolioManifest"), "manifest file is generated");

const sandbox = { window: {}, globalThis: {} };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.runInNewContext(manifestSource, sandbox);
vm.runInNewContext(dataSource, sandbox);
const portfolio = sandbox.window.EmberSoulPortfolio || sandbox.EmberSoulPortfolio;
assert(portfolio && Array.isArray(portfolio.projects), "projects array exists");
assert(portfolio.source === "auto-manifest", "projects come from auto discovery");
assert(portfolio.filters.some((f) => f.id === "story_series"), "runtime exposes story series filter");

const commercials = portfolio.projects.filter((p) => p.format !== "story_series");
for (const project of commercials) {
  assert(project.videoUrl && project.originalImages.length, `${project.id} is a complete pair`);
  assert(String(project.videoUrl).startsWith("/assets/portfolio/after/"), `${project.id} video path is local`);
  for (const src of project.originalImages) {
    assert(String(src).startsWith("/assets/portfolio/before/"), `${project.id} before path is local`);
  }
}

assert(!portfolio.projects.some((p) => p.id === "series-feisao-popiah"), "unpublished Fei Sao series has no public card");

const pair1 = portfolio.projects.find((project) => project.pairId === 1 || project.id === "pair-1");
if (pair1) {
  assert(pair1.generationType === "photos_to_story", "pair-1 is a Story Commercial");
  assert(pair1.packageType === "story", "pair-1 CTA uses story package");
  assert(pair1.category === "story", "pair-1 category is story");
  assert(pair1.title.en === "Restaurant Story Commercial", "pair-1 title");
}

const floral = portfolio.projects.find((project) => project.pairId === 3 || project.id === "pair-3");
if (floral) {
  assert(floral.title.en === "Luxury Rose Bouquet Commercial", "floral title");
  assert(portfolio.projects[0].id === floral.id || floral.sortOrder <= portfolio.projects[0].sortOrder, "floral is prioritized");
}

const beauty = portfolio.projects.find((project) => project.pairId === 2 || project.id === "pair-2");
if (beauty) {
  assert(beauty.title.en === "Beauty Product Commercial", "beauty title");
  assert(/not an official brand partnership/i.test(beauty.description.en), "beauty disclaimer");
}

const ads = readFileSync(join(root, "ai-ads/index.html"), "utf8");
assert(ads.includes("params.get(\"style\")"), "ai-ads accepts style prefills");
assert(ads.includes("params.get(\"ref\")"), "ai-ads accepts portfolio ref prefills");
assert(ads.includes("story-series"), "ai-ads accepts story series style");

const seriesReadme = readFileSync(join(root, "assets/portfolio/series/README.md"), "utf8");
assert(seriesReadme.includes("ep01.mp4"), "series upload docs exist");

console.log("portfolio ok");
console.log("AUTO_PROJECT_COUNT=" + portfolio.projects.length);
console.log("COMMERCIAL_COUNT=" + commercials.length);
console.log("SERIES_COUNT=" + portfolio.projects.filter((p) => p.format === "story_series").length);
