import { test, expect, rand, uname, loginPage } from '../helpers/fixtures';

test.describe('회원가입/로그인 화면', () => {
  test('TC-002 가입 화면에서 가입하면 로그인 화면으로 이동한다 (REQ-001)', async ({ page }) => {
    await page.goto('/signup.html');
    await page.getByLabel('아이디').fill(uname());
    await page.getByLabel('비밀번호').fill('password1');
    await page.getByLabel('닉네임').fill('닉' + rand(4));
    await page.getByRole('button', { name: '가입하기' }).click();

    await expect(page.getByRole('status')).toContainText('가입이 완료되었습니다');
    await expect(page).toHaveURL(/\/login\.html$/);
  });

  test('TC-018 가입 화면에서 서버 오류 메시지가 표시된다 (REQ-013)', async ({ page, makeUser }) => {
    const existing = await makeUser();
    await page.goto('/signup.html');

    // 중복 아이디
    await page.getByLabel('아이디').fill(existing.username);
    await page.getByLabel('비밀번호').fill('password1');
    await page.getByLabel('닉네임').fill('닉' + rand(4));
    await page.getByRole('button', { name: '가입하기' }).click();
    await expect(page.getByRole('alert')).toContainText('이미 사용 중');
    await expect(page).toHaveURL(/\/signup\.html$/);

    // 짧은 비밀번호
    await page.getByLabel('아이디').fill(uname());
    await page.getByLabel('비밀번호').fill('short');
    await page.getByRole('button', { name: '가입하기' }).click();
    await expect(page.getByRole('alert')).toContainText('8자 이상');
    await expect(page).toHaveURL(/\/signup\.html$/);
  });

  test('TC-022 로그인하면 목록으로 이동하고 로그인 상태가 표시된다 (REQ-004)', async ({ page, makeUser }) => {
    const u = await makeUser();
    await page.goto('/login.html');
    await page.getByLabel('아이디').fill(u.username);
    await page.getByLabel('비밀번호').fill(u.password);
    await page.getByRole('button', { name: '로그인' }).click();

    await expect(page).toHaveURL('/');
    const nav = page.getByRole('navigation');
    await expect(nav.getByText(`${u.nickname} 님`)).toBeVisible();
    await expect(nav.getByRole('link', { name: '글쓰기' })).toBeVisible();
    await expect(nav.getByRole('button', { name: '로그아웃' })).toBeVisible();
  });

  test('TC-028 로그인 실패 시 오류 메시지가 표시되고 화면에 머문다 (REQ-004)', async ({ page, makeUser }) => {
    const u = await makeUser();
    await page.goto('/login.html');
    await page.getByLabel('아이디').fill(u.username);
    await page.getByLabel('비밀번호').fill('wrongpass1');
    await page.getByRole('button', { name: '로그인' }).click();

    await expect(page.getByRole('alert')).toContainText('올바르지 않습니다');
    await expect(page).toHaveURL(/\/login\.html$/);
  });

  test('TC-029 새로고침해도 로그인 상태가 유지된다 (REQ-004)', async ({ page, makeUser }) => {
    const u = await makeUser();
    await loginPage(page, u);
    await page.goto('/');
    await expect(page.getByText(`${u.nickname} 님`)).toBeVisible();
    await page.reload();
    // [데모] CI 실패 확인용으로 일부러 틀린 기대값을 넣음 (머지 금지)
    await expect(page.getByText(`${u.nickname} 님 (일부러 실패)`)).toBeVisible();
  });

  test('TC-033 화면에서 로그아웃하면 로그인/회원가입 링크가 보인다 (REQ-005)', async ({ page, makeUser }) => {
    const u = await makeUser();
    await loginPage(page, u);
    await page.goto('/');
    await page.getByRole('button', { name: '로그아웃' }).click();

    await expect(page).toHaveURL('/');
    const nav = page.getByRole('navigation');
    await expect(nav.getByRole('link', { name: '로그인' })).toBeVisible();
    await expect(nav.getByRole('link', { name: '회원가입' })).toBeVisible();
    await expect(nav.getByText(`${u.nickname} 님`)).toHaveCount(0);
  });

  test('TC-101 로그인 화면에서 빈 값으로 제출하면 오류 메시지가 표시된다 (REQ-004)', async ({ page }) => {
    await page.goto('/login.html');
    await page.getByRole('button', { name: '로그인' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login\.html$/);
  });

  test('TC-102 상단 내비게이션 링크가 올바른 화면으로 이동한다 (REQ-004)', async ({ page, makeUser }) => {
    await page.goto('/login.html');
    const nav = page.getByRole('navigation');

    await nav.getByRole('link', { name: '회원가입' }).click();
    await expect(page).toHaveURL(/\/signup\.html$/);

    await nav.getByRole('link', { name: '로그인' }).click();
    await expect(page).toHaveURL(/\/login\.html$/);

    await nav.getByRole('link', { name: '게시판' }).click();
    await expect(page).toHaveURL('/');

    const u = await makeUser();
    await loginPage(page, u);
    await page.goto('/');
    await nav.getByRole('link', { name: '글쓰기' }).click();
    await expect(page).toHaveURL(/\/write\.html$/);
  });

  test('TC-098 닉네임에 넣은 HTML은 태그로 해석되지 않고 문자 그대로 표시된다 (REQ-001, REQ-013)', async ({ page, makeUser }) => {
    const nickname = '<i>hi</i>';
    let dialogSeen = false;
    page.on('dialog', async (d) => {
      dialogSeen = true;
      await d.dismiss();
    });

    const u = await makeUser({ nickname });
    await loginPage(page, u);
    const created = await u.ctx.post('/api/posts', { data: { title: '닉네임 XSS', content: '내용' } });
    const post = await created.json();

    await page.goto(`/post.html?id=${post.id}`);
    await expect(page.getByRole('navigation').getByText(`${nickname} 님`)).toBeVisible();
    await expect(page.locator('#post-author')).toHaveText(nickname);
    await expect(page.locator('nav i, #post-author i')).toHaveCount(0);
    expect(dialogSeen).toBe(false);
  });
});
