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

function getGatheringAreaBySlot(slot) {
  const row = db.prepare('SELECT * FROM gathering_config WHERE id = ?').get(slot);
  if (!row || !row.override_active || !row.points) return null;
  try {
    return { slot, eventName: row.event_name, points: JSON.parse(row.points), areaM2: row.area_m2 };
  } catch {
    return null;
  }
}

/** 활성화된 집결지 전체(집결지 1, 집결지 2). 응소(도착) 판정은 이 중 하나라도 매칭되면 인정한다
 *  (관리자 확정 방침: "둘 중 아무 곳이나 도착하면 응소 인정"). */
function getActiveGatheringAreas() {
  return [1, 2].map((slot) => getGatheringAreaBySlot(slot)).filter(Boolean);
}

/** 하위 호환용 — 활성 집결지 중 첫 번째(주로 집결지 1) 하나만 필요한 기존 호출부를 위해 유지 */
function getActiveGatheringArea() {
  return getActiveGatheringAreas()[0] || null;
}

/** 활성 집결지들의 중심 좌표 목록 — 대시보드 지도에 집결지 1/2 마커를 모두 그리는 데 사용 */
function getGatheringCenters() {
  const { polygonCentroid } = require('./geo');
  return getActiveGatheringAreas().map((area) => ({
    slot: area.slot,
    eventName: area.eventName,
    center: polygonCentroid(area.points),
  }));
}

/** 하위 호환용 — 활성 집결지 중 첫 번째의 중심 좌표(현장/대원앱 목표지점 마커, 지도 기본 중심 계산에 사용) */
function getGatheringCenter() {
  const centers = getGatheringCenters();
  return centers.length ? centers[0].center : null;
}

/** 위치 갱신 + 응소 판정.
 *  "집결지 지정"에서 활성화된 구역(집결지 1, 집결지 2 — 4점 폴리곤) 중 하나라도 도착하면 응소로 판정하며,
 *  둘 다 비활성 상태라면 개인별 근무지 좌표 + 반경(m)으로 판정한다(과거 abracatabra 방식 호환). */
function updateLocation(personnelId, lat, lng) {
  const p = getPersonnelById(personnelId);
  if (!p) return null;
  const { distanceMeters, pointInPolygon } = require('./geo');
  const areas = getActiveGatheringAreas();
  let arrived;
  if (areas.length > 0) {
    arrived = areas.some((area) => pointInPolygon(lat, lng, area.points));
  } else {
    const dist = distanceMeters(lat, lng, p.worksite_lat, p.worksite_lng);
    arrived = dist <= (p.radius_m || 100);
  }
  let status = p.status;
  if (status === '미응소') status = '접속(이동중)';
  const wasArrived = status === '응소(도착)';
  if (arrived) status = '응소(도착)';
  const justArrived = arrived && !wasArrived;
  const arrivedAt = justArrived ? now() : p.arrived_at;
  db.prepare(`
    UPDATE personnel SET cur_lat = ?, cur_lng = ?, loc_updated_at = ?, status = ?, arrived_at = ? WHERE id = ?
  `).run(lat, lng, now(), status, arrivedAt, personnelId);
  // justArrived는 DB 컬럼이 아니라, 이번 호출로 "집결완료(소집완료)" 전환이 막 일어났는지를
  // 라우트 레이어(routes/app.js)가 알림 메시지를 남길지 판단하도록 실어 보내는 임시 표시.
  return { ...getPersonnelById(personnelId), justArrived };
}

/** 대원 앱 "응소 확인" 버튼 — GPS 자동 판정(집결지 도착)과는 별개로, 대원이 동원명령을 받고
 *  "지금 대응 중입니다"를 스스로 알리는 응답 확인 단계. 이 버튼만으로는 실제 집결지 도착(소집완료)이
 *  인정되지 않으며, 집결완료는 오직 GPS 위치가 집결지 반경/폴리곤 안에 들어왔을 때(updateLocation)만
 *  인정된다. */
function acknowledgeResponse(personnelId) {
  const p = getPersonnelById(personnelId);
  if (!p) return null;
  const alreadyAcked = Boolean(p.ack_at);
  const ackAt = p.ack_at || now();
  const nextStatus = p.status === '미응소' ? '접속(이동중)' : p.status;
  db.prepare(`UPDATE personnel SET status = ?, ack_at = ? WHERE id = ?`).run(nextStatus, ackAt, personnelId);
  // newAck: 이번 호출로 "새로" 응소확인이 기록된 것인지(=응소확인 메시지를 남겨야 하는지) 여부.
  return { ...getPersonnelById(personnelId), newAck: !alreadyAcked };
}

/** Dashboard "동원명령 발령" — 선택된 조(들)에게 현재 상황단계를 적용하고 상태를 초기화한 뒤 알림 발송 대상 목록을 돌려준다. */
function applyStageToTeams(stage, origin, teams, missionText) {
  const targets = db
    .prepare(`SELECT * FROM personnel WHERE team IN (${teams.map(() => '?').join(',')})`)
    .all(...teams);
  const ts = now();
  const upd = db.prepare(`
    UPDATE personnel SET stage = ?, mission = ?, status = '미응소', mission_updated_at = ?, arrived_at = NULL, ack_at = NULL
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

/** Dashboard 중앙 패널 "자동응소 기록 CSV" — 소집수령/응소확인(버튼)/응소(도착, GPS) 시간.
 *  응소(도착)한 사람뿐 아니라, 아직 도착 전이라도 응소확인만 한 사람도 포함한다(arr는 비어 있음). */
function responseLog() {
  return activePersonnel()
    .filter((p) => p.status === '응소(도착)' || p.ack_at)
    .map((p) => ({
      recv: p.mission_updated_at,
      ack: p.ack_at,
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
  getActiveGatheringAreas,
  getGatheringCenter,
  getGatheringCenters,
  updateLocation,
  acknowledgeResponse,
  applyStageToTeams,
  personnelInTeams,
  activePersonnel,
  responseLog,
};
