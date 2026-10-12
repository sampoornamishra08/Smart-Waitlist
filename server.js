// Smart Waitlist backend: a small Node.js server with no extra packages.
// It serves the website (public/index.html) and a few API routes.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'db.json');

// ---- Database: one JSON file holding every visitor's saved data ----
fs.mkdirSync(path.dirname(DATA), { recursive: true });
let db = { visitors: {} };
try { db = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) {}
function persist() {
  const tmp = DATA + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA);
}

// ---- Business logic: the confirmation-chance formula ----
const CLASS_FACTOR = { SL: 1.3, '3A': 1, CC: 0.9, '2A': 0.7 };
function chance(cls, wl, days) {
  const k = CLASS_FACTOR[cls] || 1;
  const p = 100 * Math.exp(-wl / (8 + 1.2 * days)) * k;
  return Math.max(2, Math.min(97, Math.round(p)));
}

// ---- Helpers ----
const send = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const okId = v => typeof v === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(v);
function readBody(req, cb) {
  let b = '';
  req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
  req.on('end', () => { try { cb(JSON.parse(b || '{}')); } catch (e) { cb(null); } });
}

// ---- API routes ----
function api(req, res, u) {
  const r = u.pathname;
  if (r === '/api/health') return send(res, 200, { ok: true });

  if (r === '/api/chance') {
    const c = chance(u.searchParams.get('cls'), +u.searchParams.get('wl') || 1, +u.searchParams.get('days') || 0);
    return send(res, 200, { chance: c });
  }

  if (r === '/api/state') {
    if (req.method === 'GET') {
      const v = u.searchParams.get('vid');
      if (!okId(v)) return send(res, 400, { error: 'bad id' });
      const s = db.visitors[v];
      return s ? send(res, 200, s) : send(res, 404, { error: 'no data yet' });
    }
    if (req.method === 'PUT') {
      return readBody(req, b => {
        if (!b || !okId(b.vid) || !b.state || !Array.isArray(b.state.trips)) return send(res, 400, { error: 'bad body' });
        db.visitors[b.vid] = b.state;
        persist();
        send(res, 200, { ok: true });
      });
    }
    if (req.method === 'DELETE') {
      const v = u.searchParams.get('vid');
      if (!okId(v)) return send(res, 400, { error: 'bad id' });
      delete db.visitors[v];
      persist();
      return send(res, 200, { ok: true });
    }
  }
  send(res, 404, { error: 'not found' });
}

// ---- Static files: serve the website ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname.startsWith('/api/')) return api(req, res, u);
  const p = u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname);
  const f = path.normalize(path.join(ROOT, p));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
});
server.listen(PORT, () => console.log('Smart Waitlist is running at http://localhost:' + PORT));
