/**
 * Portfolio projects for the homepage Our Work gallery.
 *
 * Add verified EmberSoul Labs media only:
 * - originalImages: real customer/source photos used for generation
 * - videoUrl: the matching AI-generated ad (mp4/webm under /assets/portfolio/)
 *
 * Leave media empty when originals cannot be matched. Do not invent assets.
 */
(function (global) {
  var PROJECTS = [
    {
      id: "fnb-short",
      title: { en: "Product Short Ad", zh: "产品短广告" },
      category: "food",
      categoryLabel: { en: "Food & Beverage", zh: "餐饮" },
      generationType: "photo_to_product",
      packageType: "short",
      duration: "7–10s",
      language: "en",
      description: {
        en: "Vertical short ads for menus, signature dishes and promotions.",
        zh: "适合菜单、招牌菜与促销活动的竖版短视频。"
      },
      originalImages: [],
      videoUrl: null,
      poster: null
    },
    {
      id: "florist-short",
      title: { en: "Floral Promo Ad", zh: "花艺推广广告" },
      category: "florist",
      categoryLabel: { en: "Florist", zh: "花店" },
      generationType: "photo_to_product",
      packageType: "short",
      duration: "7–10s",
      language: "en",
      description: {
        en: "Vertical ads for bouquet launches, festive seasons and shop promos.",
        zh: "适合花束上新、节日档期与门店推广的竖版广告。"
      },
      originalImages: [],
      videoUrl: null,
      poster: null
    },
    {
      id: "product-short",
      title: { en: "Product Highlight Ad", zh: "产品卖点广告" },
      category: "products",
      categoryLabel: { en: "Product", zh: "产品" },
      generationType: "photo_to_product",
      packageType: "short",
      duration: "7–10s",
      language: "en",
      description: {
        en: "Highlight key benefits and CTAs for e-commerce and retail launches.",
        zh: "突出卖点与行动号召，适合电商与零售上新。"
      },
      originalImages: [],
      videoUrl: null,
      poster: null
    },
    {
      id: "story-ad",
      title: { en: "Story-Driven Ad", zh: "故事型营销片" },
      category: "story",
      categoryLabel: { en: "Story Ad", zh: "故事广告" },
      generationType: "photos_to_story",
      packageType: "story",
      duration: "~45–48s",
      language: "en",
      description: {
        en: "Characters, dialogue and product integration for brand stories and campaigns.",
        zh: "角色、对白与产品结合，适合品牌故事与活动推广。"
      },
      originalImages: [],
      videoUrl: null,
      poster: null
    },
    {
      id: "story-series",
      title: { en: "4-Episode Brand Series", zh: "四集品牌故事" },
      category: "story-series",
      categoryLabel: { en: "AI Story Series", zh: "AI 故事系列" },
      generationType: "photos_to_story",
      packageType: "monthly",
      duration: "4 episodes",
      language: "en",
      description: {
        en: "Recurring characters, connected episodes and product presence — for Monthly packages.",
        zh: "固定角色、连贯剧情与产品植入 — 适合每月内容套餐。"
      },
      originalImages: [],
      videoUrl: null,
      poster: null
    }
  ];

  var FILTERS = [
    { id: "all", label: { en: "All", zh: "全部" } },
    { id: "photo_to_product", label: { en: "Product Ads", zh: "产品广告" } },
    { id: "photos_to_story", label: { en: "Story Commercials", zh: "故事广告" } }
  ];

  global.EmberSoulPortfolio = {
    projects: PROJECTS,
    filters: FILTERS
  };
})(typeof window !== "undefined" ? window : globalThis);
