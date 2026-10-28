// Howard County Clerk: Electionware "Summary Results Report" HTML export.
//
// The export is a stack of absolutely positioned print pages; every piece of text is a leaf
// <span style="font-family: Roboto ...">. Document order is reading order, so we pull the spans
// out in sequence and walk them with a small state machine. Works whether the report has a single
// TOTAL column (primary) or several (TOTAL, Election Day, Early, Absentee...), and whether party
// sits in the contest title (primary) or beside each candidate (general).

const SPAN_RE = /<span style="font-family: Roboto[^"]*">([^<]*)<\/span>/g;
const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&#39;': "'", '&apos;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>' };

export function extractTokens(html) {
  const out = [];
  let m;
  SPAN_RE.lastIndex = 0;
  while ((m = SPAN_RE.exec(html))) {
    const t = m[1].replace(/&[a-z#0-9]+;/g, (e) => ENTITIES[e] ?? e).replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  }
  return out;
}

const isNum = (s) => typeof s === 'string' && /^-?[\d,]+(\.\d+)?%?$/.test(s);
const isPct = (s) => /%$/.test(s);
const isOf = (s) => typeof s === 'string' && /^\d[\d,]* of \d[\d,]*$/.test(s); // "41 of 78" precinct counts
const toInt = (s) => Number(String(s).replace(/[,%]/g, ''));

export function parseReport(html) {
  const tokens = extractTokens(html);
  if (!tokens.length) throw new Error('No Electionware text found in the clerk report');

  const meta = { election: null, date: null, status: null, jurisdiction: null, reportTime: null };
  const h = tokens.indexOf('Summary Results Report');
  if (h >= 0) [meta.election, meta.date, meta.status, meta.jurisdiction] = tokens.slice(h + 1, h + 5);
  const noise = new Set(['Summary Results Report', meta.election, meta.date, meta.status, meta.jurisdiction].filter(Boolean));

  const statistics = {};
  const contests = [];
  let cur = null;      // contest being read
  let mode = null;     // 'stats' | 'contest' | null
  let headers = ['TOTAL'];

  const readHeaders = (j) => {
    const hs = [];
    while (j < tokens.length && !isNum(tokens[j]) && !isNum(tokens[j + 1]) && !isOf(tokens[j + 1]) && !/^Vote For \d+$/.test(tokens[j + 1] || '')) {
      if (!noise.has(tokens[j])) hs.push(tokens[j]);
      j++;
    }
    return { hs: hs.filter((x) => !/%/.test(x)), j };
  };
  const pick = (nums) => {
    const vals = nums.filter((n) => !isPct(n));
    const idx = Math.max(0, headers.indexOf('TOTAL'));
    return toInt(vals[idx] ?? vals[0]);
  };

  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];

    if (/^Election Summary - /.test(t)) {
      if (!meta.reportTime) {
        const mm = t.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)/i);
        meta.reportTime = mm ? `${mm[1]} ${mm[2]}` : t.replace(/^Election Summary - /, '');
      }
      i += /^of \d+$/.test(tokens[i + 2] || '') ? 3 : 1;
      continue;
    }
    if (noise.has(t) || /^Report generated with Electionware/.test(t)) { i++; continue; }

    if (/^Vote For \d+$/.test(tokens[i + 1] || '')) {
      if (cur) contests.push(cur);
      const mp = t.match(/^(DEM|REP|LIB|GRN|IND)\s+(.*)$/);
      cur = { id: t, party: mp ? mp[1] : null, office: mp ? mp[2] : t, voteFor: toInt(tokens[i + 1].slice(9)), candidates: [], overvotes: 0, undervotes: 0, total: null };
      mode = 'contest';
      const r = readHeaders(i + 2);
      headers = r.hs.length ? r.hs : ['TOTAL'];
      i = r.j;
      continue;
    }
    if (t === 'Statistics') {
      mode = 'stats';
      const r = readHeaders(i + 1);
      headers = r.hs.length ? r.hs : ['TOTAL'];
      i = r.j;
      continue;
    }

    if (mode === 'stats' && isOf(tokens[i + 1])) { statistics[t] = tokens[i + 1]; i += 2; continue; }

    // A label followed by one or more numbers is a row.
    let j = i + 1;
    const nums = [];
    while (j < tokens.length && isNum(tokens[j])) nums.push(tokens[j++]);
    if (!nums.length) { i++; continue; }
    const v = pick(nums);
    if (mode === 'stats') statistics[t] = isPct(nums[0]) ? nums[0] : v;
    else if (mode === 'contest' && cur) {
      if (t === 'Overvotes') cur.overvotes = v;
      else if (t === 'Undervotes') cur.undervotes = v;
      else if (t === 'Total Votes Cast' || /^Write-?in Totals?$/i.test(t)) { /* summary rows, not candidates */ }
      else if (t === 'Contest Totals') { cur.total = v; contests.push(cur); cur = null; mode = null; }
      else cur.candidates.push({ name: t, votes: v });
    }
    i = j;
  }
  if (cur) contests.push(cur);
  return { meta, statistics, contests };
}

// ---------- normalizing into board races ----------

export function titleCase(s) {
  return s.toLowerCase()
    .replace(/(^|[\s(\-'/.])([a-z])/g, (m, p, c) => p + c.toUpperCase())
    .replace(/\bJr\b\.?/g, 'Jr.').replace(/\bIi\b/g, 'II').replace(/\bIii\b/g, 'III')
    .replace(/\bMc([a-z])/g, (m, c) => 'Mc' + c.toUpperCase());
}

const PARTY = { DEM: 'D', DEMOCRATIC: 'D', REP: 'R', REPUBLICAN: 'R', LIB: 'L', LIBERTARIAN: 'L', IND: 'I', INDEPENDENT: 'I', GRN: 'G', WTP: 'WTP', CON: 'C', SOC: 'S' };
function splitParty(name) {
  let m = name.match(/^(.*?)\s*\((DEM|REP|LIB|IND|GRN|D|R|L|I)\)$/i);
  if (m) return [m[1], PARTY[m[2].toUpperCase()] || m[2].toUpperCase()];
  m = name.match(/^(DEM|REP|LIB|IND|GRN|WTP|CON|SOC)\s+(.*)$/);
  if (m) return [m[2], PARTY[m[1]]];
  m = name.match(/^(.*?)\s+-\s+(DEM|REP|LIB|IND|GRN)$/);
  if (m) return [m[1], PARTY[m[2]]];
  return [name, null];
}

const ORD = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth'];
// How to find a clerk contest's whole-district version in the state's feed, or null for county-only offices.
export function districtSpec(rawOffice) {
  let m = rawOffice.match(/^US REPRESENTATIVE DI?ST\.? #?(\d+)/i);
  if (m) { const n = Number(m[1]); return { category: '^US Representative|United States Representative', title: `(District 0*${n}\\b|${ORD[n] || 'none'} District|\\(${n}\\))` }; }
  m = rawOffice.match(/^STATE SENATOR DI?ST\.? #?(\d+)/i);
  if (m) return { category: '^State Senator', title: `District 0*${Number(m[1])}$` };
  m = rawOffice.match(/^STATE REPRESENTATIVE DI?ST\.? #?(\d+)/i);
  if (m) return { category: '^State Representative', title: `District 0*${Number(m[1])}$` };
  return null;
}

function clerkSeat(office) {
  const m = office.match(/^(US REPRESENTATIVE|STATE SENATOR|STATE REPRESENTATIVE) DI?ST\.? #?(\d+)/i);
  if (m) return ({ 'US REPRESENTATIVE': 'CD', 'STATE SENATOR': 'SD', 'STATE REPRESENTATIVE': 'HD' })[m[1].toUpperCase()] + Number(m[2]);
  if (/^SENATOR UNITED STATES|^US SENATOR|^UNITED STATES SENATOR/i.test(office)) return 'USSEN';
  if (/^GOVERNOR/i.test(office)) return 'GOV';
  if (/^ATTORNEY GENERAL/i.test(office)) return 'AG';
  if (/^SECRETARY OF STATE/i.test(office)) return 'SOS';
  if (/TREASURER OF STATE/i.test(office)) return 'TRE';
  if (/COMPTROLLER|AUDITOR OF STATE/i.test(office)) return 'COMP';
  return null;
}

export function levelOf(office) {
  const o = office.toUpperCase();
  if (/^US |PRESIDENT|UNITED STATES|GOVERNOR|SECRETARY OF STATE|TREASURER OF STATE|AUDITOR OF STATE|COMPTROLLER|ATTORNEY GENERAL|CONSTITUTION/.test(o)) return 'Federal and state';
  if (/^STATE (SENATOR|REPRESENTATIVE)/.test(o)) return 'Statehouse';
  if (/TOWNSHIP|TOWN COUNCIL|CLERK-TREASURER|SCHOOL/.test(o)) return 'Township and town';
  return 'County';
}

function prettyOffice(office) {
  return titleCase(office)
    .replace(/^(Dst \d+) (.+)$/, '$2 $1')                 // "DST 1 KOKOMO CENTER SCHOOL BD" -> "... School Bd Dst 1"
    .replace(/\bDi?st\.? #?(\d+)/i, 'District $1')
    .replace(/\bSchool Bd\b/, 'School Board')
    .replace(/ (Indiana|Howard)$/, '')
    .replace(/^Us Representative/, 'U.S. House')
    .replace(/^Senator United States/, 'U.S. Senate')
    .replace(/^State Senator/, 'State Senate')
    .replace(/^State Representative/, 'State House')
    .replace(/^Commissioner/, 'County Commissioner')
    .replace(/^Constitution Amendment/, 'Constitutional Amendment')
    .replace(/^County Council Member At Large/, 'County Council, At Large')
    .replace(/^Town Council Member At Large (.+)$/, '$1 Town Council, At Large')
    .replace(/^Township (Trustee|Board|Assessor) (.+)$/, '$2 Township $1')
    .replace(/^(Town Council|Clerk-Treasurer) (.+)$/, '$2 $1')
    .replace(/District (\d+)/, (m, n) => `District ${Number(n)}`)
    .replace(/^(County Council|County Commissioner|State Senate|State House|U\.S\. House|.+School Board) District/, '$1, District');
}

export function clerkRaces(parsed, config) {
  const parties = config.primaryParties || [];
  const hide = (config.hide || []).map((p) => new RegExp(p, 'i'));
  // Contests the state is covering district-wide (by seat, e.g. SD21), so they don't show twice.
  const replaced = new Set(config.replaceSeats || []);
  const out = [];
  for (const c of parsed.contests) {
    if (c.party && parties.length && !parties.includes(c.party)) continue;
    if (hide.some((re) => re.test(c.id))) continue;
    if (replaced.has(clerkSeat(c.office))) continue;
    const cands = c.candidates
      .filter((k) => !/^NO CANDIDATE FILED$/i.test(k.name) && !/^Write-?in/i.test(k.name))
      .map((k) => {
        const [raw, party] = splitParty(k.name);
        return { name: config.candidates?.[raw] || titleCase(raw), party: party || (c.party ? PARTY[c.party] : ''), votes: k.votes };
      });
    if (cands.length <= c.voteFor) continue; // unopposed: never shown
    const level = levelOf(c.office);
    out.push({
      id: 'clerk:' + c.id,
      source: 'clerk',
      rawOffice: c.office,
      office: config.names?.[c.id] || prettyOffice(c.office),
      level,
      // Federal and legislative districts reach past Howard County; the clerk only counts Howard's share.
      partial: level === 'Federal and state' || level === 'Statehouse',
      seat: clerkSeat(c.office),
      voteFor: c.voteFor,
      cands,
    });
  }
  return out;
}

const ofPair = (v) => { const m = typeof v === 'string' && v.match(/^([\d,]+) of ([\d,]+)$/); return m ? { n: toInt(m[1]), of: toInt(m[2]) } : null; };

export function clerkMeta(parsed) {
  const s = parsed.statistics || {};
  const num = (k) => (typeof s[k] === 'number' ? s[k] : null);
  return {
    election: parsed.meta.election,
    status: parsed.meta.status,
    reportTime: parsed.meta.reportTime,
    ballotsCast: num('Ballots Cast - Total'),
    registered: num('Registered Voters - Total'),
    precincts: ofPair(s['Election Day Precincts Reporting'] || s['Precincts Reporting']),
    earlyPrecincts: ofPair(s['Absentee/ Early Precincts Reporting'] || s['Absentee/Early Precincts Reporting']),
  };
}
