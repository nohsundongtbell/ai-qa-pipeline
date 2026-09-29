import { test, expect, rand, uname, errorOf } from '../helpers/fixtures';
import { getUserRow } from '../helpers/db';
import { MAIN } from '../helpers/env';

const valid = () => ({ username: uname(), password: 'password1', nickname: '닉' + rand(4) });

test.describe('회원가입 API', () => {
  test('TC-001 유효한 값으로 가입 시 201과 사용자 정보를 반환한다 (REQ-001)', async ({ request }) => {
    const data = valid();
    const res = await request.post('/api/signup', { data });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ username: data.username, nickname: data.nickname });
    expect(body.id).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(/password|hash/i);
  });

  test('TC-003 중복 아이디로 가입하면 409 (REQ-002)', async ({ request }) => {
    const data = valid();
    expect((await request.post('/api/signup', { data })).status()).toBe(201);
    const res = await request.post('/api/signup', { data: { ...data, nickname: '다른' + rand(3) } });
    expect(res.status()).toBe(409);
    expect(await errorOf(res)).toContain('이미 사용 중');
  });

  test('TC-004 아이디 3자는 400 (최소 미만, REQ-013)', async ({ request }) => {
    const res = await request.post('/api/signup', { data: { ...valid(), username: rand(3) } });
    expect(res.status()).toBe(400);
  });

  test('TC-005 아이디 4자는 201 (최소, REQ-013)', async ({ request }) => {
    const res = await request.post('/api/signup', { data: { ...valid(), username: rand(4) } });
    expect(res.status()).toBe(201);
  });

  test('TC-006 아이디 20자는 201 (최대, REQ-013)', async ({ request }) => {
    const res = await request.post('/api/signup', { data: { ...valid(), username: rand(20) } });
    expect(res.status()).toBe(201);
  });

  test('TC-007 아이디 21자는 400 (최대 초과, REQ-013)', async ({ request }) => {
    const res = await request.post('/api/signup', { data: { ...valid(), username: rand(21) } });
    expect(res.status()).toBe(400);
  });

  test('TC-008 아이디에 공백, 특수문자, 한글이 있으면 400 (REQ-013)', async ({ request }) => {
    for (const bad of ['ab cd', 'ab!cd', '가나다라', 'ab-cd', 'ab_cd']) {
      const res = await request.post('/api/signup', { data: { ...valid(), username: bad } });
      expect(res.status(), `아이디 "${bad}"`).toBe(400);
    }
  });

  test('TC-009 비밀번호 7자는 400 (최소 미만, REQ-013)', async ({ request }) => {
    const res = await request.post('/api/signup', { data: { ...valid(), password: 'a'.repeat(7) } });
    expect(res.status()).toBe(400);
  });

  test('TC-010 비밀번호 8자는 201 (최소, REQ-013)', async ({ request }) => {
    const res = await request.post('/api/signup', { data: { ...valid(), password: 'a'.repeat(8) } });
    expect(res.status()).toBe(201);
  });

  test('TC-011 닉네임 1자는 400 (최소 미만, REQ-013)', async ({ request }) => {
    const res = await request.post('/api/signup', { data: { ...valid(), nickname: '가' } });
    expect(res.status()).toBe(400);
  });

  test('TC-012 닉네임 2자는 201 (최소, REQ-013)', async ({ request }) => {
    const res = await request.post('/api/signup', { data: { ...valid(), nickname: '가나' } });
    expect(res.status()).toBe(201);
  });

  test('TC-013 닉네임 20자는 201 (최대, REQ-013)', async ({ request }) => {
    const res = await request.post('/api/signup', { data: { ...valid(), nickname: '가'.repeat(20) } });
    expect(res.status()).toBe(201);
  });

  test('TC-014 닉네임 21자는 400 (최대 초과, REQ-013)', async ({ request }) => {
    const res = await request.post('/api/signup', { data: { ...valid(), nickname: '가'.repeat(21) } });
    expect(res.status()).toBe(400);
  });

  test('TC-015 닉네임 앞뒤 공백은 제거되어 저장된다 (REQ-013)', async ({ request, newSession }) => {
    const data = { ...valid(), nickname: ' 에이 ' };
    expect((await request.post('/api/signup', { data })).status()).toBe(201);

    const ctx = await newSession();
    await ctx.post('/api/login', { data: { username: data.username, password: data.password } });
    const me = await (await ctx.get('/api/me')).json();
    expect(me.user.nickname).toBe('에이');

    const short = await request.post('/api/signup', { data: { ...valid(), nickname: ' a ' } });
    expect(short.status()).toBe(400);
  });

  test('TC-016 필수값이 누락되면 400 (REQ-013)', async ({ request }) => {
    expect((await request.post('/api/signup', { data: {} })).status()).toBe(400);
    for (const key of ['username', 'password', 'nickname'] as const) {
      const data: Record<string, string> = { ...valid() };
      delete data[key];
      const res = await request.post('/api/signup', { data });
      expect(res.status(), `${key} 누락`).toBe(400);
    }
  });

  test('TC-017 문자열이 아닌 타입은 400이며 500이 아니다 (REQ-013)', async ({ request }) => {
    const bad: unknown[] = [12345678, ['a', 'b'], null, { a: 1 }, true];
    for (const field of ['username', 'password', 'nickname'] as const) {
      for (const value of bad) {
        const res = await request.post('/api/signup', { data: { ...valid(), [field]: value } });
        expect(res.status(), `${field}=${JSON.stringify(value)}`).toBe(400);
      }
    }
  });

  test('TC-019 비밀번호는 bcrypt 해시로 저장된다 (REQ-003)', async ({ request }) => {
    const data = { ...valid(), password: 'password1' };
    expect((await request.post('/api/signup', { data })).status()).toBe(201);
    const row = getUserRow(MAIN.db, data.username);
    expect(row).toBeDefined();
    expect(row!.password_hash).toMatch(/^\$2[aby]\$/);
    expect(row!.password_hash).not.toBe('password1');
  });

  test('TC-020 같은 비밀번호여도 해시가 서로 다르다 (salt, REQ-003)', async ({ request }) => {
    const a = valid();
    const b = valid();
    expect((await request.post('/api/signup', { data: a })).status()).toBe(201);
    expect((await request.post('/api/signup', { data: b })).status()).toBe(201);
    expect(getUserRow(MAIN.db, a.username)!.password_hash).not.toBe(
      getUserRow(MAIN.db, b.username)!.password_hash
    );
  });
});
