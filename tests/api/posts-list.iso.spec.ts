// 전체 글 개수에 의존하는 테스트: 테스트마다 DB를 비우고 시작한다 (전용 서버/DB, 순차 실행).
import { test, expect, createPost } from '../helpers/fixtures';
import { resetDb } from '../helpers/db';
import { ISO_API } from '../helpers/env';

test.beforeEach(() => resetDb(ISO_API.db));

async function seed(ctx: Parameters<typeof createPost>[0], n: number) {
  const ids: number[] = [];
  for (let i = 1; i <= n; i++) ids.push((await createPost(ctx, `글 ${i}`, `내용 ${i}`)).id);
  return ids;
}

test.describe('게시글 목록 API (격리 DB)', () => {
  test('TC-039 목록에는 작성자 닉네임이 표시되고 민감정보는 없다 (REQ-006)', async ({ request, makeUser }) => {
    const u = await makeUser({ nickname: '에이' });
    await createPost(u.ctx, '작성자 확인', '내용');
    const res = await request.get('/api/posts');
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.posts[0].author).toBe('에이');
    expect(text).not.toMatch(/password|hash/i);
    expect(text).not.toContain(u.username);
  });

  test('TC-040 기본 페이지 크기는 10 (REQ-007)', async ({ request, makeUser }) => {
    const u = await makeUser();
    await seed(u.ctx, 11);
    const body = await (await request.get('/api/posts')).json();
    expect(body.posts).toHaveLength(10);
    expect(body).toMatchObject({ page: 1, limit: 10, total: 11, totalPages: 2 });
  });

  test('TC-041 글이 정확히 10개면 totalPages는 1 (경계, REQ-007)', async ({ request, makeUser }) => {
    const u = await makeUser();
    await seed(u.ctx, 10);
    const body = await (await request.get('/api/posts')).json();
    expect(body.posts).toHaveLength(10);
    expect(body).toMatchObject({ total: 10, totalPages: 1 });
  });

  test('TC-042 2페이지에는 가장 오래된 글이 있다 (REQ-007)', async ({ request, makeUser }) => {
    const u = await makeUser();
    const ids = await seed(u.ctx, 11);
    const body = await (await request.get('/api/posts?page=2')).json();
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0].id).toBe(ids[0]);
  });

  test('TC-048 limit 상한은 50 (REQ-007)', async ({ request, makeUser }) => {
    const u = await makeUser();
    await seed(u.ctx, 55);
    const body = await (await request.get('/api/posts?limit=100')).json();
    expect(body.limit).toBe(50);
    expect(body.posts).toHaveLength(50);
    expect(body.totalPages).toBe(2);
  });

  test('TC-091 삭제 후 total과 totalPages가 갱신된다 (REQ-007, REQ-011)', async ({ request, makeUser }) => {
    const u = await makeUser();
    const ids = await seed(u.ctx, 11);
    expect((await (await request.get('/api/posts')).json()).totalPages).toBe(2);
    expect((await u.ctx.delete(`/api/posts/${ids[0]}`)).status()).toBe(200);
    const body = await (await request.get('/api/posts')).json();
    expect(body).toMatchObject({ total: 10, totalPages: 1 });
  });
});
