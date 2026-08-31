import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAIRequest,
  extractQueryTerms,
  friendlyAIError,
  getGenerationConfig,
  getLocalAISupport,
  normalizeAIOutput,
  prepareAIEvidence,
} from '../local-llm.js';
import { mealMenuText } from '../meal-display.js';
import { composeSharePayload, shareExternally } from '../share-utils.js';

const items = [{
  title: '장학금 신청 안내', date: '2026-08-23', summary: '신청 기간과 자격을 원문에서 확인하세요.',
}];

for (const sample of [
  {
    section: '공지사항',
    url: 'https://www.smu.ac.kr/kor/life/notice.do?mode=view&articleNo=768083',
  },
  {
    section: '채용·홍보',
    url: 'https://www.smu.ac.kr/fbs/community/intellirecruit.do?mode=view&articleNo=766684',
  },
  {
    section: '웹진',
    url: 'https://www.smu.ac.kr/kor/life/sm-today.do?mode=view&articleNo=123456',
  },
]) {
  test(`${sample.section} 공유 URL은 본문 뒤의 독립된 마지막 줄로 전달한다`, () => {
    const text = `[${sample.section}] 테스트 제목\n2026.08.28`;
    const payload = composeSharePayload({ title: '핀빅스 허브', text, url: sample.url });
    assert.deepEqual(payload.shareData, {
      title: '핀빅스 허브',
      text: `${text}\n\n${sample.url}`,
    });
    assert.equal(payload.clipboardText, payload.shareData.text);
    assert.equal('url' in payload.shareData, false);
    assert.equal(payload.shareData.text.split('\n').at(-1), sample.url);
  });
}

for (const section of ['학사일정', '학식']) {
  test(`${section} 공유는 URL 없이 해당 텍스트만 전달한다`, () => {
    const text = `[${section}] 테스트 내용`;
    const payload = composeSharePayload({ title: '핀빅스 허브', text });
    assert.deepEqual(payload.shareData, { title: '핀빅스 허브', text });
    assert.equal(payload.clipboardText, text);
    assert.equal('url' in payload.shareData, false);
  });
}

test('공유 URL에 뒤따르는 제목 문자열이 주소로 결합되지 않는다', () => {
  const url = 'https://www.smu.ac.kr/kor/life/notice.do?mode=view&articleNo=768083';
  const payload = composeSharePayload({
    title: '핀빅스 허브',
    text: '[공지사항] [학생복지팀] 장학금 신청 안내',
    url,
  });
  const sharedUrl = payload.shareData.text.split('\n').at(-1);
  assert.equal(sharedUrl, url);
  assert.equal(new URL(sharedUrl).searchParams.get('articleNo'), '768083');
  assert.doesNotMatch(sharedUrl, /%20|\[공지사항]/);
});

test('시스템 공유 창을 취소하면 오류 토스트를 표시하지 않는다', async () => {
  const messages = [];
  await shareExternally(
    {
      title: '핀빅스 허브',
      text: '[공지사항] 테스트 제목',
      failedMessage: '항목을 공유하지 못했습니다.',
    },
    {
      navigatorApi: {
        share: async () => { throw new DOMException('사용자가 공유를 취소했습니다.', 'AbortError'); },
      },
      notify: (message) => messages.push(message),
    },
  );
  assert.deepEqual(messages, []);
});

test('시스템 공유 실패에는 오류 토스트를 표시한다', async () => {
  const messages = [];
  await shareExternally(
    {
      title: '핀빅스 허브',
      text: '[공지사항] 테스트 제목',
      failedMessage: '항목을 공유하지 못했습니다.',
    },
    {
      navigatorApi: {
        share: async () => { throw new Error('공유 서비스 오류'); },
      },
      notify: (message) => messages.push(message),
    },
  );
  assert.deepEqual(messages, ['항목을 공유하지 못했습니다.']);
});

test('질문 모드는 일반 상식과 공지 근거를 구분하도록 요청한다', () => {
  const request = buildAIRequest(items, 'notice', '장학금은 일반적으로 어떻게 신청해?');
  assert.equal(request.answerMode, true);
  assert.match(request.systemPrompt, /일반적이고 안정적인 상식/);
  assert.match(request.systemPrompt, /최신 일정.*만들어 내지/);
});

test('기본 요약에는 고정된 150자 출력 제한을 두지 않는다', () => {
  const request = buildAIRequest(items, 'notice');
  assert.equal(request.answerMode, false);
  assert.match(request.systemPrompt, /고정된 글자 수 제한이 없다/);
});

test('기본 요약 근거는 출처를 교차해 최대 12건을 선별한다', () => {
  const samples = ['univ', 'coneng', 'fbs'].flatMap((board) => Array.from({ length: 5 }, (_, index) => ({
    id: `${board}:${index}`,
    board,
    boardLabel: board,
    title: `${board} 공지 ${index}`,
    date: `2026-08-${String(20 - index).padStart(2, '0')}`,
    summary: index === 0 ? `${board} 발췌` : '',
  })));
  const evidence = prepareAIEvidence(samples, 'notice');
  assert.equal(evidence.stats.selectedCount, 12);
  assert.deepEqual(evidence.items.slice(0, 6).map((item) => item.board), [
    'univ', 'coneng', 'fbs', 'univ', 'coneng', 'fbs',
  ]);
  assert.equal(evidence.stats.sourceCount, 3);
});

test('질문의 조사와 어미를 제거하고 관련 공지만 선별한다', () => {
  const samples = [
    { id: '1', board: 'univ', title: '국가장학금 2차 신청 안내', date: '2026-08-20', summary: '' },
    { id: '2', board: 'fbs', title: '수강신청 변경 안내', date: '2026-08-19', summary: '' },
    { id: '3', board: 'coneng', title: '장학금 신청 대상 안내', date: '2026-08-18', summary: '재학생 대상' },
  ];
  assert.deepEqual(extractQueryTerms('장학금은 일반적으로 어떻게 신청해?'), ['장학금', '신청']);
  const evidence = prepareAIEvidence(samples, 'notice', '장학금은 일반적으로 어떻게 신청해?');
  assert.deepEqual(evidence.items.map((item) => item.id), ['3', '1']);
  assert.equal(evidence.stats.excerptCount, 1);
  assert.equal(evidence.stats.titleOnlyCount, 1);
});

test('관련 공지가 없으면 무관한 목록을 질문 근거로 넣지 않는다', () => {
  const evidence = prepareAIEvidence(items, 'notice', '기숙사 세탁실 운영시간은?');
  assert.equal(evidence.stats.selectedCount, 0);
  assert.match(evidence.text, /직접 일치하는 목록 자료 없음/);
});

test('근거에는 출처와 부서 및 자료 등급을 포함하고 게시일을 마감일로 해석하지 않는다', () => {
  const request = buildAIRequest([{
    id: '1', board: 'univ', boardLabel: '상명대학교 공지사항', writer: '학생복지팀',
    title: '장학금 안내', date: '2026-08-23', summary: '',
  }], 'notice');
  assert.match(request.userPrompt, /자료 등급: 제목 중심/);
  assert.match(request.userPrompt, /출처: 상명대학교 공지사항/);
  assert.match(request.userPrompt, /작성 부서: 학생복지팀/);
  assert.match(request.systemPrompt, /날짜 필드는 게시일/);
  assert.match(request.systemPrompt, /마감일이나 행사일로/);
});

test('사실 중심 생성은 샘플링과 temperature를 사용하지 않는다', () => {
  const config = getGenerationConfig(false, 'notice');
  assert.equal(config.do_sample, false);
  assert.equal('temperature' in config, false);
  assert.equal(config.max_new_tokens, 480);
  assert.equal(getGenerationConfig(true, 'notice').max_new_tokens, 384);
});

test('학식의 국·탕·찌개 분류를 굵게 보정한다', () => {
  const output = normalizeAIOutput('- 🍲 국/탕/찌개: 순두부찌개', 'meal');
  assert.equal(output, '- 🍲 **국/탕/찌개**: 순두부찌개');
});

test('학식의 볶음·조림류에 이모지와 굵은 서식을 보정한다', () => {
  const output = normalizeAIOutput('- 볶음/조림류: 제육볶음', 'meal');
  assert.equal(output, '- 🥘 **볶음/조림류**: 제육볶음');
});

test('학식의 밑반찬에 이모지와 굵은 서식을 보정한다', () => {
  const output = normalizeAIOutput('- **밑반찬**: 콩나물무침', 'meal');
  assert.equal(output, '- 🥢 **밑반찬**: 콩나물무침');
});

test('학식 분류에 이미 있는 이모지는 중복하지 않는다', () => {
  const output = normalizeAIOutput('- 🥘 볶음·조림류: 두부조림', 'meal');
  assert.equal(output, '- 🥘 **볶음·조림류**: 두부조림');
});

test('조식 표시에서 번호와 반복 시간 항목을 제거한다', () => {
  const output = mealMenuText({
    meal: '조식',
    menu: [
      '1.간편식:떡국컵+반숙란+음료',
      '2.식사류:바지락순두부찌개+3찬+초코우유',
      '1.8:30~소진 시 까지',
      '2.9:30~소진 시 까지',
    ],
  });
  assert.equal(output, '간편식: 떡국컵+반숙란+음료 / 식사류: 바지락순두부찌개+3찬+초코우유');
});

test('조식의 운영 안내는 그대로 보존한다', () => {
  assert.equal(mealMenuText({ meal: '조식', menu: ['운영없음'] }), '운영없음');
  assert.equal(mealMenuText({ meal: '조식', menu: ['2026 지방선거'] }), '2026 지방선거');
});

test('중식 메뉴 표시는 변경하지 않는다', () => {
  assert.equal(mealMenuText({ meal: '중식', menu: ['잡곡밥', '된장찌개'] }), '잡곡밥 / 된장찌개');
});

test('iOS 26에서 WebGPU와 캐시가 감지되면 실험적 지원으로 판정한다', () => {
  const support = getLocalAISupport({
    secureContext: true,
    hasGPU: true,
    hasCache: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    maxTouchPoints: 5,
  });
  assert.equal(support.supported, true);
  assert.equal(support.experimental, true);
  assert.match(support.reason, /실험적으로/);
});

test('Chrome iOS도 WebGPU가 감지되면 실험적 지원으로 판정한다', () => {
  const support = getLocalAISupport({
    secureContext: true,
    hasGPU: true,
    hasCache: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    maxTouchPoints: 5,
  });
  assert.equal(support.supported, true);
  assert.equal(support.experimental, true);
});

test('iOS에서 WebGPU가 감지되지 않으면 사용할 수 없다고 판정한다', () => {
  const support = getLocalAISupport({
    secureContext: true,
    hasGPU: false,
    hasCache: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    maxTouchPoints: 5,
  });
  assert.equal(support.supported, false);
  assert.match(support.reason, /iOS 26/);
});

test('macOS Chrome의 WebGPU와 캐시는 지원 대상으로 판정한다', () => {
  const support = getLocalAISupport({
    secureContext: true,
    hasGPU: true,
    hasCache: true,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    maxTouchPoints: 0,
  });
  assert.equal(support.supported, true);
  assert.equal(support.experimental, false);
});

test('WebGPU 백엔드 초기화 오류를 이용자 안내 문구로 변환한다', () => {
  const error = friendlyAIError(new TypeError('no available backend found: webgpuInit is not a function'));
  assert.match(error.message, /WebGPU AI 백엔드/);
  assert.doesNotMatch(error.message, /webgpuInit/);
});
