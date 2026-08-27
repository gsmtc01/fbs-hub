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
