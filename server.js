'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const apiHandler = require('./panaderia-andino/api/[...path].js');

const publicDir = path.resolve(__dirname, 'panaderia-andino');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.dat': 'application/octet-stream',
  '.part1': 'application/octet-stream',
  '.part2': 'application/octet-stream',
  '.part3': 'application/octet-stream'
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, service: 'panaderia-andino' }));
  }

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) {
          res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ error: 'La solicitud es demasiado grande.' }));
        }
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw) {
        try { req.body = JSON.parse(raw); } catch (_) { req.body = raw; }
      } else {
        req.body = {};
      }
      return await apiHandler(req, res);
    } catch (error) {
      console.error('API request failed:', error && error.stack ? error.stack : error);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ error: 'No se pudo completar la solicitud.' }));
    }
  }

  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch (_) {
    res.writeHead(400); return res.end('Bad Request');
  }
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(publicDir, '.' + pathname);
  if (!filePath.startsWith(publicDir + path.sep) && filePath !== publicDir) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'content-type': mime[ext] || 'application/octet-stream' };
    if (path.basename(filePath) === 'sw.js') headers['cache-control'] = 'no-cache';
    else if (path.basename(filePath) === 'manifest.webmanifest') headers['cache-control'] = 'public, max-age=3600';
    else if (/^app\\.bundle\\.(part[123]|dat)$/.test(path.basename(filePath))) headers['cache-control'] = 'no-store';
    else headers['cache-control'] = 'public, max-age=300';
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
});

const port = Number(process.env.PORT || 10000);
server.listen(port, '0.0.0.0', () => {
  console.log('Panadería Andino listening on port ' + port);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
