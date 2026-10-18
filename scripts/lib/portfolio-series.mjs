import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp"]);
const VIDEO_EXT = new Set(["mp4", "webm"]);
const EP_RE = /^ep0*(\d+)\.(mp4|webm)$/i;
const REF_RE = /^ep0*(\d+)-ref(?:-(\d+))?\.(jpe?g|png|webp)$/i;
const COVER_RE = /^cover\.(jpe?g|png|webp)$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function publicPath(slug, filename) {
  return `/assets/portfolio/series/${encodeURIComponent(slug)}/${encodeURIComponent(filename)}`;
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function bilingual(value, fallbackEn, fallbackZh) {
  if (value && typeof value === "object") {
    return {
      en: typeof value.en === "string" && value.en.trim() ? value.en.trim() : fallbackEn,
      zh: typeof value.zh === "string" && value.zh.trim() ? value.zh.trim() : fallbackZh || fallbackEn
    };
  }
  if (typeof value === "string" && value.trim()) {
    return { en: value.trim(), zh: value.trim() };
  }
  return { en: fallbackEn, zh: fallbackZh || fallbackEn };
}

function listSeriesDirs(seriesRoot) {
  if (!existsSync(seriesRoot)) return [];
  return readdirSync(seriesRoot).filter((name) => {
    if (name.startsWith(".") || name === "README.md") return false;
    const full = join(seriesRoot, name);
    try {
      return statSync(full).isDirectory();
    } catch {
      return false;
    }
  });
}

/**
 * Discover brand story series under assets/portfolio/series/<slug>/.
 * Only series with at least one episode video are published.
 */
export function discoverSeries(root) {
  const seriesRoot = join(root, "assets", "portfolio", "series");
  const warnings = [];
  const errors = [];
  const projects = [];

  for (const slug of listSeriesDirs(seriesRoot)) {
    if (!SLUG_RE.test(slug)) {
      warnings.push(`Ignored invalid series folder name: ${slug}`);
      continue;
    }

    const dir = join(seriesRoot, slug);
    const files = readdirSync(dir).filter((name) => !name.startsWith(".") && name !== "README.md");
    const metaPath = join(dir, "series.json");
    const meta = existsSync(metaPath) ? readJson(metaPath) : {};
    if (existsSync(metaPath) && !meta) {
      errors.push(`Invalid series.json in ${slug}`);
      continue;
    }

    const episodeMeta = meta && typeof meta.episodes === "object" && meta.episodes ? meta.episodes : {};
    const videosByNum = new Map();
    const refsByNum = new Map();
    let coverFile = null;

    for (const name of files) {
      if (name === "series.json") continue;
      if (COVER_RE.test(name)) {
        if (coverFile) {
          errors.push(`Duplicate cover in series ${slug}: ${coverFile} and ${name}`);
          continue;
        }
        coverFile = name;
        continue;
      }

      const ep = name.match(EP_RE);
      if (ep) {
        const num = Number(ep[1]);
        const ext = ep[2].toLowerCase();
        if (!VIDEO_EXT.has(ext)) {
          warnings.push(`Ignored unsupported episode file in ${slug}: ${name}`);
          continue;
        }
        if (videosByNum.has(num)) {
          errors.push(`Duplicate episode ${num} in series ${slug}: ${videosByNum.get(num).name} and ${name}`);
          continue;
        }
        videosByNum.set(num, { num, name, ext });
        continue;
      }

      const ref = name.match(REF_RE);
      if (ref) {
        const num = Number(ref[1]);
        const part = ref[2] ? Number(ref[2]) : 1;
        const ext = ref[3].toLowerCase();
        if (!IMAGE_EXT.has(ext)) continue;
        if (!refsByNum.has(num)) refsByNum.set(num, new Map());
        const parts = refsByNum.get(num);
        if (parts.has(part)) {
          warnings.push(`Duplicate reference for EP${num} in ${slug}: ${name}`);
          continue;
        }
        parts.set(part, name);
        continue;
      }

      warnings.push(`Ignored unmatched series file in ${slug}: ${name}`);
    }

    if (videosByNum.size === 0) {
      warnings.push(`Series ${slug} has no episode videos yet — not published`);
      continue;
    }

    const episodes = [...videosByNum.keys()]
      .sort((a, b) => a - b)
      .map((num) => {
        const video = videosByNum.get(num);
        const key = `ep${String(num).padStart(2, "0")}`;
        const altKey = `ep${num}`;
        const epMeta = episodeMeta[key] || episodeMeta[altKey] || episodeMeta[String(num)] || {};
        const refs = refsByNum.has(num)
          ? [...refsByNum.get(num).entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([, filename]) => publicPath(slug, filename))
          : [];
        const label = `EP${String(num).padStart(2, "0")}`;
        return {
          id: key,
          order: num,
          title: bilingual(epMeta.title, label, label),
          description: bilingual(epMeta.description, "", ""),
          duration: typeof epMeta.duration === "string" ? epMeta.duration : null,
          videoUrl: publicPath(slug, video.name),
          references: refs
        };
      });

    const title = bilingual(
      meta.title,
      slug
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
      slug
    );

    projects.push({
      id: `series-${slug}`,
      slug,
      format: "story_series",
      pairId: null,
      title,
      category: "story-series",
      categoryLabel: { en: "Story Series", zh: "故事系列" },
      generationType: "story_series",
      packageType: "monthly",
      duration: `${episodes.length} EP`,
      language: typeof meta.language === "string" ? meta.language : "en",
      description: bilingual(
        meta.description,
        "A multi-episode AI brand story series.",
        "多集 AI 品牌故事系列。"
      ),
      coverUrl: coverFile ? publicPath(slug, coverFile) : null,
      originalImages: coverFile ? [publicPath(slug, coverFile)] : episodes[0]?.references?.length ? episodes[0].references.slice(0, 1) : [],
      videoUrl: episodes[0].videoUrl,
      poster: null,
      episodeCount: episodes.length,
      episodes,
      sortOrder: Number.isFinite(Number(meta.sortOrder)) ? Number(meta.sortOrder) : 50,
      cta: "story_campaign"
    });
  }

  projects.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return String(a.slug).localeCompare(String(b.slug));
  });

  return { projects, warnings, errors };
}
