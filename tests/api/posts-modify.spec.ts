import { test, expect, createPost } from '../helpers/fixtures';

test.describe('게시글 수정 API', () => {
  test('TC-075 본인 글을 수정하면 200이고 updated_at이 갱신된다 (REQ-010)', async ({ makeUser }) => {
    const u = await makeUser();
    const post = await createPost(u.ctx, '원래 제목', '원래 내용');
    await new Promise((r) => setTimeout(r, 1100)); // 시각(초 단위)이 달라지도록 대기

    const res = await u.ctx.put(`/api/posts/${post.id}`, { data: { title: '새 제목', content: '새 내용' } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ title: '새 제목', content: '새 내용' });
    expect(body.updated_at > body.created_at).toBe(true);
  });

  test('TC-077 타인 글 수정은 403이고 내용이 바뀌지 않는다 (REQ-010)', async ({ makeUser }) => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    const post = await createPost(u1.ctx, '원본 제목', '원본 내용');

    const res = await u2.ctx.put(`/api/posts/${post.id}`, { data: { title: '탈취', content: '탈취' } });
    expect(res.status()).toBe(403);

    const after = await (await u1.ctx.get(`/api/posts/${post.id}`)).json();
    expect(after).toMatchObject({ title: '원본 제목', content: '원본 내용' });
  });

  test('TC-078 비로그인 수정은 401이고 내용이 바뀌지 않는다 (REQ-012)', async ({ request, makeUser }) => {
    const u = await makeUser();
    const post = await createPost(u.ctx, '원본 제목', '원본 내용');
    const res = await request.put(`/api/posts/${post.id}`, { data: { title: '변경', content: '변경' } });
    expect(res.status()).toBe(401);
    const after = await (await u.ctx.get(`/api/posts/${post.id}`)).json();
    expect(after.title).toBe('원본 제목');
  });

  test('TC-079 없는 글 수정은 404 (REQ-010)', async ({ makeUser }) => {
    const u = await makeUser();
    const res = await u.ctx.put('/api/posts/999999999', { data: { title: '제목', content: '내용' } });
    expect(res.status()).toBe(404);
  });

  test('TC-080 수정 시에도 입력 검증이 적용되고 기존 내용이 유지된다 (REQ-010, REQ-013)', async ({ makeUser }) => {
    const u = await makeUser();
    const post = await createPost(u.ctx, '유지될 제목', '유지될 내용');
    const cases = [
      { title: '', content: '내용' },
      { title: '가'.repeat(101), content: '내용' },
      { title: '제목', content: '' },
    ];
    for (const data of cases) {
      const res = await u.ctx.put(`/api/posts/${post.id}`, { data });
      expect(res.status(), JSON.stringify(data).slice(0, 40)).toBe(400);
    }
    const after = await (await u.ctx.get(`/api/posts/${post.id}`)).json();
    expect(after).toMatchObject({ title: '유지될 제목', content: '유지될 내용' });
  });

  test('TC-082 수정해도 작성자와 작성일은 바뀌지 않는다 (REQ-010)', async ({ makeUser }) => {
    const u = await makeUser();
    const post = await createPost(u.ctx);
    const res = await u.ctx.put(`/api/posts/${post.id}`, { data: { title: '수정', content: '수정' } });
    const body = await res.json();
    expect(body.user_id).toBe(post.user_id);
    expect(body.author).toBe(post.author);
    expect(body.created_at).toBe(post.created_at);
  });

  test('TC-083 수정 요청에 user_id를 넣어도 작성자는 바뀌지 않는다 (REQ-010)', async ({ makeUser }) => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    const post = await createPost(u1.ctx);
    const res = await u1.ctx.put(`/api/posts/${post.id}`, {
      data: { title: '수정', content: '수정', user_id: u2.id },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.user_id).toBe(u1.id);
    expect(body.author).toBe(u1.nickname);
  });
});

test.describe('게시글 삭제 API', () => {
  test('TC-084 본인 글을 삭제하면 200이고 상세는 404, 목록에서 사라진다 (REQ-011)', async ({ makeUser }) => {
    const u = await makeUser();
    const post = await createPost(u.ctx);
    const res = await u.ctx.delete(`/api/posts/${post.id}`);
    expect(res.status()).toBe(200);

    expect((await u.ctx.get(`/api/posts/${post.id}`)).status()).toBe(404);
    const list = await (await u.ctx.get('/api/posts?limit=50')).json();
    expect(list.posts.map((p: { id: number }) => p.id)).not.toContain(post.id);
  });

  test('TC-087 타인 글 삭제는 403이고 글이 남아 있다 (REQ-011)', async ({ makeUser }) => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    const post = await createPost(u1.ctx);
    const res = await u2.ctx.delete(`/api/posts/${post.id}`);
    expect(res.status()).toBe(403);
    expect((await u1.ctx.get(`/api/posts/${post.id}`)).status()).toBe(200);
  });

  test('TC-088 비로그인 삭제는 401이고 글이 남아 있다 (REQ-012)', async ({ request, makeUser }) => {
    const u = await makeUser();
    const post = await createPost(u.ctx);
    const res = await request.delete(`/api/posts/${post.id}`);
    expect(res.status()).toBe(401);
    expect((await u.ctx.get(`/api/posts/${post.id}`)).status()).toBe(200);
  });

  test('TC-089 없는 글 삭제는 404 (REQ-011)', async ({ makeUser }) => {
    const u = await makeUser();
    const res = await u.ctx.delete('/api/posts/999999999');
    expect(res.status()).toBe(404);
  });

  test('TC-090 이미 삭제한 글을 다시 삭제하면 404 (REQ-011)', async ({ makeUser }) => {
    const u = await makeUser();
    const post = await createPost(u.ctx);
    expect((await u.ctx.delete(`/api/posts/${post.id}`)).status()).toBe(200);
    expect((await u.ctx.delete(`/api/posts/${post.id}`)).status()).toBe(404);
  });
});
