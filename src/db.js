// 데이터 계층 — Node.js 내장 node:sqlite 사용 (외부 네이티브 모듈 불필요). abracatabra의 db.js를 뼈대로
// accio 디자인(Dashboard 등)에 맞춰 스키마를 조정: 조 단위 동원계획(mobilization_plan) 테이블은 제거하고
// 대신 "집결지 지정"(gathering_config, override 기본 활성) 하나로 응소 판정을 단순화했으며,
// 대원 앱(M-A1~M-A4)을 위한 app_account(개별 계정 + 기기 바인딩) 테이블을 신규로 추가했다.
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'app.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS personnel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  team TEXT,
  dept TEXT,
  rank_title TEXT,
  status TEXT NOT NULL DEFAULT '미응소',
  stage TEXT,
  mission TEXT,
  worksite_name TEXT,
  worksite_lat REAL,
  worksite_lng REAL,
  radius_m INTEGER DEFAULT 100,
  cur_lat REAL,
  cur_lng REAL,
  loc_updated_at TEXT,
  mission_updated_at TEXT,
  arrived_at TEXT,
  ack_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS situation_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  stage TEXT,
  origin TEXT,
  activated_at TEXT
);

CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  personnel_id INTEGER,
  name TEXT,
  phone TEXT,
  type TEXT,
  message TEXT,
  status TEXT,
  attempt INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 상황판 설정(AdminMenu) 지원용 테이블
CREATE TABLE IF NOT EXISTS stage_master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  origin TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS origin_button (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

-- id=1: 집결지 1(최초 집결지), id=2: 집결지 2(집결지 1이 저장되어 있어야만 추가 가능, adminRepo에서 검증)
CREATE TABLE IF NOT EXISTS gathering_config (
  id INTEGER PRIMARY KEY CHECK (id IN (1, 2)),
  override_active INTEGER NOT NULL DEFAULT 0,
  event_name TEXT,
  points TEXT,
  area_m2 REAL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS gathering_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot INTEGER NOT NULL DEFAULT 1,
  event_name TEXT,
  points TEXT,
  area_m2 REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_account (
  id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  name TEXT,
  dept TEXT,
  role TEXT DEFAULT 'AD-1',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS device_code (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  code TEXT NOT NULL,
  updated_at TEXT
);

-- 대원 앱(M-A1~M-A4) 개별 계정 + 기기 바인딩. 계정당 1대만 등록 가능(기기등록코드로 재등록 시 이전 기기는 자동 해제).
CREATE TABLE IF NOT EXISTS app_account (
  id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  personnel_id INTEGER NOT NULL,
  device_id TEXT,
  device_registered_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// idempotent 마이그레이션 — 기존 DB 파일에도 안전하게 적용
const personnelCols = db.prepare("PRAGMA table_info(personnel)").all().map((c) => c.name);
if (!personnelCols.includes('dept')) db.exec('ALTER TABLE personnel ADD COLUMN dept TEXT');
if (!personnelCols.includes('rank_title')) db.exec('ALTER TABLE personnel ADD COLUMN rank_title TEXT');
if (!personnelCols.includes('arrived_at')) db.exec('ALTER TABLE personnel ADD COLUMN arrived_at TEXT');
if (!personnelCols.includes('ack_at')) db.exec('ALTER TABLE personnel ADD COLUMN ack_at TEXT');

const stateCols = db.prepare("PRAGMA table_info(situation_state)").all().map((c) => c.name);
if (!stateCols.includes('origin')) db.exec('ALTER TABLE situation_state ADD COLUMN origin TEXT');

const notifCols = db.prepare("PRAGMA table_info(notification_log)").all().map((c) => c.name);
if (!notifCols.includes('photo_path')) db.exec('ALTER TABLE notification_log ADD COLUMN photo_path TEXT');

// gathering_config: 기존 DB는 CHECK(id=1)로 생성되어 있어 집결지 2(id=2) 추가가 막혀 있음 —
// SQLite는 CHECK 제약을 ALTER로 바꿀 수 없으므로 새 테이블로 옮겨 심는 방식으로 1회 마이그레이션한다.
const gatherTableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'gathering_config'").get();
if (gatherTableInfo && /CHECK\s*\(\s*id\s*=\s*1\s*\)/i.test(gatherTableInfo.sql)) {
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE gathering_config_new (
        id INTEGER PRIMARY KEY CHECK (id IN (1, 2)),
        override_active INTEGER NOT NULL DEFAULT 0,
        event_name TEXT,
        points TEXT,
        area_m2 REAL,
        updated_at TEXT
      );
    `);
    db.exec('INSERT INTO gathering_config_new SELECT * FROM gathering_config;');
    db.exec('DROP TABLE gathering_config;');
    db.exec('ALTER TABLE gathering_config_new RENAME TO gathering_config;');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// gathering_history 에 slot(1|2) 컬럼 추가 — 기존 이력은 전부 집결지 1로 간주
const historyCols = db.prepare('PRAGMA table_info(gathering_history)').all().map((c) => c.name);
if (!historyCols.includes('slot')) db.exec('ALTER TABLE gathering_history ADD COLUMN slot INTEGER NOT NULL DEFAULT 1');
db.exec('UPDATE gathering_history SET slot = 1 WHERE slot IS NULL');

// situation_state 는 항상 단일 행(id=1)을 유지
const stateRow = db.prepare('SELECT * FROM situation_state WHERE id = 1').get();
if (!stateRow) {
  db.prepare('INSERT INTO situation_state (id, stage, origin, activated_at) VALUES (1, NULL, NULL, NULL)').run();
}

// gathering_config 도 항상 슬롯별(id=1: 집결지1, id=2: 집결지2) 행을 유지
const gatherRow = db.prepare('SELECT * FROM gathering_config WHERE id = 1').get();
if (!gatherRow) {
  db.prepare('INSERT INTO gathering_config (id, override_active) VALUES (1, 0)').run();
}
const gatherRow2 = db.prepare('SELECT * FROM gathering_config WHERE id = 2').get();
if (!gatherRow2) {
  db.prepare('INSERT INTO gathering_config (id, override_active) VALUES (2, 0)').run();
}

// stage_master / origin_button 초기값 시딩 (비어있을 때만)
const stageCount = db.prepare('SELECT COUNT(*) AS n FROM stage_master').get().n;
if (stageCount === 0) {
  const insStage = db.prepare('INSERT INTO stage_master (origin, name, sort_order) VALUES (?, ?, ?)');
  insStage.run('fire', '대응1단계', 0);
  insStage.run('city', '풍수해', 0);
}
const buttonCount = db.prepare('SELECT COUNT(*) AS n FROM origin_button').get().n;
if (buttonCount === 0) {
  const insBtn = db.prepare('INSERT INTO origin_button (id, label, sort_order) VALUES (?, ?, ?)');
  insBtn.run('city', '시·군·구', 0);
  insBtn.run('fire', '소방', 1);
}

// device_code 도 단일 행(id=1) 유지 — 최초 실행 시 임의 코드 발급
const deviceCodeRow = db.prepare('SELECT * FROM device_code WHERE id = 1').get();
if (!deviceCodeRow) {
  db.prepare('INSERT INTO device_code (id, code, updated_at) VALUES (1, ?, ?)').run(
    generateDeviceCode(),
    new Date().toISOString()
  );
}

// admin_account 최초 실행 시 기본 관리자 계정 시딩 (환경변수로 변경 권장)
const adminCount = db.prepare('SELECT COUNT(*) AS n FROM admin_account').get().n;
if (adminCount === 0) {
  const defaultId = process.env.ADMIN_ID || 'admin';
  const defaultPw = process.env.ADMIN_PASSWORD || 'admin1234';
  const { hash, salt } = hashPassword(defaultPw);
  db.prepare(
    `INSERT INTO admin_account (id, password_hash, salt, name, dept, role, active) VALUES (?, ?, ?, ?, ?, ?, 1)`
  ).run(defaultId, hash, salt, '기본관리자', '소방행정과', 'AD-1');
  console.log(`[초기 관리자 계정 생성] 아이디: ${defaultId} / 비밀번호: ${defaultPw} (ADMIN_ID, ADMIN_PASSWORD 환경변수로 변경 권장)`);
}

// 집결지(gathering_config) 기본값 시딩 — Dashboard.dc.html 지도의 "집결지" 마커에 대응하는 기본 동작점.
// 관리자가 "집결지 지정"에서 별도 구역을 지정하기 전까지는 대구시청 앞 소광장을 기본 집결지로 사용한다.
if (!gatherRow) {
  const { polygonAreaM2 } = require('./geo');
  const defaultPoints = [
    { lat: 35.8721, lng: 128.6007 },
    { lat: 35.8721, lng: 128.6021 },
    { lat: 35.8707, lng: 128.6021 },
    { lat: 35.8707, lng: 128.6007 },
  ];
  const areaM2 = polygonAreaM2(defaultPoints);
  const ts = new Date().toISOString();
  db.prepare(
    `UPDATE gathering_config SET override_active = 1, event_name = ?, points = ?, area_m2 = ?, updated_at = ? WHERE id = 1`
  ).run('기본 집결지(대구시청)', JSON.stringify(defaultPoints), areaM2, ts);
  db.prepare(
    `INSERT INTO gathering_history (event_name, points, area_m2, created_at) VALUES (?, ?, ?, ?)`
  ).run('기본 집결지(대구시청)', JSON.stringify(defaultPoints), areaM2, ts);
}

// 데모용 인력 마스터 + 대원 앱 계정 시딩 (personnel 테이블이 비어 있을 때만, 1회성)
const personnelCount = db.prepare('SELECT COUNT(*) AS n FROM personnel').get().n;
if (personnelCount === 0) {
  const SAMPLE = [
    { name: '김도현', dept: '소방행정과', rank: '소방위', phone: '010-1111-2222', team: 'A' },
    { name: '이서준', dept: '소방행정과', rank: '소방장', phone: '010-2222-3333', team: 'A' },
    { name: '최유나', dept: '소방행정과', rank: '소방교', phone: '010-3333-4444', team: 'A' },
    { name: '박지훈', dept: '예방안전과', rank: '소방위', phone: '010-4444-5555', team: 'B' },
    { name: '정민서', dept: '예방안전과', rank: '소방장', phone: '010-5555-6666', team: 'B' },
    { name: '한지우', dept: '예방안전과', rank: '소방사', phone: '010-6666-7777', team: 'B' },
    { name: '오세훈', dept: '구조구급과', rank: '소방경', phone: '010-7777-8888', team: 'C' },
    { name: '강태양', dept: '구조구급과', rank: '소방장', phone: '010-8888-9999', team: 'C' },
  ];
  const insPerson = db.prepare(
    `INSERT INTO personnel (name, phone, team, dept, rank_title, status) VALUES (?, ?, ?, ?, ?, '미응소')`
  );
  const insApp = db.prepare(
    `INSERT INTO app_account (id, password_hash, salt, personnel_id) VALUES (?, ?, ?, ?)`
  );
  for (const p of SAMPLE) {
    const info = insPerson.run(p.name, p.phone, p.team, p.dept, p.rank);
    const personnelId = Number(info.lastInsertRowid);
    const appId = p.phone.replace(/[^0-9]/g, '');
    const { hash, salt } = hashPassword('1234');
    insApp.run(appId, hash, salt, personnelId);
  }
  console.log('[데모 데이터 시딩] 인력 8명(A~C조) + 대원 앱 계정 8건 생성 완료 (앱 로그인 아이디=연락처 숫자만, 초기 비밀번호: 1234)');
}

function generateDeviceCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part = () => Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join('');
  return part() + '-' + part();
}

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), useSalt, 64).toString('hex');
  return { hash, salt: useSalt };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function now() {
  return new Date().toISOString();
}

module.exports = { db, now, DB_PATH, generateDeviceCode, hashPassword, verifyPassword };
