import { test, expect, createPost } from '../helpers/fixtures';

test.describe('게시글 조회 API (목록 일부, 상세)', () => {
  test('TC-038 비로그인 상태에서도 목록을 조회할 수 있다 (REQ-006)', async ({ request, makeUser }) => {
    const u = await makeUser();
    await createPost(u.ctx);
    const res = await request.get('/api/posts');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.posts)).toBe(true);
    expect(body.posts.length).toBeGreaterThan(0);
  });

  test('TC-044 범위를 벗어난 page는 200과 빈 배열 (REQ-007)', async ({ request, makeUser }) => {
    const u = await makeUser();
    await createPost(u.ctx);
    const res = await request.get('/api/posts?page=99999');
    expect(res.status()).toBe(200);
    expect((await res.json()).posts).toEqual([]);
  });

  test('TC-045 잘못된 page 값은 1페이지로 보정되며 500이 아니다 (REQ-007)', async ({ request, makeUser }) => {
    const u = await makeUser();
    await createPost(u.ctx);
    for (const page of ['0', '-1', 'abc', '']) {
      const res = await request.get(`/api/posts?page=${page}`);
      expect(res.status(), `page=${page}`).toBe(200);
      expect((await res.json()).page, `page=${page}`).toBe(1);
    }
  });

  test('TC-046 잘못된 limit 값은 1~50으로 보정되며 500이 아니다 (REQ-007)', async ({ request, makeUser }) => {
    const u = await makeUser();
    await createPost(u.ctx);
    for (const limit of ['0', '-5', 'abc', '']) {
      const res = await request.get(`/api/posts?limit=${limit}`);
      expect(res.status(), `limit=${limit}`).toBe(200);
      const body = await res.json();
      expect(body.limit, `limit=${limit}`).toBeGreaterThanOrEqual(1);
      expect(body.limit, `limit=${limit}`).toBeLessThanOrEqual(50);
    }
  });

  test('TC-066 상세 조회는 모든 필드를 반환한다 (REQ-009)', async ({ request, makeUser }) => {
    const u = await makeUser();
    const post = await createPost(u.ctx, '상세 제목', '상세 내용');
    const res = await request.get(`/api/posts/${post.id}`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({
      id: post.id,
      title: '상세 제목',
      content: '상세 내용',
      author: u.nickname,
      user_id: u.id,
    });
    const body = await res.json();
    expect(body.created_at).toBeTruthy();
    expect(body.updated_at).toBeTruthy();
  });

  test('TC-068 존재하지 않는 글은 404 (REQ-009)', async ({ request }) => {
    const res = await request.get('/api/posts/999999999');
    expect(res.status()).toBe(404);
    expect((await res.json()).error).toBeTruthy();
  });

  test('TC-070 숫자가 아닌 id는 404이며 500이 아니다 (REQ-009)', async ({ request }) => {
    for (const id of ['abc', 'null', '%20']) {
      const res = await request.get(`/api/posts/${id}`);
      expect(res.status(), id).toBe(404);
    }
  });

  test('TC-106 경로와 쿼리의 SQL 인젝션 문자열이 통하지 않는다 (REQ-009, REQ-014)', async ({ request, makeUser }) => {
    const u = await makeUser();
    const post = await createPost(u.ctx);

    const inPath = await request.get(`/api/posts/${encodeURIComponent(`${post.id} OR 1=1`)}`);
    expect(inPath.status()).toBe(404);

    const inQuery = await request.get(`/api/posts?page=${encodeURIComponent('1;DROP TABLE posts')}`);
    expect(inQuery.status()).toBe(200);

    // 테이블과 데이터가 그대로 있다
    const after = await request.get(`/api/posts/${post.id}`);
    expect(after.status()).toBe(200);
  });
});
