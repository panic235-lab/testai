# accio 인력동원상황실

비상상황(재난·화재 등) 발생 시 상황실이 비상동원조에 동원명령을 발령하고, 대상자의 응소(도착) 여부를 실시간으로 확인하는 실동작 웹앱입니다. `D:\accio\design-workfiles`의 accio 디자인(특히 `Dashboard.dc.html`)을 실제 화면 레이아웃·색상·문구로 그대로 반영했고, `D:\abracatabra1\abracatabra` 1차 프로토타입의 서버 로직(세션, 위치 기반 응소 판정, 알림 목업, 엑셀/CSV 처리)을 뼈대로 이식했습니다.

## 실행 방법

```bash
npm install
npm start          # 또는: node server.js
# 포트 지정 시: PORT=3099 node server.js (PowerShell: $env:PORT=3099; node server.js)
```

서버가 뜨면 콘솔에 접속 안내가 출력됩니다.

| 진입점 | URL | 인증 방식 |
|---|---|---|
| 상황실근무자 / 관리자 | `/login.html` | 상황실 공용 암호(`CONTROL_PASSCODE`, 기본 `0000`) 또는 관리자 아이디/비밀번호 |
| 현장 대상자(웹) | `/field-login.html` | 이름 + 연락처 (인력 마스터 명단 대조) |
| 대원 앱(모바일 웹) | `/app-login.html` | 개별 아이디/비밀번호 + 기기 바인딩 |

최초 실행 시 관리자 계정(`admin` / `admin1234`, `ADMIN_ID`/`ADMIN_PASSWORD` 환경변수로 변경 가능)과 데모 인력 8명(A~C조), 대원 앱 계정 8건(아이디 = 연락처 숫자만, 초기 비밀번호 `1234`)이 자동 시딩됩니다. 데이터는 `data/app.db`(SQLite, Node 내장 `node:sqlite`)에 저장되며 `.gitignore`로 제외됩니다.

## 화면 구성

- `login.html` — 상황실/관리자 로그인 (좌: 브랜드 패널, 우: 로그인 카드, 상황판↔관리자 전환)
- `home.html` — 초기화면(상황 유형 선택: 시·군·구 / 소방)
- `stage-select.html` — 상황단계 선택
- `dashboard.html` — **상황판** (좌 296px 비상동원조 편성 / 중앙 지도+자동응소 CSV / 우 380px 응소현황, `Dashboard.dc.html` 그대로 반영)
- `admin-menu.html` — 관리자 메뉴 (인력마스터 / 비상동원조 편성 / 상황판 설정 / 집결지 지정 / 관리자 계정 / 기기등록코드, `AdminMenu.dc.html` 반영)
- `field-login.html` / `field.html` — 현장 대상자 웹 화면 (이름+연락처 로그인, 지도·임무·응소상태, 위치정보 동의)
- `app-login.html` / `app-device-register.html` / `app-home.html` — 대원 앱(모바일 웹) 로그인·기기등록·메시지함(`AppHome.dc.html` 반영, 목록↔상세 전환)

## Dashboard 디자인 일치 여부

`public/dashboard.html`을 `design-workfiles/Dashboard.dc.html`과 1:1 대조하여 검증·수정했습니다.

- 레이아웃: `grid-template-columns: 296px 1fr 380px`, `gap:16px`, `padding:18px 24px` 동일
- 색상 변수(oklch 다크 테마) 전부 동일: `--bg`, `--bg-panel`, `--bg-panel-2`, `--bg-hover`, `--border`, `--text`, `--text-dim`, `--text-faint`, `--blue`, `--red`, `--amber`, `--green`
- 컴포넌트 클래스(`.card`, `.chip`, `.team-row`, `.checkbox`, `.resp-row`, `.dot`, `.pulse` 애니메이션, 테이블 스타일) 동일
- 문구: "비상동원조 편성", "조를 선택하고 동원명령을 발령하세요", "자동응소 기록 CSV", "CSV 다운로드", "응소 현황", "미응소/접속(이동중)/응소(도착)" 범례, 빈 상태 안내문 등 원문 그대로
- 지도 갱신 주기 라벨을 디자인 원문 "30초 주기 갱신"에 맞춰 실제 폴링 주기도 30초로 통일(검수 중 10초로 되어 있던 것을 수정)
- 관리자 메뉴 버튼 링크를 존재하지 않던 `/admin.html`에서 실제 구현한 `/admin-menu.html`로 수정(서버 가드 라우트도 동일하게 변경)

디자인과 다른 부분은 모두 "정적 목업 → 실동작 앱" 전환에 따른 의도적 차이입니다: 조 목록/응소 현황/CSV는 실시간 API 데이터, 발령 버튼은 실제 알림 발송을 트리거, 상단 상황유형/상황단계 배지와 로그인 사용자 정보는 세션 값을 표시합니다.

## abracatabra 대비 추가/차이점

- **대원 앱은 신규 구현입니다.** abracatabra 1차 프로토타입에는 상황실(`control`)·관리자(`admin`)·현장(`field`) 웹만 있었고 모바일 앱 개념이 없었습니다. 이번 버전은 `app_account` 테이블(개별 계정 + 기기 바인딩), `src/appAuth.js`, `src/routes/app.js`, `app-login.html`/`app-device-register.html`/`app-home.html`을 새로 추가했습니다. 기기 바인딩은 네이티브 앱이 아니므로 `public/js/device-id.js`가 브라우저 `localStorage`에 저장하는 영구 UUID로 시뮬레이션합니다.
- **응소 판정 로직 단순화**: abracatabra의 `mobilization_plan`(조별 임무표) 테이블 대신 "집결지 지정"(`gathering_config`, 4점 폴리곤) 하나로 통합했습니다. 활성 집결지가 있으면 폴리곤 포함 여부로, 없으면 개인별 근무지 좌표+반경으로 판정합니다(abracatabra 방식과 호환).
- **관리자 메뉴 신설**: abracatabra의 `admin.html`은 훨씬 단순했고, 이번 버전은 `AdminMenu.dc.html`의 6개 탭(인력마스터/비상동원조 편성/상황판 설정/집결지 지정/관리자 계정/기기등록코드)을 실제 API(`src/routes/admin.js`, `src/adminRepo.js`)와 연동한 SPA 형태로 새로 구현했습니다. 엑셀(.xlsx/.xls)·CSV 업로드/다운로드, 조 배정 클릭 UI, 지도 클릭 기반 집결지 4점 지정 + 주소 검색(OpenStreetMap Nominatim), 관리자 계정 활성화 토글, 기기등록코드 재발급을 모두 실동작으로 붙였습니다.
- **알림 발송은 abracatabra와 동일하게 목업**입니다(`src/notify.js`, 실패율 10%로 재시도 UI 확인용). 실제 카카오톡 알림톡/비즈메시지 연동 시 `mockTransmit()` 부분만 교체하면 됩니다.
- **CSV/엑셀 파서**는 abracatabra 원본 로직(`src/csv.js`, `src/xlsxParser.js`)을 그대로 재사용했습니다.

## 서버 기동 및 스모크 테스트 결과 (검증 완료)

`PORT=3099 node server.js`로 기동 후 확인:

- 정적 페이지: `login.html`(200), `field-login.html`(200), `app-login.html`(200)
- 인증 가드: 세션 없이 `dashboard.html`/`admin-menu.html`/`field.html`/`app-home.html` 접근 시 각각 올바른 로그인 화면으로 302 리다이렉트
- 관리자 로그인 → `dashboard.html`(200), `admin-menu.html`(200), `/api/control/dashboard`, `/api/admin/personnel`, `/api/admin/gathering`, `/api/admin/device-code` 정상 응답
- 동원명령 발령(`POST /api/control/dashboard/dispatch`) → 대상 조 인원 상태 갱신 + 알림 로그 기록 확인
- 현장 로그인(이름+연락처) → `field.html`(200), `/api/field/me` 임무·집결지 정보 정상 반영
- 대원 앱 로그인(아이디+비밀번호+기기ID) → 최초 로그인 시 기기 자동 등록, `app-home.html`(200), `/api/app/me`, `/api/app/messages` 정상 응답 (동원명령 발령 시 메시지함에 즉시 반영됨)
- 인력 마스터 CSV 다운로드(`/api/admin/personnel/csv`) 정상 생성(BOM 포함 CSV)

테스트에 사용한 개발용 SQLite 파일(`data/app.db`)은 검증 후 삭제했습니다 — 다음 실행 시 자동으로 재시딩됩니다.

## 알려진 한계

- 세션은 메모리에만 저장되므로 서버 재시작 시 모든 로그인 세션이 초기화됩니다(프로토타입 범위).
- 비상동원조는 A~F 6개 조로 고정되어 있습니다(디자인 반영). 그 이상의 조 체계가 필요하면 `public/admin-menu.html`의 `TEAM_IDS`와 팀 컬럼 UI를 확장해야 합니다.
- 지도는 실제 타일 지도가 아니라 좌표를 %로 환산해 표시하는 추상화된 격자 배경입니다(디자인 원안과 동일한 방식).
- 알림 발송은 목업(성공/실패를 임의 확률로 시뮬레이션)이며 실제 카카오톡 연동은 되어 있지 않습니다.
- `sample_data/`는 비어 있는 자리표시자 폴더로 남아 있습니다(엑셀 업로드 테스트용 샘플 파일이 필요하면 추가해야 합니다).
