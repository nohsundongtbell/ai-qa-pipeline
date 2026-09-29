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
const DEFAULT_MODELS = ['gemini-3.8-flash', 'gemini-flash-latest'];
const DEFAULT_BASE = 'https://generativelanguage.googleapis.com';

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
  maxRetries = 3,
  temperature = 0.2,
  maxOutputTokens = 4096,
  log = () => {},
}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY가 없습니다.');
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
            generationConfig: { responseMimeType: 'application/json', temperature, maxOutputTokens },
          }),
          signal: AbortSignal.timeout(90000),
        });
      } catch (e) {
        lastError = new Error(`Gemini 요청 실패(${model}): ${e.message}`);
        if (attempt < maxRetries) await sleep(1000 * 2 ** attempt);
        continue;
      }

      const bodyText = await res.text();

      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`Gemini ${res.status}(${model}): ${bodyText.slice(0, 200)}`);
        log(`${model}: ${res.status}, 재시도 ${attempt + 1}/${maxRetries}`);
        if (attempt < maxRetries) await sleep(2000 * 2 ** attempt);
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
      const text = cand && cand.content && (cand.content.parts || []).map((p) => p.text || '').join('');
      if (!text) throw new Error(`Gemini 응답이 비어 있습니다(${model}, finishReason=${cand ? cand.finishReason : '없음'}).`);
      if (cand.finishReason === 'MAX_TOKENS') {
        throw new Error(`Gemini 응답이 길이 제한으로 잘렸습니다(${model}). 입력을 줄이거나 maxOutputTokens를 늘리세요.`);
      }
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
