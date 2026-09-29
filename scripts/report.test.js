// 보고 스크립트 검증: 실제 Slack/Jira 없이 로컬 목(mock) 서버로 동작을 확인한다.
// 실행: npm run test:report
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { parseResults, runContext, run } = require('./report');

// Playwright JSON 리포트 형식을 흉내 낸 입력
const spec = (title, status, opts = {}) => ({
  title,
  file: opts.file || 'tests/ui/sample.spec.ts',
  tests: [
    {
      projectName: opts.project || 'main',
      status,
      results: [
        ...(opts.retry ? [{ status: 'failed', duration: 100, error: { message: 'first try' } }] : []),
        {
          status: status === 'unexpected' ? 'failed' : 'passed',
          duration: opts.duration || 1000,
          error: status === 'unexpected' ? { message: '\x1b[31mError: expected A\x1b[39m\nReceived: B' } : undefined,
        },
      ],
    },
  ],
});

const sampleJson = {
  stats: { duration: 12345 },
  suites: [
    {
      file: 'tests/ui/sample.spec.ts',
      suites: [
        {
          title: '그룹',
          specs: [
            spec('TC-001 신규 실패 (REQ-001)', 'unexpected'),
            spec('TC-002 이미 이슈가 있는 실패 (REQ-002)', 'unexpected'),
            spec('TC-003 통과 (REQ-003)', 'expected'),
            spec('TC-004 불안정 (REQ-004)', 'flaky', { retry: true }),
            spec('TC-005 건너뜀 (REQ-005)', 'skipped'),
            spec('TC-001 신규 실패 (REQ-001)', 'unexpected', { project: 'iso-ui' }), // 같은 TC가 다른 프로젝트에서도 실패
          ],
        },
      ],
    },
  ],
};

function startMock() {
  const calls = { slack: [], search: [], create: [], comment: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const json = body ? JSON.parse(body) : {};
      const send = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.url === '/slack') {
        calls.slack.push(json);
        return send(200, {});
      }
      if (req.url === '/rest/api/3/search/jql') {
        calls.search.push({ ...json, auth: req.headers.authorization });
        // TC-002만 열린 이슈가 있다고 가정
        return send(200, { issues: json.jql.includes('"TC-002"') ? [{ key: 'QA-7' }] : [] });
      }
      if (req.url === '/rest/api/3/issue') {
        calls.create.push(json);
        return send(201, { key: 'QA-100' });
      }
      const m = req.url.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/comment$/);
      if (m) {
        calls.comment.push({ key: m[1], ...json });
        return send(201, {});
      }
      send(404, { error: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, calls, url: `http://localhost:${server.address().port}` })));
}

const baseEnv = (url) => ({
  SLACK_WEBHOOK_URL: `${url}/slack`,
  JIRA_BASE_URL: url,
  JIRA_EMAIL: 'qa@example.com',
  JIRA_API_TOKEN: 'token',
  JIRA_PROJECT_KEY: 'QA',
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REPOSITORY: 'me/repo',
  GITHUB_RUN_ID: '123',
  GITHUB_REF_NAME: 'main',
  GITHUB_SHA: 'abcdef1234567',
});

const quiet = { log: () => {}, warn: () => {} };

test('결과 파싱: 통과/실패/건너뜀/flaky 집계와 ANSI 제거', () => {
  const s = parseResults(sampleJson);
  assert.equal(s.total, 6);
  assert.equal(s.passed, 1);
  assert.equal(s.failed, 3);
  assert.equal(s.skipped, 1);
  assert.equal(s.flaky, 1);
  assert.equal(s.durationMs, 12345);
  assert.equal(s.failures[0].tcId, 'TC-001');
  assert.ok(!s.failures[0].error.includes('\x1b'));
});

test('GitLab CI 환경변수를 인식하고 이벤트 이름을 맞춘다', () => {
  const ctx = runContext({
    GITLAB_CI: 'true',
    CI_PIPELINE_URL: 'https://gitlab.com/g/p/-/pipelines/9',
    CI_PROJECT_PATH: 'g/p',
    CI_COMMIT_REF_NAME: 'main',
    CI_COMMIT_SHA: 'abcdef1234567',
    CI_PIPELINE_SOURCE: 'merge_request_event',
  });
  assert.deepEqual(ctx, { runUrl: 'https://gitlab.com/g/p/-/pipelines/9', branch: 'main', sha: 'abcdef1', event: 'pull_request', repo: 'g/p' });
  assert.equal(runContext({ GITLAB_CI: 'true', CI_PIPELINE_SOURCE: 'push' }).event, 'push');
});

test('Slack: 요약과 실패 TC 목록, 실행 링크를 전송한다', async () => {
  const { server, calls, url } = await startMock();
  try {
    await run({ json: sampleJson, env: baseEnv(url), ...quiet });
    assert.equal(calls.slack.length, 1);
    const text = calls.slack[0].blocks[0].text.text;
    assert.match(text, /테스트 실패/);
    assert.match(text, /통과 \*1\*/);
    assert.match(text, /실패 \*3\*/);
    assert.match(text, /건너뜀 \*1\*/);
    assert.match(text, /TC-001/);
    assert.match(text, /TC-002/);
    assert.match(text, /TC-004/); // flaky 표시
    assert.match(text, /12초/);
    assert.match(text, /actions\/runs\/123/);
  } finally {
    server.close();
  }
});

test('Jira: 열린 이슈가 없으면 생성, 있으면 코멘트만 추가, TC당 한 번만 처리', async () => {
  const { server, calls, url } = await startMock();
  try {
    const { outcome } = await run({ json: sampleJson, env: baseEnv(url), ...quiet });

    // TC-001 (열린 이슈 없음, 2개 프로젝트에서 실패했어도 1건만 생성)
    assert.equal(calls.create.length, 1);
    assert.equal(calls.create[0].fields.project.key, 'QA');
    assert.deepEqual(calls.create[0].fields.labels, ['auto-qa', 'TC-001']);
    assert.match(calls.create[0].fields.summary, /TC-001/);

    // TC-002 (열린 이슈 QA-7 있음) → 새로 만들지 않고 코멘트만
    assert.equal(calls.comment.length, 1);
    assert.equal(calls.comment[0].key, 'QA-7');

    // 통과/skipped/flaky는 이슈 대상이 아님 (검색도 실패한 2건만)
    assert.equal(calls.search.length, 2);
    assert.ok(calls.search.every((s) => s.jql.includes('statusCategory != Done')));
    assert.match(calls.search[0].auth, /^Basic /);

    assert.deepEqual(
      outcome.jira.map((j) => [j.tcId, j.action]),
      [['TC-001', 'created'], ['TC-002', 'commented']]
    );
  } finally {
    server.close();
  }
});

test('PR 이벤트에서는 Slack만 보내고 Jira 이슈는 만들지 않는다', async () => {
  const { server, calls, url } = await startMock();
  try {
    await run({ json: sampleJson, env: { ...baseEnv(url), GITHUB_EVENT_NAME: 'pull_request' }, ...quiet });
    assert.equal(calls.slack.length, 1);
    assert.equal(calls.search.length + calls.create.length + calls.comment.length, 0);
  } finally {
    server.close();
  }
});

test('실패가 없으면 통과 메시지만 보내고 Jira는 호출하지 않는다', async () => {
  const { server, calls, url } = await startMock();
  try {
    const passing = { stats: { duration: 5000 }, suites: [{ specs: [spec('TC-010 통과', 'expected')] }] };
    await run({ json: passing, env: baseEnv(url), ...quiet });
    assert.match(calls.slack[0].blocks[0].text.text, /테스트 통과/);
    assert.equal(calls.search.length, 0);
  } finally {
    server.close();
  }
});

test('설정이 없으면 예외 없이 건너뛴다 (포크 PR 등 secrets 없는 환경)', async () => {
  const warnings = [];
  const { outcome } = await run({ json: sampleJson, env: { GITHUB_EVENT_NAME: 'push' }, log: () => {}, warn: (m) => warnings.push(m) });
  assert.equal(outcome.slack, 'skipped');
  assert.ok(warnings.some((w) => w.includes('SLACK_WEBHOOK_URL')));
  assert.ok(warnings.some((w) => w.includes('JIRA')));
});

test('Jira가 오류를 반환해도 스크립트는 중단되지 않고 나머지 TC를 계속 처리한다', async () => {
  const { server, calls, url } = await startMock();
  try {
    const failingFetch = (u, opts) => (String(u).includes('/search/jql') && calls.search.length === 0 ? (calls.search.push({ jql: 'x' }), Promise.resolve(new Response('boom', { status: 500 }))) : fetch(u, opts));
    const warnings = [];
    const { outcome } = await run({ json: sampleJson, env: baseEnv(url), fetchImpl: failingFetch, log: () => {}, warn: (m) => warnings.push(m) });
    assert.equal(outcome.jira[0].action, 'error');
    assert.equal(outcome.jira[1].action, 'commented');
    assert.ok(warnings.some((w) => w.includes('Jira 처리 실패')));
  } finally {
    server.close();
  }
});
