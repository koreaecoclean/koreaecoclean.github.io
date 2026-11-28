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
import { DEMO_ACCOUNTS } from './seed.js';
import { emailForPhone } from './supabase-client.js';

export const SESSION_KEY = 'session';

/** 서버 로그인(Supabase Auth)이 켜져 있으면 그 세션을 돌려줍니다. */
function syncAuth() {
  return store.remote && store.auth ? store.auth : null;
}

/**
 * 전화번호 + 비밀번호로 서버 세션(JWT)을 받습니다. (v2.16.0)
 * 화면은 그대로 전화번호를 받고, 서버에는 이메일 규칙으로 바꿔 보냅니다.
 */
async function signInWithPasswordServer(phone, password) {
  const auth = syncAuth();
  if (!auth) return null;
  const email = emailForPhone(phone);
  const known = await store.findAccountByPhone(phone).catch(() => null);
  try {
    return await auth.signIn(email, password);
  } catch (error) {
    if (error && error.status === 400) {
      if (known) throw new AuthError('bad-password', '비밀번호가 일치하지 않습니다.');
      throw new AuthError('no-account', '등록된 계정을 찾지 못했습니다. 대표에게 문의해 주세요.');
    }
    throw new AuthError('auth-failed', '서버 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  }
}

/** 고객 방 · 초대 입장용 익명 세션 (비밀번호 없이 1회용 코드로만). */
async function ensureAnonymousSession() {
  const auth = syncAuth();
  if (!auth) return null;
  if (auth.hasSession() && auth.isAnonymous()) return auth;
  if (auth.hasSession()) await auth.signOut();
  await auth.signInAnonymously();
  return auth;
}

/** 서버 RPC 입장 — 검증된 1건만 돌려받아 기기에 적고 세션을 시작합니다. */
async function enterRoomThroughServer({ phone, code = '', name = '', title = '', email = '' }) {
  const auth = await ensureAnonymousSession();
  if (!auth) return null;
  let result = null;
  try {
    result = await store.remote.client.rpc('kec_room_entry', {
      p_phone: phone,
      p_code: code || '',
      p_name: name || '',
      p_title: title || '',
      p_email: email || '',
    });
  } catch (error) {
    throw new AuthError('room-entry', (error && error.message) || '입장에 실패했습니다.');
  }
  if (!result || !result.account) {
    throw new AuthError('room-entry', '입장 정보를 받지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  await store.applyServerEntry(result);
  await store.syncAfterLogin();
  const account = (await store.getAccount(result.account.id)) || result.account;
  return startSession(account);
}

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
    email: account.email || '',
    siteId: account.siteId || null,
    quoteId: account.quoteId || '',
    assignedSiteIds: (account.assignedSiteIds || []).slice(),
    staffAccess: !!account.staffAccess,
    canManageStaff: !!account.canManageStaff,
    staffRole: account.staffRole || (account.canManageStaff ? 'manager' : 'leader'),
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
    email: account.email || stored.email || '',
    siteId: account.siteId || stored.siteId || null,
    quoteId: account.quoteId || '',
    assignedSiteIds: (account.assignedSiteIds || []).slice(),
    staffAccess: !!account.staffAccess,
    canManageStaff: !!account.canManageStaff,
    staffRole: account.staffRole || (account.canManageStaff ? 'manager' : 'leader'),
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
  const auth = syncAuth();
  if (auth && auth.hasSession()) {
    try {
      await auth.signOut();
    } catch (error) {
      /* 서버 세션이 이미 끝났어도 기기 세션은 지웠습니다. */
    }
  }
  if (store.remote) store.remote.logout();
  store.syncStatus = store.remote ? 'login' : 'local';
  emitSessionChanged();
}

/**
 * 앱을 열 때 — 기기에 남은 로그인을 서버 세션과 맞춥니다. (v2.16.0)
 *  · 서버 세션이 있으면 그대로 이어서 동기화
 *  · 예전 버전에서 로그인해 둔 기기는 한 번만 비밀번호로 조용히 옮겨 탑니다
 *  · 옮길 수 없으면 로그인 화면으로 돌려보냅니다(비밀번호 입력은 그대로)
 */
export async function prepareAuth() {
  const auth = syncAuth();
  if (!auth) return getSession();
  if (auth.hasSession()) {
    await store.syncAfterLogin();
    return getSession();
  }
  const stored = await store.getSetting(SESSION_KEY, null);
  if (!stored || !stored.accountId) return null;
  const account = await store.getAccount(stored.accountId).catch(() => null);
  const password = account && String(account.password || '').trim();
  const phone = account && normalizePhone(account.phone);
  if (password && phone) {
    try {
      await auth.signIn(emailForPhone(phone), password);
      await store.syncAfterLogin();
      // 기기에 남아 있던 평문 비밀번호는 지웁니다(서버가 이미 지운 값입니다).
      const clean = { ...account };
      delete clean.password;
      await (store.rawAdapter || store.adapter).put('accounts', clean);
      return getSession();
    } catch (error) {
      console.warn('[auth] 기존 로그인을 서버 세션으로 옮기지 못했습니다', error);
    }
  }
  await logout();
  return null;
}

/* ------------------------------------------------------------------ */
/* logins                                                              */
/* ------------------------------------------------------------------ */

export async function loginCustomer({ phone, code = '', name = '', title = '', email = '' }) {
  const digits = normalizePhone(phone);
  if (!digits) throw new AuthError('phone-empty', '전화번호를 입력해 주세요.');

  // v2.16.0 — 서버 모드에서는 테이블 대신 서버 함수가 코드를 검증해 1건만 돌려줍니다.
  if (syncAuth()) {
    return enterRoomThroughServer({ phone: digits, code: String(code || '').trim(), name, title, email });
  }

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
      const entered = await store.enterQuoteRoomWithCode({ phone: digits, code, name, title, email });
      return startSession(entered.account);
    }
    const entered = await store.enterCustomerRoomWithCode({ phone: digits, code, name, title, email });
    return startSession(entered.account);
  }

  if (!normalizeCode(code)) {
    throw new AuthError(
      'code-required',
      '처음 이용하시는 번호입니다. 대표가 보낸 1회용 코드를 함께 입력해 주세요.',
    );
  }
  if (await store.findQuoteByInviteCode(code)) {
    const entered = await store.enterQuoteRoomWithCode({ phone: digits, code, name, title, email });
    return startSession(entered.account);
  }
  const entered = await store.enterCustomerRoomWithCode({ phone: digits, code, name, title, email });
  return startSession(entered.account);
}

export async function loginStaff({ phone, password, leaderCode }) {
  const digits = normalizePhone(phone);
  if (!digits) throw new AuthError('phone-empty', '전화번호를 입력해 주세요.');
  if (!String(password || '').trim()) throw new AuthError('password-empty', '비밀번호를 입력해 주세요.');
  if (!normalizeCode(leaderCode)) throw new AuthError('code-empty', '팀장 고유코드를 입력해 주세요.');

  // v2.16.0 — 전화번호 + 비밀번호 그대로 서버(Supabase Auth) 로그인
  if (syncAuth()) {
    await signInWithPasswordServer(digits, String(password).trim());
    await store.syncAfterLogin();
    const account = await store.findAccountByPhone(digits);
    if (!account || account.role === 'customer') {
      await syncAuth().signOut();
      throw new AuthError('no-account', '등록된 팀장 계정이 아닙니다.');
    }
    await requireActive(account);
    if (!account.leaderCode || normalizeCode(account.leaderCode) !== normalizeCode(leaderCode)) {
      throw new AuthError('bad-leader-code', '팀장 고유코드가 일치하지 않습니다. 대표에게 재발급을 요청해 주세요.');
    }
    return startSession(account);
  }

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

  // v2.16.0 — 전화번호 + 비밀번호 그대로 서버(Supabase Auth) 로그인
  if (syncAuth()) {
    await signInWithPasswordServer(digits, String(password || '').trim());
    await store.syncAfterLogin();
    const account = await store.findAccountByPhone(digits);
    const isCeo = account && account.role === 'admin';
    const isManager = account && account.role === 'leader' && account.canManageStaff;
    if (!isCeo && !isManager) {
      await syncAuth().signOut();
      throw new AuthError('no-account', '대표(최고관리자) 또는 본부장(관리자) 계정이 아닙니다.');
    }
    await requireActive(account);
    if (isManager) {
      if (!normalizeCode(leaderCode)) {
        throw new AuthError('code-empty', '본부장은 팀장 고유코드도 함께 입력해야 합니다.');
      }
      if (!account.leaderCode || normalizeCode(account.leaderCode) !== normalizeCode(leaderCode)) {
        throw new AuthError('bad-leader-code', '팀장 고유코드가 일치하지 않습니다. 대표에게 재발급을 요청해 주세요.');
      }
    }
    return startSession(account);
  }

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

  // v2.16.0 — 1회용 직원 초대코드도 서버 함수가 검증합니다.
  if (syncAuth()) {
    return enterRoomThroughServer({ phone: digits, code: String(code || '').trim() });
  }

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

/*
 * v2.8.2 — 다른 직원의 이름·전화번호·초대코드를 나열하는 데모 목록은 없앴습니다.
 *  초대코드는 대표가 직원에게 직접 전달합니다.
 */

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
