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

import { store, normalizeCode, normalizePhone } from './store.js';
import { DEMO_ACCOUNTS } from './seed.js';

export const SESSION_KEY = 'session';

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
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
    assignedSiteIds: (account.assignedSiteIds || []).slice(),
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
  emitSessionChanged();
}

/* ------------------------------------------------------------------ */
/* logins                                                              */
/* ------------------------------------------------------------------ */

export async function loginCustomer({ phone, password }) {
  const digits = normalizePhone(phone);
  if (!digits) throw new AuthError('phone-empty', '전화번호를 입력해 주세요.');
  if (!password) throw new AuthError('password-empty', '비밀번호를 입력해 주세요.');

  const account = await store.findAccountByPhone(digits, 'customer');
  if (!account) throw new AuthError('no-account', '등록된 전화번호가 아닙니다. 담당자에게 문의해 주세요.');
  await requireActive(account, 'customer');
  if (!verifyPassword(account, password)) {
    throw new AuthError('bad-password', '비밀번호가 일치하지 않습니다.');
  }
  return startSession(account);
}

export async function loginStaff({ phone, password, leaderCode }) {
  const digits = normalizePhone(phone);
  if (!digits) throw new AuthError('phone-empty', '전화번호를 입력해 주세요.');
  if (!password) throw new AuthError('password-empty', '비밀번호를 입력해 주세요.');
  if (!normalizeCode(leaderCode)) throw new AuthError('code-empty', '팀장 고유코드를 입력해 주세요.');

  const account = await store.findAccountByPhone(digits);
  if (!account || account.role === 'customer') {
    throw new AuthError('no-account', '등록된 팀장 계정이 아닙니다.');
  }
  await requireActive(account);
  if (!verifyPassword(account, password)) {
    throw new AuthError('bad-password', '비밀번호가 일치하지 않습니다.');
  }
  if (!account.leaderCode || normalizeCode(account.leaderCode) !== normalizeCode(leaderCode)) {
    throw new AuthError('bad-leader-code', '팀장 고유코드가 일치하지 않습니다. 대표에게 재발급을 요청해 주세요.');
  }
  return startSession(account);
}

export async function loginAdmin({ phone, password }) {
  const digits = normalizePhone(phone);
  if (!digits) throw new AuthError('phone-empty', '전화번호를 입력해 주세요.');
  const account = await store.findAccountByPhone(digits);
  if (!account || account.role !== 'admin') {
    throw new AuthError('no-account', '대표(관리자) 계정이 아닙니다.');
  }
  await requireActive(account, 'admin');
  if (!verifyPassword(account, password)) {
    throw new AuthError('bad-password', '비밀번호가 일치하지 않습니다.');
  }
  return startSession(account);
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
  return DEMO_ACCOUNTS.map((account) => ({
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
