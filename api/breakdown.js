// GET /api/breakdown?id=87139          — one race's results county by county, from civicAPI.
// GET /api/breakdown?id=87139&map=1    — civicAPI's county map of the race, as an SVG image.
// ?test=1 uses civicAPI's practice numbers.
import { breakdown, civicGet } from '../lib/civicapi.js';

// The map is shown with <img>, which never runs scripts, but strip anything active anyway in case it's opened directly.
const clean = (svg) => String(svg)
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
  .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  .replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, '$1#');

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const id = String(url.searchParams.get('id') || '');
  if (!/^\d{1,9}$/.test(id)) return res.status(400).json({ error: 'Which race?' });
  const test = url.searchParams.get('test') === '1';
  try {
    if (url.searchParams.get('map') === '1') {
      const svg = await civicGet(`race/${id}?generateMap&format=percentage${test ? '&testdata' : ''}`, { raw: true, ttl: 60_000 });
      if (!/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg)) throw new Error('No map for this race');
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=120');
      return res.status(200).end(clean(svg));
    }
    const b = await breakdown(id, { testdata: test });
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
    return res.status(200).json(b);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: String(err.message || err) });
  }
}
