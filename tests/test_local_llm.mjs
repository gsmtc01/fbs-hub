import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAIRequest,
  friendlyAIError,
  getLocalAISupport,
  normalizeAIOutput,
} from '../local-llm.js';
import { mealMenuText } from '../meal-display.js';
import { composeSharePayload } from '../share-utils.js';

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
