/**
 * MovieBox (Morphe Edition) — Main TV Application Controller
 * Provides complete 2D spatial D-pad navigation, Samsung remote keybindings,
 * immediate seed-backed catalog views, and modal management.
 */

// Surface runtime errors on TV screen (since TV has no devtools)
window.addEventListener("error", function (ev) {
  try {
    var box = document.getElementById("toast");
    if (box) {
      box.textContent = "Error: " + (ev && ev.message ? ev.message : "unknown") +
        (ev && ev.filename ? " (" + String(ev.filename).split("/").pop() + ":" + ev.lineno + ")" : "");
      box.classList.add("show");
    }
  } catch (e) {}
});

var MovieBoxApp = (function () {
  var TABS = ["Home", "Movies", "Series", "Search", "My List", "Settings"];

  var state = {
    currentTab: 0,
    focusedEl: null,
    lastPageFocusEl: null,
    modalOpen: false,
    modalFocusEl: null,
    preModalFocusEl: null
  };

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

  // --- Samsung Tizen TV Input Key Registration ---
  function initTizenKeys() {
    if (window.tizen && window.tizen.tvinputdevice) {
      var keys = [
        "ColorF0Red", "ColorF1Green", "ColorF2Yellow", "ColorF3Blue",
        "MediaPlayPause", "MediaPlay", "MediaPause", "MediaStop",
        "MediaFastForward", "MediaRewind", "MediaTrackNext", "MediaTrackPrevious",
        "1", "2", "3", "4", "5", "6", "7", "8", "9", "0",
        "Info"
      ];
      keys.forEach(function (k) {
        try { window.tizen.tvinputdevice.registerKey(k); } catch (e) {}
      });
    }
  }

  // --- Focus & Visibility Helpers ---
  function isConnectedNode(node) {
    if (!node) return false;
    if (typeof node.isConnected === "boolean") return node.isConnected;
    var root = el("app-root") || document.body;
    return root ? root.contains(node) : true;
  }

  function isVisible(node) {
    if (!node || !isConnectedNode(node)) return false;
    if (node.style && node.style.display === "none") return false;
    return true;
  }

  function makeFocusable(node, onClick, onLongPress) {
    if (!node) return null;
    node.classList.add("focusable");
    node.tabIndex = 0;
    if (onClick) {
      node._onClick = onClick;
      node.addEventListener("click", function (e) {
        e.stopPropagation();
        onClick(node);
      });
    }
    if (onLongPress) {
      node._onLongPress = onLongPress;
      node.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        e.stopPropagation();
        onLongPress(node);
      });
    }
    node.addEventListener("mouseenter", function () {
      setFocus(node, false);
    });
    return node;
  }

  function setFocus(node, scrollIntoView) {
    if (!node || !isVisible(node)) return false;

    if (state.modalOpen) {
      if (state.modalFocusEl && state.modalFocusEl !== node) {
        state.modalFocusEl.classList.remove("focused");
      }
      state.modalFocusEl = node;
      node.classList.add("focused");
      try { node.focus({ preventScroll: true }); } catch (e) { try { node.focus(); } catch (e2) {} }
      if (scrollIntoView !== false) {
        try { node.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (e) {}
      }
      return true;
    }

    if (state.focusedEl && state.focusedEl !== node) {
      state.focusedEl.classList.remove("focused");
    }
    state.focusedEl = node;
    node.classList.add("focused");
    try { node.focus({ preventScroll: true }); } catch (e) { try { node.focus(); } catch (e2) {} }

    // Remember column index inside horizontal row (.h-row) for natural Up/Down traversal
    var hRow = node.closest ? node.closest(".h-row") : null;
    if (hRow) {
      var hItems = Array.prototype.slice.call(hRow.querySelectorAll(".focusable")).filter(isVisible);
      var hIdx = hItems.indexOf(node);
      if (hIdx !== -1) hRow._lastCol = hIdx;
    }

    var page = el("main-scroll");
    if (page && page.contains(node)) {
      state.lastPageFocusEl = node;
    }

    if (scrollIntoView !== false) {
      scrollNodeIntoComfortableView(node);
    }
    return true;
  }

  function scrollNodeIntoComfortableView(node) {
    try {
      // Horizontal row scroll
      var hRow = node.closest ? node.closest(".h-row") : null;
      if (hRow) {
        var nr = node.getBoundingClientRect();
        var rr = hRow.getBoundingClientRect();
        if (rr.width > 0 && nr.width > 0) {
          if (nr.left < rr.left + 50) {
            hRow.scrollLeft -= (rr.left + 50 - nr.left);
          } else if (nr.right > rr.right - 50) {
            hRow.scrollLeft += (nr.right - (rr.right - 50));
          }
        }
      }

      // Vertical page scroll
      var page = el("main-scroll");
      if (page && page.contains(node)) {
        var rect = node.getBoundingClientRect();
        var pRect = page.getBoundingClientRect();
        if (pRect.height > 0 && rect.height > 0) {
          if (rect.top < pRect.top + 100) {
            page.scrollTop -= (pRect.top + 100 - rect.top);
          } else if (rect.bottom > pRect.bottom - 100) {
            page.scrollTop += (rect.bottom - (pRect.bottom - 100));
          }
        }
      }
    } catch (e) {}
  }

  // --- 2D Navigation Hierarchy ---
  function chunkArray(arr, size) {
    var out = [];
    for (var i = 0; i < arr.length; i += size) {
      out.push(arr.slice(i, i + size));
    }
    return out;
  }

  function collectRowsFromContainer(container, rows) {
    if (!container || !container.children) return;
    var children = container.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (!child || (child.style && child.style.display === "none")) continue;
      var cls = child.className || "";

      if (cls.indexOf("v-list") !== -1) {
        var vItems = Array.prototype.slice.call(child.querySelectorAll(".focusable")).filter(isVisible);
        for (var vi = 0; vi < vItems.length; vi++) {
          rows.push([vItems[vi]]);
        }
      } else if (cls.indexOf("h-row") !== -1 ||
          cls.indexOf("hero-btns") !== -1 ||
          cls.indexOf("action-row") !== -1 ||
          cls.indexOf("kb-row") !== -1) {
        var rowItems = Array.prototype.slice.call(child.querySelectorAll(".focusable")).filter(isVisible);
        if (rowItems.length > 0) {
          rowItems._container = child;
          rowItems._isHRow = cls.indexOf("h-row") !== -1;
          rows.push(rowItems);
        }
      } else if (cls.indexOf("media-grid") !== -1) {
        var gridItems = Array.prototype.slice.call(child.querySelectorAll(".focusable")).filter(isVisible);
        var chunks7 = chunkArray(gridItems, 7);
        for (var c7 = 0; c7 < chunks7.length; c7++) rows.push(chunks7[c7]);
      } else if (child.classList && child.classList.contains("focusable")) {
        if (isVisible(child)) rows.push([child]);
      } else if (child.children && child.children.length > 0) {
        collectRowsFromContainer(child, rows);
      }
    }
  }

  function getNavigationRows() {
    var rows = [];

    // 1. If Generic Modal is open
    var listModal = el("list-modal");
    if (listModal && listModal.classList.contains("open")) {
      collectRowsFromContainer(listModal, rows);
      return rows;
    }

    // 2. If Detail Modal is open
    var dModal = el("detail-modal");
    if (dModal && dModal.classList.contains("open")) {
      var dActions = el("detail-actions");
      if (dActions) collectRowsFromContainer(dActions, rows);
      var sTabs = el("season-tabs");
      if (sTabs && sTabs.style.display !== "none") collectRowsFromContainer(sTabs, rows);
      var epList = el("episodes-list");
      if (epList && epList.style.display !== "none") collectRowsFromContainer(epList, rows);
      return rows;
    }

    // 3. Top Navigation Bar is Row 0
    var topBar = el("top-bar");
    if (topBar) {
      var topItems = Array.prototype.slice.call(topBar.querySelectorAll(".focusable")).filter(isVisible);
      if (topItems.length > 0) {
        topItems._isTopBar = true;
        rows.push(topItems);
      }
    }

    // 4. Main Page Content
    var page = el("page-content");
    if (page) {
      collectRowsFromContainer(page, rows);
    }

    return rows;
  }

  function moveFocusSpatial(dir) {
    var rows = getNavigationRows();
    if (rows.length === 0) return false;

    var current = state.modalOpen ? state.modalFocusEl : state.focusedEl;
    var rIdx = -1;
    var cIdx = -1;

    if (current && isVisible(current)) {
      for (var r = 0; r < rows.length; r++) {
        var idx = rows[r].indexOf(current);
        if (idx !== -1) {
          rIdx = r;
          cIdx = idx;
          break;
        }
      }
    }

    // If no element currently focused, focus first content button or top bar
    if (rIdx === -1) {
      var startRow = (!state.modalOpen && rows.length > 1) ? rows[1] : rows[0];
      return setFocus(startRow[0], true);
    }

    var curRow = rows[rIdx];

    if (dir === "left") {
      if (cIdx > 0) {
        return setFocus(curRow[cIdx - 1], true);
      }
      return true;
    }

    if (dir === "right") {
      if (cIdx < curRow.length - 1) {
        return setFocus(curRow[cIdx + 1], true);
      }
      return true;
    }

    if (dir === "up") {
      if (rIdx > 0) {
        var upRow = rows[rIdx - 1];
        var targetUpEl = null;
        if (upRow._isTopBar) {
          var activeTabEl = document.querySelector(".nav-tab.active") || upRow[1] || upRow[0];
          targetUpEl = activeTabEl;
        } else if (upRow._isHRow && upRow._container && typeof upRow._container._lastCol === "number") {
          targetUpEl = upRow[Math.min(upRow._container._lastCol, upRow.length - 1)];
        } else {
          targetUpEl = upRow[Math.min(cIdx, upRow.length - 1)];
        }
        return setFocus(targetUpEl, true);
      }
      return true;
    }

    if (dir === "down") {
      if (rIdx < rows.length - 1) {
        var downRow = rows[rIdx + 1];
        var targetDownEl = null;
        if (curRow._isTopBar && state.lastPageFocusEl && isVisible(state.lastPageFocusEl)) {
          targetDownEl = state.lastPageFocusEl;
        } else if (downRow._isHRow && downRow._container && typeof downRow._container._lastCol === "number") {
          targetDownEl = downRow[Math.min(downRow._container._lastCol, downRow.length - 1)];
        } else {
          targetDownEl = downRow[Math.min(cIdx, downRow.length - 1)];
        }
        return setFocus(targetDownEl, true);
      }
      return true;
    }

    return false;
  }

  // --- Modal Helpers ---
  function showModal(title, items) {
    state.preModalFocusEl = state.focusedEl;
    state.modalOpen = true;

    var modal = el("list-modal");
    el("list-modal-title").textContent = title;
    var list = el("list-modal-items");
    list.innerHTML = "";

    items.forEach(function (it) {
      var btn = document.createElement("div");
      btn.className = "modal-item focusable";
      btn.textContent = it.label;
      makeFocusable(btn, function () {
        closeModal();
        if (it.action) it.action();
      });
      list.appendChild(btn);
    });

    var closeBtn = el("list-modal-close");
    makeFocusable(closeBtn, function () {
      closeModal();
    });

    modal.classList.add("open");
    var first = list.querySelector(".focusable");
    if (first) setFocus(first, true);
  }

  function closeModal() {
    var listModal = el("list-modal");
    if (listModal) listModal.classList.remove("open");
    var dModal = el("detail-modal");
    if (dModal) dModal.classList.remove("open");

    state.modalOpen = false;
    state.modalFocusEl = null;

    if (MovieBoxPlayer.isOpen()) {
      MovieBoxPlayer.setChipRowFocus(true);
    } else if (state.preModalFocusEl && isVisible(state.preModalFocusEl)) {
      setFocus(state.preModalFocusEl, false);
    }
  }

  // --- Global Remote Keydown Handler ---
  function initGlobalKeyListeners() {
    function handleKeyDown(e) {
      if (e.__mbHandled) return;
      e.__mbHandled = true;

      var k = e.keyCode || e.which || 0;
      var key = e.key || "";

      var isLeft = (k === 37 || key === "ArrowLeft" || key === "Left");
      var isUp = (k === 38 || key === "ArrowUp" || key === "Up");
      var isRight = (k === 39 || key === "ArrowRight" || key === "Right");
      var isDown = (k === 40 || key === "ArrowDown" || key === "Down");
      var isEnter = (k === 13 || key === "Enter");
      var isBack = (k === 10009 || k === 27 || k === 8 || key === "Escape" || key === "Backspace");

      // 1. If Modal is open (Quality / Subs / Server / Audio pickers, Detail modal), handle modal navigation FIRST!
      if (state.modalOpen) {
        if (isBack) {
          e.preventDefault();
          closeModal();
          return;
        }
        if (isLeft) { e.preventDefault(); moveFocusSpatial("left"); return; }
        if (isRight) { e.preventDefault(); moveFocusSpatial("right"); return; }
        if (isUp) { e.preventDefault(); moveFocusSpatial("up"); return; }
        if (isDown) { e.preventDefault(); moveFocusSpatial("down"); return; }
        if (isEnter) {
          e.preventDefault();
          var mTarget = state.modalFocusEl || state.focusedEl;
          if (mTarget && mTarget._onClick) {
            mTarget._onClick(mTarget);
          } else if (mTarget) {
            mTarget.click();
          }
          return;
        }
        return;
      }

      // 2. If Video Player is open, delegate directly to MovieBoxPlayer
      if (MovieBoxPlayer.isOpen() || (el("player-layer") && el("player-layer").classList.contains("open"))) {
        if (MovieBoxPlayer.handleKeyDown(e)) {
          return;
        }
      }
      }

      // 3. Samsung TV Color Shortcut Buttons
      if (k === 403 || key === "ColorF0Red") { // Red: Search
        e.preventDefault();
        switchTab(3);
        return;
      }
      if (k === 406 || key === "ColorF3Blue") { // Blue: Watchlist
        e.preventDefault();
        switchTab(4);
        return;
      }

      // 4. Back / Return Key
      if (isBack) {
        e.preventDefault();
        if (state.currentTab !== 0) {
          switchTab(0);
          return;
        }
        // If on content inside Home, return focus to Top Bar
        var topBar = el("top-bar");
        if (topBar && state.focusedEl && !topBar.contains(state.focusedEl)) {
          var activeTabEl = document.querySelector(".nav-tab.active");
          if (activeTabEl) setFocus(activeTabEl, true);
          return;
        }
        try {
          if (window.tizen && window.tizen.application) {
            window.tizen.application.getCurrentApplication().exit();
          }
        } catch (err) {}
        return;
      }

      // 5. Directional D-Pad Navigation (PREVENT DEFAULT ALWAYS TO STOP NATIVE BROWSER SCROLLING)
      if (isLeft) { e.preventDefault(); moveFocusSpatial("left"); return; }
      if (isRight) { e.preventDefault(); moveFocusSpatial("right"); return; }
      if (isUp) { e.preventDefault(); moveFocusSpatial("up"); return; }
      if (isDown) { e.preventDefault(); moveFocusSpatial("down"); return; }

      // 6. OK / Enter Button
      if (isEnter) {
        e.preventDefault();
        var target = state.focusedEl;
        if (target && target._onClick) {
          target._onClick(target);
        } else if (target) {
          target.click();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
  }

  // --- Views Rendering ---
  function init() {
    initTizenKeys();
    initGlobalKeyListeners();
    renderTopTabs();
    MovieBoxPlayer.init();
    switchTab(0);
  }

  function renderTopTabs() {
    var nav = el("nav-tabs");
    nav.innerHTML = "";
    TABS.forEach(function (name, idx) {
      var tab = document.createElement("div");
      tab.className = "nav-tab focusable" + (idx === state.currentTab ? " active" : "");
      tab.textContent = name;
      tab.dataset.tabIdx = String(idx);
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
    state.currentTab = idx;
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

  // --- 1. Home View ---
  function renderHomeView(container) {
    // 1. Build initial layout INSTANTLY using seed data (0ms bootup)
    var seedMovies = MovieBoxCatalog.getSeedMovies();
    var seedSeries = MovieBoxCatalog.getSeedSeries();
    buildHomeContent(container, seedMovies, seedSeries, seedMovies, seedMovies, seedSeries);

    // 2. Fetch live updates in the background (non-blocking)
    Promise.all([
      MovieBoxCatalog.getTrendingMovies(),
      MovieBoxCatalog.getTrendingSeries(),
      MovieBoxCatalog.getByGenre("movie", "Action"),
      MovieBoxCatalog.getByGenre("movie", "Sci-Fi"),
      MovieBoxCatalog.getByGenre("series", "Animation")
    ]).then(function (results) {
      var liveMovies = results[0] || seedMovies;
      var liveSeries = results[1] || seedSeries;
      var liveAction = results[2] || seedMovies;
      var liveScifi = results[3] || seedMovies;
      var liveAnime = results[4] || seedSeries;

      // Update rows seamlessly without breaking currently focused element
      updateHomeMediaRows(container, liveMovies, liveSeries, liveAction, liveScifi, liveAnime);
    }).catch(function (e) {
      console.warn("Live fetch failed, staying on seed catalog", e);
    });
  }

  function buildHomeContent(container, movies, series, action, scifi, anime) {
    container.innerHTML = "";

    // Hero Spotlight
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
          '<span class="meta-pill gold">⭐ ' + (heroMeta.imdbRating || "8.5") + '</span>' +
          '<span class="meta-pill">' + (heroMeta.year || "2024") + '</span>' +
          '<span class="meta-pill green">1080p FHD</span>' +
          '<span class="meta-pill vip">VIP UNLOCKED</span>' +
        '</div>' +
        '<p class="hero-desc">' + (heroMeta.description || "Stream blockbusters in full HD ad-free on your TV.") + '</p>' +
        '<div class="hero-btns">' +
          '<div id="hero-play-btn" class="action-btn primary focusable">▶ Watch Now (1080p)</div>' +
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
    createMediaRow(container, "🔥 Trending Movies", movies, "row-movies");
    createMediaRow(container, "📺 Binge-Worthy TV Series", series, "row-series");
    createMediaRow(container, "💥 High-Octane Action", action, "row-action");
    createMediaRow(container, "🚀 Sci-Fi &amp; Future Worlds", scifi, "row-scifi");
    createMediaRow(container, "🎌 Anime &amp; Animation", anime, "row-anime");

    // Immediately focus the Hero Play button!
    var firstBtn = container.querySelector("#hero-play-btn");
    if (firstBtn) {
      setFocus(firstBtn, false);
    } else {
      var topTab = document.querySelector(".nav-tab.active");
      if (topTab) setFocus(topTab, false);
    }
  }

  function updateHomeMediaRows(container, movies, series, action, scifi, anime) {
    function refreshRow(rowId, items) {
      var sec = container.querySelector("#" + rowId);
      if (!sec) return;
      var hRow = sec.querySelector(".h-row");
      if (!hRow) return;
      // If user currently has focus inside this row, don't destroy it
      if (state.focusedEl && hRow.contains(state.focusedEl)) return;

      hRow.innerHTML = "";
      items.forEach(function (m) {
        var card = createCardElement(m);
        hRow.appendChild(card);
      });
    }

    refreshRow("row-movies", movies);
    refreshRow("row-series", series);
    refreshRow("row-action", action);
    refreshRow("row-scifi", scifi);
    refreshRow("row-anime", anime);
  }

  function createCardElement(m) {
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
    return card;
  }

  function createMediaRow(container, title, items, rowId) {
    if (!items || items.length === 0) return;
    var sec = document.createElement("section");
    sec.className = "media-section";
    if (rowId) sec.id = rowId;

    var h2 = document.createElement("h2");
    h2.className = "section-title";
    h2.innerHTML = title;
    sec.appendChild(h2);

    var row = document.createElement("div");
    row.className = "h-row";

    items.forEach(function (m) {
      var card = createCardElement(m);
      row.appendChild(card);
    });

    sec.appendChild(row);
    container.appendChild(sec);
  }

  // --- 2. Catalog View ---
  function renderCatalogView(container, type) {
    var isSeries = type === "series";
    var heading = document.createElement("div");
    heading.style.padding = "40px 60px 10px 60px";
    heading.innerHTML = "<h1 style='font-size:38px;font-weight:800;'>" + (isSeries ? "📺 TV Series Catalog" : "🍿 Movies Catalog") + "</h1>";
    container.appendChild(heading);

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
      // Load seed items immediately first
      var seedItems = (isSeries ? MovieBoxCatalog.getSeedSeries() : MovieBoxCatalog.getSeedMovies());
      renderGridItems(seedItems);

      var fetchPromise = genre
        ? MovieBoxCatalog.getByGenre(type, genre)
        : (isSeries ? MovieBoxCatalog.getTrendingSeries() : MovieBoxCatalog.getTrendingMovies());

      fetchPromise.then(function (items) {
        if (items && items.length > 0) {
          renderGridItems(items);
        }
      });
    }

    function renderGridItems(items) {
      grid.innerHTML = "";
      (items || []).forEach(function (m) {
        var card = createCardElement(m);
        grid.appendChild(card);
      });

      var first = grid.querySelector(".focusable");
      if (first && (!state.focusedEl || !container.contains(state.focusedEl))) {
        setFocus(first, true);
      }
    }

    loadGrid(null);
    setFocus(allPill, false);
  }

  // --- 3. Search View ---
  function renderSearchView(container) {
    var wrap = document.createElement("div");
    wrap.className = "search-container";

    var searchVal = "";

    var inputDisplay = document.createElement("div");
    inputDisplay.className = "search-input-box";
    inputDisplay.innerHTML = "<span>🔍</span><span id='search-text' style='color:#ffb800;'>Type movie or show title…</span>";
    wrap.appendChild(inputDisplay);

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
            var card = createCardElement(m);
            resultsGrid.appendChild(card);
          });
        });
      }, 350);
    }

    var firstKey = kb.querySelector(".focusable");
    if (firstKey) setFocus(firstKey, true);
  }

  // --- 4. My List View ---
  function renderMyListView(container) {
    var wrap = document.createElement("div");
    wrap.style.padding = "40px 60px";
    wrap.innerHTML = "<h1 style='font-size:38px;font-weight:800;margin-bottom:20px;'>⭐ My Watchlist</h1>";

    var list = MovieBoxCatalog.getWatchlist();
    if (!list || list.length === 0) {
      wrap.innerHTML += "<p style='color:#888;font-size:22px;margin-top:40px;'>Your watchlist is empty. Press '+ Watchlist' on any movie or series to save it here.</p>";
      container.appendChild(wrap);
      var topTab = document.querySelector(".nav-tab.active");
      if (topTab) setFocus(topTab, false);
      return;
    }

    var grid = document.createElement("div");
    grid.className = "media-grid";
    grid.style.padding = "20px 0";

    list.forEach(function (m) {
      var card = createCardElement(m);
      grid.appendChild(card);
    });

    wrap.appendChild(grid);
    container.appendChild(wrap);

    var first = grid.querySelector(".focusable");
    if (first) setFocus(first, true);
  }

  // --- 5. Settings View ---
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
    if (first) setFocus(first, true);
  }

  // --- Detail Modal ---
  function openDetailModal(id, type) {
    state.preModalFocusEl = state.focusedEl;
    state.modalOpen = true;

    toast("Loading details…");
    MovieBoxCatalog.getDetail(type, id).then(function (meta) {
      if (!meta) {
        toast("Failed to load details");
        state.modalOpen = false;
        return;
      }

      var modal = el("detail-modal");
      el("detail-backdrop-art").style.backgroundImage = "url('" + (meta.background || meta.poster) + "')";
      el("detail-poster").src = meta.poster || "";
      el("detail-title").textContent = meta.name || "";
      el("detail-rating").textContent = "⭐ " + (meta.imdbRating || "N/A");
      el("detail-year").textContent = meta.year || "";
      el("detail-runtime").textContent = meta.runtime || (type === "series" ? "TV Series" : "Movie");
      el("detail-genres").textContent = (meta.genres || []).join(" · ");
      el("detail-overview").textContent = meta.description || "";

      var actBox = el("detail-actions");
      actBox.innerHTML = "";

      var playBtn = document.createElement("div");
      playBtn.className = "action-btn primary focusable";
      playBtn.innerHTML = "▶ Play Now (1080p)";
      makeFocusable(playBtn, function () {
        closeModal();
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
        closeModal();
      });
      actBox.appendChild(closeBtn);

      var seriesBox = el("detail-series-box");
      if (type === "series" && meta.videos && meta.videos.length > 0) {
        seriesBox.style.display = "block";
        renderSeriesEpisodes(meta);
      } else {
        seriesBox.style.display = "none";
      }

      modal.classList.add("open");
      setFocus(playBtn, true);
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
          closeModal();
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

  return {
    init: init,
    toast: toast,
    showModal: showModal,
    openDetailModal: openDetailModal
  };
})();

document.addEventListener("DOMContentLoaded", function () {
  MovieBoxApp.init();
});
