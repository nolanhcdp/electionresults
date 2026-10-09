import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseReport, clerkRaces, clerkMeta } from '../lib/clerk.js';
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
  const races = clerkRaces(parseReport(html), config);
  assert.ok(races.length > 0);
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
