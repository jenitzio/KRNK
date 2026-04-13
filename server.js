// ====================================================================
// KRNK.js — Render-ready server with NO index.html dependency
// ====================================================================
// - Generates the app shell dynamically at "/".
// - Auto-detects the correct Render host/protocol.
// - Still serves files from /public.
// - Includes /healthz for Render health checks.
// - Optional cross-origin isolation via env var.
// ====================================================================

'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const ENABLE_CROSS_ORIGIN_ISOLATION =
  String(process.env.ENABLE_CROSS_ORIGIN_ISOLATION || 'false').toLowerCase() === 'true';

app.disable('x-powered-by');
app.set('trust proxy', true);

// ----------------------------------------------------
// Helpers
// ----------------------------------------------------
function isAssetRequest(urlPath = '') {
  return /\.[a-z0-9]+$/i.test(urlPath);
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function getBaseUrls(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .split(',')[0]
    .trim();

  const host = String(req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`)
    .split(',')[0]
    .trim();

  return {
    origin: `${proto}://${host}`,
    apiBase: `${proto}://${host}`,
    wsBase: `${proto === 'https' ? 'wss' : 'ws'}://${host}`,
    env: process.env.NODE_ENV || 'development',
  };
}

function hasClientJs() {
  return fs.existsSync(path.join(PUBLIC_DIR, 'client.js'));
}

// ----------------------------------------------------
// Global headers
// ----------------------------------------------------
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  if (ENABLE_CROSS_ORIGIN_ISOLATION) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  }

  if (isAssetRequest(req.path)) {
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=3600');
  } else {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }

  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ----------------------------------------------------
// Health + config
// ----------------------------------------------------
app.get('/healthz', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'KRNK',
    uptimeSeconds: Number(process.uptime().toFixed(1)),
    time: new Date().toISOString(),
  });
});

app.get('/api/config', (req, res) => {
  res.status(200).json(getBaseUrls(req));
});

// ----------------------------------------------------
// Static assets (NO index.html auto-serving)
// Files in /public are served at root, e.g. public/client.js -> /client.js
// ----------------------------------------------------
app.use(
  express.static(PUBLIC_DIR, {
    index: false,
    extensions: false,
    etag: true,
    fallthrough: true,
  })
);

// ----------------------------------------------------
// Dynamic app shell (replaces index.html)
// ----------------------------------------------------
function renderAppShell(req) {
  const cfg = getBaseUrls(req);
  const loadClient = hasClientJs();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="theme-color" content="#0b1020" />
  <title>KRNK</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #0b1020;
      color: #e5e7eb;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    }
    #app {
      width: min(900px, 92vw);
      padding: 24px;
      border-radius: 16px;
      background: rgba(17, 24, 39, 0.92);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    }
    h1 { margin-top: 0; }
    pre {
      overflow: auto;
      padding: 12px;
      border-radius: 12px;
      background: #111827;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .muted { color: #9ca3af; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
  </style>

  <script>
    window.__KRNK__ = ${safeJson(cfg)};
  </script>
</head>
<body>
  <main id="app">
    <h1>KRNK</h1>
    <p class="muted">Connecting to this deployment...</p>
  </main>

  ${
    loadClient
      ? `<script type="module" src="/client.js"></script>`
      : `<script type="module">
          const root = document.getElementById('app');
          const cfg = window.__KRNK__;

          async function boot() {
            try {
              const res = await fetch('/healthz', { cache: 'no-store' });
              const health = await res.json();

              root.innerHTML = \`
                <h1>KRNK</h1>
                <p>Connected successfully.</p>
                <pre>\${JSON.stringify({ config: cfg, health }, null, 2)}</pre>
                <p class="muted">
                  No <code>public/client.js</code> was found, so this built-in shell is being shown.
                  If your old browser logic was inside <code>index.html</code>, move it into
                  <code>public/client.js</code>.
                </p>
              \`;
            } catch (err) {
              root.innerHTML = \`
                <h1>KRNK</h1>
                <p>Shell loaded, but the health check failed.</p>
                <pre>\${String(err && (err.stack || err.message || err))}</pre>
              \`;
            }
          }

          boot();
        </script>`
  }
</body>
</html>`;
}

function sendAppShell(req, res) {
  res.status(200).type('html').send(renderAppShell(req));
}

// Root route
app.get('/', sendAppShell);

// SPA-style fallback for browser navigations
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (!req.accepts('html')) return next();
  if (req.path === '/healthz' || req.path.startsWith('/api/')) return next();
  if (isAssetRequest(req.path)) return next();
  return sendAppShell(req, res);
});

// 404
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: 'Not found',
    path: req.originalUrl,
  });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    ok: false,
    error: 'Internal server error',
  });
});

// Start
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nKRNK server listening on :${PORT}`);
  console.log(`Local:  http://localhost:${PORT}`);
  console.log(`Public: bound to 0.0.0.0\n`);
});
