import { test, expect, rand, createPost, loginPage } from '../helpers/fixtures';

test.describe('게시글 작성 화면', () => {
  test('TC-050 화면에서 글을 작성하면 상세 화면으로 이동한다 (REQ-008)', async ({ page, makeUser }) => {
    const u = await makeUser();
    await loginPage(page, u);
    await page.goto('/');
    await page.getByRole('navigation').getByRole('link', { name: '글쓰기' }).click();

    const title = '화면 작성 ' + rand(6);
    await page.getByLabel('제목').fill(title);
    await page.getByLabel('내용').fill('화면에서 작성한 내용');
    await page.getByRole('button', { name: '등록' }).click();

    await expect(page).toHaveURL(/\/post\.html\?id=\d+$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(page.locator('#post-content')).toHaveText('화면에서 작성한 내용');
    await expect(page.locator('#post-author')).toHaveText(u.nickname);
  });

  test('TC-052 비로그인 상태로 글쓰기 화면에 접근하면 로그인 화면으로 이동한다 (REQ-012)', async ({ page }) => {
    await page.goto('/write.html');
    await expect(page).toHaveURL(/\/login\.html$/);
  });

  test('TC-061 제목과 내용의 스크립트는 실행되지 않고 문자 그대로 표시된다 (REQ-008, REQ-013)', async ({ page, makeUser }) => {
    const u = await makeUser();
    await loginPage(page, u);
    let dialogSeen = false;
    page.on('dialog', async (d) => {
      dialogSeen = true;
      await d.dismiss();
    });

    const title = '<img src=x onerror=alert(1)>';
    const content = '<script>alert(2)</script>';
    await page.goto('/write.html');
    await page.getByLabel('제목').fill(title);
    await page.getByLabel('내용').fill(content);
    await page.getByRole('button', { name: '등록' }).click();

    await expect(page).toHaveURL(/\/post\.html\?id=\d+$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(page.locator('#post-content')).toHaveText(content);
    await expect(page.locator('main img')).toHaveCount(0);
    await page.waitForTimeout(500); // 지연 실행되는 핸들러가 있는지 잠시 대기
    expect(dialogSeen).toBe(false);
  });

  test('TC-062 내용의 줄바꿈이 상세 화면에서 유지된다 (REQ-008)', async ({ page, makeUser }) => {
    const u = await makeUser();
    await loginPage(page, u);
    await page.goto('/write.html');
    await page.getByLabel('제목').fill('줄바꿈 ' + rand(4));
    await page.getByLabel('내용').fill('첫째 줄\n둘째 줄\n셋째 줄');
    await page.getByRole('button', { name: '등록' }).click();

    await expect(page).toHaveURL(/\/post\.html\?id=\d+$/);
    const content = page.locator('#post-content');
    await expect(content).toContainText('셋째 줄'); // 본문이 렌더링될 때까지 대기
    await expect(content).toHaveCSS('white-space', 'pre-wrap');
    expect(await content.evaluate((el) => (el as HTMLElement).innerText)).toBe('첫째 줄\n둘째 줄\n셋째 줄');
  });

  test('TC-064 제목을 비우고 등록하면 오류 메시지가 표시되고 글이 생성되지 않는다 (REQ-013)', async ({ page, makeUser }) => {
    const u = await makeUser();
    await loginPage(page, u);
    await page.goto('/write.html');
    await page.getByLabel('내용').fill('제목 없는 내용');
    await page.getByRole('button', { name: '등록' }).click();

    await expect(page.getByRole('alert')).toContainText('제목');
    await expect(page).toHaveURL(/\/write\.html$/);
    const list = await (await u.ctx.get('/api/posts?limit=50')).json();
    expect(list.posts.filter((p: { author: string }) => p.author === u.nickname)).toHaveLength(0);
  });

  test('TC-096 글쓰기 버튼은 로그인했을 때만 보인다 (REQ-008, REQ-012)', async ({ page, makeUser }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: '로그인' })).toBeVisible(); // 내비 렌더링 완료 대기
    await expect(page.getByRole('link', { name: '글쓰기' })).toHaveCount(0);

    const u = await makeUser();
    await loginPage(page, u);
    await page.goto('/');
    await expect(page.getByRole('link', { name: '글쓰기' })).toHaveCount(2); // 상단 내비 + 목록 화면 버튼
  });

  test('TC-100 세션이 끊긴 뒤 저장하면 로그인 화면으로 이동하고 글이 생성되지 않는다 (REQ-012)', async ({ page, makeUser }) => {
    const u = await makeUser();
    await loginPage(page, u);
    await page.goto('/write.html');
    const title = '세션 끊김 ' + rand(6);
    await page.getByLabel('제목').fill(title);
    await page.getByLabel('내용').fill('내용');

    // 다른 탭에서 로그아웃한 상황
    expect((await page.request.post('/api/logout')).status()).toBe(200);

    await page.getByRole('button', { name: '등록' }).click();
    await expect(page).toHaveURL(/\/login\.html$/);
    const list = await (await u.ctx.get('/api/posts?limit=50')).json();
    expect(list.posts.map((p: { title: string }) => p.title)).not.toContain(title);
  });
});

test.describe('게시글 상세 화면', () => {
  test('TC-069 존재하지 않는 글 화면은 오류 메시지를 표시한다 (REQ-009)', async ({ page }) => {
    await page.goto('/post.html?id=999999999');
    await expect(page.getByRole('alert')).toHaveText('게시글을 찾을 수 없습니다.');
    await expect(page.locator('#post')).toBeHidden();
  });

  test('TC-097 id 없이 상세 화면에 접근하면 오류 메시지를 표시한다 (REQ-009)', async ({ page }) => {
    await page.goto('/post.html');
    await expect(page.getByRole('alert')).toHaveText('게시글을 찾을 수 없습니다.');
    await expect(page.locator('#post')).toBeHidden();
    await expect(page).not.toHaveTitle(/undefined/);
  });

  test('TC-071 수정한 글에는 수정 시각이 표시된다 (REQ-009)', async ({ page, makeUser }) => {
    const u = await makeUser();
    const post = await createPost(u.ctx);
    await new Promise((r) => setTimeout(r, 1100));
    await u.ctx.put(`/api/posts/${post.id}`, { data: { title: '수정됨', content: '수정됨' } });

    await page.goto(`/post.html?id=${post.id}`);
    await expect(page.locator('#post-updated')).toContainText('(수정:');
  });

  test('TC-072 비로그인 상태에서는 수정/삭제 버튼이 없다 (REQ-009, REQ-010, REQ-011)', async ({ page, makeUser }) => {
    const u = await makeUser();
    const post = await createPost(u.ctx);
    await page.goto(`/post.html?id=${post.id}`);
    await expect(page.getByRole('link', { name: '목록' })).toBeVisible();
    await expect(page.getByRole('link', { name: '수정' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '삭제' })).toHaveCount(0);
  });

  test('TC-073 타인의 글에는 수정/삭제 버튼이 없다 (REQ-009, REQ-010, REQ-011)', async ({ page, makeUser }) => {
    const owner = await makeUser();
    const other = await makeUser();
    const post = await createPost(owner.ctx);
    await loginPage(page, other);
    await page.goto(`/post.html?id=${post.id}`);
    await expect(page.getByRole('link', { name: '목록' })).toBeVisible();
    await expect(page.getByRole('link', { name: '수정' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '삭제' })).toHaveCount(0);
  });

  test('TC-074 본인의 글에는 수정/삭제 버튼이 보인다 (REQ-009, REQ-010, REQ-011)', async ({ page, makeUser }) => {
    const owner = await makeUser();
    const post = await createPost(owner.ctx);
    await loginPage(page, owner);
    await page.goto(`/post.html?id=${post.id}`);
    await expect(page.getByRole('link', { name: '수정' })).toBeVisible();
    await expect(page.getByRole('button', { name: '삭제' })).toBeVisible();
  });
});

test.describe('게시글 수정/삭제 화면', () => {
  test('TC-076 화면에서 본인 글을 수정한다 (REQ-010)', async ({ page, makeUser }) => {
    const u = await makeUser();
    const post = await createPost(u.ctx, '수정 전 제목', '수정 전 내용');
    await loginPage(page, u);
    await page.goto(`/post.html?id=${post.id}`);
    await page.getByRole('link', { name: '수정' }).click();

    await expect(page).toHaveURL(new RegExp(`/write\\.html\\?id=${post.id}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('글 수정');
    await expect(page.getByLabel('제목')).toHaveValue('수정 전 제목');
    await expect(page.getByLabel('내용')).toHaveValue('수정 전 내용');

    await page.getByLabel('제목').fill('수정 후 제목');
    await page.getByLabel('내용').fill('수정 후 내용');
    await page.getByRole('button', { name: '수정' }).click();

    await expect(page).toHaveURL(new RegExp(`/post\\.html\\?id=${post.id}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('수정 후 제목');
    await expect(page.locator('#post-content')).toHaveText('수정 후 내용');
  });

  test('TC-081 타인 글의 수정 화면에 직접 접근해도 저장되지 않는다 (REQ-010)', async ({ page, makeUser }) => {
    const owner = await makeUser();
    const other = await makeUser();
    const post = await createPost(owner.ctx, '원본 제목', '원본 내용');
    await loginPage(page, other);

    await page.goto(`/write.html?id=${post.id}`);
    await expect(page.getByRole('alert')).toHaveText('본인의 글만 수정할 수 있습니다.');
    await expect(page.getByLabel('제목')).toHaveValue('');

    await page.getByLabel('제목').fill('탈취 제목');
    await page.getByLabel('내용').fill('탈취 내용');
    await page.getByRole('button', { name: '수정' }).click();
    await expect(page.getByRole('alert')).toBeVisible();

    const after = await (await owner.ctx.get(`/api/posts/${post.id}`)).json();
    expect(after).toMatchObject({ title: '원본 제목', content: '원본 내용' });
  });

  test('TC-085 삭제 확인창에서 확인하면 글이 삭제된다 (REQ-011)', async ({ page, makeUser }) => {
    const u = await makeUser();
    const post = await createPost(u.ctx);
    await loginPage(page, u);
    await page.goto(`/post.html?id=${post.id}`);

    page.once('dialog', (d) => {
      expect(d.type()).toBe('confirm');
      d.accept();
    });
    await page.getByRole('button', { name: '삭제' }).click();

    await expect(page).toHaveURL('/');
    expect((await u.ctx.get(`/api/posts/${post.id}`)).status()).toBe(404);
  });

  test('TC-086 삭제 확인창에서 취소하면 글이 남아 있다 (REQ-011)', async ({ page, makeUser }) => {
    const u = await makeUser();
    const post = await createPost(u.ctx, '지워지면 안 되는 글');
    await loginPage(page, u);
    await page.goto(`/post.html?id=${post.id}`);

    page.once('dialog', (d) => d.dismiss());
    await page.getByRole('button', { name: '삭제' }).click();

    await expect(page).toHaveURL(new RegExp(`/post\\.html\\?id=${post.id}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('지워지면 안 되는 글');
    expect((await u.ctx.get(`/api/posts/${post.id}`)).status()).toBe(200);
  });
});
