/**
 * MovieBox (Morphe Edition) — Native TV Hardware Video Player
 * Direct Native HD Streaming via Hls.js & Local Service Proxy (No Iframes!)
 * Complete D-pad Spatial Navigation for Player Features:
 *   - 📺 Quality Picker (1080p FHD, 720p HD, 4K, Auto)
 *   - 💬 Arabic & English Subtitles with live cue sync & Off toggle
 *   - ⚡ VIP Streaming Servers
 *   - 🔊 Multi-Audio Track Selector
 *   - ⏯ Play/Pause & ±10s fast seek
 */
var MovieBoxPlayer = (function () {
  var video = null;
  var osd = null;
  var hls = null;
  var osdTimeout = null;
  var currentMeta = null;

  var state = {
    isOpen: false,
    isPlaying: false,
    duration: 0,
    currentTime: 0,
    levels: [],
    subtitles: [],
    activeSubIdx: -1,
    loadedSubTracks: [], // { id, label, lang, cues: [{start, end, text}] }
    servers: [],
    activeServerIndex: 0,
    inChipRow: false,
    focusedChipIdx: 1 // Default to Quality chip (index 1) on initial enter
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

  function getChips() {
    var ids = ["pchip-play", "pchip-quality", "pchip-subs", "pchip-server", "pchip-audio"];
    var list = [];
    for (var i = 0; i < ids.length; i++) {
      var node = el(ids[i]);
      if (node && node.style.display !== "none") {
        list.push(node);
      }
    }
    return list;
  }

  function setChipRowFocus(enable) {
    state.inChipRow = !!enable;
    showOsd();
    var chips = getChips();
    chips.forEach(function (c) { c.classList.remove("focused"); });
    var backBtn = el("osd-back-btn");
    if (backBtn) backBtn.classList.remove("focused");

    if (state.inChipRow && chips.length > 0) {
      state.focusedChipIdx = Math.max(0, Math.min(state.focusedChipIdx, chips.length - 1));
      chips[state.focusedChipIdx].classList.add("focused");
      try { chips[state.focusedChipIdx].focus({ preventScroll: true }); } catch (e) {
        try { chips[state.focusedChipIdx].focus(); } catch (e2) {}
      }
    }
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

    var audioBtn = el("pchip-audio");
    if (audioBtn) audioBtn.addEventListener("click", showAudioPicker);

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
    if (state.inChipRow) {
      // Keep OSD visible while navigating the player feature chips
      return;
    }
    osdTimeout = setTimeout(function () {
      if (state.isPlaying && !state.inChipRow) {
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
    state.inChipRow = false;
    state.focusedChipIdx = 1; // Default focus to Quality chip
    state.activeSubIdx = -1;
    state.loadedSubTracks = [];

    var layer = el("player-layer");
    if (layer) layer.classList.add("open");

    var titleEl = el("osd-title");
    if (titleEl) titleEl.textContent = itemMeta.name || "MovieBox";

    var subEl = el("osd-subtitle");
    if (subEl) {
      if (itemMeta.type === "series") {
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

  function updateAudioDisplay() {
    var aChip = el("pchip-audio");
    if (!aChip) return;
    if (hls && hls.audioTracks && hls.audioTracks.length > 0) {
      var curTrack = hls.audioTracks[hls.audioTrack] || hls.audioTracks[0];
      var name = curTrack.name || curTrack.lang || "Default";
      var valEl = aChip.querySelector(".pchip-val");
      if (valEl) valEl.textContent = name;
      aChip.style.display = "inline-flex";
    } else {
      var valEl = aChip.querySelector(".pchip-val");
      if (valEl) valEl.textContent = "Default";
    }
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
            var lvl = state.levels[i];
            var w = lvl.width || 0;
            var h = lvl.height || 0;
            // Matches 1080p 16:9 (1920x1080) and Cinemascope 2.39:1 (1920x802, 1920x800)
            if (h >= 1000 || w >= 1900 || (w >= 1800 && h >= 750)) {
              targetLevel = i;
              break;
            }
          }
          hls.currentLevel = targetLevel;
          var curLvl = state.levels[targetLevel];
          var curH = curLvl.height || 1080;
          var curW = curLvl.width || 1920;
          var qTag = (curW >= 3800 || curH >= 2100) ? "4K UHD ✓" :
                     (curW >= 1900 || curH >= 1000 || (curW >= 1800 && curH >= 750)) ? "1080p FHD ✓" :
                     (curW >= 1200 || curH >= 700) ? "720p HD ✓" :
                     (curH + "p ✓");
          var qVal = el("pchip-quality");
          if (qVal) {
            var valEl = qVal.querySelector(".pchip-val");
            if (valEl) valEl.textContent = qTag;
          }
        }

        updateAudioDisplay();

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

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, function () {
        updateAudioDisplay();
      });

      hls.on(Hls.Events.ERROR, function (ev, data) {
        if (data && data.fatal) {
          console.warn("HLS Error encountered, trying fallback:", data);
          if (fallbackRawUrl && fallbackRawUrl !== url) {
            say("Switching to direct stream link…");
            destroyEngines();
            playStream(fallbackRawUrl, null);
          } else {
            say("Stream error. Please select another server or try again.");
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
            id: subObj.id,
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
    var items = [
      {
        label: "Auto (Adaptive)" + (hls && hls.currentLevel === -1 ? " ✓" : ""),
        action: function () {
          if (hls) hls.currentLevel = -1;
          var qVal = el("pchip-quality");
          if (qVal) {
            var valEl = qVal.querySelector(".pchip-val");
            if (valEl) valEl.textContent = "Auto ✓";
          }
          say("Quality set to Auto (Adaptive)");
        }
      }
    ];

    if (state.levels && state.levels.length > 0) {
      state.levels.forEach(function (lvl, idx) {
        var h = lvl.height || 720;
        var w = lvl.width || 1280;
        var isCurrent = (hls && hls.currentLevel === idx);
        var qTag = (w >= 3800 || h >= 2100) ? "4K UHD" :
                   (w >= 1900 || h >= 1000 || (w >= 1800 && h >= 750)) ? "1080p FHD" :
                   (w >= 1200 || h >= 700) ? "720p HD" :
                   (h + "p");
        items.push({
          label: qTag + (isCurrent ? " ✓" : ""),
          action: function () {
            if (hls) hls.currentLevel = idx;
            var qVal = el("pchip-quality");
            if (qVal) {
              var valEl = qVal.querySelector(".pchip-val");
              if (valEl) valEl.textContent = qTag + " ✓";
            }
            say("Quality locked to " + qTag);
          }
        });
      });
    } else {
      items.push({
        label: "1080p FHD (Source Locked) ✓",
        action: function () {
          say("Quality locked to 1080p FHD");
        }
      });
    }

    MovieBoxApp.showModal("Select Video Quality", items);
  }

  function showSubtitlesPicker() {
    var items = [
      {
        label: "Off (Disable Subtitles)" + (state.activeSubIdx === -1 ? " ✓" : ""),
        action: function () {
          state.activeSubIdx = -1;
          var subBox = el("player-subtitle-text");
          if (subBox) subBox.style.display = "none";
          var subChip = el("pchip-subs");
          if (subChip) {
            var valEl = subChip.querySelector(".pchip-val");
            if (valEl) valEl.textContent = "Off";
          }
          say("Subtitles: Off");
        }
      }
    ];

    if (!state.subtitles || state.subtitles.length === 0) {
      if (state.loadedSubTracks.length === 0) {
        items.push({
          label: "Searching for subtitles… (Try again in a moment)",
          action: function () {
            if (currentMeta) fetchSubtitles(currentMeta.id, currentMeta.season, currentMeta.episode);
          }
        });
      }
    } else {
      state.subtitles.forEach(function (sb, idx) {
        var isLoadedAndActive = (state.activeSubIdx >= 0 && state.loadedSubTracks[state.activeSubIdx] && state.loadedSubTracks[state.activeSubIdx].id === sb.id);
        var flag = sb.lang === "ara" ? "🇸🇦 " : "🇬🇧 ";
        var langName = sb.lang === "ara" ? "Arabic" : "English";
        var cleanName = (sb.name || ("Subtitle " + (idx + 1))).replace(/\.srt$/i, "").slice(0, 48);
        items.push({
          label: flag + langName + " · " + cleanName + (isLoadedAndActive ? " ✓" : ""),
          action: function () {
            loadSubtitleTrack(sb, true);
          }
        });
      });
    }

    MovieBoxApp.showModal("Subtitles (Arabic / English)", items);
  }

  function showServerPicker() {
    var items = [];
    if (state.servers && state.servers.length > 0) {
      items = state.servers.map(function (srv, idx) {
        var isCurrent = (state.activeServerIndex === idx);
        return {
          label: "⚡ " + (srv.label || ("VIP Server " + (idx + 1))) + (isCurrent ? " ✓" : ""),
          action: function () {
            switchServer(idx);
          }
        };
      });
    } else {
      items.push({
        label: "⚡ VIP Server 1 (FastStream 1080p) ✓",
        action: function () {
          say("Active on VIP Server 1");
        }
      });
    }

    MovieBoxApp.showModal("Select Streaming Server", items);
  }

  function switchServer(idx) {
    if (!state.servers[idx]) return;
    state.activeServerIndex = idx;
    var srv = state.servers[idx];
    var srvChip = el("pchip-server");
    if (srvChip) {
      var valEl = srvChip.querySelector(".pchip-val");
      if (valEl) valEl.textContent = "Server " + (idx + 1);
    }
    destroyEngines();
    playStream(srv.url, srv.rawUrl);
    say("Switched to " + (srv.label || ("Server " + (idx + 1))));
  }

  function showAudioPicker() {
    if (!hls || !hls.audioTracks || hls.audioTracks.length <= 1) {
      say("Audio: Stereo Default");
      return;
    }
    var items = hls.audioTracks.map(function (track, idx) {
      var isCurrent = (hls.audioTrack === idx);
      var label = (track.name || track.lang || ("Audio Track " + (idx + 1))) + (isCurrent ? " ✓" : "");
      return {
        label: "🔊 " + label,
        action: function () {
          hls.audioTrack = idx;
          var aVal = el("pchip-audio");
          if (aVal) {
            var valEl = aVal.querySelector(".pchip-val");
            if (valEl) valEl.textContent = (track.name || track.lang || "Track " + (idx + 1)) + " ✓";
          }
          say("Audio switched to " + (track.name || track.lang));
        }
      };
    });
    MovieBoxApp.showModal("Select Audio Track", items);
  }

  function close() {
    state.isOpen = false;
    state.inChipRow = false;
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

  function handleKeyDown(e) {
    if (!state.isOpen) return false;
    var k = e.keyCode || e.which || 0;
    var key = e.key || "";

    var isLeft = (k === 37 || key === "ArrowLeft" || key === "Left");
    var isUp = (k === 38 || key === "ArrowUp" || key === "Up");
    var isRight = (k === 39 || key === "ArrowRight" || key === "Right");
    var isDown = (k === 40 || key === "ArrowDown" || key === "Down");
    var isEnter = (k === 13 || key === "Enter");
    var isBack = (k === 10009 || k === 27 || k === 8 || key === "Escape" || key === "Backspace");

    // Media Keys
    if (k === 415 || key === "MediaPlay") {
      e.preventDefault();
      if (video && video.paused) video.play().catch(function () {});
      showOsd();
      return true;
    }
    if (k === 19 || key === "MediaPause") {
      e.preventDefault();
      if (video && !video.paused) video.pause();
      showOsd();
      return true;
    }
    if (k === 10252 || key === "MediaPlayPause" || key === " ") {
      e.preventDefault();
      togglePlay();
      return true;
    }
    if (k === 412 || key === "MediaRewind") {
      e.preventDefault();
      seek(-10);
      return true;
    }
    if (k === 417 || key === "MediaFastForward") {
      e.preventDefault();
      seek(10);
      return true;
    }

    // When focus is inside the bottom action chip row
    if (state.inChipRow) {
      var chips = getChips();

      if (isBack) {
        e.preventDefault();
        setChipRowFocus(false);
        return true;
      }

      if (isLeft) {
        e.preventDefault();
        state.focusedChipIdx = Math.max(0, state.focusedChipIdx - 1);
        setChipRowFocus(true);
        return true;
      }

      if (isRight) {
        e.preventDefault();
        state.focusedChipIdx = Math.min(chips.length - 1, state.focusedChipIdx + 1);
        setChipRowFocus(true);
        return true;
      }

      if (isUp) {
        e.preventDefault();
        // Exit chip row back to video playback seek mode
        setChipRowFocus(false);
        return true;
      }

      if (isDown) {
        e.preventDefault();
        showOsd();
        return true;
      }

      if (isEnter) {
        e.preventDefault();
        if (chips[state.focusedChipIdx]) {
          chips[state.focusedChipIdx].click();
        }
        return true;
      }

      return true;
    }

    // Normal video playback mode (inChipRow === false)
    if (isBack) {
      e.preventDefault();
      close();
      return true;
    }

    if (isEnter) {
      e.preventDefault();
      togglePlay();
      return true;
    }

    if (isLeft) {
      e.preventDefault();
      seek(-10);
      return true;
    }

    if (isRight) {
      e.preventDefault();
      seek(10);
      return true;
    }

    if (isDown) {
      e.preventDefault();
      // ArrowDown opens OSD and activates chip row navigation!
      setChipRowFocus(true);
      return true;
    }

    if (isUp) {
      e.preventDefault();
      showOsd();
      return true;
    }

    return false;
  }

  return {
    init: init,
    open: open,
    close: close,
    isOpen: isOpen,
    togglePlay: togglePlay,
    seek: seek,
    showOsd: showOsd,
    setChipRowFocus: setChipRowFocus,
    handleKeyDown: handleKeyDown
  };
})();

if (typeof window !== "undefined") {
  window.MovieBoxPlayer = MovieBoxPlayer;
}
