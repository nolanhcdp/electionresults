import test from 'node:test';
import assert from 'node:assert/strict';
process.env.CIVIC_FIXTURE = new URL('./fixtures/civic-sample.json', import.meta.url).pathname;
process.env.SESSION_SECRET = 'x'; process.env.ADMIN_CODE = 'admin1'; process.env.NATIONAL_CODE = 'friends1';
const { keyOf, loadCivic, shape, FORECAST } = await import('../lib/civic.js');
const auth = await import('../lib/auth.js');

test('district keys', () => {
  assert.equal(keyOf({ type: 'House of Representatives', district: 'IN-05' }), 'H:IN-5');
  assert.equal(keyOf({ type: 'House of Representatives', district: 'AK-AL' }), 'H:AK-1');
  assert.equal(keyOf({ type: 'US Senate', province: 'NE' }), 'S:NE');
  assert.equal(keyOf({ type: 'State House', district: 'IN-05' }), null);
});

test('loads, matches, hides test data, counts independents as D', async () => {
  const { map } = await loadCivic();
  assert.equal(map.size, 6); // IN-4 isn't tracked
  const f = (id, k) => (k === 'S' ? FORECAST.senate : FORECAST.house).find((x) => x.id === id);
  const ca = shape(f('CA-45'), map.get('H:CA-45'));
  assert.equal(ca.winner, 'D'); assert.equal(ca.d.name, 'Derek Tran'); assert.ok(Math.abs(ca.d.pct - 52.65) < 0.01);
  const ne = shape(f('NE', 'S'), map.get('S:NE'));
  assert.equal(ne.d.name, 'Dan Osborn'); assert.equal(ne.r.name, 'Pete Ricketts'); assert.equal(ne.winner, null); assert.equal(ne.pct, 64);
  const mt = shape(f('MT', 'S'), map.get('S:MT'));
  assert.equal(mt.d.name, 'Alani Bankhead'); assert.equal(mt.winner, 'R');
  assert.equal(shape(f('AK-1'), map.get('H:AK-1')).r.name, 'Nick Begich III');
  assert.equal(shape(f('IA', 'S'), map.get('S:IA')), null, 'test data hidden');
  assert.equal(shape(f('IA', 'S'), map.get('S:IA'), { showTest: true }).winner, 'R');
});

test('codes and cookies', () => {
  const ck = (c) => ({ headers: { cookie: c.split(';')[0] } });
  assert.ok(auth.checkCode('admin1')); assert.ok(!auth.checkCode('friends1'));
  assert.ok(auth.checkNationalCode('friends1'));
  const nat = ck(auth.makeNationalCookie()), adm = ck(auth.makeCookie());
  assert.ok(auth.canSeeNational(nat)); assert.ok(!auth.isAdmin(nat));
  assert.ok(auth.canSeeNational(adm)); assert.ok(auth.isAdmin(adm));
  assert.ok(!auth.canSeeNational({ headers: {} }));
});
