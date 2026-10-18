import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  pairPortfolioFiles,
  parseBeforeName,
  parseAfterName,
  mergePortfolioProjects
} from "./lib/portfolio-pairing.mjs";
import { discoverSeries } from "./lib/portfolio-series.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(parseBeforeName("before 1.jpg")?.id === 1, "parses before 1");
assert(parseBeforeName("before 4-2.png")?.part === 2, "parses multi-ref part");
assert(parseBeforeName("before 10.webp")?.id === 10, "parses double-digit before");
assert(parseAfterName("after 2.mp4")?.id === 2, "parses after 2");
assert(parseAfterName("after 10.webm")?.id === 10, "parses webm after");
assert(parseBeforeName("random.png") === null, "rejects unrelated files");

const single = pairPortfolioFiles(["before 1.jpg"], ["after 1.mp4"]);
assert(single.errors.length === 0, "single pair has no errors");
assert(single.projects.length === 1, "single pair creates one project");
assert(single.projects[0].originalImages.length === 1, "single pair has one image");
assert(single.projects[0].generationType === "photo_to_product", "single pair is product type");
assert(single.projects[0].videoUrl.includes("after%201.mp4") || single.projects[0].videoUrl.includes("after 1"), "encodes spaced video path");

const multi = pairPortfolioFiles(
  ["before 4.jpg", "before 4-2.jpg", "before 4-3.webp"],
  ["after 4.mp4"]
);
assert(multi.projects.length === 1, "multi refs stay one project");
assert(multi.projects[0].originalImages.length === 3, "multi refs keep three images");
assert(multi.projects[0].generationType === "photos_to_story", "multi refs are story type");

const sorted = pairPortfolioFiles(
  ["before 10.png", "before 2.jpg", "before 1.webp"],
  ["after 10.mp4", "after 1.webm", "after 2.mp4"]
);
assert(sorted.projects.map((p) => p.pairId).join(",") === "1,2,10", "sorts numerically 1,2,10");

const missingBefore = pairPortfolioFiles([], ["after 7.mp4"]);
assert(missingBefore.projects.length === 0, "missing before is not published");
assert(missingBefore.warnings.some((w) => /Unmatched after 7/.test(w)), "reports missing before");

const missingAfter = pairPortfolioFiles(["before 8.jpg"], []);
assert(missingAfter.projects.length === 0, "missing after is not published");
assert(missingAfter.warnings.some((w) => /Unmatched before 8/.test(w)), "reports missing after");

const dupAfter = pairPortfolioFiles(["before 3.jpg"], ["after 3.mp4", "after 3.webm"]);
assert(dupAfter.errors.some((e) => /Duplicate after id 3/.test(e)), "duplicate after fails");

const dupBefore = pairPortfolioFiles(["before 5.jpg", "before 5.png"], ["after 5.mp4"]);
assert(dupBefore.errors.some((e) => /Duplicate before id 5/.test(e)), "duplicate before fails");

const empty = pairPortfolioFiles([], []);
assert(empty.projects.length === 0 && empty.errors.length === 0, "empty folders are valid");

const fixtureRoot = mkdtempSync(join(tmpdir(), "portfolio-gen-"));
try {
  mkdirSync(join(fixtureRoot, "assets", "portfolio", "before"), { recursive: true });
  mkdirSync(join(fixtureRoot, "assets", "portfolio", "after"), { recursive: true });
  writeFileSync(join(fixtureRoot, "assets", "portfolio", "before", "before 9.jpg"), "fake");
  writeFileSync(join(fixtureRoot, "assets", "portfolio", "after", "after 9.mp4"), "fake");
  const { discoverPortfolio } = await import("./lib/portfolio-pairing.mjs");
  const discovered = discoverPortfolio(fixtureRoot);
  assert(discovered.projects.length === 1, "discovers pairs from disk");
  assert(discovered.projects[0].pairId === 9, "discovers pair 9");

  // Empty series folder + metadata-only series must not publish.
  const seriesRoot = join(fixtureRoot, "assets", "portfolio", "series");
  mkdirSync(join(seriesRoot, "empty-series"), { recursive: true });
  mkdirSync(join(seriesRoot, "meta-only"), { recursive: true });
  writeFileSync(
    join(seriesRoot, "meta-only", "series.json"),
    JSON.stringify({
      title: { en: "Meta Only", zh: "仅元数据" },
      episodes: { ep01: { title: { en: "EP01", zh: "EP01" } } }
    })
  );
  const emptySeries = discoverSeries(fixtureRoot);
  assert(emptySeries.projects.length === 0, "series without videos are not published");
  assert(emptySeries.warnings.some((w) => /no episode videos/.test(w)), "warns about unpublished series");

  // Partial series: only ep01 + ep03 present → publish those two, sorted.
  mkdirSync(join(seriesRoot, "demo-story"), { recursive: true });
  writeFileSync(
    join(seriesRoot, "demo-story", "series.json"),
    JSON.stringify({
      title: { en: "Demo Story", zh: "示范故事" },
      sortOrder: 1,
      episodes: {
        ep01: { title: { en: "EP01 — Start", zh: "EP01｜开始" }, duration: "40s" },
        ep03: { title: { en: "EP03", zh: "EP03" } }
      }
    })
  );
  writeFileSync(join(seriesRoot, "demo-story", "ep01.mp4"), "fake");
  writeFileSync(join(seriesRoot, "demo-story", "ep03.mp4"), "fake");
  writeFileSync(join(seriesRoot, "demo-story", "cover.jpg"), "fake");
  const partial = discoverSeries(fixtureRoot);
  assert(partial.projects.length === 1, "partial series publishes one card");
  assert(partial.projects[0].episodes.length === 2, "partial series keeps available episodes only");
  assert(partial.projects[0].episodes.map((e) => e.id).join(",") === "ep01,ep03", "episodes sorted and incomplete-safe");
  assert(partial.projects[0].coverUrl.includes("cover.jpg"), "optional cover discovered");
  assert(partial.projects[0].format === "story_series", "series format flag");

  // Duplicate episode videos fail.
  mkdirSync(join(seriesRoot, "dup-ep"), { recursive: true });
  writeFileSync(join(seriesRoot, "dup-ep", "ep01.mp4"), "a");
  writeFileSync(join(seriesRoot, "dup-ep", "ep01.webm"), "b");
  const dupEp = discoverSeries(fixtureRoot);
  assert(dupEp.errors.some((e) => /Duplicate episode 1/.test(e)), "duplicate episodes fail");

  const merged = mergePortfolioProjects(discovered, {
    projects: partial.projects,
    warnings: [],
    errors: []
  });
  assert(merged.projects.length === 2, "merge keeps commercials + series");
  assert(merged.projects[0].format === "story_series", "series can sort ahead via sortOrder");
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("generate-portfolio checks ok");
