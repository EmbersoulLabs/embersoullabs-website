/**
 * Portfolio runtime data.
 *
 * Projects come from the auto-generated manifest (js/portfolio-manifest.js),
 * built from:
 *   - assets/portfolio/before + after  (product / story commercials)
 *   - assets/portfolio/series/<slug>/  (multi-episode brand story series)
 *
 * Optional metadata overlays refine titles/categories by pair id without
 * editing filenames. Adding new media does not require editing this file.
 */
(function (global) {
  var FILTERS = [
    { id: "all", label: { en: "All", zh: "全部" } },
    { id: "photo_to_product", label: { en: "Product Ads", zh: "产品广告" } },
    { id: "photos_to_story", label: { en: "Story Ads", zh: "故事广告" } },
    { id: "story_series", label: { en: "Story Series", zh: "故事系列" } }
  ];

  /**
   * Verified overlays for known uploaded pairs (mapped from actual media).
   * pair-1 = restaurant plate · pair-2 = beauty bottles · pair-3 = rose bouquet
   */
  var META = {
    1: {
      title: { en: "Restaurant Story Commercial", zh: "餐厅故事广告" },
      category: "story",
      categoryLabel: { en: "Story Ad", zh: "故事广告" },
      generationType: "photos_to_story",
      packageType: "story",
      duration: "~38s",
      sortOrder: 20,
      description: {
        en: "A restaurant photo transformed into a story-driven advertisement.",
        zh: "餐厅原图生成一支故事型广告。"
      }
    },
    2: {
      title: { en: "Beauty Product Commercial", zh: "美妆产品广告" },
      category: "products",
      categoryLabel: { en: "Product", zh: "产品" },
      generationType: "photo_to_product",
      packageType: "short",
      duration: "7–10s",
      sortOrder: 30,
      description: {
        en: "Concept beauty commercial generated from product photos. Not an official brand partnership.",
        zh: "根据产品照片生成的美妆概念广告，并非品牌官方合作。"
      }
    },
    3: {
      title: { en: "Luxury Rose Bouquet Commercial", zh: "奢华玫瑰花束广告" },
      category: "products",
      categoryLabel: { en: "Product", zh: "产品" },
      generationType: "photo_to_product",
      packageType: "short",
      duration: "7–10s",
      sortOrder: 10,
      description: {
        en: "A luxury floral product photo transformed into a short commercial video.",
        zh: "奢华花艺产品原图生成一支短广告视频。"
      }
    }
  };

  function applyMeta(project) {
    if (!project) return project;
    if (project.format === "story_series") return project;
    var overlay = META[project.pairId] || META[project.id] || null;
    if (!overlay) return project;
    var next = {};
    for (var key in project) {
      if (Object.prototype.hasOwnProperty.call(project, key)) next[key] = project[key];
    }
    for (var field in overlay) {
      if (Object.prototype.hasOwnProperty.call(overlay, field)) next[field] = overlay[field];
    }
    return next;
  }

  function sortProjects(list) {
    return list.slice().sort(function (a, b) {
      var ao = a.sortOrder != null ? a.sortOrder : 999;
      var bo = b.sortOrder != null ? b.sortOrder : 999;
      if (ao !== bo) return ao - bo;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
  }

  var manifest = global.EmberSoulPortfolioManifest || { projects: [] };
  var discovered = Array.isArray(manifest.projects) ? manifest.projects : [];
  var projects = sortProjects(
    discovered.map(applyMeta).filter(function (project) {
      if (!project) return false;
      if (project.format === "story_series") {
        return Array.isArray(project.episodes) && project.episodes.length > 0 && project.episodes[0].videoUrl;
      }
      return project.videoUrl && Array.isArray(project.originalImages) && project.originalImages.length;
    })
  );

  global.EmberSoulPortfolio = {
    projects: projects,
    filters: FILTERS,
    source: "auto-manifest"
  };
})(typeof window !== "undefined" ? window : globalThis);
