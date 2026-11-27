/**
 * auth.js — demo-level accounts, sessions and room access.
 *
 * Roles
 *  - customer : 전화번호 + 비밀번호 → 1회용 청소코드 인증 → 자기 현장 방 입장
 *  - leader   : 전화번호 + 비밀번호 + 팀장 고유코드 → 담당 현장 보고
 *  - admin    : 전화번호 + 비밀번호 (대표/최고관리자) → 코드 발급·관리
 *
 * ⚠️ 이 파일은 데모용입니다. 비밀번호는 기기 안에만 저장되고 서버로 나가지
 * 않습니다. 실제 운영에서는 Supabase Auth(이메일/카카오/전화 OTP)로 바꾸고
 * 역할(role)을 서버에서 검증하세요. README 7장 참고.
 */

import { store, normalizeCode, normalizePhone, prettyPhone } from './store.js';
import { DEMO_ACCOUNTS, STAFF_TYPES } from './seed.js';

export const SESSION_KEY = 'session';

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

/**
 * 화면 모드 — 최고관리자(대표)만 씁니다.
 *  · 'admin' : 관리자 모드 (관리 화면 · 팀장별 관리업장)
 *  · 'staff' : 직원 모드 (팀장처럼 현장을 골라 보고서를 씀)
 * 이 기기에만 저장하고 서버로는 올리지 않습니다.
 */
export const WORK_MODE_KEY = 'kec.workMode';

export function getWorkMode() {
  try {
    return window.localStorage.getItem(WORK_MODE_KEY) === 'staff' ? 'staff' : 'admin';
  } catch (error) {
    return 'admin';
  }
}

export function setWorkMode(mode) {
  const value = mode === 'staff' ? 'staff' : 'admin';
  try {
    window.localStorage.setItem(WORK_MODE_KEY, value);
  } catch (error) {
    /* 저장할 수 없으면 이번 화면에서만 바뀝니다. */
  }
  if (typeof document !== 'undefined' && document.dispatchEvent) {
    document.dispatchEvent(new CustomEvent('kec:work-mode-changed', { detail: { mode: value } }));
  }
  return value;
}

function emitSessionChanged() {
  if (typeof document !== 'undefined' && document.dispatchEvent) {
    document.dispatchEvent(new CustomEvent('kec:session-changed'));
  }
}

/** Demo-only password comparison — replace with Supabase Auth in production. */
function verifyPassword(account, password) {
  return !!account && String(account.password || '') === String(password || '');
}

function publicSession(account) {
  return {
    accountId: account.id,
    role: account.role,
    name: account.name,
    title: account.title || '',
    phone: account.phonePretty || account.phone,
    siteId: account.siteId || null,
    quoteId: account.quoteId || '',
    assignedSiteIds: (account.assignedSiteIds || []).slice(),
    loggedInAt: new Date().toISOString(),
  };
}

async function requireActive(account, role) {
  if (!account) throw new AuthError('no-account', '등록된 계정을 찾지 못했습니다.');
  if (role && account.role !== role) {
    throw new AuthError('wrong-role', '이 화면에서 사용할 수 없는 계정입니다.');
  }
  if (account.active === false) {
    throw new AuthError('inactive', '사용이 중지된 계정입니다. 관리자에게 문의해 주세요.');
  }
  return account;
}

/* ------------------------------------------------------------------ */
/* session                                                             */
/* ------------------------------------------------------------------ */

export async function getSession() {
  const stored = await store.getSetting(SESSION_KEY, null);
  if (!stored || !stored.accountId) return null;
  const account = await store.getAccount(stored.accountId);
  if (!account || account.active === false) return null;
  return {
    ...stored,
    role: account.role,
    name: account.name,
    title: account.title || '',
    phone: account.phonePretty || account.phone,
    siteId: account.siteId || stored.siteId || null,
    quoteId: account.quoteId || '',
    assignedSiteIds: (account.assignedSiteIds || []).slice(),
    staffAccess: !!account.staffAccess,
    account,
  };
}

async function startSession(account) {
  const session = publicSession(account);
  await store.setSetting(SESSION_KEY, session);
  emitSessionChanged();
  return session;
}

export async function logout() {
  await store.removeSetting(SESSION_KEY);
  setWorkMode('admin');
  emitSessionChanged();
}

/* ------------------------------------------------------------------ */
/* logins                                                              */
/* ------------------------------------------------------------------ */

export async function loginCustomer({ phone, code = '', name = '', title = '' }) {
  const digits = normalizePhone(phone);
  if (!digits) throw new AuthError('phone-empty', '전화번호를 입력해 주세요.');

  const account = await store.findAccountByPhone(digits);
  if (account && account.role !== 'customer') {
    throw new AuthError('staff-phone', '팀장·대표 번호로는 고객 방에 입장할 수 없습니다. 담당자에게 문의해 주세요.');
  }
  if (account) {
    await requireActive(account, 'customer');
    // Already registered with room access → the phone number alone opens the room.
    if (account.siteId && (await store.getGrant(account.id, account.siteId))) {
      return startSession(account);
    }
    // Invited to a quote room → the phone number alone opens the quote room.
    if (account.quoteId && (await store.getQuote(account.quoteId))) {
      return startSession(account);
    }
    if (!normalizeCode(code)) {
      throw new AuthError(
        'code-required',
        '아직 방 입장 전인 번호입니다. 대표가 보낸 1회용 코드를 함께 입력해 주세요.',
      );
    }
    if (await store.findQuoteByInviteCode(code)) {
      const entered = await store.enterQuoteRoomWithCode({ phone: digits, code, name, title });
      return startSession(entered.account);
    }
    const entered = await store.enterCustomerRoomWithCode({ phone: digits, code, name, title });
    return startSession(entered.account);
  }

  if (!normalizeCode(code)) {
    throw new AuthError(
      'code-required',
      '처음 이용하시는 번호입니다. 대표가 보낸 1회용 코드를 함께 입력해 주세요.',
    );
  }
  if (await store.findQuoteByInviteCode(code)) {
    const entered = await store.enterQuoteRoomWithCode({ phone: digits, code, name, title });
    return startSession(entered.account);
  }
  const entered = await store.enterCustomerRoomWithCode({ phone: digits, code, name, title });
  return startSession(entered.account);
}

export async function loginStaff({ phone, password, leaderCode }) {
  const digits = normalizePhone(phone);
  if (!digits) throw new AuthError('phone-empty', '전화번호를 입력해 주세요.');
  if (!String(password || '').trim()) throw new AuthError('password-empty', '비밀번호를 입력해 주세요.');
  if (!normalizeCode(leaderCode)) throw new AuthError('code-empty', '팀장 고유코드를 입력해 주세요.');

  const account = await store.findAccountByPhone(digits);
  if (!account || account.role === 'customer') {
    throw new AuthError('no-account', '등록된 팀장 계정이 아닙니다.');
  }
  await requireActive(account);
  if (!verifyPassword(account, String(password).trim())) {
    throw new AuthError('bad-password', '비밀번호가 일치하지 않습니다.');
  }
  if (!account.leaderCode || normalizeCode(account.leaderCode) !== normalizeCode(leaderCode)) {
    throw new AuthError('bad-leader-code', '팀장 고유코드가 일치하지 않습니다. 대표에게 재발급을 요청해 주세요.');
  }
  return startSession(account);
}

export async function loginAdmin({ phone, password, leaderCode = '' }) {
  const digits = normalizePhone(phone);
  if (!digits) throw new AuthError('phone-empty', '전화번호를 입력해 주세요.');
  const account = await store.findAccountByPhone(digits);
  const isCeo = account && account.role === 'admin';
  const isManager = account && account.role === 'leader' && account.canManageStaff;
  if (!isCeo && !isManager) {
    throw new AuthError('no-account', '대표(최고관리자) 또는 본부장(관리자) 계정이 아닙니다.');
  }
  await requireActive(account);
  if (!verifyPassword(account, String(password || '').trim())) {
    throw new AuthError('bad-password', '비밀번호가 일치하지 않습니다.');
  }
  if (isManager) {
    if (!normalizeCode(leaderCode)) {
      throw new AuthError('code-empty', '본부장은 팀장 고유코드도 함께 입력해야 합니다.');
    }
    if (!account.leaderCode || normalizeCode(account.leaderCode) !== normalizeCode(leaderCode)) {
      throw new AuthError('bad-leader-code', '팀장 고유코드가 일치하지 않습니다.');
    }
  }
  return startSession(account);
}

/**
 * 직원관리방 입장 — 처음에는 1회용 직원 초대코드와 함께, 코드를 쓴 뒤에는
 * 등록된 전화번호만으로 들어옵니다(고객 방과 같은 방식).
 */
export async function loginStaffInvite({ phone, code = '' }) {
  const digits = normalizePhone(phone);
  if (!digits) throw new AuthError('phone-empty', '전화번호를 입력해 주세요.');

  if (!normalizeCode(code)) {
    const account = await store.findAccountByPhone(digits);
    if (account && account.role !== 'customer' && account.staffAccess) {
      await requireActive(account);
      return startSession(account);
    }
    throw new AuthError('staff-code-required', '처음 입장은 대표가 보낸 1회용 직원 초대코드가 필요합니다.');
  }

  const entered = await store.enterStaffRoomWithCode({ phone: digits, code });
  return startSession(entered.account);
}

/* ------------------------------------------------------------------ */
/* customer room access                                                */
/* ------------------------------------------------------------------ */

export async function hasRoomAccess(session) {
  if (!session || session.role !== 'customer' || !session.siteId) return false;
  const grant = await store.getGrant(session.accountId, session.siteId);
  return !!grant;
}

/** Redeem the one-time cleaning code issued by the admin for this room. */
export async function redeemRoomCode(session, code) {
  if (!session || session.role !== 'customer') {
    throw new AuthError('no-session', '고객 로그인이 필요합니다.');
  }
  const account = await store.getAccount(session.accountId);
  return store.redeemRoomCode(code, account);
}

/* ------------------------------------------------------------------ */
/* demo helpers                                                        */
/* ------------------------------------------------------------------ */

/** Demo credentials shown in the app's "데모 계정" panel. */
export function demoAccounts() {
  return DEMO_ACCOUNTS.filter((account) => !account.demoHidden).map((account) => ({
    role: account.role,
    roleLabel: account.role === 'customer' ? '고객' : account.role === 'leader' ? '팀장' : '대표(관리자)',
    name: account.name,
    title: account.title,
    phone: account.phonePretty,
    password: account.password,
    leaderCode: account.leaderCode || '',
    siteId: account.siteId || '',
  }));
}

/** Customers already registered on this device (phone number alone opens the room). */
export async function demoRegisteredCustomers() {
  const accounts = await store.listAccounts({ role: 'customer' });
  const sites = await store.listSites();
  const siteById = new Map(sites.map((site) => [site.id, site]));
  return accounts.map((account) => {
    const site = siteById.get(account.siteId) || null;
    return {
      name: account.name,
      title: account.title || '',
      phone: account.phonePretty || prettyPhone(account.phone),
      siteId: account.siteId || '',
      siteName: site ? site.name : '',
      siteCode: site ? site.code : '',
    };
  });
}

/** 미사용 직원 초대코드 (직원관리방 입장 테스트용). */
export async function demoStaffCodes() {
  const contracts = await store.listStaffContracts();
  // 실제 직원(공개 데모 목록에서 빠진 계정)의 초대코드는 공개 목록에 올리지 않습니다.
  const hiddenAccountIds = new Set(DEMO_ACCOUNTS.filter((account) => account.demoHidden).map((account) => account.id));
  return contracts
    .filter((row) => !row.inviteUsedAt && row.status !== 'draft' && !hiddenAccountIds.has(row.accountId))
    .map((row) => ({
      name: row.name,
      phone: prettyPhone(row.phone),
      code: row.inviteCode,
      typeLabel: (STAFF_TYPES[row.employmentType] || {}).short || '직원',
    }));
}

/** Room codes seeded for the demo (shown next to each demo customer account). */
export async function demoRoomCodes() {
  const codes = await store.listRoomCodes();
  const sites = await store.listSites();
  const bySite = new Map();
  for (const code of codes) {
    if (code.usedAt) continue;
    if (!bySite.has(code.siteId)) bySite.set(code.siteId, []);
    bySite.get(code.siteId).push(code.code);
  }
  return sites.map((site) => ({
    siteId: site.id,
    siteName: site.name,
    siteCode: site.code,
    codes: bySite.get(site.id) || [],
  }));
}
