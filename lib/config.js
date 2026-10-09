// Everything about *which* races show and *what they're called* lives here.
// Live, night-of changes (pins, the HQ message, added races) happen on /control instead.

export default {
  // Howard County Clerk's Electionware summary report. Swap to the general-election URL when the clerk posts it.
  // Can also be overridden in Vercel with the CLERK_URL environment variable.
  clerkUrl: 'https://www.in.gov/counties/howard/files/upl/elections/2026/primary/results.html',

  // Indiana Secretary of State election night reporting data folder.
  enrBase: 'https://enr.indianavoters.in.gov/site/data/',

  // Primary reports prefix each contest with its party. Only these parties' contests are shown.
  // The general-election report has no prefix, so this is ignored there.
  primaryParties: ['DEM'],

  // Clerk contests to leave off entirely (matched against the clerk's contest title).
  hide: ['CONVENTION DELEGATE', 'PRECINCT COMMITTEE'],

  // Races shown with whole-district totals from the state's feed instead of the clerk's Howard-only numbers.
  // category / title are matched (case-insensitive regex) against the state's category and race names.
  // replaces drops the matching clerk contest once the state has the race, so it doesn't show twice.
  // Until the state posts a race, the clerk's Howard-only numbers stay up.
  stateRaces: [
    { key: 'cd5', name: 'U.S. House, District 5', level: 'Federal and state', category: '^US Representative|United States Representative', title: '(District 0?5\\b|Fifth District|\\(5\\))', replaces: 'US REPRESENTATIVE DIST #5' },
    { key: 'sos', name: 'Secretary of State', level: 'Federal and state', category: '^Secretary of State', title: '^Secretary of State', replaces: 'SECRETARY OF STATE' },
    { key: 'treas', name: 'State Treasurer', level: 'Federal and state', category: '^Treasurer of State|^State Treasurer', title: '^Treasurer of State|^State Treasurer', replaces: 'TREASURER OF STATE' },
    { key: 'comp', name: 'State Comptroller', level: 'Federal and state', category: '^Comptroller|^State Comptroller|^Auditor of State', title: '^Comptroller|^State Comptroller|^Auditor of State', replaces: 'COMPTROLLER|AUDITOR OF STATE' },
    { key: 'ss21', name: 'State Senate, District 21', level: 'Statehouse', category: '^State Senator', title: 'District 0?21$', replaces: 'STATE SENATOR DIST #21' },
    { key: 'sh30', name: 'State House, District 30', level: 'Statehouse', category: '^State Representative', title: 'District 0?30$', replaces: 'STATE REPRESENTATIVE DIST #30' },
    { key: 'sh38', name: 'State House, District 38', level: 'Statehouse', category: '^State Representative', title: 'District 0?38$', replaces: 'STATE REPRESENTATIVE DIST #38' },
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
