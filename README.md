# HCDP Election Night

Live results board for the Howard County Democratic Party's election night HQ: a TV view for the room, a phone view anyone can open, and a control page for HQ.

**Live:** (fill in after first deploy) · **TV:** `/tv` · **Control:** `/control`

## Pages
- `/` — phone view with two tabs. **Howard County**: pinned races first, then each person's starred races (kept on their phone), then everything by level. **Around Indiana**: every contested statewide office, U.S. House, State Senate, and State House race in the state, plus statewide ballot questions. Search, filters, and stars work on both.
- `/tv` — the TV. Pinned races stay put on the left; every other race rotates through slides on the right. Text sizes itself so nothing clips. Four or more pinned slots (a township board counts as two) switches to a wider pinned block; nothing pinned gives the rotation the whole screen. Hit "Full screen" once; the buttons and cursor hide after a few seconds.
- `/early-vote` — Howard County early vote tracker. A static, self-contained page (data built in) rebuilt from the daily VAN report by Claude and dropped into `public/early-vote.html`; redeploy to publish. Not indexed by search engines; linked from the home page footer.
- `/control` — HQ only (code login). Pin and unpin races, push a message to every screen, set slide timing and width, enter registered voters and expected ballots, add a race from the state's results or type one in by hand, and update hand-entered numbers. Includes a live TV preview.

## Where the numbers come from
- **Howard County Clerk** (`lib/clerk.js`): the Electionware summary report. Parsed from its print-layout HTML. Handles the primary layout (party in the contest title, one TOTAL column) and the general layout (party beside each candidate, several columns). Unopposed races and precinct committee / convention delegate races never show. Any U.S. House, State Senate, or State House race on the clerk's report is swapped for its whole-district version from the state; if the state hasn't posted it yet, the clerk's numbers show labeled "Howard County only".
- **Indiana Secretary of State** (`lib/enr.js`): the JSON behind enr.indianavoters.in.gov. Used for whole-district totals on the races listed in `stateRaces` in `lib/config.js` (CD5, SD21, HD30, HD38, Secretary of State, Treasurer, Comptroller), plus anything added from /control. Races are found by name each time because the state renumbers its categories every election. Until the state posts a race, the clerk's Howard-only numbers stay up.
- **HQ** (`/control`): pins, the message bar, slide settings, ballots, added races. Stored in Upstash under `KV_PREFIX:state`.

If either site stops answering, the board keeps showing the last good numbers.

## Files
- `public/` — `index.html` (phone), `tv.html`, `control.html`, shared `board.js` and `board.css`.
- `api/results.js` — every race with live totals. Cached at Vercel's edge for 30 seconds.
- `api/state.js` — GET (public) the HQ settings; POST (control login) changes them.
- `api/indiana.js` — the Around Indiana list (cached for a minute).
- `api/login.js`, `api/enr.js` — control login; the state's office/race lists for "Add a race".
- `lib/config.js` — clerk URL, which races come from the state, display names, spelling fixes, defaults.

## Settings (names only — values live in Vercel and `.env.local`)
`ADMIN_CODE`, `SESSION_SECRET`, `KV_PREFIX`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, optional `CLERK_URL`

## Deploy
1. Push this repo to GitHub; import it in Vercel (framework preset: Other). No build step.
2. Add the environment variables above. The early-vote app's Upstash database works fine with `KV_PREFIX=en2026`.
3. Open `/control`, log in, and check the race list.

## Before election night
- Put the clerk's general-election results URL in `clerkUrl` in `lib/config.js` (or set `CLERK_URL` in Vercel) as soon as the clerk posts the zero-results version. Check `/control`: the header line says whether the clerk and state are connected and how many state races haven't posted yet.
- Check the race names and candidate spellings on `/`. Fix names in `names` and spellings in `candidates` in `lib/config.js`.
- Set registered voters and your expected ballot total on `/control`.

## Local run (no Upstash needed)
```
npm install
MEMORY_DB=1 ADMIN_CODE=admin SESSION_SECRET=dev FIXTURE=1 node scripts/dev-server.mjs
```
Then http://localhost:3124, `/tv`, and `/control` (code `admin`). `FIXTURE=1` reads the saved May primary report instead of the clerk's live page; drop it to use the live page. `npm test` runs the clerk parser tests.

## Later
- What "percent of ballots cast" should mean is still open; the board shows turnout (ballots ÷ registered) and share of the expected vote for now.
- Board races show each candidate's share of all votes cast in the race (so three-seat races read in the teens). Switching to share of voters needs ballots-per-race from the clerk.
