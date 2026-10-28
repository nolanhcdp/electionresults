import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseReport, clerkRaces, clerkMeta, districtSpec } from '../lib/clerk.js';
import config from '../lib/config.js';

const html = readFileSync(new URL('./fixtures/primary-2026.html', import.meta.url), 'utf8');

test('parses the May 2026 primary report', () => {
  const r = parseReport(html);
  assert.equal(r.contests.length, 103);
  assert.equal(r.meta.reportTime, '05/05/2026 8:00 PM');
  assert.equal(r.statistics['Ballots Cast - Total'], 10555);
  for (const c of r.contests) {
    const sum = c.candidates.reduce((a, k) => a + k.votes, 0) + c.overvotes + c.undervotes;
    assert.equal(sum, c.total, c.id);
  }
});

test('builds board races: our party only, no unopposed, state races removed', () => {
  const races = clerkRaces(parseReport(html), { ...config, replaceSeats: ['SD21', 'CD5'], hide: config.hide.filter((h) => !/ST.*4/.test(h)) });
  assert.ok(races.length > 0);
  const cd4 = races.find((r) => r.id === 'clerk:DEM US REPRESENTATIVE DIST #4');
  assert.equal(cd4.partial, true, 'multi-county race from the clerk is marked Howard-only');
  assert.deepEqual(districtSpec(cd4.rawOffice).category, '^US Representative|United States Representative');
  assert.equal(districtSpec('COUNTY COUNCIL DIST 3'), null);
  assert.ok(races.every((r) => r.cands.length > r.voteFor));
  assert.ok(!races.some((r) => /STATE SENATOR DIST #21|US REPRESENTATIVE DIST #5/.test(r.id)));
  assert.ok(!races.some((r) => /^clerk:REP /.test(r.id)));
  const pc = races.find((r) => r.id === 'clerk:DEM PRECINCT COMMITTEEMAN 207');
  assert.equal(pc, undefined, 'precinct committee races are hidden');
  const board = races.find((r) => r.id === 'clerk:DEM TOWNSHIP BOARD TAYLOR');
  assert.equal(board, undefined, 'two candidates for three seats is unopposed');
  assert.deepEqual(clerkMeta(parseReport(html)).ballotsCast, 10555);
});

test('handles a multi-column general-election style report with party beside each name', () => {
  const span = (t) => `<span style="font-family: Roboto Condensed; font-size: 8px;">${t}</span>`;
  const g = ['Summary Results Report', 'General Election', 'November 3, 2026', 'UNOFFICIAL RESULTS', 'Howard County, IN',
    'Statistics', 'TOTAL', 'Election Day', 'Absentee', 'Registered Voters - Total', '61,234', '0', '0', 'Ballots Cast - Total', '20,111', '12,000', '8,111',
    'COUNTY COUNCIL DIST 3', 'Vote For 1', 'TOTAL', 'VOTE %', 'Election Day', 'Absentee',
    'Cathy Stover (DEM)', '2,510', '51.33%', '1,500', '1,010',
    'Somebody Else (REP)', '2,380', '48.67%', '1,400', '980',
    'Overvotes', '0', '0', '0', 'Undervotes', '96', '50', '46', 'Contest Totals', '4,986', '2,950', '2,036',
    'Election Summary - 11/03/2026 9:14 PM', '1', 'of 1'].map(span).join('\n');
  const p = parseReport(g);
  assert.equal(p.statistics['Registered Voters - Total'], 61234);
  assert.equal(p.statistics['Ballots Cast - Total'], 20111);
  const races = clerkRaces(p, { ...config, stateRaces: [] });
  assert.equal(races.length, 1);
  assert.equal(races[0].office, 'County Council, District 3');
  assert.deepEqual(races[0].cands.map((c) => [c.name, c.party, c.votes]), [['Cathy Stover', 'D', 2510], ['Somebody Else', 'R', 2380]]);
  assert.equal(clerkMeta(p).reportTime, '11/03/2026 9:14 PM');
});

test('reads the November 2024 general report the way it will look on election night', () => {
  const g = parseReport(readFileSync(new URL('./fixtures/general-2024.html', import.meta.url), 'utf8'));
  const meta = clerkMeta(g);
  assert.equal(meta.election, 'General Election');
  assert.equal(meta.registered, 61323);
  assert.equal(meta.ballotsCast, 38218);
  assert.deepEqual(meta.precincts, { n: 78, of: 78 });
  for (const c of g.contests) {
    assert.ok(!c.candidates.some((k) => /Total Votes Cast|Write-In Totals/i.test(k.name)), c.id);
    const sum = c.candidates.reduce((a, k) => a + k.votes, 0) + c.overvotes + c.undervotes;
    const writeIns = c.total - sum; // write-in totals are counted in the contest but not shown as a candidate
    assert.ok(writeIns >= 0 && writeIns < 200, `${c.id}: off by ${writeIns}`);
  }
  const races = clerkRaces(g, config);
  const byOffice = Object.fromEntries(races.map((r) => [r.office, r]));
  assert.ok(!races.some((r) => /Straight Party|Retain/i.test(r.office)));
  assert.ok(!races.some((r) => r.seat === 'CD4'));
  const cd5 = races.find((r) => r.seat === 'CD5');
  assert.equal(cd5.office, 'U.S. House, District 5');
  assert.equal(cd5.partial, true);
  assert.deepEqual(cd5.cands.map((c) => [c.name, c.party]).slice(0, 2), [['Victoria Spartz', 'R'], ['Deborah A Pickett', 'D']]);
  assert.equal(byOffice['State House, District 30'].seat, 'HD30');
  assert.equal(byOffice['County Treasurer'].cands.length, 2);
  assert.equal(byOffice['County Council, At Large'].voteFor, 3);
  assert.ok(byOffice['Kokomo Center School Board, District 3']);
  assert.ok(!byOffice['State Senate, District 18'], 'unopposed is dropped');
  // Once the state has the district-wide versions, the clerk's Howard-only copies drop out.
  const withState = clerkRaces(g, { ...config, replaceSeats: ['CD5', 'HD30', 'HD38'] });
  assert.ok(!withState.some((r) => ['CD5', 'HD30', 'HD38'].includes(r.seat)));
});
