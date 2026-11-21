/**
 * MovieBox (Morphe Edition) — Catalog & Data Layer
 * Connects to Cinemeta v3 & TMDB for high-speed metadata, trending lists, and multi-server stream resolving.
 */
var MovieBoxCatalog = (function () {
  var CINEMETA = "https://v3-cinemeta.strem.io";
  var SERVICE_URL = "http://127.0.0.1:8087";

  function getJson(url) {
    return fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .catch(function (err) {
        console.error("Fetch error for " + url + ":", err);
        return null;
      });
  }

  // Curated Genre definitions
  var GENRES = [
    "Action", "Adventure", "Animation", "Comedy", "Crime",
    "Documentary", "Drama", "Family", "Fantasy", "Horror",
    "Mystery", "Romance", "Sci-Fi", "Thriller"
  ];

  // Local storage keys
  var STORAGE_KEY_HISTORY = "mb_history";
  var STORAGE_KEY_WATCHLIST = "mb_watchlist";
  var STORAGE_KEY_SETTINGS = "mb_settings";

  function loadStorage(key, def) {
    try {
      var item = localStorage.getItem(key);
      return item ? JSON.parse(item) : def;
    } catch (e) {
      return def;
    }
  }

  function saveStorage(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {}
  }

  return {
    GENRES: GENRES,

    // 1. Trending / Featured Feeds
    getTrendingMovies: function () {
      return getJson(CINEMETA + "/catalog/movie/top.json").then(function (data) {
        return (data && data.metas) || [];
      });
    },

    getTrendingSeries: function () {
      return getJson(CINEMETA + "/catalog/series/top.json").then(function (data) {
        return (data && data.metas) || [];
      });
    },

    getByGenre: function (type, genre) {
      var t = (type === "series" || type === "tv") ? "series" : "movie";
      var url = CINEMETA + "/catalog/" + t + "/top/genre=" + encodeURIComponent(genre) + ".json";
      return getJson(url).then(function (data) {
        return (data && data.metas) || [];
      });
    },

    // 2. Search
    search: function (query) {
      if (!query || query.trim().length === 0) return Promise.resolve([]);
      var q = encodeURIComponent(query.trim());
      var mPromise = getJson(CINEMETA + "/catalog/movie/top/search=" + q + ".json");
      var sPromise = getJson(CINEMETA + "/catalog/series/top/search=" + q + ".json");

      return Promise.all([mPromise, sPromise]).then(function (results) {
        var mList = (results[0] && results[0].metas) || [];
        var sList = (results[1] && results[1].metas) || [];
        return mList.concat(sList);
      });
    },

    // 3. Detail Metadata (with Seasons & Episodes for TV)
    getDetail: function (type, id) {
      var t = (type === "series" || type === "tv") ? "series" : "movie";
      return getJson(CINEMETA + "/meta/" + t + "/" + encodeURIComponent(id) + ".json").then(function (data) {
        return data && data.meta;
      });
    },

    // 4. Stream Resolution (Multi-Server VIP 1080p)
    resolveStreams: function (type, imdbId, tmdbId, season, episode) {
      var s = season || 1;
      var e = episode || 1;
      var qUrl = SERVICE_URL + "/api/resolve?type=" + (type === "series" ? "series" : "movie") +
                 "&imdb=" + encodeURIComponent(imdbId || "") +
                 "&tmdb=" + encodeURIComponent(tmdbId || "") +
                 "&s=" + s + "&e=" + e;

      return getJson(qUrl).then(function (res) {
        if (res && res.ok) return res;

        // Fallback: Construct Direct Multi-Server Embeds
        var id = imdbId || tmdbId;
        var embeds = [
          {
            server: "VIP Server 1 (VidLink Pro)",
            label: "VidLink Pro 1080p",
            url: type === "series"
              ? ("https://vidlink.pro/tv/" + id + "/" + s + "/" + e + "?autoplay=true")
              : ("https://vidlink.pro/movie/" + id + "?autoplay=true"),
            type: "embed"
          },
          {
            server: "VIP Server 2 (VidSrc Cloud)",
            label: "VidSrc Cloud 1080p",
            url: type === "series"
              ? ("https://vidsrc.me/embed/tv?imdb=" + id + "&season=" + s + "&episode=" + e)
              : ("https://vidsrc.me/embed/movie?imdb=" + id),
            type: "embed"
          },
          {
            server: "VIP Server 3 (AutoEmbed VIP)",
            label: "AutoEmbed Multi-Source",
            url: type === "series"
              ? ("https://autoembed.co/tv/imdb/" + id + "-" + s + "-" + e)
              : ("https://autoembed.co/movie/imdb/" + id),
            type: "embed"
          },
          {
            server: "VIP Server 4 (VidFast)",
            label: "VidFast 1080p High-Speed",
            url: type === "series"
              ? ("https://vidfast.vc/tv/" + id + "/" + s + "/" + e + "?autoPlay=true")
              : ("https://vidfast.vc/movie/" + id + "?autoPlay=true"),
            type: "embed"
          }
        ];

        return {
          ok: true,
          streams: [],
          embeds: embeds
        };
      });
    },

    // 5. Watchlist & History
    getHistory: function () {
      return loadStorage(STORAGE_KEY_HISTORY, []);
    },

    saveHistory: function (item) {
      var hist = loadStorage(STORAGE_KEY_HISTORY, []);
      // Filter out existing by ID
      hist = hist.filter(function (h) { return h.id !== item.id; });
      hist.unshift({
        id: item.id,
        type: item.type,
        name: item.name,
        poster: item.poster,
        season: item.season || 1,
        episode: item.episode || 1,
        time: item.time || 0,
        duration: item.duration || 0,
        updatedAt: Date.now()
      });
      if (hist.length > 50) hist = hist.slice(0, 50);
      saveStorage(STORAGE_KEY_HISTORY, hist);
    },

    getWatchlist: function () {
      return loadStorage(STORAGE_KEY_WATCHLIST, []);
    },

    toggleWatchlist: function (meta) {
      var list = loadStorage(STORAGE_KEY_WATCHLIST, []);
      var idx = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === meta.id) {
          idx = i;
          break;
        }
      }
      if (idx !== -1) {
        list.splice(idx, 1);
        saveStorage(STORAGE_KEY_WATCHLIST, list);
        return false;
      } else {
        list.unshift({
          id: meta.id,
          type: meta.type || "movie",
          name: meta.name,
          poster: meta.poster,
          year: meta.year,
          imdbRating: meta.imdbRating
        });
        saveStorage(STORAGE_KEY_WATCHLIST, list);
        return true;
      }
    },

    isWatchlisted: function (id) {
      var list = loadStorage(STORAGE_KEY_WATCHLIST, []);
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) return true;
      }
      return false;
    },

    // 6. Settings
    getSettings: function () {
      return loadStorage(STORAGE_KEY_SETTINGS, {
        preferredQuality: "1080p", // Default to 1080p!
        autoSelectHighest: true,
        subLang: "ara,eng",
        defaultServer: "VIP Server 1"
      });
    },

    saveSettings: function (st) {
      saveStorage(STORAGE_KEY_SETTINGS, st);
    }
  };
})();
