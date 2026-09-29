import { test as base, expect, APIRequestContext, Page } from '@playwright/test';
import { randomBytes } from 'crypto';

export { expect };

/** 영문/숫자로 된 길이 n의 무작위 문자열 */
export const rand = (n: number) => randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n);

/** 고유한 아이디 (영문/숫자 11자) */
export const uname = () => 'u' + rand(10);

export interface TestUser {
  id: number;
  username: string;
  password: string;
  nickname: string;
  /** 로그인된 세션을 가진 API 컨텍스트 */
  ctx: APIRequestContext;
}

type Fixtures = {
  /** 쿠키가 비어 있는 새 API 세션 */
  newSession: () => Promise<APIRequestContext>;
  /** 고유한 사용자를 가입시키고 로그인된 상태로 돌려준다 */
  makeUser: (o?: Partial<Pick<TestUser, 'username' | 'password' | 'nickname'>>) => Promise<TestUser>;
};

export const test = base.extend<Fixtures>({
  newSession: async ({ playwright, baseURL }, use) => {
    const contexts: APIRequestContext[] = [];
    await use(async () => {
      const ctx = await playwright.request.newContext({ baseURL });
      contexts.push(ctx);
      return ctx;
    });
    for (const c of contexts) await c.dispose();
  },

  makeUser: async ({ newSession }, use) => {
    await use(async (o = {}) => {
      const ctx = await newSession();
      const user = {
        username: uname(),
        password: 'password1',
        nickname: '닉' + rand(4),
        ...o,
      };
      const signup = await ctx.post('/api/signup', { data: user });
      expect(signup.status(), '사전조건: 회원가입').toBe(201);
      const login = await ctx.post('/api/login', {
        data: { username: user.username, password: user.password },
      });
      expect(login.status(), '사전조건: 로그인').toBe(200);
      return { ...user, id: (await signup.json()).id, ctx };
    });
  },
});

export async function createPost(
  ctx: APIRequestContext,
  title = '제목 ' + rand(6),
  content = '내용 ' + rand(6)
) {
  const res = await ctx.post('/api/posts', { data: { title, content } });
  expect(res.status(), '사전조건: 글 작성').toBe(201);
  return (await res.json()) as {
    id: number;
    title: string;
    content: string;
    user_id: number;
    author: string;
    created_at: string;
    updated_at: string;
  };
}

/** 브라우저 페이지를 해당 사용자로 로그인시킨다 (page.request는 페이지와 쿠키를 공유) */
export async function loginPage(page: Page, u: { username: string; password: string }) {
  const res = await page.request.post('/api/login', {
    data: { username: u.username, password: u.password },
  });
  expect(res.status(), '사전조건: 페이지 로그인').toBe(200);
}

/** 서버 오류 메시지 형식 확인용 */
export async function errorOf(res: { json: () => Promise<any> }) {
  return (await res.json()).error as string;
}
