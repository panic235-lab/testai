// 상황실근무자(+관리자) API — Home/StageSelect 참조 데이터 + Dashboard.dc.html 실제 동작
'use strict';
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const repo = require('../repo');
const notify = require('../notify');
const adminRepo = require('../adminRepo');
const csvLib = require('../csv');
const session = require('../session');

const router = express.Router();
router.use(session.requireAnyRole(['control', 'admin']));

// "메시지 보내기" 사진 첨부(카카오톡 스타일) — public/uploads/notify 에 저장 후 정적 서빙 경로로 노출
const NOTIFY_UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'notify');
if (!fs.existsSync(NOTIFY_UPLOAD_DIR)) fs.mkdirSync(NOTIFY_UPLOAD_DIR, { recursive: true });

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp)$/.test(file.mimetype);
    if (!ok) return cb(new Error('이미지 파일(jpg/png/gif/webp)만 첨부할 수 있습니다.'));
    cb(null, true);
  },
});

function savePhoto(file) {
  if (!file) return null;
  const extMatch = (file.originalname || '').match(/\.[a-zA-Z0-9]+$/);
  const ext = (extMatch ? extMatch[0] : '.jpg').toLowerCase();
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  fs.writeFileSync(path.join(NOTIFY_UPLOAD_DIR, filename), file.buffer);
  return `/uploads/notify/${filename}`;
}

// Home.dc.html / StageSelect.dc.html 이 참조하는 초기화면 버튼 + 상황단계 목록 (읽기 전용)
router.get('/settings', (req, res) => {
  res.json({
    originButtons: adminRepo.listOriginButtons(),
    stagesByOrigin: adminRepo.listStagesByOrigin(),
  });
});

function statusCounts(list) {
  return list.reduce(
    (acc, p) => {
      if (p.status === '응소(도착)') acc['응소(도착)'] += 1;
      else if (p.status === '접속(이동중)') acc['접속(이동중)'] += 1;
      else acc['미응소'] += 1;
      return acc;
    },
    { '미응소': 0, '접속(이동중)': 0, '응소(도착)': 0 }
  );
}

function fmtHM(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// Dashboard.dc.html 전체 상태 — 좌측 조 편성 + 중앙 지도/CSV + 우측 응소현황을 한 번에 반환
router.get('/dashboard', (req, res) => {
  const stageParam = req.query.stage ? String(req.query.stage) : null;
  const state = repo.getSituationState();
  const stage = stageParam || state.stage;
  const dispatched = Boolean(state.stage && state.activated_at && state.stage === stage);

  const teams = repo.teamsWithMembers();
  const active = dispatched ? repo.activePersonnel() : [];
  const gathering = repo.getActiveGatheringArea();
  const center = repo.getGatheringCenter();

  // 지도 마커 위치(%) 계산 — 집결지 중심을 기준으로 각 인원의 현재 위치(또는 미수집 시 임의 분산)를 정규화
  const spanDeg = 0.01; // 집결지 중심 기준 표시 반경(위경도 도) — 지도 패널의 여백 범위
  const markers = active.map((p) => {
    let lat = p.cur_lat;
    let lng = p.cur_lng;
    // estimated=true → 실제 GPS가 아직 없어서 아래 임의 좌표로 대체 표시된 것 (지도에는 반드시 구분해서 그릴 것)
    const estimated = lat == null || lng == null;
    if (estimated) {
      // 아직 위치가 수집되지 않은 인원은 id 기반 고정 시드로 결정론적으로 배치(매 새로고침마다 안 흔들리도록)
      const seed = p.id * 9301 + 49297;
      const rand = (seed % 1000) / 1000;
      const angle = rand * Math.PI * 2;
      const r = 0.55 + ((seed >> 3) % 100) / 400;
      lat = (center ? center.lat : 35.8714) + Math.sin(angle) * spanDeg * r;
      lng = (center ? center.lng : 128.6014) + Math.cos(angle) * spanDeg * r;
    }
    const cLat = center ? center.lat : 35.8714;
    const cLng = center ? center.lng : 128.6014;
    const left = 50 + ((lng - cLng) / spanDeg) * 45;
    const top = 50 - ((lat - cLat) / spanDeg) * 45;
    return {
      id: p.id,
      lat,
      lng,
      estimated,
      left: Math.max(4, Math.min(96, left)),
      top: Math.max(4, Math.min(96, top)),
      status: p.status,
      name: p.name,
      team: p.team,
    };
  });

  const csvRows = repo.responseLog().map((r, i) => ({
    no: i + 1,
    recv: fmtHM(r.recv),
    arr: fmtHM(r.arr),
    team: r.team,
    dept: r.dept,
    rank: r.rank,
    name: r.name,
    radius: r.radius,
  }));

  res.json({
    stage,
    origin: state.origin,
    activatedAt: state.activated_at,
    dispatched,
    teams,
    gatheringEventName: gathering ? gathering.eventName : null,
    gatheringCenter: center,
    gatheringPoints: gathering ? gathering.points : null,
    active: active.map((p) => ({
      id: p.id,
      name: p.name,
      dept: p.dept,
      rank: p.rank_title,
      team: p.team,
      status: p.status,
      missionUpdatedAt: p.mission_updated_at,
      arrivedAt: p.arrived_at,
    })),
    markers,
    summary: statusCounts(active),
    csvRows,
  });
});

// Dashboard.dc.html "동원명령 발령" 버튼 — 선택된 조(들)에게 현재 상황단계를 적용 + 알림 발송(목업)
router.post('/dashboard/dispatch', (req, res) => {
  const { stage, origin, teams } = req.body || {};
  if (!stage) return res.status(400).json({ error: '상황단계를 선택해 주세요.' });
  if (!Array.isArray(teams) || teams.length === 0) {
    return res.status(400).json({ error: '조를 1개 이상 선택해 주세요.' });
  }
  const missionText = `[${stage}] 동원명령 - 지정 집결지로 집결 바랍니다.`;
  const applied = repo.applyStageToTeams(stage, origin, teams, missionText);
  if (applied.length === 0) {
    return res.status(400).json({ error: '선택한 조에 배정된 인원이 없습니다.' });
  }
  const results = notify.sendBulk(applied, '동원명령', (p) => `[인력동원상황실] 동원명령 발령(${stage}) - ${p.name}님, ${missionText}`);
  const failCount = results.filter((r) => !r.success).length;
  res.json({ ok: true, appliedCount: applied.length, failCount });
});

// Dashboard.dc.html 좌측 "메시지 보내기" — 선택된 조 전체에게 자유 문구 + 사진(선택)을 목업 발송(카카오톡 스타일).
// 동원명령 발령(고정 템플릿, 1회성)과 별개로 언제든 반복 전송 가능하며, 대원 앱 메시지함에 그대로 반영된다.
router.post('/dashboard/notify', (req, res) => {
  photoUpload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });

    let teams = [];
    try { teams = JSON.parse(req.body.teams || '[]'); } catch { teams = []; }
    const message = String(req.body.message || '').trim();
    const photoFile = req.file;

    if (!Array.isArray(teams) || teams.length === 0) {
      return res.status(400).json({ error: '조를 1개 이상 선택해 주세요.' });
    }
    if (!message && !photoFile) {
      return res.status(400).json({ error: '문구를 입력하거나 사진을 첨부해 주세요.' });
    }

    const targets = repo.personnelInTeams(teams);
    if (targets.length === 0) {
      return res.status(400).json({ error: '선택한 조에 배정된 인원이 없습니다.' });
    }

    const photoPath = savePhoto(photoFile);
    const results = notify.sendBulk(targets, '메시지', message || '(사진)', photoPath);
    const failCount = results.filter((r) => !r.success).length;
    res.json({ ok: true, sentCount: targets.length, failCount, photoPath });
  });
});

// Dashboard.dc.html 중앙 패널 "CSV 다운로드" — 자동응소 기록 CSV
router.get('/dashboard/csv', (req, res) => {
  const rows = repo.responseLog();
  const text = csvLib.responseLogToCsv(
    rows.map((r) => ({ ...r, recv: fmtHM(r.recv), arr: fmtHM(r.arr) }))
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="jadong_eungso_gilog.csv"');
  res.send(text);
});

module.exports = router;
