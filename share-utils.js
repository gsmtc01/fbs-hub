function safeShareUrl(value = '') {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

export function composeSharePayload({ title = '', text = '', url = '' } = {}) {
  const cleanText = String(text).trim();
  const cleanUrl = safeShareUrl(url);
  const body = [cleanText, cleanUrl].filter(Boolean).join('\n\n');
  return {
    shareData: {
      title: String(title).trim(),
      text: body,
    },
    clipboardText: body,
  };
}

export async function shareExternally(
  { title, text, url = '', copiedMessage, failedMessage },
  { navigatorApi = globalThis.navigator, notify = () => {} } = {},
) {
  const payload = composeSharePayload({ title, text, url });
  try {
    if (navigatorApi?.share) {
      await navigatorApi.share(payload.shareData);
    } else if (navigatorApi?.clipboard) {
      await navigatorApi.clipboard.writeText(payload.clipboardText);
      notify(copiedMessage);
    } else {
      notify('이 브라우저에서는 외부 공유를 지원하지 않습니다.');
    }
  } catch (error) {
    if (error?.name !== 'AbortError') notify(failedMessage);
  }
}
