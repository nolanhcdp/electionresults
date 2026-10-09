import crypto from 'node:crypto';

const COOKIE = 'en_session';
const DAYS = 30;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set');
  return s;
}
const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

export function checkCode(code) {
  const want = process.env.ADMIN_CODE || '';
  if (!want || typeof code !== 'string') return false;
  const a = crypto.createHash('sha256').update(code).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

export function makeCookie() {
  const exp = Date.now() + DAYS * 864e5;
  const payload = `admin.${exp}`;
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${DAYS * 86400}`;
}

export function isAdmin(req) {
  const raw = req.headers.cookie || '';
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const parts = m[1].split('.');
  if (parts.length !== 3) return false;
  const [role, exp, sig] = parts;
  const expected = sign(`${role}.${exp}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  return role === 'admin' && Number(exp) > Date.now();
}
