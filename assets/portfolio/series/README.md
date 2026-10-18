# Brand Story Series

Upload multi-episode AI brand story series here. The website discovers episodes at build time — you do not edit JavaScript when adding episodes.

## Folder layout

```text
assets/portfolio/series/<series-slug>/
  series.json          # required metadata (title, description, optional episode labels)
  cover.jpg            # optional series cover image
  ep01.mp4             # episode videos (ep01, ep02, …)
  ep02.mp4
  ep01-ref.jpg         # optional episode reference photos
  ep01-ref-2.jpg
```

Slug rules: lowercase letters, numbers, hyphens only (`feisao-popiah`).

## Publishing rules

- A series is **published only when at least one `epXX.mp4` / `.webm` exists**.
- Incomplete series are fine — missing episodes are omitted, not faked.
- Empty folders (metadata only) stay unpublished.
- Duplicate episode numbers fail the build.

## Example `series.json`

```json
{
  "title": {
    "en": "Fei Sao Popiah — A Family Food Story",
    "zh": "肥嫂 Popiah｜一份传承的味道"
  },
  "description": {
    "en": "A multi-episode brand story about family recipes and everyday flavour.",
    "zh": "讲述家族味道与日常传承的多集品牌故事。"
  },
  "language": "zh",
  "sortOrder": 5,
  "episodes": {
    "ep01": {
      "title": { "en": "EP01 — Beginnings", "zh": "EP01｜起点" },
      "duration": "~45s"
    }
  }
}
```

After uploading episode files, commit and push. Cloudflare Pages runs `npm run build` and regenerates the portfolio manifest.
