/* 지표 대시보드 화면. 계산은 view-model.js(QaDashboard), 여기서는 그리기만 한다. 외부 라이브러리 없음. */
(function () {
  const Q = window.QaDashboard;
  const SVG = 'http://www.w3.org/2000/svg';
  const RANGE_KEY = 'qa-dashboard-range';
  let data = null;
  let range = '30';

  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, text) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const svgEl = (tag, attrs = {}) => {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };

  // ---------- 툴팁 ----------
  const tip = $('tooltip');
  function showTip(x, y, head, rows) {
    tip.replaceChildren(el('div', { class: 't-head' }, head));
    for (const r of rows) {
      const row = el('div', { class: 't-row' });
      if (r.color) {
        const key = el('span', { class: 't-key' });
        key.style.background = r.color;
        row.append(key);
      }
      row.append(el('b', {}, r.value), document.createTextNode(` ${r.label}`));
      tip.append(row);
    }
    tip.hidden = false;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    tip.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, x + 14))}px`;
    tip.style.top = `${Math.max(8, y - h - 12)}px`;
  }
  const hideTip = () => (tip.hidden = true);

  const cssVar = (name) => getComputedStyle(document.querySelector('.viz-root')).getPropertyValue(name).trim();
  const runHead = (r) => `${Q.formatKst(r.timestamp)} · ${r.sha || '-'}`;

  // ---------- 차트 공통 ----------
  const M = { top: 12, right: 44, bottom: 26, left: 40 };

  function frame(container, domain, unit) {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, role: 'img', tabindex: '0' });
    const pw = w - M.left - M.right;
    const ph = h - M.top - M.bottom;
    const [lo, hi] = domain;
    const y = (v) => M.top + ph - ((v - lo) / (hi - lo || 1)) * ph;
    const axis = svgEl('g', { class: 'axis' });
    const ticks = lo === 0 ? Q.niceTicks(hi).filter((t) => t <= hi) : [lo, (lo + hi) / 2, hi];
    for (const t of ticks) {
      const ty = y(t);
      axis.append(svgEl('line', { class: t === lo ? 'baseline' : 'gridline', x1: M.left, x2: M.left + pw, y1: ty, y2: ty }));
      const label = svgEl('text', { x: M.left - 6, y: ty + 4, 'text-anchor': 'end' });
      label.textContent = `${t}${unit}`;
      axis.append(label);
    }
    svg.append(axis);
    return { svg, w, h, pw, ph, y, axis };
  }

  /** x 축 시각 눈금: 처음·끝·가운데 정도만 */
  function xLabels(f, runs, x) {
    if (!runs.length) return;
    // 폭이 좁으면 가운데 눈금은 겹치므로 처음과 끝만
    const mid = f.w < 420 ? [] : [Math.floor((runs.length - 1) / 2)];
    const idx = runs.length === 1 ? [0] : [...new Set([0, ...mid, runs.length - 1])];
    for (const i of idx) {
      const t = svgEl('text', { x: x(i), y: f.h - 6, 'text-anchor': i === 0 && runs.length > 1 ? 'start' : i === runs.length - 1 && runs.length > 1 ? 'end' : 'middle' });
      t.textContent = Q.formatKst(runs[i].timestamp);
      f.axis.append(t);
    }
  }

  /** 꺾은선 (단일 축). series: [{ name, values, color }] */
  function lineChart(container, runs, series, { domain, unit, label }) {
    container.replaceChildren();
    const f = frame(container, domain, unit);
    const n = runs.length;
    const x = (i) => M.left + (n <= 1 ? f.pw / 2 : (i / (n - 1)) * f.pw);
    xLabels(f, runs, x);
    f.svg.setAttribute('aria-label', `${label}: 최근 ${n}회 추세. 값은 아래 실행 기록 표에도 있습니다.`);

    for (const s of series) {
      let d = '';
      s.values.forEach((v, i) => {
        if (v === null) return;
        d += `${d && s.values[i - 1] !== null ? 'L' : 'M'}${x(i)},${f.y(v)}`;
      });
      f.svg.append(svgEl('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      // 끝점 표시와 값 (마지막 값만)
      const li = s.values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop();
      if (li !== undefined) {
        f.svg.append(svgEl('circle', { cx: x(li), cy: f.y(s.values[li]), r: 4, fill: s.color, stroke: cssVar('--surface-1'), 'stroke-width': 2 }));
        if (series.length === 1) {
          const t = svgEl('text', { class: 'end-label', x: x(li) + 8, y: f.y(s.values[li]) + 4 });
          t.textContent = Q.formatValue(s.values[li], unit);
          f.svg.append(t);
        }
      }
    }

    // 크로스헤어 + 툴팁 (포인터와 방향키)
    const cross = svgEl('line', { class: 'crosshair', y1: M.top, y2: M.top + f.ph, visibility: 'hidden' });
    const dots = series.map((s) => svgEl('circle', { r: 4, fill: s.color, stroke: cssVar('--surface-1'), 'stroke-width': 2, visibility: 'hidden' }));
    f.svg.append(cross, ...dots);
    const hit = svgEl('rect', { x: M.left - 8, y: M.top, width: f.pw + 16, height: f.ph, fill: 'transparent' });
    f.svg.append(hit);
    let cur = -1;
    const at = (i, cx, cy) => {
      cur = i;
      const px = x(i);
      cross.setAttribute('x1', px);
      cross.setAttribute('x2', px);
      cross.setAttribute('visibility', 'visible');
      series.forEach((s, k) => {
        const v = s.values[i];
        dots[k].setAttribute('visibility', v === null ? 'hidden' : 'visible');
        if (v !== null) {
          dots[k].setAttribute('cx', px);
          dots[k].setAttribute('cy', f.y(v));
        }
      });
      showTip(cx, cy, runHead(runs[i]), series.map((s) => ({ value: Q.formatValue(s.values[i], unit), label: s.name, color: s.color })));
    };
    const clear = () => {
      cur = -1;
      cross.setAttribute('visibility', 'hidden');
      dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
      hideTip();
    };
    hit.addEventListener('pointermove', (e) => {
      const r = f.svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * f.w;
      const i = n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - M.left) / f.pw) * (n - 1))));
      at(i, e.clientX, e.clientY);
    });
    hit.addEventListener('pointerleave', clear);
    f.svg.addEventListener('blur', clear);
    f.svg.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || !n) return;
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : Math.max(0, Math.min(n - 1, (cur < 0 ? n - 1 : cur) + (e.key === 'ArrowLeft' ? -1 : 1)));
      const r = f.svg.getBoundingClientRect();
      at(next, r.left + (x(next) / f.w) * r.width, r.top + 20);
    });
    container.append(f.svg);
  }

  /** 세로 막대 (실행 시간). 막대가 곧 hover 대상 */
  function columnChart(container, runs, values, { unit, label, color }) {
    container.replaceChildren();
    const max = Math.max(1, ...values.filter((v) => v !== null));
    const ticks = Q.niceTicks(max);
    const f = frame(container, [0, ticks[ticks.length - 1]], unit);
    const n = runs.length;
    const band = f.pw / Math.max(1, n);
    const bw = Math.max(2, Math.min(24, band - 2));
    const x = (i) => M.left + band * i + band / 2;
    xLabels(f, runs, x);
    f.svg.setAttribute('aria-label', `${label}: 최근 ${n}회. 값은 아래 실행 기록 표에도 있습니다.`);
    const base = f.y(0);
    values.forEach((v, i) => {
      if (v === null) return;
      const top = f.y(v);
      const hgt = Math.max(1, base - top);
      const rr = Math.min(4, bw / 2, hgt);
      const l = x(i) - bw / 2;
      const d = `M${l},${base}V${top + rr}Q${l},${top} ${l + rr},${top}H${l + bw - rr}Q${l + bw},${top} ${l + bw},${top + rr}V${base}Z`;
      const bar = svgEl('path', { d, fill: color });
      const hit = svgEl('rect', { x: M.left + band * i, y: M.top, width: band, height: f.ph, fill: 'transparent' });
      const show = (e) => showTip(e.clientX, e.clientY, runHead(runs[i]), [{ value: Q.formatValue(v, unit), label: '실행 시간', color }]);
      hit.addEventListener('pointermove', show);
      hit.addEventListener('pointerleave', hideTip);
      f.svg.append(bar, hit);
    });
    const li = values.length - 1;
    if (li >= 0 && values[li] !== null) {
      const t = svgEl('text', { class: 'end-label', x: x(li), y: f.y(values[li]) - 6, 'text-anchor': 'middle' });
      t.textContent = Q.formatValue(values[li], unit);
      f.svg.insertBefore(t, f.svg.firstChild.nextSibling);
    }
    container.append(f.svg);
  }

  // ---------- 화면 조각 ----------
  function renderTiles(runs) {
    const box = $('tiles');
    box.replaceChildren();
    for (const k of Q.kpis(runs)) {
      const tile = el('div', { class: 'tile' });
      tile.append(el('div', { class: 'label' }, k.label), el('div', { class: 'value' }, Q.formatValue(k.value, k.unit)));
      let text = '이전 실행 없음';
      if (k.delta !== null) {
        const sign = k.delta > 0 ? '▲ +' : k.delta < 0 ? '▼ ' : '';
        const word = k.tone === 'good' ? ' (개선)' : k.tone === 'bad' ? ' (악화)' : '';
        text = k.delta === 0 ? '직전 실행과 같음' : `직전 대비 ${sign}${k.delta}${k.unit === '%' ? '%p' : k.unit}${word}`;
      }
      tile.append(el('div', { class: `delta ${k.tone || ''}` }, text));
      box.append(tile);
    }
  }

  function renderDefects(d) {
    const dl = $('defects');
    dl.replaceChildren();
    const items = [
      ['탐지 (TC가 처음 실패)', `${d.detected}건`],
      ['수정 완료', `${d.resolved}건`],
      ['미해결', `${d.open}건${d.openTcs.length ? ` (${d.openTcs.join(', ')})` : ''}`],
      ['평균 수정 시간', d.mttrHours === null ? '계산 불가' : `${d.mttrHours}시간`],
    ];
    for (const [k, v] of items) {
      const g = el('div');
      g.append(el('dt', {}, k), el('dd', {}, v));
      dl.append(g);
    }
  }

  function renderTable(runs) {
    const body = $('runs');
    body.replaceChildren();
    for (const r of [...runs].reverse()) {
      const tr = el('tr');
      const time = el('td');
      if (r.runUrl) time.append(el('a', { href: r.runUrl, rel: 'noopener' }, Q.formatKst(r.timestamp)));
      else time.textContent = Q.formatKst(r.timestamp);
      const commit = el('td');
      if (r.sha && data.repo) commit.append(el('a', { href: `https://github.com/${data.repo}/commit/${r.sha}`, rel: 'noopener' }, r.sha));
      else commit.textContent = r.sha || '-';
      const st = Q.runStatus(r);
      const status = el('td');
      status.append(el('span', { class: `status ${st}` }, st === 'pass' ? '통과' : '실패'));
      tr.append(
        time,
        commit,
        status,
        el('td', { class: 'num' }, Q.formatValue(r.tests.passRate, '%')),
        el('td', { class: 'num' }, Q.formatValue(r.tests.flakyRate, '%')),
        el('td', { class: 'num' }, Q.formatValue(r.coverage.pct, '%')),
        el('td', { class: 'num' }, Q.formatValue(r.tests.durationSec, '초')),
        el('td', {}, r.failedTcs.length ? r.failedTcs.join(', ') : '-'),
      );
      body.append(tr);
    }
  }

  function renderLegend() {
    const box = $('legend-coverage');
    box.replaceChildren();
    for (const [name, color] of [['TC 실행됨', cssVar('--series-1')], ['TC 모두 통과', cssVar('--series-2')]]) {
      const item = el('span');
      const key = el('i');
      key.style.background = color;
      item.append(key, document.createTextNode(name));
      box.append(item);
    }
  }

  function render() {
    const runs = Q.selectRange(data.runs, range);
    for (const b of document.querySelectorAll('.range button')) b.setAttribute('aria-pressed', String(b.dataset.range === range));
    renderTiles(runs);
    const c1 = cssVar('--series-1');
    const c2 = cssVar('--series-2');
    const pass = Q.series(runs, (r) => r.tests.passRate);
    lineChart($('chart-pass'), runs, [{ name: '통과율', values: pass, color: c1 }], { domain: Q.percentDomain(pass), unit: '%', label: '통과율' });
    const flaky = Q.series(runs, (r) => r.tests.flakyRate);
    const fmax = Q.niceTicks(Math.max(5, ...flaky.filter((v) => v !== null)));
    lineChart($('chart-flaky'), runs, [{ name: 'flaky 비율', values: flaky, color: c1 }], { domain: [0, fmax[fmax.length - 1]], unit: '%', label: 'flaky 비율' });
    const cov = Q.series(runs, (r) => r.coverage.pct);
    const covPass = Q.series(runs, (r) => r.coverage.passingPct);
    renderLegend();
    lineChart($('chart-coverage'), runs, [{ name: 'TC 실행됨', values: cov, color: c1 }, { name: 'TC 모두 통과', values: covPass, color: c2 }], { domain: Q.percentDomain([...cov, ...covPass]), unit: '%', label: '요구사항 커버리지' });
    columnChart($('chart-duration'), runs, Q.series(runs, (r) => r.tests.durationSec), { unit: '초', label: '실행 시간', color: c1 });
    renderDefects(data.defects);
    renderTable(runs);
  }

  async function start() {
    try {
      range = localStorage.getItem(RANGE_KEY) || range;
    } catch {
      /* 저장소를 못 쓰면 기본값 */
    }
    try {
      const res = await fetch('data.json', { cache: 'no-cache' });
      data = await res.json();
    } catch {
      data = { repo: '', runs: [], defects: null };
    }
    if (data.repo) $('source').href = `https://github.com/${data.repo}/blob/metrics-data/history.jsonl`;
    if (data.generatedAt) $('updated').textContent = `페이지 갱신: ${Q.formatKst(data.generatedAt)} (KST)`;
    if (!data.runs.length) {
      $('empty').hidden = false;
      return;
    }
    $('content').hidden = false;
    for (const b of document.querySelectorAll('.range button')) {
      b.addEventListener('click', () => {
        range = b.dataset.range;
        try {
          localStorage.setItem(RANGE_KEY, range);
        } catch {
          /* 무시 */
        }
        render();
      });
    }
    render();
    let t;
    window.addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(render, 150);
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
  }

  start();
})();
