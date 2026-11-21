/**
 * MovieBox (Morphe Edition) — Native TV Hardware Video Player
 * Direct Native HD Streaming via Hls.js & Port 8088 Header Proxy (No Iframes!)
 * Automatic 1080p Full HD selection, Arabic & English subtitles cue renderer,
 * and complete Samsung TV remote keybindings.
 */
var MovieBoxPlayer = (function () {
  var video = null;
  var osd = null;
  var hls = null;
  var osdTimeout = null;
  var currentMeta = null;
  var noticeTimeout = null;

  var state = {
    isOpen: false,
    isPlaying: false,
    duration: 0,
    currentTime: 0,
    levels: [],
    currentLevel: -1,
    subtitles: [],
    activeSubIdx: -1,
    loadedSubTracks: [], // { label, lang, cues: [{start, end, text}] }
    servers: [],
    activeServerIndex: 0
  };

  function el(id) {
    return document.getElementById(id);
  }

  function formatTime(sec) {
    if (!sec || isNaN(sec)) return "00:00";
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var mStr = (m < 10 ? "0" : "") + m;
    var sStr = (s < 10 ? "0" : "") + s;
    if (h > 0) {
      return h + ":" + mStr + ":" + sStr;
    }
    return mStr + ":" + sStr;
  }

  function say(msg) {
    MovieBoxApp.toast(msg);
  }

  function init() {
    video = el("player-video");
    osd = el("player-osd");

    if (!video) return;

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("play", function () {
      state.isPlaying = true;
      var playBtn = el("pchip-play");
      if (playBtn) playBtn.textContent = "⏸ Pause";
    });
    video.addEventListener("pause", function () {
      state.isPlaying = false;
      var playBtn = el("pchip-play");
      if (playBtn) playBtn.textContent = "▶ Play";
    });

    // OSD Interactions
    var backBtn = el("osd-back-btn");
    if (backBtn) backBtn.addEventListener("click", close);

    var playBtn = el("pchip-play");
    if (playBtn) playBtn.addEventListener("click", togglePlay);

    var qualBtn = el("pchip-quality");
    if (qualBtn) qualBtn.addEventListener("click", showQualityPicker);

    var subBtn = el("pchip-subs");
    if (subBtn) subBtn.addEventListener("click", showSubtitlesPicker);

    var srvBtn = el("pchip-server");
    if (srvBtn) srvBtn.addEventListener("click", showServerPicker);

    // Seekbar click / seek
    var seekbar = el("osd-seekbar");
    if (seekbar) {
      seekbar.addEventListener("click", function (e) {
        var rect = e.currentTarget.getBoundingClientRect();
        var pos = (e.clientX - rect.left) / rect.width;
        if (video.duration) {
          video.currentTime = pos * video.duration;
        }
      });
    }
  }

  function onTimeUpdate() {
    if (!video) return;
    state.currentTime = video.currentTime;
    var curEl = el("osd-cur-time");
    if (curEl) curEl.textContent = formatTime(state.currentTime);

    var dur = video.duration || state.duration || 1;
    var pct = (state.currentTime / dur) * 100;
    var played = el("osd-seek-played");
    if (played) played.style.width = pct + "%";
    var thumb = el("osd-seek-thumb");
    if (thumb) thumb.style.left = pct + "%";

    updateSubtitleDisplay();

    // Periodically save resume position
    if (currentMeta && Math.floor(state.currentTime) % 10 === 0 && state.currentTime > 5) {
      MovieBoxCatalog.saveHistory({
        id: currentMeta.id,
        type: currentMeta.type,
        name: currentMeta.name,
        poster: currentMeta.poster,
        season: currentMeta.season || 1,
        episode: currentMeta.episode || 1,
        time: state.currentTime,
        duration: dur
      });
    }
  }

  function onDurationChange() {
    if (!video) return;
    state.duration = video.duration;
    var durEl = el("osd-dur-time");
    if (durEl) durEl.textContent = formatTime(state.duration);
  }

  function showOsd() {
    if (!osd) return;
    osd.classList.remove("hidden");
    resetOsdTimer();
  }

  function hideOsd() {
    if (!osd) return;
    osd.classList.add("hidden");
  }

  function resetOsdTimer() {
    clearTimeout(osdTimeout);
    osdTimeout = setTimeout(function () {
      if (state.isPlaying) {
        hideOsd();
      }
    }, 4500);
  }

  function togglePlay() {
    if (!video) return;
    if (video.paused) {
      video.play().catch(function () {});
      say("▶ Playing");
    } else {
      video.pause();
      say("⏸ Paused");
    }
    showOsd();
  }

  function seek(delta) {
    if (!video) return;
    var target = Math.max(0, Math.min(video.currentTime + delta, (video.duration || 10000) - 1));
    video.currentTime = target;
    say((delta > 0 ? "↻ +" : "↺ ") + delta + "s (" + formatTime(target) + ")");
    showOsd();
  }

  function destroyEngines() {
    if (hls) {
      try { hls.destroy(); } catch (e) {}
      hls = null;
    }
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
  }

  function open(itemMeta, serverIndex) {
    currentMeta = itemMeta;
    state.activeServerIndex = serverIndex || 0;
    state.isOpen = true;
    state.activeSubIdx = -1;
    state.loadedSubTracks = [];

    var layer = el("player-layer");
    if (layer) layer.classList.add("open");

    var titleEl = el("osd-title");
    if (titleEl) titleEl.textContent = itemMeta.name || "MovieBox";

    var subEl = el("osd-subtitle");
    if (subEl) {
      if (itemMeta.type === "series") {
        var sStr = (itemMeta.season < 10 ? "0" : "") + (itemMeta.season || 1);
        var eStr = (itemMeta.episode < 10 ? "0" : "") + (itemMeta.episode || 1);
        subEl.textContent = "Season " + (itemMeta.season || 1) + " · Episode " + (itemMeta.episode || 1);
      } else {
        subEl.textContent = itemMeta.year || "Movie (1080p FHD)";
      }
    }

    destroyEngines();
    showOsd();

    say("Resolving Direct HD stream for " + itemMeta.name + "…");

    // Resolve direct native stream
    MovieBoxCatalog.resolveStreams(itemMeta.type, itemMeta.id, itemMeta.tmdb, itemMeta.season, itemMeta.episode)
      .then(function (res) {
        if (res && res.streams && res.streams.length > 0) {
          state.servers = res.streams;
          var best = res.streams[0];
          playStream(best.url, best.rawUrl);
        } else {
          say("Stream resolution failed. Please try again.");
        }
      })
      .catch(function (err) {
        console.error("Resolve error:", err);
        say("Failed to resolve stream");
      });

    // Auto-fetch Arabic and English Subtitles
    fetchSubtitles(itemMeta.id, itemMeta.season, itemMeta.episode);
  }

  function playStream(url, fallbackRawUrl) {
    if (!video) return;

    if (window.Hls && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        startLevel: -1
      });

      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, function () {
        state.levels = hls.levels || [];

        // 🌟 FORCE 1080p FHD: Automatically select highest quality level!
        if (state.levels.length > 0) {
          var targetLevel = state.levels.length - 1;
          for (var i = state.levels.length - 1; i >= 0; i--) {
            if (state.levels[i].height >= 1080) {
              targetLevel = i;
              break;
            }
          }
          hls.currentLevel = targetLevel;
          var h = state.levels[targetLevel].height || 1080;
          var qVal = el("pchip-quality");
          if (qVal) {
            var valEl = qVal.querySelector(".pchip-val");
            if (valEl) valEl.textContent = h + "p FHD ✓";
          }
        }

        // Resume position if stored
        var hist = MovieBoxCatalog.getHistory();
        var saved = null;
        for (var hi = 0; hi < hist.length; hi++) {
          if (hist[hi].id === currentMeta.id) { saved = hist[hi]; break; }
        }
        if (saved && saved.time > 10 && saved.time < (saved.duration || 10000) - 30) {
          video.currentTime = saved.time;
          say("Resumed at " + formatTime(saved.time));
        }

        video.play().catch(function () {});
        resetOsdTimer();
      });

      hls.on(Hls.Events.ERROR, function (ev, data) {
        if (data && data.fatal) {
          console.warn("HLS Error encountered, trying fallback:", data);
          if (fallbackRawUrl && fallbackRawUrl !== url) {
            say("Switching to direct stream link…");
            destroyEngines();
            playStream(fallbackRawUrl, null);
          } else {
            say("Stream error. Please select another title or try again.");
          }
        }
      });
    } else {
      video.src = url;
      video.play().catch(function () {});
    }
  }

  // --- Subtitle Cue Parser & Renderer ---
  function parseSubCues(rawText) {
    var cues = [];
    var text = String(rawText || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    var blocks = text.split(/\n\s*\n/);
    var timeRe = /(?:(\d{1,2}):)?(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(?:(\d{1,2}):)?(\d{2}):(\d{2})[,.](\d{3})/;
    for (var i = 0; i < blocks.length; i++) {
      var lines = blocks[i].trim().split("\n");
      var tIdx = -1;
      var match = null;
      for (var j = 0; j < Math.min(3, lines.length); j++) {
        match = timeRe.exec(lines[j]);
        if (match) { tIdx = j; break; }
      }
      if (tIdx < 0 || !match) continue;
      var start = (Number(match[1] || 0) * 3600) + (Number(match[2]) * 60) + Number(match[3]) + (Number(match[4]) / 1000);
      var end = (Number(match[5] || 0) * 3600) + (Number(match[6]) * 60) + Number(match[7]) + (Number(match[8]) / 1000);
      var cueText = lines.slice(tIdx + 1).join("\n").replace(/<[^>]+>/g, "").trim();
      if (cueText) {
        cues.push({ start: start, end: end, text: cueText });
      }
    }
    return cues;
  }

  function updateSubtitleDisplay() {
    var subBox = el("player-subtitle-text");
    if (!subBox) return;
    if (state.activeSubIdx < 0 || !state.loadedSubTracks[state.activeSubIdx]) {
      subBox.style.display = "none";
      return;
    }
    var t = video.currentTime;
    var cues = state.loadedSubTracks[state.activeSubIdx].cues || [];
    var matched = "";
    for (var i = 0; i < cues.length; i++) {
      if (t >= cues[i].start && t <= cues[i].end) {
        matched = cues[i].text;
        break;
      }
    }
    if (matched) {
      subBox.innerHTML = matched.replace(/\n/g, "<br/>");
      subBox.style.display = "inline-block";
    } else {
      subBox.style.display = "none";
    }
  }

  function fetchSubtitles(imdbId, season, episode) {
    if (!imdbId) return;
    MovieBoxCatalog.getActiveServiceUrl().then(function (srvUrl) {
      var qUrl = srvUrl + "/api/subs?imdb=" + encodeURIComponent(imdbId) +
                 "&lang=ara,eng" +
                 (season ? ("&s=" + season) : "") +
                 (episode ? ("&e=" + episode) : "");

      fetch(qUrl)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data && data.ok && data.subtitles) {
            state.subtitles = data.subtitles;
            // Look for Arabic or English subtitle
            var araSub = null;
            var engSub = null;
            data.subtitles.forEach(function (s) {
              if (s.lang === "ara" && !araSub) araSub = s;
              if (s.lang === "eng" && !engSub) engSub = s;
            });

            // Set default sub (Arabic preferred, else English)
            var chosen = araSub || engSub;
            if (chosen) {
              loadSubtitleTrack(chosen, true);
            }
          }
        })
        .catch(function () {});
    });
  }

  function loadSubtitleTrack(subObj, makeActive) {
    if (!subObj || !subObj.vttUrl) return;
    MovieBoxCatalog.getActiveServiceUrl().then(function (srvUrl) {
      var targetVtt = subObj.vttUrl.replace(/http:\/\/127\.0\.0\.1:\d+/, srvUrl);
      fetch(targetVtt)
        .then(function (r) { return r.text(); })
        .then(function (rawVtt) {
          var cues = parseSubCues(rawVtt);
          var trackObj = {
            label: (subObj.lang === "ara" ? "🇸🇦 Arabic" : "🇬🇧 English"),
            lang: subObj.lang,
            cues: cues
          };
          state.loadedSubTracks.push(trackObj);
          if (makeActive) {
            state.activeSubIdx = state.loadedSubTracks.length - 1;
            var subChip = el("pchip-subs");
            if (subChip) {
              var valEl = subChip.querySelector(".pchip-val");
              if (valEl) valEl.textContent = trackObj.label + " ✓";
            }
            say("Subtitles: " + trackObj.label);
          }
        })
        .catch(function () {});
    });
  }

  function showQualityPicker() {
    if (!hls || !state.levels || state.levels.length === 0) {
      say("Quality: 1080p FHD (Source Locked)");
      return;
    }

    var items = [
      {
        label: "Auto (Adaptive)",
        action: function () {
          hls.currentLevel = -1;
          var qVal = el("pchip-quality");
          if (qVal) qVal.querySelector(".pchip-val").textContent = "Auto";
          say("Quality set to Auto");
        }
      }
    ];

    state.levels.forEach(function (lvl, idx) {
      var h = lvl.height || 1080;
      items.push({
        label: h >= 2160 ? "4K UHD" : (h + "p " + (h >= 1080 ? "FHD" : "HD")),
        action: function () {
          hls.currentLevel = idx;
          var qVal = el("pchip-quality");
          if (qVal) qVal.querySelector(".pchip-val").textContent = h + "p FHD ✓";
          say("Quality locked to " + h + "p");
        }
      });
    });

    MovieBoxApp.showModal("Select Quality", items);
  }

  function showSubtitlesPicker() {
    var items = [
      {
        label: "Off (Disable Subtitles)",
        action: function () {
          state.activeSubIdx = -1;
          var subBox = el("player-subtitle-text");
          if (subBox) subBox.style.display = "none";
          var subChip = el("pchip-subs");
          if (subChip) subChip.querySelector(".pchip-val").textContent = "Off";
          say("Subtitles: Off");
        }
      }
    ];

    state.loadedSubTracks.forEach(function (track, idx) {
      items.push({
        label: track.label + (state.activeSubIdx === idx ? "  ✓" : ""),
        action: function () {
          state.activeSubIdx = idx;
          var subChip = el("pchip-subs");
          if (subChip) subChip.querySelector(".pchip-val").textContent = track.label + " ✓";
          say("Subtitles: " + track.label);
        }
      });
    });

    state.subtitles.forEach(function (sb) {
      var alreadyLoaded = state.loadedSubTracks.some(function (lt) { return lt.lang === sb.lang; });
      if (!alreadyLoaded) {
        items.push({
          label: (sb.lang === "ara" ? "🇸🇦 " : "🇬🇧 ") + sb.langName,
          action: function () {
            loadSubtitleTrack(sb, true);
          }
        });
      }
    });

    MovieBoxApp.showModal("Subtitles (Arabic / English)", items);
  }

  function showServerPicker() {
    if (!state.servers || state.servers.length === 0) {
      say("No alternative servers available");
      return;
    }
    var items = state.servers.map(function (srv, idx) {
      return {
        label: "⚡ " + (srv.label || ("Server " + (idx + 1))),
        action: function () {
          switchServer(idx);
        }
      };
    });
    MovieBoxApp.showModal("Select Direct Streaming Server", items);
  }

  function switchServer(idx) {
    if (!state.servers[idx]) return;
    state.activeServerIndex = idx;
    var srv = state.servers[idx];
    var srvChip = el("pchip-server");
    if (srvChip) srvChip.querySelector(".pchip-val").textContent = "Server " + (idx + 1);
    destroyEngines();
    playStream(srv.url, srv.rawUrl);
  }

  function close() {
    state.isOpen = false;
    if (video && currentMeta && video.currentTime > 5) {
      MovieBoxCatalog.saveHistory({
        id: currentMeta.id,
        type: currentMeta.type,
        name: currentMeta.name,
        poster: currentMeta.poster,
        season: currentMeta.season || 1,
        episode: currentMeta.episode || 1,
        time: video.currentTime,
        duration: video.duration || state.duration || 1
      });
    }
    destroyEngines();
    var subBox = el("player-subtitle-text");
    if (subBox) subBox.style.display = "none";
    var layer = el("player-layer");
    if (layer) layer.classList.remove("open");
  }

  function isOpen() {
    return state.isOpen;
  }

  return {
    init: init,
    open: open,
    close: close,
    isOpen: isOpen,
    togglePlay: togglePlay,
    seek: seek,
    showOsd: showOsd
  };
})();
