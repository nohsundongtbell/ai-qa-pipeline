// 지표 계산과 품질 게이트 검증. 실행: npm run test:report
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const {
  computeMetrics, readHistory, appendRecord, defectStats, durationRatio, fetchOpenCritical,
  evaluateGate, gateMarkdown, sparkline, summaryMarkdown,
} = require('./metrics');

// ----- 테스트용 입력 -----
const CASES = `
| TC ID | REQ | 유형 | 레벨 | 제목 | 사전조건 | 절차 | 기대결과 | 우선순위 | 자동화 |
|---|---|---|---|---|---|---|---|---|---|
| TC-001 | REQ-001 | 정상 | API | a | x | x | x | P1 | Y |
| TC-002 | REQ-001, REQ-002 | 오류 | API | b | x | x | x | P1 | Y |
| TC-003 | REQ-002 | 경계 | API | c | x | x | x | P2 | Y |
| TC-004 | REQ-003 | 정상 | UI | d | x | x | x | P3 | Y |
| TC-005 | REQ-003 | 정상 | UI | e | x | x | x | P2 | Y |
`;
const REQS = '# 요구사항\n### REQ-001 가입\n### REQ-002 로그인\n### REQ-003 목록\n### REQ-004 삭제\n';

const spec = (title, status, opts = {}) => ({
  title,
  file: 'x.spec.ts',
  tests: [{ projectName: 'main', status, results: [...(opts.retry ? [{ status: 'failed', duration: 50 }] : []), { status: status === 'unexpected' ? 'failed' : 'passed', duration: 100 }] }],
});
const report = (specs, duration = 60000, startTime = '2026-10-01T00:00:00.000Z') => ({ stats: { startTime, duration }, suites: [{ file: 'x.spec.ts', specs }] });

const metricsOf = (specs, o = {}) => computeMetrics({ report: report(specs, o.duration, o.startTime), casesMd: CASES, reqsMd: REQS, ctx: { runId: o.runId || 'r1', sha: 'abcdef123' } });

// ----- 지표 계산 -----
test('지표: 전부 통과하면 통과율 100%, TC가 없는 REQ-004는 커버리지에서 빠진다', () => {
  const m = metricsOf([spec('TC-001 a', 'expected'), spec('TC-002 b', 'expected'), spec('TC-003 c', 'expected'), spec('TC-004 d', 'expected'), spec('TC-005 e', 'expected')]);
  assert.equal(m.tests.passRate, 100);
  assert.equal(m.tests.durationSec, 60);
  assert.deepEqual([m.coverage.reqTotal, m.coverage.reqCovered, m.coverage.pct], [4, 3, 75]);
  assert.deepEqual(m.coverage.uncovered, ['REQ-004']);
  assert.equal(m.sha, 'abcdef1');
});

test('지표: P1 실패는 우선순위별 통과율과 실패 TC에 반영되고, 그 REQ는 passing에서 빠진다', () => {
  const m = metricsOf([spec('TC-001 a', 'expected'), spec('TC-002 b', 'unexpected'), spec('TC-003 c', 'expected'), spec('TC-004 d', 'expected'), spec('TC-005 e', 'expected')]);
  assert.equal(m.tests.passRate, 80); // 4/5
  assert.deepEqual(m.byPriority.P1, { total: 2, passed: 1, failed: 1, passRate: 50 });
  assert.deepEqual(m.byPriority.P2, { total: 2, passed: 2, failed: 0, passRate: 100 });
  assert.deepEqual(m.failedTcs, ['TC-002']);
  // TC-002는 REQ-001, REQ-002 를 검증하므로 두 REQ 모두 passing 아님 → REQ-003만 passing
  assert.equal(m.coverage.reqPassing, 1);
  assert.equal(m.coverage.reqCovered, 3);
});

test('지표: flaky는 최종 통과로 세되 비율을 따로 계산하고, 건너뜀은 통과율에서 제외한다', () => {
  const m = metricsOf([spec('TC-001 a', 'flaky', { retry: true }), spec('TC-002 b', 'expected'), spec('TC-003 c', 'skipped'), spec('TC-004 d', 'expected'), spec('TC-005 e', 'unexpected')]);
  assert.equal(m.tests.flaky, 1);
  assert.equal(m.tests.skipped, 1);
  assert.equal(m.tests.flakyRate, 20); // 1/5
  assert.equal(m.tests.passRate, 75); // (2 expected + 1 flaky) / (3 + 1 failed)
  assert.deepEqual(m.flakyTcs, ['TC-001']);
  assert.equal(m.byPriority.P2.total, 1); // 건너뛴 TC-003은 실행되지 않은 것으로 본다
});

test('지표: 같은 TC를 여러 테스트가 검증하면 TC 단위로는 하나라도 실패하면 실패', () => {
  const m = metricsOf([spec('TC-001 상세', 'expected'), spec('TC-001 목록', 'unexpected'), spec('TC-002 b', 'expected')]);
  assert.equal(m.tests.total, 3);
  assert.equal(m.byPriority.P1.total, 2);
  assert.equal(m.byPriority.P1.failed, 1);
});

test('지표: 자동화 대상 TC의 일부만 실행하면 scope는 partial', () => {
  assert.equal(metricsOf([spec('TC-001 a', 'expected')]).scope, 'partial');
  assert.equal(metricsOf([1, 2, 3, 4, 5].map((i) => spec(`TC-00${i} x`, 'expected'))).scope, 'full');
});

// ----- 이력 -----
test('이력: 같은 runId는 교체하고 손상된 줄은 건너뛴다', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-')), 'h.jsonl');
  appendRecord(file, { runId: 'a', v: 1 });
  appendRecord(file, { runId: 'b', v: 1 });
  appendRecord(file, { runId: 'a', v: 2 }); // 재실행
  assert.deepEqual(readHistory(file).map((r) => [r.runId, r.v]), [['b', 1], ['a', 2]]);
  fs.appendFileSync(file, '{깨진 줄\n');
  const warnings = [];
  assert.equal(readHistory(file, (w) => warnings.push(w)).length, 2);
  assert.equal(warnings.length, 1);
  assert.deepEqual(readHistory(path.join(os.tmpdir(), 'no-such-file.jsonl')), []);
});

// ----- 결함 탐지 수와 평균 수정 시간 -----
const run = (ts, failed, scope = 'full') => ({ runId: ts, timestamp: ts, scope, failedTcs: failed, tests: { durationSec: 60 } });

test('결함 통계: 처음 실패한 시점부터 다시 통과한 시점까지를 수정 시간으로 계산한다', () => {
  const d = defectStats([
    run('2026-10-01T00:00:00Z', []),
    run('2026-10-01T10:00:00Z', ['TC-001']), // TC-001 탐지
    run('2026-10-01T12:00:00Z', ['TC-001']), // 계속 실패: 새로 세지 않음
    run('2026-10-01T22:00:00Z', []), // 수정됨: 12시간
    run('2026-10-02T00:00:00Z', ['TC-002']), // TC-002 탐지, 아직 미해결
  ]);
  assert.deepEqual([d.detected, d.resolved, d.open, d.mttrHours], [2, 1, 1, 12]);
  assert.deepEqual(d.openTcs, ['TC-002']);
});

test('결함 통계: 고쳐진 뒤 다시 실패하면 새 결함으로 세고, 평균은 여러 건으로 계산한다', () => {
  const d = defectStats([
    run('2026-10-01T00:00:00Z', ['TC-001']),
    run('2026-10-01T04:00:00Z', []), // 4시간
    run('2026-10-01T06:00:00Z', ['TC-001']), // 재발
    run('2026-10-01T16:00:00Z', []), // 10시간
  ]);
  assert.deepEqual([d.detected, d.resolved, d.open, d.mttrHours], [2, 2, 0, 7]);
});

test('결함 통계: 일부만 실행한(partial) 기록은 무시해서 가짜 수정으로 세지 않는다', () => {
  const d = defectStats([run('2026-10-01T00:00:00Z', ['TC-001']), run('2026-10-01T01:00:00Z', [], 'partial'), run('2026-10-01T02:00:00Z', ['TC-001'])]);
  assert.deepEqual([d.detected, d.resolved, d.open, d.mttrHours], [1, 0, 1, null]);
  assert.equal(defectStats([]).mttrHours, null);
});

// ----- 품질 게이트 -----
const CONFIG = {
  criteria: [
    { id: 'p1', label: 'P1', metric: 'byPriority.P1.passRate', op: '>=', value: 100 },
    { id: 'pass', label: '전체', metric: 'tests.passRate', op: '>=', value: 95 },
    { id: 'crit', label: 'Critical', metric: 'jira.openCritical', op: '<=', value: 0 },
    { id: 'dur', label: '시간', metric: 'trend.durationRatio', op: '<=', value: 1.5, level: 'warn' },
  ],
};
const data = (o = {}) => ({ byPriority: { P1: { passRate: 100 } }, tests: { passRate: 100 }, jira: { openCritical: 0 }, trend: { durationRatio: 1 }, ...o });

test('게이트: 모든 필수 기준을 충족하면 GO', () => {
  const r = evaluateGate(CONFIG, data());
  assert.equal(r.verdict, 'GO');
  assert.ok(r.rows.every((x) => x.status === 'pass'));
});

test('게이트: 통과율 95% 경계 (95.0은 통과, 94.9는 NO-GO)', () => {
  assert.equal(evaluateGate(CONFIG, data({ tests: { passRate: 95 } })).verdict, 'GO');
  assert.equal(evaluateGate(CONFIG, data({ tests: { passRate: 94.9 } })).verdict, 'NO-GO');
});

test('게이트: P1 통과율이 100% 미만이거나 Critical 결함이 있으면 NO-GO', () => {
  assert.equal(evaluateGate(CONFIG, data({ byPriority: { P1: { passRate: 97.1 } } })).verdict, 'NO-GO');
  assert.equal(evaluateGate(CONFIG, data({ jira: { openCritical: 1 } })).verdict, 'NO-GO');
});

test('게이트: 확인할 수 없는 필수 기준이 있으면 통과시키지 않고 HOLD, --strict면 NO-GO', () => {
  const d = data({ jira: { openCritical: null } });
  const r = evaluateGate(CONFIG, d);
  assert.equal(r.verdict, 'HOLD');
  assert.equal(r.rows.find((x) => x.id === 'crit').status, 'unknown');
  assert.equal(evaluateGate(CONFIG, d, { strict: true }).verdict, 'NO-GO');
  // 실패가 있으면 확인 불가가 있어도 NO-GO가 우선
  assert.equal(evaluateGate(CONFIG, data({ jira: { openCritical: null }, tests: { passRate: 50 } })).verdict, 'NO-GO');
});

test('게이트: 참고(warn) 기준은 미충족이거나 확인 불가여도 판정에 영향이 없다', () => {
  assert.equal(evaluateGate(CONFIG, data({ trend: { durationRatio: 3 } })).verdict, 'GO');
  assert.equal(evaluateGate(CONFIG, data({ trend: { durationRatio: null } })).verdict, 'GO');
});

test('게이트 리포트: 판정과 기준별 결과, 사람이 결정한다는 문구를 포함한다', () => {
  const md = gateMarkdown(evaluateGate(CONFIG, data({ jira: { openCritical: null } })), { runId: 'r1', branch: 'main', sha: 'abc', timestamp: 't' });
  for (const s of ['HOLD', '확인 불가', 'P1', '| 기준 | 목표 | 현재 | 결과 |', '사람이 합니다']) assert.ok(md.includes(s), s);
  assert.ok(gateMarkdown(evaluateGate(CONFIG, data({ tests: { passRate: 10 } })), { runId: 'r' }).includes('NO-GO'));
});

test('실행 시간 배율: 이전 전체 실행 2건 이상일 때만 계산하고, 자기 자신은 제외한다', () => {
  const cur = { runId: 'now', tests: { durationSec: 90 } };
  const prev = (id, sec) => ({ runId: id, timestamp: `2026-10-0${id}T00:00:00Z`, scope: 'full', tests: { durationSec: sec } });
  assert.equal(durationRatio(cur, [prev('1', 60)]), null);
  assert.equal(durationRatio(cur, [prev('1', 60), prev('2', 60)]), 1.5);
  assert.equal(durationRatio(cur, [prev('1', 60), prev('2', 60), { ...prev('3', 999), runId: 'now' }]), 1.5);
});

// ----- Jira에서 미해결 Critical 조회 -----
function mockJira(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => handler(req, body, res));
    });
    server.listen(0, () => resolve({ server, url: `http://localhost:${server.address().port}` }));
  });
}
const jiraEnv = (url) => ({ JIRA_BASE_URL: url, JIRA_EMAIL: 'a@b.c', JIRA_API_TOKEN: 't', JIRA_PROJECT_KEY: 'QA' });

test('Jira 조회: 미해결 Highest 이슈 수를 세고, 기본 JQL은 완료되지 않은 것만 본다', async () => {
  let jql = '';
  const { server, url } = await mockJira((req, body, res) => {
    jql = JSON.parse(body).jql;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ issues: [{ key: 'QA-1' }, { key: 'QA-2' }] }));
  });
  try {
    assert.deepEqual(await fetchOpenCritical(jiraEnv(url)), { value: 2, reason: '' });
    assert.match(jql, /project = "QA"/);
    assert.match(jql, /statusCategory != Done/);
    const custom = await fetchOpenCritical({ ...jiraEnv(url), JIRA_CRITICAL_JQL: 'labels = blocker' });
    assert.equal(custom.value, 2);
    assert.equal(jql, 'labels = blocker');
  } finally {
    server.close();
  }
});

test('Jira 조회: 접속 정보가 없거나 오류가 나면 0이 아니라 null(확인 불가)을 돌려준다', async () => {
  assert.equal((await fetchOpenCritical({})).value, null);
  const { server, url } = await mockJira((req, body, res) => {
    res.writeHead(400);
    res.end('priority value does not exist');
  });
  try {
    const r = await fetchOpenCritical(jiraEnv(url));
    assert.equal(r.value, null);
    assert.match(r.reason, /400/);
  } finally {
    server.close();
  }
  assert.equal((await fetchOpenCritical(jiraEnv('http://localhost:1'))).value, null);
});

// ----- 추세 표시 -----
test('스파크라인과 추세 요약', () => {
  assert.equal(sparkline([1, 2, 3, 4, 5, 6, 7, 8]), '▁▂▃▄▅▆▇█');
  assert.equal(sparkline([5, 5, 5]), '███');
  assert.equal(sparkline([1, null, 3]), '▁?█');
  assert.equal(sparkline([]), '');
  const hist = [
    { runId: '1', timestamp: '2026-10-01T00:00:00Z', sha: 'aaa', scope: 'full', failedTcs: ['TC-001'], tests: { passRate: 99, flakyRate: 0, durationSec: 60 }, coverage: { pct: 100 } },
    { runId: '2', timestamp: '2026-10-01T06:00:00Z', sha: 'bbb', scope: 'full', failedTcs: [], tests: { passRate: 100, flakyRate: 0, durationSec: 62 }, coverage: { pct: 100 } },
  ];
  const md = summaryMarkdown(hist);
  for (const s of ['최근 2회', 'aaa', 'bbb', '탐지(TC가 처음 실패한 횟수): 1건', '평균 수정 시간: 6시간', '대용치']) assert.ok(md.includes(s), s);
  assert.match(summaryMarkdown([]), /기록된 실행이 없습니다/);
});
