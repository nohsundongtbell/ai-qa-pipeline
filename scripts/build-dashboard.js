#!/usr/bin/env node
/**
 * 지표 대시보드(정적 페이지)를 만든다. GitHub Pages 배포와 로컬 미리보기에 같이 쓴다.
 *
 *   node scripts/build-dashboard.js [--history metrics/history.jsonl] [--out _site] [--repo owner/name]
 *
 * dashboard/ 의 파일을 out 폴더로 복사하고, 이력(JSON Lines)을 읽어 data.json 을 만든다.
 *   data.json = { repo, generatedAt, runs: [시간순 실행 기록], defects: defectStats(이력) }
 * 공개 페이지에 올라가므로 기록의 필드 중 화면에 쓰는 것만 남긴다(화이트리스트).
 */
const fs = require('fs');
const path = require('path');
const { readHistory, defectStats } = require('./metrics');

const DASHBOARD_DIR = path.join(__dirname, '..', 'dashboard');

/** 공개할 필드만 남긴다. 알 수 없는 필드(앞으로 기록에 추가될 것 포함)는 내보내지 않는다. */
function publicRun(r) {
  const t = r.tests || {};
  const c = r.coverage || {};
  return {
    runId: String(r.runId || ''),
    timestamp: r.timestamp,
    sha: r.sha || '',
    branch: r.branch || '',
    event: r.event || '',
    runUrl: /^https:\/\/github\.com\//.test(r.runUrl || '') ? r.runUrl : '',
    scope: r.scope || '',
    tests: { total: t.total, passed: t.passed, failed: t.failed, skipped: t.skipped, flaky: t.flaky, passRate: t.passRate, flakyRate: t.flakyRate, durationSec: t.durationSec },
    byPriority: r.byPriority || {},
    coverage: { reqTotal: c.reqTotal, reqCovered: c.reqCovered, reqPassing: c.reqPassing, pct: c.pct, passingPct: c.passingPct, uncovered: c.uncovered || [] },
    failedTcs: r.failedTcs || [],
    flakyTcs: r.flakyTcs || [],
  };
}

function buildData(history, { repo = '', now = new Date().toISOString() } = {}) {
  const runs = history
    .filter((r) => r && r.timestamp && !Number.isNaN(Date.parse(r.timestamp)) && r.tests)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    .map(publicRun);
  return { repo, generatedAt: now, runs, defects: defectStats(history) };
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i];
  return a;
}

function main(argv, env = process.env) {
  const args = parseArgs(argv);
  const historyFile = args.history || 'metrics/history.jsonl';
  const out = args.out || '_site';
  const history = readHistory(historyFile);
  const data = buildData(history, { repo: args.repo || env.GITHUB_REPOSITORY || '' });
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(DASHBOARD_DIR)) fs.copyFileSync(path.join(DASHBOARD_DIR, f), path.join(out, f));
  fs.writeFileSync(path.join(out, 'data.json'), JSON.stringify(data) + '\n');
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
  console.log(`대시보드 생성: ${out}/ (실행 ${data.runs.length}회${history.length ? '' : ` — ${historyFile} 이 없거나 비어 있어 빈 대시보드`})`);
  return 0;
}

module.exports = { publicRun, buildData };

if (require.main === module) process.exit(main(process.argv.slice(2)));
