import { localAI } from './local-llm.js?v=20260825-9';
import { mealMenuText } from './meal-display.js?v=20260825-1';

const CONFIG = {
  dataUrl: './data/notices.json',
  repositoryUrl: '',
};

const SECTIONS = [
  { id: 'notice', desktop: '공지사항' },
  { id: 'recruit', desktop: '채용·홍보' },
  { id: 'calendar', desktop: '학사일정' },
  { id: 'meal', desktop: '학식' },
  { id: 'webzine', desktop: '웹진' },
  { id: 'directory', desktop: '연락처 검색' },
];
const SOURCE_LABELS = { all: '전체', univ: '상명대학교', coneng: '융합공과대학', fbs: '핀빅스' };
const ZINE_LABELS = { all: '전체', today: '상명투데이', newsletter: '뉴스레터', people: '상명피플', focus: '언론 속 상명' };
const RANGE_LABELS = { 7: '7일', 30: '30일', semester: '이번 학기', all: '전체' };
const DEFAULT_PERSONALIZATION = {
  sources: ['fbs'],
  majorKeywords: ['핀테크', '빅데이터', '스마트생산'],
  customKeywords: [],
  importantKeywords: ['장학', '채용', '수강신청'],
};
const PERSONAL_VIEWS = { all: '모두', interest: '관심', favorite: '즐겨찾기', new: '새 공지' };
const PERSONALIZABLE_BOARDS = new Set(['univ', 'coneng', 'fbs', 'recruit', 'today', 'newsletter', 'people', 'focus']);
const INITIAL_SECTION = location.hash.slice(1) && SECTIONS.some((x) => x.id === location.hash.slice(1)) ? location.hash.slice(1) : 'notice';
const aiIcon = (ready = false) => `<svg class="ai-main-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="4"></rect><path d="M9 10h.01M15 10h.01${ready ? 'M8.5 14c1.8 1.5 5.2 1.5 7 0' : 'M9 14h6'}M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"></path></svg>`;
const SPEAKER_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6.8 8.5H3.5v7h3.3L11 19V5Z"></path><path d="M15.2 9.1a4.2 4.2 0 0 1 0 5.8M17.8 6.5a7.8 7.8 0 0 1 0 11"></path></svg>`;
const STOP_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"></rect></svg>`;
const SHARE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"></circle><circle cx="6" cy="12" r="2.5"></circle><circle cx="18" cy="19" r="2.5"></circle><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"></path></svg>`;
const SEND_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 16 8-16 8 3-8-3-8Z"></path><path d="M7 12h13"></path></svg>`;
const STAR_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"></path></svg>`;
const NAV_ICONS = {
  notice: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4"></path></svg>',
  recruit: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"></rect><path d="M9 7V4h6v3M3 12h18M10 12v2h4v-2"></path></svg>',
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M8 3v4M16 3v4M3 10h18M8 14h2M14 14h2M8 18h2"></path></svg>',
  meal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11h16a8 8 0 0 1-16 0ZM7 7c0-1 1-1.5 1-2.5M12 7c0-1 1-1.5 1-2.5M17 7c0-1 1-1.5 1-2.5M3 21h18"></path></svg>',
  webzine: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM8 9h8M8 13h8M8 17h5"></path></svg>',
  directory: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"></rect><path d="M8 3v18M11 8h5M11 12h5M11 16h3"></path></svg>',
};

function cleanKeywordList(values, limit = 12) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value).trim()).filter((value) => value && value.length <= 30))].slice(0, limit);
}
function loadStoredArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  } catch { return []; }
}
function loadPersonalization() {
  try {
    const value = JSON.parse(localStorage.getItem('fbs.personalization') || 'null');
    if (!value || typeof value !== 'object') return structuredClone(DEFAULT_PERSONALIZATION);
    return {
      sources: cleanKeywordList(value.sources, 5),
      majorKeywords: cleanKeywordList(value.majorKeywords, 3),
      customKeywords: cleanKeywordList(value.customKeywords),
      importantKeywords: cleanKeywordList(value.importantKeywords, 8),
    };
  } catch { return structuredClone(DEFAULT_PERSONALIZATION); }
}

const state = {
  data: null,
  section: INITIAL_SECTION,
  query: '', source: 'all', zineSource: 'all', range: 'all', visible: 10,
  pageSize: Number(localStorage.getItem('fbs.pageSize')) || 10,
  hidePinned: localStorage.getItem('fbs.hidePinned') === 'true',
  personalView: 'all',
  personalization: loadPersonalization(),
  favorites: new Set(loadStoredArray('fbs.favorites')),
  readItems: new Set(loadStoredArray('fbs.readItems')),
  mobileAIExpanded: localStorage.getItem('fbs.mobileAIExpanded') === 'true',
  aiText: '', aiBusy: false, aiStopping: false, aiError: '', aiSpeaking: false, aiQuestion: '', aiDraft: '', aiRequestId: 0, showPastCalendar: false,
  mealWeek: '',
};

let aiStreamFrame = 0;
let aiPendingText = '';

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const els = {
  desktopNav: $('.desktop-nav'), mobileNav: $('.mobile-nav-list'), mobileDrawer: $('#mobileNav'), mobileBackdrop: $('#mobileNavBackdrop'),
  mobileMenuButton: $('#mobileMenuButton'), title: $('#sectionTitle'), mobileTitle: $('#mobileTitle'),
  filters: $('#filters'), list: $('#noticeList'), more: $('#moreButton'),
  input: $('#searchInput'), mobileInput: $('#mobileSearchInput'), ai: $('#aiContent'), aiCard: $('#aiCard'), sideRail: $('.side-rail'),
  aiToggle: $('#mobileAIToggle'), upcoming: $('#upcomingList'), today: $('#todayLabel'), dialog: $('#settingsDialog'), infoDialog: $('#onDeviceDialog'), toast: $('#toast'),
};

function escapeHTML(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function safeUrl(value = '') {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
function seoulDate(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function shiftISODate(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function isoDayNumber(iso) { return Date.parse(`${iso}T00:00:00Z`) / 86400000; }
function mealDayDate(day = '', reference = seoulDate()) {
  const match = String(day).match(/\((\d{1,2})\.(\d{1,2})\)/);
  if (!match) return '';
  const [, month, date] = match;
  const referenceMs = Date.parse(`${reference}T00:00:00Z`);
  const year = Number(reference.slice(0, 4));
  return [year - 1, year, year + 1]
    .map((candidate) => `${candidate}-${month.padStart(2, '0')}-${date.padStart(2, '0')}`)
    .filter((candidate) => !Number.isNaN(Date.parse(`${candidate}T00:00:00Z`)))
    .sort((a, b) => Math.abs(Date.parse(`${a}T00:00:00Z`) - referenceMs) - Math.abs(Date.parse(`${b}T00:00:00Z`) - referenceMs))[0] || '';
}
function mondayOfWeek(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return shiftISODate(iso, -(weekday === 0 ? 6 : weekday - 1));
}
function formatDate(iso = '') { return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.replaceAll('-', '.') : iso; }
function formatViews(value) { return new Intl.NumberFormat('ko-KR').format(Number(value) || 0); }
function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / (1024 ** index)).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}
function currentSection() { return SECTIONS.find((x) => x.id === state.section); }
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2800);
}
function itemKey(item) { return String(item.id || `${item.board}:${item.url || item.title}`); }
function itemText(item) { return `${item.title || ''} ${item.summary || ''}`.toLocaleLowerCase('ko'); }
function interestKeywords() { return [...state.personalization.majorKeywords, ...state.personalization.customKeywords]; }
function sourceIsInteresting(item) {
  const sources = state.personalization.sources;
  return sources.includes(item.board) || (sources.includes('webzine') && ['today', 'newsletter', 'people', 'focus'].includes(item.board));
}
function isInterested(item) {
  if (!PERSONALIZABLE_BOARDS.has(item.board)) return false;
  const text = itemText(item);
  return sourceIsInteresting(item) || interestKeywords().some((keyword) => text.includes(keyword.toLocaleLowerCase('ko')));
}
function isNewItem(item) {
  if (!PERSONALIZABLE_BOARDS.has(item.board) || state.readItems.has(itemKey(item))) return false;
  return item.date >= shiftISODate(seoulDate(), -7);
}
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function highlight(value, item = null) {
  const terms = [];
  if (state.query.trim()) terms.push({ value: state.query.trim(), className: 'search-mark' });
  if (item) {
    state.personalization.importantKeywords.forEach((keyword) => terms.push({ value: keyword, className: 'important-mark' }));
    interestKeywords().forEach((keyword) => terms.push({ value: keyword, className: 'interest-mark' }));
  }
  const unique = [...new Map(terms.filter((term) => term.value).map((term) => [term.value.toLocaleLowerCase('ko'), term])).values()]
    .sort((a, b) => b.value.length - a.value.length);
  if (!unique.length) return escapeHTML(value);
  const regex = new RegExp(`(${unique.map((term) => escapeRegExp(term.value)).join('|')})`, 'gi');
  return String(value).split(regex).map((part) => {
    const term = unique.find((candidate) => candidate.value.toLocaleLowerCase('ko') === part.toLocaleLowerCase('ko'));
    return term ? `<mark class="${term.className}">${escapeHTML(part)}</mark>` : escapeHTML(part);
  }).join('');
}
function markdownInline(value = '') {
  return escapeHTML(String(value).replace(/([가-힣])\*([가-힣])/g, '$1 / $2'))
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*+|__|`/g, '');
}
function renderMarkdown(value = '') {
  const lines = String(value).replaceAll('\r', '').split('\n');
  const html = [];
  let list = '';
  const closeList = () => {
    if (!list) return;
    html.push(`</${list}>`);
    list = '';
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    const heading = line.match(/^(#{1,4})\s*(.+)$/);
    const bullet = line.match(/^[-*•]\s*(.+)$/);
    const ordered = line.match(/^\d+[.)]\s*(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(4, heading[1].length + 2);
      html.push(`<h${level}>${markdownInline(heading[2].replace(/\s+#+$/, ''))}</h${level}>`);
    } else if (bullet || ordered) {
      const nextList = bullet ? 'ul' : 'ol';
      if (list !== nextList) { closeList(); list = nextList; html.push(`<${list}>`); }
      html.push(`<li>${markdownInline((bullet || ordered)[1])}</li>`);
    } else {
      closeList();
      html.push(`<p>${markdownInline(line)}</p>`);
    }
  }
  closeList();
  return html.join('');
}
function renderStreamingMarkdown(value = '') {
  const sanitized = String(value)
    .replace(/\*\*([^*\n]*)$/g, '$1')
    .replace(/__([^_\n]*)$/g, '$1')
    .replace(/`([^`\n]*)$/g, '$1')
    .replace(/^\s*#{1,4}\s*$/gm, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*$/gm, '');
  const html = renderMarkdown(sanitized);
  const cursor = '<span class="ai-cursor" aria-hidden="true"></span>';
  if (!html) return `<p>${cursor}</p>`;
  const closingTags = ['</p>', '</li>', '</h3>', '</h4>'];
  const position = Math.max(...closingTags.map((tag) => html.lastIndexOf(tag)));
  return position >= 0 ? `${html.slice(0, position)}${cursor}${html.slice(position)}` : `${html}${cursor}`;
}
function markdownToSpeech(value = '') {
  return String(value)
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/^\s*(?:[-•]|\d+[.)])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function inferCategory(item) {
  const match = item.title.match(/^\[([^\]]{1,15})\]/);
  return match ? match[1] : item.board === 'recruit' ? '홍보' : '';
}
function sourceClass(board) { return board === 'univ' ? 'univ' : board === 'coneng' ? 'coneng' : board === 'fbs' ? 'fbs' : ''; }
function sourceShort(board) { return board === 'univ' ? '상명대' : board === 'coneng' ? '융공대' : board === 'fbs' ? '핀빅스' : ZINE_LABELS[board] || board; }

function resolveRepositoryUrl() {
  if (CONFIG.repositoryUrl) return CONFIG.repositoryUrl;
  if (!location.hostname.endsWith('.github.io')) return '';
  const owner = location.hostname.split('.')[0];
  const repo = location.pathname.split('/').filter(Boolean)[0];
  return repo ? `https://github.com/${owner}/${repo}` : `https://github.com/${owner}/${owner}.github.io`;
}
function prepareRepositoryLinks() {
  const url = resolveRepositoryUrl();
  $$('[data-repository-link]').forEach((link) => {
    if (!url) return;
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.hidden = false;
  });
}

function renderNav() {
  const buttons = (mobile = false) => SECTIONS.map((section) =>
    `<button type="button" class="nav-button${state.section === section.id ? ' active' : ''}" data-section="${section.id}" aria-current="${state.section === section.id ? 'page' : 'false'}">${mobile ? `${NAV_ICONS[section.id]}<span>${section.desktop}</span>` : section.desktop}</button>`
  ).join('');
  if (!els.desktopNav.childElementCount) els.desktopNav.innerHTML = buttons(false);
  if (!els.mobileNav.childElementCount) els.mobileNav.innerHTML = buttons(true);
  [els.desktopNav, els.mobileNav].forEach((nav) => {
    $$('[data-section]', nav).forEach((button) => {
      const active = button.dataset.section === state.section;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
  });
}

function dateCutoff() {
  const today = seoulDate();
  if (state.range === 'all') return '';
  if (state.range === 'semester') {
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    return month >= 9 ? `${year}-08-01` : month >= 3 ? `${year}-03-01` : `${year - 1}-08-01`;
  }
  return shiftISODate(today, -Number(state.range));
}

function sectionItems({ includePersonal = true } = {}) {
  if (!state.data) return [];
  let items = state.data.items;
  if (state.section === 'notice') items = items.filter((x) => ['univ', 'coneng', 'fbs'].includes(x.board));
  if (state.section === 'recruit') items = items.filter((x) => x.board === 'recruit');
  if (state.section === 'calendar') items = items.filter((x) => x.board === 'calendar');
  if (state.section === 'meal') items = items.filter((x) => x.board === 'restaurant');
  if (state.section === 'webzine') items = items.filter((x) => ['today', 'newsletter', 'people', 'focus'].includes(x.board));

  const query = state.query.trim().toLocaleLowerCase('ko');
  if (query) items = items.filter((x) => `${x.title} ${x.summary}`.toLocaleLowerCase('ko').includes(query));
  if (state.section === 'notice' && state.source !== 'all') items = items.filter((x) => x.board === state.source);
  if (state.section === 'notice' && state.hidePinned) items = items.filter((x) => !x.pinned);
  if (state.section === 'webzine' && state.zineSource !== 'all') items = items.filter((x) => x.board === state.zineSource);
  if (['notice', 'recruit'].includes(state.section)) {
    const cutoff = dateCutoff();
    if (cutoff) items = items.filter((x) => x.date >= cutoff);
  }
  if (includePersonal && ['notice', 'recruit', 'webzine'].includes(state.section)) {
    if (state.personalView === 'interest') items = items.filter(isInterested);
    if (state.personalView === 'favorite') items = items.filter((item) => state.favorites.has(itemKey(item)));
    if (state.personalView === 'new') items = items.filter(isNewItem);
  }
  if (state.section === 'calendar') return items.sort((a, b) => a.date.localeCompare(b.date));
  if (state.section === 'meal') {
    const mealOrder = { '조식': 0, '중식': 1, '석식': 2, '간식': 3 };
    return [...items].sort((a, b) => a.date.localeCompare(b.date)
      || (mealOrder[a.meal] ?? 9) - (mealOrder[b.meal] ?? 9)
      || String(a.corner || '').localeCompare(String(b.corner || ''), 'ko'));
  }
  return items.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.date.localeCompare(a.date));
}

function filterButton(label, value, current, type, count = '') {
  return `<button type="button" class="tab-chip${value === current ? ' active' : ''}" data-filter-type="${type}" data-filter-value="${value}" aria-pressed="${value === current}">${escapeHTML(label)}${count !== '' ? `<span>${count}</span>` : ''}</button>`;
}
function renderFilters() {
  if (!state.data) return;
  let html = '';
  let pinnedToggle = '';
  if (state.section === 'notice') {
    const cutoff = dateCutoff();
    const allNotices = state.data.items.filter((x) => ['univ', 'coneng', 'fbs'].includes(x.board) && (!cutoff || x.date >= cutoff));
    const base = state.hidePinned ? allNotices.filter((x) => !x.pinned) : allNotices;
    const pinnedCount = allNotices.filter((x) => x.pinned).length;
    pinnedToggle = `<button type="button" class="pin-toggle${state.hidePinned ? ' active' : ''}" data-pinned-toggle aria-pressed="${state.hidePinned}" ${pinnedCount ? '' : 'disabled'}>${state.hidePinned ? '고정 공지 보기' : '고정 공지 숨기기'}<span>${pinnedCount}</span></button>`;
    html += `<div class="chip-group content-filter-group notice-source-group">${Object.entries(SOURCE_LABELS).map(([value, label]) => filterButton(label, value, state.source, 'source', value === 'all' ? base.length : base.filter((x) => x.board === value).length)).join('')}${pinnedToggle}</div>`;
  } else if (state.section === 'webzine') {
    html += `<div class="chip-group content-filter-group">${Object.entries(ZINE_LABELS).map(([value, label]) => filterButton(label, value, state.zineSource, 'zine')).join('')}</div>`;
  } else {
    html += '<div class="chip-group"></div>';
  }
  if (['notice', 'recruit', 'webzine'].includes(state.section)) {
    const personalItems = sectionItems({ includePersonal: false });
    const counts = {
      all: personalItems.length,
      interest: personalItems.filter(isInterested).length,
      favorite: personalItems.filter((item) => state.favorites.has(itemKey(item))).length,
      new: personalItems.filter(isNewItem).length,
    };
    html += `<div class="chip-group personal-group"><span class="chip-group-label">내 정보</span>${Object.entries(PERSONAL_VIEWS).map(([value, label]) => filterButton(label, value, state.personalView, 'personalView', counts[value])).join('')}</div>`;
  }
  if (['notice', 'recruit'].includes(state.section)) {
    html += `<div class="chip-group range-group"><span class="chip-group-label">기간</span>${Object.entries(RANGE_LABELS).map(([value, label]) => `<button type="button" class="pill-chip${value === state.range ? ' active' : ''}" data-filter-type="range" data-filter-value="${value}" aria-pressed="${value === state.range}">${label}</button>`).join('')}</div>`;
  }
  els.filters.innerHTML = html;
  els.filters.hidden = ['calendar', 'meal', 'directory'].includes(state.section);
}

function itemMarkup(item) {
  const url = safeUrl(item.url);
  const broken = item.linkType === 'broken' || !url;
  const wrapper = broken ? 'div' : 'a';
  const key = itemKey(item);
  const favorite = state.favorites.has(key);
  const read = state.readItems.has(key);
  const fresh = isNewItem(item);
  const interested = isInterested(item);
  const attrs = broken ? 'role="group"' : `href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer nofollow" data-notice-link data-item-id="${escapeHTML(key)}"`;
  const tags = [];
  if (item.pinned) tags.push('<span class="tag pin">고정</span>');
  if (fresh) tags.push('<span class="tag new">새 공지</span>');
  if (interested) tags.push('<span class="tag interest">관심</span>');
  if (state.section === 'notice') tags.push(`<span class="tag ${sourceClass(item.board)}">${sourceShort(item.board)}</span>`);
  if (state.section === 'recruit') tags.push(`<span class="tag">${escapeHTML(inferCategory(item))}</span>`);
  if (state.section === 'webzine') tags.push(`<span class="tag">${escapeHTML(sourceShort(item.board))}</span>`);
  if (item.linkType === 'external') tags.push('<span class="tag external">외부 ↗</span>');
  if (broken) tags.push('<span class="tag broken">링크 확인 필요</span>');
  const classes = ['notice-item', item.pinned ? 'pinned' : '', favorite ? 'favorite' : '', read ? 'read' : '', fresh ? 'new' : '', interested ? 'interested' : ''].filter(Boolean).join(' ');
  const favoriteLabel = favorite ? '즐겨찾기에서 제거' : '즐겨찾기에 추가';
  return `<article class="${classes}" data-item-id="${escapeHTML(key)}"><${wrapper} class="notice-main" ${attrs}><div><div class="notice-title-row">${tags.join('')}<span class="notice-title">${highlight(item.title, item)}</span></div>${item.summary ? `<p class="notice-summary">${highlight(item.summary, item)}</p>` : ''}<p class="notice-meta">${escapeHTML(item.writer || item.boardLabel || sourceShort(item.board))} / ${escapeHTML(formatDate(item.date))}${item.views ? ` / 조회 ${formatViews(item.views)}` : ''}${read ? ' / 읽음' : ''}${!broken ? ' / <span class="external-mark">원문 ↗</span>' : ''}</p></div></${wrapper}><button class="favorite-button${favorite ? ' active' : ''}" type="button" data-favorite-id="${escapeHTML(key)}" aria-label="${escapeHTML(item.title)} ${favoriteLabel}" aria-pressed="${favorite}">${STAR_ICON}</button></article>`;
}

function calendarGroupsMarkup(items, nearestDate = '') {
  const groups = Map.groupBy ? Map.groupBy(items, (x) => x.date.slice(0, 7)) : items.reduce((map, item) => map.set(item.date.slice(0, 7), [...(map.get(item.date.slice(0, 7)) || []), item]), new Map());
  return [...groups.entries()].map(([month, values]) => `<section><h2 class="calendar-month">${month.replace('-', '. ')}</h2>${values.map((item) => {
    const nearest = item.date === nearestDate;
    return `<a class="calendar-item${nearest ? ' nearest' : ''}" href="${escapeHTML(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer nofollow"><span class="calendar-date">${escapeHTML(formatDate(item.date).slice(5))}</span><span class="tag">학사</span><span class="calendar-title">${nearest ? '<small class="nearest-label">가장 가까운 일정</small>' : ''}${highlight(item.title)}</span></a>`;
  }).join('')}</section>`).join('');
}
function calendarMarkup(items) {
  const today = seoulDate();
  const upcoming = items.filter((item) => item.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = items.filter((item) => item.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const nearestDate = upcoming[0]?.date || '';
  const upcomingMarkup = upcoming.length
    ? calendarGroupsMarkup(upcoming, nearestDate)
    : '<div class="empty-state calendar-empty">예정된 학사일정이 없습니다.</div>';
  const pastMarkup = state.showPastCalendar
    ? `<section class="past-calendar"><div class="past-calendar-head"><strong>지난 학사일정</strong><button type="button" data-calendar-past>이전 내용 닫기</button></div>${calendarGroupsMarkup(past)}</section>`
    : `<button class="past-calendar-toggle" type="button" data-calendar-past>이전 내용 보기 <span>${past.length}건</span></button>`;
  return `<div class="calendar-overview"><strong>오늘 이후의 학사일정</strong><span>${upcoming.length}건을 가까운 순서로 표시합니다.</span></div>${upcomingMarkup}${past.length ? pastMarkup : ''}`;
}
function mealMarkup(items) {
  if (!items.length) return '';
  const today = seoulDate();
  const weeks = [...new Set(items.map((item) => mondayOfWeek(item.date)).filter(Boolean))].sort().reverse();
  const currentWeek = mondayOfWeek(today);
  if (!weeks.includes(state.mealWeek)) {
    state.mealWeek = weeks.includes(currentWeek) ? currentWeek : weeks[0];
  }
  const selectedItems = items.filter((item) => mondayOfWeek(item.date) === state.mealWeek);
  const dayLabel = (item) => item.day || item.title.replace(new RegExp(` ${item.meal || '중식'}$`), '');
  const groups = selectedItems.reduce((map, item) => map.set(dayLabel(item), [...(map.get(dayLabel(item)) || []), item]), new Map());
  const weekOptions = weeks.map((week) => {
    const label = `${formatDate(week)} ~ ${formatDate(shiftISODate(week, 4))}`;
    return `<option value="${week}"${week === state.mealWeek ? ' selected' : ''}>${label}</option>`;
  }).join('');
  return `<div class="meal-intro"><div class="meal-intro-copy"><strong>미래백년관 정오아카데미</strong><span class="meal-hours"><span class="meal-hours-row"><b>조식</b><span>간편식 08:30 · 식사류 09:30 (소진 시까지)</span></span><span class="meal-hours-row"><b>중식</b><span>11:00~13:30</span></span></span><small class="meal-program-note">코너별 주간 식단입니다. 조식은 학기 중 ‘천원의 아침밥’ 사업 운영 기간에만 표시됩니다.</small></div><label class="meal-week-picker"><span>조회 주간</span><select data-meal-week aria-label="학식 조회 주간">${weekOptions}</select></label></div>${[...groups.entries()].map(([day, rows]) => {
    const isToday = rows.some((item) => item.date === today) || mealDayDate(day, today) === today;
    return `<a class="meal-day${isToday ? ' today' : ''}"${isToday ? ' aria-current="date"' : ''} href="${escapeHTML(safeUrl(rows[0].url))}" target="_blank" rel="noopener noreferrer nofollow"><span class="meal-date">${isToday ? '<small class="meal-today-label">오늘</small>' : ''}${highlight(day)}</span><span class="meal-corners">${rows.map((item) => {
      const corner = item.corner || (rows.length > 1 ? '코너' : '한식');
      const label = item.meal ? `${item.meal} · ${corner}` : corner;
      return `<span class="meal-corner-row"><strong>${escapeHTML(label)}</strong><span>${highlight(mealMenuText(item))}</span></span>`;
    }).join('')}</span></a>`;
  }).join('')}`;
}

function directoryMarkup() {
  return `<section class="directory-page" aria-labelledby="directorySearchPrompt">
    <div class="directory-page-intro">
      <span class="directory-page-icon" aria-hidden="true">${NAV_ICONS.directory}</span>
      <h2 id="directorySearchPrompt">이름, 소속 또는 업무를 입력하세요.</h2>
    </div>
    <form class="directory-search" action="https://www.smu.ac.kr/kor/intro/searchTel.do" method="get" target="_blank" rel="noopener noreferrer" role="search" aria-label="상명대학교 연락처 검색">
      <input type="hidden" name="mode" value="list">
      <div class="directory-search-controls">
        <label class="sr-only" for="directorySearchKey">검색 범위</label>
        <select id="directorySearchKey" name="srSearchKey">
          <option value="">전체</option>
          <option value="office">소속</option>
          <option value="office_s">소속(서울)</option>
          <option value="office_c">소속(천안)</option>
          <option value="name">인명</option>
          <option value="job">업무</option>
        </select>
        <label class="sr-only" for="directorySearchValue">연락처 검색어</label>
        <input id="directorySearchValue" name="srSearchValue" type="search" required maxlength="50" autocomplete="off" placeholder="이름, 소속 또는 업무">
        <button type="submit">상명대학교에서 검색 <span aria-hidden="true">↗</span></button>
      </div>
      <p>입력값은 핀빅스 허브에 저장되지 않으며 상명대학교로 직접 전송됩니다.</p>
    </form>
  </section>`;
}

function renderList() {
  const items = sectionItems();
  const section = currentSection();
  els.title.textContent = section.desktop;
  els.mobileTitle.textContent = section.desktop;
  els.list.setAttribute('aria-busy', 'false');
  els.list.className = `notice-list section-${state.section}`;
  const directory = state.section === 'directory';
  $('#searchForm').hidden = directory;
  $('#mobileSearchForm').hidden = directory;
  els.aiCard.hidden = directory;
  if (directory) {
    els.list.innerHTML = directoryMarkup();
    els.more.hidden = true;
    return;
  }
  if (!items.length) {
    const emptyMessages = {
      interest: ['관심 조건과 일치하는 항목이 없습니다.', '설정에서 관심 게시판이나 키워드를 추가해 보세요.'],
      favorite: ['즐겨찾기한 항목이 없습니다.', '공지 오른쪽의 별표 버튼을 누르면 여기에 모아볼 수 있습니다.'],
      new: ['확인하지 않은 새 공지가 없습니다.', '최근 7일 이내에 게시된 항목을 모두 확인했습니다.'],
    };
    const message = emptyMessages[state.personalView] || ['검색 결과가 없습니다.', '제목과 짧은 요약 범위에서 검색합니다.'];
    els.list.innerHTML = `<div class="empty-state">${message[0]}<small>${message[1]}</small></div>`;
    els.more.hidden = true;
    return;
  }
  if (state.section === 'calendar') els.list.innerHTML = calendarMarkup(items);
  else if (state.section === 'meal') els.list.innerHTML = mealMarkup(items);
  else els.list.innerHTML = items.slice(0, state.visible).map(itemMarkup).join('');
  els.more.hidden = ['calendar', 'meal'].includes(state.section) || state.visible >= items.length;
  els.more.textContent = `${Math.min(state.pageSize, items.length - state.visible)}개 더 보기`;
}

function renderUpcoming() {
  if (!state.data) return;
  const today = seoulDate();
  const todayDay = isoDayNumber(today);
  const items = state.data.items.filter((x) => x.board === 'calendar' && x.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  els.today.textContent = `오늘 ${formatDate(today)} 기준`;
  els.upcoming.innerHTML = items.length ? items.map((item) => {
    const days = isoDayNumber(item.date) - todayDay;
    const dd = days === 0 ? 'D-DAY' : `D-${days}`;
    return `<a class="upcoming-item" href="${escapeHTML(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer nofollow"><span class="dday${days <= 7 ? ' near' : ''}">${dd}</span><span><strong>${escapeHTML(item.title)}</strong><small>${formatDate(item.date)} / 학사</small></span></a>`;
  }).join('') : '<p class="muted">예정된 일정이 없습니다.</p>';
}

function currentAIItems() {
  let items = sectionItems();
  if (state.section === 'calendar') {
    const today = seoulDate();
    items = items.filter((item) => item.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  }
  return items.slice(0, 12);
}
function aiEvidenceLabel() {
  const items = currentAIItems();
  const summaries = items.filter((item) => item.summary).length;
  return `입력 ${items.length}건 / 짧은 요약 ${summaries}건 포함`;
}
function aiGeneratedDisclosure() {
  return '<div class="ai-generated-disclosure" role="note">생성형 AI가 만든 내용입니다.</div>';
}
function updateAILabelIcon(ready) {
  const path = $('.ai-label-icon path');
  if (!path) return;
  const mouth = ready ? 'M8.5 14c1.8 1.5 5.2 1.5 7 0' : 'M9 14h6';
  path.setAttribute('d', `M9 10h.01M15 10h.01${mouth}M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3`);
}
function questionFormMarkup(stored, disabled = false) {
  if (!stored) return '';
  return `<form class="ai-question-form" data-ai-question-form>
    <label class="sr-only" for="aiQuestionInput">현재 목록에 대해 AI에게 질문</label>
    <input id="aiQuestionInput" data-ai-question-input name="question" type="text" maxlength="180" autocomplete="off" placeholder="현재 목록에 대해 질문하세요" value="${escapeHTML(state.aiDraft)}" ${disabled ? 'disabled' : ''}>
    <button type="submit" aria-label="질문 보내기" ${disabled ? 'disabled' : ''}>${SEND_ICON}</button>
  </form><small class="ai-question-note">현재 탭의 제목과 짧은 요약 범위에서 답변합니다.</small>`;
}
function renderAI() {
  updateMobileAICard();
  const stored = localAI.isStored();
  const ready = stored && !state.aiError;
  const userMessage = state.aiQuestion
    ? `<div class="ai-user-message"><span>나</span><p>${escapeHTML(state.aiQuestion)}</p></div>`
    : '';
  const answerLabel = state.aiQuestion ? `<div class="ai-response-label">${aiIcon(true)}<span>AI 답변</span></div>` : '';
  els.ai.setAttribute('aria-busy', String(state.aiBusy));
  updateAILabelIcon(ready);
  if (state.aiBusy) {
    const loadingIntro = state.aiQuestion ? answerLabel : `<div class="ai-placeholder compact">${aiIcon(true)}<h3>기기에서 요약 생성 중</h3><p>On-Device AI가 현재 탭의 제목과 짧은 요약만 분석하고 있습니다.</p></div>`;
    els.ai.innerHTML = `${userMessage}${loadingIntro}<div class="ai-result"><div class="ai-markdown ai-streaming" id="aiStream">${renderStreamingMarkdown(state.aiText || '응답을 준비하고 있습니다.')}</div>${aiGeneratedDisclosure()}<small>${aiEvidenceLabel()}<br>내용이 정확하지 않을 수 있으므로 반드시 원문을 확인하세요.</small></div><div class="ai-actions"><button class="secondary-button ai-stop-button" type="button" data-ai-stop ${state.aiStopping ? 'disabled' : ''}>${state.aiStopping ? '중지 중' : '생성 중지'}</button></div>${questionFormMarkup(stored, true)}`;
    return;
  }
  if (state.aiText) {
    const voiceButton = 'speechSynthesis' in window
      ? `<button class="voice-button${state.aiSpeaking ? ' speaking' : ''}" type="button" data-ai-speak aria-label="${state.aiSpeaking ? 'AI 요약 음성 재생 중지' : 'AI 요약 음성 재생'}" aria-pressed="${state.aiSpeaking}">${state.aiSpeaking ? STOP_ICON : SPEAKER_ICON}<span class="sr-only">${state.aiSpeaking ? '음성 재생 중지' : '음성으로 듣기'}</span></button>`
      : '';
    const shareButton = `<button class="share-button" type="button" data-ai-share aria-label="AI 요약 외부 공유">${SHARE_ICON}<span class="sr-only">AI 요약 공유</span></button>`;
    els.ai.innerHTML = `${userMessage}${answerLabel}<div class="ai-result"><div class="ai-markdown">${renderMarkdown(state.aiText)}</div>${aiGeneratedDisclosure()}<small>${aiEvidenceLabel()}<br>제목과 요약만 입력해 생성했습니다. 내용이 정확하지 않을 수 있으므로 반드시 원문을 확인하세요.</small></div><div class="ai-actions"><button class="inline-button" type="button" data-ai-generate>${state.aiQuestion ? '기본 요약 보기' : '다시 요약'}</button>${voiceButton}${shareButton}</div>${questionFormMarkup(stored)}`;
    return;
  }
  const message = state.aiError || (stored ? 'On-Device AI 모델이 준비되어 있습니다. 현재 목록을 기기 안에서 요약할 수 있습니다.' : 'AI 요약을 사용하려면 설정에서 AI 모델을 먼저 다운로드하세요.');
  els.ai.innerHTML = `<div class="ai-placeholder">${aiIcon(ready)}<h3>${state.aiError ? 'AI 기능을 시작하지 못했습니다' : stored ? 'On-Device AI 모델 준비됨' : 'On-Device AI 모델 필요'}</h3><p>${escapeHTML(message)}</p><button class="inline-button" type="button" ${stored ? 'data-ai-generate' : 'data-open-settings'}>${stored ? '요약 생성' : '설정에서 다운로드'}</button></div>${questionFormMarkup(stored)}`;
}

function resetAIState() {
  localAI.stop();
  stopAISpeech();
  if (aiStreamFrame) cancelAnimationFrame(aiStreamFrame);
  aiStreamFrame = 0;
  aiPendingText = '';
  state.aiRequestId += 1;
  state.aiText = '';
  state.aiError = '';
  state.aiBusy = false;
  state.aiStopping = false;
  state.aiQuestion = '';
  state.aiDraft = '';
}

function stopAISpeech() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  state.aiSpeaking = false;
}
function toggleAISpeech() {
  if (!('speechSynthesis' in window)) { showToast('이 브라우저에서는 음성 재생을 지원하지 않습니다.'); return; }
  if (state.aiSpeaking) {
    stopAISpeech();
    renderAI();
    return;
  }
  const text = markdownToSpeech(state.aiText);
  if (!text) { showToast('재생할 AI 요약이 없습니다.'); return; }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ko-KR';
  utterance.rate = 0.96;
  utterance.pitch = 1;
  const koreanVoice = window.speechSynthesis.getVoices().find((voice) => voice.lang.toLowerCase().startsWith('ko'));
  if (koreanVoice) utterance.voice = koreanVoice;
  utterance.onend = utterance.onerror = () => {
    state.aiSpeaking = false;
    renderAI();
  };
  state.aiSpeaking = true;
  renderAI();
  window.speechSynthesis.speak(utterance);
}

function motionEnabled() {
  return !document.documentElement.classList.contains('reduce-motion') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function animateContent({ appended = false } = {}) {
  if (!motionEnabled()) return;
  const items = [...els.list.querySelectorAll('.notice-item, .calendar-item, .meal-day')];
  const visibleItems = appended ? items.slice(Math.max(0, items.length - state.pageSize)) : items.slice(0, 14);
  visibleItems.forEach((item, index) => {
    item.animate(
      [{ opacity: 0, transform: 'translateY(9px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 260, delay: Math.min(index * 22, 180), easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' },
    );
  });
}

function updateView(callback) {
  if (motionEnabled() && document.startViewTransition) return document.startViewTransition(callback);
  callback();
  return null;
}

function renderAll({ resetAI = false } = {}) {
  if (resetAI) resetAIState();
  renderNav(); renderFilters(); renderList(); renderUpcoming(); renderAI();
  requestAnimationFrame(() => animateContent());
}

function setSection(section) {
  if (!SECTIONS.some((x) => x.id === section)) return;
  closeMobileMenu();
  resetAIState();
  updateView(() => {
    state.section = section; state.query = ''; state.visible = state.pageSize; state.showPastCalendar = false;
    if (section === 'recruit') state.range = 'all';
    if (section === 'notice') state.range = 'all';
    els.input.value = ''; els.mobileInput.value = '';
    history.replaceState(null, '', `#${section}`);
    renderAll();
  });
  window.scrollTo({ top: 0, behavior: motionEnabled() ? 'smooth' : 'auto' });
}

function openModal(dialog) {
  if (!dialog || dialog.open) return;
  dialog.showModal();
  if (motionEnabled()) {
    dialog.animate(
      [{ opacity: 0, transform: 'translateY(18px) scale(.985)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }],
      { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
  }
}
function openSettings() {
  updateModelSettings();
  updatePersonalizationSettings();
  openModal(els.dialog);
}
function openOnDeviceInfo() { openModal(els.infoDialog); }
function persistSet(key, values, limit = 1200) {
  const items = [...values].slice(-limit);
  localStorage.setItem(key, JSON.stringify(items));
}
function updatePersonalizationSettings() {
  $$('[data-interest-source]').forEach((input) => { input.checked = state.personalization.sources.includes(input.value); });
  $$('[data-major-keyword]').forEach((input) => { input.checked = state.personalization.majorKeywords.includes(input.value); });
  $$('[data-important-keyword]').forEach((input) => { input.checked = state.personalization.importantKeywords.includes(input.value); });
  $('#interestKeywordsInput').value = state.personalization.customKeywords.join(', ');
  $('#favoriteCount').textContent = state.favorites.size.toLocaleString('ko-KR');
  $('#readCount').textContent = state.readItems.size.toLocaleString('ko-KR');
  const conditionCount = state.personalization.sources.length + interestKeywords().length;
  $('#personalizationStateBadge').textContent = conditionCount ? `관심 조건 ${conditionCount}개` : '관심 조건 없음';
}
function savePersonalization() {
  const customKeywords = cleanKeywordList($('#interestKeywordsInput').value.split(/[,，\n]/));
  state.personalization = {
    sources: $$('[data-interest-source]:checked').map((input) => input.value),
    majorKeywords: $$('[data-major-keyword]:checked').map((input) => input.value),
    customKeywords,
    importantKeywords: $$('[data-important-keyword]:checked').map((input) => input.value),
  };
  localStorage.setItem('fbs.personalization', JSON.stringify(state.personalization));
  state.visible = state.pageSize;
  updatePersonalizationSettings();
  renderAll({ resetAI: true });
  showToast('내 관심 정보를 이 브라우저에 저장했습니다.');
}
function resetPersonalization() {
  state.personalization = structuredClone(DEFAULT_PERSONALIZATION);
  localStorage.setItem('fbs.personalization', JSON.stringify(state.personalization));
  state.personalView = 'all';
  state.visible = state.pageSize;
  updatePersonalizationSettings();
  renderAll({ resetAI: true });
  showToast('관심 정보를 기본값으로 복원했습니다.');
}
function clearReadHistory() {
  if (!state.readItems.size) { showToast('저장된 읽음 기록이 없습니다.'); return; }
  if (!confirm('이 브라우저에 저장된 읽음 기록을 모두 초기화할까요?')) return;
  state.readItems.clear();
  persistSet('fbs.readItems', state.readItems);
  state.visible = state.pageSize;
  updatePersonalizationSettings();
  renderFilters();
  renderList();
  showToast('읽음 기록을 초기화했습니다.');
}
function markItemRead(key) {
  if (!key || state.readItems.has(key)) return;
  state.readItems.add(key);
  persistSet('fbs.readItems', state.readItems);
  updatePersonalizationSettings();
  setTimeout(() => {
    renderFilters();
    renderList();
  }, 0);
}
function toggleFavorite(key) {
  if (!key) return;
  const removing = state.favorites.has(key);
  if (removing) state.favorites.delete(key);
  else state.favorites.add(key);
  persistSet('fbs.favorites', state.favorites, 500);
  updatePersonalizationSettings();
  renderFilters();
  renderList();
  showToast(removing ? '즐겨찾기에서 제거했습니다.' : '즐겨찾기에 추가했습니다.');
}
function updateModelSettings() {
  const support = localAI.supportStatus();
  const { supported, experimental } = support;
  const stored = localAI.isStored();
  const badge = $('#modelStateBadge');
  badge.textContent = stored ? '다운로드됨' : !supported ? '사용 불가' : experimental ? '실험적 지원' : '다운로드 안 됨';
  badge.className = `status-badge${stored ? ' ready' : !supported ? ' error' : experimental ? ' warning' : ''}`;
  const notice = $('#webgpuNotice');
  notice.textContent = support.reason;
  notice.className = `notice-box${!supported ? ' error' : experimental ? ' warning' : ''}`;
  $('#downloadModelButton').hidden = stored;
  $('#downloadModelButton').disabled = !supported;
  $('#deleteModelButton').hidden = !stored;
  localAI.storageEstimate().then((estimate) => {
    if (!estimate) return;
    const available = formatBytes(estimate.available);
    $('#modelStorageEstimate').textContent = available
      ? `브라우저 캐시 / 약 ${available} 여유`
      : '브라우저 캐시 / 여유 공간 확인 필요';
  }).catch(() => {});
}
function updateDownloadProgress(progress) {
  $('#downloadProgress').hidden = false;
  $('#downloadStatus').textContent = progress.status;
  $('#downloadPercent').textContent = `${progress.percent}%`;
  $('#downloadBar').value = progress.percent;
  $('#downloadBytes').textContent = progress.text || '필요한 파일을 확인하고 있습니다.';
}

async function downloadModel() {
  const button = $('#downloadModelButton');
  button.disabled = true; button.textContent = '다운로드 중';
  try {
    await localAI.download(updateDownloadProgress);
    updateModelSettings(); renderAI(); showToast('AI 모델을 로컬에 저장했습니다.');
  } catch (error) {
    $('#webgpuNotice').textContent = `다운로드 실패: ${error.message || error}`;
    $('#webgpuNotice').classList.remove('warning');
    $('#webgpuNotice').classList.add('error');
  } finally {
    button.disabled = !localAI.isSupported(); button.textContent = 'On-Device AI 모델 다운로드';
  }
}
async function deleteModel() {
  if (!confirm('브라우저에 저장된 AI 모델 파일을 삭제할까요?')) return;
  const button = $('#deleteModelButton');
  button.disabled = true;
  try { await localAI.remove(); stopAISpeech(); state.aiText = ''; updateModelSettings(); renderAI(); showToast('On-Device AI 모델을 삭제했습니다.'); }
  catch (error) { showToast(`모델 삭제 실패: ${error.message || error}`); }
  finally { button.disabled = false; }
}
function scheduleAIStream(text) {
  aiPendingText = text;
  if (aiStreamFrame) return;
  aiStreamFrame = requestAnimationFrame(() => {
    aiStreamFrame = 0;
    const stream = $('#aiStream');
    if (stream) stream.innerHTML = renderStreamingMarkdown(aiPendingText);
  });
}
async function generateSummary(question = '') {
  const items = currentAIItems();
  if (!items.length) { showToast('요약할 항목이 없습니다.'); return; }
  stopAISpeech();
  if (aiStreamFrame) cancelAnimationFrame(aiStreamFrame);
  aiStreamFrame = 0;
  aiPendingText = '';
  const section = state.section;
  const requestId = ++state.aiRequestId;
  state.aiQuestion = question.trim();
  state.aiDraft = '';
  state.aiBusy = true; state.aiStopping = false; state.aiText = ''; state.aiError = ''; renderAI();
  try {
    const result = await localAI.summarize(items, section, state.aiQuestion, (text) => {
      if (requestId !== state.aiRequestId || section !== state.section) return;
      state.aiText = text;
      scheduleAIStream(text);
    });
    if (requestId === state.aiRequestId && section === state.section) state.aiText = result;
  } catch (error) {
    if (requestId === state.aiRequestId && section === state.section) {
      if (error.name === 'AbortError') showToast('AI 생성을 중지했습니다.');
      else state.aiError = error.message || String(error);
    }
  } finally {
    if (requestId === state.aiRequestId && section === state.section) {
      state.aiBusy = false; state.aiStopping = false; renderAI(); updateModelSettings();
      if (state.aiQuestion) requestAnimationFrame(() => $('#aiQuestionInput')?.focus({ preventScroll: true }));
    }
  }
}

async function shareAISummary() {
  const text = markdownToSpeech(state.aiText);
  if (!text) { showToast('공유할 AI 요약이 없습니다.'); return; }
  const title = `핀빅스 허브 | ${currentSection().desktop} AI 요약`;
  const sharedText = `생성형 AI가 만든 내용입니다.\n\n${text}`;
  try {
    if (navigator.share) {
      await navigator.share({ title, text: sharedText });
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(`${title}\n\n${sharedText}`);
      showToast('AI 요약을 클립보드에 복사했습니다.');
    } else {
      showToast('이 브라우저에서는 외부 공유를 지원하지 않습니다.');
    }
  } catch (error) {
    if (error.name !== 'AbortError') showToast('AI 요약을 공유하지 못했습니다.');
  }
}

function moveAICard() {
  if (matchMedia('(max-width: 1050px)').matches) els.filters.after(els.aiCard);
  else els.sideRail.prepend(els.aiCard);
  updateMobileAICard();
}
function updateMobileAICard() {
  const mobile = matchMedia('(max-width: 780px)').matches;
  const expanded = !mobile || state.mobileAIExpanded || state.aiBusy;
  els.aiCard.classList.toggle('mobile-collapsed', mobile && !expanded);
  els.aiToggle.hidden = !mobile;
  els.aiToggle.setAttribute('aria-expanded', String(expanded));
  els.aiToggle.textContent = expanded ? 'AI 접기' : 'AI 열기';
}

function openMobileMenu() {
  if (!matchMedia('(max-width: 780px)').matches) return;
  document.body.classList.add('mobile-menu-open');
  els.mobileDrawer.inert = false;
  els.mobileDrawer.setAttribute('aria-hidden', 'false');
  els.mobileBackdrop.setAttribute('aria-hidden', 'false');
  els.mobileMenuButton.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => (els.mobileNav.querySelector('.active') || els.mobileNav.querySelector('button'))?.focus());
}

function closeMobileMenu({ restoreFocus = true } = {}) {
  const wasOpen = document.body.classList.contains('mobile-menu-open');
  document.body.classList.remove('mobile-menu-open');
  if (restoreFocus && wasOpen) els.mobileMenuButton.focus({ preventScroll: true });
  els.mobileDrawer.inert = true;
  els.mobileDrawer.setAttribute('aria-hidden', 'true');
  els.mobileBackdrop.setAttribute('aria-hidden', 'true');
  els.mobileMenuButton.setAttribute('aria-expanded', 'false');
}

document.addEventListener('click', (event) => {
  const homeLink = event.target.closest('[data-home-link]');
  if (homeLink) {
    event.preventDefault();
    setSection('notice');
    return;
  }
  const favorite = event.target.closest('[data-favorite-id]');
  if (favorite) {
    toggleFavorite(favorite.dataset.favoriteId);
    return;
  }
  const noticeLink = event.target.closest('[data-notice-link]');
  if (noticeLink) markItemRead(noticeLink.dataset.itemId);
  const section = event.target.closest('[data-section]');
  if (section) setSection(section.dataset.section);
  if (event.target.closest('[data-pinned-toggle]')) {
    updateView(() => {
      state.hidePinned = !state.hidePinned;
      state.visible = state.pageSize;
      localStorage.setItem('fbs.hidePinned', String(state.hidePinned));
      renderAll({ resetAI: true });
    });
  }
  const filter = event.target.closest('[data-filter-type]');
  if (filter) {
    updateView(() => {
      state[filter.dataset.filterType === 'zine' ? 'zineSource' : filter.dataset.filterType] = filter.dataset.filterValue;
      state.visible = state.pageSize; renderAll({ resetAI: true });
    });
  }
  if (event.target.closest('[data-calendar-past]')) {
    updateView(() => {
      state.showPastCalendar = !state.showPastCalendar;
      renderList();
      requestAnimationFrame(() => animateContent());
    });
  }
  if (event.target.closest('[data-open-settings]')) openSettings();
  if (event.target.closest('[data-ai-generate]')) generateSummary('');
  if (event.target.closest('[data-ai-stop]') && localAI.stop()) {
    state.aiStopping = true;
    renderAI();
  }
  if (event.target.closest('[data-ai-speak]')) toggleAISpeech();
  if (event.target.closest('[data-ai-share]')) shareAISummary();
  if (event.target.closest('#mobileAIToggle')) {
    state.mobileAIExpanded = !state.mobileAIExpanded;
    localStorage.setItem('fbs.mobileAIExpanded', String(state.mobileAIExpanded));
    updateMobileAICard();
  }
});
document.addEventListener('submit', (event) => {
  const form = event.target.closest('[data-ai-question-form]');
  if (!form) return;
  event.preventDefault();
  const question = String(new FormData(form).get('question') || '').trim();
  if (!question) { showToast('질문을 입력해 주세요.'); return; }
  generateSummary(question);
});
document.addEventListener('input', (event) => {
  if (event.target.matches('[data-ai-question-input]')) state.aiDraft = event.target.value;
});
document.addEventListener('change', (event) => {
  if (!event.target.matches('[data-meal-week]')) return;
  state.mealWeek = event.target.value;
  renderList();
});
document.addEventListener('auxclick', (event) => {
  const noticeLink = event.target.closest('[data-notice-link]');
  if (noticeLink) markItemRead(noticeLink.dataset.itemId);
});
$('#settingsButton').addEventListener('click', openSettings);
$('#mobileSettingsButton').addEventListener('click', openSettings);
$('#mobileMenuButton').addEventListener('click', openMobileMenu);
$('#mobileNavClose').addEventListener('click', () => closeMobileMenu());
$('#mobileNavBackdrop').addEventListener('click', () => closeMobileMenu());
$('#onDeviceInfoButton').addEventListener('click', openOnDeviceInfo);
$('#downloadModelButton').addEventListener('click', downloadModel);
$('#deleteModelButton').addEventListener('click', deleteModel);
$('#savePersonalizationButton').addEventListener('click', savePersonalization);
$('#resetPersonalizationButton').addEventListener('click', resetPersonalization);
$('#clearReadHistoryButton').addEventListener('click', clearReadHistory);
$('#calendarShortcut').addEventListener('click', () => setSection('calendar'));
els.more.addEventListener('click', () => {
  state.visible += state.pageSize;
  renderList();
  requestAnimationFrame(() => animateContent({ appended: true }));
});

function submitSearch(input) {
  updateView(() => {
    state.query = input.value.trim();
    state.visible = state.pageSize; renderAll({ resetAI: true });
    els.input.value = state.query; els.mobileInput.value = state.query;
  });
}
$('#searchForm').addEventListener('submit', (event) => { event.preventDefault(); submitSearch(els.input); });
$('#mobileSearchForm').addEventListener('submit', (event) => { event.preventDefault(); submitSearch(els.mobileInput); });
for (const input of [els.input, els.mobileInput]) {
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submitSearch(input);
  });
}

$('#pageSizeSelect').value = String(state.pageSize);
$('#pageSizeSelect').addEventListener('change', (event) => {
  state.pageSize = Number(event.target.value); state.visible = state.pageSize;
  localStorage.setItem('fbs.pageSize', String(state.pageSize)); renderList();
  requestAnimationFrame(() => animateContent());
});
const themeMedia = matchMedia('(prefers-color-scheme: dark)');
function applyTheme(theme, persist = true) {
  const selected = ['light', 'dark', 'system'].includes(theme) ? theme : 'system';
  document.documentElement.dataset.theme = selected;
  if (persist) localStorage.setItem('fbs.theme', selected);
  const themeSelect = $('#themeSelect');
  if (themeSelect) themeSelect.value = selected;
  const effective = selected === 'system' ? (themeMedia.matches ? 'dark' : 'light') : selected;
  $('meta[name="theme-color"]')?.setAttribute('content', effective === 'dark' ? '#111a36' : '#0e207f');
}
applyTheme(localStorage.getItem('fbs.theme') || 'system', false);
$('#themeSelect').addEventListener('change', (event) => applyTheme(event.target.value));
themeMedia.addEventListener('change', () => {
  if (document.documentElement.dataset.theme === 'system') applyTheme('system', false);
});
const reduceMotion = localStorage.getItem('fbs.reduceMotion') === 'true';
$('#reduceMotionToggle').checked = reduceMotion;
document.documentElement.classList.toggle('reduce-motion', reduceMotion);
$('#reduceMotionToggle').addEventListener('change', (event) => {
  document.documentElement.classList.toggle('reduce-motion', event.target.checked);
  localStorage.setItem('fbs.reduceMotion', String(event.target.checked));
  if (event.target.checked) document.getAnimations().forEach((animation) => animation.cancel());
  else requestAnimationFrame(() => animateContent());
});

document.addEventListener('keydown', (event) => {
  if (!document.body.classList.contains('mobile-menu-open')) return;
  if (event.key === 'Escape') {
    closeMobileMenu();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = $$('#mobileNav button:not([disabled])');
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
matchMedia('(max-width: 780px)').addEventListener('change', (event) => {
  moveAICard();
  if (!event.matches) closeMobileMenu({ restoreFocus: false });
});
window.addEventListener('hashchange', () => setSection(location.hash.slice(1)));

async function init() {
  prepareRepositoryLinks(); moveAICard();
  await localAI.verifyStored().catch(() => false);
  updateModelSettings(); renderNav(); renderAI();
  els.list.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  try {
    const response = await fetch(CONFIG.dataUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    if (response.headers.get('X-FBS-Offline') === 'true') {
      showToast('네트워크 연결이 없어 마지막 저장 데이터를 표시합니다.');
    }
    state.visible = state.pageSize;
    renderAll();
  } catch (error) {
    els.list.setAttribute('aria-busy', 'false');
    els.list.innerHTML = `<div class="error-state">공지 데이터를 불러오지 못했습니다.<br><small>${escapeHTML(error.message || error)}</small></div>`;
  }
}

init();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
