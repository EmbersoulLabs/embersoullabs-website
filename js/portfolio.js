(function () {
  var data = window.EmberSoulPortfolio;
  if (!data || !Array.isArray(data.projects)) return;

  var grid = document.getElementById("showcase-grid");
  var filterHost = document.getElementById("portfolio-filters");
  if (!grid) return;

  var playing = null;
  var activeFilter = "all";

  function t(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    var lang = document.documentElement.getAttribute("data-lang") === "zh" ? "zh" : "en";
    return value[lang] || value.en || value.zh || "";
  }

  function hasVideo(project) {
    return !!(project && project.videoUrl);
  }

  function hasOriginals(project) {
    return !!(project && Array.isArray(project.originalImages) && project.originalImages.length);
  }

  function ctaHref(project) {
    var type = project.packageType || "short";
    var params = new URLSearchParams();
    params.set("type", type);
    if (project.category) params.set("style", project.category);
    if (project.id) params.set("ref", project.id);
    return "/ai-ads/?" + params.toString();
  }

  function generationBadge(project) {
    if (project.generationType === "photos_to_story") {
      return '<span class="portfolio-badge" data-badge="story"><span class="lang-zh">多图 → 故事广告</span><span class="lang-en">Photos → Story Ad</span></span>';
    }
    return '<span class="portfolio-badge" data-badge="product"><span class="lang-zh">照片 → 产品视频</span><span class="lang-en">Photo → Product Video</span></span>';
  }

  function renderOriginals(project) {
    if (!hasOriginals(project)) return "";
    var multi = project.originalImages.length > 1;
    var label = multi
      ? '<span class="lang-zh">Before · 参考照片</span><span class="lang-en">Before · Reference photos</span>'
      : '<span class="lang-zh">Before · 原图</span><span class="lang-en">Before</span>';
    var thumbs = project.originalImages.map(function (src, index) {
      return (
        '<button type="button" class="portfolio-thumb" data-original-index="' + index + '" aria-label="Original photo ' + (index + 1) + '">' +
          '<img src="' + src + '" alt="" loading="lazy" decoding="async" width="120" height="160">' +
        "</button>"
      );
    }).join("");
    return (
      '<div class="portfolio-before">' +
        '<p class="portfolio-pane-label">' + label + "</p>" +
        '<div class="portfolio-thumbs' + (multi ? " is-multi" : "") + '">' + thumbs + "</div>" +
      "</div>"
    );
  }

  function renderVideoPane(project) {
    var meta = [];
    if (project.duration) meta.push(escapeHtml(project.duration));
    if (project.language) meta.push(escapeHtml(String(project.language).toUpperCase()));
    var metaHtml = meta.length ? '<p class="portfolio-pane-meta">' + meta.join(" · ") + "</p>" : "";

    if (hasVideo(project)) {
      var videoType = /\.webm(?:$|\?)/i.test(project.videoUrl) ? "video/webm" : "video/mp4";
      return (
        '<div class="portfolio-after">' +
          '<p class="portfolio-pane-label"><span class="lang-zh">After · AI 成片</span><span class="lang-en">After</span></p>' +
          '<div class="video-frame portfolio-video-frame">' +
            '<video playsinline preload="none" controls' +
              (project.poster ? ' poster="' + escapeAttr(project.poster) + '"' : "") +
              ' data-portfolio-video src="' + escapeAttr(project.videoUrl) + '">' +
              "<source src=\"" + escapeAttr(project.videoUrl) + "\" type=\"" + videoType + "\">" +
            "</video>" +
          "</div>" +
          metaHtml +
        "</div>"
      );
    }

    var placeholderHint = project.category === "story-series"
      ? '<span class="play-hint">AI STORY SERIES</span>'
      : '<span class="play-hint">9:16</span>';
    var episode = project.category === "story-series"
      ? '<div class="episode-flow episode-flow-compact" aria-hidden="true"><span class="ep-chip">EP01</span><span class="ep-arrow">→</span><span class="ep-chip">EP02</span><span class="ep-arrow">→</span><span class="ep-chip">EP03</span><span class="ep-arrow">→</span><span class="ep-chip">EP04</span></div>'
      : "";

    return (
      '<div class="portfolio-after">' +
        '<p class="portfolio-pane-label"><span class="lang-zh">AI 成片</span><span class="lang-en">AI video</span></p>' +
        '<div class="video-frame" data-video-slot>' +
          '<div class="video-placeholder">' +
            placeholderHint +
            episode +
            '<p><span class="lang-zh">成片上线后可在此播放</span><span class="lang-en">Video plays here when published</span></p>' +
          "</div>" +
        "</div>" +
        metaHtml +
      "</div>"
    );
  }

  function escapeAttr(value) {
    return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderEmptyState() {
    var empty = document.createElement("div");
    empty.className = "portfolio-empty";
    empty.innerHTML =
      '<p class="portfolio-empty-title"><span class="lang-zh">作品即将上线</span><span class="lang-en">Examples coming soon</span></p>' +
      '<p class="portfolio-empty-copy"><span class="lang-zh">上传配对的 before / after 素材并部署后，这里会自动显示原图与 AI 成片对比。</span><span class="lang-en">After paired before/after media is uploaded and deployed, original photos and AI videos appear here automatically.</span></p>' +
      '<a class="showcase-cta portfolio-cta" href="/ai-ads/"><span class="lang-zh">先做一支 AI 广告 →</span><span class="lang-en">Create a Video Like This →</span></a>';
    return empty;
  }

  function renderCard(project) {
    var compare = hasOriginals(project);
    var article = document.createElement("article");
    article.className = "showcase-card portfolio-card";
    article.dataset.category = project.category || "";
    article.dataset.generationType = project.generationType || "";
    article.dataset.portfolioId = project.id;
    if (compare) {
      article.classList.add("has-before-after");
      article.classList.add("is-expanded");
    }
    if (hasVideo(project)) article.classList.add("has-video");

    var media =
      '<div class="portfolio-media">' +
        (compare ? renderOriginals(project) + '<div class="portfolio-arrow" aria-hidden="true">→</div>' : "") +
        renderVideoPane(project) +
      "</div>";

    var expandControl = compare
      ? '<button type="button" class="portfolio-expand" aria-expanded="true">' +
          '<span class="lang-zh">收起 / 展开对比</span><span class="lang-en">Collapse / expand comparison</span>' +
        "</button>"
      : "";

    article.innerHTML =
      generationBadge(project) +
      media +
      '<div class="showcase-meta">' +
        '<p class="showcase-cat"><span class="lang-zh">' + escapeHtml(project.categoryLabel && project.categoryLabel.zh || "") +
          '</span><span class="lang-en">' + escapeHtml(project.categoryLabel && project.categoryLabel.en || "") + "</span></p>" +
        '<h3 class="showcase-title"><span class="lang-zh">' + escapeHtml(project.title && project.title.zh || "") +
          '</span><span class="lang-en">' + escapeHtml(project.title && project.title.en || "") + "</span></h3>" +
        '<p class="showcase-desc"><span class="lang-zh">' + escapeHtml(project.description && project.description.zh || "") +
          '</span><span class="lang-en">' + escapeHtml(project.description && project.description.en || "") + "</span></p>" +
        expandControl +
        '<a href="' + ctaHref(project) + '" class="showcase-cta portfolio-cta">' +
          '<span class="lang-zh">做同款视频 →</span><span class="lang-en">Create a Video Like This →</span>' +
        "</a>" +
      "</div>";

    return article;
  }

  function renderFilters() {
    if (!filterHost || !Array.isArray(data.filters)) return;
    filterHost.innerHTML = "";
    filterHost.setAttribute("role", "tablist");
    filterHost.setAttribute("aria-label", "Portfolio filters");
    data.filters.forEach(function (filter) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "chip portfolio-filter";
      button.dataset.filter = filter.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", filter.id === activeFilter ? "true" : "false");
      button.innerHTML =
        '<span class="lang-zh">' + escapeHtml(filter.label.zh) + "</span>" +
        '<span class="lang-en">' + escapeHtml(filter.label.en) + "</span>";
      button.addEventListener("click", function () {
        activeFilter = filter.id;
        Array.prototype.forEach.call(filterHost.querySelectorAll(".portfolio-filter"), function (node) {
          node.setAttribute("aria-selected", node.dataset.filter === activeFilter ? "true" : "false");
        });
        applyFilter();
      });
      filterHost.appendChild(button);
    });
  }

  function applyFilter() {
    Array.prototype.forEach.call(grid.querySelectorAll(".portfolio-card"), function (card) {
      var type = card.dataset.generationType || "";
      var show = activeFilter === "all" || type === activeFilter;
      card.hidden = !show;
      if (!show) {
        var video = card.querySelector("video");
        if (video && !video.paused) video.pause();
      }
    });
  }

  function pauseOthers(except) {
    Array.prototype.forEach.call(grid.querySelectorAll("video[data-portfolio-video]"), function (video) {
      if (video !== except && !video.paused) video.pause();
    });
    playing = except || null;
  }

  function bindCard(card) {
    var video = card.querySelector("video[data-portfolio-video]");
    if (video) {
      video.addEventListener("play", function () {
        pauseOthers(video);
      });
    }

    var expand = card.querySelector(".portfolio-expand");
    if (expand) {
      expand.addEventListener("click", function () {
        var open = card.classList.toggle("is-expanded");
        expand.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }

    Array.prototype.forEach.call(card.querySelectorAll(".portfolio-thumb"), function (thumb) {
      thumb.addEventListener("click", function () {
        Array.prototype.forEach.call(card.querySelectorAll(".portfolio-thumb"), function (node) {
          node.classList.toggle("is-active", node === thumb);
        });
        card.classList.add("is-expanded");
        if (expand) expand.setAttribute("aria-expanded", "true");
      });
    });
  }

  function mount() {
    grid.innerHTML = "";
    if (!data.projects.length) {
      grid.appendChild(renderEmptyState());
      if (filterHost) filterHost.hidden = true;
      return;
    }
    if (filterHost) filterHost.hidden = false;
    data.projects.forEach(function (project) {
      var card = renderCard(project);
      grid.appendChild(card);
      bindCard(card);
    });
    renderFilters();
    applyFilter();
  }

  mount();
})();
