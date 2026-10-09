// Local run without Vercel:  MEMORY_DB=1 ADMIN_CODE=admin SESSION_SECRET=dev node scripts/dev-server.mjs
// Add FIXTURE=1 to read the saved May primary report instead of the clerk's live page.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 3124);
if (process.env.FIXTURE) process.env.CLERK_URL = `http://localhost:${port}/__fixture`;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname === '/__fixture') { res.setHeader('Content-Type', 'text/html'); return res.end(readFileSync(join(root, 'test/fixtures/primary-2026.html'))); }
  const api = url.pathname.match(/^\/api\/([a-z]+)$/);
  if (api && existsSync(join(root, 'api', api[1] + '.js'))) {
    let raw = ''; for await (const c of req) raw += c;
    try { req.body = raw ? JSON.parse(raw) : undefined; } catch { req.body = raw; }
    const shim = Object.assign(res, {
      status(c) { res.statusCode = c; return shim; },
      json(o) { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); },
    });
    // Secure cookies don't stick on plain http://localhost, so drop the flag locally.
    const set = res.setHeader.bind(res);
    res.setHeader = (k, v) => set(k, k.toLowerCase() === 'set-cookie' ? String(v).replace('; Secure', '') : v);
    const mod = await import(pathToFileURL(join(root, 'api', api[1] + '.js')).href);
    try { return await mod.default(req, shim); } catch (e) { res.statusCode = 500; return res.end(String(e.stack || e)); }
  }
  let p = join(root, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!existsSync(p) && existsSync(p + '.html')) p += '.html';
  if (!existsSync(p) || statSync(p).isDirectory()) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', types[extname(p)] || 'application/octet-stream');
  res.end(readFileSync(p));
}).listen(port, () => console.log(`Election night board on http://localhost:${port}  (TV: /tv, control: /control)${process.env.FIXTURE ? '  [primary fixture]' : ''}`));
