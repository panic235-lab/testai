// 대원 앱의 "기기 바인딩"을 브라우저 localStorage의 device id로 시뮬레이션.
// 실제 네이티브 앱이라면 단말 고유 식별자(또는 secure storage에 저장한 UUID)를 쓰겠지만,
// 이 프로토타입은 모바일 웹으로 구현되었으므로 브라우저(=기기) 단위로 영구 UUID를 생성해 저장한다.
'use strict';
function getDeviceId() {
  const KEY = 'accio_app_device_id';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : 'dev-' + Math.random().toString(36).slice(2) + Date.now());
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch (e) {
    // 사생활 보호 모드 등으로 localStorage 접근이 막힌 경우 세션 동안만 유효한 임시 id 사용
    if (!window.__accioTempDeviceId) {
      window.__accioTempDeviceId = 'temp-' + Math.random().toString(36).slice(2) + Date.now();
    }
    return window.__accioTempDeviceId;
  }
}
