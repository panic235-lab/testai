'use strict';
const express = require('express');
const repo = require('../repo');
const notify = require('../notify');
const session = require('../session');
const adminRepo = require('../adminRepo');
const appAuth = require('../appAuth');

const router = express.Router();
const CONTROL_PASSCODE = process.env.CONTROL_PASSCODE || '0000';

// 현장 대상자 로그인 (FieldWeb) — 이름+연락처로 인력 마스터 명단과 대조 (abracatabra F-1과 동일)
router.post('/field-login', (req, res) => {
  const { name, phone } = req.body || {};
  if (!name || !phone) {
    return res.status(400).json({ error: '이름과 연락처를 입력해 주세요.' });
  }
  const p = repo.findPersonnelByPhone(phone);
  if (!p || p.name.trim() !== String(name).trim()) {
    return res.status(404).json({ error: '동원대상자 명단에서 확인되지 않습니다. 이름·연락처를 다시 확인해 주세요.' });
  }
  const token = session.createSession({ role: 'field', personnelId: p.id });
  session.setSessionCookie(res, token);

  const state = repo.getSituationState();
  if (state.stage && p.mission) {
    notify.sendToPersonnel(
      p,
      '접속안내',
      `[인력동원상황실] ${p.name}님, 부여임무: ${p.mission}`
    );
  }
  res.json({ ok: true });
});

// 상황실근무자 로그인 — 공용 암호 (Main.dc.html 좌측 "상황판 로그인")
router.post('/control-login', (req, res) => {
  const { passcode } = req.body || {};
  if (passcode !== CONTROL_PASSCODE) {
    return res.status(401).json({ error: '암호가 올바르지 않습니다.' });
  }
  const token = session.createSession({ role: 'control' });
  session.setSessionCookie(res, token);
  res.json({ ok: true });
});

// 관리자 로그인 — 아이디+비밀번호 (Main.dc.html 우측 "관리자 로그인")
router.post('/admin-login', (req, res) => {
  const { id, password } = req.body || {};
  if (!id || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력해 주세요.' });
  }
  const admin = adminRepo.verifyAdminLogin(id, password);
  if (!admin) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }
  const token = session.createSession({ role: 'admin', adminId: admin.id, adminName: admin.name, adminDept: admin.dept });
  session.setSessionCookie(res, token);
  res.json({ ok: true, admin });
});

// 대원 앱 로그인 (AppLogin.dc.html, M-A1) — 개별 계정 + 기기 바인딩
router.post('/app-login', (req, res) => {
  const { id, password, deviceId } = req.body || {};
  if (!id || !password || !deviceId) {
    return res.status(400).json({ error: '아이디·비밀번호·기기 정보가 필요합니다.' });
  }
  const result = appAuth.login(id, password, deviceId);
  if (result.error) {
    return res.status(result.code === 'DEVICE_MISMATCH' ? 409 : 401).json(result);
  }
  const token = session.createSession({
    role: 'app',
    appAccountId: result.account.id,
    personnelId: result.account.personnel_id,
  });
  session.setSessionCookie(res, token);
  res.json({ ok: true });
});

// 대원 앱 새 기기 등록 (AppDeviceRegister.dc.html, M-A2)
router.post('/app-register-device', (req, res) => {
  const { id, password, code, deviceId } = req.body || {};
  if (!id || !password || !code || !deviceId) {
    return res.status(400).json({ error: '아이디·비밀번호·기기등록코드가 필요합니다.' });
  }
  const result = appAuth.registerDevice(id, password, code, deviceId);
  if (result.error) return res.status(400).json({ error: result.error });
  const token = session.createSession({
    role: 'app',
    appAccountId: result.account.id,
    personnelId: result.account.personnel_id,
  });
  session.setSessionCookie(res, token);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  if (req.sessionToken) session.destroySession(req.sessionToken);
  session.clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.session) return res.json({ authenticated: false });
  res.json({
    authenticated: true,
    role: req.session.role,
    adminName: req.session.adminName,
    adminDept: req.session.adminDept,
  });
});

module.exports = router;
