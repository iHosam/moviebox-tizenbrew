/**
 * MovieBox (Morphe Edition) — Main Application Controller
 * Handles 10-foot spatial navigation, views, TV remote keybindings,
 * hero spotlight, and detail modal.
 */
var MovieBoxApp = (function () {
  var TABS = ["Home", "Movies", "Series", "Search", "My List", "Settings"];
  var activeTab = 0;
  var focusedEl = null;
  var currentDetailMeta = null;

  function el(id) {
    return document.getElementById(id);
  }

  function toast(msg) {
    var t = el("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(function () {
      t.classList.remove("show");
    }, 2800);
  }

  function setFocus(node) {
    if (!node) return;
    if (focusedEl && focusedEl !== node) {
      focusedEl.classList.remove("focused");
    }
    focusedEl = node;
    node.classList.add("focused");
    try {
      node.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    } catch (e) {}
  }

  function makeFocusable(node, onClick) {
    node.classList.add("focusable");
    node.tabIndex = 0;
    if (onClick) {
      node._onClick = onClick;
      node.addEventListener("click", function (e) {
        e.stopPropagation();
        onClick(node);
      });
    }
    node.addEventListener("mouseenter", function () {
      setFocus(node);
    });
    return node;
  }

  // --- Modal Helpers ---
  function showModal(title, items) {
    var modal = el("list-modal");
    el("list-modal-title").textContent = title;
    var list = el("list-modal-items");
    list.innerHTML = "";

    items.forEach(function (it) {
      var btn = document.createElement("div");
      btn.className = "modal-item focusable";
      btn.textContent = it.label;
      makeFocusable(btn, function () {
        modal.classList.remove("open");
        if (it.action) it.action();
      });
      list.appendChild(btn);
    });

    el("list-modal-close").onclick = function () {
      modal.classList.remove("open");
    };

    modal.classList.add("open");
    var first = list.querySelector(".focusable");
    if (first) setFocus(first);
  }

  // --- Navigation & Views ---
  function init() {
    renderTopTabs();
    MovieBoxPlayer.init();
    bindRemoteKeys();
    switchTab(0);
  }

  function renderTopTabs() {
    var nav = el("nav-tabs");
    nav.innerHTML = "";
    TABS.forEach(function (name, idx) {
      var tab = document.createElement("div");
      tab.className = "nav-tab focusable" + (idx === activeTab ? " active" : "");
      tab.textContent = name;
      makeFocusable(tab, function () {
        switchTab(idx);
      });
      nav.appendChild(tab);
    });

    makeFocusable(el("app-brand"), function () {
      switchTab(0);
    });

    makeFocusable(el("top-search-trigger"), function () {
      switchTab(3); // Search tab
    });
  }

  function switchTab(idx) {
    activeTab = idx;
    var tabs = document.querySelectorAll(".nav-tab");
    tabs.forEach(function (t, i) {
      t.classList.toggle("active", i === idx);
    });

    var page = el("page-content");
    page.innerHTML = "";

    if (idx === 0) renderHomeView(page);
    else if (idx === 1) renderCatalogView(page, "movie");
    else if (idx === 2) renderCatalogView(page, "series");
    else if (idx === 3) renderSearchView(page);
    else if (idx === 4) renderMyListView(page);
    else if (idx === 5) renderSettingsView(page);
  }

  // --- 1. Home View (Hero Spotlight + Media Rows) ---
  function renderHomeView(container) {
    toast("Loading MovieBox Morphe Spotlight…");

    Promise.all([
      MovieBoxCatalog.getTrendingMovies(),
      MovieBoxCatalog.getTrendingSeries(),
      MovieBoxCatalog.getByGenre("movie", "Action"),
      MovieBoxCatalog.getByGenre("movie", "Sci-Fi"),
      MovieBoxCatalog.getByGenre("series", "Animation")
    ]).then(function (results) {
      var movies = results[0] || [];
      var series = results[1] || [];
      var action = results[2] || [];
      var scifi = results[3] || [];
      var anime = results[4] || [];

      // Hero Spotlight (from Top Trending Movie)
      if (movies.length > 0) {
        var heroMeta = movies[0];
        var hero = document.createElement("div");
        hero.className = "hero-spotlight";

        var bg = document.createElement("img");
        bg.className = "hero-backdrop";
        bg.src = heroMeta.background || heroMeta.poster;
        hero.appendChild(bg);

        var vig = document.createElement("div");
        vig.className = "hero-vignette";
        hero.appendChild(vig);

        var content = document.createElement("div");
        content.className = "hero-content";
        content.innerHTML =
          '<span class="hero-tag">🔥 MORPHE SPOTLIGHT</span>' +
          '<h1 class="hero-title">' + (heroMeta.name || "MovieBox Pick") + '</h1>' +
          '<div class="hero-meta-row">' +
            '<span class="meta-pill gold">⭐ ' + (heroMeta.imdbRating || "8.4") + '</span>' +
            '<span class="meta-pill">' + (heroMeta.year || "2026") + '</span>' +
            '<span class="meta-pill green">1080p FHD</span>' +
            '<span class="meta-pill vip">VIP UNLOCKED</span>' +
          '</div>' +
          '<p class="hero-desc">' + (heroMeta.description || "Stream blockbusters in full HD ad-free on your TV.") + '</p>' +
          '<div class="hero-btns">' +
            '<div id="hero-play-btn" class="action-btn primary focusable">▶ Watch Now</div>' +
            '<div id="hero-info-btn" class="action-btn focusable">ℹ Detail &amp; Servers</div>' +
          '</div>';

        hero.appendChild(content);
        container.appendChild(hero);

        makeFocusable(content.querySelector("#hero-play-btn"), function () {
          MovieBoxPlayer.open(heroMeta);
        });

        makeFocusable(content.querySelector("#hero-info-btn"), function () {
          openDetailModal(heroMeta.id, "movie");
        });
      }

      // Continue Watching Row (if any)
      var hist = MovieBoxCatalog.getHistory();
      if (hist && hist.length > 0) {
        createMediaRow(container, "🕒 Continue Watching", hist);
      }

      // Curated Rows
      createMediaRow(container, "🔥 Trending Movies", movies);
      createMediaRow(container, "📺 Binge-Worthy TV Series", series);
      createMediaRow(container, "💥 High-Octane Action", action);
      createMediaRow(container, "🚀 Sci-Fi &amp; Future Worlds", scifi);
      createMediaRow(container, "🎌 Anime &amp; Animation", anime);

      // Focus first actionable button
      var firstBtn = container.querySelector(".hero-btns .focusable");
      if (firstBtn) setFocus(firstBtn);
    });
  }

  function createMediaRow(container, title, items) {
    if (!items || items.length === 0) return;
    var sec = document.createElement("section");
    sec.className = "media-section";

    var h2 = document.createElement("h2");
    h2.className = "section-title";
    h2.innerHTML = title;
    sec.appendChild(h2);

    var row = document.createElement("div");
    row.className = "h-row";

    items.forEach(function (m) {
      var card = document.createElement("div");
      card.className = "media-card focusable";
      card.innerHTML =
        '<img src="' + (m.poster || "") + '" alt="' + (m.name || "") + '" loading="lazy" />' +
        (m.imdbRating ? '<div class="media-card-badge">⭐ ' + m.imdbRating + '</div>' : '') +
        '<div class="media-card-info">' +
          '<div class="media-card-title">' + (m.name || "Untitled") + '</div>' +
          '<div class="media-card-sub">' + (m.year || (m.type === "series" ? "TV Series" : "Movie")) + '</div>' +
        '</div>';

      makeFocusable(card, function () {
        openDetailModal(m.id, m.type || "movie");
      });

      row.appendChild(card);
    });

    sec.appendChild(row);
    container.appendChild(sec);
  }

  // --- 2. Catalog View (Movies / Series Grid) ---
  function renderCatalogView(container, type) {
    var isSeries = type === "series";
    var heading = document.createElement("div");
    heading.style.padding = "40px 60px 10px 60px";
    heading.innerHTML = "<h1 style='font-size:38px;font-weight:800;'>" + (isSeries ? "📺 TV Series Catalog" : "🍿 Movies Catalog") + "</h1>";
    container.appendChild(heading);

    // Genre Filter Pills
    var genreRow = document.createElement("div");
    genreRow.className = "h-row";
    genreRow.style.padding = "10px 60px 20px 60px";

    var allPill = document.createElement("div");
    allPill.className = "season-chip focusable active";
    allPill.textContent = "All Featured";
    makeFocusable(allPill, function () {
      loadGrid(null);
    });
    genreRow.appendChild(allPill);

    MovieBoxCatalog.GENRES.forEach(function (g) {
      var pill = document.createElement("div");
      pill.className = "season-chip focusable";
      pill.textContent = g;
      makeFocusable(pill, function () {
        document.querySelectorAll(".season-chip").forEach(function (c) { c.classList.remove("active"); });
        pill.classList.add("active");
        loadGrid(g);
      });
      genreRow.appendChild(pill);
    });
    container.appendChild(genreRow);

    var grid = document.createElement("div");
    grid.className = "media-grid";
    container.appendChild(grid);

    function loadGrid(genre) {
      grid.innerHTML = "<p style='color:#888;padding:40px;'>Loading " + (genre || "featured") + " titles…</p>";
      var fetchPromise = genre
        ? MovieBoxCatalog.getByGenre(type, genre)
        : (isSeries ? MovieBoxCatalog.getTrendingSeries() : MovieBoxCatalog.getTrendingMovies());

      fetchPromise.then(function (items) {
        grid.innerHTML = "";
        (items || []).forEach(function (m) {
          var card = document.createElement("div");
          card.className = "media-card focusable";
          card.innerHTML =
            '<img src="' + (m.poster || "") + '" alt="' + (m.name || "") + '" loading="lazy" />' +
            (m.imdbRating ? '<div class="media-card-badge">⭐ ' + m.imdbRating + '</div>' : '') +
            '<div class="media-card-info">' +
              '<div class="media-card-title">' + (m.name || "Untitled") + '</div>' +
              '<div class="media-card-sub">' + (m.year || "") + '</div>' +
            '</div>';

          makeFocusable(card, function () {
            openDetailModal(m.id, type);
          });
          grid.appendChild(card);
        });

        var first = grid.querySelector(".focusable");
        if (first) setFocus(first);
      });
    }

    loadGrid(null);
  }

  // --- 3. Search View (On-Screen TV Keyboard) ---
  function renderSearchView(container) {
    var wrap = document.createElement("div");
    wrap.className = "search-container";

    var searchVal = "";

    var inputDisplay = document.createElement("div");
    inputDisplay.className = "search-input-box";
    inputDisplay.innerHTML = "<span>🔍</span><span id='search-text' style='color:#ffb800;'>Type movie or show title…</span>";
    wrap.appendChild(inputDisplay);

    // TV Remote Friendly Keyboard
    var kb = document.createElement("div");
    kb.className = "tv-keyboard";

    var rows = [
      ["A", "B", "C", "D", "E", "F", "1", "2", "3"],
      ["G", "H", "I", "J", "K", "L", "4", "5", "6"],
      ["M", "N", "O", "P", "Q", "R", "7", "8", "9"],
      ["S", "T", "U", "V", "W", "X", "Y", "Z", "0"],
      ["SPACE", "BACKSPACE", "CLEAR"]
    ];

    rows.forEach(function (r) {
      var rowEl = document.createElement("div");
      rowEl.className = "kb-row";
      r.forEach(function (k) {
        var keyBtn = document.createElement("div");
        keyBtn.className = "kb-key focusable" + (k.length > 1 ? " wide" : "");
        keyBtn.textContent = k;
        makeFocusable(keyBtn, function () {
          if (k === "SPACE") searchVal += " ";
          else if (k === "BACKSPACE") searchVal = searchVal.slice(0, -1);
          else if (k === "CLEAR") searchVal = "";
          else searchVal += k;

          var display = el("search-text");
          if (display) {
            display.textContent = searchVal.length > 0 ? searchVal : "Type movie or show title…";
          }
          triggerSearch(searchVal);
        });
        rowEl.appendChild(keyBtn);
      });
      kb.appendChild(rowEl);
    });
    wrap.appendChild(kb);

    var resultsGrid = document.createElement("div");
    resultsGrid.className = "media-grid";
    resultsGrid.id = "search-results";
    wrap.appendChild(resultsGrid);

    container.appendChild(wrap);

    var searchDebounce = null;
    function triggerSearch(q) {
      clearTimeout(searchDebounce);
      if (!q || q.trim().length === 0) {
        resultsGrid.innerHTML = "";
        return;
      }
      searchDebounce = setTimeout(function () {
        resultsGrid.innerHTML = "<p style='color:#888;padding:20px;'>Searching MovieBox for \"" + q + "\"…</p>";
        MovieBoxCatalog.search(q).then(function (results) {
          resultsGrid.innerHTML = "";
          if (!results || results.length === 0) {
            resultsGrid.innerHTML = "<p style='color:#888;padding:20px;'>No results found for \"" + q + "\"</p>";
            return;
          }
          results.forEach(function (m) {
            var card = document.createElement("div");
            card.className = "media-card focusable";
            card.innerHTML =
              '<img src="' + (m.poster || "") + '" alt="' + (m.name || "") + '" loading="lazy" />' +
              (m.imdbRating ? '<div class="media-card-badge">⭐ ' + m.imdbRating + '</div>' : '') +
              '<div class="media-card-info">' +
                '<div class="media-card-title">' + (m.name || "Untitled") + '</div>' +
                '<div class="media-card-sub">' + (m.year || "") + '</div>' +
              '</div>';

            makeFocusable(card, function () {
              openDetailModal(m.id, m.type || "movie");
            });
            resultsGrid.appendChild(card);
          });
        });
      }, 350);
    }

    var firstKey = kb.querySelector(".focusable");
    if (firstKey) setFocus(firstKey);
  }

  // --- 4. My List / Watchlist View ---
  function renderMyListView(container) {
    var wrap = document.createElement("div");
    wrap.style.padding = "40px 60px";
    wrap.innerHTML = "<h1 style='font-size:38px;font-weight:800;margin-bottom:20px;'>⭐ My Watchlist</h1>";

    var list = MovieBoxCatalog.getWatchlist();
    if (!list || list.length === 0) {
      wrap.innerHTML += "<p style='color:#888;font-size:22px;margin-top:40px;'>Your watchlist is empty. Press '+ Watchlist' on any movie or series to save it here.</p>";
      container.appendChild(wrap);
      return;
    }

    var grid = document.createElement("div");
    grid.className = "media-grid";
    grid.style.padding = "20px 0";

    list.forEach(function (m) {
      var card = document.createElement("div");
      card.className = "media-card focusable";
      card.innerHTML =
        '<img src="' + (m.poster || "") + '" alt="' + (m.name || "") + '" loading="lazy" />' +
        (m.imdbRating ? '<div class="media-card-badge">⭐ ' + m.imdbRating + '</div>' : '') +
        '<div class="media-card-info">' +
          '<div class="media-card-title">' + (m.name || "Untitled") + '</div>' +
          '<div class="media-card-sub">' + (m.year || "") + '</div>' +
        '</div>';

      makeFocusable(card, function () {
        openDetailModal(m.id, m.type || "movie");
      });
      grid.appendChild(card);
    });

    wrap.appendChild(grid);
    container.appendChild(wrap);

    var first = grid.querySelector(".focusable");
    if (first) setFocus(first);
  }

  // --- 5. Settings View (Morphe VIP Unlocked) ---
  function renderSettingsView(container) {
    var wrap = document.createElement("div");
    wrap.style.padding = "40px 60px";
    wrap.style.maxWidth = "1100px";

    var st = MovieBoxCatalog.getSettings();

    wrap.innerHTML =
      "<h1 style='font-size:38px;font-weight:800;margin-bottom:10px;'>⚙️ MovieBox Settings</h1>" +
      "<p style='color:#00d26a;font-weight:700;font-size:18px;margin-bottom:40px;'>🛡️ MORPHE EDITION — VIP UNLOCKED · AD-FREE · UNLIMITED 1080P</p>" +

      "<div style='display:flex;flex-direction:column;gap:24px;'>" +
        "<div class='action-btn focusable' id='st-quality' style='justify-content:space-between;'>" +
          "<span>📺 Preferred Video Quality</span><b style='color:#ffb800;'>" + st.preferredQuality + " (FHD)</b>" +
        "</div>" +
        "<div class='action-btn focusable' id='st-subs' style='justify-content:space-between;'>" +
          "<span>💬 Default Subtitle Languages</span><b style='color:#ffb800;'>Arabic &amp; English</b>" +
        "</div>" +
        "<div class='action-btn focusable' id='st-server' style='justify-content:space-between;'>" +
          "<span>⚡ Default Streaming Server</span><b style='color:#ffb800;'>" + st.defaultServer + "</b>" +
        "</div>" +
        "<div class='action-btn focusable' id='st-clear' style='justify-content:space-between;background:rgba(229,9,20,0.2);color:#ff4d4d;'>" +
          "<span>🗑️ Clear Watch History</span><b>Reset</b>" +
        "</div>" +
      "</div>";

    container.appendChild(wrap);

    makeFocusable(wrap.querySelector("#st-quality"), function () {
      showModal("Preferred Quality", [
        { label: "1080p Full HD (Recommended)", action: function () { st.preferredQuality = "1080p"; MovieBoxCatalog.saveSettings(st); switchTab(5); } },
        { label: "4K Ultra HD", action: function () { st.preferredQuality = "4K"; MovieBoxCatalog.saveSettings(st); switchTab(5); } },
        { label: "720p HD", action: function () { st.preferredQuality = "720p"; MovieBoxCatalog.saveSettings(st); switchTab(5); } },
        { label: "Auto (Adaptive)", action: function () { st.preferredQuality = "Auto"; MovieBoxCatalog.saveSettings(st); switchTab(5); } }
      ]);
    });

    makeFocusable(wrap.querySelector("#st-server"), function () {
      showModal("Default Streaming Server", [
        { label: "⚡ VIP Server 1 (FastStream 1080p)", action: function () { st.defaultServer = "VIP Server 1"; MovieBoxCatalog.saveSettings(st); switchTab(5); } },
        { label: "⚡ VIP Server 2 (VidLink Pro 1080p)", action: function () { st.defaultServer = "VIP Server 2"; MovieBoxCatalog.saveSettings(st); switchTab(5); } },
        { label: "⚡ VIP Server 3 (VidSrc Cloud)", action: function () { st.defaultServer = "VIP Server 3"; MovieBoxCatalog.saveSettings(st); switchTab(5); } },
        { label: "⚡ VIP Server 4 (AutoEmbed)", action: function () { st.defaultServer = "VIP Server 4"; MovieBoxCatalog.saveSettings(st); switchTab(5); } }
      ]);
    });

    makeFocusable(wrap.querySelector("#st-clear"), function () {
      localStorage.removeItem("mb_history");
      toast("Watch history cleared.");
    });

    var first = wrap.querySelector(".focusable");
    if (first) setFocus(first);
  }

  // --- Detail & Episode Modal ---
  function openDetailModal(id, type) {
    toast("Loading details…");
    MovieBoxCatalog.getDetail(type, id).then(function (meta) {
      if (!meta) {
        toast("Failed to load details");
        return;
      }
      currentDetailMeta = meta;

      var modal = el("detail-modal");
      el("detail-backdrop-art").style.backgroundImage = "url('" + (meta.background || meta.poster) + "')";
      el("detail-poster").src = meta.poster || "";
      el("detail-title").textContent = meta.name || "";
      el("detail-rating").textContent = "⭐ " + (meta.imdbRating || "N/A");
      el("detail-year").textContent = meta.year || "";
      el("detail-runtime").textContent = meta.runtime || (type === "series" ? "TV Series" : "Movie");
      el("detail-genres").textContent = (meta.genres || []).join(" · ");
      el("detail-overview").textContent = meta.description || "";

      // Actions
      var actBox = el("detail-actions");
      actBox.innerHTML = "";

      var playBtn = document.createElement("div");
      playBtn.className = "action-btn primary focusable";
      playBtn.innerHTML = "▶ Play Now (1080p)";
      makeFocusable(playBtn, function () {
        modal.classList.remove("open");
        MovieBoxPlayer.open(meta, 0);
      });
      actBox.appendChild(playBtn);

      var watchlisted = MovieBoxCatalog.isWatchlisted(meta.id);
      var wlBtn = document.createElement("div");
      wlBtn.className = "action-btn focusable";
      wlBtn.innerHTML = watchlisted ? "✓ In Watchlist" : "+ Watchlist";
      makeFocusable(wlBtn, function () {
        var added = MovieBoxCatalog.toggleWatchlist(meta);
        wlBtn.innerHTML = added ? "✓ In Watchlist" : "+ Watchlist";
        toast(added ? "Added to Watchlist" : "Removed from Watchlist");
      });
      actBox.appendChild(wlBtn);

      var closeBtn = document.createElement("div");
      closeBtn.className = "action-btn focusable";
      closeBtn.innerHTML = "✕ Close";
      makeFocusable(closeBtn, function () {
        modal.classList.remove("open");
      });
      actBox.appendChild(closeBtn);

      // TV Series Episodes
      var seriesBox = el("detail-series-box");
      if (type === "series" && meta.videos && meta.videos.length > 0) {
        seriesBox.style.display = "block";
        renderSeriesEpisodes(meta);
      } else {
        seriesBox.style.display = "none";
      }

      modal.classList.add("open");
      setFocus(playBtn);
    });
  }

  function renderSeriesEpisodes(meta) {
    var seasons = {};
    (meta.videos || []).forEach(function (v) {
      var s = v.season || 1;
      if (!seasons[s]) seasons[s] = [];
      seasons[s].push(v);
    });

    var seasonNums = Object.keys(seasons).map(Number).sort(function (a, b) { return a - b; });
    var sTabs = el("season-tabs");
    var epList = el("episodes-list");
    sTabs.innerHTML = "";
    epList.innerHTML = "";

    var activeSeason = seasonNums[0] || 1;

    seasonNums.forEach(function (s) {
      var chip = document.createElement("div");
      chip.className = "season-chip focusable" + (s === activeSeason ? " active" : "");
      chip.textContent = "Season " + s;
      makeFocusable(chip, function () {
        document.querySelectorAll("#season-tabs .season-chip").forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        renderEpisodesForSeason(meta, seasons[s], s);
      });
      sTabs.appendChild(chip);
    });

    function renderEpisodesForSeason(mMeta, episodes, sNum) {
      epList.innerHTML = "";
      episodes.forEach(function (ep) {
        var card = document.createElement("div");
        card.className = "episode-card focusable";
        card.innerHTML =
          '<div class="ep-num">EPISODE ' + ep.episode + '</div>' +
          '<div class="ep-title">' + (ep.name || ep.title || ("Episode " + ep.episode)) + '</div>';

        makeFocusable(card, function () {
          el("detail-modal").classList.remove("open");
          var clone = Object.assign({}, mMeta, {
            season: sNum,
            episode: ep.episode,
            name: mMeta.name + " S" + sNum + "E" + ep.episode
          });
          MovieBoxPlayer.open(clone, 0);
        });
        epList.appendChild(card);
      });
    }

    renderEpisodesForSeason(meta, seasons[activeSeason] || [], activeSeason);
  }

  // --- Remote Key Bindings ---
  function bindRemoteKeys() {
    window.addEventListener("keydown", function (e) {
      var code = e.keyCode || e.which;

      // Handle Color Buttons on Samsung TV Remote
      if (code === 403 || e.key === "ColorF0Red") {
        e.preventDefault();
        switchTab(3); // Search
        return;
      }
      if (code === 406 || e.key === "ColorF3Blue") {
        e.preventDefault();
        switchTab(4); // My List
        return;
      }

      // Handle Player Keys
      if (el("player-layer").classList.contains("open")) {
        if (code === 10009 || code === 27 || e.key === "Escape") {
          e.preventDefault();
          MovieBoxPlayer.close();
          return;
        }
        if (code === 415 || code === 19 || e.key === "MediaPlay" || e.key === "MediaPause" || e.key === "MediaPlayPause") {
          e.preventDefault();
          MovieBoxPlayer.togglePlay();
          return;
        }
        if (code === 37 || e.key === "ArrowLeft") {
          MovieBoxPlayer.seek(-10);
          return;
        }
        if (code === 39 || e.key === "ArrowRight") {
          MovieBoxPlayer.seek(10);
          return;
        }
        if (code === 38 || code === 40) {
          MovieBoxPlayer.showOsd();
          return;
        }
        return;
      }

      // Handle Modal Back Key
      if (el("detail-modal").classList.contains("open") || el("list-modal").classList.contains("open")) {
        if (code === 10009 || code === 27 || e.key === "Escape") {
          e.preventDefault();
          el("detail-modal").classList.remove("open");
          el("list-modal").classList.remove("open");
          return;
        }
      }

      // Handle Browser Back Key
      if (el("browser-layer").classList.contains("open")) {
        if (code === 10009 || code === 27 || e.key === "Escape") {
          e.preventDefault();
          el("browser-layer").classList.remove("open");
          el("browser-iframe").src = "about:blank";
          return;
        }
      }
    });

    // In-App Browser Back Button
    el("browser-back-btn").addEventListener("click", function () {
      el("browser-layer").classList.remove("open");
      el("browser-iframe").src = "about:blank";
    });
  }

  return {
    init: init,
    toast: toast,
    showModal: showModal,
    openDetailModal: openDetailModal
  };
})();

// Bootstrap on DOM ready
document.addEventListener("DOMContentLoaded", function () {
  MovieBoxApp.init();
});
