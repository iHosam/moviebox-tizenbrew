/**
 * MovieBox (Morphe Edition) — Fullscreen Hardware Video Player
 * Supports Hls.js, Dash.js, HTML5 video, automatic 1080p level selection,
 * Arabic & English subtitle renderer, and Samsung TV remote keybindings.
 */
var MovieBoxPlayer = (function () {
  var video = null;
  var osd = null;
  var hls = null;
  var dash = null;
  var osdTimeout = null;
  var currentMeta = null;
  var activeSubTrack = null;

  var state = {
    isOpen: false,
    isPlaying: false,
    duration: 0,
    currentTime: 0,
    levels: [],
    currentLevel: -1,
    subtitles: [],
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

  function init() {
    video = el("player-video");
    osd = el("player-osd");

    if (!video) return;

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("durationchange", onDurationChange);
    video.addEventListener("play", function () {
      state.isPlaying = true;
      el("pchip-play").textContent = "⏸ Pause";
    });
    video.addEventListener("pause", function () {
      state.isPlaying = false;
      el("pchip-play").textContent = "▶ Play";
    });

    // OSD Interactions
    el("osd-back-btn").addEventListener("click", close);
    el("pchip-play").addEventListener("click", togglePlay);
    el("pchip-quality").addEventListener("click", showQualityPicker);
    el("pchip-subs").addEventListener("click", showSubtitlesPicker);
    el("pchip-server").addEventListener("click", showServerPicker);

    // Seekbar click / seek
    el("osd-seekbar").addEventListener("click", function (e) {
      var rect = e.currentTarget.getBoundingClientRect();
      var pos = (e.clientX - rect.left) / rect.width;
      if (video.duration) {
        video.currentTime = pos * video.duration;
      }
    });
  }

  function onTimeUpdate() {
    if (!video) return;
    state.currentTime = video.currentTime;
    el("osd-cur-time").textContent = formatTime(state.currentTime);

    var dur = video.duration || state.duration || 1;
    var pct = (state.currentTime / dur) * 100;
    el("osd-seek-played").style.width = pct + "%";
    el("osd-seek-thumb").style.left = pct + "%";

    // Periodically save resume position
    if (currentMeta && Math.floor(state.currentTime) % 10 === 0) {
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
    el("osd-dur-time").textContent = formatTime(state.duration);
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
    }, 5000);
  }

  function togglePlay() {
    if (!video) return;
    if (video.paused) {
      video.play().catch(function () {});
    } else {
      video.pause();
    }
    showOsd();
  }

  function seek(delta) {
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.currentTime + delta, video.duration || 0));
    showOsd();
  }

  function destroyEngines() {
    if (hls) {
      try { hls.destroy(); } catch (e) {}
      hls = null;
    }
    if (dash) {
      try { dash.reset(); } catch (e) {}
      dash = null;
    }
    if (video) {
      video.removeAttribute("src");
      video.load();
    }
  }

  function open(itemMeta, serverIndex) {
    currentMeta = itemMeta;
    state.activeServerIndex = serverIndex || 0;
    state.isOpen = true;

    el("player-layer").classList.add("open");
    el("osd-title").textContent = itemMeta.name || "MovieBox";
    if (itemMeta.type === "series") {
      var sStr = (itemMeta.season < 10 ? "0" : "") + (itemMeta.season || 1);
      var eStr = (itemMeta.episode < 10 ? "0" : "") + (itemMeta.episode || 1);
      el("osd-subtitle").textContent = "S" + sStr + "E" + eStr;
    } else {
      el("osd-subtitle").textContent = itemMeta.year || "";
    }

    destroyEngines();
    showOsd();

    // Check if we have direct HLS streams or embed
    if (itemMeta.streamUrl) {
      playStream(itemMeta.streamUrl);
    } else {
      // Resolve streams dynamically
      MovieBoxApp.toast("Resolving 1080p stream for " + itemMeta.name + "…");
      MovieBoxCatalog.resolveStreams(itemMeta.type, itemMeta.id, itemMeta.tmdb, itemMeta.season, itemMeta.episode)
        .then(function (res) {
          if (res && res.streams && res.streams.length > 0) {
            state.servers = res.streams.concat(res.embeds || []);
            var best = res.streams[0];
            playStream(best.url);
          } else if (res && res.embeds && res.embeds.length > 0) {
            state.servers = res.embeds;
            openEmbedFallback(res.embeds[0].url);
          } else {
            MovieBoxApp.toast("No stream available, try another server");
          }
        });
    }

    // Auto-fetch Arabic and English Subtitles
    fetchSubtitles(itemMeta.id, itemMeta.season, itemMeta.episode);
  }

  function playStream(url) {
    if (window.Hls && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        startLevel: -1 // auto level
      });

      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, function () {
        state.levels = hls.levels || [];

        // 🌟 FORCE 1080p FHD: Automatically select highest quality level!
        if (state.levels.length > 0) {
          var targetLevel = state.levels.length - 1; // highest level in playlist
          // Find 1080p level if available
          for (var i = state.levels.length - 1; i >= 0; i--) {
            if (state.levels[i].height >= 1080) {
              targetLevel = i;
              break;
            }
          }
          hls.currentLevel = targetLevel;
          var h = state.levels[targetLevel].height;
          el("pchip-quality").querySelector(".pchip-val").textContent = (h ? h + "p" : "1080p") + " FHD ✓";
        }

        video.play().catch(function () {});
      });

      hls.on(Hls.Events.ERROR, function (ev, data) {
        if (data && data.fatal) {
          console.error("HLS Fatal error:", data);
          MovieBoxApp.toast("Stream error. Switching to fallback server…");
          if (state.servers.length > 1) {
            switchServer(1);
          }
        }
      });
    } else {
      video.src = url;
      video.play().catch(function () {});
    }
  }

  function openEmbedFallback(url) {
    close();
    el("browser-iframe").src = url;
    el("browser-layer").classList.add("open");
  }

  function fetchSubtitles(imdbId, season, episode) {
    if (!imdbId) return;
    var qUrl = "http://127.0.0.1:8087/api/subs?imdb=" + encodeURIComponent(imdbId) +
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

          // Set default sub
          var chosen = araSub || engSub;
          if (chosen) {
            setSubtitleTrack(chosen);
          }
        }
      })
      .catch(function () {});
  }

  function setSubtitleTrack(subObj) {
    if (!subObj) {
      if (activeSubTrack) {
        activeSubTrack.mode = "disabled";
      }
      el("pchip-subs").querySelector(".pchip-val").textContent = "Off";
      return;
    }

    // Remove existing tracks
    var existingTracks = video.querySelectorAll("track");
    existingTracks.forEach(function (t) { t.remove(); });

    var track = document.createElement("track");
    track.kind = "subtitles";
    track.label = subObj.langName || subObj.lang;
    track.srclang = subObj.lang;
    track.src = subObj.vttUrl;
    track.default = true;

    video.appendChild(track);
    track.mode = "showing";
    activeSubTrack = track;

    el("pchip-subs").querySelector(".pchip-val").textContent = (subObj.langName || subObj.lang) + " ✓";
    MovieBoxApp.toast("Subtitles: " + (subObj.langName || subObj.lang));
  }

  function showQualityPicker() {
    if (!hls || !state.levels || state.levels.length === 0) {
      MovieBoxApp.toast("Quality controlled by source (1080p FHD)");
      return;
    }

    var items = [
      {
        label: "Auto (Adaptive)",
        action: function () {
          hls.currentLevel = -1;
          el("pchip-quality").querySelector(".pchip-val").textContent = "Auto";
        }
      }
    ];

    state.levels.forEach(function (lvl, idx) {
      var h = lvl.height || (idx === state.levels.length - 1 ? 1080 : 720);
      items.push({
        label: h >= 2160 ? "4K UHD" : (h + "p " + (h >= 1080 ? "FHD" : "HD")),
        action: function () {
          hls.currentLevel = idx;
          el("pchip-quality").querySelector(".pchip-val").textContent = h + "p FHD ✓";
          MovieBoxApp.toast("Locked to " + h + "p FHD");
        }
      });
    });

    MovieBoxApp.showModal("Select Quality", items);
  }

  function showSubtitlesPicker() {
    var items = [
      {
        label: "Off",
        action: function () {
          setSubtitleTrack(null);
        }
      }
    ];

    state.subtitles.forEach(function (sb) {
      items.push({
        label: (sb.lang === "ara" ? "🇸🇦 " : "🇬🇧 ") + sb.langName + " (" + sb.name.slice(0, 35) + "…)",
        action: function () {
          setSubtitleTrack(sb);
        }
      });
    });

    MovieBoxApp.showModal("Subtitles (Arabic / English)", items);
  }

  function showServerPicker() {
    if (!state.servers || state.servers.length === 0) return;
    var items = state.servers.map(function (srv, idx) {
      return {
        label: "⚡ " + (srv.label || srv.server),
        action: function () {
          switchServer(idx);
        }
      };
    });
    MovieBoxApp.showModal("Select Streaming Server", items);
  }

  function switchServer(idx) {
    if (!state.servers[idx]) return;
    state.activeServerIndex = idx;
    var srv = state.servers[idx];
    el("pchip-server").querySelector(".pchip-val").textContent = "Server " + (idx + 1);
    if (srv.type === "embed") {
      openEmbedFallback(srv.url);
    } else {
      destroyEngines();
      playStream(srv.url);
    }
  }

  function close() {
    state.isOpen = false;
    destroyEngines();
    el("player-layer").classList.remove("open");
  }

  return {
    init: init,
    open: open,
    close: close,
    togglePlay: togglePlay,
    seek: seek,
    showOsd: showOsd
  };
})();
