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
      cands: arr(r.Candidates?.Candidate).map((c) => ({ name: c.NAME_ON_BALLOT, party: c.PARTY || c.PARTY_ABBREV || '', votes: Number(c.TOTAL ?? c.TOTAL_VOTES) || 0 })),
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
