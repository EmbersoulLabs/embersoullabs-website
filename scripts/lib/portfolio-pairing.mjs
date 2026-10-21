import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp"]);
const VIDEO_EXT = new Set(["mp4", "webm"]);
const BEFORE_RE = /^before\s+(\d+)(?:-(\d+))?\.(jpe?g|png|webp)$/i;
const AFTER_RE = /^after\s+(\d+)\.(mp4|webm)$/i;

export function parseBeforeName(name) {
  const match = String(name).match(BEFORE_RE);
  if (!match) return null;
  return {
    id: Number(match[1]),
    part: match[2] ? Number(match[2]) : 1,
    ext: match[3].toLowerCase(),
    name
  };
}

export function parseAfterName(name) {
  const match = String(name).match(AFTER_RE);
  if (!match) return null;
  return {
    id: Number(match[1]),
    ext: match[2].toLowerCase(),
    name
  };
}

export function publicPath(folder, filename) {
  return `/assets/portfolio/${folder}/${encodeURIComponent(filename).replace(/%20/g, "%20")}`;
}

/**
 * Pair before/after filenames from two directory listings.
 * @returns {{ projects: object[], warnings: string[], errors: string[] }}
 */
export function pairPortfolioFiles(beforeNames, afterNames, options = {}) {
  const beforeDir = options.beforeDir || "before";
  const afterDir = options.afterDir || "after";
  const warnings = [];
  const errors = [];

  const beforeById = new Map();
  for (const name of beforeNames) {
    const parsed = parseBeforeName(name);
    if (!parsed) {
      if (!name.startsWith(".")) warnings.push(`Ignored unmatched before file: ${name}`);
      continue;
    }
    if (!IMAGE_EXT.has(parsed.ext)) {
      warnings.push(`Ignored unsupported before file: ${name}`);
      continue;
    }
    if (!beforeById.has(parsed.id)) beforeById.set(parsed.id, new Map());
    const parts = beforeById.get(parsed.id);
    if (parts.has(parsed.part)) {
      errors.push(`Duplicate before id ${parsed.id} part ${parsed.part}: ${parts.get(parsed.part).name} and ${name}`);
      continue;
    }
    parts.set(parsed.part, parsed);
  }

  const afterById = new Map();
  for (const name of afterNames) {
    const parsed = parseAfterName(name);
    if (!parsed) {
      if (!name.startsWith(".")) warnings.push(`Ignored unmatched after file: ${name}`);
      continue;
    }
    if (!VIDEO_EXT.has(parsed.ext)) {
      warnings.push(`Ignored unsupported after file: ${name}`);
      continue;
    }
    if (afterById.has(parsed.id)) {
      errors.push(`Duplicate after id ${parsed.id}: ${afterById.get(parsed.id).name} and ${name}`);
      continue;
    }
    afterById.set(parsed.id, parsed);
  }

  const allIds = new Set([...beforeById.keys(), ...afterById.keys()]);
  const projects = [];

  for (const id of [...allIds].sort((a, b) => a - b)) {
    const befores = beforeById.get(id);
    const after = afterById.get(id);
    if (!befores || befores.size === 0) {
      warnings.push(`Unmatched after ${id}: ${after ? after.name : "(missing)"} has no before image`);
      continue;
    }
    if (!after) {
      const names = [...befores.values()].map((item) => item.name).join(", ");
      warnings.push(`Unmatched before ${id}: ${names} has no after video`);
      continue;
    }

    const images = [...befores.values()]
      .sort((a, b) => a.part - b.part)
      .map((item) => publicPath(beforeDir, item.name));
    const multi = images.length > 1;
    projects.push({
      id: `pair-${id}`,
      pairId: id,
      title: {
        en: multi ? `Story Commercial ${id}` : `Product Ad ${id}`,
        zh: multi ? `故事广告 ${id}` : `产品广告 ${id}`
      },
      category: multi ? "story" : "products",
      categoryLabel: {
        en: multi ? "Story Ad" : "Product",
        zh: multi ? "故事广告" : "产品"
      },
      generationType: multi ? "photos_to_story" : "photo_to_product",
      packageType: multi ? "story" : "short",
      duration: multi ? "~45–48s" : "7–10s",
      language: "en",
      description: {
        en: multi
          ? "Multiple reference photos transformed into one story-driven advertisement."
          : "One original product photo transformed into a short commercial video.",
        zh: multi
          ? "多张参考照片生成一支故事型广告。"
          : "一张产品原图生成一支短广告视频。"
      },
      originalImages: images,
      videoUrl: publicPath(afterDir, after.name),
      poster: images[0] || null
    });
  }

  return { projects, warnings, errors };
}

export function listFilenames(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => !name.startsWith(".") && name !== "README.md");
}

export function discoverPortfolio(root) {
  const beforeDir = join(root, "assets", "portfolio", "before");
  const afterDir = join(root, "assets", "portfolio", "after");
  const previewDir = join(root, "assets", "portfolio", "preview");
  const result = pairPortfolioFiles(listFilenames(beforeDir), listFilenames(afterDir));
  const previews = new Set(listFilenames(previewDir));
  const published = [];

  for (const project of result.projects) {
    const filename = decodeURIComponent(String(project.videoUrl).split("/").pop());
    if (!previews.has(filename)) {
      result.errors.push(`Missing watermarked preview for ${filename}. The clean master is not published.`);
      continue;
    }
    project.videoUrl = publicPath("preview", filename);
    published.push(project);
  }

  result.projects = published;
  return result;
}
