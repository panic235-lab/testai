// 비상동원조 편성 - 엑셀(.xlsx/.xls) 업로드 파싱 (SheetJS) — abracatabra 원본 로직 그대로 이식
'use strict';
const XLSX = require('xlsx');

// 헤더명은 순서가 바뀌거나 표기가 조금 달라도 인식되도록 후보를 여러 개 둔다.
const HEADER_ALIASES = {
  name: ['성명', '이름'],
  dept: ['부서명', '부서', '소속'],
  rank: ['계급', '직급'],
  phone: ['연락처', '전화번호', '휴대폰'],
  team: ['조', '비상동원조', '팀'],
};

function findColumn(headerRow, aliases) {
  for (let i = 0; i < headerRow.length; i++) {
    const cell = String(headerRow[i] || '').trim();
    if (aliases.includes(cell)) return i;
  }
  return -1;
}

/** 엑셀 파일 버퍼 -> { name, dept, rank, phone, team } 객체 배열 */
function parseWorkbookBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('시트를 찾을 수 없습니다.');
  const sheet = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  if (grid.length < 2) return [];

  const headerRow = grid[0];
  const col = {
    name: findColumn(headerRow, HEADER_ALIASES.name),
    dept: findColumn(headerRow, HEADER_ALIASES.dept),
    rank: findColumn(headerRow, HEADER_ALIASES.rank),
    phone: findColumn(headerRow, HEADER_ALIASES.phone),
    team: findColumn(headerRow, HEADER_ALIASES.team),
  };
  if (col.name === -1 || col.phone === -1) {
    throw new Error('헤더에서 "성명"/"연락처" 열을 찾을 수 없습니다. 열 구성: 성명, 부서명, 계급, 연락처, 조');
  }

  const rows = [];
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    const name = String(r[col.name] || '').trim();
    const phone = String(col.phone !== -1 ? r[col.phone] || '' : '').trim();
    if (!name || !phone) continue;
    rows.push({
      name,
      phone,
      dept: col.dept !== -1 ? String(r[col.dept] || '').trim() : '',
      rank: col.rank !== -1 ? String(r[col.rank] || '').trim() : '',
      team: col.team !== -1 ? String(r[col.team] || '').trim() : '',
    });
  }
  return rows;
}

module.exports = { parseWorkbookBuffer };
