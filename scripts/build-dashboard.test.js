// 대시보드 데이터 생성과 화면 계산 검증. 실행: npm run test:report
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { publicRun, buildData } = require('./build-dashboard');
const Q = require('../dashboard/view-model');

const rec = (over = {}) => ({
  schema: 1, runId: '1-1', timestamp: '2026-09-29T02:00:00.000Z', branch: 'main', sha: 'abc1234', event: 'push',
  runUrl: 'https://github.com/o/r/actions/runs/1', scope: 'full',
  tests: { total: 10, passed: 10, failed: 0, skipped: 0, flaky: 0, passRate: 100, flakyRate: 0, durationSec: 20 },
  byPriority: {}, coverage: { reqTotal: 2, reqCovered: 2, reqPassing: 2, pct: 100, passingPct: 100, uncovered: [] },
  failedTcs: [], flakyTcs: [], secretField: 'x', ...over,
});

test('publicRun: 화면에 쓰는 필드만 내보내고, GitHub 가 아닌 링크는 버린다', () => {
  const r = publicRun(rec({ runUrl: 'javascript:alert(1)' }));
  assert.equal(r.runUrl, '');
  assert.equal('secretField' in r, false);
  assert.equal(publicRun(rec()).runUrl, 'https://github.com/o/r/actions/runs/1');
});

test('buildData: 시간순 정렬, 깨진 기록 제외, 결함 통계 포함', () => {
  const d = buildData([
    rec({ runId: 'b', timestamp: '2026-09-29T03:00:00.000Z', failedTcs: ['TC-001'] }),
    rec({ runId: 'a' }),
    { runId: 'bad' },
    rec({ runId: 'c', timestamp: 'nope' }),
  ], { repo: 'o/r', now: 'N' });
  assert.deepEqual(d.runs.map((r) => r.runId), ['a', 'b']);
  assert.equal(d.defects.detected, 1);
  assert.equal(d.repo, 'o/r');
});

test('CLI: 이력이 없어도 빈 대시보드를 만든다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-'));
  execFileSync(process.execPath, [path.join(__dirname, 'build-dashboard.js'), '--history', path.join(dir, 'none.jsonl'), '--out', path.join(dir, 'site')]);
  const data = JSON.parse(fs.readFileSync(path.join(dir, 'site', 'data.json'), 'utf8'));
  assert.deepEqual(data.runs, []);
  for (const f of ['index.html', 'style.css', 'dashboard.js', 'view-model.js', '.nojekyll']) assert.ok(fs.existsSync(path.join(dir, 'site', f)), f);
});

test('selectRange / delta / series', () => {
  const runs = [1, 2, 3, 4].map((n) => ({ n }));
  assert.deepEqual(Q.selectRange(runs, 2).map((r) => r.n), [3, 4]);
  assert.equal(Q.selectRange(runs, 'all').length, 4);
  assert.equal(Q.delta(99.1, 100), -0.9);
  assert.equal(Q.delta(null, 1), null);
  assert.deepEqual(Q.series([{ v: 1 }, { v: undefined }], (r) => r.v), [1, null]);
});

test('kpis: 개선/악화 판정은 지표마다 방향이 다르다', () => {
  const a = rec();
  const b = rec({ tests: { ...a.tests, passRate: 99.1, flakyRate: 0, durationSec: 10 }, failedTcs: ['TC-001'] });
  const k = Object.fromEntries(Q.kpis([a, b]).map((x) => [x.key, x]));
  assert.equal(k.passRate.tone, 'bad');   // 통과율은 내려가면 악화
  assert.equal(k.duration.tone, 'good');  // 실행 시간은 줄면 개선
  assert.equal(k.flakyRate.tone, 'flat');
  assert.equal(k.failedTcs.tone, 'bad');
  assert.equal(Q.kpis([a])[0].tone, null); // 비교할 이전 값 없음
  assert.deepEqual(Q.kpis([]), []);
});

test('niceTicks / percentDomain / formatKst / runStatus', () => {
  assert.deepEqual(Q.niceTicks(77), [0, 20, 40, 60, 80]);
  assert.deepEqual(Q.niceTicks(0), [0, 1]);
  assert.deepEqual(Q.percentDomain([99.1, 100]), [95, 100]);
  assert.deepEqual(Q.percentDomain([40, 100]), [0, 100]);
  assert.deepEqual(Q.percentDomain([]), [0, 100]);
  assert.equal(Q.formatKst('2026-09-29T02:44:32.948Z'), '09-29 11:44');
  assert.equal(Q.formatKst('x'), '-');
  assert.equal(Q.formatValue(99.1, '%'), '99.1%');
  assert.equal(Q.formatValue(null, '%'), '-');
  assert.equal(Q.runStatus(rec()), 'pass');
  assert.equal(Q.runStatus(rec({ failedTcs: ['TC-1'] })), 'fail');
});
