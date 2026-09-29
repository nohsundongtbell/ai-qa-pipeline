/**
 * 셀프 힐링 안전장치: 제안된 수정안이 "앱 결함을 덮는 수정"이 아닌지 코드로 검사한다.
 * 진단하는 쪽(AI든 사람이든)의 판단과 무관하게, 아래 규칙을 어기는 수정안은 무조건 거절한다.
 *
 *  1) tests/ 아래의 .ts/.js 파일만 수정할 수 있다 (앱 코드, 문서, 워크플로, 스크립트는 불가)
 *  2) 검증 조건(assertion)의 matcher와 기대값, 그리고 숫자 값은 바뀌면 안 된다  (예: toBe(403) → toBe(200) 거절)
 *  3) expect 호출이 줄어들면 안 된다
 *  4) skip / fixme / only / .catch( / force: true 를 새로 넣으면 안 된다
 *  5) 수정 규모 제한: 최대 3곳, 각 30줄 이하
 * 통과해도 expect(...) 안의 대상(locator)이 바뀐 경우는 경고로 남겨 사람이 꼭 확인하게 한다.
 */
const path = require('path');

const MAX_EDITS = 3;
const MAX_LINES = 30;
const ALLOWED_FILE = /^tests\/.+\.(ts|js)$/;
const FORBIDDEN = [
  [/\btest\.(skip|fixme|slow)\b|\.skip\(|\.fixme\(|\.only\(/, 'skip/fixme/only 사용'],
  [/\.catch\s*\(/, '.catch( 로 오류 삼키기'],
  [/force\s*:\s*true/, 'force: true 로 동작 가능 여부 검사 우회'],
];

/** src[openIdx]가 '('일 때 짝이 맞는 ')'의 위치 (문자열 리터럴은 건너뜀) */
function closingParen(src, openIdx) {
  let depth = 0;
  let quote = null;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

/** 정규식으로 시작하는 호출 전체(괄호 인자 포함)를 공백 정규화해서 모은다 */
function extractCalls(src, startRe) {
  const re = new RegExp(startRe.source, 'g');
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    const close = closingParen(src, open);
    out.push(src.slice(m.index, close < 0 ? src.length : close + 1).replace(/\s+/g, ' '));
  }
  return out;
}

// 수정 조각이 '.' 없이 matcher 이름부터 시작해도 잡히도록 앞의 점은 요구하지 않고, not 은 함께 묶는다
const matchersOf = (s) => extractCalls(s, /(?:\bnot\s*\.\s*)?\bto[A-Z]\w*\(/).sort();

/** 문자열 리터럴을 제외한 숫자 리터럴 목록 (상태 코드, 개수, 타임아웃 등 기대값에 쓰이는 값) */
const STRING_LITERAL = /(['"`])(?:\\.|(?!\1)[\s\S])*\1/g;
const numbersOf = (s) => (s.replace(STRING_LITERAL, "''").match(/(?<![\w.$])\d+(?:\.\d+)?(?![\w])/g) || []).sort();
const stringsOf = (s) => (s.match(STRING_LITERAL) || []).sort();
const expectCallsOf = (s) => extractCalls(s, /\bexpect(?:\.soft)?\(/);
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const lineCount = (s) => s.split('\n').length;

/**
 * @param fixes  [{ file, old_string, new_string }]
 * @param readFile  (상대경로) => 파일 내용 (없으면 예외)
 * @returns { ok, reasons: string[], warnings: string[] }
 */
function checkFixes(fixes, readFile) {
  const reasons = [];
  const warnings = [];

  if (!Array.isArray(fixes) || fixes.length === 0) {
    return { ok: false, reasons: ['수정안이 비어 있습니다.'], warnings };
  }
  if (fixes.length > MAX_EDITS) reasons.push(`수정 위치가 ${MAX_EDITS}곳을 넘습니다 (${fixes.length}곳).`);

  fixes.forEach((fix, idx) => {
    const tag = `수정 ${idx + 1}`;
    const { file, old_string: oldS, new_string: newS } = fix || {};
    if (typeof file !== 'string' || typeof oldS !== 'string' || typeof newS !== 'string' || !oldS) {
      reasons.push(`${tag}: file, old_string, new_string 형식이 올바르지 않습니다.`);
      return;
    }
    const rel = path.posix.normalize(file.replace(/\\/g, '/'));
    if (rel.startsWith('..') || path.posix.isAbsolute(rel) || !ALLOWED_FILE.test(rel)) {
      reasons.push(`${tag}: 수정할 수 없는 파일입니다 (${file}). tests/ 아래의 .ts/.js만 허용합니다.`);
      return;
    }
    let content;
    try {
      content = readFile(rel);
    } catch {
      reasons.push(`${tag}: 파일을 읽을 수 없습니다 (${rel}).`);
      return;
    }
    const occurrences = content.split(oldS).length - 1;
    if (occurrences !== 1) {
      reasons.push(`${tag}: old_string이 파일에서 ${occurrences}번 발견되어 적용할 수 없습니다 (정확히 1번이어야 함).`);
      return;
    }
    if (oldS === newS) {
      reasons.push(`${tag}: 변경 내용이 없습니다.`);
      return;
    }
    if (Math.max(lineCount(oldS), lineCount(newS)) > MAX_LINES) {
      reasons.push(`${tag}: 수정 규모가 ${MAX_LINES}줄을 넘습니다.`);
    }

    // 2) 검증 조건(matcher와 기대값)은 그대로여야 한다
    if (!sameList(matchersOf(oldS), matchersOf(newS))) {
      reasons.push(`${tag}: 검증 조건(matcher 또는 기대값)이 바뀌었습니다. 기대값 변경은 앱 결함을 덮을 수 있어 자동 수정할 수 없습니다.`);
    }
    // 2-1) 숫자 값(상태 코드, 개수, 타임아웃 등)이 바뀌면 기대값을 바꾼 것일 수 있다 (상수로 빼 둔 기대값 포함)
    if (!sameList(numbersOf(oldS), numbersOf(newS))) {
      reasons.push(`${tag}: 숫자 값이 바뀌었습니다. 상태 코드, 개수, 타임아웃 같은 값의 변경은 자동 수정할 수 없습니다.`);
    }
    if (!sameList(stringsOf(oldS), stringsOf(newS))) {
      warnings.push(`${tag}: 문자열 값이 바뀌었습니다. 셀렉터/라벨 변경인지, 기대 문구를 바꾼 것은 아닌지 확인하세요.`);
    }
    // 3) expect 호출이 줄면 안 된다
    const oldExpects = expectCallsOf(oldS);
    const newExpects = expectCallsOf(newS);
    if (newExpects.length < oldExpects.length) {
      reasons.push(`${tag}: expect 검증이 ${oldExpects.length}개에서 ${newExpects.length}개로 줄었습니다.`);
    } else if (!sameList([...oldExpects].sort(), [...newExpects].sort())) {
      warnings.push(`${tag}: expect(...) 안의 검증 대상이 바뀌었습니다. 앱 동작이 요구사항과 여전히 같은지 꼭 확인하세요.`);
    }
    // 4) 우회 수단을 새로 넣으면 안 된다
    for (const [re, label] of FORBIDDEN) {
      if (re.test(newS) && !re.test(oldS)) reasons.push(`${tag}: ${label}을(를) 새로 추가했습니다.`);
    }
  });

  return { ok: reasons.length === 0, reasons, warnings };
}

module.exports = { checkFixes, closingParen, extractCalls, matchersOf, expectCallsOf, ALLOWED_FILE };
