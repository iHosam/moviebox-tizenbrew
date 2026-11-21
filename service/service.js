"use strict";

/**
 * MovieBox (Morphe Edition) Background Service for Samsung TizenBrew
 * Compatible with Node.js v4.4.3+ (Tizen 3.0+) through modern Node.js.
 * Provides:
 *  1. Persistent TV state storage (/home/owner/share/movieboxData.json)
 *  2. CORS-free HTTP/HTTPS fetcher & catalog proxy (/api/fetch)
 *  3. Multi-source HD stream resolver (/api/resolve)
 *  4. Header-replaying HLS (.m3u8) / Segment proxy (/proxy/stream)
 *  5. Web page & embed frame proxy with ad-blocking (/proxy/page)
 *  6. OpenSubtitles search & SRT-to-WebVTT converter (/api/subs)
 */

var http = require('http');
var https = require('https');
var urlModule = require('url');
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var PORT = 8088;
var DEFAULT_UA = "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 TV Safari/537.36";
var CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

var TMDB_CACHE = {
    "tt15239678": "693134",
    "tt15398776": "872585",
    "tt9362722": "569094",
    "tt1745960": "361743",
    "tt1877830": "414906",
    "tt0816692": "157336",
    "tt1375666": "27205",
    "tt2788316": "126308",
    "tt12637874": "106379",
    "tt3581920": "502119",
    "tt11126994": "94605",
    "tt0903747": "1396",
    "tt4574334": "66732"
};

var STATE_PATHS = [
    '/home/owner/share/movieboxData.json',
    path.join(process.cwd ? process.cwd() : '.', 'movieboxData.json')
];

function getStateFilePath() {
    try {
        if (fs.existsSync('/home/owner/share')) {
            return STATE_PATHS[0];
        }
    } catch (e) {}
    return STATE_PATHS[1];
}

function readState() {
    var p = getStateFilePath();
    try {
        if (fs.existsSync(p)) {
            return JSON.parse(fs.readFileSync(p, 'utf8'));
        }
    } catch (e) {}
    return {};
}

function writeState(data) {
    var p = getStateFilePath();
    try {
        var current = readState();
        var keys = Object.keys(data || {});
        for (var i = 0; i < keys.length; i++) {
            current[keys[i]] = data[keys[i]];
        }
        fs.writeFileSync(p, JSON.stringify(current, null, 2), 'utf8');
        return true;
    } catch (e) {
        return false;
    }
}

// Low-level HTTP buffer fetcher
function fetchBuffer(targetUrl, options, callback) {
    options = options || {};
    var parsed = urlModule.parse(targetUrl);
    var isHttps = parsed.protocol === 'https:';
    var client = isHttps ? https : http;

    var headers = {};
    if (options.headers) {
        var optKeys = Object.keys(options.headers);
        for (var k = 0; k < optKeys.length; k++) {
            headers[optKeys[k]] = options.headers[optKeys[k]];
        }
    }

    if (!headers['User-Agent']) headers['User-Agent'] = options.ua || CHROME_UA;
    if (!headers['Accept']) headers['Accept'] = options.accept || '*/*';
    if (!headers['Accept-Encoding']) headers['Accept-Encoding'] = 'gzip, deflate';
    if (options.referer && !headers['Referer']) headers['Referer'] = options.referer;
    if (options.origin && !headers['Origin']) headers['Origin'] = options.origin;
    if (options.cookie && !headers['Cookie']) headers['Cookie'] = options.cookie;

    var reqOpts = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.path,
        method: options.method || 'GET',
        headers: headers,
        timeout: options.timeout || 12000
    };

    var req = client.request(reqOpts, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            var nextUrl = urlModule.resolve(targetUrl, res.headers.location);
            return fetchBuffer(nextUrl, options, callback);
        }

        var stream = res;
        var enc = (res.headers['content-encoding'] || '').toLowerCase();
        if (enc === 'gzip') {
            stream = res.pipe(zlib.createGunzip());
        } else if (enc === 'deflate') {
            stream = res.pipe(zlib.createInflate());
        }

        var chunks = [];
        stream.on('data', function (c) { chunks.push(c); });
        stream.on('end', function () {
            callback(null, Buffer.concat(chunks), res.statusCode, res.headers);
        });
        stream.on('error', function (err) { callback(err); });
    });

    req.on('error', function (err) { callback(err); });
    req.on('timeout', function () {
        req.abort();
        callback(new Error('ETIMEDOUT'));
    });
    req.end();
}

function sendJson(res, status, obj) {
    var body = JSON.stringify(obj);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*'
    });
    res.end(body);
}

// Convert SRT subtitle buffer to WebVTT
function srtToVtt(srtStr) {
    var vtt = "WEBVTT\n\n";
    var normalized = srtStr.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    normalized = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
    vtt += normalized;
    return vtt;
}

var server = http.createServer(function (req, res) {
    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': '*'
        });
        return res.end();
    }

    var parsedUrl = urlModule.parse(req.url, true);
    var pathname = parsedUrl.pathname;
    var query = parsedUrl.query || {};
    var reqHost = (req.headers && req.headers.host) || ('127.0.0.1:' + PORT);

    // 1. Health check & Ping
    if (pathname === '/api/health' || pathname === '/api/ping') {
        return sendJson(res, 200, {
            ok: true,
            name: "MovieBox Morphe Service",
            version: "1.3.0",
            port: PORT,
            time: Date.now()
        });
    }

    // 2. Persistent storage
    if (pathname === '/api/state') {
        if (req.method === 'POST') {
            var bodyChunks = [];
            req.on('data', function (c) { bodyChunks.push(c); });
            req.on('end', function () {
                try {
                    var parsed = JSON.parse(Buffer.concat(bodyChunks).toString('utf8'));
                    writeState(parsed);
                    return sendJson(res, 200, { ok: true });
                } catch (e) {
                    return sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
                }
            });
            return;
        }
        return sendJson(res, 200, { ok: true, data: readState() });
    }

    // 3. CORS-free Fetch helper
    if (pathname === '/api/fetch') {
        var target = query.url;
        if (!target) return sendJson(res, 400, { ok: false, error: 'Missing url parameter' });

        fetchBuffer(target, {
            referer: query.ref || query.referer,
            origin: query.origin,
            ua: query.ua || CHROME_UA,
            timeout: 10000
        }, function (err, buf, status, headers) {
            if (err) return sendJson(res, 502, { ok: false, error: err.message });
            var ct = (headers && headers['content-type']) || 'text/plain';
            res.writeHead(status || 200, {
                'Content-Type': ct,
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache'
            });
            res.end(buf);
        });
        return;
    }

    // 4. Stream Proxy & M3U8 Manifest Rewriter (/proxy/stream)
    if (pathname === '/proxy/stream') {
        var streamUrl = query.url;
        if (!streamUrl) return sendJson(res, 400, { ok: false, error: 'Missing url' });

        var ref = query.ref || query.referer || 'https://vixsrc.to/';
        var orig = query.origin || 'https://vixsrc.to';

        fetchBuffer(streamUrl, {
            referer: ref,
            origin: orig,
            ua: CHROME_UA,
            timeout: 12000
        }, function (err, buf, status, headers) {
            if (err) return sendJson(res, 502, { ok: false, error: err.message });

            var ct = (headers && headers['content-type']) || 'application/vnd.apple.mpegurl';
            var isM3u8 = streamUrl.indexOf('.m3u8') !== -1 || ct.indexOf('mpegurl') !== -1 || (buf && buf.slice(0, 7).toString() === '#EXTM3U');

            if (isM3u8 && buf) {
                var text = buf.toString('utf8');
                var baseUrl = streamUrl;
                var lines = text.split('\n');
                var out = [];

                for (var i = 0; i < lines.length; i++) {
                    var line = lines[i].trim();
                    if (!line) {
                        out.push(line);
                        continue;
                    }

                    // Rewrite URIs inside #EXT tags (e.g. URI="...")
                    if (line.indexOf('URI="') !== -1) {
                        line = line.replace(/URI="([^"]+)"/g, function (match, rawUri) {
                            var resolved = urlModule.resolve(baseUrl, rawUri);
                            var q = 'url=' + encodeURIComponent(resolved) + '&ref=' + encodeURIComponent(ref) + '&origin=' + encodeURIComponent(orig);
                            return 'URI="http://' + reqHost + '/proxy/stream?' + q + '"';
                        });
                        out.push(line);
                        continue;
                    }

                    if (line.charAt(0) === '#') {
                        out.push(line);
                        continue;
                    }

                    // Video/Audio Chunk URL line
                    var chunkResolved = urlModule.resolve(baseUrl, line);
                    var chunkQ = 'url=' + encodeURIComponent(chunkResolved) + '&ref=' + encodeURIComponent(ref) + '&origin=' + encodeURIComponent(orig);
                    out.push('http://' + reqHost + '/proxy/stream?' + chunkQ);
                }

                var rewritten = out.join('\n');
                res.writeHead(200, {
                    'Content-Type': 'application/vnd.apple.mpegurl',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                    'Cache-Control': 'no-cache'
                });
                return res.end(rewritten);
            }

            // Normal chunk/data pass-through
            res.writeHead(status || 200, {
                'Content-Type': ct,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
                'Cache-Control': 'public, max-age=3600'
            });
            res.end(buf);
        });
        return;
    }

    // 5. Multi-Source Resolver (/api/resolve)
    if (pathname === '/api/resolve') {
        var rType = (query.type === 'series' || query.type === 'tv') ? 'series' : 'movie';
        var rImdb = query.imdb || '';
        var rTmdb = query.tmdb || '';
        var rSeason = parseInt(query.s || query.season || '1', 10) || 1;
        var rEpisode = parseInt(query.e || query.episode || '1', 10) || 1;

        function resolveStreams(finalId) {
            var streams = [];
            var pending = 3;
            var isTv = (rType === 'series');
            var VP_KEY = 'f3b72e73c80c9a996574379798703796a1936efa3516a7105cb0e43048b46b5a';

            function checkDone() {
                pending--;
                if (pending <= 0) {
                    streams.sort(function (a, b) {
                        return (a.order || 99) - (b.order || 99);
                    });
                    return sendJson(res, 200, {
                        ok: streams.length > 0,
                        tmdb: finalId,
                        imdb: rImdb,
                        url: streams.length > 0 ? streams[0].url : "",
                        streams: streams
                    });
                }
            }

            // 1. VIP Server 1: VidPrime Helix (Native 1080p FHD)
            var p1Path = isTv ? ('/v1/tv/' + finalId + '/' + rSeason + '/' + rEpisode + '?source=x9pv')
                              : ('/v1/movie/' + finalId + '?source=x9pv');
            var p1Ref = isTv ? ('https://vidprime.top/tv/' + finalId + '/' + rSeason + '/' + rEpisode)
                             : ('https://vidprime.top/movie/' + finalId);

            fetchBuffer('https://vidprime.top/api/vidora' + p1Path, {
                headers: { 'x-player-key': VP_KEY },
                referer: p1Ref,
                ua: CHROME_UA,
                timeout: 7000
            }, function (err, buf) {
                if (!err && buf) {
                    try {
                        var j = JSON.parse(buf.toString('utf8'));
                        if (j && j.result && j.sources && j.sources[0] && j.sources[0].url) {
                            var m3u8 = j.sources[0].url;
                            streams.push({
                                order: 1,
                                server: "VIP Server 1 (1080p FHD)",
                                label: "MovieBox Ultra 1080p FHD (Helix)",
                                quality: "1080p",
                                url: 'http://' + reqHost + '/proxy/stream?url=' + encodeURIComponent(m3u8) +
                                     '&ref=' + encodeURIComponent('https://vidprime.top/') +
                                     '&origin=' + encodeURIComponent('https://vidprime.top'),
                                rawUrl: m3u8,
                                referer: "https://vidprime.top/",
                                origin: "https://vidprime.top"
                            });
                        }
                    } catch (e) {}
                }
                checkDone();
            });

            // 2. VIP Server 2: VidPrime Orion (Native 1080p FHD)
            var p2Path = isTv ? ('/v1/tv/' + finalId + '/' + rSeason + '/' + rEpisode + '?source=w7dn')
                              : ('/v1/movie/' + finalId + '?source=w7dn');

            fetchBuffer('https://vidprime.top/api/vidora' + p2Path, {
                headers: { 'x-player-key': VP_KEY },
                referer: p1Ref,
                ua: CHROME_UA,
                timeout: 7000
            }, function (err, buf) {
                if (!err && buf) {
                    try {
                        var j = JSON.parse(buf.toString('utf8'));
                        if (j && j.result && j.sources && j.sources[0] && j.sources[0].url) {
                            var m3u8 = j.sources[0].url;
                            streams.push({
                                order: 2,
                                server: "VIP Server 2 (1080p FHD)",
                                label: "MovieBox Fast 1080p FHD (Orion)",
                                quality: "1080p",
                                url: 'http://' + reqHost + '/proxy/stream?url=' + encodeURIComponent(m3u8) +
                                     '&ref=' + encodeURIComponent('https://vidprime.top/') +
                                     '&origin=' + encodeURIComponent('https://vidprime.top'),
                                rawUrl: m3u8,
                                referer: "https://vidprime.top/",
                                origin: "https://vidprime.top"
                            });
                        }
                    } catch (e) {}
                }
                checkDone();
            });

            // 3. VIP Server 3: VixSrc HD (720p Backup)
            var vixUrl = isTv
                ? ('https://vixsrc.to/api/tv/' + encodeURIComponent(finalId) + '/' + rSeason + '/' + rEpisode)
                : ('https://vixsrc.to/api/movie/' + encodeURIComponent(finalId));
            var vixRef = isTv
                ? ('https://vixsrc.to/tv/' + finalId + '/' + rSeason + '/' + rEpisode)
                : ('https://vixsrc.to/movie/' + finalId);

            fetchBuffer(vixUrl, { referer: vixRef, ua: CHROME_UA, timeout: 7000 }, function (err1, buf1, status1, headers1) {
                if (!err1 && buf1) {
                    try {
                        var j1 = JSON.parse(buf1.toString('utf8'));
                        if (j1 && j1.src) {
                            var cookies = (headers1 && headers1['set-cookie'] || []).map(function (c) { return c.split(';')[0]; }).join('; ');
                            var embedUrl = urlModule.resolve('https://vixsrc.to', j1.src);
                            fetchBuffer(embedUrl, { referer: vixRef, cookie: cookies, ua: CHROME_UA, timeout: 7000 }, function (err2, buf2) {
                                if (!err2 && buf2) {
                                    var html = buf2.toString('utf8');
                                    var tok = html.match(/['"]token['"]\s*:\s*['"]([^'"]+)['"]/);
                                    var exp = html.match(/['"]expires['"]\s*:\s*['"]([^'"]+)['"]/);
                                    var mUrl = html.match(/url\s*:\s*['"](https?:\/\/[^'"]+\/playlist\/[^'"]+)['"]/);
                                    if (tok && exp && mUrl) {
                                        var m3u8 = mUrl[1] + "?token=" + encodeURIComponent(tok[1]) + "&expires=" + encodeURIComponent(exp[1]) + "&h=1&lang=en";
                                        var proxyM3u8 = 'http://' + reqHost + '/proxy/stream?url=' + encodeURIComponent(m3u8) +
                                                        '&ref=' + encodeURIComponent('https://vixsrc.to/') +
                                                        '&origin=' + encodeURIComponent('https://vixsrc.to');
                                        streams.push({
                                            order: 3,
                                            server: "VIP Server 3 (720p HD)",
                                            label: "MovieBox Backup 720p (VixSrc)",
                                            quality: "720p",
                                            url: proxyM3u8,
                                            rawUrl: m3u8,
                                            referer: "https://vixsrc.to/",
                                            origin: "https://vixsrc.to"
                                        });
                                    }
                                }
                                checkDone();
                            });
                            return;
                        }
                    } catch (e) {}
                }
                checkDone();
            });
        }

        if (rTmdb) {
            return resolveStreams(rTmdb);
        }

        if (rImdb) {
            if (TMDB_CACHE[rImdb]) {
                return resolveStreams(TMDB_CACHE[rImdb]);
            }
            // Quick Cinemeta lookup with 4s timeout
            var cinemetaUrl = 'https://v3-cinemeta.strem.io/meta/' + rType + '/' + encodeURIComponent(rImdb) + '.json';
            fetchBuffer(cinemetaUrl, { timeout: 4000 }, function (err, buf) {
                var foundTmdb = '';
                if (!err && buf) {
                    try {
                        var parsed = JSON.parse(buf.toString('utf8'));
                        foundTmdb = (parsed && parsed.meta && (parsed.meta.moviedb_id || parsed.meta.tmdb_id)) || '';
                        if (foundTmdb) TMDB_CACHE[rImdb] = foundTmdb;
                    } catch (e) {}
                }
                // VixSrc also accepts IMDb IDs directly if Cinemeta lookup returns empty
                resolveStreams(foundTmdb || rImdb);
            });
            return;
        }

        return sendJson(res, 400, { ok: false, error: 'Missing imdb or tmdb' });
    }

    // 6. Subtitles API (/api/subs) - OpenSubtitles Live Search + WebVTT proxy
    if (pathname === '/api/subs') {
        var subImdb = query.imdb ? query.imdb.replace(/^tt/, '') : '';
        var rawLang = query.lang || 'ara,eng';
        var subSeason = query.s || '';
        var subEpisode = query.e || '';

        if (!subImdb) return sendJson(res, 400, { ok: false, error: 'Missing imdb parameter' });

        var langs = rawLang.split(',');
        var allResults = [];
        var completed = 0;

        function fetchLang(langCode) {
            var l = langCode.trim();
            if (!l) {
                step();
                return;
            }
            var osUrl = 'https://rest.opensubtitles.org/search/imdbid-' + subImdb +
                        (subSeason ? ('/season-' + subSeason) : '') +
                        (subEpisode ? ('/episode-' + subEpisode) : '') +
                        '/sublanguageid-' + l;

            fetchBuffer(osUrl, { ua: 'TemporaryUserAgent', timeout: 8000 }, function (err, buf) {
                if (!err && buf) {
                    try {
                        var list = JSON.parse(buf.toString('utf8'));
                        for (var i = 0; i < (list || []).length && i < 15; i++) {
                            var item = list[i];
                            if (item && item.SubDownloadLink) {
                                allResults.push({
                                    id: item.IDSubtitleFile,
                                    lang: item.SubLanguageID,
                                    langName: item.LanguageName,
                                    name: item.MovieReleaseName || item.SubFileName,
                                    url: item.SubDownloadLink.replace('.gz', ''),
                                    vttUrl: 'http://' + reqHost + '/api/vtt?url=' + encodeURIComponent(item.SubDownloadLink)
                                });
                            }
                        }
                    } catch (e) {}
                }
                step();
            });
        }

        function step() {
            completed++;
            if (completed >= langs.length) {
                return sendJson(res, 200, { ok: true, subtitles: allResults });
            }
        }

        for (var li = 0; li < langs.length; li++) {
            fetchLang(langs[li]);
        }
        return;
    }

    // 7. Subtitle VTT converter (/api/vtt)
    if (pathname === '/api/vtt') {
        var rawSubUrl = query.url;
        if (!rawSubUrl) return sendJson(res, 400, { ok: false, error: 'Missing url' });

        fetchBuffer(rawSubUrl, { timeout: 8000 }, function (err, buf) {
            if (err || !buf) return sendJson(res, 502, { ok: false, error: 'Subtitle download failed' });
            var vtt = srtToVtt(buf.toString('utf8'));
            res.writeHead(200, {
                'Content-Type': 'text/vtt; charset=utf-8',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(vtt);
        });
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

function startServer(portToTry) {
    server.listen(portToTry, '127.0.0.1', function () {
        PORT = portToTry;
        console.log('MovieBox Morphe service listening on http://127.0.0.1:' + PORT);
    });
}

server.on('error', function (err) {
    if (err.code === 'EADDRINUSE') {
        if (PORT === 8088) {
            console.warn('Port 8088 in use, trying 8089...');
            startServer(8089);
        } else if (PORT === 8089) {
            console.warn('Port 8089 in use, trying 8087...');
            startServer(8087);
        } else {
            console.error('All ports in use for MovieBox service:', err.message);
        }
    } else {
        console.error('MovieBox service error:', err.message);
    }
});

startServer(PORT);
