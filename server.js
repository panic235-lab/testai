'use strict';
const path = require('path');
const express = require('express');
const session = require('./src/session');
const authRoutes = require('./src/routes/auth');
const fieldRoutes = require('./src/routes/field');
const controlRoutes = require('./src/routes/control');
const adminRoutes = require('./src/routes/admin');
const appRoutes = require('./src/routes/app');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(express.json());
app.use(session.sessionMiddleware);

// 인증 화면 진입 가드 — 세션이 없으면 알맞은 로그인 화면으로
app.get('/field.html', (req, res, next) => {
  if (!req.session || req.session.role !== 'field') return res.redirect('/field-login.html');
  next();
});
app.get(['/home.html', '/stage-select.html', '/dashboard.html'], (req, res, next) => {
  if (!req.session || !['control', 'admin'].includes(req.session.role)) return res.redirect('/login.html');
  next();
});
app.get('/admin-menu.html', (req, res, next) => {
  if (!req.session || req.session.role !== 'admin') return res.redirect('/login.html?mode=admin');
  next();
});
app.get('/app-home.html', (req, res, next) => {
  if (!req.session || req.session.role !== 'app') return res.redirect('/app-login.html');
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/field', fieldRoutes);
app.use('/api/control', controlRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/app', appRoutes);

app.use(express.static(PUBLIC_DIR));

app.get('/', (req, res) => {
  if (req.session && ['control', 'admin'].includes(req.session.role)) return res.redirect('/home.html');
  if (req.session && req.session.role === 'field') return res.redirect('/field.html');
  if (req.session && req.session.role === 'app') return res.redirect('/app-home.html');
  res.redirect('/login.html');
});

app.listen(PORT, () => {
  console.log(`accio 인력동원상황실 서버 시작: http://localhost:${PORT}`);
  console.log(`- 상황실근무자/관리자 접속: http://localhost:${PORT}/login.html (상황실 공용 암호(CONTROL_PASSCODE): ${process.env.CONTROL_PASSCODE || '0000'})`);
  console.log(`- 현장 대상자(웹) 접속: http://localhost:${PORT}/field-login.html`);
  console.log(`- 대원 앱(모바일 웹) 접속: http://localhost:${PORT}/app-login.html (데모 계정: 01011112222~01088889999 / 비밀번호 1234)`);
  console.log(`- 관리자 초기 계정은 최초 실행 로그 참고, ADMIN_ID/ADMIN_PASSWORD 환경변수로 변경 권장`);
});
