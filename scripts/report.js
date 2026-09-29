#!/usr/bin/env node
/**
 * 테스트 결과 보고 스크립트
 *  1) Playwright JSON 결과(test-report.json)를 요약해 Slack Webhook으로 전송
 *  2) 실패한 TC마다 Jira 이슈 생성. 같은 TC의 열린 이슈가 있으면 코멘트만 추가
 *
 * 사용법: node scripts/report.js [--dry-run] [--input <results.json>]
 *
 * 환경변수 (모두 선택. 없으면 해당 기능은 건너뜀)
 *   SLACK_WEBHOOK_URL                        Slack Incoming Webhook URL
 *   JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY   Jira Cloud 접속 정보
 *   JIRA_ISSUE_TYPE                          기본 "Bug"
 *   JIRA_EVENTS                              이슈를 생성할 GitHub 이벤트 (기본 "push,schedule,workflow_dispatch")
 *   GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_REF_NAME, GITHUB_SHA, GITHUB_EVENT_NAME  (GitHub Actions가 제공)
 *   CI_PIPELINE_URL, CI_PROJECT_PATH, CI_COMMIT_REF_NAME, CI_COMMIT_SHA, CI_PIPELINE_SOURCE            (GitLab CI가 제공)
 */
const fs = require('fs');
const path = require('path');

const ANSI = /\x1b\[[0-9;]*m/g;
const TC_ID = /TC-\d+/;

// ---------- 결과 파싱 ----------

function parseResults(json) {
  const tests = [];
  const walk = (suite, file) => {
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        const results = t.results || [];
        const last = results[results.length - 1] || {};
        const message = (last.error && last.error.message) || (last.errors && last.errors[0] && last.errors[0].message) || '';
        tests.push({
          title: spec.title,
          tcId: (spec.title.match(TC_ID) || [null])[0],
          file: spec.file || file,
          project: t.projectName,
          status: t.status, // expected | unexpected | flaky | skipped
          retries: Math.max(results.length - 1, 0),
          duration: results.reduce((sum, r) => sum + (r.duration || 0), 0),
          error: message.replace(ANSI, '').trim(),
        });
      }
    }
    for (const child of suite.suites || []) walk(child, child.file || file);
  };
  for (const s of json.suites || []) walk(s, s.file);

  const count = (st) => tests.filter((t) => t.status === st).length;
  return {
    total: tests.length,
    passed: count('expected'),
    failed: count('unexpected'),
    flaky: count('flaky'),
    skipped: count('skipped'),
    durationMs: (json.stats && json.stats.duration) || tests.reduce((s, t) => s + t.duration, 0),
    failures: tests.filter((t) => t.status === 'unexpected'),
    flakies: tests.filter((t) => t.status === 'flaky'),
    tests, // 전체 목록 (scripts/metrics.js가 TC 단위 지표를 계산할 때 사용)
    startTime: (json.stats && json.stats.startTime) || '',
  };
}

// ---------- 실행 컨텍스트 ----------

function runContext(env) {
  if (env.GITLAB_CI) {
    // GitLab CI: 이벤트 이름을 GitHub 방식으로 맞춘다
    const events = { merge_request_event: 'pull_request', web: 'workflow_dispatch' };
    const src = env.CI_PIPELINE_SOURCE || 'local';
    return {
      runUrl: env.CI_PIPELINE_URL || '',
      branch: env.CI_COMMIT_REF_NAME || 'local',
      sha: (env.CI_COMMIT_SHA || '').slice(0, 7),
      event: events[src] || src,
      repo: env.CI_PROJECT_PATH || '',
    };
  }
  const server = env.GITHUB_SERVER_URL || 'https://github.com';
  const repo = env.GITHUB_REPOSITORY || '';
  return {
    runUrl: repo && env.GITHUB_RUN_ID ? `${server}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : '',
    branch: env.GITHUB_REF_NAME || 'local',
    sha: (env.GITHUB_SHA || '').slice(0, 7),
    event: env.GITHUB_EVENT_NAME || 'local',
    repo,
  };
}

const fmtDuration = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`;
};
const slackEscape = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// 오류 메시지의 앞 3줄(기대값/실제값 등)을 한 줄로 줄인다
const oneLine = (t, n = 200) => {
  const s = String(t).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' | ');
  return s.length > n ? s.slice(0, n) + '…' : s;
};

// ---------- Slack ----------

function buildSlackPayload(summary, ctx) {
  const ok = summary.failed === 0 && summary.total > 0;
  const head = ok ? '✅ 테스트 통과' : summary.total === 0 ? '⚠️ 테스트 결과 없음' : '❌ 테스트 실패';
  const lines = [
    `*${head}* — ${ctx.repo || 'local'} (${ctx.branch}${ctx.sha ? ' @ ' + ctx.sha : ''}, ${ctx.event})`,
    `통과 *${summary.passed}* · 실패 *${summary.failed}* · 건너뜀 *${summary.skipped}* · 불안정(flaky) *${summary.flaky}* / 전체 ${summary.total}건 · ${fmtDuration(summary.durationMs)}`,
  ];
  if (summary.failures.length) {
    const max = 10;
    lines.push('*실패 TC*');
    for (const f of summary.failures.slice(0, max)) {
      lines.push(`• ${slackEscape(f.tcId || f.title)} — ${slackEscape(f.title.replace(TC_ID, '').trim() || f.file)}\n    \`${slackEscape(oneLine(f.error))}\``);
    }
    if (summary.failures.length > max) lines.push(`…외 ${summary.failures.length - max}건`);
  }
  if (summary.flakies.length) {
    lines.push(`*불안정 TC(재시도 후 통과)*: ${summary.flakies.map((f) => slackEscape(f.tcId || f.title)).join(', ')}`);
  }
  if (ctx.runUrl) lines.push(`<${ctx.runUrl}|실행 결과와 리포트 보기>`);
  return { text: `${head} — 통과 ${summary.passed}, 실패 ${summary.failed}`, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } }] };
}

// ---------- Jira ----------

const adf = {
  doc: (...content) => ({ type: 'doc', version: 1, content }),
  p: (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] }),
  code: (text) => ({ type: 'codeBlock', content: [{ type: 'text', text }] }),
};

function jiraBody(failure, ctx) {
  return adf.doc(
    adf.p(`자동화 테스트 실패: ${failure.title}`),
    adf.p(`브랜치: ${ctx.branch} / 커밋: ${ctx.sha || '-'} / 이벤트: ${ctx.event} / 프로젝트: ${failure.project}`),
    adf.p(`파일: ${failure.file}${failure.retries ? ` (재시도 ${failure.retries}회 후에도 실패)` : ''}`),
    ...(ctx.runUrl ? [adf.p(`실행 결과: ${ctx.runUrl}`)] : []),
    adf.p('오류 내용:'),
    adf.code(failure.error.slice(0, 3000) || '(오류 메시지 없음)')
  );
}

function jiraClient(env, fetchImpl) {
  const base = env.JIRA_BASE_URL.replace(/\/$/, '');
  const auth = 'Basic ' + Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64');
  const call = async (method, urlPath, body) => {
    const res = await fetchImpl(base + urlPath, {
      method,
      headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Jira ${method} ${urlPath} → ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  };
  const project = env.JIRA_PROJECT_KEY;
  return {
    findOpen: async (tcId) => {
      const jql = `project = "${project}" AND labels = "${tcId}" AND statusCategory != Done ORDER BY created DESC`;
      const r = await call('POST', '/rest/api/3/search/jql', { jql, fields: ['summary', 'status'], maxResults: 1 });
      return (r.issues || [])[0] || null;
    },
    create: (failure, ctx) =>
      call('POST', '/rest/api/3/issue', {
        fields: {
          project: { key: project },
          issuetype: { name: env.JIRA_ISSUE_TYPE || 'Bug' },
          summary: `[자동화 실패] ${failure.title}`.slice(0, 250),
          labels: ['auto-qa', failure.tcId],
          description: jiraBody(failure, ctx),
        },
      }),
    comment: (key, failure, ctx) => call('POST', `/rest/api/3/issue/${key}/comment`, { body: jiraBody(failure, ctx) }),
    // 본문을 직접 넘기는 범용 버전 (scripts/heal.js에서 AI 분석 결과를 남길 때 사용)
    createIssue: ({ summary, labels, description }) =>
      call('POST', '/rest/api/3/issue', {
        fields: {
          project: { key: project },
          issuetype: { name: env.JIRA_ISSUE_TYPE || 'Bug' },
          summary: summary.slice(0, 250),
          labels,
          description,
        },
      }),
    addComment: (key, body) => call('POST', `/rest/api/3/issue/${key}/comment`, { body }),
  };
}

// ---------- 실행 ----------

async function run({ json, env = process.env, fetchImpl = fetch, dryRun = false, log = console.log, warn = console.warn }) {
  const summary = parseResults(json);
  const ctx = runContext(env);
  const outcome = { slack: 'skipped', jira: [] };

  // Slack
  const payload = buildSlackPayload(summary, ctx);
  if (dryRun) {
    log('[dry-run] Slack 전송 내용:\n' + JSON.stringify(payload, null, 2));
    outcome.slack = 'dry-run';
  } else if (!env.SLACK_WEBHOOK_URL) {
    warn('SLACK_WEBHOOK_URL이 없어 Slack 보고를 건너뜁니다.');
  } else {
    try {
      const res = await fetchImpl(env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      outcome.slack = 'sent';
      log('Slack 보고 전송 완료');
    } catch (e) {
      outcome.slack = 'error';
      warn(`Slack 전송 실패: ${e.message}`);
    }
  }

  // Jira: 실패한 TC마다 이슈 생성 또는 코멘트 (TC당 1회)
  const events = (env.JIRA_EVENTS || 'push,schedule,workflow_dispatch').split(',').map((s) => s.trim());
  const jiraReady = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY'].every((k) => env[k]);
  const byTc = new Map();
  for (const f of summary.failures) {
    if (!f.tcId) {
      warn(`TC ID가 없는 실패는 Jira 대상에서 제외합니다: ${f.title}`);
      continue;
    }
    if (!byTc.has(f.tcId)) byTc.set(f.tcId, f);
  }

  if (!byTc.size) {
    log('Jira: 등록할 실패 TC가 없습니다.');
  } else if (!dryRun && !events.includes(ctx.event)) {
    log(`Jira: '${ctx.event}' 이벤트는 이슈 생성 대상이 아니라 건너뜁니다 (대상: ${events.join(', ')}).`);
  } else if (!dryRun && !jiraReady) {
    warn('Jira 접속 정보(JIRA_*)가 없어 이슈 등록을 건너뜁니다.');
  } else {
    const jira = dryRun ? null : jiraClient(env, fetchImpl);
    for (const [tcId, failure] of byTc) {
      if (dryRun) {
        log(`[dry-run] ${tcId}: 열린 이슈를 검색하고, 없으면 생성 / 있으면 코멘트 추가\n  제목: [자동화 실패] ${failure.title}\n  오류: ${oneLine(failure.error)}`);
        outcome.jira.push({ tcId, action: 'dry-run' });
        continue;
      }
      try {
        const existing = await jira.findOpen(tcId);
        if (existing) {
          await jira.comment(existing.key, failure, ctx);
          outcome.jira.push({ tcId, action: 'commented', key: existing.key });
          log(`Jira: ${tcId} 열린 이슈 ${existing.key}에 코멘트 추가`);
        } else {
          const created = await jira.create(failure, ctx);
          outcome.jira.push({ tcId, action: 'created', key: created.key });
          log(`Jira: ${tcId} 새 이슈 ${created.key} 생성`);
        }
      } catch (e) {
        outcome.jira.push({ tcId, action: 'error' });
        warn(`Jira 처리 실패 (${tcId}): ${e.message}`);
      }
    }
  }
  return { summary, outcome };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const i = args.indexOf('--input');
  const input = path.resolve(i >= 0 ? args[i + 1] : 'test-report.json');

  let json;
  try {
    json = JSON.parse(fs.readFileSync(input, 'utf8'));
  } catch (e) {
    // 결과 파일이 없다 = 테스트가 시작조차 못 했다는 뜻이므로 빈 결과로 보고한다
    console.warn(`::warning::결과 파일을 읽지 못했습니다 (${input}): ${e.message}`);
    json = { suites: [], stats: { duration: 0 } };
  }
  const { summary } = await run({
    json,
    dryRun,
    warn: (m) => console.warn(process.env.GITHUB_ACTIONS ? `::warning::${m}` : m),
  });
  console.log(`요약: 통과 ${summary.passed}, 실패 ${summary.failed}, 건너뜀 ${summary.skipped}, flaky ${summary.flaky}`);
}

module.exports = { parseResults, buildSlackPayload, runContext, run, jiraClient, adf };

if (require.main === module) {
  main().catch((e) => {
    // 보고 실패가 테스트 결과를 가리지 않도록 경고만 남기고 종료한다
    console.warn(`::warning::보고 스크립트 오류: ${e.message}`);
  });
}
