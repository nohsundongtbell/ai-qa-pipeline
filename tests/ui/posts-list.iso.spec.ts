// 전체 글 개수에 의존하는 목록 화면 테스트: 테스트마다 DB를 비우고 시작한다 (전용 서버/DB, 순차 실행).
import { test, expect, createPost } from '../helpers/fixtures';
import { resetDb } from '../helpers/db';
import { ISO_UI } from '../helpers/env';

test.beforeEach(() => resetDb(ISO_UI.db));

async function seed(ctx: Parameters<typeof createPost>[0], n: number) {
  for (let i = 1; i <= n; i++) await createPost(ctx, `글 ${i}`, `내용 ${i}`);
}

test.describe('게시글 목록 화면 (격리 DB)', () => {
  test('TC-036 목록에 번호, 제목, 작성자, 작성일이 최신순으로 표시된다 (REQ-006)', async ({ page, makeUser }) => {
    const u = await makeUser({ nickname: '에이' });
    for (const t of ['A글', 'B글', 'C글']) await createPost(u.ctx, t);

    await page.goto('/');
    await expect(page.getByRole('columnheader')).toHaveText(['번호', '제목', '작성자', '작성일']);
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('C글');
    await expect(rows.nth(1)).toContainText('B글');
    await expect(rows.nth(2)).toContainText('A글');
    await expect(rows.nth(0).getByRole('cell').nth(2)).toHaveText('에이');
    await expect(rows.nth(0).getByRole('cell').nth(3)).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('TC-037 글이 하나도 없으면 안내 문구가 표시된다 (REQ-006)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('cell', { name: '게시글이 없습니다.' })).toBeVisible();
    const pagination = page.getByLabel('페이지 이동');
    await expect(pagination.getByRole('button', { name: '1', exact: true })).toBeVisible();
    await expect(pagination.getByRole('button')).toHaveCount(3); // 이전, 1, 다음
  });

  test('TC-043 페이지 번호를 클릭하면 해당 페이지로 이동한다 (REQ-007)', async ({ page, makeUser }) => {
    const u = await makeUser();
    await seed(u.ctx, 11);
    await page.goto('/');
    await expect(page.locator('tbody tr')).toHaveCount(10);

    await page.getByRole('button', { name: '2', exact: true }).click();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(page.locator('tbody tr')).toContainText('글 1');
    await expect(page.getByRole('button', { name: '2', exact: true })).toHaveAttribute('aria-current', 'page');
  });

  test('TC-047 첫 페이지의 이전, 마지막 페이지의 다음 버튼은 비활성화된다 (REQ-007)', async ({ page, makeUser }) => {
    const u = await makeUser();
    await seed(u.ctx, 11);
    await page.goto('/');
    await expect(page.getByRole('button', { name: '이전' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '다음' })).toBeEnabled();

    await page.getByRole('button', { name: '다음' }).click();
    await expect(page.getByRole('button', { name: '다음' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '이전' })).toBeEnabled();
  });

  test('TC-067 목록에서 제목을 클릭하면 상세 화면으로 이동한다 (REQ-009)', async ({ page, makeUser }) => {
    const u = await makeUser();
    await createPost(u.ctx, '클릭할 글', '클릭 후 보이는 내용');
    await page.goto('/');
    await page.getByRole('link', { name: '클릭할 글' }).click();

    await expect(page).toHaveURL(/\/post\.html\?id=\d+$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('클릭할 글');
    await expect(page.locator('#post-content')).toHaveText('클릭 후 보이는 내용');
    await expect(page.locator('#post-author')).toHaveText(u.nickname);
    await expect(page).toHaveTitle('클릭할 글 - 게시판');
  });

  test('TC-099 URL로 페이지를 직접 지정할 수 있고 잘못된 값은 1페이지가 된다 (REQ-007)', async ({ page, makeUser }) => {
    const u = await makeUser();
    await seed(u.ctx, 11);

    await page.goto('/?page=2');
    await expect(page.locator('tbody tr')).toHaveCount(1);

    for (const p of ['abc', '0']) {
      await page.goto(`/?page=${p}`);
      await expect(page.locator('tbody tr'), `page=${p}`).toHaveCount(10);
    }
  });

  test('TC-061 목록 화면에서도 제목의 스크립트는 실행되지 않는다 (REQ-008, REQ-013)', async ({ page, makeUser }) => {
    const u = await makeUser();
    let dialogSeen = false;
    page.on('dialog', async (d) => {
      dialogSeen = true;
      await d.dismiss();
    });
    const title = '<img src=x onerror=alert(1)>';
    await createPost(u.ctx, title);

    await page.goto('/');
    await expect(page.getByRole('link', { name: title })).toBeVisible();
    await expect(page.locator('main img')).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(dialogSeen).toBe(false);
  });
});
