import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { pairPortfolioFiles, parseBeforeName, parseAfterName } from "./lib/portfolio-pairing.mjs";

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

const fixtureRoot = mkdtempSync(join(tmpdir(), "portfolio-fix-"));
try {
  mkdirSync(join(fixtureRoot, "assets", "portfolio", "before"), { recursive: true });
  mkdirSync(join(fixtureRoot, "assets", "portfolio", "after"), { recursive: true });
  writeFileSync(join(fixtureRoot, "assets", "portfolio", "before", "before 9.jpg"), "fake");
  writeFileSync(join(fixtureRoot, "assets", "portfolio", "after", "after 9.mp4"), "fake");
  const { discoverPortfolio } = await import("./lib/portfolio-pairing.mjs");
  const discovered = discoverPortfolio(fixtureRoot);
  assert(discovered.projects.length === 1, "discovers pairs from disk");
  assert(discovered.projects[0].pairId === 9, "discovers pair 9");
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log("generate-portfolio checks ok");
