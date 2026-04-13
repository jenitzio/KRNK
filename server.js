// ====================================================================
// KRNK.js — Static File Server (Render-Ready)
// ====================================================================
// Serves the index.html game client as a static file.
// Render auto-injects the PORT environment variable.
// ====================================================================

const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Security & Performance Headers ────────────────────────────────────
app.use((req, res, next) => {
  // Allow SharedArrayBuffer / high-res timers (needed for precise game loops)
  res.setHeader('Cross-Origin-Opener-Policy',   'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy',  'require-corp');

  // Cache static assets aggressively, HTML never
  if (req.path.match(/\.(js|css|png|jpg|svg|woff2?|ttf|ico)$/)) {
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day
  } else {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }

  next();
});

// ── Serve the /public directory as static files ───────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],       // auto-resolve .html extensions
  index:      'index.html',   // default file for /
}));

// ── Fallback: serve index.html for any unmatched route ────────────────
// (useful if you ever add client-side routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║   KRNK.js server listening on :${PORT}   ║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
  console.log(`  → Local:   http://localhost:${PORT}`);
  console.log(`  → Public:  bound to 0.0.0.0 (all interfaces)\n`);
});
