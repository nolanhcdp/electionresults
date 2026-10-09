// Indiana Secretary of State election night reporting (enr.indianavoters.in.gov).
//
// The public site is an Angular app reading plain JSON files from /site/data/:
//   settings.json                         -> VersionType (file suffix), ElectionType (P/G), refresh interval
//   statewideElectionsC_<v>.json          -> office categories (id + name), e.g. 1018 "State Senator"
//   OffCatC_<categoryId>_<v>.json         -> every race in that category with district-wide candidate totals
// Category ids change between elections, so races are looked up by name every time.

const TTL = 60_000; // the state refreshes every 2 minutes; checking every minute is plenty
const cache = new Map();

async function getJson(base, name) {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const r = await fetch(base + name, { headers: { 'cache-control': 'no-cache', 'user-agent': 'hcdp-election-night/1.0' } });
  if (!r.ok) throw new Error(`State results file ${name} answered ${r.status}`);
  const j = await r.json();
  const data = j.Root || j;
  cache.set(name, { at: Date.now(), data });
  return data;
}

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

export async function enrSettings(base) {
  const s = await getJson(base, 'settings.json');
  return { suffix: s.VersionType || 'A', electionType: s.ElectionType, election: s.CurrentElection, certified: s.Certified === 'T', writeTime: s.WriteTime };
}

export async function enrCategories(base) {
  const s = await enrSettings(base);
  const el = await getJson(base, `statewideElectionsC_${s.suffix}.json`);
  const cats = [];
  for (const h of arr(el.List)) for (const it of arr(h.Items?.Item)) cats.push({ id: String(it.OFFICECATEGORYID), name: it.OFFICE_CATEGORY_NAME, group: h.Heading });
  return { settings: s, cats };
}

export async function enrCategoryRaces(base, catId) {
  const s = await enrSettings(base);
  const j = await getJson(base, `OffCatC_${catId}_${s.suffix}.json`);
  return {
    writeTime: j.WriteTime,
    races: arr(j.StatewideSummary?.Race).map((r) => ({
      officeId: String(r.OFFICEID),
      title: r.OFFICE_TITLE,
      seats: Number(r.NumofSeats) || 1,
      // Write-ins are dropped, so a race with only a write-in opponent counts as unopposed.
      cands: arr(r.Candidates?.Candidate)
        .filter((c) => !/\(W\/I\)|write-?in/i.test(c.NAME_ON_BALLOT || ''))
        .map((c) => ({ name: String(c.NAME_ON_BALLOT).replace(/\s+/g, ' ').trim(), party: c.PARTY || c.PARTY_ABBREV || '', votes: Number(c.TOTAL ?? c.TOTAL_VOTES) || 0 })),
    })),
  };
}

// spec: { category: regex, title: regex } or { categoryId, officeId }
export async function findStateRace(base, spec) {
  const { settings, cats } = await enrCategories(base);
  const tryCats = spec.categoryId ? cats.filter((c) => c.id === String(spec.categoryId)) : cats.filter((c) => new RegExp(spec.category, 'i').test(c.name));
  for (const c of tryCats) {
    const { races, writeTime } = await enrCategoryRaces(base, c.id);
    const hit = spec.officeId ? races.find((r) => r.officeId === String(spec.officeId)) : races.find((r) => new RegExp(spec.title, 'i').test(r.title));
    if (hit) return { ...hit, categoryId: c.id, writeTime, settings };
  }
  return null;
}

// Statewide ballot questions (constitutional amendments). The state lists one row per county; add them up.
// Judicial retention votes are left out: nobody runs against a judge, so they're effectively unopposed.
export async function enrQuestions(base) {
  const s = await enrSettings(base);
  let j;
  try { j = await getJson(base, `statewideTickerR_${s.suffix}.json`); } catch { return []; }
  const byId = new Map();
  for (const row of arr(j.ElectionSummaries?.Question)) {
    for (const q of arr(row.Questions?.Referendum)) {
      if (!/Constitutional Amendment/i.test(q.REFERENDUM_TYPE_NAME || '')) continue;
      const id = String(row.REFERENDUMID);
      const cur = byId.get(id) || { id, title: q.REFERENDUM_TITLE, text: q.REFERENDUM_TEXT, yes: 0, no: 0 };
      cur.yes += Number(q.YES_VOTES) || 0;
      cur.no += Number(q.NO_VOTES) || 0;
      byId.set(id, cur);
    }
  }
  return [...byId.values()];
}

// A stable name for a seat that reads the same in the candidate list, the primary data, and election-night data:
// CD5, SD21, HD30, SOS, TRE, COMP, GOV, AG, USSEN.
const ORDS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9 };
export function seatKey(title) {
  const t = String(title || '');
  const num = () => { const m = t.match(/District 0*(\d+)/i) || t.match(/\((\d+)\)/); if (m) return Number(m[1]); const w = t.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\b/i); return w ? ORDS[w[1].toLowerCase()] : null; };
  if (/United States Representative|^US Representative/i.test(t)) return 'CD' + num();
  if (/^State Senator/i.test(t)) return 'SD' + num();
  if (/^State Representative/i.test(t)) return 'HD' + num();
  if (/^Secretary of State/i.test(t)) return 'SOS';
  if (/Treasurer of State|^State Treasurer/i.test(t)) return 'TRE';
  if (/Comptroller|Auditor of State/i.test(t)) return 'COMP';
  if (/^Governor/i.test(t)) return 'GOV';
  if (/^Attorney General/i.test(t)) return 'AG';
  if (/United States Senator|^US Senator/i.test(t)) return 'USSEN';
  return t.toUpperCase();
}

const STATE_OFFICES = /^(US Representative|United States Representative|State Senator|State Representative|Governor|Attorney General|Secretary of State|Treasurer of State|State Treasurer|Comptroller|State Comptroller|Auditor of State|US Senator|United States Senator)/i;
export async function findBySeat(base, seat) {
  const { settings, cats } = await enrCategories(base);
  for (const c of cats.filter((x) => STATE_OFFICES.test(x.name))) {
    const { races } = await enrCategoryRaces(base, c.id);
    const hit = races.find((r) => seatKey(r.title) === seat);
    if (hit) return { ...hit, categoryId: c.id, settings };
  }
  return null;
}
