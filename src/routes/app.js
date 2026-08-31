// 대원 앱(AppHome.dc.html) 전용 API — 나의 응소 상태 + 메시지함(카카오톡 스타일)
'use strict';
const express = require('express');
const repo = require('../repo');
const notify = require('../notify');
const session = require('../session');

const router = express.Router();
router.use(session.requireRole('app'));

router.get('/me', (req, res) => {
  const p = repo.getPersonnelById(req.session.personnelId);
  if (!p) return res.status(404).json({ error: '인원 정보를 찾을 수 없습니다.' });
  const state = repo.getSituationState();
  const center = repo.getGatheringCenter();
  const gathering = repo.getActiveGatheringArea();
  res.json({
    name: p.name,
    dept: p.dept,
    rank: p.rank_title,
    team: p.team,
    status: p.status,
    ackAt: p.ack_at,
    mission: p.mission,
    gatheringEventName: gathering ? gathering.eventName : null,
    activeStage: state.stage,
    activatedAt: state.activated_at,
    targetLat: center ? center.lat : p.worksite_lat,
    targetLng: center ? center.lng : p.worksite_lng,
    curLat: p.cur_lat,
    curLng: p.cur_lng,
    collectLocation: Boolean(state.stage),
  });
});

router.post('/location', (req, res) => {
  const { lat, lng } = req.body || {};
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
    return res.status(400).json({ error: '위치 값이 올바르지 않습니다.' });
  }
  const updated = repo.updateLocation(req.session.personnelId, latNum, lngNum);
  if (!updated) return res.status(404).json({ error: '인원 정보를 찾을 수 없습니다.' });
  // GPS 위치가 집결지 반경/폴리곤 안에 막 들어와 "집결완료"로 전환된 순간에만
  // 메시지함(카카오톡 답장 스타일)에 소집완료 기록을 남긴다 — 매 위치 갱신마다 남기지 않음.
  if (updated.justArrived) {
    notify.logPersonnelEvent(updated, '소집완료', '집결지 도착이 확인되어 소집 완료되었습니다.');
  }
  res.json({ status: updated.status });
});

// 응소 확인 — 동원명령을 받은 대원이 "지금 대응 중입니다"를 스스로 알리는 응답 확인 버튼.
// GPS 자동판정(집결지 도착=소집완료)과는 별개이며, 이 버튼만으로는 도착이 인정되지 않는다.
router.post('/respond', (req, res) => {
  const state = repo.getSituationState();
  if (!state.stage) return res.status(400).json({ error: '현재 발령된 동원명령이 없습니다.' });
  const updated = repo.acknowledgeResponse(req.session.personnelId);
  if (!updated) return res.status(404).json({ error: '인원 정보를 찾을 수 없습니다.' });
  if (updated.newAck) {
    notify.logPersonnelEvent(updated, '응소확인', '동원명령에 응소 확인했습니다. 현재 대응 중입니다.');
  }
  res.json({ status: updated.status, ackAt: updated.ack_at });
});

// 메시지함 — 동원명령/임무갱신/응소확인/소집완료 로그를 카카오톡 스타일 리스트로.
// '응소확인'/'소집완료'는 대원 본인이 발생시킨 이벤트라서 우측 정렬된 "답장" 형태로 렌더링됨(app-home.html 참고).
router.get('/messages', (req, res) => {
  const rows = notify.listForPersonnel(req.session.personnelId, 100);
  const TYPE_MAP = {
    '동원명령': { type: 'dispatch', title: '동원명령 발령' },
    '임무갱신': { type: 'update', title: '부여임무 갱신' },
    '메시지': { type: 'notice', title: '상황실 메시지' },
    '응소확인': { type: 'ack', title: '응소확인' },
    '소집완료': { type: 'complete', title: '소집완료' },
  };
  const messages = rows.map((r) => {
    const mapped = TYPE_MAP[r.type] || { type: 'update', title: r.type };
    return {
      id: r.id,
      type: mapped.type,
      title: mapped.title,
      preview: r.message,
      time: r.created_at,
      status: r.status,
      photo: r.photo_path || null,
    };
  });
  res.json({ messages });
});

module.exports = router;
