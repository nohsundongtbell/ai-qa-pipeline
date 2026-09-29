#!/usr/bin/env node
/**
 * 배포 지표 수집과 품질 게이트(Go/No-Go)
 *
 *   node scripts/metrics.js record  [--input test-report.json] [--history metrics/history.jsonl]
 *       이번 실행의 지표를 계산해 이력(JSON Lines)에 추가한다.
 *   node scripts/metrics.js summary [--history ...] [--last 10]
 *       최근 실행의 추세와 결함 탐지 수/평균 수정 시간을 출력한다.
 *   node scripts/metrics.js gate    [--input ...] [--history ...] [--config quality-gate.json] [--enforce] [--strict]
 *       품질 게이트를 평가한다. GO / NO-GO / HOLD(판정 불가 항목 있음).
 *       --enforce: NO-GO면 종료 코드 1.   --strict: HOLD도 NO-GO로 취급.
 *
 * 지표 정의
 *   통과율      = (통과 + flaky) / (통과 + flaky + 실패)   건너뜀은 제외
 *   flaky 비율  = 재시도 후에야 통과한 테스트 / 전체 테스트
 *   요구사항 커버리지 = 실행된(구현된) TC가 1건 이상 있는 REQ / 전체 REQ
 *   결함 탐지 수 = TC가 "처음 실패"한 횟수, 평균 수정 시간 = 실패한 실행 ~ 다시 통과한 실행 사이 시간
 *                  (테스트 실패를 결함의 대용치로 쓴 값이며 확정 결함 수가 아니다. 전체(full) 실행만 계산)
 */
const fs = require('fs');
const path = require('path');
const { parseResults } = require('./report');

const round1 = (n) => Math.round(n * 10) / 10;
const pct = (a, b) => (b > 0 ? round1((a / b) * 100) : null);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

// ---------- 문서 파싱 ----------

function parseCases(md) {
  const rows = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\| (TC-\d+) \|/);
    if (!m) continue;
    const c = line.split('|').map((s) => s.trim());
    rows.push({ id: c[1], reqs: c[2].split(',').map((s) => s.trim()).filter(Boolean), priority: c[9], auto: c[10] });
  }
  return rows;
}

const parseReqs = (md) => [...md.matchAll(/^### (REQ-\d+)/gm)].map((m) => m[1]);

// ---------- 이번 실행의 지표 ----------

function computeMetrics({ report, casesMd, reqsMd, ctx = {} }) {
  const s = parseResults(report);
  const cases = parseCases(casesMd);
  const byId = new Map(cases.map((c) => [c.id, c]));
  const reqs = parseReqs(reqsMd);

  // TC 단위 결과 (같은 TC를 여러 테스트가 검증하면 하나라도 실패하면 TC 실패)
  const tcs = new Map();
  for (const t of s.tests) {
    if (!t.tcId) continue;
    const cur = tcs.get(t.tcId) || { failed: false, flaky: false, ran: false };
    if (t.status === 'unexpected') cur.failed = true;
    if (t.status === 'flaky') cur.flaky = true;
    if (t.status !== 'skipped') cur.ran = true;
    tcs.set(t.tcId, cur);
  }
  const executed = [...tcs.entries()].filter(([, v]) => v.ran);

  const byPriority = {};
  for (const p of ['P1', 'P2', 'P3']) {
    const ids = executed.filter(([id]) => (byId.get(id) || {}).priority === p);
    const failed = ids.filter(([, v]) => v.failed).length;
    byPriority[p] = { total: ids.length, passed: ids.length - failed, failed, passRate: pct(ids.length - failed, ids.length) };
  }

  const covered = new Set();
  const passing = new Set();
  for (const r of reqs) {
    const mine = executed.filter(([id]) => (byId.get(id) || { reqs: [] }).reqs.includes(r));
    if (mine.length) covered.add(r);
    if (mine.length && mine.every(([, v]) => !v.failed)) passing.add(r);
  }

  const finalPassed = s.passed + s.flaky;
  const docAuto = cases.filter((c) => c.auto === 'Y').length;
  return {
    schema: 1,
    runId: String(ctx.runId || `local-${Date.now()}`),
    timestamp: s.startTime || ctx.now || new Date().toISOString(),
    branch: ctx.branch || 'local',
    sha: (ctx.sha || '').slice(0, 7),
    event: ctx.event || 'local',
    runUrl: ctx.runUrl || '',
    scope: executed.length >= docAuto * 0.9 ? 'full' : 'partial', // 결함 수명 계산에는 전체 실행만 쓴다
    tests: {
      total: s.total,
      passed: s.passed,
      failed: s.failed,
      skipped: s.skipped,
      flaky: s.flaky,
      passRate: pct(finalPassed, finalPassed + s.failed),
      flakyRate: pct(s.flaky, s.total),
      durationSec: Math.round(s.durationMs / 1000),
    },
    byPriority,
    coverage: {
      reqTotal: reqs.length,
      reqCovered: covered.size,
      reqPassing: passing.size,
      pct: pct(covered.size, reqs.length),
      passingPct: pct(passing.size, reqs.length),
      uncovered: reqs.filter((r) => !covered.has(r)),
    },
    automation: { docTc: cases.length, docAuto, implemented: executed.length },
    failedTcs: [...new Set(s.failures.map((f) => f.tcId).filter(Boolean))].sort(),
    flakyTcs: [...new Set(s.flakies.map((f) => f.tcId).filter(Boolean))].sort(),
  };
}

// ---------- 이력 ----------

function readHistory(file, warn = console.warn) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try {
      out.push(JSON.parse(line));
    } catch {
      warn(`${file}:${i + 1} 줄을 읽지 못해 건너뜁니다.`);
    }
  });
  return out;
}

/** 같은 runId의 기록은 교체한다 (재실행, re-run 대비) */
function appendRecord(file, record) {
  const rest = readHistory(file).filter((r) => r.runId !== record.runId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [...rest, record].map((r) => JSON.stringify(r)).join('\n') + '\n');
}

// ---------- 결함 탐지 수, 평균 수정 시간 ----------

function defectStats(history) {
  const runs = history.filter((h) => h.scope === 'full' && h.timestamp).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const open = new Map();
  const resolved = [];
  let detected = 0;
  for (const h of runs) {
    const failing = new Set(h.failedTcs || []);
    for (const tc of failing) {
      if (!open.has(tc)) {
        open.set(tc, h.timestamp);
        detected++;
      }
    }
    for (const [tc, openedAt] of [...open]) {
      if (!failing.has(tc)) {
        resolved.push({ tc, hours: (Date.parse(h.timestamp) - Date.parse(openedAt)) / 36e5 });
        open.delete(tc);
      }
    }
  }
  return {
    runs: runs.length,
    detected,
    resolved: resolved.length,
    open: open.size,
    openTcs: [...open.keys()],
    mttrHours: resolved.length ? round1(mean(resolved.map((r) => r.hours))) : null,
  };
}

// ---------- 품질 게이트 ----------

const getPath = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const OPS = { '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '<': (a, b) => a < b, '==': (a, b) => a === b };

/** 현재 실행 시간이 최근 전체 실행 평균의 몇 배인지 (이전 기록이 2건 미만이면 null) */
function durationRatio(metrics, history, n = 5) {
  const prev = history
    .filter((h) => h.scope === 'full' && h.runId !== metrics.runId && h.timestamp)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .slice(-n);
  if (prev.length < 2) return null;
  return Math.round((metrics.tests.durationSec / mean(prev.map((h) => h.tests.durationSec))) * 100) / 100;
}

/** 미해결 Critical 결함 수: Jira에서 조회. 조회할 수 없으면 null과 이유를 돌려준다 */
async function fetchOpenCritical(env, fetchImpl = fetch) {
  const need = ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY'];
  if (!need.every((k) => env[k])) return { value: null, reason: 'Jira 접속 정보 없음' };
  const jql = env.JIRA_CRITICAL_JQL || `project = "${env.JIRA_PROJECT_KEY}" AND priority = Highest AND statusCategory != Done`;
  try {
    const res = await fetchImpl(`${env.JIRA_BASE_URL.replace(/\/$/, '')}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64'),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ jql, fields: ['summary'], maxResults: 100 }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { value: null, reason: `Jira ${res.status}: ${(await res.text()).slice(0, 120)}` };
    return { value: ((await res.json()).issues || []).length, reason: '' };
  } catch (e) {
    return { value: null, reason: e.message };
  }
}

/**
 * @returns { verdict: 'GO'|'NO-GO'|'HOLD', rows: [{id,label,target,actual,status:'pass'|'fail'|'unknown', level, note}] }
 * level이 'warn'인 기준은 결과를 표시만 하고 판정에는 반영하지 않는다.
 */
function evaluateGate(config, data, { strict = false } = {}) {
  const rows = config.criteria.map((c) => {
    const actual = getPath(data, c.metric);
    const target = `${c.op} ${c.value}`;
    let status = 'unknown';
    if (actual !== undefined && actual !== null) status = OPS[c.op](actual, c.value) ? 'pass' : 'fail';
    return { id: c.id, label: c.label, target, actual: actual ?? null, status, level: c.level || 'must', note: (data.notes || {})[c.id] || '' };
  });
  const must = rows.filter((r) => r.level !== 'warn');
  let verdict = 'GO';
  if (must.some((r) => r.status === 'fail')) verdict = 'NO-GO';
  else if (must.some((r) => r.status === 'unknown')) verdict = strict ? 'NO-GO' : 'HOLD';
  return { verdict, rows };
}

function gateMarkdown({ verdict, rows }, metrics) {
  const icon = { GO: '✅ GO (배포 허용)', 'NO-GO': '❌ NO-GO (배포 불가)', HOLD: '⚠️ HOLD (판정 불가 항목이 있음)' }[verdict];
  const mark = { pass: '✅ 충족', fail: '❌ 미충족', unknown: '❔ 확인 불가' };
  const lines = [
    `## 품질 게이트: ${icon}`,
    '',
    `실행 ${metrics.runId} · ${metrics.branch}${metrics.sha ? ' @ ' + metrics.sha : ''} · ${metrics.timestamp}`,
    '',
    '| 기준 | 목표 | 현재 | 결과 |',
    '|---|---|---|---|',
    ...rows.map((r) => `| ${r.label}${r.level === 'warn' ? ' (참고)' : ''} | ${r.target} | ${r.actual ?? '-'} | ${mark[r.status]}${r.note ? ` (${r.note})` : ''} |`),
    '',
    verdict === 'HOLD' ? '확인 불가 항목은 통과로 간주하지 않았습니다. 데이터를 확인한 뒤 최종 판단은 사람이 합니다.' : '최종 배포 결정은 사람이 합니다.',
  ];
  return lines.join('\n');
}

// ---------- 추세 표시 ----------

function sparkline(values) {
  const v = values.filter((x) => typeof x === 'number');
  if (!v.length) return '';
  const chars = '▁▂▃▄▅▆▇█';
  const min = Math.min(...v);
  const max = Math.max(...v);
  return values.map((x) => (typeof x !== 'number' ? '?' : chars[max === min ? chars.length - 1 : Math.round(((x - min) / (max - min)) * (chars.length - 1))])).join('');
}

function summaryMarkdown(history, last = 10) {
  const runs = [...history].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).slice(-last);
  if (!runs.length) return '기록된 실행이 없습니다. `node scripts/metrics.js record`로 먼저 기록하세요.';
  const d = defectStats(history);
  const t = (ts) => (ts || '').replace('T', ' ').slice(5, 16);
  return [
    `## 품질 지표 추세 (최근 ${runs.length}회)`,
    '',
    '| 시각(UTC) | 커밋 | 통과율 | flaky | 실행 시간 | 커버리지 | 실패 TC |',
    '|---|---|---|---|---|---|---|',
    ...runs.map((r) => `| ${t(r.timestamp)} | ${r.sha || '-'} | ${r.tests.passRate ?? '-'}% | ${r.tests.flakyRate ?? '-'}% | ${r.tests.durationSec}초 | ${r.coverage.pct ?? '-'}% | ${r.failedTcs.length} |`),
    '',
    `통과율 ${sparkline(runs.map((r) => r.tests.passRate))} · 실행 시간 ${sparkline(runs.map((r) => r.tests.durationSec))}`,
    '',
    '### 결함 탐지 수와 평균 수정 시간 (테스트 실패 기준, 전체 실행만)',
    `- 탐지(TC가 처음 실패한 횟수): ${d.detected}건 / 수정 완료: ${d.resolved}건 / 미해결: ${d.open}건${d.openTcs.length ? ` (${d.openTcs.join(', ')})` : ''}`,
    `- 평균 수정 시간: ${d.mttrHours === null ? '수정 완료된 건이 없어 계산할 수 없음' : d.mttrHours + '시간'}`,
    '- 주의: 테스트 실패를 결함의 대용치로 쓴 값입니다. 앱 결함이 아닌 테스트 문제로 인한 실패도 포함됩니다.',
  ].join('\n');
}

// ---------- CLI ----------

function ctxFromEnv(env) {
  const server = env.GITHUB_SERVER_URL || 'https://github.com';
  return {
    runId: env.GITHUB_RUN_ID ? `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT || 1}` : undefined,
    branch: env.GITHUB_REF_NAME,
    sha: env.GITHUB_SHA,
    event: env.GITHUB_EVENT_NAME,
    runUrl: env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID ? `${server}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : '',
  };
}

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) a._.push(argv[i]);
    else if (['enforce', 'strict'].includes(argv[i].slice(2))) a[argv[i].slice(2)] = true;
    else a[argv[i].slice(2)] = argv[++i];
  }
  return a;
}

function loadCurrent(args, env) {
  const input = args.input || 'test-report.json';
  if (!fs.existsSync(input)) throw new Error(`${input} 가 없습니다. 먼저 npx playwright test 를 실행하세요.`);
  const read = (p) => fs.readFileSync(p, 'utf8');
  return computeMetrics({
    report: JSON.parse(read(input)),
    casesMd: read('docs/test-cases.md'),
    reqsMd: read('docs/requirements.md'),
    ctx: ctxFromEnv(env),
  });
}

async function main(argv, env = process.env) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  const historyFile = args.history || 'metrics/history.jsonl';

  if (cmd === 'record') {
    const m = loadCurrent(args, env);
    appendRecord(historyFile, m);
    console.log(`기록 완료 (${historyFile}): 통과율 ${m.tests.passRate}% · flaky ${m.tests.flakyRate}% · ${m.tests.durationSec}초 · 커버리지 ${m.coverage.pct}% · 실패 TC ${m.failedTcs.length}건 [${m.scope}]`);
    return 0;
  }
  if (cmd === 'summary') {
    console.log(summaryMarkdown(readHistory(historyFile), Number(args.last) || 10));
    return 0;
  }
  if (cmd === 'gate') {
    const m = loadCurrent(args, env);
    const history = readHistory(historyFile);
    const config = JSON.parse(fs.readFileSync(args.config || 'quality-gate.json', 'utf8'));
    const crit = await fetchOpenCritical(env);
    const data = {
      ...m,
      jira: { openCritical: crit.value },
      trend: { durationRatio: durationRatio(m, history) },
      notes: { openCritical: crit.reason, durationRegression: '이전 전체 실행 2건 미만이면 계산 불가' },
    };
    if (crit.value !== null) data.notes.openCritical = '';
    if (data.trend.durationRatio !== null) data.notes.durationRegression = '';
    const result = evaluateGate(config, data, { strict: !!args.strict });
    const md = gateMarkdown(result, m);
    console.log(md);
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, md + '\n');
    return args.enforce && result.verdict === 'NO-GO' ? 1 : 0;
  }
  console.log('사용법: node scripts/metrics.js record | summary | gate [--enforce] [--strict]');
  return 1;
}

module.exports = { parseCases, parseReqs, computeMetrics, readHistory, appendRecord, defectStats, durationRatio, fetchOpenCritical, evaluateGate, gateMarkdown, sparkline, summaryMarkdown };

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`오류: ${e.message}`);
      process.exit(2);
    }
  );
}
