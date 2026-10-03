const crypto = require('crypto');

const COOKIE_NAME = 'ff_admin';

function parseCookies(header = '') {
  return header.split(';').reduce((out, part) => {
    const i = part.indexOf('=');
    if (i < 0) return out;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
    return out;
  }, {});
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(payload) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET chưa được cấu hình hoặc quá ngắn.');
  }
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function createSession(username) {
  const exp = Date.now() + 24 * 60 * 60 * 1000;
  const payload = `${base64url(username)}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function verifySession(token) {
  try {
    if (!token) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const payload = `${parts[0]}.${parts[1]}`;
    const expected = sign(payload);
    const a = Buffer.from(expected);
    const b = Buffer.from(parts[2]);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    const exp = Number(parts[1]);
    return Number.isFinite(exp) && Date.now() < exp;
  } catch {
    return false;
  }
}

function isAdmin(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return verifySession(cookies[COOKIE_NAME]);
}

function setSessionCookie(res, username) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(createSession(username))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

module.exports = { isAdmin, setSessionCookie, clearSessionCookie };
