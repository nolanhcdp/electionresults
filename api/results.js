// GET /api/results — every race the board can show, from the clerk and the state, with live totals.
// Cached at Vercel's edge for pollSeconds, so a room full of phones reaches the clerk and state at most once per interval.
import { buildResults } from '../lib/races.js';
import { getState, defaultState } from '../lib/db.js';

export default async function handler(req, res) {
  let state;
  try { state = await getState(); } catch { state = defaultState(); }
  try {
    const body = await buildResults(state);
    res.setHeader('Cache-Control', `public, s-maxage=${body.pollSeconds}, stale-while-revalidate=120`);
    return res.status(200).json(body);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: String(err.message || err) });
  }
}
