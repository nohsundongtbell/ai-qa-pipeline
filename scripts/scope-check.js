#!/usr/bin/env node
/**
 * 에이전트 역할 범위 검사기
 *
 * 서브에이전트가 자기 역할 밖의 파일을 수정하지 못했는지 사후에 검사한다. 에이전트의 도구 목록과 프롬프트는
 * 지시일 뿐이므로, 실제로 무엇이 바뀌었는지를 파일 내용 해시로 확인한다.
 *
 *   node scripts/scope-check.js snapshot            에이전트를 호출하기 전의 상태를 기록
 *   node scripts/scope-check.js check --role writer 호출 후 바뀐 파일이 역할 범위 안인지 검사 (밖이면 exit 1)
 *
 * 역할별 수정 허용 범위 (그 밖의 변경은 위반)
 *   planner   docs/test-plan.md, docs/test-cases.md  (요구사항 docs/requirements.md는 사람의 것이라 수정 불가)
 *   writer    tests/
 *   runner    없음 (실행과 보고만, 파일 수정 불가)
 *   healer    없음 (진단은 무시 대상인 heal-work/에만 쓰고, 테스트 수정은 heal.js가 별도 브랜치에서 처리)
 *   reporter  reports/
 * .gitignore 대상(heal-work/, test-results/ 등)은 검사에서 제외된다.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROLES = {
  planner: ['docs/test-plan.md', 'docs/test-cases.md'],
  writer: ['tests/'],
  runner: [],
  healer: [],
  reporter: ['reports/'],
};

const isAllowed = (role, file) => ROLES[role].some((rule) => (rule.endsWith('/') ? file.startsWith(rule) : file === rule));

/** 기준 상태와 현재 상태의 차이 (추가, 수정, 삭제된 파일 경로 목록) */
function diffMaps(base, current) {
  const keys = new Set([...Object.keys(base), ...Object.keys(current)]);
  return [...keys].filter((k) => base[k] !== current[k]).sort();
}

function violations(role, changed) {
  if (!ROLES[role]) throw new Error(`알 수 없는 역할: ${role} (가능: ${Object.keys(ROLES).join(', ')})`);
  return changed.filter((f) => !isAllowed(role, f));
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** 내용 해시. Windows에서 git이 LF/CRLF를 바꿔 써도 같은 파일로 보도록 텍스트는 줄바꿈을 통일한다 */
function hashFile(file) {
  let buf = fs.readFileSync(file);
  if (!buf.includes(0)) buf = Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8'); // NUL이 있으면 바이너리
  return crypto.createHash('sha1').update(buf).digest('hex');
}

/** 추적 중이거나 새로 생긴(무시 대상이 아닌) 모든 파일의 내용 해시 */
function fileMap() {
  const files = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean);
  const map = {};
  for (const f of files) map[f] = fs.existsSync(f) ? hashFile(f) : 'DELETED';
  return map;
}

const baselinePath = () => path.join(git('rev-parse', '--git-dir').trim(), 'qa-scope-baseline.json');

function main(argv) {
  const cmd = argv[0];
  if (cmd === 'snapshot') {
    const map = fileMap();
    fs.writeFileSync(baselinePath(), JSON.stringify(map));
    console.log(`기준 상태를 기록했습니다 (파일 ${Object.keys(map).length}개).`);
    return 0;
  }
  if (cmd === 'check') {
    const i = argv.indexOf('--role');
    const role = argv[i + 1];
    if (i < 0 || !role) throw new Error('--role <planner|writer|runner|healer|reporter> 를 지정하세요.');
    if (!fs.existsSync(baselinePath())) throw new Error('기준 상태가 없습니다. 먼저 snapshot 을 실행하세요.');
    const changed = diffMaps(JSON.parse(fs.readFileSync(baselinePath(), 'utf8')), fileMap());
    const bad = violations(role, changed);
    console.log(`[${role}] 변경된 파일 ${changed.length}개${changed.length ? ':\n' + changed.map((f) => `  ${bad.includes(f) ? '✗' : '✓'} ${f}`).join('\n') : ''}`);
    if (bad.length) {
      console.log(`\n🚫 범위 위반: ${role} 은(는) 아래 파일을 바꿀 수 없습니다.\n${bad.map((f) => `  - ${f}`).join('\n')}\n변경을 되돌린 뒤(git checkout/삭제) 다시 진행하세요. 원인 확인 전에는 다음 단계로 넘어가지 마세요.`);
      return 1;
    }
    console.log('✅ 범위 안의 변경만 있습니다.');
    return 0;
  }
  console.log('사용법: node scripts/scope-check.js snapshot | check --role <planner|writer|runner|healer|reporter>');
  return 1;
}

module.exports = { ROLES, isAllowed, diffMaps, violations };

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error(`오류: ${e.message}`);
    process.exit(2);
  }
}
