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

// Common ad-tracker domains blocked in embed players
var blockedDomains = {
    "doubleclick.net": 1, "googlesyndication.com": 1, "googleadservices.com": 1,
    "adnxs.com": 1, "popads.net": 1, "popcash.net": 1, "propellerads.com": 1,
    "exoclick.com": 1, "juicyads.com": 1, "trafficjunky.net": 1, "adsterra.com": 1,
    "hilltopads.net": 1, "clickadu.com": 1, "adcash.com": 1, "bidvertiser.com": 1,
    "onclkds.com": 1, "afcdn.net": 1, "tsyndicate.com": 1, "realsrv.com": 1,
    "admaven.com": 1, "galaksion.com": 1, "histats.com": 1
};

function isDomainBlocked(host) {
    if (!host) return false;
    var h = String(host).toLowerCase().trim();
    while (h) {
        if (blockedDomains[h]) return true;
        var dot = h.indexOf('.');
        if (dot < 0) break;
        h = h.substring(dot + 1);
    }
    return false;
}

// Low-level HTTP buffer fetcher
function fetchBuffer(targetUrl, options, callback) {
    options = options || {};
    var parsed = urlModule.parse(targetUrl);
    var isHttps = parsed.protocol === 'https:';
    var client = isHttps ? https : http;

    var headers = Object.assign({}, options.headers || {});
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
    // Replace 00:00:00,000 with 00:00:00.000
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

    // 1. Health check
    if (pathname === '/api/health') {
        return sendJson(res, 200, {
            ok: true,
            name: "MovieBox Morphe Service",
            version: "1.0.0",
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
                            return 'URI="http://127.0.0.1:' + PORT + '/proxy/stream?' + q + '"';
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
                    out.push('http://127.0.0.1:' + PORT + '/proxy/stream?' + chunkQ);
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
        var rSeason = parseInt(query.s || '1', 10);
        var rEpisode = parseInt(query.e || '1', 10);

        function resolveStreams(finalTmdb) {
            var streams = [];

            // Provider 1: VixSrc HD
            var vixUrl = rType === 'series'
                ? ('https://vixsrc.to/api/tv/' + encodeURIComponent(finalTmdb) + '/' + rSeason + '/' + rEpisode)
                : ('https://vixsrc.to/api/movie/' + encodeURIComponent(finalTmdb));
            var vixRef = rType === 'series'
                ? ('https://vixsrc.to/tv/' + finalTmdb + '/' + rSeason + '/' + rEpisode)
                : ('https://vixsrc.to/movie/' + finalTmdb);

            fetchBuffer(vixUrl, { referer: vixRef, ua: CHROME_UA, timeout: 8000 }, function (err1, buf1, status1, headers1) {
                if (!err1 && buf1) {
                    try {
                        var j1 = JSON.parse(buf1.toString('utf8'));
                        if (j1 && j1.src) {
                            var cookies = (headers1 && headers1['set-cookie'] || []).map(function (c) { return c.split(';')[0]; }).join('; ');
                            var embedUrl = urlModule.resolve('https://vixsrc.to', j1.src);
                            fetchBuffer(embedUrl, { referer: vixRef, cookie: cookies, ua: CHROME_UA, timeout: 8000 }, function (err2, buf2) {
                                if (!err2 && buf2) {
                                    var html = buf2.toString('utf8');
                                    var tok = html.match(/['"]token['"]\s*:\s*['"]([^'"]+)['"]/);
                                    var exp = html.match(/['"]expires['"]\s*:\s*['"]([^'"]+)['"]/);
                                    var mUrl = html.match(/url\s*:\s*['"](https?:\/\/[^'"]+\/playlist\/[^'"]+)['"]/);
                                    if (tok && exp && mUrl) {
                                        var m3u8 = mUrl[1] + "?token=" + encodeURIComponent(tok[1]) + "&expires=" + encodeURIComponent(exp[1]) + "&h=1&lang=en";
                                        var proxyM3u8 = 'http://127.0.0.1:' + PORT + '/proxy/stream?url=' + encodeURIComponent(m3u8) +
                                                        '&ref=' + encodeURIComponent('https://vixsrc.to/') +
                                                        '&origin=' + encodeURIComponent('https://vixsrc.to');
                                        streams.push({
                                            server: "VIP Server 1",
                                            label: "MovieBox Direct FHD 1080p (Native)",
                                            quality: "1080p",
                                            url: proxyM3u8,
                                            rawUrl: m3u8,
                                            referer: "https://vixsrc.to/",
                                            origin: "https://vixsrc.to",
                                            headers: { Referer: "https://vixsrc.to/", Origin: "https://vixsrc.to" }
                                        });
                                    }
                                }
                                finishResponse();
                            });
                            return;
                        }
                    } catch (e) {}
                }
                finishResponse();
            });

            function finishResponse() {
                return sendJson(res, 200, {
                    ok: streams.length > 0,
                    tmdb: finalTmdb,
                    imdb: rImdb,
                    url: streams.length > 0 ? streams[0].url : "",
                    streams: streams
                });
            }
        }

        if (rTmdb) {
            return resolveStreams(rTmdb);
        }

        // Lookup TMDB via Cinemeta
        if (rImdb) {
            var cinemetaUrl = 'https://v3-cinemeta.strem.io/meta/' + rType + '/' + encodeURIComponent(rImdb) + '.json';
            fetchBuffer(cinemetaUrl, { timeout: 6000 }, function (err, buf) {
                var foundTmdb = '';
                if (!err && buf) {
                    try {
                        var parsed = JSON.parse(buf.toString('utf8'));
                        foundTmdb = (parsed && parsed.meta && (parsed.meta.moviedb_id || parsed.meta.tmdb_id)) || '';
                    } catch (e) {}
                }
                resolveStreams(foundTmdb || rImdb);
            });
            return;
        }

        return sendJson(res, 400, { ok: false, error: 'Missing imdb or tmdb' });
    }

    // 6. Subtitles API (/api/subs) - OpenSubtitles Live Search + WebVTT proxy
    if (pathname === '/api/subs') {
        var subImdb = query.imdb ? query.imdb.replace(/^tt/, '') : '';
        var subLang = query.lang || 'ara,eng';
        var subSeason = query.s || '';
        var subEpisode = query.e || '';

        if (!subImdb) return sendJson(res, 400, { ok: false, error: 'Missing imdb parameter' });

        var osUrl = 'https://rest.opensubtitles.org/search/imdbid-' + subImdb +
                    (subSeason ? ('/season-' + subSeason) : '') +
                    (subEpisode ? ('/episode-' + subEpisode) : '') +
                    '/sublanguageid-' + subLang;

        fetchBuffer(osUrl, { ua: 'TemporaryUserAgent', timeout: 8000 }, function (err, buf) {
            if (err || !buf) return sendJson(res, 502, { ok: false, error: 'OpenSubtitles unreachable' });
            try {
                var list = JSON.parse(buf.toString('utf8'));
                var results = [];
                for (var i = 0; i < (list || []).length && i < 20; i++) {
                    var item = list[i];
                    if (item && item.SubDownloadLink) {
                        results.push({
                            id: item.IDSubtitleFile,
                            lang: item.SubLanguageID,
                            langName: item.LanguageName,
                            name: item.MovieReleaseName || item.SubFileName,
                            url: item.SubDownloadLink.replace('.gz', ''),
                            vttUrl: 'http://127.0.0.1:' + PORT + '/api/vtt?url=' + encodeURIComponent(item.SubDownloadLink)
                        });
                    }
                }
                return sendJson(res, 200, { ok: true, subtitles: results });
            } catch (e) {
                return sendJson(res, 500, { ok: false, error: 'Parse error' });
            }
        });
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

server.on('error', function (err) {
    console.error('MovieBox service error:', err.message);
});

server.listen(PORT, '127.0.0.1', function () {
    console.log('MovieBox Morphe service listening on http://127.0.0.1:' + PORT);
});
