import { test, expect, rand, createPost } from '../helpers/fixtures';

test.describe('게시글 작성 API', () => {
  test('TC-049 로그인 후 글을 작성하면 201이고 작성자가 기록된다 (REQ-008)', async ({ makeUser }) => {
    const u = await makeUser();
    const res = await u.ctx.post('/api/posts', { data: { title: '첫 글', content: '본문' } });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ title: '첫 글', content: '본문', author: u.nickname, user_id: u.id });
    expect(body.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('TC-051 비로그인 글 작성은 401이고 글이 생성되지 않는다 (REQ-012)', async ({ request, makeUser }) => {
    const u = await makeUser();
    const title = '비로그인 ' + rand(8);
    const res = await request.post('/api/posts', { data: { title, content: '내용' } });
    expect(res.status()).toBe(401);
    const list = await (await u.ctx.get('/api/posts?limit=50')).json();
    expect(list.posts.map((p: { title: string }) => p.title)).not.toContain(title);
  });

  test('TC-053 제목이 빈 값이면 400 (REQ-013)', async ({ makeUser }) => {
    const u = await makeUser();
    const res = await u.ctx.post('/api/posts', { data: { title: '', content: '내용' } });
    expect(res.status()).toBe(400);
  });

  test('TC-054 제목 1자는 201 (최소, REQ-013)', async ({ makeUser }) => {
    const u = await makeUser();
    const res = await u.ctx.post('/api/posts', { data: { title: '가', content: '내용' } });
    expect(res.status()).toBe(201);
  });

  test('TC-055 제목 100자는 201이고 전체가 저장된다 (최대, REQ-013)', async ({ makeUser }) => {
    const u = await makeUser();
    const title = '가'.repeat(100);
    const res = await u.ctx.post('/api/posts', { data: { title, content: '내용' } });
    expect(res.status()).toBe(201);
    expect((await res.json()).title).toBe(title);
  });

  test('TC-056 제목 101자는 400 (최대 초과, REQ-013)', async ({ makeUser }) => {
    const u = await makeUser();
    const res = await u.ctx.post('/api/posts', { data: { title: '가'.repeat(101), content: '내용' } });
    expect(res.status()).toBe(400);
  });

  test('TC-057 제목이 공백만이면 400 (REQ-013)', async ({ makeUser }) => {
    const u = await makeUser();
    const res = await u.ctx.post('/api/posts', { data: { title: '   ', content: '내용' } });
    expect(res.status()).toBe(400);
  });

  test('TC-058 내용이 빈 값이거나 공백만이면 400 (REQ-013)', async ({ makeUser }) => {
    const u = await makeUser();
    for (const content of ['', '   ']) {
      const res = await u.ctx.post('/api/posts', { data: { title: '제목', content } });
      expect(res.status(), JSON.stringify(content)).toBe(400);
    }
  });

  test('TC-059 문자열이 아닌 타입은 400이며 500이 아니다 (REQ-013)', async ({ makeUser }) => {
    const u = await makeUser();
    const bad: unknown[] = [12345, ['a'], null, { a: 1 }, true];
    for (const field of ['title', 'content'] as const) {
      for (const value of bad) {
        const res = await u.ctx.post('/api/posts', {
          data: { title: '제목', content: '내용', [field]: value },
        });
        expect(res.status(), `${field}=${JSON.stringify(value)}`).toBe(400);
      }
    }
  });

  test('TC-060 잘못된 JSON 본문은 400이며 500이 아니다 (REQ-013)', async ({ makeUser }) => {
    const u = await makeUser();
    const res = await u.ctx.post('/api/posts', {
      headers: { 'Content-Type': 'application/json' },
      data: Buffer.from('{bad'),
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });

  test('TC-063 한글, 이모지, 특수문자가 그대로 저장되고 조회된다 (REQ-008)', async ({ makeUser }) => {
    const u = await makeUser();
    const title = '한글 😀 & < > " \' 제목';
    const content = '내용 🎉\n두 번째 줄 <b>bold</b> & "quote" \'single\'';
    const created = await createPost(u.ctx, title, content);
    const got = await (await u.ctx.get(`/api/posts/${created.id}`)).json();
    expect(got.title).toBe(title);
    expect(got.content).toBe(content);
  });

  test('TC-065 매우 큰 본문은 4xx로 거절되고 500이 아니다 (REQ-013)', async ({ makeUser }) => {
    const u = await makeUser();
    const res = await u.ctx.post('/api/posts', {
      data: { title: '큰 본문', content: 'a'.repeat(200 * 1024) },
    });
    expect([400, 413]).toContain(res.status());
    expect((await res.json()).error).toBeTruthy();
  });

  test('TC-105 작성 요청에 user_id를 넣어도 작성자는 로그인 사용자다 (REQ-008)', async ({ makeUser }) => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    const res = await u1.ctx.post('/api/posts', {
      data: { title: '작성자 변조', content: '내용', user_id: u2.id },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.user_id).toBe(u1.id);
    expect(body.author).toBe(u1.nickname);
  });
});
