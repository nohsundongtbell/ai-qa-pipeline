const express = require('express');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

function validate(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (title.length < 1 || title.length > 100) {
    return { error: '제목은 1~100자여야 합니다.' };
  }
  if (content.length < 1) {
    return { error: '내용을 입력해 주세요.' };
  }
  return { title, content };
}

const SELECT_POST = `
  SELECT p.id, p.title, p.content, p.user_id, u.nickname AS author,
         p.created_at, p.updated_at
  FROM posts p JOIN users u ON u.id = p.user_id`;

router.get('/', (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const total = db.prepare('SELECT COUNT(*) AS c FROM posts').get().c;
  const posts = db
    .prepare(
      `SELECT p.id, p.title, u.nickname AS author, p.created_at
       FROM posts p JOIN users u ON u.id = p.user_id
       ORDER BY p.id DESC LIMIT ? OFFSET ?`
    )
    .all(limit, (page - 1) * limit);
  res.json({ posts, page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) });
});

router.post('/', requireLogin, (req, res) => {
  const v = validate(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  const info = db
    .prepare('INSERT INTO posts (title, content, user_id) VALUES (?, ?, ?)')
    .run(v.title, v.content, req.session.user.id);
  res.status(201).json(db.prepare(`${SELECT_POST} WHERE p.id = ?`).get(info.lastInsertRowid));
});

router.get('/:id', (req, res) => {
  const post = db.prepare(`${SELECT_POST} WHERE p.id = ?`).get(req.params.id);
  if (!post) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
  res.json(post);
});

router.put('/:id', requireLogin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
  if (post.user_id !== req.session.user.id) {
    return res.status(403).json({ error: '본인의 글만 수정할 수 있습니다.' });
  }
  const v = validate(req.body || {});
  if (v.error) return res.status(400).json({ error: v.error });
  db.prepare(
    "UPDATE posts SET title = ?, content = ?, updated_at = datetime('now', 'localtime') WHERE id = ?"
  ).run(v.title, v.content, post.id);
  res.json(db.prepare(`${SELECT_POST} WHERE p.id = ?`).get(post.id));
});

router.delete('/:id', requireLogin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
  if (post.user_id !== req.session.user.id) {
    return res.status(403).json({ error: '본인의 글만 삭제할 수 있습니다.' });
  }
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  res.json({ message: '삭제되었습니다.' });
});

module.exports = router;
