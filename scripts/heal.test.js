// 셀프 힐링 안전장치와 보조 함수 검증. 실행: npm run test:report
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkFixes, matchersOf } = require('./heal-guard');
const { extractTestBlock, normalizeDiagnosis, applyEdits, restoreEdits, buildPrBody } = require('./heal');

const SRC = `import { test, expect } from '../helpers/fixtures';

test.describe('그룹', () => {
  test('TC-102 내비게이션 링크 이동 (REQ-004)', async ({ page }) => {
    await page.goto('/login.html');
    await page.getByRole('link', { name: '게시판' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('link', { name: '글쓰기' })).toHaveCount(0);
  });

  test('TC-103 다른 테스트', async ({ request }) => {
    const res = await request.put('/api/posts/1');
    expect(res.status()).toBe(403);
  });
});
`;
const files = { 'tests/ui/nav.spec.ts': SRC };
const readFile = (p) => {
  if (!(p in files)) throw new Error('없음');
  return files[p];
};
const fix = (oldS, newS, file = 'tests/ui/nav.spec.ts') => ({ file, old_string: oldS, new_string: newS });

test('허용: 셀렉터(locator)만 바꾸는 정상 수정', () => {
  const r = checkFixes([fix(`getByRole('link', { name: '게시판' })`, `getByRole('link', { name: '홈' })`)], readFile);
  assert.equal(r.ok, true, r.reasons.join('\n'));
  // 문자열이 바뀌므로 "라벨 변경인지 기대 문구 변경인지" 확인하라는 경고는 항상 붙는다
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /문자열 값이 바뀌었습니다/);
});

test('허용하되 경고: expect 안의 검증 대상(locator)이 바뀌면 사람 확인을 요구', () => {
  const r = checkFixes(
    [fix(`expect(page.getByRole('link', { name: '글쓰기' })).toHaveCount(0)`, `expect(page.getByRole('link', { name: '작성' })).toHaveCount(0)`)],
    readFile
  );
  assert.equal(r.ok, true, r.reasons.join('\n'));
  assert.ok(r.warnings.some((w) => /검증 대상/.test(w)), r.warnings.join());
});

test('거절: 기대값을 바꿔 통과시키기 (toBe(403) → toBe(200))', () => {
  const r = checkFixes([fix('expect(res.status()).toBe(403)', 'expect(res.status()).toBe(200)')], readFile);
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(), /검증 조건/);
});

test('거절: toHaveCount(0) → toHaveCount(1) 처럼 기대값을 맞춰 버리기', () => {
  const r = checkFixes(
    [fix(`toHaveCount(0);\n  });\n\n  test('TC-103`, `toHaveCount(1);\n  });\n\n  test('TC-103`)],
    readFile
  );
  assert.equal(r.ok, false);
});

test('거절(우회 시도): 수정 조각을 matcher 이름부터 시작해 기대값만 바꾸기', () => {
  // '.' 없이 toHaveCount(0)부터 시작하는 조각
  const r = checkFixes([fix('toHaveCount(0)', 'toHaveCount(1)')], readFile);
  assert.equal(r.ok, false);
});

test('거절(우회 시도): not 을 넣고 빼서 검증의 의미를 뒤집기', () => {
  const a = checkFixes([fix('expect(res.status()).toBe(403)', 'expect(res.status()).not.toBe(403)')], readFile);
  assert.equal(a.ok, false);
  const b = checkFixes([fix('expect(page).toHaveURL(', 'expect(page).not.toHaveURL(')], readFile);
  assert.equal(b.ok, false);
});

test('거절(우회 시도): 기대값을 상수로 빼 두고 숫자만 바꾸기', () => {
  files['tests/api/const.spec.ts'] = `const EXPECTED_STATUS = 403;\ntest('TC-200 x', async () => { expect(s).toBe(EXPECTED_STATUS); });\n`;
  const r = checkFixes([fix('const EXPECTED_STATUS = 403;', 'const EXPECTED_STATUS = 200;', 'tests/api/const.spec.ts')], readFile);
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(), /숫자 값/);
});

test('허용: 문자열 안의 숫자나 TC ID 변화는 숫자 규칙에 걸리지 않는다', () => {
  files['tests/ui/label.spec.ts'] = `await page.getByRole('button', { name: '2번 항목' }).click();\n`;
  const r = checkFixes([fix(`name: '2번 항목'`, `name: '3번 항목'`, 'tests/ui/label.spec.ts')], readFile);
  assert.equal(r.ok, true, r.reasons.join());
  assert.equal(r.warnings.length, 1); // 문자열 변경은 경고로 남김
});

test('거절: 검증(expect) 삭제', () => {
  const r = checkFixes([fix(`    await expect(page).toHaveURL('/');\n`, '')], readFile);
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(), /검증 조건|줄었습니다/);
});

test('거절: skip / fixme / only / catch / force 우회', () => {
  const base = `await page.getByRole('link', { name: '게시판' }).click();`;
  for (const bad of [
    `test.skip(true);\n${base}`,
    `test.fixme();\n${base}`,
    `${base.replace('.click()', '.click({ force: true })')}`,
    `${base.replace(';', '.catch(() => {});')}`,
  ]) {
    const r = checkFixes([fix(base, bad)], readFile);
    assert.equal(r.ok, false, bad);
  }
});

test('거절: 앱 코드, 문서, 워크플로, 스크립트, 경로 이탈은 수정 불가', () => {
  files['src/app.js'] = 'x';
  files['docs/test-cases.md'] = 'x';
  for (const file of ['src/app.js', 'public/post.html', 'docs/test-cases.md', '.github/workflows/test.yml', 'scripts/report.js', '../outside.ts', 'tests/../src/app.js', 'tests/readme.md']) {
    const r = checkFixes([fix('x', 'y', file)], readFile);
    assert.equal(r.ok, false, file);
  }
});

test('거절: old_string이 없거나 2번 이상 나오면 적용 불가', () => {
  assert.equal(checkFixes([fix('존재하지 않는 문자열', 'y')], readFile).ok, false);
  assert.equal(checkFixes([fix('await', 'await ')], readFile).ok, false); // 여러 번 등장
});

test('거절: 빈 수정안, 변경 없음, 4곳 이상 수정, 형식 오류', () => {
  assert.equal(checkFixes([], readFile).ok, false);
  assert.equal(checkFixes(undefined, readFile).ok, false);
  assert.equal(checkFixes([fix(`'게시판'`, `'게시판'`)], readFile).ok, false);
  const many = [1, 2, 3, 4].map((i) => fix(`'게시판'`, `'홈${i}'`));
  assert.equal(checkFixes(many, readFile).ok, false);
  assert.equal(checkFixes([{ file: 'tests/ui/nav.spec.ts' }], readFile).ok, false);
});

test('matcher 추출: 괄호와 문자열 안의 괄호를 올바르게 처리', () => {
  const m = matchersOf(`await expect(page.getByText('a)b')).toHaveText('x (y)'); expect(n).not.toBe(1);`);
  assert.deepEqual(m, [`not.toBe(1)`, `toHaveText('x (y)')`]);
});

test('테스트 블록 추출: 지정한 TC의 test(...)만 잘라낸다', () => {
  const block = extractTestBlock(SRC, 'TC-102');
  assert.match(block, /^test\('TC-102/);
  assert.ok(block.trim().endsWith('})'));
  assert.ok(!block.includes('TC-103'));
  assert.equal(extractTestBlock(SRC, 'TC-999'), '');
});

test('진단 정규화: 알 수 없는 값은 안전한 쪽(unclear/low)으로', () => {
  const d = normalizeDiagnosis({ classification: '이상한값', confidence: '매우높음', fixes: 'x' });
  assert.equal(d.classification, 'unclear');
  assert.equal(d.confidence, 'low');
  assert.deepEqual(d.fixes, []);
  assert.equal(normalizeDiagnosis(null).classification, 'unclear');
});

test('수정 적용과 원상복구: 두 곳을 고치고 실패하면 모두 되돌린다', () => {
  const mem = { 'tests/a.ts': 'one two three' };
  const io = { read: (p) => mem[p], write: (p, c) => (mem[p] = c) };

  const originals = applyEdits([fix('one', '1', 'tests/a.ts'), fix('three', '3', 'tests/a.ts')], io);
  assert.equal(mem['tests/a.ts'], '1 two 3');
  restoreEdits(originals, io);
  assert.equal(mem['tests/a.ts'], 'one two three');

  // 두 번째 수정이 첫 수정 때문에 적용 불가 → 전체 원복
  assert.throws(() => applyEdits([fix('one', 'zzz', 'tests/a.ts'), fix('one', 'y', 'tests/a.ts')], io));
  assert.equal(mem['tests/a.ts'], 'one two three');
});

test('PR 본문: 분류, 근거, 재검증, 사람 확인 체크리스트, 자동 머지 안 됨을 포함', () => {
  const d = normalizeDiagnosis({
    classification: 'test_issue',
    confidence: 'high',
    summary: '내비 로고 문구 변경',
    reasoning: '요구사항에 문구 규정이 없음',
    requirement_ids: ['REQ-004'],
    fixes: [fix(`'게시판'`, `'홈'`)],
  });
  const body = buildPrBody({ tc: 'TC-102', d, verify: { passed: true }, warnings: ['검토 필요'] });
  for (const s of ['테스트 코드 문제', 'TC-102', 'REQ-004', '재검증', '통과', '검토 필요', '체크리스트', '자동으로 머지되지 않습니다', "- '게시판'", "+ '홈'"]) {
    assert.ok(body.includes(s), s);
  }
});
