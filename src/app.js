const path = require('path');
const express = require('express');
const session = require('express-session');

const app = express();

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-only-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 },
  })
);

app.use('/api', require('./routes/auth'));
app.use('/api/posts', require('./routes/posts'));
app.use('/api', (req, res) => res.status(404).json({ error: '존재하지 않는 API입니다.' }));

app.use(express.static(path.join(__dirname, '..', 'public')));

// JSON 파싱 오류 등 처리
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '잘못된 JSON 형식입니다.' });
  }
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

module.exports = app;
