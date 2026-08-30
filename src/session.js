// 최소 세션 관리 (계정관리/SSO는 abracatabra와 동일하게 범위 밖) — abracatabra 원본 + 'app' 역할 및 requireAnyRole 추가
// 서버 재시작 시 세션은 초기화됩니다(프로토타입 한계).
'use strict';
const crypto = require('crypto');

const SESSION_COOKIE = 'accio_sanghwangsil_session';
const sessions = new Map(); // token -> { role: 'field'|'control'|'admin'|'app', personnelId?, adminId?, appAccountId?, createdAt }

function createSession(data) {
  const token = crypto.randomUUID();
  sessions.set(token, { ...data, createdAt: Date.now() });
  return token;
}

function getSession(token) {
  return token ? sessions.get(token) : undefined;
}

function destroySession(token) {
  sessions.delete(token);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function sessionMiddleware(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  req.sessionToken = token;
  req.session = getSession(token);
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session || req.session.role !== role) {
      return res.status(401).json({ error: '인증이 필요합니다.', role });
    }
    next();
  };
}

function requireAnyRole(roles) {
  return (req, res, next) => {
    if (!req.session || !roles.includes(req.session.role)) {
      return res.status(401).json({ error: '인증이 필요합니다.', roles });
    }
    next();
  };
}

module.exports = {
  createSession,
  getSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  sessionMiddleware,
  requireRole,
  requireAnyRole,
};
