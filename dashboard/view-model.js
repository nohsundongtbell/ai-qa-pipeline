/**
 * 지표 대시보드의 계산 부분 (DOM 없음). 브라우저에서는 window.QaDashboard, Node에서는 require로 쓴다.
 * 입력은 scripts/build-dashboard.js 가 만든 data.json 의 runs (시간순, scripts/metrics.js 의 기록 형식).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QaDashboard = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  /** 최근 n개 실행 (n이 'all'이거나 runs보다 크면 전체) */
  function selectRange(runs, n) {
    if (n === 'all' || !isNum(Number(n))) return runs.slice();
    return runs.slice(-Number(n));
  }

  /** 직전 값 대비 변화. 둘 중 하나라도 숫자가 아니면 null */
  function delta(curr, prev) {
    if (!isNum(curr) || !isNum(prev)) return null;
    return Math.round((curr - prev) * 10) / 10;
  }

  /**
   * 지표 카드. good: 값이 오르는 것이 좋은지(true) 나쁜지(false).
   * tone: 'good' | 'bad' | 'flat' | null (비교할 이전 값 없음)
   */
  function kpis(runs) {
    const last = runs[runs.length - 1];
    const prev = runs[runs.length - 2];
    if (!last) return [];
    const card = (key, label, unit, get, good) => {
      const value = get(last);
      const d = prev ? delta(value, get(prev)) : null;
      const tone = d === null ? null : d === 0 ? 'flat' : (d > 0) === good ? 'good' : 'bad';
      return { key, label, unit, value: isNum(value) ? value : null, delta: d, tone };
    };
    return [
      card('passRate', '통과율', '%', (r) => r.tests.passRate, true),
      card('flakyRate', 'flaky 비율', '%', (r) => r.tests.flakyRate, false),
      card('coverage', '요구사항 커버리지', '%', (r) => r.coverage.pct, true),
      card('duration', '실행 시간', '초', (r) => r.tests.durationSec, false),
      card('failedTcs', '실패 TC', '건', (r) => (r.failedTcs || []).length, false),
    ];
  }

  /** 차트 한 개의 시리즈 값 (실행 순서대로). 값이 없으면 null */
  function series(runs, get) {
    return runs.map((r) => {
      const v = get(r);
      return isNum(v) ? v : null;
    });
  }

  /** 축 눈금: 0부터 max 이상까지 1·2·5 단위로 count개 안팎 */
  function niceTicks(max, count = 4) {
    if (!isNum(max) || max <= 0) return [0, 1];
    const raw = max / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const top = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return ticks;
  }

  /** 백분율 축: 데이터가 높은 쪽에 몰려 있으면 아래쪽을 잘라 변화가 보이게 한다 (0·50·80·90·95 중 데이터 최솟값보다 낮은 가장 큰 값) */
  function percentDomain(values) {
    const v = values.filter(isNum);
    if (!v.length) return [0, 100];
    const min = Math.min(...v);
    const lo = [95, 90, 80, 50, 0].find((x) => x <= min - 1) ?? 0;
    return [lo, 100];
  }

  /** "2026-09-29T02:44:32.948Z" → "09-29 11:44" (KST) */
  function formatKst(iso) {
    const t = Date.parse(iso);
    if (!isNum(t)) return '-';
    const d = new Date(t + 9 * 36e5);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  }

  function formatValue(v, unit) {
    if (!isNum(v)) return '-';
    return `${Number.isInteger(v) ? v : v.toFixed(1)}${unit}`;
  }

  /** 실행이 통과(실패 TC 없음)인지, 실패인지 */
  const runStatus = (r) => ((r.failedTcs || []).length === 0 && (r.tests.failed || 0) === 0 ? 'pass' : 'fail');

  return { selectRange, delta, kpis, series, niceTicks, percentDomain, formatKst, formatValue, runStatus };
});
