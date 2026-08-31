// 관리자 메뉴(AdminMenu) 전용 데이터 계층 — 인력 마스터/조 편성/상황판 설정/집결지 지정/관리자 계정/기기등록코드
// abracatabra 원본 로직 그대로 이식.
'use strict';
const { db, now, hashPassword, verifyPassword, generateDeviceCode } = require('./db');
const { polygonAreaM2 } = require('./geo');

// ---------- 인력 마스터 관리 / 비상동원조 편성 ----------

function listPersonnelFull() {
  return db.prepare('SELECT * FROM personnel ORDER BY id').all();
}

function addPersonnel({ name, dept, rank, phone, team }) {
  if (!name || !phone) throw new Error('성명과 연락처는 필수입니다.');
  const info = db
    .prepare(
      `INSERT INTO personnel (name, phone, team, dept, rank_title, status) VALUES (?, ?, ?, ?, ?, '미응소')`
    )
    .run(name, phone, team || null, dept || null, rank || null);
  return db.prepare('SELECT * FROM personnel WHERE id = ?').get(info.lastInsertRowid);
}

function updatePersonnel(id, { name, dept, rank, phone, team }) {
  const existing = db.prepare('SELECT * FROM personnel WHERE id = ?').get(id);
  if (!existing) throw new Error('대상 인원을 찾을 수 없습니다.');
  db.prepare(
    `UPDATE personnel SET name = ?, dept = ?, rank_title = ?, phone = ?, team = ? WHERE id = ?`
  ).run(
    name ?? existing.name,
    dept ?? existing.dept,
    rank ?? existing.rank_title,
    phone ?? existing.phone,
    team === undefined ? existing.team : team,
    id
  );
  return db.prepare('SELECT * FROM personnel WHERE id = ?').get(id);
}

function deletePersonnel(id) {
  db.prepare('DELETE FROM personnel WHERE id = ?').run(id);
}

/** 비상동원조 편성 화면: 인원을 클릭 → 조 클릭으로 배정 (1인 1조) */
function assignTeamToPerson(id, team) {
  db.prepare('UPDATE personnel SET team = ? WHERE id = ?').run(team || null, id);
  return db.prepare('SELECT * FROM personnel WHERE id = ?').get(id);
}

/** 엑셀/CSV 업로드 반영 — 연락처(phone) 기준 upsert. 연락처가 이미 있으면 정보 갱신, 없으면 신규 등록 */
function upsertPersonnelRows(rows) {
  const upd = db.prepare(
    `UPDATE personnel SET name = ?, dept = ?, rank_title = ?, team = ? WHERE phone = ?`
  );
  const ins = db.prepare(
    `INSERT INTO personnel (name, phone, team, dept, rank_title, status) VALUES (?, ?, ?, ?, ?, '미응소')`
  );
  const find = db.prepare('SELECT id FROM personnel WHERE phone = ?');
  let created = 0;
  let updated = 0;
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      if (!r.name || !r.phone) continue;
      const exists = find.get(r.phone);
      if (exists) {
        upd.run(r.name, r.dept || null, r.rank || null, r.team || null, r.phone);
        updated += 1;
      } else {
        ins.run(r.name, r.phone, r.team || null, r.dept || null, r.rank || null);
        created += 1;
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { created, updated, total: created + updated };
}

// ---------- 상황판 설정 (초기화면 버튼 / 상황단계 항목) ----------

function listOriginButtons() {
  return db.prepare('SELECT * FROM origin_button ORDER BY sort_order').all();
}

function updateOriginButtonLabel(id, label) {
  db.prepare('UPDATE origin_button SET label = ? WHERE id = ?').run(label, id);
  return db.prepare('SELECT * FROM origin_button WHERE id = ?').get(id);
}

function listStagesByOrigin() {
  const rows = db.prepare('SELECT * FROM stage_master ORDER BY origin, sort_order, id').all();
  const grouped = {};
  for (const r of rows) {
    if (!grouped[r.origin]) grouped[r.origin] = [];
    grouped[r.origin].push({ id: r.id, name: r.name });
  }
  return grouped;
}

function addStageItem(origin, name) {
  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM stage_master WHERE origin = ?')
    .get(origin).m;
  const info = db
    .prepare('INSERT INTO stage_master (origin, name, sort_order) VALUES (?, ?, ?)')
    .run(origin, name, maxOrder + 1);
  return { id: info.lastInsertRowid, origin, name };
}

function deleteStageItem(id) {
  db.prepare('DELETE FROM stage_master WHERE id = ?').run(id);
}

// ---------- 집결지 지정 ----------
// id=1(집결지 1) / id=2(집결지 2) 두 슬롯을 지원. 집결지 2는 집결지 1이 이미 저장되어 있어야만
// 생성할 수 있으며(아래 saveGatheringArea 전제조건), 두 슬롯 모두 활성화된 경우 대원의 GPS가
// 둘 중 한 곳에만 들어와도 응소(도착)로 인정한다(repo.getActiveGatheringAreas 참고).
function normalizeSlot(slot) {
  const n = Number(slot);
  if (n !== 1 && n !== 2) throw new Error('집결지 슬롯은 1 또는 2만 가능합니다.');
  return n;
}

function getGatheringConfig(slot) {
  const s = normalizeSlot(slot);
  const row = db.prepare('SELECT * FROM gathering_config WHERE id = ?').get(s);
  return {
    slot: s,
    overrideActive: !!row.override_active,
    eventName: row.event_name,
    points: row.points ? JSON.parse(row.points) : [],
    areaM2: row.area_m2,
    updatedAt: row.updated_at,
  };
}

/** 집결지 1, 2 설정을 한 번에 — 관리자 메뉴 재진입 시 저장된 값을 그대로 화면에 복원(프리필)하는 데 사용 */
function getGatheringConfigs() {
  return [getGatheringConfig(1), getGatheringConfig(2)];
}

function setGatheringMode(slot, overrideActive) {
  const s = normalizeSlot(slot);
  if (s === 2 && overrideActive) {
    const slot1 = getGatheringConfig(1);
    if (!slot1.points || slot1.points.length === 0) {
      throw new Error('집결지 2는 집결지 1이 먼저 저장되어 있어야 활성화할 수 있습니다.');
    }
  }
  db.prepare('UPDATE gathering_config SET override_active = ? WHERE id = ?').run(overrideActive ? 1 : 0, s);
  return getGatheringConfig(s);
}

/** 지도에서 지정한 4점을 저장 — 즉시 활성화되며 이력에도 기록.
 *  집결지 2(slot=2)는 집결지 1에 이미 저장된 좌표가 있을 때만 저장할 수 있다(사용자 확정 요구사항). */
function saveGatheringArea(slot, eventName, points) {
  const s = normalizeSlot(slot);
  if (s === 2) {
    const slot1 = getGatheringConfig(1);
    if (!slot1.points || slot1.points.length === 0) {
      throw new Error('집결지 2는 집결지 1이 먼저 저장되어 있어야 추가할 수 있습니다.');
    }
  }
  if (!Array.isArray(points) || points.length !== 4) {
    throw new Error('지점은 정확히 4개여야 합니다.');
  }
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
      throw new Error('좌표값이 올바르지 않습니다.');
    }
  }
  const areaM2 = polygonAreaM2(points);
  const pointsJson = JSON.stringify(points);
  const ts = now();
  db.prepare(
    `UPDATE gathering_config SET override_active = 1, event_name = ?, points = ?, area_m2 = ?, updated_at = ? WHERE id = ?`
  ).run(eventName || null, pointsJson, areaM2, ts, s);
  db.prepare(
    `INSERT INTO gathering_history (slot, event_name, points, area_m2, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(s, eventName || null, pointsJson, areaM2, ts);
  return getGatheringConfig(s);
}

function listGatheringHistory(slot) {
  const rows = slot
    ? db.prepare('SELECT * FROM gathering_history WHERE slot = ? ORDER BY id DESC LIMIT 50').all(normalizeSlot(slot))
    : db.prepare('SELECT * FROM gathering_history ORDER BY id DESC LIMIT 50').all();
  return rows.map((r) => ({
    id: r.id,
    slot: r.slot || 1,
    eventName: r.event_name,
    points: JSON.parse(r.points),
    areaM2: r.area_m2,
    createdAt: r.created_at,
  }));
}

// ---------- 관리자 계정 관리 ----------

function listAdmins() {
  return db
    .prepare('SELECT id, name, dept, role, active, created_at FROM admin_account ORDER BY created_at')
    .all();
}

function addAdmin({ id, password, name, dept, role }) {
  if (!id || !password) throw new Error('아이디와 임시 비밀번호를 입력해 주세요.');
  const exists = db.prepare('SELECT id FROM admin_account WHERE id = ?').get(id);
  if (exists) throw new Error('이미 존재하는 아이디입니다.');
  const { hash, salt } = hashPassword(password);
  db.prepare(
    `INSERT INTO admin_account (id, password_hash, salt, name, dept, role, active) VALUES (?, ?, ?, ?, ?, ?, 1)`
  ).run(id, hash, salt, name || null, dept || null, role || 'AD-1');
  return { id, name, dept, role: role || 'AD-1', active: 1 };
}

function setAdminActive(id, active) {
  db.prepare('UPDATE admin_account SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
}

function verifyAdminLogin(id, password) {
  const row = db.prepare('SELECT * FROM admin_account WHERE id = ?').get(id);
  if (!row || !row.active) return null;
  if (!verifyPassword(password, row.salt, row.password_hash)) return null;
  return { id: row.id, name: row.name, dept: row.dept, role: row.role };
}

// ---------- 기기등록코드 관리 ----------

function getDeviceCode() {
  const row = db.prepare('SELECT * FROM device_code WHERE id = 1').get();
  return { code: row.code, updatedAt: row.updated_at };
}

function regenerateDeviceCode() {
  const code = generateDeviceCode();
  const ts = now();
  db.prepare('UPDATE device_code SET code = ?, updated_at = ? WHERE id = 1').run(code, ts);
  return { code, updatedAt: ts };
}

module.exports = {
  listPersonnelFull,
  addPersonnel,
  updatePersonnel,
  deletePersonnel,
  assignTeamToPerson,
  upsertPersonnelRows,
  listOriginButtons,
  updateOriginButtonLabel,
  listStagesByOrigin,
  addStageItem,
  deleteStageItem,
  getGatheringConfig,
  getGatheringConfigs,
  setGatheringMode,
  saveGatheringArea,
  listGatheringHistory,
  listAdmins,
  addAdmin,
  setAdminActive,
  verifyAdminLogin,
  getDeviceCode,
  regenerateDeviceCode,
};
