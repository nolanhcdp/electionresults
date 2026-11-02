import test from 'node:test';
import assert from 'node:assert/strict';
process.env.CIVIC_FIXTURE = new URL('./fixtures/civic-sample.json', import.meta.url).pathname;
const { default: national } = await import('../api/national.js');
const call = (url) => new Promise((resolve) => { const res = { setHeader() { return res; }, status() { return res; }, json(b) { resolve(b); return res; } }; national({ url }, res); });

test('every other House race comes back only with ?all=1', async () => {
  const plain = await call('/api/national');
  assert.equal(plain.houseOther, undefined);
  const all = await call('/api/national?all=1');
  assert.equal(all.houseOther.length, 345);
  const in7 = all.houseOther.find((x) => x.id === 'IN-7');
  assert.equal(in7.rating, 'Solid D'); assert.equal(in7.proj, 'D+48.5');
  assert.ok(!all.houseOther.some((x) => all.house.some((h) => h.id === x.id)), 'no overlap with the tracked list');
});
