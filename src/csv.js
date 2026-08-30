// 최소 CSV 파서/생성기. 외부 의존성 없이 큰따옴표 이스케이프까지 지원 (abracatabra 원본 파서 로직 재사용).
'use strict';

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function escapeCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const PERSONNEL_HEADERS = ['성명', '부서명', '계급', '연락처', '조'];

/** 인력 마스터/비상동원조 편성 레코드 배열 -> CSV 텍스트 (엑셀 업로드와 동일한 열 구성) */
function personnelToCsv(rows) {
  const lines = [PERSONNEL_HEADERS.join(',')];
  for (const r of rows) {
    lines.push([r.name, r.dept, r.rank, r.phone, r.team].map(escapeCell).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n'; // 엑셀 호환 위해 BOM 포함
}

/** 인력 마스터 CSV 텍스트(성명,부서명,계급,연락처,조) -> 객체 배열. personnelToCsv 의 역함수 */
function parsePersonnelCsv(text) {
  const clean = stripBom(String(text)).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = clean.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i]);
    if (cells.length < 4) continue;
    const [name, dept, rank, phone, team] = cells;
    if (!name || !phone) continue;
    rows.push({ name, dept, rank, phone, team });
  }
  return rows;
}

const RESPONSE_LOG_HEADERS = ['연번', '소집수령', '응소시간', '조', '부서명', '계급', '성명', '응소반경(m)'];

/** Dashboard 중앙 패널 "자동응소 기록 CSV" — 응소(도착) 인원의 소집수령/응소시간 기록 */
function responseLogToCsv(rows) {
  const lines = [RESPONSE_LOG_HEADERS.join(',')];
  rows.forEach((r, i) => {
    lines.push(
      [i + 1, r.recv, r.arr, r.team, r.dept, r.rank, r.name, r.radius].map(escapeCell).join(',')
    );
  });
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = { personnelToCsv, parsePersonnelCsv, responseLogToCsv, PERSONNEL_HEADERS, RESPONSE_LOG_HEADERS };
