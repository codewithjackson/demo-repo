const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;

const ALLOWED_CDN_HOSTS = new Set([
  'bcdnxw.hakunaymatata.com',
  'bcdn.hakunaymatata.com',
  'cacdn.hakunaymatata.com',
  'macdn.aoneroom.com',
  'pbcdn.aoneroom.com'
]);

function sanitizeFilename(name) {
  return (name || 'video').replace(/[/\\?%*:|"<>]/g, '_').trim();
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Disposition');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (reqUrl.pathname === '/' || reqUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'streamixx-proxy' }));
    return;
  }

  if (reqUrl.pathname === '/debug-curl') {
    const { exec } = require('child_process');
    const testUrl = reqUrl.searchParams.get('url') || 'https://api.ipify.org?format=json';
    const ref = reqUrl.searchParams.get('ref') || 'https://moviebox.ph/';
    exec(`curl -s -I -H "Referer: ${ref}" -H "User-Agent: okhttp/4.12.0" "${testUrl}"`, (err, stdout, stderr) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ stdout, stderr, err: err ? err.message : null }, null, 2));
    });
    return;
  }

  if (reqUrl.pathname === '/debug') {
    const { exec } = require('child_process');
    const testUrl = reqUrl.searchParams.get('url') || 'https://api.ipify.org?format=json';
    const ref = reqUrl.searchParams.get('ref') || 'https://moviebox.ph/';
    exec(`curl -s -I -H "Referer: ${ref}" -H "User-Agent: okhttp/4.12.0" "${testUrl}"`, (err, stdout, stderr) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ stdout, stderr, err: err ? err.message : null }, null, 2));
    });
    return;
  }
    const testUrl = reqUrl.searchParams.get('url') || 'https://api.ipify.org?format=json';
    const customUa = reqUrl.searchParams.get('ua') || 'okhttp/4.12.0';
    const customRef = reqUrl.searchParams.get('ref') || 'https://moviebox.ph/';
    try {
      const u = new URL(testUrl);
      const mod = u.protocol === 'http:' ? http : https;
      const headers = {
        'User-Agent': customUa,
        'Referer': customRef,
        'Accept': '*/*'
      };
      if (reqUrl.searchParams.get('range')) {
        headers['Range'] = reqUrl.searchParams.get('range');
      }
      const proxyReq = mod.get(testUrl, { headers }, (proxyRes) => {
        let body = '';
        proxyRes.on('data', c => { if (body.length < 2000) body += c.toString('utf8'); });
        proxyRes.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            target: testUrl,
            status: proxyRes.statusCode,
            statusMessage: proxyRes.statusMessage,
            headers: proxyRes.headers,
            body: body.slice(0, 500)
          }, null, 2));
        });
      });
      proxyReq.on('error', err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  const isStream = reqUrl.pathname.startsWith('/api/stream');
  const isDownload = reqUrl.pathname.startsWith('/api/download');

  if (!isStream && !isDownload) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
    return;
  }

  let targetUrlStr = reqUrl.searchParams.get('url');
  if (!targetUrlStr) {
    const parts = reqUrl.pathname.replace(/^\/api\/(stream|download)\/?/, '');
    if (parts) targetUrlStr = `https://bcdnxw.hakunaymatata.com/${parts}${reqUrl.search}`;
  }

  if (!targetUrlStr) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing media URL parameter' }));
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(targetUrlStr);
  } catch (_) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid media URL' }));
    return;
  }

  if (!ALLOWED_CDN_HOSTS.has(targetUrl.hostname)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Host not allowed' }));
    return;
  }

  const upstreamHeaders = {
    'User-Agent': 'okhttp/4.12.0',
    'Referer': 'https://moviebox.ph/',
    'Origin': 'https://moviebox.ph/',
    'Accept': '*/*'
  };

  const range = req.headers['range'];
  if (range) upstreamHeaders['Range'] = range;

  const upstreamReq = https.get(targetUrl.href, { headers: upstreamHeaders }, upstreamRes => {
    const status = upstreamRes.statusCode || 200;
    const responseHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, Content-Disposition',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600'
    };

    responseHeaders['Content-Type'] = upstreamRes.headers['content-type'] || 'video/mp4';
    if (upstreamRes.headers['content-length']) responseHeaders['Content-Length'] = upstreamRes.headers['content-length'];
    if (upstreamRes.headers['content-range']) responseHeaders['Content-Range'] = upstreamRes.headers['content-range'];

    if (isDownload) {
      let title = reqUrl.searchParams.get('title') || 'video';
      const quality = reqUrl.searchParams.get('quality');
      const season = reqUrl.searchParams.get('season');
      const episode = reqUrl.searchParams.get('episode');

      let filename = sanitizeFilename(title);
      if (season && episode) filename += `_S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
      if (quality) filename += `_${quality}`;
      if (!filename.toLowerCase().endsWith('.mp4')) filename += '.mp4';

      responseHeaders['Content-Disposition'] = `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
    }

    res.writeHead(status, responseHeaders);
    upstreamRes.pipe(res);
  });

  upstreamReq.on('error', err => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch media from CDN', details: err.message }));
    }
  });

  req.on('close', () => upstreamReq.destroy());
});

server.listen(PORT, () => console.log(`Streamixx proxy running on port ${PORT}`));
