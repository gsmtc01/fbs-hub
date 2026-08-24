import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAIRequest, normalizeAIOutput } from '../local-llm.js';

const items = [{
  title: '장학금 신청 안내', date: '2026-08-23', summary: '신청 기간과 자격을 원문에서 확인하세요.',
}];

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
