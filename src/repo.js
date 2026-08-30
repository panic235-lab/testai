// personnel / situation_state 조회·갱신 헬퍼. abracatabra의 repo.js를 뼈대로 하되,
// mobilization_plan(엑셀/CSV 기반 조별 임무표) 대신 "집결지 지정" 하나로 응소 판정을 단순화하고
// Dashboard.dc.html의 조 선택 → 동원명령 발령 흐름에 맞춘 팀 단위 발령 함수를 추가했다.
'use strict';
const { db, now } = require('./db');

function normalizePhone(phone) {
  return String(phone || '').replace(/[^0-9]/g, '');
}

function findPersonnelByPhone(phone) {
  const p = normalizePhone(phone);
  return db.prepare("SELECT * FROM personnel WHERE REPLACE(REPLACE(phone, '-', ''), ' ', '') = ?").get(p);
}

function getPersonnelById(id) {
  return db.prepare('SELECT * FROM personnel WHERE id = ?').get(id);
}

function listPersonnel() {
  return db.prepare('SELECT * FROM personnel ORDER BY team, name').all();
}

function listTeams() {
  return db
    .prepare("SELECT DISTINCT team FROM personnel WHERE team IS NOT NULL AND team <> '' ORDER BY team")
    .all()
    .map((r) => r.team);
}

/** Dashboard 좌측 "비상동원조 편성" 패널 — 조별 인원수 + 구성원(성명/부서명/계급) */
function teamsWithMembers() {
  const all = listPersonnel();
  const teams = listTeams();
  return teams.map((id) => {
    const members = all.filter((p) => p.team === id);
    return {
      id,
      count: members.length,
      members: members.map((m) => ({ id: m.id, name: m.name, dept: m.dept, rank: m.rank_title })),
    };
  });
}

function getSituationState() {
  return db.prepare('SELECT * FROM situation_state WHERE id = 1').get();
}

function setSituationState(stage, origin) {
  db.prepare('UPDATE situation_state SET stage = ?, origin = ?, activated_at = ? WHERE id = 1').run(
    stage,
    origin || null,
    now()
  );
}

function getActiveGatheringArea() {
  const row = db.prepare('SELECT * FROM gathering_config WHERE id = 1').get();
  if (!row || !row.override_active || !row.points) return null;
  try {
    return { eventName: row.event_name, points: JSON.parse(row.points), areaM2: row.area_m2 };
  } catch {
    return null;
  }
}

/** 현재 활성 집결지의 중심 좌표 — 현장/대원앱 화면의 목표지점 마커, 대시보드 지도 중심 계산에 사용 */
function getGatheringCenter() {
  const { polygonCentroid } = require('./geo');
  const area = getActiveGatheringArea();
  if (!area) return null;
  return polygonCentroid(area.points);
}

/** 위치 갱신 + 응소 판정.
 *  "집결지 지정"에서 활성화된 구역(4점 폴리곤) 도착 여부로 판정하며,
 *  비활성 상태라면 개인별 근무지 좌표 + 반경(m)으로 판정한다(과거 abracatabra 방식 호환). */
function updateLocation(personnelId, lat, lng) {
  const p = getPersonnelById(personnelId);
  if (!p) return null;
  const { distanceMeters, pointInPolygon } = require('./geo');
  const gathering = getActiveGatheringArea();
  let arrived;
  if (gathering) {
    arrived = pointInPolygon(lat, lng, gathering.points);
  } else {
    const dist = distanceMeters(lat, lng, p.worksite_lat, p.worksite_lng);
    arrived = dist <= (p.radius_m || 100);
  }
  let status = p.status;
  if (status === '미응소') status = '접속(이동중)';
  const wasArrived = status === '응소(도착)';
  if (arrived) status = '응소(도착)';
  const arrivedAt = arrived && !wasArrived ? now() : p.arrived_at;
  db.prepare(`
    UPDATE personnel SET cur_lat = ?, cur_lng = ?, loc_updated_at = ?, status = ?, arrived_at = ? WHERE id = ?
  `).run(lat, lng, now(), status, arrivedAt, personnelId);
  return getPersonnelById(personnelId);
}

/** Dashboard "동원명령 발령" — 선택된 조(들)에게 현재 상황단계를 적용하고 상태를 초기화한 뒤 알림 발송 대상 목록을 돌려준다. */
function applyStageToTeams(stage, origin, teams, missionText) {
  const targets = db
    .prepare(`SELECT * FROM personnel WHERE team IN (${teams.map(() => '?').join(',')})`)
    .all(...teams);
  const ts = now();
  const upd = db.prepare(`
    UPDATE personnel SET stage = ?, mission = ?, status = '미응소', mission_updated_at = ?, arrived_at = NULL
    WHERE id = ?
  `);
  db.exec('BEGIN');
  try {
    for (const t of targets) {
      upd.run(stage, missionText, ts, t.id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  setSituationState(stage, origin);
  return targets.map((t) => getPersonnelById(t.id));
}

/** 조 ID 목록에 속한 전체 인원(발령 여부와 무관) — 상황판 "메시지 보내기(자유 문구+사진)" 대상 조회용 */
function personnelInTeams(teams) {
  if (!Array.isArray(teams) || teams.length === 0) return [];
  return db
    .prepare(`SELECT * FROM personnel WHERE team IN (${teams.map(() => '?').join(',')}) ORDER BY team, name`)
    .all(...teams);
}

/** 현재 발령된 상황단계에 배치된 전체 인원(발령 이후 상태가 반영된 인원) */
function activePersonnel() {
  const state = getSituationState();
  if (!state.stage || !state.activated_at) return [];
  return db.prepare('SELECT * FROM personnel WHERE stage = ? ORDER BY team, name').all(state.stage);
}

/** Dashboard 중앙 패널 "자동응소 기록 CSV" — 응소(도착) 인원의 소집수령/응소시간 */
function responseLog() {
  return activePersonnel()
    .filter((p) => p.status === '응소(도착)')
    .map((p) => ({
      recv: p.mission_updated_at,
      arr: p.arrived_at,
      team: p.team,
      dept: p.dept,
      rank: p.rank_title,
      name: p.name,
      radius: p.radius_m || 100,
    }));
}

module.exports = {
  normalizePhone,
  findPersonnelByPhone,
  getPersonnelById,
  listPersonnel,
  listTeams,
  teamsWithMembers,
  getSituationState,
  setSituationState,
  getActiveGatheringArea,
  getGatheringCenter,
  updateLocation,
  applyStageToTeams,
  personnelInTeams,
  activePersonnel,
  responseLog,
};
