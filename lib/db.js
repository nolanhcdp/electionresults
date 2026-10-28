import { Redis } from '@upstash/redis';
import config from './config.js';

const PREFIX = process.env.KV_PREFIX || 'en2026';
const KEY_STATE = `${PREFIX}:state`;

// In-memory stand-in for local testing without Upstash (MEMORY_DB=1). Never used on Vercel.
const mem = new Map();
const memoryRedis = {
  async get(k) { return mem.has(k) ? structuredClone(mem.get(k)) : null; },
  async set(k, v) { mem.set(k, structuredClone(v)); return 'OK'; },
};

let client;
function redis() {
  if (!client) client = process.env.MEMORY_DB ? memoryRedis : Redis.fromEnv();
  return client;
}

export function defaultState() {
  const d = config.defaults || {};
  return {
    pinned: d.pinned || [],
    ticker: null,                 // { text, at, pos }
    slideSeconds: d.slideSeconds || 12,
    slideColumns: d.slideColumns || 2,
    tickerPos: d.tickerPos || 'bottom',
    registered: null,             // overrides the clerk's registered-voter count
    expected: null,               // HQ's estimate of total ballots
    clerkUrl: null,               // the clerk's results page, pasted in Control on election night (null = default)
    addedState: [],               // [{ id, name, level, categoryId, officeId }]
    hand: [],                     // [{ id, office, level, voteFor, cands: [{ name, party, votes }] }]
    rev: 0,
  };
}

export async function getState() {
  const s = await redis().get(KEY_STATE);
  return { ...defaultState(), ...(s || {}) };
}

export async function saveState(s) {
  s.rev = (s.rev || 0) + 1;
  s.savedAt = new Date().toISOString();
  await redis().set(KEY_STATE, s);
  return s;
}
