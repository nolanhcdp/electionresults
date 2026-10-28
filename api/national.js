// GET /api/national — the FLIPR forecast for every tracked House and Senate race plus live results from civicAPI.
// Behind a code (the Control code, or NATIONAL_CODE if set) because the forecast is from a paid newsletter.
// ?test=1 (or NATIONAL_SHOW_TEST=1) shows civicAPI's test data, clearly labeled, to check the page before Nov. 3.
import { canSeeNational } from '../lib/auth.js';
import { FORECAST, loadCivic, shape } from '../lib/civic.js';

let cache = null; // { at, map, missing, error }
const FRESH_MS = 45_000;

async function civic() {
  if (cache && Date.now() - cache.at < FRESH_MS) return cache;
  try {
    const { map, missing } = await loadCivic();
    cache = { at: Date.now(), map, missing, error: null };
  } catch (err) {
    // Keep the last good results if civicAPI hiccups.
    cache = { at: Date.now(), map: cache?.map || new Map(), missing: cache?.missing || [], error: String(err.message || err) };
  }
  return cache;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!canSeeNational(req)) return res.status(401).json({ error: 'Enter the code to see this page.' });

  const url = new URL(req.url, 'http://x');
  const showTest = url.searchParams.get('test') === '1' || process.env.NATIONAL_SHOW_TEST === '1';
  const c = await civic();

  const withRes = (list, prefix) => list.map((x) => ({ ...x, res: shape(x, c.map.get(prefix + x.id), { showTest }) }));
  const house = withRes(FORECAST.house, 'H:');
  const senate = withRes(FORECAST.senate, 'S:');
  const all = [...house, ...senate];

  return res.status(200).json({
    asOf: FORECAST.asOf,
    control: FORECAST.control,
    senateHoldover: FORECAST.senateHoldover,
    houseNow: FORECAST.houseNow,
    house,
    senate,
    showTest,
    anyResults: all.some((x) => x.res),
    source: { ok: !c.error, error: c.error, checkedAt: new Date(c.at).toISOString(), matched: c.map.size, missing: c.missing },
  });
}
