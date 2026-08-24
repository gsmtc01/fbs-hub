function mealParts(item = {}) {
  if (Array.isArray(item.menu) && item.menu.length) return item.menu.map(String);
  return String(item.summary || '').split(/\s+\/\s+/u).filter(Boolean);
}

export function mealMenuText(item = {}) {
  const parts = mealParts(item);
  if (item.meal !== '조식') return parts.join(' / ');

  return parts
    .filter((part) => !/^\s*[12]\.\s*\d{1,2}:\d{2}/u.test(part))
    .map((part) => part
      .replace(/^\s*[12]\.\s*/u, '')
      .replace(/^(간편식|식사류)\s*:\s*/u, '$1: '))
    .join(' / ');
}
