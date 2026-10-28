// GET /api/timeline?id=87139 — how a race's count moved over the night, from civicAPI's snapshots.
import { timeline } from '../lib/civicapi.js';

export default async function handler(req, res) {
  const id = String(new URL(req.url, 'http://x').searchParams.get('id') || '');
  if (!/^\d{1,9}$/.test(id)) return res.status(400).json({ error: 'Which race?' });
  try {
    const t = await timeline(id);
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json(t);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: String(err.message || err) });
  }
}
