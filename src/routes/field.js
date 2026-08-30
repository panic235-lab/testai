'use strict';
const express = require('express');
const repo = require('../repo');
const session = require('../session');

const router = express.Router();
router.use(session.requireRole('field'));

function serialize(p) {
  const state = repo.getSituationState();
  const center = repo.getGatheringCenter();
  return {
    name: p.name,
    phone: p.phone,
    team: p.team,
    dept: p.dept,
    rank: p.rank_title,
    status: p.status,
    mission: p.mission,
    worksiteName: p.worksite_name,
    targetLat: center ? center.lat : p.worksite_lat,
    targetLng: center ? center.lng : p.worksite_lng,
    curLat: p.cur_lat,
    curLng: p.cur_lng,
    missionUpdatedAt: p.mission_updated_at,
    locUpdatedAt: p.loc_updated_at,
    activeStage: state.stage,
    // 비상근무(상황단계 발령) 중일 때만 위치수집 대상 — 위치정보법 준수
    collectLocation: Boolean(state.stage),
  };
}

router.get('/me', (req, res) => {
  const p = repo.getPersonnelById(req.session.personnelId);
  if (!p) return res.status(404).json({ error: '인원 정보를 찾을 수 없습니다.' });
  res.json(serialize(p));
});

// 위치 갱신 + 응소 판정
router.post('/location', (req, res) => {
  const { lat, lng } = req.body || {};
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
    return res.status(400).json({ error: '위치 값이 올바르지 않습니다.' });
  }
  const updated = repo.updateLocation(req.session.personnelId, latNum, lngNum);
  if (!updated) return res.status(404).json({ error: '인원 정보를 찾을 수 없습니다.' });
  res.json(serialize(updated));
});

module.exports = router;
