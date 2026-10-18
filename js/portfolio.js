(function () {
  var data = window.EmberSoulPortfolio;
  if (!data || !Array.isArray(data.projects)) return;

  var grid = document.getElementById("showcase-grid");
  var filterHost = document.getElementById("portfolio-filters");
  if (!grid) return;

  var playing = null;
  var activeFilter = "all";
  var projectsById = {};
  var modal = null;
  var lastFocus = null;
  var seriesState = null;

  data.projects.forEach(function (project) {
    if (project && project.id) projectsById[project.id] = project;
  });

  function isSeries(project) {
    return !!(project && (project.format === "story_series" || project.generationType === "story_series"));
  }

  function hasVideo(project) {
    return !!(project && project.videoUrl);
  }

  function hasOriginals(project) {
    return !!(project && Array.isArray(project.originalImages) && project.originalImages.length);
  }

  function ctaHref(project) {
    var params = new URLSearchParams();
    if (isSeries(project)) {
      params.set("style", "story-series");
      if (project.slug) params.set("ref", "series-" + project.slug);
      else if (project.id) params.set("ref", project.id);
      return "/ai-ads/?" + params.toString() + "#inquiry";
    }
    var type = project.packageType || "short";
    params.set("type", type);
    if (project.category) params.set("style", project.category);
    if (project.id) params.set("ref", project.id);
    return "/ai-ads/?" + params.toString();
  }

  function ctaLabel(project) {
    if (isSeries(project)) {
      return {
        zh: "申请故事系列企划 →",
        en: "Request a Story Campaign →"
      };
    }
    return {
      zh: "做同款视频 →",
      en: "Create a Video Like This →"
    };
  }

  function generationBadge(project) {
    if (isSeries(project)) {
      var count = project.episodeCount || (project.episodes && project.episodes.length) || 0;
      return (
        '<span class="portfolio-badge" data-badge="series">' +
          '<span class="lang-zh">故事系列 · ' + escapeHtml(String(count)) + " 集</span>" +
          '<span class="lang-en">Story Series · ' + escapeHtml(String(count)) + " EP</span>" +
        "</span>"
      );
    }
    if (project.generationType === "photos_to_story") {
      return '<span class="portfolio-badge" data-badge="story"><span class="lang-zh">多图 → 故事广告</span><span class="lang-en">Photos → Story Ad</span></span>';
    }
    return '<span class="portfolio-badge" data-badge="product"><span class="lang-zh">照片 → 产品视频</span><span class="lang-en">Photo → Product Video</span></span>';
  }

  function escapeAttr(value) {
    return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function previewSrc(project) {
    if (isSeries(project) && project.coverUrl) return project.coverUrl;
    if (hasOriginals(project)) return project.originalImages[0];
    return "";
  }

  function previewVideoUrl(project) {
    if (isSeries(project) && project.episodes && project.episodes.length) return project.episodes[0].videoUrl;
    return project.videoUrl || "";
  }

  function videoTypeFor(url) {
    return /\.webm(?:$|\?)/i.test(url) ? "video/webm" : "video/mp4";
  }

  function renderEmptyState() {
    var empty = document.createElement("div");
    empty.className = "portfolio-empty";
    empty.innerHTML =
      '<p class="portfolio-empty-title"><span class="lang-zh">作品即将上线</span><span class="lang-en">Examples coming soon</span></p>' +
      '<p class="portfolio-empty-copy"><span class="lang-zh">上传配对的 before / after 素材，或系列成片到 assets/portfolio/series/ 后，这里会自动显示。</span><span class="lang-en">After paired before/after media or story-series episodes are uploaded, examples appear here automatically.</span></p>' +
      '<a class="showcase-cta portfolio-cta" href="/ai-ads/"><span class="lang-zh">先做一支 AI 广告 →</span><span class="lang-en">Create a Video Like This →</span></a>';
    return empty;
  }

  function renderAfterPreview(project) {
    var url = previewVideoUrl(project);
    if (!url) {
      return (
        '<div class="portfolio-thumb-frame">' +
          '<div class="portfolio-thumb-fallback" aria-hidden="true"></div>' +
        "</div>"
      );
    }
    return (
      '<div class="portfolio-thumb-frame has-play has-video-preview">' +
        '<video class="portfolio-after-preview" playsinline muted preload="metadata" tabindex="-1" aria-hidden="true"' +
          ' data-portfolio-preview data-src="' + escapeAttr(url) + '">' +
          '<source data-src="' + escapeAttr(url) + '" type="' + videoTypeFor(url) + '">' +
        "</video>" +
        '<span class="portfolio-play-hint" aria-hidden="true"><span class="portfolio-play-icon"></span></span>' +
      "</div>"
    );
  }

  function renderCompactPreview(project) {
    if (isSeries(project)) {
      var cover = previewSrc(project);
      var meta = [];
      var epCount = project.episodeCount || (project.episodes && project.episodes.length) || 0;
      if (epCount) meta.push(epCount + " EP");
      if (project.language) meta.push(escapeHtml(String(project.language).toUpperCase()));
      var metaHtml = meta.length ? '<span class="portfolio-preview-meta">' + meta.join(" · ") + "</span>" : "";
      var media =
        cover
          ? '<div class="portfolio-pane portfolio-pane-series-cover">' +
              '<div class="portfolio-thumb-frame">' +
                '<img src="' + escapeAttr(cover) + '" alt="" loading="lazy" decoding="async" width="320" height="180">' +
              "</div>" +
            "</div>" +
            '<span class="portfolio-arrow" aria-hidden="true">→</span>'
          : "";
      return (
        '<button type="button" class="portfolio-preview" data-portfolio-open aria-haspopup="dialog" aria-label="Open story series">' +
          '<div class="portfolio-media-compact portfolio-media-series">' +
            media +
            '<div class="portfolio-pane portfolio-pane-after">' +
              '<span class="portfolio-pane-label"><span class="lang-zh">系列预览</span><span class="lang-en">Series</span></span>' +
              renderAfterPreview(project) +
            "</div>" +
          "</div>" +
          metaHtml +
        "</button>"
      );
    }

    var beforeSrc = previewSrc(project);
    var metaBits = [];
    if (project.duration) metaBits.push(escapeHtml(project.duration));
    if (project.language) metaBits.push(escapeHtml(String(project.language).toUpperCase()));
    var metaLine = metaBits.length ? '<span class="portfolio-preview-meta">' + metaBits.join(" · ") + "</span>" : "";

    var beforePane = beforeSrc
      ? '<div class="portfolio-pane portfolio-pane-before">' +
          '<span class="portfolio-pane-label"><span class="lang-zh">Before</span><span class="lang-en">Before</span></span>' +
          '<div class="portfolio-thumb-frame">' +
            '<img src="' + escapeAttr(beforeSrc) + '" alt="" loading="lazy" decoding="async" width="320" height="180">' +
          "</div>" +
        "</div>"
      : "";

    var afterPane =
      '<div class="portfolio-pane portfolio-pane-after">' +
        '<span class="portfolio-pane-label"><span class="lang-zh">After</span><span class="lang-en">After</span></span>' +
        renderAfterPreview(project) +
      "</div>";

    return (
      '<button type="button" class="portfolio-preview" data-portfolio-open aria-haspopup="dialog" aria-label="Open Before and After comparison">' +
        '<div class="portfolio-media-compact">' +
          beforePane +
          (beforeSrc ? '<span class="portfolio-arrow" aria-hidden="true">→</span>' : "") +
          afterPane +
        "</div>" +
        metaLine +
      "</button>"
    );
  }

  function renderCard(project) {
    var article = document.createElement("article");
    article.className = "showcase-card portfolio-card";
    article.dataset.category = project.category || "";
    article.dataset.generationType = project.generationType || "";
    article.dataset.portfolioId = project.id;
    article.dataset.format = project.format || "commercial";
    if (isSeries(project)) article.classList.add("is-series");
    if (hasOriginals(project) || project.coverUrl) article.classList.add("has-before-after");
    if (hasVideo(project) || previewVideoUrl(project)) article.classList.add("has-video");

    var cta = ctaLabel(project);
    var expandZh = isSeries(project) ? "查看系列" : "查看完整对比";
    var expandEn = isSeries(project) ? "View series" : "View full comparison";

    article.innerHTML =
      generationBadge(project) +
      renderCompactPreview(project) +
      '<div class="showcase-meta">' +
        '<p class="showcase-cat"><span class="lang-zh">' + escapeHtml(project.categoryLabel && project.categoryLabel.zh || "") +
          '</span><span class="lang-en">' + escapeHtml(project.categoryLabel && project.categoryLabel.en || "") + "</span></p>" +
        '<h3 class="showcase-title"><span class="lang-zh">' + escapeHtml(project.title && project.title.zh || "") +
          '</span><span class="lang-en">' + escapeHtml(project.title && project.title.en || "") + "</span></h3>" +
        '<p class="showcase-desc"><span class="lang-zh">' + escapeHtml(project.description && project.description.zh || "") +
          '</span><span class="lang-en">' + escapeHtml(project.description && project.description.en || "") + "</span></p>" +
        '<div class="portfolio-card-actions">' +
          '<button type="button" class="portfolio-expand" data-portfolio-open>' +
            '<span class="lang-zh">' + expandZh + '</span><span class="lang-en">' + expandEn + "</span>" +
          "</button>" +
          '<a href="' + ctaHref(project) + '" class="showcase-cta portfolio-cta">' +
            '<span class="lang-zh">' + escapeHtml(cta.zh) + '</span><span class="lang-en">' + escapeHtml(cta.en) + "</span>" +
          "</a>" +
        "</div>" +
      "</div>";

    return article;
  }

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "portfolio-modal";
    modal.hidden = true;
    modal.innerHTML =
      '<div class="portfolio-modal-backdrop" data-portfolio-close tabindex="-1"></div>' +
      '<div class="portfolio-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="portfolio-modal-title" tabindex="-1">' +
        '<button type="button" class="portfolio-modal-close" data-portfolio-close aria-label="Close">' +
          '<span aria-hidden="true">×</span>' +
        "</button>" +
        '<div class="portfolio-modal-header">' +
          '<p class="portfolio-modal-kicker" id="portfolio-modal-kicker"></p>' +
          '<h3 class="portfolio-modal-title" id="portfolio-modal-title"></h3>' +
        "</div>" +
        '<div class="portfolio-modal-body" id="portfolio-modal-body"></div>' +
        '<div class="portfolio-modal-footer" id="portfolio-modal-footer"></div>' +
      "</div>";
    document.body.appendChild(modal);

    modal.addEventListener("click", function (event) {
      if (event.target.closest("[data-portfolio-close]")) closeModal();
      var epBtn = event.target.closest("[data-series-ep]");
      if (epBtn && seriesState) {
        selectEpisode(Number(epBtn.getAttribute("data-series-ep")));
      }
      if (event.target.closest("[data-series-prev]") && seriesState) {
        selectEpisode(seriesState.index - 1);
      }
      if (event.target.closest("[data-series-next]") && seriesState) {
        selectEpisode(seriesState.index + 1);
      }
    });

    document.addEventListener("keydown", function (event) {
      if (modal.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
        return;
      }
      if (seriesState) {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          selectEpisode(seriesState.index - 1);
          return;
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          selectEpisode(seriesState.index + 1);
          return;
        }
      }
      if (event.key === "Tab") trapFocus(event);
    });

    return modal;
  }

  function getFocusable(container) {
    return Array.prototype.slice.call(
      container.querySelectorAll(
        'a[href], button:not([disabled]), video, textarea, input, select, [tabindex]:not([tabindex="-1"])'
      )
    ).filter(function (node) {
      return !node.hasAttribute("disabled") && node.offsetParent !== null;
    });
  }

  function trapFocus(event) {
    var dialog = modal.querySelector(".portfolio-modal-dialog");
    var focusable = getFocusable(dialog);
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function pauseAllVideos() {
    Array.prototype.forEach.call(
      document.querySelectorAll("video[data-portfolio-video], video[data-portfolio-preview], video[data-series-video]"),
      function (video) {
        if (!video.paused) video.pause();
      }
    );
    playing = null;
  }

  function closeModal() {
    if (!modal || modal.hidden) return;
    pauseAllVideos();
    seriesState = null;
    modal.hidden = true;
    modal.classList.remove("is-open");
    document.body.classList.remove("portfolio-modal-open");
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
    lastFocus = null;
  }

  function openCommercialModal(project) {
    var kicker = modal.querySelector("#portfolio-modal-kicker");
    var title = modal.querySelector("#portfolio-modal-title");
    var body = modal.querySelector("#portfolio-modal-body");
    var footer = modal.querySelector("#portfolio-modal-footer");
    var cta = ctaLabel(project);

    kicker.innerHTML =
      '<span class="lang-zh">' + escapeHtml(project.categoryLabel && project.categoryLabel.zh || "") +
      '</span><span class="lang-en">' + escapeHtml(project.categoryLabel && project.categoryLabel.en || "") + "</span>";
    title.innerHTML =
      '<span class="lang-zh">' + escapeHtml(project.title && project.title.zh || "") +
      '</span><span class="lang-en">' + escapeHtml(project.title && project.title.en || "") + "</span>";

    var beforeHtml = "";
    if (hasOriginals(project)) {
      var multi = project.originalImages.length > 1;
      beforeHtml =
        '<div class="portfolio-modal-pane">' +
          '<p class="portfolio-pane-label"><span class="lang-zh">Before' + (multi ? " · 参考照片" : " · 原图") +
            '</span><span class="lang-en">Before' + (multi ? " · Reference photos" : "") + "</span></p>" +
          '<div class="portfolio-modal-thumbs' + (multi ? " is-multi" : "") + '">' +
            project.originalImages.map(function (src, index) {
              return (
                '<figure class="portfolio-modal-figure">' +
                  '<img src="' + escapeAttr(src) + '" alt="Original reference ' + (index + 1) + '" loading="lazy" decoding="async">' +
                "</figure>"
              );
            }).join("") +
          "</div>" +
        "</div>";
    }

    var afterHtml = "";
    if (hasVideo(project)) {
      afterHtml =
        '<div class="portfolio-modal-pane">' +
          '<p class="portfolio-pane-label"><span class="lang-zh">After · AI 成片</span><span class="lang-en">After</span></p>' +
          '<div class="portfolio-modal-video">' +
            '<video playsinline preload="none" controls data-portfolio-video' +
              ' src="' + escapeAttr(project.videoUrl) + '">' +
              '<source src="' + escapeAttr(project.videoUrl) + '" type="' + videoTypeFor(project.videoUrl) + '">' +
            "</video>" +
          "</div>" +
        "</div>";
    }

    body.innerHTML =
      '<div class="portfolio-modal-compare">' +
        beforeHtml +
        (beforeHtml && afterHtml ? '<div class="portfolio-arrow portfolio-modal-arrow" aria-hidden="true">→</div>' : "") +
        afterHtml +
      "</div>";

    footer.innerHTML =
      '<a href="' + ctaHref(project) + '" class="showcase-cta portfolio-cta">' +
        '<span class="lang-zh">' + escapeHtml(cta.zh) + '</span><span class="lang-en">' + escapeHtml(cta.en) + "</span>" +
      "</a>";

    var modalVideo = body.querySelector("video[data-portfolio-video]");
    if (modalVideo) {
      modalVideo.addEventListener("play", function () {
        pauseOthers(modalVideo);
      });
    }
  }

  function renderSeriesEpisodeNav(project, index) {
    return (
      '<div class="series-ep-nav" role="tablist" aria-label="Episodes">' +
        project.episodes.map(function (ep, i) {
          var selected = i === index;
          return (
            '<button type="button" class="series-ep-chip" role="tab" data-series-ep="' + i + '"' +
              ' aria-selected="' + (selected ? "true" : "false") + '"' +
              (selected ? ' aria-current="true"' : "") + ">" +
              '<span class="lang-zh">' + escapeHtml(ep.title && ep.title.zh || ep.id) + "</span>" +
              '<span class="lang-en">' + escapeHtml(ep.title && ep.title.en || ep.id) + "</span>" +
            "</button>"
          );
        }).join("") +
      "</div>"
    );
  }

  function renderSeriesBody(project, index) {
    var ep = project.episodes[index];
    if (!ep) return "";
    var progress = (index + 1) + " / " + project.episodes.length;
    var duration = ep.duration ? escapeHtml(ep.duration) : "";
    var refs = Array.isArray(ep.references) && ep.references.length
      ? '<div class="series-refs">' +
          '<p class="portfolio-pane-label"><span class="lang-zh">参考图</span><span class="lang-en">References</span></p>' +
          '<div class="portfolio-modal-thumbs is-multi">' +
            ep.references.map(function (src, i) {
              return (
                '<figure class="portfolio-modal-figure">' +
                  '<img src="' + escapeAttr(src) + '" alt="Episode reference ' + (i + 1) + '" loading="lazy" decoding="async">' +
                "</figure>"
              );
            }).join("") +
          "</div>" +
        "</div>"
      : "";

    return (
      '<div class="series-viewer">' +
        '<p class="series-progress">' +
          '<span class="lang-zh">进度 ' + progress + (duration ? " · " + duration : "") + "</span>" +
          '<span class="lang-en">Episode ' + progress + (duration ? " · " + duration : "") + "</span>" +
        "</p>" +
        renderSeriesEpisodeNav(project, index) +
        '<div class="portfolio-modal-video series-video-wrap">' +
          '<video playsinline preload="metadata" controls data-series-video data-portfolio-video' +
            ' src="' + escapeAttr(ep.videoUrl) + '">' +
            '<source src="' + escapeAttr(ep.videoUrl) + '" type="' + videoTypeFor(ep.videoUrl) + '">' +
          "</video>" +
        "</div>" +
        '<p class="series-ep-desc"><span class="lang-zh">' + escapeHtml(ep.description && ep.description.zh || "") +
          '</span><span class="lang-en">' + escapeHtml(ep.description && ep.description.en || "") + "</span></p>" +
        refs +
        '<div class="series-controls">' +
          '<button type="button" class="btn btn-ghost" data-series-prev' + (index <= 0 ? " disabled" : "") + ">" +
            '<span class="lang-zh">上一集</span><span class="lang-en">Previous</span>' +
          "</button>" +
          '<button type="button" class="btn btn-ghost" data-series-next' + (index >= project.episodes.length - 1 ? " disabled" : "") + ">" +
            '<span class="lang-zh">下一集</span><span class="lang-en">Next</span>' +
          "</button>" +
        "</div>" +
      "</div>"
    );
  }

  function openSeriesModal(project) {
    seriesState = { project: project, index: 0 };
    var kicker = modal.querySelector("#portfolio-modal-kicker");
    var title = modal.querySelector("#portfolio-modal-title");
    var body = modal.querySelector("#portfolio-modal-body");
    var footer = modal.querySelector("#portfolio-modal-footer");
    var cta = ctaLabel(project);

    kicker.innerHTML =
      '<span class="lang-zh">' + escapeHtml(project.categoryLabel && project.categoryLabel.zh || "故事系列") +
      '</span><span class="lang-en">' + escapeHtml(project.categoryLabel && project.categoryLabel.en || "Story Series") + "</span>";
    title.innerHTML =
      '<span class="lang-zh">' + escapeHtml(project.title && project.title.zh || "") +
      '</span><span class="lang-en">' + escapeHtml(project.title && project.title.en || "") + "</span>";

    body.innerHTML = renderSeriesBody(project, 0);
    footer.innerHTML =
      '<a href="' + ctaHref(project) + '" class="showcase-cta portfolio-cta">' +
        '<span class="lang-zh">' + escapeHtml(cta.zh) + '</span><span class="lang-en">' + escapeHtml(cta.en) + "</span>" +
      "</a>";

    bindSeriesVideo();
  }

  function bindSeriesVideo() {
    var video = modal.querySelector("video[data-series-video]");
    if (!video) return;
    video.addEventListener("play", function () {
      pauseOthers(video);
    });
  }

  function selectEpisode(index) {
    if (!seriesState || !modal) return;
    var project = seriesState.project;
    if (!project.episodes || index < 0 || index >= project.episodes.length) return;
    pauseAllVideos();
    seriesState.index = index;
    var body = modal.querySelector("#portfolio-modal-body");
    body.innerHTML = renderSeriesBody(project, index);
    bindSeriesVideo();
    var chip = body.querySelector('[data-series-ep="' + index + '"]');
    if (chip) chip.focus();
  }

  function openModal(project, opener) {
    ensureModal();
    lastFocus = opener || document.activeElement;
    pauseAllVideos();
    seriesState = null;

    if (isSeries(project)) openSeriesModal(project);
    else openCommercialModal(project);

    modal.hidden = false;
    modal.classList.add("is-open");
    document.body.classList.add("portfolio-modal-open");
    var dialog = modal.querySelector(".portfolio-modal-dialog");
    dialog.focus();
  }

  function pauseOthers(except) {
    Array.prototype.forEach.call(
      document.querySelectorAll("video[data-portfolio-video], video[data-portfolio-preview], video[data-series-video]"),
      function (video) {
        if (video !== except && !video.paused) video.pause();
      }
    );
    playing = except || null;
  }

  function hydratePreviewVideos(root) {
    var scope = root || grid;
    Array.prototype.forEach.call(scope.querySelectorAll("video[data-portfolio-preview]"), function (video) {
      if (video.dataset.hydrated === "1") return;
      var src = video.getAttribute("data-src");
      if (!src) return;
      video.src = src;
      Array.prototype.forEach.call(video.querySelectorAll("source[data-src]"), function (source) {
        source.src = source.getAttribute("data-src");
      });
      video.dataset.hydrated = "1";
      video.load();
      video.addEventListener("play", function (event) {
        event.preventDefault();
        video.pause();
      });
    });
  }

  function observePreviewVideos() {
    var videos = grid.querySelectorAll("video[data-portfolio-preview]");
    if (!videos.length) return;
    if (!("IntersectionObserver" in window)) {
      hydratePreviewVideos(grid);
      return;
    }
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          hydratePreviewVideos(entry.target.parentNode || entry.target);
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "120px 0px", threshold: 0.01 }
    );
    Array.prototype.forEach.call(videos, function (video) {
      observer.observe(video);
    });
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
    });
    if (!modal || modal.hidden) return;
    var openId = modal.dataset.openId;
    if (openId) {
      var openCard = grid.querySelector('.portfolio-card[data-portfolio-id="' + openId + '"]');
      if (openCard && openCard.hidden) closeModal();
    }
  }

  function bindCard(card) {
    var project = projectsById[card.dataset.portfolioId];
    if (!project) return;
    Array.prototype.forEach.call(card.querySelectorAll("[data-portfolio-open]"), function (trigger) {
      trigger.addEventListener("click", function () {
        pauseOthers(null);
        ensureModal().dataset.openId = project.id;
        openModal(project, trigger);
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
    observePreviewVideos();
  }

  mount();
})();
