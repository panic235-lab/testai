'use strict';
const express = require('express');
const multer = require('multer');
const session = require('../session');
const adminRepo = require('../adminRepo');
const csvLib = require('../csv');
const { parseWorkbookBuffer } = require('../xlsxParser');

const router = express.Router();
router.use(session.requireRole('admin'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const okExt = /\.(xlsx|xls|csv)$/i.test(file.originalname || '');
    if (!okExt) return cb(new Error('.xlsx, .xls, .csv 파일만 업로드할 수 있습니다.'));
    cb(null, true);
  },
});

function serializePerson(p) {
  return {
    id: p.id,
    name: p.name,
    dept: p.dept,
    rank: p.rank_title,
    phone: p.phone,
    team: p.team,
  };
}

// ---------- 인력 마스터 관리 / 비상동원조 편성 ----------

router.get('/personnel', (req, res) => {
  res.json({ personnel: adminRepo.listPersonnelFull().map(serializePerson) });
});

router.post('/personnel', (req, res) => {
  try {
    const p = adminRepo.addPersonnel(req.body || {});
    res.json({ ok: true, person: serializePerson(p) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/personnel/:id', (req, res) => {
  try {
    const p = adminRepo.updatePersonnel(Number(req.params.id), req.body || {});
    res.json({ ok: true, person: serializePerson(p) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/personnel/:id', (req, res) => {
  adminRepo.deletePersonnel(Number(req.params.id));
  res.json({ ok: true });
});

// 비상동원조 편성 화면에서 인원 클릭 -> 조 클릭으로 배정
router.post('/personnel/:id/team', (req, res) => {
  const { team } = req.body || {};
  const p = adminRepo.assignTeamToPerson(Number(req.params.id), team);
  res.json({ ok: true, person: serializePerson(p) });
});

// 비상동원조 CSV 다운로드
router.get('/personnel/csv', (req, res) => {
  const rows = adminRepo.listPersonnelFull().map(serializePerson);
  const text = csvLib.personnelToCsv(rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="bisang_dongwonjo.csv"');
  res.send(text);
});

// 비상동원조 엑셀(.xlsx/.xls) 또는 CSV 업로드 -> 실제 파싱 후 반영
router.post('/personnel/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: '업로드할 파일을 선택해 주세요.' });
    try {
      const rows = /\.csv$/i.test(req.file.originalname)
        ? csvLib.parsePersonnelCsv(req.file.buffer.toString('utf8'))
        : parseWorkbookBuffer(req.file.buffer);
      if (!rows || rows.length === 0) {
        return res.status(400).json({ error: '유효한 데이터 행이 없습니다.' });
      }
      const result = adminRepo.upsertPersonnelRows(rows);
      res.json({
        ok: true,
        fileName: req.file.originalname,
        count: result.total,
        created: result.created,
        updated: result.updated,
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
});

// ---------- 상황판 설정 ----------

router.get('/settings', (req, res) => {
  res.json({
    originButtons: adminRepo.listOriginButtons(),
    stagesByOrigin: adminRepo.listStagesByOrigin(),
  });
});

router.put('/origin-buttons/:id', (req, res) => {
  const { label } = req.body || {};
  if (!label) return res.status(400).json({ error: '버튼 이름을 입력해 주세요.' });
  const b = adminRepo.updateOriginButtonLabel(req.params.id, label);
  res.json({ ok: true, button: b });
});

router.post('/stages', (req, res) => {
  const { origin, name } = req.body || {};
  if (!origin || !name) return res.status(400).json({ error: '구분과 항목명을 입력해 주세요.' });
  const item = adminRepo.addStageItem(origin, name);
  res.json({ ok: true, item });
});

router.delete('/stages/:id', (req, res) => {
  adminRepo.deleteStageItem(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- 집결지 지정 ----------

// 주소 검색 -> 좌표 (OpenStreetMap Nominatim 프록시)
router.get('/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: '검색할 주소를 입력해 주세요.' });
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=kr&q=' + encodeURIComponent(q);
    const r = await fetch(url, {
      headers: { 'User-Agent': 'accio-inryeok-dongwon-sanghwangsil-admin/0.2 (internal prototype, non-commercial)' },
    });
    if (!r.ok) throw new Error('지도 검색 서비스가 응답하지 않습니다.');
    const data = await r.json();
    res.json({
      results: data.map((d) => ({ displayName: d.display_name, lat: Number(d.lat), lng: Number(d.lon) })),
    });
  } catch (e) {
    res.status(502).json({ error: '주소 검색에 실패했습니다: ' + e.message });
  }
});

// 집결지 1 / 집결지 2 슬롯 설정을 함께 반환 — 관리자 메뉴 재진입 시 저장된 값을 그대로 복원(프리필)하는 데 사용
router.get('/gathering', (req, res) => {
  res.json({
    configs: adminRepo.getGatheringConfigs(),
    history: adminRepo.listGatheringHistory(),
  });
});

router.post('/gathering/mode', (req, res) => {
  const { slot, override } = req.body || {};
  try {
    const config = adminRepo.setGatheringMode(slot, !!override);
    res.json({ ok: true, config });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 집결지 2는 집결지 1이 이미 저장되어 있어야만 저장 가능(adminRepo.saveGatheringArea 전제조건 검증)
router.post('/gathering', (req, res) => {
  const { slot, eventName, points } = req.body || {};
  try {
    const config = adminRepo.saveGatheringArea(slot, eventName, points);
    res.json({ ok: true, config });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- 관리자 계정 관리 ----------

router.get('/admins', (req, res) => {
  res.json({ admins: adminRepo.listAdmins() });
});

router.post('/admins', (req, res) => {
  try {
    const a = adminRepo.addAdmin(req.body || {});
    res.json({ ok: true, admin: a });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/admins/:id/active', (req, res) => {
  const { active } = req.body || {};
  adminRepo.setAdminActive(req.params.id, !!active);
  res.json({ ok: true });
});

// ---------- 기기등록코드 관리 ----------

router.get('/device-code', (req, res) => {
  res.json(adminRepo.getDeviceCode());
});

router.post('/device-code/regenerate', (req, res) => {
  res.json(adminRepo.regenerateDeviceCode());
});

module.exports = router;
