// Everything about *which* races show and *what they're called* lives here.
// Live, night-of changes (pins, the HQ message, added races) happen on /control instead.

export default {
  // Howard County Clerk's Electionware summary report. Swap to the general-election URL when the clerk posts it.
  // Can also be overridden in Vercel with the CLERK_URL environment variable.
  clerkUrl: process.env.CLERK_URL || 'https://www.in.gov/counties/howard/files/upl/elections/2026/primary/results.html',

  // Election day. The Around Indiana tab switches from the candidate list to live state results once the
  // state's site is showing this election.
  electionDate: process.env.ELECTION_DATE || '11/03/2026',

  // Indiana Secretary of State election night reporting data folder.
  enrBase: process.env.ENR_BASE || 'https://enr.indianavoters.in.gov/site/data/',

  // Primary reports prefix each contest with its party. Only these parties' contests are shown.
  // The general-election report has no prefix, so this is ignored there.
  primaryParties: ['DEM'],

  // Clerk contests to leave off entirely (matched against the clerk's contest title).
  // Straight-party and judge-retention votes are left off too.
  hide: ['CONVENTION DELEGATE', 'PRECINCT COMMITTEE', 'US REPRESENTATIVE DI?ST\\.? #?4\\b', '^STRAIGHT PARTY', '^RETAIN '],

  // Races on the Howard board that show whole-district totals from the state instead of the clerk's Howard-only count.
  // Any other U.S. House, State Senate, or State House race on the clerk's report is swapped for its state version
  // automatically; these just give the main ones a fixed name and id (used for default pins).
  stateRaces: [
    { key: 'cd5', seat: 'CD5', name: 'U.S. House, District 5', level: 'Federal and state' },
    { key: 'sos', seat: 'SOS', name: 'Secretary of State', level: 'Federal and state' },
    { key: 'treas', seat: 'TRE', name: 'State Treasurer', level: 'Federal and state' },
    { key: 'comp', seat: 'COMP', name: 'State Comptroller', level: 'Federal and state' },
    { key: 'ss21', seat: 'SD21', name: 'State Senate, District 21', level: 'Statehouse' },
    { key: 'sh30', seat: 'HD30', name: 'State House, District 30', level: 'Statehouse' },
    { key: 'sh38', seat: 'HD38', name: 'State House, District 38', level: 'Statehouse' },
  ],

  // Display names for clerk contests, keyed by the clerk's exact title. Anything not listed is tidied automatically.
  names: {
    'DEM COMMISSIONER DIST #1': 'County Commissioner, District 1',
    'COMMISSIONER DIST #1': 'County Commissioner, District 1',
  },

  // Candidate spelling fixes, keyed by the clerk's spelling.
  candidates: {
    'KRISTEN ROOT': 'Kirsten Root',
    'J.D. FORD': 'J.D. Ford',
    'KALLAHAN MICHAEL SCOTT BEATTY KAL': 'Kal Beatty',
    'MERCEDES MERC LAHR': 'Mercedes (Merc) Lahr',
    'DEBORAH K ERVIN ASBERRY': 'Deborah K. Ervin-Asberry',
  },

  // What /control starts with before anyone changes anything.
  defaults: {
    pinned: ['state:ss21', 'state:cd5'],
    slideSeconds: 12,
    slideColumns: 2,
    tickerPos: 'bottom',
  },

  // How often the board re-checks. The state's feed itself refreshes every 2 minutes.
  pollSeconds: 30,
};
