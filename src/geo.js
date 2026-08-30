// 두 좌표 간 거리(m) 계산 — 응소 판정에 사용 (abracatabra 원본 로직 그대로 이식)
'use strict';

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Haversine 공식으로 두 지점 간 거리(m)를 반환. 좌표가 없으면 Infinity. */
function distanceMeters(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v === null || v === undefined || Number.isNaN(Number(v)))) {
    return Infinity;
  }
  const R = 6371000; // 지구 반지름(m)
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Ray casting 알고리즘 — 점(lat,lng)이 폴리곤(points: [{lat,lng}, ...]) 내부에 있는지 판정 */
function pointInPolygon(lat, lng, points) {
  if (!Array.isArray(points) || points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].lng, yi = points[i].lat;
    const xj = points[j].lng, yj = points[j].lat;
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 폴리곤 면적(㎡) — 위경도를 첫 점 기준 평면좌표(m)로 근사 환산 후 Shoelace 공식 적용 */
function polygonAreaM2(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  const meanLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(toRad(meanLat));
  const xy = points.map((p) => ({
    x: (p.lng - points[0].lng) * mPerDegLng,
    y: (p.lat - points[0].lat) * mPerDegLat,
  }));
  let area = 0;
  for (let i = 0; i < xy.length; i++) {
    const j = (i + 1) % xy.length;
    area += xy[i].x * xy[j].y - xy[j].x * xy[i].y;
  }
  return Math.abs(area) / 2;
}

/** 폴리곤 중심점(centroid, 산술 평균) — 현장 화면에서 목표지점(집결지) 표시용 */
function polygonCentroid(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const lat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const lng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  return { lat, lng };
}

module.exports = { distanceMeters, pointInPolygon, polygonAreaM2, polygonCentroid };
