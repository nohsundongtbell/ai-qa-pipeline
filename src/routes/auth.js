const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

const USERNAME_RE = /^[A-Za-z0-9]{4,20}$/;

router.post('/signup', (req, res) => {
  const { username, password, nickname } = req.body || {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return res.status(400).json({ error: '아이디는 영문/숫자 4~20자여야 합니다.' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' });
  }
  const nick = typeof nickname === 'string' ? nickname.trim() : '';
  if (nick.length < 2 || nick.length > 20) {
    return res.status(400).json({ error: '닉네임은 2~20자여야 합니다.' });
  }
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: '이미 사용 중인 아이디입니다.' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)')
    .run(username, hash, nick);
  res.status(201).json({ id: info.lastInsertRowid, username, nickname: nick });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user =
    typeof username === 'string' && typeof password === 'string'
      ? db.prepare('SELECT * FROM users WHERE username = ?').get(username)
      : null;
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }
  req.session.user = { id: user.id, username: user.username, nickname: user.nickname };
  res.json({ user: req.session.user });
});

router.post('/logout', requireLogin, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ message: '로그아웃 되었습니다.' });
  });
});

router.get('/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

module.exports = router;
