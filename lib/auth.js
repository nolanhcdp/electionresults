import crypto from 'node:crypto';

const COOKIE = 'en_session'; // Control (admin)
const NAT_COOKIE = 'en_nat'; // national results page only
const DAYS = 30;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set');
  return s;
}
const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

function same(code, want) {
  if (!want || typeof code !== 'string') return false;
  const a = crypto.createHash('sha256').update(code).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

export const checkCode = (code) => same(code, process.env.ADMIN_CODE || '');
// Optional second code that opens only the national page (to share with people who shouldn't run Control).
export const checkNationalCode = (code) => same(code, process.env.NATIONAL_CODE || '');

function cookieFor(name, role) {
  const exp = Date.now() + DAYS * 864e5;
  const payload = `${role}.${exp}`;
  return `${name}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${DAYS * 86400}`;
}
export const makeCookie = () => cookieFor(COOKIE, 'admin');
export const makeNationalCookie = () => cookieFor(NAT_COOKIE, 'national');

function hasCookie(req, name, role) {
  const raw = req.headers.cookie || '';
  const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  if (!m) return false;
  const parts = m[1].split('.');
  if (parts.length !== 3) return false;
  const [r, exp, sig] = parts;
  const expected = sign(`${r}.${exp}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  return r === role && Number(exp) > Date.now();
}

export const isAdmin = (req) => hasCookie(req, COOKIE, 'admin');
export const canSeeNational = (req) => isAdmin(req) || hasCookie(req, NAT_COOKIE, 'national');
