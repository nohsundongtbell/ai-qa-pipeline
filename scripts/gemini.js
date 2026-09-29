/**
 * Gemini API 클라이언트 (외부 패키지 없음, fetch만 사용)
 *
 * - 응답을 JSON으로 받는다 (responseMimeType: application/json)
 * - 키는 URL이 아니라 x-goog-api-key 헤더로 보낸다 (로그나 URL에 키가 남지 않도록)
 * - 429(한도 초과)와 5xx는 지수 백오프로 재시도하고, 모델이 없으면 다음 후보 모델로 넘어간다
 *
 * 환경변수: GEMINI_API_KEY (필수), GEMINI_MODEL (쉼표로 후보 여러 개 가능), GEMINI_BASE_URL (테스트용)
 * 주의: 무료 등급은 호출 횟수 제한이 있고, 보낸 내용이 서비스 개선에 쓰일 수 있다. 민감한 코드나 데이터는 보내지 않는다.
 */
// 모델은 자주 폐기된다 (2.5-flash, 2.0-flash는 이미 종료됨). 그래서 404 응답이 안내하는 새 모델을 자동으로 이어서 시도한다.
// 무료 등급의 한도는 모델마다 따로 잡힌다 (AI Studio 사용량 화면 기준: 3.8 Flash는 하루 20회, Flash Lite 계열은 하루 500회).
// 그래서 품질이 좋은 모델을 먼저 쓰고, 일일 한도에 걸리면 Lite 모델로 넘어간다. 없는 이름은 404로 건너뛴다.
// 모델 ID는 화면의 모델 이름(예: "Gemini 3.5 Flash Lite")을 소문자와 하이픈으로 바꾼 추정값이다.
const DEFAULT_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];
const DEFAULT_BASE = 'https://generativelanguage.googleapis.com';
const MAX_TOKENS_CAP = 32768;
const MAX_RETRIES_429 = 2;

/** 429 응답에서 재시도 대기 시간(retryDelay)과 일일 한도 여부를 읽는다 */
function quotaInfo(bodyText) {
  let delayMs = null;
  let daily = /PerDay/i.test(bodyText);
  try {
    const details = (JSON.parse(bodyText).error || {}).details || [];
    for (const d of details) {
      if (d.retryDelay) delayMs = parseFloat(d.retryDelay) * 1000; // "34s" 또는 "34.5s"
      for (const v of d.violations || []) if (/PerDay/i.test(v.quotaId || '')) daily = true;
    }
  } catch {
    /* JSON이 아니면 본문 문자열만 본다 */
  }
  return { delayMs: Number.isFinite(delayMs) ? delayMs : null, daily };
}

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

/** ```json ... ``` 코드 펜스를 벗기고 JSON으로 파싱한다 */
function parseJsonText(text) {
  const t = String(text || '').trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1] : t);
}

function modelsFromEnv(env = process.env) {
  const list = (env.GEMINI_MODEL || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_MODELS;
}

/**
 * @param parts  [{ text } | { inlineData: { mimeType, data(base64) } }]
 * @returns { json, model, usage, raw }
 */
async function generateJson({
  apiKey,
  models = DEFAULT_MODELS,
  system,
  parts,
  baseUrl = DEFAULT_BASE,
  fetchImpl = fetch,
  sleep = sleepReal,
  maxRetries = 5, // 무료 등급의 503(과부하), 429는 수십 초 안에 풀리는 경우가 많아 대기를 길게 가져간다 (모델당 최대 약 75초)
  temperature = 0.2,
  maxOutputTokens = 16384, // 최근 모델은 답변 전에 "생각"하는 데도 이 한도를 쓰므로 넉넉히 잡는다
  log = () => {},
}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY가 없습니다.');
  let tokens = maxOutputTokens;
  let lastError = null;
  const queue = [...models];
  const tried = new Set();

  while (queue.length) {
    const model = queue.shift();
    if (tried.has(model)) continue;
    tried.add(model);
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let res;
      try {
        res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            systemInstruction: system ? { parts: [{ text: system }] } : undefined,
            contents: [{ role: 'user', parts }],
            generationConfig: { responseMimeType: 'application/json', temperature, maxOutputTokens: tokens },
          }),
          signal: AbortSignal.timeout(90000),
        });
      } catch (e) {
        lastError = new Error(`Gemini 요청 실패(${model}): ${e.message}`);
        if (attempt < maxRetries) await sleep(1000 * 2 ** attempt);
        continue;
      }

      const bodyText = await res.text();

      // 429(한도 초과): 재시도 자체가 한도를 더 소모하므로 신중하게 다룬다.
      //  - 일일 한도(PerDay)면 재시도해도 소용없으니 이 모델은 바로 포기하고 다음 모델로 (한도는 모델마다 따로일 수 있다)
      //  - 응답이 알려 준 재시도 대기 시간(retryDelay)이 있으면 그만큼만 기다리고, 최대 2번만 다시 시도한다
      if (res.status === 429) {
        const { delayMs, daily } = quotaInfo(bodyText);
        lastError = new Error(`Gemini 429 무료 한도 초과(${model})${daily ? ' - 일일 한도' : ''}: ${bodyText.replace(/\s+/g, ' ').slice(0, 220)}`);
        if (daily) {
          log(`${model}: 일일 한도를 초과해 재시도하지 않고 다음 모델로 넘어갑니다.`);
          break;
        }
        if (attempt >= Math.min(maxRetries, MAX_RETRIES_429)) break;
        const wait = delayMs != null ? Math.min(delayMs + 1000, 65000) : Math.min(5000 * 2 ** attempt, 30000);
        log(`${model}: 429, ${Math.round(wait / 1000)}초 뒤 재시도 ${attempt + 1}/${MAX_RETRIES_429}`);
        await sleep(wait);
        continue;
      }
      if (res.status >= 500) {
        lastError = new Error(`Gemini ${res.status}(${model}): ${bodyText.slice(0, 200)}`);
        log(`${model}: ${res.status}, 재시도 ${attempt + 1}/${maxRetries}`);
        if (attempt < maxRetries) await sleep(Math.min(3000 * 2 ** attempt, 30000)); // 3, 6, 12, 24, 30초
        continue;
      }
      if (res.status === 404 || (res.status === 400 && /model/i.test(bodyText) && /not (found|supported)|invalid/i.test(bodyText))) {
        lastError = new Error(`Gemini 모델을 사용할 수 없습니다(${model}): ${bodyText.slice(0, 200)}`);
        // 폐기된 모델이면 응답이 "use models/<새 모델>"로 대체 모델을 알려 준다. 그 모델을 가장 먼저 시도한다.
        const suggested = bodyText.match(/use models\/([A-Za-z0-9._-]+)/);
        if (suggested && !tried.has(suggested[1])) {
          queue.unshift(suggested[1]);
          log(`${model}: 사용할 수 없어 안내된 ${suggested[1]} 모델을 시도합니다.`);
        } else {
          log(`${model}: 사용할 수 없어 다음 모델을 시도합니다.`);
        }
        break; // 다음 모델로
      }
      if (!res.ok) {
        // 401/403(키 오류) 등은 재시도해도 소용없으므로 바로 알린다
        throw new Error(`Gemini ${res.status}(${model}): ${bodyText.slice(0, 300)}`);
      }

      let data;
      try {
        data = JSON.parse(bodyText);
      } catch {
        throw new Error(`Gemini 응답을 해석하지 못했습니다(${model}).`);
      }
      if (data.promptFeedback && data.promptFeedback.blockReason) {
        throw new Error(`Gemini가 요청을 차단했습니다: ${data.promptFeedback.blockReason}`);
      }
      const cand = (data.candidates || [])[0];
      // 길이 제한에 걸리면(생각에 토큰을 다 쓰면 답변이 비거나 잘린다) 한도를 2배로 늘려 다시 요청한다. 상한을 넘으면 포기한다.
      if (cand && cand.finishReason === 'MAX_TOKENS') {
        const u = data.usageMetadata || {};
        if (tokens < MAX_TOKENS_CAP) {
          tokens = Math.min(tokens * 2, MAX_TOKENS_CAP);
          log(`${model}: 출력 길이 제한(생각 토큰 ${u.thoughtsTokenCount ?? '?'})에 걸려 한도를 ${tokens}으로 늘려 다시 요청합니다.`);
          attempt--; // 재시도 횟수를 쓰지 않는다 (한도는 유한하게 늘어난다)
          continue;
        }
        throw new Error(`Gemini 응답이 길이 제한으로 잘렸습니다(${model}, 한도 ${tokens}, 생각 토큰 ${u.thoughtsTokenCount ?? '?'}). 입력을 줄이세요.`);
      }
      const text = cand && cand.content && (cand.content.parts || []).map((p) => p.text || '').join('');
      if (!text) throw new Error(`Gemini 응답이 비어 있습니다(${model}, finishReason=${cand ? cand.finishReason : '없음'}).`);
      try {
        return { json: parseJsonText(text), model, usage: data.usageMetadata || null, raw: text };
      } catch {
        throw new Error(`Gemini가 JSON이 아닌 응답을 보냈습니다(${model}): ${text.slice(0, 120)}`);
      }
    }
  }
  throw lastError || new Error('Gemini 호출에 실패했습니다.');
}

module.exports = { DEFAULT_MODELS, generateJson, parseJsonText, modelsFromEnv };
