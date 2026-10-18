# Portfolio media (Before / After)

Upload paired photos and videos here. The website builds a gallery automatically — you do not edit JavaScript when adding new projects.

## 1. Upload original photos

Put source photos in:

`assets/portfolio/before/`

Supported formats: `.jpg` `.jpeg` `.png` `.webp`

## 2. Upload AI-generated videos

Put finished ads in:

`assets/portfolio/after/`

Supported formats: `.mp4` `.webm`

## 3. Filename matching

Match files by number. Extensions do not need to match. Spaces are allowed.

| Before | After |
| --- | --- |
| `before 1.jpg` | `after 1.mp4` |
| `before 2.png` | `after 2.mp4` |
| `before 10.webp` | `after 10.webm` |

Projects sort numerically: 1, 2, 10.

Only complete pairs are published. A lone before or lone after is skipped and reported during build.

Duplicate numbers (for example two `after 3.*` files) fail the build with a clear error.

## 4. Multiple reference photos (story commercials)

For one story video with several references:

```
before 4.jpg
before 4-2.jpg
before 4-3.jpg
after 4.mp4
```

All before images with the same number become one project matched to `after 4.mp4`.

## 5. Brand Story Series (multi-episode)

For multi-episode campaigns, use:

`assets/portfolio/series/<series-slug>/`

See `assets/portfolio/series/README.md`.

Example upcoming project folder: `series/feisao-popiah/`  
(Metadata may exist before videos. The site only publishes series that have at least one episode file.)

## 6. How the website updates

1. Add the media files to the folders above.
2. Commit and push (or run the Pages build).
3. Build runs `npm run build` → `node scripts/generate-portfolio.mjs`.
4. That script writes `js/portfolio-manifest.js`.
5. The homepage reads the manifest and shows Before / After cards and story series.

Cloudflare Pages build command should be:

```text
npm run build
```

Build output directory: leave empty / project root (static site).

Locally you can regenerate anytime:

```bash
npm run build
```

## 7. File recommendations

- Prefer vertical 9:16 product imagery when possible.
- Keep photos under ~2 MB each (compressed JPG/WebP).
- Keep videos under ~15–25 MB for fast mobile load.
- Use H.264 MP4 for widest browser support.
- Do not invent stock “before” photos. Only use real generation sources.
