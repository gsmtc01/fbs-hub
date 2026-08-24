const MODEL_ID = 'onnx-community/gemma-4-E2B-it-ONNX';
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';
const STORAGE_KEY = 'fbs.gemma4e2b.installed';
const OUTPUT_RULES = [
  '출력은 한국어 Markdown으로만 작성한다.',
  '인용, 참고 문헌, 링크는 출력하지 않는다.',
  '표, 코드 블록, HTML, 불필요한 서론과 맺음말은 사용하지 않는다.',
].join(' ');
const SUMMARY_SYSTEM_PROMPT = [
  '당신은 상명대학교 학생을 위한 신뢰성 높은 공지 요약 도우미다.',
  '요약할 때는 제공된 제목, 날짜, 요약에 명시된 사실만 사용하고 누락된 학교별 사실을 추측하지 않는다.',
  '생성 결과에는 고정된 글자 수 제한이 없다. 학생에게 필요한 날짜, 대상, 조건과 행동을 충분히 설명하되 반복은 피한다.',
  '중요한 날짜와 행동은 **굵게** 표시하고, 의미에 맞는 이모지는 항목당 최대 1개만 사용한다.',
  '근거가 부족한 학교별 세부 사항은 원문 확인이 필요하다고 명시한다.',
  OUTPUT_RULES,
].join(' ');
const QUESTION_SYSTEM_PROMPT = [
  '당신은 상명대학교 학생을 돕는 질의응답 도우미다. 지금은 요약 모드가 아니라 질문 답변 모드다.',
  '현재 목록 자료에서 확인되는 내용을 우선 사용하되, 답변에 필요한 일반적이고 안정적인 상식은 모델이 알고 있는 범위에서 활용할 수 있다.',
  '학교의 최신 일정, 금액, 규정, 신청 자격처럼 변할 수 있는 정보는 현재 자료에 없으면 만들어 내지 말고 확인할 수 없다고 밝힌다.',
  '자료의 사실과 일반 안내를 함께 사용한다면 각각 "### 공지에서 확인한 내용"과 "### 일반 안내"로 구분한다.',
  '질문에 먼저 직접 답하고 질문을 반복하거나 현재 목록 전체를 다시 요약하지 않는다.',
  '일반 상식으로 답할 수 있는 질문에 단순히 자료에 없다고만 답하지 않는다.',
  OUTPUT_RULES,
].join(' ');
const SERVICE_PROMPTS = {
  notice: '일반 공지를 분석한다. 학생이 지금 확인해야 할 마감일, 대상, 신청 조건, 해야 할 행동을 우선한다. 기본 요약은 "### 핵심 공지" 제목과 중요도순 하이픈 목록 3개로 작성한다.',
  recruit: '채용과 홍보 공지를 분석한다. 모집 대상, 지원 마감, 지원 방법, 행사 일시를 우선한다. 기본 요약은 "### 채용·홍보 핵심" 제목과 기회별 하이픈 목록 3개로 작성한다.',
  calendar: '학사일정을 분석한다. 오늘 이후의 일정만 가까운 날짜순으로 다루고 지난 일정은 절대 포함하지 않는다. 기본 요약은 "### 다가오는 학사일정" 제목과 날짜순 하이픈 목록 3개로 작성한다.',
  meal: '주간 학식을 분석한다. "### 🍽️ 이번 주 학식"으로 시작하고, 각 요일은 "#### 월요일"처럼 별도 제목으로 구분한다. 요일 아래에는 실제 제공 메뉴를 음식 종류별 하이픈 목록으로 구조화한다. 모든 음식 종류 이름은 반드시 굵게 표시한다. 예시는 "- 🍚 **밥**: 잡곡밥", "- 🍲 **국/탕/찌개**: 나가사키짬뽕국", "- 🥘 **볶음/조림류**: 제육볶음", "- 🥢 **밑반찬**: 콩나물무침" 형식이다. 밥/덮밥/볶음밥은 🍚, 면은 🍜, 국/탕/찌개는 🍲, 볶음/조림류는 🥘, 밑반찬은 🥢, 소고기/돼지고기는 🍖, 닭고기는 🍗, 생선은 🐟, 달걀은 🍳, 샐러드/채소는 🥗, 파스타는 🍝, 튀김은 🍤, 빵/샌드위치는 🥪, 과일은 🍎, 디저트는 🍰, 매운 메뉴는 🌶️를 우선 사용한다. 한식과 푸드코트가 함께 있으면 요일 안에서 코너 제목을 추가한다. 없는 메뉴나 코너는 만들지 않는다.',
  webzine: '웹진 기사를 분석한다. 최근 기사에서 반복되는 주제와 핵심 소식을 간결하게 정리하며 신청 마감처럼 자료에 없는 행동을 만들지 않는다. 기본 요약은 "### 웹진 핵심 소식" 제목과 하이픈 목록 3개로 작성한다.',
};

let model = null;
let processor = null;
let loadingPromise = null;
let activeStoppingCriteria = null;
let generationInterrupted = false;

function modelCacheNeedles() {
  return [MODEL_ID, encodeURIComponent(MODEL_ID), MODEL_ID.replace('/', '%2F')];
}

export function getLocalAISupport(environment = {}) {
  const browserNavigator = globalThis.navigator || {};
  const secureContext = environment.secureContext ?? globalThis.isSecureContext ?? false;
  const hasGPU = environment.hasGPU ?? Boolean(browserNavigator.gpu);
  const hasCache = environment.hasCache ?? ('caches' in globalThis);
  const userAgent = environment.userAgent ?? browserNavigator.userAgent ?? '';
  const platform = environment.platform ?? browserNavigator.platform ?? '';
  const maxTouchPoints = environment.maxTouchPoints ?? browserNavigator.maxTouchPoints ?? 0;
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent)
    || (/MacIntel/i.test(platform) && maxTouchPoints > 1);
  const isSafari = /Safari\//i.test(userAgent)
    && !/(Chrome|Chromium|CriOS|Edg|EdgiOS|OPR|FxiOS)\//i.test(userAgent);
  const isChromium = /(Chrome|Chromium|CriOS|Edg|EdgiOS|OPR)\//i.test(userAgent);

  if (!secureContext) {
    return { supported: false, experimental: false, reason: 'WebGPU는 HTTPS 또는 localhost에서만 사용할 수 있습니다.' };
  }
  if (!hasGPU) {
    const reason = isIOS
      ? '이 iPhone 또는 iPad 브라우저에서 WebGPU를 감지하지 못했습니다. iOS 26 이상으로 업데이트하거나 데스크톱·Android의 최신 Chrome 또는 Edge를 이용해 주세요.'
      : isSafari
        ? '이 Safari에서 WebGPU를 감지하지 못했습니다. Safari 26 이상으로 업데이트하거나 최신 Chrome 또는 Edge를 이용해 주세요.'
        : '이 브라우저에서는 WebGPU를 사용할 수 없습니다. 최신 Chrome 또는 Edge를 권장합니다.';
    return { supported: false, experimental: false, reason };
  }
  if (!hasCache) {
    return { supported: false, experimental: false, reason: '이 브라우저에서는 모델 캐시를 사용할 수 없습니다.' };
  }
  if (isIOS || isSafari) {
    return {
      supported: true,
      experimental: true,
      reason: 'WebGPU와 브라우저 캐시를 감지했습니다. 다만 현재 ONNX Runtime Web 공식 지원표에서 Safari와 iOS의 WebGPU 실행은 지원 대상으로 확인되지 않아 실험적으로 제공합니다. 모델 초기화가 실패할 수 있습니다.',
    };
  }
  if (!isChromium) {
    return {
      supported: false,
      experimental: false,
      reason: '현재 On-Device AI는 WebGPU 백엔드가 검증된 최신 Chrome 또는 Edge에서 사용할 수 있습니다.',
    };
  }
  return { supported: true, experimental: false, reason: 'WebGPU와 브라우저 캐시를 사용할 수 있습니다.' };
}

export function friendlyAIError(error) {
  const message = error?.message || String(error || '');
  if (/no available backend|webgpuInit|webgpu.*backend|backend.*webgpu/i.test(message)) {
    return new Error('이 브라우저의 WebGPU AI 백엔드를 초기화할 수 없습니다. 최신 Chrome 또는 Edge에서 다시 시도해 주세요.');
  }
  return error instanceof Error ? error : new Error(message || 'AI 모델을 불러오지 못했습니다.');
}

export function normalizeAIOutput(value, section) {
  const text = String(value || '');
  if (section !== 'meal') return text;
  return text.replace(
    /^(\s*[-*•]\s*)(?:(\p{Extended_Pictographic}\uFE0F?)\s*)?(?:\*\*)?((?:국\s*[\/·]\s*탕\s*[\/·]\s*찌개)|(?:볶음\s*[\/·]\s*조림류)|밥|덮밥|볶음밥|면|국|탕|찌개|밑반찬|고기|소고기|돼지고기|닭고기|생선|달걀|샐러드|채소|파스타|튀김|빵|샌드위치|과일|디저트|매운 메뉴)(?:\*\*)?(\s*[:：])/gmu,
    (_match, prefix, existingEmoji, label, separator) => {
      const compact = label.replaceAll(' ', '');
      const emoji = existingEmoji || (
        /^볶음[\/·]조림류$/u.test(compact) ? '🥘' :
        compact === '밑반찬' ? '🥢' : ''
      );
      return `${prefix}${emoji ? `${emoji} ` : ''}**${label}**${separator}`;
    },
  );
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function progressTracker(onProgress) {
  const files = new Map();
  return (info = {}) => {
    if (info.file && Number.isFinite(info.total) && info.total > 0) {
      files.set(info.file, {
        loaded: info.status === 'done' ? info.total : (info.loaded || 0),
        total: info.total,
      });
    }
    let loaded = 0;
    let total = 0;
    for (const file of files.values()) {
      loaded += file.loaded;
      total += file.total;
    }
    const percent = total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0;
    const status = info.status === 'ready' ? '모델 구성 완료' :
      info.status === 'done' ? '파일 확인 중' :
      info.status === 'progress' ? '모델 파일 다운로드 중' : '모델 준비 중';
    onProgress?.({ percent, status, loaded, total, text: total ? `${humanBytes(loaded)} / ${humanBytes(total)}` : '' });
  };
}

export function buildAIRequest(items, section, question = '') {
  const evidence = items.slice(0, 12).map((item, index) => {
    const summary = (item.summary || '요약 없음').replace(/([가-힣])\*([가-힣])/g, '$1 / $2');
    return `${index + 1}. ${item.date} ${item.title}\n요약: ${summary}`;
  }).join('\n');
  const servicePrompt = SERVICE_PROMPTS[section] || SERVICE_PROMPTS.notice;
  const normalizedQuestion = question.trim();
  const answerMode = Boolean(normalizedQuestion);
  const systemPrompt = answerMode ? QUESTION_SYSTEM_PROMPT : `${SUMMARY_SYSTEM_PROMPT} ${servicePrompt}`;
  const userPrompt = answerMode
    ? `현재 화면의 공지 자료를 참고하고, 필요한 경우 일반적인 상식을 활용하여 마지막 질문에 정확히 답하라.\n\n현재 목록 자료:\n${evidence}\n\n사용자 질문:\n${normalizedQuestion}\n\n직접적인 답변:`
    : `다음 자료를 서비스별 기본 요약 형식으로 정리하라.\n\n자료:\n${evidence}`;
  return { systemPrompt, userPrompt, answerMode };
}

export const localAI = {
  modelId: MODEL_ID,
  supportStatus() {
    return getLocalAISupport();
  },
  isSupported() {
    return this.supportStatus().supported;
  },
  supportReason() {
    return this.supportStatus().reason;
  },
  isStored() {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  },
  async verifyStored() {
    if (!this.isStored() || this.isLoaded()) return this.isStored();
    if (!('caches' in window)) {
      localStorage.removeItem(STORAGE_KEY);
      return false;
    }
    const needles = modelCacheNeedles();
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();
      if (requests.some((request) => needles.some((needle) => request.url.includes(needle)))) return true;
    }
    localStorage.removeItem(STORAGE_KEY);
    return false;
  },
  async storageEstimate() {
    if (!navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota, available: Math.max(0, quota - usage) };
  },
  isLoaded() {
    return Boolean(model && processor);
  },
  async download(onProgress) {
    if (!this.isSupported()) throw new Error(this.supportReason());
    await this.load(onProgress);
    localStorage.setItem(STORAGE_KEY, 'true');
    onProgress?.({ percent: 100, status: '다운로드 완료', loaded: 0, total: 0, text: '브라우저 캐시에 저장됨' });
  },
  async load(onProgress) {
    if (model && processor) return;
    if (loadingPromise) return loadingPromise;
    if (!this.isSupported()) throw new Error(this.supportReason());

    loadingPromise = (async () => {
      const report = progressTracker(onProgress);
      onProgress?.({ percent: 0, status: 'AI 라이브러리 불러오는 중', loaded: 0, total: 0, text: '' });
      const { AutoProcessor, Gemma4ForConditionalGeneration } = await import(TRANSFORMERS_URL);
      processor = await AutoProcessor.from_pretrained(MODEL_ID, { progress_callback: report });
      model = await Gemma4ForConditionalGeneration.from_pretrained(MODEL_ID, {
        dtype: 'q4f16',
        device: 'webgpu',
        progress_callback: report,
      });
      localStorage.setItem(STORAGE_KEY, 'true');
    })();

    try {
      await loadingPromise;
    } catch (error) {
      model = null;
      processor = null;
      throw friendlyAIError(error);
    } finally {
      loadingPromise = null;
    }
  },
  async summarize(items, section, question = '', onChunk) {
    if (!items.length) throw new Error('요약할 항목이 없습니다.');
    await this.load();

    const { systemPrompt, userPrompt, answerMode } = buildAIRequest(items, section, question);
    const messages = [
      { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
      { role: 'user', content: [{ type: 'text', text: userPrompt }] },
    ];
    let prompt;
    try {
      prompt = processor.apply_chat_template(messages, {
        enable_thinking: false,
        add_generation_prompt: true,
      });
    } catch {
      prompt = processor.apply_chat_template([{
        role: 'user',
        content: [{ type: 'text', text: `시스템 지침:\n${systemPrompt}\n\n사용자 요청:\n${userPrompt}` }],
      }], {
        enable_thinking: false,
        add_generation_prompt: true,
      });
    }
    const inputs = processor.tokenizer(prompt, { add_special_tokens: false });
    const chunks = [];
    const { TextStreamer, InterruptableStoppingCriteria } = await import(TRANSFORMERS_URL);
    generationInterrupted = false;
    activeStoppingCriteria = new InterruptableStoppingCriteria();
    const streamer = new TextStreamer(processor.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text) => {
        if (!text) return;
        chunks.push(text);
        onChunk?.(normalizeAIOutput(chunks.join(''), section));
      },
    });
    try {
      await model.generate({
        ...inputs,
        max_new_tokens: answerMode ? 512 : 640,
        do_sample: false,
        repetition_penalty: 1.08,
        stopping_criteria: activeStoppingCriteria,
        streamer,
      });
    } finally {
      activeStoppingCriteria = null;
    }
    if (generationInterrupted) throw new DOMException('AI 생성을 중지했습니다.', 'AbortError');
    return normalizeAIOutput(chunks.join('').trim(), section);
  },
  stop() {
    if (!activeStoppingCriteria) return false;
    generationInterrupted = true;
    activeStoppingCriteria.interrupt();
    return true;
  },
  async remove() {
    model?.dispose?.();
    model = null;
    processor = null;
    loadingPromise = null;
    localStorage.removeItem(STORAGE_KEY);
    if (!('caches' in window)) return;
    const needles = modelCacheNeedles();
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        if (needles.some((needle) => request.url.includes(needle))) await cache.delete(request);
      }
    }
  },
};
