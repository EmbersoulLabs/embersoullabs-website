/**
 * Portfolio runtime data.
 *
 * Projects come from the auto-generated manifest (js/portfolio-manifest.js),
 * which is built from assets/portfolio/before + assets/portfolio/after.
 *
 * Optional metadata overlays can refine titles/categories by pair id without
 * editing filenames. Adding new media does not require editing this file.
 */
(function (global) {
  var FILTERS = [
    { id: "all", label: { en: "All", zh: "全部" } },
    { id: "photo_to_product", label: { en: "Product Ads", zh: "产品广告" } },
    { id: "photos_to_story", label: { en: "Story Commercials", zh: "故事广告" } }
  ];

  /** Optional overrides keyed by pair id (number) or project id ("pair-1"). */
  var META = {
    // Example:
    // 1: { title: { en: "Skincare Launch", zh: "护肤上新" }, category: "products" }
  };

  function applyMeta(project) {
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

  var manifest = global.EmberSoulPortfolioManifest || { projects: [] };
  var discovered = Array.isArray(manifest.projects) ? manifest.projects : [];
  var projects = discovered.map(applyMeta).filter(function (project) {
    return project && project.videoUrl && Array.isArray(project.originalImages) && project.originalImages.length;
  });

  global.EmberSoulPortfolio = {
    projects: projects,
    filters: FILTERS,
    source: "auto-manifest"
  };
})(typeof window !== "undefined" ? window : globalThis);
