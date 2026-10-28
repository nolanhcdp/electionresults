// POST /api/login { code } — sets the control-page cookie. GET tells the page whether it's logged in.
// The national page sends { code, scope: 'national' }: the Control code works there too, and so does NATIONAL_CODE if set.
import { checkCode, checkNationalCode, makeCookie, makeNationalCookie, isAdmin, canSeeNational } from '../lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ admin: isAdmin(req), national: canSeeNational(req) });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let b = req.body;
  if (!b || typeof b !== 'object') { let raw = ''; for await (const c of req) raw += c; try { b = JSON.parse(raw || '{}'); } catch { b = {}; } }
  if (checkCode(b.code)) {
    res.setHeader('Set-Cookie', makeCookie());
    return res.status(200).json({ admin: true, national: true });
  }
  if (b.scope === 'national' && checkNationalCode(b.code)) {
    res.setHeader('Set-Cookie', makeNationalCookie());
    return res.status(200).json({ admin: false, national: true });
  }
  return res.status(401).json({ error: "That code didn't match." });
}
