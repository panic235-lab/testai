// 카카오톡 알림 전송 계층 (목업) — abracatabra 원본 로직 그대로 이식
//
// 현재는 실제 카카오톡 발송 대신 로그만 남기는 목업 구현입니다.
// 나중에 실제 카카오톡 비즈메시지/알림톡 API 또는 카카오 MCP 도구가 준비되면
// sendToPersonnel() 내부의 mockTransmit() 호출부만 실제 발송으로 교체하면 됩니다.
// 자유 문구 + 사진 첨부(카카오톡 스타일 메시지) 지원을 위해 photoPath를 로그에 함께 기록한다.
'use strict';
const { db, now } = require('./db');

const MOCK_FAILURE_RATE = 0.1; // 실패/재시도 UI 확인용 임의 실패율 10%

function insertLog({ personnelId, name, phone, type, message, status, attempt, photoPath }) {
  const stmt = db.prepare(`
    INSERT INTO notification_log (personnel_id, name, phone, type, message, status, attempt, photo_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(personnelId, name, phone, type, message, status, attempt, photoPath || null, now());
  return Number(info.lastInsertRowid);
}

/** 실제 발송을 흉내내는 부분. 실제 연동 시 이 함수만 교체하면 됨. */
function mockTransmit(/* personnel, message, photoPath */) {
  return Math.random() >= MOCK_FAILURE_RATE;
}

/**
 * 한 명에게 알림 발송(목업) + 로그 기록.
 * @returns {{ id: number, success: boolean }}
 */
function sendToPersonnel(personnel, type, message, photoPath) {
  const success = mockTransmit(personnel, message, photoPath);
  const id = insertLog({
    personnelId: personnel.id,
    name: personnel.name,
    phone: personnel.phone,
    type,
    message,
    status: success ? '성공' : '실패',
    attempt: 1,
    photoPath,
  });
  return { id, success };
}

/** 여러 명에게 동일/개별 알림 일괄 발송 (동원명령 발령, 자유 문구 메시지 발송 등). photoPath는 전체 수신자 공통 첨부. */
function sendBulk(list, type, messageFor, photoPath) {
  return list.map((p) => sendToPersonnel(p, type, typeof messageFor === 'function' ? messageFor(p) : messageFor, photoPath));
}

/** 실패 건 재시도 */
function retry(logId) {
  const row = db.prepare('SELECT * FROM notification_log WHERE id = ?').get(logId);
  if (!row) return null;
  const success = mockTransmit({ id: row.personnel_id, phone: row.phone }, row.message, row.photo_path);
  const id = insertLog({
    personnelId: row.personnel_id,
    name: row.name,
    phone: row.phone,
    type: row.type,
    message: row.message,
    status: success ? '성공' : '실패',
    attempt: (row.attempt || 1) + 1,
    photoPath: row.photo_path,
  });
  return { id, success };
}

function listRecent(limit = 200) {
  return db.prepare('SELECT * FROM notification_log ORDER BY id DESC LIMIT ?').all(limit);
}

function listFailed() {
  const rows = db.prepare('SELECT * FROM notification_log ORDER BY id DESC').all();
  const seen = new Set();
  const failed = [];
  for (const r of rows) {
    const key = r.personnel_id + '|' + r.type + '|' + r.message;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r.status === '실패') failed.push(r);
  }
  return failed;
}

/** 대원 앱 메시지함(F-3 계열) — 특정 인원에게 온 알림 로그를 최신순으로 */
function listForPersonnel(personnelId, limit = 100) {
  return db
    .prepare('SELECT * FROM notification_log WHERE personnel_id = ? ORDER BY id DESC LIMIT ?')
    .all(personnelId, limit);
}

/** 대원 본인이 발생시킨 이벤트(응소확인 버튼 클릭, GPS 집결완료 등)를 그 대원의 메시지함에
 *  "답장"처럼 남긴다. 상황실→대원 발송(mockTransmit 실패 시뮬레이션 대상)과 달리 대원이 스스로
 *  일으킨 이벤트이므로 발송 성공/실패 개념 없이 항상 기록된다. */
function logPersonnelEvent(personnel, type, message) {
  const id = insertLog({
    personnelId: personnel.id,
    name: personnel.name,
    phone: personnel.phone,
    type,
    message,
    status: '완료',
    attempt: 1,
    photoPath: null,
  });
  return { id };
}

module.exports = { sendToPersonnel, sendBulk, retry, listRecent, listFailed, listForPersonnel, logPersonnelEvent };
