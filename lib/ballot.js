// Who is on Indiana's November 2026 ballot for statewide, congressional, and legislative seats.
// From the Indiana Election Division's "2026 General Election Candidate List" (posted Sept 22, 2026,
// in.gov/sos/elections/candidate-information), so it includes nominees picked by caucus after the primary.
// Write-ins are already removed. Refresh by re-downloading that list if the Election Division posts a newer one.
import { readFileSync } from 'node:fs';
import { seatKey } from './enr.js';

const raw = JSON.parse(readFileSync(new URL('./ballot-2026.json', import.meta.url), 'utf8'));

export const BALLOT = Object.entries(raw).map(([title, cands]) => ({
  title,
  seat: seatKey(title),
  cands: cands.map(([name, party]) => ({ name, party })),
}));

// Contested in November = a Democrat and a Republican are both on the ballot.
export const isContested = (cands) => cands.some((c) => c.party === 'D') && cands.some((c) => c.party === 'R');

export const contestedSeats = () => new Set(BALLOT.filter((b) => isContested(b.cands)).map((b) => b.seat));

export const GROUP_OF = (seat) => (/^CD/.test(seat) ? 'Congress' : /^SD/.test(seat) ? 'State Senate' : /^HD/.test(seat) ? 'State House' : 'Statewide');
const STATEWIDE_NAMES = { SOS: 'Secretary of State', TRE: 'State Treasurer', COMP: 'State Comptroller', GOV: 'Governor', AG: 'Attorney General', USSEN: 'U.S. Senate' };
export function officeName(seat) {
  const n = seat.replace(/^\D+/, '');
  if (/^CD/.test(seat)) return `U.S. House, District ${n}`;
  if (/^SD/.test(seat)) return `State Senate, District ${n}`;
  if (/^HD/.test(seat)) return `State House, District ${n}`;
  return STATEWIDE_NAMES[seat] || seat;
}
export const ballotSeat = (seat) => BALLOT.find((b) => b.seat === seat) || null;
