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
  res.json({ status: updated.status });
});

// 메시지함 — 동원명령/임무갱신 알림 로그를 카카오톡 스타일 리스트로
router.get('/messages', (req, res) => {
  const rows = notify.listForPersonnel(req.session.personnelId, 100);
  const messages = rows.map((r) => ({
    id: r.id,
    type: r.type === '동원명령' ? 'dispatch' : r.type === '메시지' ? 'notice' : 'update',
    title: r.type === '동원명령' ? '동원명령 발령' : r.type === '임무갱신' ? '부여임무 갱신' : r.type === '메시지' ? '상황실 메시지' : r.type,
    preview: r.message,
    time: r.created_at,
    status: r.status,
    photo: r.photo_path || null,
  }));
  res.json({ messages });
});

module.exports = router;
