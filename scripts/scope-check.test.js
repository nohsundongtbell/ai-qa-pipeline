// 에이전트 역할 범위 검사기 검증. 실행: npm run test:report
const test = require('node:test');
const assert = require('node:assert/strict');
const { ROLES, isAllowed, diffMaps, violations } = require('./scope-check');

test('변경 감지: 수정, 추가, 삭제를 모두 찾고 그대로인 파일은 무시한다', () => {
  const base = { 'a.ts': '1', 'b.ts': '2', 'c.ts': '3' };
  const cur = { 'a.ts': '1', 'b.ts': 'X', 'd.ts': '4', 'c.ts': 'DELETED' };
  assert.deepEqual(diffMaps(base, cur), ['b.ts', 'c.ts', 'd.ts']);
  assert.deepEqual(diffMaps(base, base), []);
});

test('planner: 테스트 계획과 TC 문서만 수정 가능, 요구사항과 테스트 코드는 불가', () => {
  assert.deepEqual(violations('planner', ['docs/test-plan.md', 'docs/test-cases.md']), []);
  assert.deepEqual(violations('planner', ['docs/requirements.md', 'tests/api/a.spec.ts', 'src/app.js']), [
    'docs/requirements.md',
    'tests/api/a.spec.ts',
    'src/app.js',
  ]);
});

test('writer: tests/ 아래만 수정 가능, 앱 코드와 문서는 불가', () => {
  assert.deepEqual(violations('writer', ['tests/api/new.spec.ts', 'tests/helpers/db.ts']), []);
  assert.equal(violations('writer', ['src/routes/posts.js', 'public/app.js', 'docs/test-cases.md', 'playwright.config.ts']).length, 4);
});

test('runner와 healer: 어떤 파일도 수정할 수 없다', () => {
  for (const role of ['runner', 'healer']) {
    assert.deepEqual(violations(role, []), []);
    assert.deepEqual(violations(role, ['tests/a.spec.ts']), ['tests/a.spec.ts']);
    assert.deepEqual(violations(role, ['src/app.js']), ['src/app.js']);
  }
});

test('reporter: reports/ 아래만 수정 가능', () => {
  assert.deepEqual(violations('reporter', ['reports/weekly-2026-10-05.md']), []);
  assert.deepEqual(violations('reporter', ['docs/test-cases.md']), ['docs/test-cases.md']);
});

test('경로 규칙은 접두사 우회를 허용하지 않는다 (tests-evil/, docs/test-cases.md.bak)', () => {
  assert.equal(isAllowed('writer', 'tests-evil/x.ts'), false);
  assert.equal(isAllowed('planner', 'docs/test-cases.md.bak'), false);
  assert.equal(isAllowed('reporter', 'reports-old/x.md'), false);
});

test('알 수 없는 역할은 예외', () => {
  assert.throws(() => violations('hacker', ['x']), /알 수 없는 역할/);
  assert.deepEqual(Object.keys(ROLES).sort(), ['healer', 'planner', 'reporter', 'runner', 'writer']);
});
