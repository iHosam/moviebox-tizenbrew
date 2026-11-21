/**
 * MovieBox (Morphe Edition) — Catalog & Data Layer
 * Connects to Cinemeta v3 & TMDB for high-speed metadata, trending lists, and multi-server stream resolving.
 */
var MovieBoxCatalog = (function () {
  var CINEMETA = "https://v3-cinemeta.strem.io";
  var SERVICE_PORTS = [8088, 8087, 8089];
  var cachedServiceUrl = null;

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

  // Dynamic service prober: detects whether port 8088, 8087, or 8089 is active
  function getActiveServiceUrl() {
    if (cachedServiceUrl) {
      return Promise.resolve(cachedServiceUrl);
    }

    return new Promise(function (resolve) {
      var remaining = SERVICE_PORTS.length;
      var found = false;

      function check(port) {
        var base = "http://127.0.0.1:" + port;
        var done = false;
        var tid = setTimeout(function () {
          if (!done) {
            done = true;
            step();
          }
        }, 350);

        fetch(base + "/api/health")
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (done) return;
            done = true;
            clearTimeout(tid);
            if (!found && d && (d.ok || d.name)) {
              found = true;
              cachedServiceUrl = base;
              resolve(base);
            } else {
              step();
            }
          })
          .catch(function () {
            if (done) return;
            // Also try /api/ping (fmhyplay service compatibility)
            fetch(base + "/api/ping")
              .then(function (r2) { return r2.json(); })
              .then(function (d2) {
                if (done) return;
                done = true;
                clearTimeout(tid);
                if (!found && d2 && d2.ok) {
                  found = true;
                  cachedServiceUrl = base;
                  resolve(base);
                } else {
                  step();
                }
              })
              .catch(function () {
                if (done) return;
                done = true;
                clearTimeout(tid);
                step();
              });
          });
      }

      function step() {
        remaining--;
        if (remaining <= 0 && !found) {
          cachedServiceUrl = "http://127.0.0.1:8088";
          resolve(cachedServiceUrl);
        }
      }

      for (var i = 0; i < SERVICE_PORTS.length; i++) {
        check(SERVICE_PORTS[i]);
      }
    });
  }

  // Instant seed data for instant 0ms TV bootup with embedded TMDB IDs
  var SEED_MOVIES = [
    {
      id: "tt15239678",
      tmdb: "693134",
      name: "Dune: Part Two",
      type: "movie",
      year: "2024",
      imdbRating: "8.5",
      genres: ["Action", "Adventure", "Sci-Fi"],
      poster: "https://images.metahub.space/poster/medium/tt15239678/img",
      background: "https://images.metahub.space/background/medium/tt15239678/img",
      description: "Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family."
    },
    {
      id: "tt15398776",
      tmdb: "872585",
      name: "Oppenheimer",
      type: "movie",
      year: "2023",
      imdbRating: "8.9",
      genres: ["Biography", "Drama", "History"],
      poster: "https://images.metahub.space/poster/medium/tt15398776/img",
      background: "https://images.metahub.space/background/medium/tt15398776/img",
      description: "The story of American scientist J. Robert Oppenheimer and his role in the development of the atomic bomb."
    },
    {
      id: "tt9362722",
      tmdb: "569094",
      name: "Spider-Man: Across the Spider-Verse",
      type: "movie",
      year: "2023",
      imdbRating: "8.6",
      genres: ["Animation", "Action", "Adventure"],
      poster: "https://images.metahub.space/poster/medium/tt9362722/img",
      background: "https://images.metahub.space/background/medium/tt9362722/img",
      description: "Miles Morales catapults across the Multiverse, where he encounters a team of Spider-People charged with protecting its very existence."
    },
    {
      id: "tt1745960",
      tmdb: "361743",
      name: "Top Gun: Maverick",
      type: "movie",
      year: "2022",
      imdbRating: "8.3",
      genres: ["Action", "Drama"],
      poster: "https://images.metahub.space/poster/medium/tt1745960/img",
      background: "https://images.metahub.space/background/medium/tt1745960/img",
      description: "After thirty years, Maverick is still pushing the envelope as a top naval aviator, training a detachment of graduates for a specialized mission."
    },
    {
      id: "tt1877830",
      tmdb: "414906",
      name: "The Batman",
      type: "movie",
      year: "2022",
      imdbRating: "7.8",
      genres: ["Action", "Crime", "Drama"],
      poster: "https://images.metahub.space/poster/medium/tt1877830/img",
      background: "https://images.metahub.space/background/medium/tt1877830/img",
      description: "When a sadistic serial killer begins murdering key political figures in Gotham, Batman is forced to investigate the city's hidden corruption."
    },
    {
      id: "tt0816692",
      tmdb: "157336",
      name: "Interstellar",
      type: "movie",
      year: "2014",
      imdbRating: "8.7",
      genres: ["Adventure", "Drama", "Sci-Fi"],
      poster: "https://images.metahub.space/poster/medium/tt0816692/img",
      background: "https://images.metahub.space/background/medium/tt0816692/img",
      description: "When Earth becomes uninhabitable in the future, a farmer and ex-NASA pilot, Joseph Cooper, is tasked to pilot a spacecraft to find a new planet for humans."
    },
    {
      id: "tt1375666",
      tmdb: "27205",
      name: "Inception",
      type: "movie",
      year: "2010",
      imdbRating: "8.8",
      genres: ["Action", "Adventure", "Sci-Fi"],
      poster: "https://images.metahub.space/poster/medium/tt1375666/img",
      background: "https://images.metahub.space/background/medium/tt1375666/img",
      description: "A thief who steals corporate secrets through the use of dream-sharing technology is given the inverse task of planting an idea into the mind of a C.E.O."
    }
  ];

  var SEED_SERIES = [
    {
      id: "tt2788316",
      tmdb: "126308",
      name: "Shōgun",
      type: "series",
      year: "2024",
      imdbRating: "8.7",
      genres: ["Adventure", "Drama", "History"],
      poster: "https://images.metahub.space/poster/medium/tt2788316/img",
      background: "https://images.metahub.space/background/medium/tt2788316/img",
      description: "When a mysterious European ship is found marooned in a nearby fishing village, Lord Yoshii Toranaga discovers secrets that could tip the scales of power."
    },
    {
      id: "tt12637874",
      tmdb: "106379",
      name: "Fallout",
      type: "series",
      year: "2024",
      imdbRating: "8.4",
      genres: ["Action", "Adventure", "Drama"],
      poster: "https://images.metahub.space/poster/medium/tt12637874/img",
      background: "https://images.metahub.space/background/medium/tt12637874/img",
      description: "In a future, post-apocalyptic Los Angeles, citizens must live in underground bunkers to protect themselves from radiation, mutants and bandits."
    },
    {
      id: "tt3581920",
      tmdb: "502119",
      name: "The Last of Us",
      type: "series",
      year: "2023",
      imdbRating: "8.7",
      genres: ["Action", "Adventure", "Drama"],
      poster: "https://images.metahub.space/poster/medium/tt3581920/img",
      background: "https://images.metahub.space/background/medium/tt3581920/img",
      description: "After a global pandemic destroys civilization, a hardened survivor takes charge of a 14-year-old girl who may be humanity's last hope."
    },
    {
      id: "tt11126994",
      tmdb: "94605",
      name: "Arcane",
      type: "series",
      year: "2021",
      imdbRating: "9.0",
      genres: ["Animation", "Action", "Adventure"],
      poster: "https://images.metahub.space/poster/medium/tt11126994/img",
      background: "https://images.metahub.space/background/medium/tt11126994/img",
      description: "Set in Utopian Piltover and the oppressed underground of Zaun, the story follows the origins of two iconic League champions."
    },
    {
      id: "tt0903747",
      tmdb: "1396",
      name: "Breaking Bad",
      type: "series",
      year: "2008",
      imdbRating: "9.5",
      genres: ["Crime", "Drama", "Thriller"],
      poster: "https://images.metahub.space/poster/medium/tt0903747/img",
      background: "https://images.metahub.space/background/medium/tt0903747/img",
      description: "A chemistry teacher diagnosed with lung cancer turns to manufacturing and selling methamphetamine to secure his family's financial future."
    },
    {
      id: "tt4574334",
      tmdb: "66732",
      name: "Stranger Things",
      type: "series",
      year: "2016",
      imdbRating: "8.7",
      genres: ["Drama", "Fantasy", "Horror"],
      poster: "https://images.metahub.space/poster/medium/tt4574334/img",
      background: "https://images.metahub.space/background/medium/tt4574334/img",
      description: "When a young boy vanishes, a small town uncovers a mystery involving secret experiments and terrifying supernatural forces."
    }
  ];

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

  // Backup resolver using service CORS-free /api/fetch if /api/resolve fails
  function serviceFetchResolve(srvUrl, isSeries, imdbId, tmdbId, season, episode) {
    var resolvedId = tmdbId || imdbId;
    if (!resolvedId) return Promise.resolve({ ok: false, streams: [] });

    var apiPath = isSeries
      ? ("https://vixsrc.to/api/tv/" + encodeURIComponent(resolvedId) + "/" + season + "/" + episode)
      : ("https://vixsrc.to/api/movie/" + encodeURIComponent(resolvedId));
    var pageRef = isSeries
      ? ("https://vixsrc.to/tv/" + resolvedId + "/" + season + "/" + episode)
      : ("https://vixsrc.to/movie/" + resolvedId);

    var fetchUrl1 = srvUrl + "/api/fetch?url=" + encodeURIComponent(apiPath) + "&ref=" + encodeURIComponent(pageRef);

    return fetch(fetchUrl1)
      .then(function (r) { return r.json(); })
      .then(function (j1) {
        if (!j1 || !j1.src) return { ok: false, streams: [] };
        var embedUrl = j1.src.indexOf("http") === 0 ? j1.src : ("https://vixsrc.to" + j1.src);
        var fetchUrl2 = srvUrl + "/api/fetch?url=" + encodeURIComponent(embedUrl) + "&ref=" + encodeURIComponent(pageRef);

        return fetch(fetchUrl2).then(function (r2) { return r2.text(); }).then(function (html) {
          var tok = html.match(/['"]token['"]\s*:\s*['"]([^'"]+)['"]/);
          var exp = html.match(/['"]expires['"]\s*:\s*['"]([^'"]+)['"]/);
          var mUrl = html.match(/url\s*:\s*['"](https?:\/\/[^'"]+\/playlist\/[^'"]+)['"]/);
          if (!tok || !exp || !mUrl) return { ok: false, streams: [] };

          var rawM3u8 = mUrl[1] + "?token=" + encodeURIComponent(tok[1]) + "&expires=" + encodeURIComponent(exp[1]) + "&h=1&lang=en";
          var proxyM3u8 = srvUrl + "/proxy/stream?url=" + encodeURIComponent(rawM3u8) +
                          "&ref=" + encodeURIComponent("https://vixsrc.to/") +
                          "&origin=" + encodeURIComponent("https://vixsrc.to");

          var streamItem = {
            server: "VIP Server 1",
            label: "MovieBox Direct FHD 1080p (Native)",
            quality: "1080p",
            url: proxyM3u8,
            rawUrl: rawM3u8,
            referer: "https://vixsrc.to/",
            origin: "https://vixsrc.to",
            headers: { Referer: "https://vixsrc.to/", Origin: "https://vixsrc.to" }
          };

          return {
            ok: true,
            streams: [streamItem],
            url: proxyM3u8
          };
        });
      })
      .catch(function () {
        return { ok: false, streams: [] };
      });
  }

  return {
    GENRES: GENRES,
    getSeedMovies: function () { return SEED_MOVIES; },
    getSeedSeries: function () { return SEED_SERIES; },
    getActiveServiceUrl: getActiveServiceUrl,

    // 1. Trending / Featured Feeds
    getTrendingMovies: function () {
      return getJson(CINEMETA + "/catalog/movie/top.json").then(function (data) {
        var metas = (data && data.metas && data.metas.length > 0) ? data.metas : SEED_MOVIES;
        return metas;
      }).catch(function () {
        return SEED_MOVIES;
      });
    },

    getTrendingSeries: function () {
      return getJson(CINEMETA + "/catalog/series/top.json").then(function (data) {
        var metas = (data && data.metas && data.metas.length > 0) ? data.metas : SEED_SERIES;
        return metas;
      }).catch(function () {
        return SEED_SERIES;
      });
    },

    getByGenre: function (type, genre) {
      var t = (type === "series" || type === "tv") ? "series" : "movie";
      var url = CINEMETA + "/catalog/" + t + "/top/genre=" + encodeURIComponent(genre) + ".json";
      return getJson(url).then(function (data) {
        var metas = (data && data.metas && data.metas.length > 0) ? data.metas : (t === "series" ? SEED_SERIES : SEED_MOVIES);
        return metas;
      }).catch(function () {
        return t === "series" ? SEED_SERIES : SEED_MOVIES;
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
        var all = mList.concat(sList);
        if (all.length === 0) {
          // Local filter on seed data fallback
          var lq = query.toLowerCase().trim();
          var seedMatches = SEED_MOVIES.concat(SEED_SERIES).filter(function (it) {
            return (it.name && it.name.toLowerCase().indexOf(lq) !== -1);
          });
          return seedMatches;
        }
        return all;
      });
    },

    // 3. Detail Metadata (with Seasons & Episodes for TV)
    getDetail: function (type, id) {
      var t = (type === "series" || type === "tv") ? "series" : "movie";
      return getJson(CINEMETA + "/meta/" + t + "/" + encodeURIComponent(id) + ".json").then(function (data) {
        if (data && data.meta) return data.meta;
        // Search in seed data
        var seeds = (t === "series") ? SEED_SERIES : SEED_MOVIES;
        for (var i = 0; i < seeds.length; i++) {
          if (seeds[i].id === id) return seeds[i];
        }
        return null;
      });
    },

    // 4. Stream Resolution (Direct Native HD 1080p — Multi-Port Dynamic Resolution)
    resolveStreams: function (type, imdbId, tmdbId, season, episode) {
      var isSeries = (type === "series" || type === "tv");
      var s = season || 1;
      var e = episode || 1;

      // Match known TMDB from seed items if not passed
      var finalTmdb = tmdbId;
      if (!finalTmdb && imdbId) {
        var allSeeds = SEED_MOVIES.concat(SEED_SERIES);
        for (var i = 0; i < allSeeds.length; i++) {
          if (allSeeds[i].id === imdbId && allSeeds[i].tmdb) {
            finalTmdb = allSeeds[i].tmdb;
            break;
          }
        }
      }

      return getActiveServiceUrl().then(function (srvUrl) {
        var qUrl = srvUrl + "/api/resolve?type=" + (isSeries ? "series" : "movie") +
                   "&imdb=" + encodeURIComponent(imdbId || "") +
                   "&tmdb=" + encodeURIComponent(finalTmdb || "") +
                   "&s=" + s + "&e=" + e;

        return getJson(qUrl).then(function (res) {
          if (res && res.ok && res.streams && res.streams.length > 0) {
            // Ensure all proxy URLs point to the active service port
            res.streams = res.streams.map(function (st) {
              if (st.url && st.url.indexOf('/proxy/stream') !== -1) {
                st.url = st.url.replace(/http:\/\/127\.0\.0\.1:\d+/, srvUrl);
              } else if (st.url && st.url.indexOf('http') === 0 && st.url.indexOf(srvUrl) !== 0) {
                // If service returned raw URL (fmhyplay service), wrap in active proxy!
                st.url = srvUrl + "/proxy/stream?url=" + encodeURIComponent(st.url) +
                         "&ref=" + encodeURIComponent(st.referer || "https://vixsrc.to/") +
                         "&origin=" + encodeURIComponent(st.origin || "https://vixsrc.to");
              }
              return st;
            });
            return res;
          }

          // Fallback to service fetch resolver
          return serviceFetchResolve(srvUrl, isSeries, imdbId, finalTmdb, s, e);
        }).catch(function () {
          return serviceFetchResolve(srvUrl, isSeries, imdbId, finalTmdb, s, e);
        });
      });
    },

    // 5. Watchlist & History
    getHistory: function () {
      return loadStorage(STORAGE_KEY_HISTORY, []);
    },

    saveHistory: function (item) {
      var hist = loadStorage(STORAGE_KEY_HISTORY, []);
      hist = hist.filter(function (h) { return h.id !== item.id; });
      hist.unshift({
        id: item.id,
        type: item.type || "movie",
        name: item.name || "Untitled",
        poster: item.poster || "",
        season: item.season || 1,
        episode: item.episode || 1,
        time: item.time || 0,
        duration: item.duration || 0,
        timestamp: Date.now()
      });
      saveStorage(STORAGE_KEY_HISTORY, hist.slice(0, 40));
    },

    getWatchlist: function () {
      return loadStorage(STORAGE_KEY_WATCHLIST, []);
    },

    isWatchlisted: function (id) {
      var wl = loadStorage(STORAGE_KEY_WATCHLIST, []);
      return wl.some(function (w) { return w.id === id; });
    },

    toggleWatchlist: function (item) {
      var wl = loadStorage(STORAGE_KEY_WATCHLIST, []);
      var idx = -1;
      for (var i = 0; i < wl.length; i++) {
        if (wl[i].id === item.id) { idx = i; break; }
      }
      if (idx !== -1) {
        wl.splice(idx, 1);
        saveStorage(STORAGE_KEY_WATCHLIST, wl);
        return false;
      } else {
        wl.unshift({
          id: item.id,
          type: item.type || "movie",
          name: item.name,
          poster: item.poster,
          year: item.year,
          imdbRating: item.imdbRating
        });
        saveStorage(STORAGE_KEY_WATCHLIST, wl.slice(0, 60));
        return true;
      }
    },

    // 6. Settings
    getSettings: function () {
      return loadStorage(STORAGE_KEY_SETTINGS, {
        preferredQuality: "1080p",
        subtitlesEnabled: true,
        defaultSubLanguage: "ara",
        defaultServer: "VIP Server 1"
      });
    },

    saveSettings: function (st) {
      saveStorage(STORAGE_KEY_SETTINGS, st);
    }
  };
})();

if (typeof window !== "undefined") {
  window.MovieBoxCatalog = MovieBoxCatalog;
}
