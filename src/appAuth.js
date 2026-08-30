// 대원 앱(M-A1~M-A4) 전용 데이터 계층 — 개별 계정 로그인 + 기기 바인딩(브라우저 localStorage의 device id로 시뮬레이션)
// abracatabra에는 없던 신규 기능. 기기등록코드는 AdminMenu "기기등록코드 관리" 탭(adminRepo/device_code)과 동일한
// 테이블을 그대로 검증에 사용한다.
'use strict';
const { db, now, hashPassword, verifyPassword } = require('./db');

function findAccount(id) {
  return db.prepare('SELECT * FROM app_account WHERE id = ?').get(id);
}

function getCurrentDeviceCode() {
  const row = db.prepare('SELECT * FROM device_code WHERE id = 1').get();
  return row ? row.code : null;
}

/**
 * 로그인 시도.
 * - 계정에 기기가 아직 등록되어 있지 않으면(최초 로그인) 이번 요청의 deviceId로 자동 등록한다(M-A1).
 * - 이미 다른 기기가 등록되어 있다면 실패하고 "새 기기 등록"이 필요함을 안내한다(M-A2로 유도).
 */
function login(id, password, deviceId) {
  const account = findAccount(id);
  if (!account) return { error: '아이디 또는 비밀번호가 올바르지 않습니다.' };
  if (!verifyPassword(password, account.salt, account.password_hash)) {
    return { error: '아이디 또는 비밀번호가 올바르지 않습니다.' };
  }
  if (!account.device_id) {
    db.prepare('UPDATE app_account SET device_id = ?, device_registered_at = ? WHERE id = ?').run(
      deviceId,
      now(),
      id
    );
    return { account: { ...account, device_id: deviceId } };
  }
  if (account.device_id !== deviceId) {
    return {
      error: '이미 다른 기기에 등록된 계정입니다. 새 기기 등록(기기등록코드 필요)을 진행해 주세요.',
      code: 'DEVICE_MISMATCH',
    };
  }
  return { account };
}

/** 새 기기 등록(M-A2) — 기기등록코드가 일치하면 기존 기기를 해제하고 현재 기기로 재등록한다. */
function registerDevice(id, password, deviceCode, deviceId) {
  const account = findAccount(id);
  if (!account) return { error: '아이디 또는 비밀번호가 올바르지 않습니다.' };
  if (!verifyPassword(password, account.salt, account.password_hash)) {
    return { error: '아이디 또는 비밀번호가 올바르지 않습니다.' };
  }
  const current = getCurrentDeviceCode();
  const normalize = (s) => String(s || '').trim().toUpperCase();
  if (!current || normalize(deviceCode) !== normalize(current)) {
    return { error: '기기등록코드가 올바르지 않습니다. 관리자에게 최신 코드를 확인해 주세요.' };
  }
  db.prepare('UPDATE app_account SET device_id = ?, device_registered_at = ? WHERE id = ?').run(
    deviceId,
    now(),
    id
  );
  return { account: { ...account, device_id: deviceId } };
}

function createAccount({ id, password, personnelId }) {
  const { hash, salt } = hashPassword(password);
  db.prepare(
    `INSERT INTO app_account (id, password_hash, salt, personnel_id) VALUES (?, ?, ?, ?)`
  ).run(id, hash, salt, personnelId);
  return findAccount(id);
}

module.exports = { findAccount, login, registerDevice, createAccount, getCurrentDeviceCode };
