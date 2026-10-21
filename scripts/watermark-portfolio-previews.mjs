#!/usr/bin/env node
/**
 * Writes watermarked public previews from clean portfolio masters.
 * Reads assets/portfolio/after and writes only assets/portfolio/preview.
 * Never opens a master for writing and never re-encodes in place.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const afterDir = join(root, "assets", "portfolio", "after");
const previewDir = join(root, "assets", "portfolio", "preview");
const logo = join(root, "assets", "portfolio", "watermark-logo.png");
const AFTER_RE = /^after\s+\d+\.mp4$/i;

mkdirSync(previewDir, { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").split("\n").slice(-8).join("\n");
    throw new Error(`${command} failed for ${args.at(-1)}\n${detail}`);
  }
  return result.stdout || "";
}

function videoSize(file) {
  const stdout = run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0:s=x",
    file
  ]);
  const [width, height] = stdout.trim().split("x").map(Number);
  if (!width || !height) throw new Error(`Could not read video size: ${file}`);
  return { width, height };
}

const names = readdirSync(afterDir).filter((name) => AFTER_RE.test(name)).sort();
if (!names.length) throw new Error("No portfolio masters found.");

for (const name of names) {
  const input = resolve(afterDir, name);
  const output = resolve(previewDir, name);
  if (!output.startsWith(previewDir) || output.startsWith(afterDir)) {
    throw new Error(`Refusing to write outside the preview folder: ${output}`);
  }
  const { width, height } = videoSize(input);
  const portrait = height > width;
  const logoWidth = portrait ? Math.round(width * 0.3) : Math.round(width * 0.16);
  const margin = portrait ? 14 : 18;
  const filter = `[1:v]scale=${logoWidth}:-1,format=rgba,colorchannelmixer=aa=0.62[wm];[0:v][wm]overlay=W-w-${margin}:${margin}[vout]`;
  run("ffmpeg", [
    "-y",
    "-i", input,
    "-i", logo,
    "-filter_complex", filter,
    "-map", "[vout]",
    "-map", "0:a?",
    "-c:v", "libx264",
    "-crf", "23",
    "-preset", "medium",
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-movflags", "+faststart",
    output
  ]);
  console.log(`[preview] ${name} ${width}x${height} logo ${logoWidth}px`);
}
