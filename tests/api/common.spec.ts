import { test, expect, createPost, uname } from '../helpers/fixtures';

test.describe('REST API 공통', () => {
  test('TC-092 존재하지 않는 API 경로는 404 JSON (REQ-014)', async ({ request }) => {
    const res = await request.get('/api/unknown');
    expect(res.status()).toBe(404);
    expect(res.headers()['content-type']).toContain('application/json');
    expect((await res.json()).error).toBeTruthy();
  });

  test('TC-093 성공과 실패 응답 모두 application/json (REQ-014)', async ({ request, makeUser }) => {
    const u = await makeUser();
    const post = await createPost(u.ctx);
    const responses = [
      await request.get('/api/me'),
      await request.get('/api/posts'),
      await request.get(`/api/posts/${post.id}`),
      await request.post('/api/login', { data: { username: uname(), password: 'wrongpass1' } }),
      await request.post('/api/posts', { data: { title: 't', content: 'c' } }),
      await request.get('/api/posts/999999999'),
    ];
    for (const res of responses) {
      expect(res.headers()['content-type'], res.url()).toContain('application/json');
    }
  });

  test('TC-094 오류 응답은 모두 { error: 문자열 } 형태 (REQ-014)', async ({ request, makeUser }) => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    const post = await createPost(u1.ctx);
    const errors = [
      [400, await u1.ctx.post('/api/posts', { data: { title: '', content: '' } })],
      [401, await request.post('/api/posts', { data: { title: 't', content: 'c' } })],
      [403, await u2.ctx.put(`/api/posts/${post.id}`, { data: { title: 't', content: 'c' } })],
      [404, await request.get('/api/posts/999999999')],
      [409, await request.post('/api/signup', { data: { username: u1.username, password: 'password1', nickname: '중복' } })],
    ] as const;
    for (const [status, res] of errors) {
      expect(res.status()).toBe(status);
      const body = await res.json();
      expect(Object.keys(body)).toEqual(['error']);
      expect(typeof body.error).toBe('string');
      expect(body.error.length).toBeGreaterThan(0);
    }
  });

  test('TC-095 지원하지 않는 메서드/경로 조합은 404 JSON이며 500이 아니다 (REQ-014)', async ({ makeUser }) => {
    const u = await makeUser();
    for (const method of ['put', 'delete', 'patch'] as const) {
      const res = await u.ctx[method]('/api/posts', { data: { title: 't', content: 'c' } });
      expect(res.status(), method).toBe(404);
      expect((await res.json()).error).toBeTruthy();
    }
  });
});
