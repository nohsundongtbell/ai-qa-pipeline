import { test, expect, uname, createPost, errorOf } from '../helpers/fixtures';

test.describe('로그인/로그아웃 API', () => {
  test('TC-021 올바른 값으로 로그인하면 200과 세션 쿠키를 받는다 (REQ-004)', async ({ request, makeUser }) => {
    const u = await makeUser();
    const res = await request.post('/api/login', { data: { username: u.username, password: u.password } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({ id: u.id, username: u.username, nickname: u.nickname });
    expect(res.headers()['set-cookie']).toContain('connect.sid=');
  });

  test('TC-023 비밀번호가 틀리면 401이고 세션이 발급되지 않는다 (REQ-004)', async ({ request, makeUser }) => {
    const u = await makeUser();
    const res = await request.post('/api/login', { data: { username: u.username, password: 'wrongpass1' } });
    expect(res.status()).toBe(401);
    expect(res.headers()['set-cookie']).toBeUndefined();
    const me = await (await request.get('/api/me')).json();
    expect(me.user).toBeNull();
  });

  test('TC-024 없는 아이디와 틀린 비밀번호의 오류 메시지가 같다 (REQ-004)', async ({ request, makeUser }) => {
    const u = await makeUser();
    const wrongPw = await request.post('/api/login', { data: { username: u.username, password: 'wrongpass1' } });
    const noUser = await request.post('/api/login', { data: { username: uname(), password: 'wrongpass1' } });
    expect(wrongPw.status()).toBe(401);
    expect(noUser.status()).toBe(401);
    expect(await errorOf(noUser)).toBe(await errorOf(wrongPw));
  });

  test('TC-025 빈 값이나 잘못된 타입으로 로그인해도 401이며 500이 아니다 (REQ-004)', async ({ request }) => {
    const bodies: unknown[] = [
      {},
      { username: uname() },
      { password: 'password1' },
      { username: 12345678, password: 12345678 },
      { username: ['a'], password: ['b'] },
      { username: null, password: null },
    ];
    for (const data of bodies) {
      const res = await request.post('/api/login', { data });
      expect(res.status(), JSON.stringify(data)).toBe(401);
    }
  });

  test('TC-026 로그인 상태에서 /api/me는 사용자 정보를 반환한다 (REQ-004)', async ({ makeUser }) => {
    const u = await makeUser();
    const res = await u.ctx.get('/api/me');
    expect(res.status()).toBe(200);
    expect((await res.json()).user).toMatchObject({ id: u.id, username: u.username });
  });

  test('TC-027 비로그인 상태에서 /api/me의 user는 null (REQ-004)', async ({ request }) => {
    const res = await request.get('/api/me');
    expect(res.status()).toBe(200);
    expect((await res.json()).user).toBeNull();
  });

  test("TC-030 SQL 인젝션 문자열로는 로그인할 수 없다 (REQ-004)", async ({ request, makeUser }) => {
    await makeUser();
    for (const username of ["' OR '1'='1", "admin'--", "x' OR 1=1 --"]) {
      const res = await request.post('/api/login', { data: { username, password: "' OR '1'='1" } });
      expect(res.status(), username).toBe(401);
    }
  });

  test('TC-031 세션 쿠키에 HttpOnly와 SameSite 속성이 있다 (REQ-004)', async ({ request, makeUser }) => {
    const u = await makeUser();
    const res = await request.post('/api/login', { data: { username: u.username, password: u.password } });
    const cookie = res.headers()['set-cookie'];
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  test('TC-032 로그아웃하면 200이고 이후 /api/me의 user는 null (REQ-005)', async ({ makeUser }) => {
    const u = await makeUser();
    const out = await u.ctx.post('/api/logout');
    expect(out.status()).toBe(200);
    const me = await (await u.ctx.get('/api/me')).json();
    expect(me.user).toBeNull();
  });

  test('TC-034 비로그인 상태의 로그아웃은 401 (REQ-005, REQ-012)', async ({ request }) => {
    const res = await request.post('/api/logout');
    expect(res.status()).toBe(401);
  });

  test('TC-035 로그아웃한 세션 쿠키를 재사용해도 쓰기는 401 (REQ-005, REQ-012)', async ({ makeUser, newSession }) => {
    const u = await makeUser();
    const cookies = (await u.ctx.storageState()).cookies;
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    expect(cookieHeader).toContain('connect.sid=');

    // 로그아웃 전에는 저장한 쿠키로 쓰기가 가능하다 (쿠키가 유효함을 먼저 확인)
    const before = await (await newSession()).post('/api/posts', {
      headers: { Cookie: cookieHeader },
      data: { title: '로그아웃 전', content: '내용' },
    });
    expect(before.status()).toBe(201);

    expect((await u.ctx.post('/api/logout')).status()).toBe(200);

    const after = await (await newSession()).post('/api/posts', {
      headers: { Cookie: cookieHeader },
      data: { title: '로그아웃 후', content: '내용' },
    });
    expect(after.status()).toBe(401);
  });

  test('TC-103 로그인 중 다른 사용자로 재로그인하면 사용자가 바뀐다 (REQ-004)', async ({ makeUser }) => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    const res = await u1.ctx.post('/api/login', { data: { username: u2.username, password: u2.password } });
    expect(res.status()).toBe(200);
    const me = await (await u1.ctx.get('/api/me')).json();
    expect(me.user.id).toBe(u2.id);

    // U1의 권한이 남아 있지 않은지: U2로 작성한 글의 작성자는 U2
    const post = await createPost(u1.ctx);
    expect(post.user_id).toBe(u2.id);
  });

  test('TC-104 두 세션은 독립적이다 (REQ-004, REQ-005)', async ({ makeUser, newSession }) => {
    const a = await makeUser();
    const b = await newSession();
    const login = await b.post('/api/login', { data: { username: a.username, password: a.password } });
    expect(login.status()).toBe(200);

    expect((await a.ctx.post('/api/logout')).status()).toBe(200);

    expect((await (await a.ctx.get('/api/me')).json()).user).toBeNull();
    expect((await (await b.get('/api/me')).json()).user).toMatchObject({ username: a.username });
  });
});
