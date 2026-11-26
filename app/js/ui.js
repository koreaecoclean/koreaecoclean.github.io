/**
 * ui.js — small view helpers shared by every screen.
 * No framework: plain DOM, template strings, and a couple of overlays.
 */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML-escape any value that goes into a template string. */
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 'YYYY-MM-DD' → local Date (avoids the UTC shift of new Date('YYYY-MM-DD')). */
export function parseISODate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Local date as 'YYYY-MM-DD'. */
export function toISODate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function nowHHMM(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function addDaysISO(iso, days) {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function daysBetween(fromISO, toISOValue = toISODate()) {
  const a = parseISODate(fromISO);
  const b = parseISODate(toISOValue);
  return Math.round((b - a) / 86400000);
}

/** '11.24' */
export function fmtMonthDay(iso) {
  const date = parseISODate(iso);
  return `${date.getMonth() + 1}.${date.getDate()}`;
}

/** '11월 24일 (화)' */
export function fmtDateLong(iso) {
  const date = parseISODate(iso);
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAYS[date.getDay()]})`;
}

/** '2026년 11월' */
export function fmtMonthLabel(iso) {
  const date = parseISODate(iso);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

export function weekdayShort(iso) {
  return WEEKDAYS[parseISODate(iso).getDay()];
}

/** '오전 7:20' */
export function fmtTime(hm) {
  if (!hm) return '';
  const [h, m] = String(hm).split(':').map(Number);
  const meridiem = h < 12 ? '오전' : '오후';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${meridiem} ${hour}:${String(m || 0).padStart(2, '0')}`;
}

/** '오늘' / '어제' / '3일 전' — null when older than a week. */
export function relDayLabel(iso) {
  const diff = daysBetween(iso);
  if (diff === 0) return '오늘';
  if (diff === 1) return '어제';
  if (diff === 2) return '그저께';
  if (diff > 2 && diff < 7) return `${diff}일 전`;
  return null;
}

/** 1430000 → '1,430,000원' (whole won, no locale dependency). */
export function fmtWon(value) {
  const number = Number(value);
  const rounded = Number.isFinite(number) ? Math.round(number) : 0;
  const digits = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${rounded < 0 ? '-' : ''}${digits}원`;
}

/** '2026.11.26.' — 계약서 · 견적서 서식용 */
export function fmtDateDot(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  if (!y || !m || !d) return String(iso);
  return `${y}.${m}.${d}.`;
}

const KOR_DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const KOR_SMALL = ['', '십', '백', '천'];
const KOR_BIG = ['', '만', '억', '조'];

/** 1900000 → '일백구십만' (계약서 ‘일금 ○○원정’ 표기용) */
export function fmtKoreanAmount(value) {
  let number = Math.abs(Math.round(Number(value) || 0));
  if (number === 0) return '영';
  const groups = [];
  while (number > 0) {
    groups.push(number % 10000);
    number = Math.floor(number / 10000);
  }
  let out = '';
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (!group) continue;
    const digits = String(group).split('').map(Number);
    let part = '';
    digits.forEach((digit, position) => {
      if (!digit) return;
      part += KOR_DIGITS[digit] + KOR_SMALL[digits.length - 1 - position];
    });
    out += part + KOR_BIG[index];
  }
  return out;
}

/** 1430000 → '1,430,000' (no unit, for table cells). */
export function fmtNumber(value) {
  const number = Number(value);
  const rounded = Number.isFinite(number) ? Math.round(number) : 0;
  return String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function fmtBytes(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function uid(prefix = 'id') {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/** Rough Korean phone check — 02-123-4567, 010-1234-5678, 0507-1317-8369 … */
export function isKoreanPhone(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  return digits.length >= 8 && digits.length <= 11 && /^0/.test(digits);
}

/* ------------------------------------------------------------------ */
/* toast                                                               */
/* ------------------------------------------------------------------ */

let toastTimer = null;

export function toast(message, options = {}) {
  const { actionLabel = '', onAction = null, tone = 'default', duration = 3400 } = options;
  const region = $('#toast-region');
  if (!region) return;

  const card = document.createElement('div');
  card.className = `toast${tone === 'error' ? ' toast--error' : ''}`;
  card.setAttribute('role', tone === 'error' ? 'alert' : 'status');

  const text = document.createElement('p');
  text.textContent = message;
  card.appendChild(text);

  let timer = null;
  const dismiss = () => {
    window.clearTimeout(timer);
    card.remove();
  };

  if (actionLabel) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'toast__action';
    action.textContent = actionLabel;
    action.addEventListener('click', () => {
      dismiss();
      if (typeof onAction === 'function') onAction();
    });
    card.appendChild(action);
  }

  region.appendChild(card);
  // Keep the stack short so a burst of toasts never covers the tab bar.
  while (region.children.length > 2) region.firstElementChild.remove();
  timer = window.setTimeout(dismiss, duration);
  window.clearTimeout(toastTimer);
  toastTimer = timer;
}

/* ------------------------------------------------------------------ */
/* lightbox                                                            */
/* ------------------------------------------------------------------ */

const lightboxState = { items: [], index: 0 };

function renderLightbox() {
  const box = $('#lightbox');
  if (!box) return;
  const { items, index } = lightboxState;
  const item = items[index];
  if (!item) return;

  const img = $('#lightbox-img');
  img.src = item.url;
  img.alt = item.caption || '현장 사진';
  $('#lightbox-counter').textContent = `${index + 1} / ${items.length}`;
  $('#lightbox-caption').textContent = item.caption || '';
  $('#lightbox-prev').disabled = index === 0;
  $('#lightbox-next').disabled = index === items.length - 1;
  $('#lightbox-prev').hidden = items.length < 2;
  $('#lightbox-next').hidden = items.length < 2;
}

/** items: [{ url, caption }] */
export function openLightbox(items, startIndex = 0) {
  if (!items || !items.length) return;
  lightboxState.items = items;
  lightboxState.index = Math.max(0, Math.min(startIndex, items.length - 1));
  const box = $('#lightbox');
  box.hidden = false;
  document.body.style.overflow = 'hidden';
  renderLightbox();
  $('#lightbox-close').focus({ preventScroll: true });
}

export function closeLightbox() {
  const box = $('#lightbox');
  if (!box || box.hidden) return;
  box.hidden = true;
  document.body.style.overflow = '';
  $('#lightbox-img').src = '';
}

function stepLightbox(delta) {
  const next = lightboxState.index + delta;
  if (next < 0 || next >= lightboxState.items.length) return;
  lightboxState.index = next;
  renderLightbox();
}

export function initLightbox() {
  const box = $('#lightbox');
  if (!box) return;
  box.addEventListener('click', (event) => {
    const action = event.target.closest('[data-lb]')?.dataset.lb;
    if (action === 'close') closeLightbox();
    if (action === 'prev') stepLightbox(-1);
    if (action === 'next') stepLightbox(1);
    if (action === 'stage' && event.target === $('#lightbox-stage')) closeLightbox();
  });
  document.addEventListener('keydown', (event) => {
    if (box.hidden) return;
    if (event.key === 'Escape') closeLightbox();
    if (event.key === 'ArrowLeft') stepLightbox(-1);
    if (event.key === 'ArrowRight') stepLightbox(1);
  });
}

/* ------------------------------------------------------------------ */
/* confirm dialog                                                      */
/* ------------------------------------------------------------------ */

let closeDialog = null;

export function confirmDialog({
  title = '확인',
  message = '',
  confirmLabel = '확인',
  cancelLabel = '취소',
  tone = 'default',
} = {}) {
  return new Promise((resolve) => {
    const dialog = $('#dialog');
    if (!dialog) {
      resolve(window.confirm(message || title));
      return;
    }

    $('#dialog-title').textContent = title;
    $('#dialog-message').textContent = message;
    const ok = $('#dialog-ok');
    const cancel = $('#dialog-cancel');
    ok.textContent = confirmLabel;
    cancel.textContent = cancelLabel;
    ok.className = `btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}`;
    cancel.className = 'btn btn--quiet';
    dialog.hidden = false;

    const finish = (result) => {
      dialog.hidden = true;
      dialog.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      closeDialog = null;
      resolve(result);
    };
    const onClick = (event) => {
      const target = event.target.closest('[data-dialog]');
      if (!target) {
        if (event.target === dialog) finish(false);
        return;
      }
      finish(target.dataset.dialog === 'ok');
    };
    const onKey = (event) => {
      if (event.key === 'Escape') finish(false);
      if (event.key === 'Enter') finish(true);
    };

    closeDialog = () => finish(false);
    dialog.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    ok.focus({ preventScroll: true });
  });
}

export function dismissDialog() {
  if (typeof closeDialog === 'function') closeDialog();
}

/* ------------------------------------------------------------------ */
/* misc                                                                */
/* ------------------------------------------------------------------ */

export function setBusy(button, busy, busyLabel = '처리 중…') {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    if (button.dataset.label) button.textContent = button.dataset.label;
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

export function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  return Promise.resolve(false);
}

/** Inline icon set (kept here so templates stay readable). */
export const icons = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 10.5 12 3.8l8.5 6.7"/><path d="M5.6 9.6V20h12.8V9.6"/><path d="M9.7 20v-5.3h4.6V20"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12.5 9.6 17.6 19.5 6.8"/></svg>',
  camera:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5h3l1.4-2.2h8.2L17.5 8.5h3v10.2h-17z"/><circle cx="12" cy="13.4" r="3.4"/></svg>',
  clipboard:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4.5" width="14" height="16" rx="2.4"/><path d="M9 4.5V3.4h6v1.1"/><path d="M8.7 11h6.6M8.7 15h4.4"/></svg>',
  office:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.2" y="4.2" width="17.6" height="12.2" rx="1.8"/><path d="M8 20h8M12 16.6V20"/><path d="M7.4 12.6h5.2M7.4 9.4h3"/></svg>',
  clinic:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.6" y="3.6" width="16.8" height="16.8" rx="4.2"/><path d="M12 7.8v8.4M7.8 12h8.4"/></svg>',
  retail:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.4h16l-1 10.4H5z"/><path d="M4 9.4 6.2 4.4h11.6L20 9.4"/><path d="M9.4 13.2h5.2"/></svg>',
  fitness:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.4v5.2M7 7.6v8.8M17 7.6v8.8M20 9.4v5.2M7 12h10"/></svg>',
  phone:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.2 3.8h3l1.5 3.6-1.9 1.4a11.6 11.6 0 0 0 5.4 5.4l1.4-1.9 3.6 1.5v3a2 2 0 0 1-2.2 2A16.4 16.4 0 0 1 4.2 6a2 2 0 0 1 2-2.2Z"/></svg>',
  sparkle:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M18.4 16.4l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z"/></svg>',
};
