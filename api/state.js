// GET  /api/state  — what HQ has set: pins, the message bar, slide settings, added races. Public.
// POST /api/state  — change it. Control page only (signed admin cookie).
import { getState, saveState } from '../lib/db.js';
import { isAdmin } from '../lib/auth.js';

const LEVELS = ['Federal and state', 'Statehouse', 'County', 'Township and town'];
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v) => { const n = Math.round(Number(String(v ?? '').replace(/[^0-9.-]/g, ''))); return Number.isFinite(n) && n >= 0 ? n : 0; };
const nullableInt = (v) => (v === null || v === '' || v === undefined ? null : int(v));

function apply(s, b) {
  switch (b.op) {
    case 'pin': {
      const id = str(b.id, 300);
      if (!id) throw new Error('Which race?');
      if (b.on) { if (!s.pinned.includes(id)) s.pinned.push(id); }
      else s.pinned = s.pinned.filter((x) => x !== id);
      return;
    }
    case 'ticker': {
      const text = str(b.text, 200);
      s.ticker = text ? { text, at: new Date().toISOString() } : null;
      return;
    }
    case 'settings': {
      if ('slideSeconds' in b) s.slideSeconds = Math.min(60, Math.max(5, int(b.slideSeconds)));
      if ('slideColumns' in b) s.slideColumns = int(b.slideColumns) === 1 ? 1 : 2;
      if ('tickerPos' in b) s.tickerPos = b.tickerPos === 'top' ? 'top' : 'bottom';
      if ('registered' in b) s.registered = nullableInt(b.registered);
      if ('expected' in b) s.expected = nullableInt(b.expected);
      return;
    }
    case 'addState': {
      const categoryId = str(b.categoryId, 20), officeId = str(b.officeId, 20);
      if (!categoryId || !officeId) throw new Error('Pick a race from the list.');
      const id = `state:${categoryId}:${officeId}`;
      if (!s.addedState.some((a) => a.id === id)) s.addedState.push({ id, categoryId, officeId, name: str(b.name, 120) || 'Added race', level: LEVELS.includes(b.level) ? b.level : 'Statehouse' });
      return;
    }
    case 'addHand': {
      const office = str(b.office, 120);
      const voteFor = Math.min(9, Math.max(1, int(b.voteFor) || 1));
      const cands = (Array.isArray(b.cands) ? b.cands : []).slice(0, 20)
        .map((c) => ({ name: str(c.name, 80), party: str(c.party, 3).toUpperCase(), votes: int(c.votes) })).filter((c) => c.name);
      if (!office) throw new Error('Give the race an office name.');
      if (cands.length <= voteFor) throw new Error(`Add at least ${voteFor + 1} candidates so the race is contested.`);
      s.hand.push({ id: `hand:${Date.now().toString(36)}`, office, level: LEVELS.includes(b.level) ? b.level : 'County', voteFor, cands, updatedAt: new Date().toISOString() });
      return;
    }
    case 'handVotes': {
      const r = s.hand.find((h) => h.id === b.id);
      if (!r) throw new Error('That race is gone.');
      (Array.isArray(b.votes) ? b.votes : []).forEach((v, i) => { if (r.cands[i]) r.cands[i].votes = int(v); });
      r.updatedAt = new Date().toISOString();
      return;
    }
    case 'remove': {
      const id = str(b.id, 300);
      s.hand = s.hand.filter((h) => h.id !== id);
      s.addedState = s.addedState.filter((a) => a.id !== id);
      s.pinned = s.pinned.filter((x) => x !== id);
      return;
    }
    default: throw new Error('Unknown change.');
  }
}

async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  let raw = ''; for await (const c of req) raw += c; return JSON.parse(raw || '{}');
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'public, s-maxage=2, stale-while-revalidate=10');
      return res.status(200).json(await getState());
    }
    if (req.method === 'POST') {
      if (!isAdmin(req)) return res.status(401).json({ error: 'Log in on the control page first.' });
      const s = await getState();
      apply(s, await body(req));
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(await saveState(s));
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(400).json({ error: String(err.message || err) });
  }
}
