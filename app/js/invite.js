/**
 * invite.js — 모두싸인형 원클릭 서명/입장 링크 (v2.5.0)
 *
 *   https://koreaecoclean.github.io/app/#invite=S-H3K9P2
 *
 * 링크를 받은 사람이 자기 휴대폰에서 열면 초대코드가 이미 입력된 입장 화면이
 * 바로 뜹니다. 코드 앞자리로 어느 화면을 열지 정합니다.
 *   S-…  직원 · 도급처 계약서 서명 → [현장 보고] 탭의 직원관리방 입장
 *   Q-…  고객 견적서 · 계약서 서명 → [청소 확인] 탭의 고객 방 입장
 *   C-…  정기청소 현장 1회용 코드  → [청소 확인] 탭의 고객 방 입장
 */

import { APP_URL } from './seed.js';

/** 초대 링크 주소 — 예: https://koreaecoclean.github.io/app/#invite=Q-7K4M2P */
export function inviteUrl(code) {
  const value = String(code || '').trim().toUpperCase();
  if (!value) return APP_URL;
  return `${APP_URL}#invite=${encodeURIComponent(value)}`;
}

/** '#invite=S-1234' 또는 전체 주소에서 코드만 뽑습니다. */
export function inviteCodeFromHash(hash) {
  const text = String(hash === undefined || hash === null ? (typeof location !== 'undefined' ? location.hash : '') : hash);
  if (!text) return '';
  const match = /[#&]invite=([^&]+)/i.exec(text);
  if (!match) return '';
  let code = match[1];
  try {
    code = decodeURIComponent(code);
  } catch (error) {
    /* 그대로 사용 */
  }
  return code.trim().toUpperCase();
}

/** S- → 직원(도급처) 계약, Q- → 견적·고객 계약, C- → 정기청소 현장. */
export function inviteKind(code) {
  const value = String(code || '').trim().toUpperCase();
  if (value.startsWith('S-')) return 'staff';
  if (value.startsWith('Q-')) return 'quote';
  if (value.startsWith('C-')) return 'site';
  return 'any';
}

/** 이 코드의 입장 화면이 있는 탭. */
export function inviteTab(code) {
  return inviteKind(code) === 'staff' ? 'leader' : 'customer';
}

/** 화면에 보여 줄 한 줄 설명. */
export function inviteLabel(code) {
  const kind = inviteKind(code);
  if (kind === 'staff') return '도급처 · 직원 계약서 서명';
  if (kind === 'quote') return '고객 견적서 · 계약서 서명';
  if (kind === 'site') return '정기청소 현장 입장';
  return '초대코드 입장';
}

/* ------------------------------------------------------------------ */
/* 링크를 열고 들어온 코드를 화면이 소비할 때까지 보관                  */
/* ------------------------------------------------------------------ */

let pendingInvite = '';

export function setPendingInvite(code) {
  pendingInvite = String(code || '').trim().toUpperCase();
  return pendingInvite;
}

export function peekPendingInvite() {
  return pendingInvite;
}

export function clearPendingInvite() {
  pendingInvite = '';
}

/**
 * 주소의 #invite=코드를 읽어 보관하고, 주소창은 탭 주소(#customer 등)로
 * 정리할 수 있게 코드를 돌려줍니다. 앱 시작 때 한 번 부릅니다.
 */
export function consumeInviteHash(hash) {
  const code = inviteCodeFromHash(hash);
  if (code) setPendingInvite(code);
  return code;
}

/* ------------------------------------------------------------------ */
/* 고객사 초대 문구 · 문자/메일 공유 링크 (3단계 기획서 5장)              */
/* ------------------------------------------------------------------ */

/** 견적 · 계약 초대 문구 — 문자·카톡에 그대로 붙여넣는 글. */
export function quoteInviteMessage(quote) {
  const row = quote || {};
  return [
    `[코리아 에코크린] ${row.clientCompany || '고객사'} 담당자님, 정기청소 견적서가 도착했습니다.`,
    '아래 링크를 누르면 초대코드가 입력된 화면이 열립니다. 견적서와 계약서를 확인하고 바로 전자서명하실 수 있습니다.',
    `링크: ${inviteUrl(row.inviteCode)}`,
    `1회용 코드: ${row.inviteCode || ''}`,
    '문의: 0507-1317-8369',
  ].join('\n');
}

/** 초대 링크만 보낼 때의 한 줄. */
export function quoteInviteLinkLine(quote) {
  return inviteUrl(quote && quote.inviteCode);
}

/** 관리 화면이 쓰는 같은 문구 (이름만 다릅니다). */
export function buildQuoteInviteMessage(quote) {
  return quoteInviteMessage(quote);
}

/** 문자 앱 공유 링크 (휴대폰 번호가 없으면 주소만 채웁니다). */
export function quoteSmsHref(quote) {
  const phone = String((quote && quote.clientPhone) || '').replace(/[^0-9+]/g, '');
  return `sms:${phone}?body=${encodeURIComponent(quoteInviteMessage(quote))}`;
}

/** 메일 앱 공유 링크 — 받는 사람은 세금계산서 이메일 → 담당자 이메일 순서. */
export function quoteMailtoHref(quote) {
  const row = quote || {};
  const to = row.clientEmail || row.clientTaxEmail || '';
  const subject = `[코리아 에코크린] ${row.clientCompany || '고객사'} 정기청소 견적서`;
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(quoteInviteMessage(row))}`;
}
