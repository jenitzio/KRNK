// ====================================================================
// KRNK.js — Render-ready server with WebSocket multiplayer game logic
// ====================================================================
// - Generates the app shell dynamically at "/".
// - Auto-detects the correct Render host/protocol.
// - Still serves files from /public.
// - Includes /healthz for Render health checks.
// - Full WebSocket game server for multiplayer FPS.
// - CORS enabled for cross-origin client (Wasmer).
// ====================================================================
'use strict';

const http = require('http');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ENABLE_CROSS_ORIGIN_ISOLATION =
  String(process.env.ENABLE_CROSS_ORIGIN_ISOLATION || 'false').toLowerCase() === 'true';

app.disable('x-powered-by');
app.set('trust proxy', true);

// ====================================================================
// Helpers
// ====================================================================
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
    .split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`)
    .split(',')[0].trim();
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

// ====================================================================
// CORS — Allow cross-origin requests from Wasmer-hosted client
// ====================================================================
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ====================================================================
// Global security & cache headers
// ====================================================================
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

// ====================================================================
// Health + config
// ====================================================================
app.get('/healthz', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'KRNK',
    uptimeSeconds: Number(process.uptime().toFixed(1)),
    time: new Date().toISOString(),
    playersOnline: players.size,
  });
});

app.get('/api/config', (req, res) => {
  res.status(200).json(getBaseUrls(req));
});

// ====================================================================
// Static assets (NO index.html auto-serving)
// ====================================================================
app.use(
  express.static(PUBLIC_DIR, {
    index: false,
    extensions: false,
    etag: true,
    fallthrough: true,
  })
);

// ====================================================================
// Dynamic app shell (replaces index.html)
// ====================================================================
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
      margin: 0; min-height: 100vh;
      display: grid; place-items: center;
      background: #0b1020; color: #e5e7eb;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    }
    #app {
      width: min(900px, 92vw); padding: 24px; border-radius: 16px;
      background: rgba(17, 24, 39, 0.92);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    }
    h1 { margin-top: 0; }
    pre {
      overflow: auto; padding: 12px; border-radius: 12px;
      background: #111827;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .muted { color: #9ca3af; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  </style>
  <script>window.__KRNK__ = ${safeJson(cfg)};</script>
</head>
<body>
  <main id="app">
    <h1>KRNK</h1>
    <p class="muted">Connecting to this deployment...</p>
  </main>
  ${loadClient
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
  res.status(404).json({ ok: false, error: 'Not found', path: req.originalUrl });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({ ok: false, error: 'Internal server error' });
});

// ====================================================================
// CREATE HTTP SERVER (needed for WebSocket upgrade)
// ====================================================================
const server = http.createServer(app);

// ====================================================================
// WEBSOCKET GAME SERVER
// ====================================================================
const wss = new WebSocketServer({ server });

// ── Game State ────────────────────────────────────────────────────
const players = new Map(); // id → { ws, id, name, px, py, pz, vx, vy, vz, yaw, pitch, ... }
let nextPlayerId = 1;

const SPAWN_POINTS = [
  { x: 0, z: 5 }, { x: -18, z: -18 }, { x: 18, z: 18 },
  { x: -18, z: 18 }, { x: 18, z: -18 }, { x: -10, z: 0 },
  { x: 10, z: 0 }, { x: 0, z: -10 }, { x: 0, z: 10 },
];
const TICK_RATE = 20; // server broadcasts per second

function genId() {
  return 'p' + (nextPlayerId++).toString(36);
}

function randomSpawn() {
  return SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
}

function sendTo(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(msg)); } catch (_) {}
  }
}

function broadcast(msg, excludeId) {
  const raw = JSON.stringify(msg);
  for (const [id, p] of players) {
    if (id !== excludeId && p.ws.readyState === WebSocket.OPEN) {
      try { p.ws.send(raw); } catch (_) {}
    }
  }
}

// ── Connection handler ────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  let playerId = null;

  // Keep-alive pings from server side (Render closes idle connections after ~60s)
  const keepAlive = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 25000);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const { t, d } = msg;
    if (!t) return;

    switch (t) {

      // ── JOIN ────────────────────────────────────────────────────
      case 'join': {
        if (playerId) return; // already joined
        playerId = genId();
        const sp = randomSpawn();
        const player = {
          ws,
          id: playerId,
          name: String(d.name || 'Player').substring(0, 16),
          px: sp.x, py: 1.7, pz: sp.z,
          vx: 0, vy: 0, vz: 0,
          yaw: 0, pitch: 0,
          grounded: true, crouching: false,
          health: 100, dead: false,
          kills: 0, deaths: 0,
          weaponId: 'assault_rifle',
          seq: 0,
          lastPing: 0,
        };
        players.set(playerId, player);

        // Send welcome with full player list
        const playerList = [];
        for (const [, p] of players) {
          playerList.push({
            id: p.id, name: p.name,
            px: p.px, py: p.py, pz: p.pz,
            yaw: p.yaw, pitch: p.pitch,
            health: p.health, dead: p.dead,
            kills: p.kills, deaths: p.deaths,
          });
        }
        sendTo(ws, { t: 'welcome', d: { id: playerId, players: playerList } });

        // Broadcast join to everyone else
        broadcast({
          t: 'joined',
          d: { id: playerId, name: player.name, px: player.px, py: player.py, pz: player.pz },
        }, playerId);

        console.log(`[GAME] ${player.name} joined (${playerId}). Online: ${players.size}`);
        break;
      }

      // ── STATE UPDATE (client → server) ──────────────────────────
      case 'state': {
        if (!playerId) return;
        const p = players.get(playerId);
        if (!p) return;
        // Accept position/rotation from client (client-authoritative movement)
        if (d.px !== undefined) p.px = d.px;
        if (d.py !== undefined) p.py = d.py;
        if (d.pz !== undefined) p.pz = d.pz;
        if (d.vx !== undefined) p.vx = d.vx;
        if (d.vy !== undefined) p.vy = d.vy;
        if (d.vz !== undefined) p.vz = d.vz;
        if (d.yaw !== undefined) p.yaw = d.yaw;
        if (d.pitch !== undefined) p.pitch = d.pitch;
        if (d.grounded !== undefined) p.grounded = d.grounded;
        if (d.crouching !== undefined) p.crouching = d.crouching;
        if (d.seq !== undefined) p.seq = d.seq;
        // NOTE: health & dead are server-authoritative (set by hit/died)
        break;
      }

      // ── SHOOT (relay to other clients for effects) ──────────────
      case 'shoot': {
        if (!playerId) return;
        broadcast({ t: 'shoot', d: { id: playerId, ...d } }, playerId);
        break;
      }

      // ── HIT (client says "I hit player X") ─────────────────────
      case 'hit': {
        if (!playerId) return;
        const target = players.get(d.targetId);
        if (!target || target.dead) return;

        const damage = Math.max(0, Math.min(200, Number(d.damage) || 0));
        target.health = Math.max(0, target.health - damage);

        const damageMsg = {
          t: 'damaged',
          d: {
            attackerId: playerId,
            targetId: d.targetId,
            damage: damage,
            newHealth: target.health,
          },
        };

        // Notify target
        sendTo(target.ws, damageMsg);
        // Notify attacker (for hit marker confirmation)
        sendTo(ws, damageMsg);
        break;
      }

      // ── DIED (client confirms own death) ────────────────────────
      case 'died': {
        if (!playerId) return;
        const victim = players.get(playerId);
        if (!victim) return;
        victim.dead = true;
        victim.health = 0;
        victim.deaths++;

        const killer = players.get(d.killerId);
        if (killer) killer.kills++;

        broadcast({
          t: 'killed',
          d: {
            killerId: d.killerId,
            killerName: killer ? killer.name : 'Unknown',
            victimId: playerId,
            victimName: victim.name,
            weapon: d.weaponId || 'assault_rifle',
          },
        });

        console.log(`[GAME] ${victim.name} killed by ${killer ? killer.name : '???'}`);
        break;
      }

      // ── RESPAWN ─────────────────────────────────────────────────
      case 'respawn': {
        if (!playerId) return;
        const p = players.get(playerId);
        if (!p) return;
        const sp = randomSpawn();
        p.dead = false;
        p.health = 100;
        p.px = sp.x;
        p.py = 1.7;
        p.pz = sp.z;

        broadcast({
          t: 'spawned',
          d: { id: playerId, px: p.px, py: p.py, pz: p.pz, health: p.health },
        });
        break;
      }

      // ── PING / PONG ────────────────────────────────────────────
      case 'ping': {
        sendTo(ws, { t: 'pong', d: { t: d.t } });
        if (playerId) {
          const p = players.get(playerId);
          if (p) p.lastPing = Date.now();
        }
        break;
      }

      default:
        // Unknown message — ignore silently
        break;
    }
  });

  // ── Disconnect ──────────────────────────────────────────────────
  ws.on('close', () => {
    clearInterval(keepAlive);
    if (playerId) {
      const p = players.get(playerId);
      const name = p ? p.name : '???';
      players.delete(playerId);
      broadcast({ t: 'left', d: { id: playerId } });
      console.log(`[GAME] ${name} left (${playerId}). Online: ${players.size}`);
    }
  });

  ws.on('error', () => {
    // Errors trigger 'close' automatically — no action needed
  });
});

// ── Server Tick — broadcast all player states ─────────────────────
setInterval(() => {
  if (players.size === 0) return;
  const list = [];
  for (const [, p] of players) {
    list.push({
      id: p.id,
      px: p.px, py: p.py, pz: p.pz,
      vx: p.vx, vy: p.vy, vz: p.vz,
      yaw: p.yaw, pitch: p.pitch,
      grounded: p.grounded, crouching: p.crouching,
      health: p.health, dead: p.dead,
      kills: p.kills, deaths: p.deaths,
      ping: 0,
    });
  }
  broadcast({ t: 'update', d: { players: list } });
}, 1000 / TICK_RATE);

// ── Stale connection cleanup (every 60s) ──────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [id, p] of players) {
    if (p.ws.readyState !== WebSocket.OPEN) {
      players.delete(id);
      broadcast({ t: 'left', d: { id } });
      console.log(`[GAME] Cleaned stale connection: ${p.name} (${id})`);
    }
  }
}, 60000);

// ====================================================================
// START SERVER
// ====================================================================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nKRNK server listening on :${PORT}`);
  console.log(`Local:  http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}`);
  console.log(`Public: bound to 0.0.0.0\n`);
});
