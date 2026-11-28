/**
 * supabase-client.js — 무료 Supabase 프로젝트와 앱 데이터를 잇는 계층 (v2.5.0)
 *
 *  · SupabaseClient : REST(ecoclean_items) + Storage(ecoclean-files) 호출
 *  · SupabaseSync   : 로컬(IndexedDB) 저장소와 서버를 잇는 다중 기기 동기화
 *
 * 동기화 방식
 *   1) 앱을 열 때 서버의 모든 레코드를 받아 옵니다(hydrate).
 *      - 서버가 비어 있으면 이 기기의 데이터를 그대로 올립니다(최초 1회 시드).
 *      - 서버에 데이터가 있으면 서버를 기준으로 기기 캐시를 맞춥니다.
 *   2) 모든 쓰기(저장·삭제)는 기기에 먼저 반영하고 곧바로 서버에 올립니다(upsert/delete).
 *   3) 5초마다 바뀐 레코드만 받아 옵니다(다른 기기의 서명·보고가 바로 반영).
 *      1분에 한 번은 전체를 비교해 다른 기기에서 지운 레코드도 정리합니다.
 *
 * collection 이름은 서버 테이블의 한 컬럼입니다(앱 안의 저장 이름 ↔ 서버 이름).
 *   sites · reports · inquiries · accounts · quotes · contracts · staffContracts
 *   · supplyCatalog · supplyOrders · meta
 *   roomCodes → inviteCodes, grants → leaderCodes, staffChecks → attitudeLogs
 *
 * 기기마다 달라야 하는 값(로그인 세션)은 서버로 올리지도 받지도 않습니다.
 * (그러지 않으면 한 폰에서 대표로 로그인한 세션이 모든 폰으로 복사됩니다.)
 *
 * ⚠️ 이 앱은 Supabase Auth 세션이 아니라 앱 자체 인증(전화번호 · 1회용 초대코드)을
 *    쓰므로 publishable(anon) 키로 통신합니다. 키는 공개되어도 되는 등급이지만,
 *    테이블 정책이 넓게 열려 있으니 운영 확장 시 Supabase Auth + 좁은 RLS 로
 *    옮기세요(supabase-schema.sql 주석 참고).
 */

/* ------------------------------------------------------------------ */
/* 설정                                                                */
/* ------------------------------------------------------------------ */

export const SUPABASE_URL = 'https://magwvjtnxlewumojlpwz.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_NlQSfz427AKLAqj67s6YVw_4u3FHa3H';

/** 공유 저장 테이블과 파일 버킷 이름. */
export const SUPABASE_TABLE = 'ecoclean_items';
/** 읽기 전용 마스킹 뷰 — 역할별로 금액·비밀번호가 지워진 데이터가 내려옵니다. */
export const SUPABASE_VIEW = 'ecoclean_items_read';
export const SUPABASE_BUCKET = 'ecoclean-files';

/** Supabase Auth 세션(이 기기에만) · 로그인 이메일 규칙 (v2.16.0) */
export const AUTH_STORAGE_KEY = 'kec:auth';
export const MEMBER_EMAIL_DOMAIN = 'members.koreaecoclean.app';

/** 전화번호 → 로그인 이메일. (앱 화면은 그대로 전화번호만 받습니다.) */
export function emailForPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits ? `${digits}@${MEMBER_EMAIL_DOMAIN}` : '';
}

/** 앱 저장 이름 → 서버 collection 이름. */
export const COLLECTION_OF = Object.freeze({
  sites: 'sites',
  reports: 'reports',
  inquiries: 'inquiries',
  accounts: 'accounts',
  roomCodes: 'inviteCodes',
  grants: 'leaderCodes',
  quotes: 'quotes',
  contracts: 'contracts',
  staffContracts: 'staffContracts',
  staffChecks: 'attitudeLogs',
  supplyCatalog: 'supplyCatalog',
  supplyOrders: 'supplyOrders',
  meta: 'meta',
});

/** 서버와 맞추는 앱 컬렉션 목록. (사진 원본은 Storage 에 올리고 기기에 캐시합니다.) */
export const SYNC_TABLES = Object.keys(COLLECTION_OF);

/**
 * 기기마다 달라야 하는 값 — 서버로 올리지도, 받지도 않습니다.
 * 로그인 세션이 서버를 타면 다른 폰이 대표 계정으로 열리므로 반드시 막습니다.
 */
export const DEVICE_LOCAL_KEYS = Object.freeze({ meta: ['session'] });

export function isDeviceLocal(table, key) {
  const list = DEVICE_LOCAL_KEYS[table];
  if (!list) return false;
  return list.includes(String(key));
}

const TABLE_OF_COLLECTION = Object.freeze(
  Object.entries(COLLECTION_OF).reduce((map, [table, collection]) => {
    map[collection] = table;
    return map;
  }, {}),
);

export function remoteCollection(table) {
  return COLLECTION_OF[table] || '';
}

export function localTable(collection) {
  return TABLE_OF_COLLECTION[collection] || '';
}

export function isSupabaseConfigured() {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL) && String(SUPABASE_KEY).length > 20;
}

/** 동기화를 끄는 스위치 — `?sync=off`, localStorage 'kec:sync' = 'off'. */
export function syncPreference() {
  try {
    if (typeof location !== 'undefined' && location.search) {
      const value = new URLSearchParams(location.search).get('sync');
      if (value === 'off' || value === 'on') return value;
    }
  } catch (error) {
    /* ignore */
  }
  try {
    const value = window.localStorage.getItem('kec:sync');
    if (value === 'off' || value === 'on') return value;
  } catch (error) {
    /* ignore */
  }
  return '';
}

/**
 * 이 화면에서 서버 동기화를 켤지 판단합니다.
 * 로컬 개발·자동 테스트(127.0.0.1 · localhost · file:)에서는 꺼 두어
 * 테스트가 운영 데이터베이스를 건드리지 않게 합니다.
 */
export function shouldSync() {
  if (!isSupabaseConfigured()) return false;
  const pref = syncPreference();
  if (pref === 'off') return false;
  if (pref === 'on') return true;
  if (typeof location === 'undefined') return false;
  if (location.protocol === 'file:') return false;
  const host = String(location.hostname || '');
  if (!host) return false;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)$/i.test(host)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export class SupabaseError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.name = 'SupabaseError';
    this.status = status;
    this.detail = detail || '';
  }
}

/* ------------------------------------------------------------------ */
/* Supabase Auth (v2.16.0)                                             */
/*   화면은 그대로 '전화번호 + 비밀번호'를 받고, 여기서 이메일 규칙으로     */
/*   바꿔 GoTrue 에 로그인합니다. 세션은 이 기기에만 저장합니다.           */
/* ------------------------------------------------------------------ */

export class SupabaseAuth {
  constructor({ url = SUPABASE_URL, key = SUPABASE_KEY } = {}) {
    this.url = String(url).replace(/\/+$/, '');
    this.key = key;
    this.session = null;
    this._signingIn = null;
    this._restore();
  }

  _restore() {
    try {
      const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : null;
      if (saved && saved.access_token) this.session = saved;
    } catch (error) {
      this.session = null;
    }
  }

  _save(session) {
    this.session = session;
    try {
      if (session) window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
      else window.localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch (error) {
      /* 저장할 수 없으면 이번 화면에서만 유지 */
    }
  }

  hasSession() {
    return !!(this.session && this.session.access_token);
  }

  isAnonymous() {
    return !!(this.session && this.session.is_anonymous);
  }

  email() {
    return (this.session && this.session.email) || '';
  }

  async _post(path, body, { token = '' } = {}) {
    const headers = { apikey: this.key, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${this.url}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
    });
    const text = await response.text().catch(() => '');
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (error) {
      payload = null;
    }
    if (!response.ok) {
      const message =
        (payload && (payload.msg || payload.error_description || payload.message || payload.error)) ||
        `로그인 실패 (${response.status})`;
      throw new SupabaseError(String(message), response.status, text.slice(0, 300));
    }
    return payload || {};
  }

  _adopt(payload) {
    const expiresIn = Number(payload.expires_in || 3600);
    const session = {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token || '',
      expires_at: Date.now() + Math.max(60, expiresIn - 120) * 1000,
      email: (payload.user && payload.user.email) || '',
      user_id: (payload.user && payload.user.id) || '',
      is_anonymous: !!(payload.user && payload.user.is_anonymous),
    };
    this._save(session);
    return session;
  }

  /** 이메일 + 비밀번호 로그인 (직원 · 대표) */
  async signIn(email, password) {
    const payload = await this._post('/auth/v1/token?grant_type=password', { email, password });
    return this._adopt(payload);
  }

  /** 익명 세션 — 고객 방 · 초대 입장용(비밀번호 없이 1회용 코드로 입장) */
  async signInAnonymously() {
    if (this._signingIn) return this._signingIn;
    this._signingIn = this._post('/auth/v1/signup', { data: {}, gotrue_meta_security: {} })
      .then((payload) => this._adopt(payload))
      .finally(() => {
        this._signingIn = null;
      });
    return this._signingIn;
  }

  async refresh() {
    if (!this.session || !this.session.refresh_token) return false;
    try {
      const payload = await this._post('/auth/v1/token?grant_type=refresh_token', {
        refresh_token: this.session.refresh_token,
      });
      this._adopt(payload);
      return true;
    } catch (error) {
      if (error && error.status === 400) this._save(null);
      return false;
    }
  }

  /** 지금 쓸 수 있는 access token (만료 임박이면 먼저 갱신) */
  async accessToken() {
    if (!this.session) return '';
    if (Date.now() > Number(this.session.expires_at || 0)) {
      const ok = await this.refresh();
      if (!ok) return '';
    }
    return this.session ? this.session.access_token : '';
  }

  async signOut() {
    const token = this.session && this.session.access_token;
    this._save(null);
    if (!token) return true;
    try {
      await this._post('/auth/v1/logout', {}, { token });
    } catch (error) {
      /* 서버 세션이 이미 끝났어도 이 기기 세션은 지웠습니다. */
    }
    return true;
  }
}

export function rowKey(value) {
  if (!value || typeof value !== 'object') return '';
  const key = value.id !== undefined && value.id !== null && value.id !== '' ? value.id : value.key;
  return key === undefined || key === null ? '' : String(key);
}

/** 'data:image/jpeg;base64,…' → Blob (실패하면 null). */
export function dataUrlToBlob(dataUrl) {
  const text = String(dataUrl || '');
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(text);
  if (!match) return null;
  const type = match[1] || 'application/octet-stream';
  try {
    if (match[2]) {
      const binary = atob(match[3]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type });
    }
    return new Blob([decodeURIComponent(match[3])], { type });
  } catch (error) {
    return null;
  }
}

function extensionFor(type) {
  if (/png/i.test(type)) return 'png';
  if (/webp/i.test(type)) return 'webp';
  if (/pdf/i.test(type)) return 'pdf';
  if (/jpe?g/i.test(type)) return 'jpg';
  return 'bin';
}

function randomTag() {
  return Math.random().toString(36).slice(2, 8);
}

function maxUpdatedAt(rows, fallback = '') {
  let latest = fallback;
  for (const row of rows) {
    const value = row && row.updated_at ? String(row.updated_at) : '';
    if (value && value > latest) latest = value;
  }
  return latest;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/* ------------------------------------------------------------------ */
/* REST · Storage 클라이언트                                            */
/* ------------------------------------------------------------------ */

export class SupabaseClient {
  constructor({
    url = SUPABASE_URL,
    key = SUPABASE_KEY,
    table = SUPABASE_TABLE,
    view = SUPABASE_VIEW,
    bucket = SUPABASE_BUCKET,
    timeout = 12000,
    auth = null,
  } = {}) {
    this.url = String(url).replace(/\/+$/, '');
    this.key = key;
    this.table = table;
    this.view = view;
    this.bucket = bucket;
    this.timeout = timeout;
    this.auth = auth;
  }

  setAuth(auth) {
    this.auth = auth;
    return this;
  }

  setToken(token) {
    this.token = String(token || '');
    return this;
  }

  /**
   * 서버에 보낼 헤더 — 로그인했으면 그 사람의 JWT, 아니면 publishable 키(anon).
   * anon 으로는 테이블을 하나도 읽지 못합니다(v2.16.0 RLS).
   */
  async headers(extra = {}) {
    let token = this.token;
    if (!token && this.auth) token = await this.auth.accessToken();
    return {
      apikey: this.key,
      Authorization: `Bearer ${token || this.key}`,
      ...extra,
    };
  }

  async request(path, options = {}, { retry = true } = {}) {
    if (typeof fetch !== 'function') {
      throw new SupabaseError('이 브라우저에서는 서버 동기화를 쓸 수 없습니다.', 0);
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeout) : null;
    try {
      const headers = await this.headers(options.headers || {});
      const response = await fetch(`${this.url}${path}`, {
        ...options,
        headers,
        signal: controller ? controller.signal : undefined,
      });
      // 세션이 만료되면 한 번만 갱신해 다시 보냅니다.
      if (response.status === 401 && retry && this.auth && this.auth.hasSession()) {
        const refreshed = await this.auth.refresh();
        if (refreshed) return this.request(path, options, { retry: false });
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        let message = `Supabase ${response.status}`;
        try {
          const parsed = JSON.parse(detail);
          if (parsed && parsed.message) message = String(parsed.message);
        } catch (error) {
          /* 본문이 JSON 이 아니면 기본 문구 */
        }
        throw new SupabaseError(message, response.status, detail.slice(0, 300));
      }
      return response;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** security definer 함수 호출 (1회용 코드 검증 · 상담 접수) */
  async rpc(name, params = {}) {
    const response = await this.request(`/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params || {}),
    });
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
  }

  /** 모든 레코드(또는 since 이후 바뀐 레코드)를 읽습니다. — 마스킹 뷰에서 읽습니다. */
  async listItems({ since = '' } = {}) {
    const params = new URLSearchParams({
      select: 'collection,id,data,updated_at',
      order: 'updated_at.asc',
    });
    if (since) params.set('updated_at', `gt.${since}`);
    const response = await this.request(`/rest/v1/${this.view}?${params.toString()}`);
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  }

  /** 여러 레코드를 한 번에 upsert 합니다. rows: [{collection, id, data}] */
  async upsertItems(rows) {
    const clean = (rows || []).filter((row) => row && row.collection && row.id !== undefined && row.id !== null);
    if (!clean.length) return 0;
    let saved = 0;
    for (const group of chunk(clean, 200)) {
      await this.request(`/rest/v1/${this.table}?on_conflict=collection,id`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(group),
      });
      saved += group.length;
    }
    return saved;
  }

  async deleteItem(collection, id) {
    const params = new URLSearchParams({ collection: `eq.${collection}`, id: `eq.${id}` });
    await this.request(`/rest/v1/${this.table}?${params.toString()}`, { method: 'DELETE' });
  }

  async clearCollection(collection) {
    const params = new URLSearchParams({ collection: `eq.${collection}` });
    await this.request(`/rest/v1/${this.table}?${params.toString()}`, { method: 'DELETE' });
  }

  /**
   * dataURL 을 Storage(ecoclean-files)에 올리고 공개 주소를 돌려줍니다.
   * 실패하면 빈 문자열 — 호출한 쪽이 기존 dataURL 을 그대로 쓰면 됩니다.
   */
  async uploadDataUrl(dataUrl, { folder = 'files', name = '' } = {}) {
    const blob = dataUrlToBlob(dataUrl);
    if (!blob) return '';
    if (blob.size > 6 * 1024 * 1024) return '';
    const type = blob.type || 'application/octet-stream';
    const path = `${folder}/${Date.now().toString(36)}-${randomTag()}-${name || `file.${extensionFor(type)}`}`;
    await this.request(`/storage/v1/object/${this.bucket}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': type,
        // 경로가 매번 고유하므로 upsert(x-upsert)는 쓰지 않습니다.
        // x-upsert 는 기존 객체 조회(SELECT 권한)를 요구해, 목록 조회를 막아 둔 버킷에서 403 이 납니다.
        'cache-control': '31536000',
      },
      body: blob,
    });
    return `${this.url}/storage/v1/object/public/${this.bucket}/${path}`;
  }

  /** 연결 확인 — 성공하면 true. */
  async ping() {
    const response = await this.request(`/rest/v1/${this.table}?select=collection&limit=1`);
    return response.ok;
  }
}

/* ------------------------------------------------------------------ */
/* 동기화 계층                                                          */
/* ------------------------------------------------------------------ */

export const SYNC_STATUS = {
  idle: { label: '대기', tone: 'wait' },
  syncing: { label: '동기화 중', tone: 'wait' },
  synced: { label: '서버 연결됨', tone: 'done' },
  offline: { label: '오프라인 · 기기 저장', tone: 'warn' },
  error: { label: '동기화 지연', tone: 'warn' },
  login: { label: '로그인 필요', tone: 'wait' },
  local: { label: '기기 저장', tone: 'wait' },
};

export class SupabaseSync {
  constructor({ client = new SupabaseClient(), interval = 5000, fullEvery = 12 } = {}) {
    this.client = client;
    this.auth = client.auth || null;
    this.interval = interval;
    this.fullEvery = fullEvery;
    this.local = null;
    this.store = null;
    this.queue = [];
    this.remoteTs = '';
    this.status = 'idle';
    this.message = '';
    this.timer = null;
    this.ticks = 0;
    this.flushing = false;
    this.lastFlushAt = 0;
    this._listeners = new Set();
    this._writes = 0;
    this._handleVisibility = null;
    this._handleOnline = null;
  }

  /** 로그인(JWT)이 있어야 서버를 읽고 쓸 수 있습니다. */
  get authorized() {
    return !!(this.auth && this.auth.hasSession());
  }

  onStatus(listener) {
    this._listeners.add(listener);
    try {
      listener({ status: this.status, message: this.message });
    } catch (error) {
      console.warn('[sync] listener failed', error);
    }
    return () => this._listeners.delete(listener);
  }

  setStatus(status, message = '') {
    const changed = this.status !== status || this.message !== message;
    this.status = status;
    this.message = message;
    if (!changed) return;
    this._listeners.forEach((listener) => {
      try {
        listener({ status, message });
      } catch (error) {
        console.warn('[sync] listener failed', error);
      }
    });
  }

  /* ---------------- 시작 · hydrate ---------------- */

  /**
   * 서버를 기준으로 기기 캐시를 맞춥니다.
   *  · 서버가 비어 있으면 이 기기의 데이터를 올립니다(최초 1회).
   *  · 서버에 데이터가 있으면 서버 내용으로 기기 캐시를 갱신합니다.
   */
  async hydrate(adapter) {
    this.local = adapter;
    // 로그인 전에는 서버를 손대지 않습니다(기기 데이터를 지우지 않음).
    if (!this.authorized) {
      this.setStatus('login', '로그인하면 서버와 맞춥니다');
      this.remoteTs = '';
      return { mode: 'unauthenticated', rows: 0 };
    }
    this.setStatus('syncing', '서버 확인 중');
    let rows;
    try {
      rows = await this.client.listItems();
    } catch (error) {
      console.warn('[sync] 서버에 연결하지 못했습니다', error);
      this.setStatus('offline', '서버 연결 실패 · 기기 저장소로 동작');
      this.remoteTs = '';
      return { mode: 'offline', rows: 0 };
    }

    if (!rows.length) {
      const localRows = await this._readLocalRows();
      if (localRows.length) {
        try {
          await this._pushRows(localRows);
        } catch (error) {
          console.warn('[sync] 최초 업로드 실패', error);
          this.setStatus('error', '최초 업로드 실패 · 다시 시도합니다');
          return { mode: 'push-failed', rows: 0 };
        }
      }
      this.remoteTs = maxUpdatedAt(rows);
      this.setStatus('synced', localRows.length ? '서버 연결됨 · 최초 업로드 완료' : '서버 연결됨');
      return { mode: localRows.length ? 'seed-uploaded' : 'empty', rows: localRows.length };
    }

    const applied = await this._applyRemote(rows, { replaceTables: true });
    this.remoteTs = maxUpdatedAt(rows);
    this.setStatus('synced', '서버 연결됨');
    return { mode: 'pulled', rows: applied };
  }

  /**
   * 로그인 직후 — 그 사람의 범위로 서버 내용을 다시 받아 옵니다.
   * 로그아웃 상태에서 쌓인 서버 쓰기 대기열은 버립니다(권한 밖 쓰기 방지).
   */
  async resume(adapter) {
    if (!this.authorized) return { mode: 'unauthenticated', rows: 0 };
    // 로그인 전에는 queuePut 자체를 막아 두었으므로 대기열은 비우지 않습니다
    // (방금 만든 계정처럼 아직 못 올린 변경을 잃지 않도록).
    const target = adapter || this.local;
    const result = await this.hydrate(target);
    if (this.flush && this.queue.length) await this.flush().catch(() => false);
    if (this.store) this.start(this.store);
    return result;
  }

  /** 로그아웃 — 큐를 버리고 서버 읽기/쓰기를 멈춥니다. */
  logout() {
    this.stop();
    this.queue = [];
    this.remoteTs = '';
    this.setStatus('login', '로그인하면 서버와 맞춥니다');
  }

  async _readLocalRows() {
    const rows = [];
    for (const table of SYNC_TABLES) {
      const list = await this.local.getAll(table);
      for (const value of list || []) {
        const key = rowKey(value);
        if (!key || isDeviceLocal(table, key)) continue;
        rows.push({ table, key, value });
      }
    }
    return rows;
  }

  async _pushRows(rows) {
    const byCollection = new Map();
    for (const item of rows) {
      const collection = remoteCollection(item.table);
      if (!collection) continue;
      if (!byCollection.has(collection)) byCollection.set(collection, []);
      byCollection.get(collection).push({
        collection,
        id: String(item.key),
        data: item.value,
      });
    }
    for (const [, list] of byCollection) await this.client.upsertItems(list);
  }

  /**
   * 서버 레코드를 기기 캐시에 반영합니다.
   * replaceTables=true 이면 서버에 없는 레코드를 기기에서 지웁니다(최초 hydrate · 전체 재동기화).
   */
  async _applyRemote(rows, { replaceTables = false } = {}) {
    const remoteKeys = new Map();
    const stale = [];
    let applied = 0;
    for (const row of rows || []) {
      const table = localTable(row.collection);
      if (!table) continue;
      const key = rowKey(row.data) || String(row.id || '');
      if (!key) continue;
      // 기기 전용 값(로그인 세션)은 들여오지 않고 서버에서도 지웁니다.
      if (isDeviceLocal(table, key)) {
        stale.push({ collection: row.collection, id: key });
        continue;
      }
      if (!remoteKeys.has(table)) remoteKeys.set(table, new Set());
      remoteKeys.get(table).add(key);
      // 계정 레코드에는 평문 비밀번호를 절대 남기지 않습니다(서버도 지우지만 한 번 더).
      if (table === 'accounts' && row.data && Object.prototype.hasOwnProperty.call(row.data, 'password')) {
        const clean = { ...row.data };
        delete clean.password;
        if (JSON.stringify(clean) === JSON.stringify(row.data)) {
          /* 이미 없음 */
        } else {
          await this.local.put(table, clean);
          applied += 1;
          continue;
        }
      }
      if (this._pendingKeys().has(`${table}::${key}`)) continue;
      const current = await this.local.get(table, key);
      if (current && JSON.stringify(current) === JSON.stringify(row.data)) continue;
      await this.local.put(table, row.data);
      applied += 1;
    }
    if (replaceTables) {
      for (const table of SYNC_TABLES) {
        const keep = remoteKeys.get(table) || new Set();
        for (const value of (await this.local.getAll(table)) || []) {
          const key = rowKey(value);
          if (!key || keep.has(key)) continue;
          if (isDeviceLocal(table, key)) continue;
          if (this._pendingKeys().has(`${table}::${key}`)) continue;
          await this.local.remove(table, key);
        }
      }
    }
    for (const item of stale) {
      this.client.deleteItem(item.collection, item.id).catch(() => {});
    }
    return applied;
  }

  /* ---------------- 쓰기 미러링 ---------------- */

  /**
   * 로컬 어댑터를 감싸 모든 쓰기를 서버에도 반영하는 어댑터를 돌려줍니다.
   * Store 는 이 어댑터만 보므로 store.js 의 기존 코드는 그대로 동작합니다.
   */
  decorate(adapter) {
    this.local = adapter;
    const sync = this;
    return {
      name: adapter.name,
      init: () => adapter.init(),
      getAll: (table) => adapter.getAll(table),
      get: (table, key) => adapter.get(table, key),
      put: async (table, value) => {
        const out = await adapter.put(table, value);
        sync.queuePut(table, value);
        return out;
      },
      remove: async (table, key) => {
        const out = await adapter.remove(table, key);
        sync.queueDelete(table, key);
        return out;
      },
      clear: async (table) => {
        const out = await adapter.clear(table);
        sync.queueClear(table);
        return out;
      },
      close: () => adapter.close(),
    };
  }

  _lastOp() {
    return this.queue.length ? this.queue[this.queue.length - 1] : null;
  }

  queuePut(table, value) {
    if (!remoteCollection(table)) return;
    if (!this.authorized) return; // 로그인 전에는 서버로 보내지 않습니다.
    const key = rowKey(value);
    if (!key) return;
    if (isDeviceLocal(table, key)) return; // 로그인 세션 등 기기 전용 값
    const last = this._lastOp();
    if (last && last.type === 'put' && last.table === table) {
      last.rows.set(key, value);
    } else {
      this.queue.push({ type: 'put', table, rows: new Map([[key, value]]) });
    }
    this._writes += 1;
    this._schedule();
  }

  queueDelete(table, key) {
    if (!remoteCollection(table) || !key) return;
    if (!this.authorized) return;
    if (isDeviceLocal(table, key)) return;
    this.queue.push({ type: 'delete', table, key: String(key) });
    this._writes += 1;
    this._schedule();
  }

  queueClear(table) {
    if (!remoteCollection(table)) return;
    if (!this.authorized) return;
    this.queue.push({ type: 'clear', table });
    this._schedule();
  }

  /** 아직 서버에 못 올린 레코드 키 집합('<table>::<key>'). */
  _pendingKeys() {
    const keys = new Set();
    for (const op of this.queue) {
      if (op.type === 'put') {
        for (const key of op.rows.keys()) keys.add(`${op.table}::${key}`);
      } else if (op.type === 'delete') {
        keys.add(`${op.table}::${op.key}`);
      }
    }
    return keys;
  }

  _schedule() {
    if (this.flushing) return;
    if (this._flushTimer) return;
    if (typeof setTimeout !== 'function') return; // 타이머가 없는 환경(단위 테스트)에서는 즉시 전송 생략
    const wait = Math.max(0, 80 - (Date.now() - this.lastFlushAt));
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this.flush();
    }, wait);
  }

  /** 대기 중인 쓰기를 서버로 보냅니다. 실패하면 남은 작업을 되돌려 다시 시도합니다. */
  async flush() {
    if (this.flushing) return false;
    if (!this.authorized) return false;
    if (!this.queue.length) return true;
    this.flushing = true;
    this.setStatus('syncing', '변경 사항 저장 중');
    const ops = this.queue.slice();
    this.queue = [];
    let denied = 0;
    try {
      while (ops.length) {
        const op = ops.shift();
        const collection = remoteCollection(op.table);
        if (!collection) continue;
        try {
          if (op.type === 'put') {
            const rows = [...op.rows.entries()].map(([key, value]) => ({
              collection,
              id: String(key),
              data: value,
            }));
            await this.client.upsertItems(rows);
          } else if (op.type === 'delete') {
            await this.client.deleteItem(collection, op.key);
          } else if (op.type === 'clear') {
            await this.client.clearCollection(collection);
          }
        } catch (error) {
          // 403 = 서버(RLS)가 그 역할에 막은 쓰기 — 다시 보내도 같으므로 버립니다.
          if (error && error.status === 403) {
            denied += 1;
            console.warn('[sync] 서버가 허용하지 않은 변경을 건너뜁니다', collection, error.detail || '');
            continue;
          }
          throw error;
        }
      }
      this.lastFlushAt = Date.now();
      this.setStatus('synced', denied ? `서버에 저장됨 · 권한 밖 ${denied}건 제외` : '서버에 저장됨');
      return true;
    } catch (error) {
      console.warn('[sync] 저장 실패', error);
      this.queue = ops.concat(this.queue);
      this.lastFlushAt = Date.now();
      const offline = error && error.status === 0;
      const expired = error && error.status === 401;
      this.setStatus(
        expired ? 'login' : offline ? 'offline' : 'error',
        expired ? '로그인이 필요합니다 · 다시 로그인해 주세요' : offline ? '오프라인 · 기기에 저장됨' : '서버 저장 지연 · 다시 시도합니다',
      );
      return false;
    } finally {
      this.flushing = false;
    }
  }

  /* ---------------- 주기 동기화 ---------------- */

  start(store) {
    this.store = store;
    this.stop();
    if (typeof setInterval !== 'function') return;
    const tick = () => this.tick().catch((error) => console.warn('[sync] tick failed', error));
    this.timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      tick();
    }, this.interval);
    if (typeof window !== 'undefined') {
      this._handleOnline = () => tick();
      window.addEventListener('online', this._handleOnline);
      if (typeof document !== 'undefined') {
        this._handleVisibility = () => {
          if (document.visibilityState === 'visible') tick();
        };
        document.addEventListener('visibilitychange', this._handleVisibility);
      }
    }
    tick();
  }

  stop() {
    if (this.timer && typeof clearInterval === 'function') clearInterval(this.timer);
    this.timer = null;
    if (this._flushTimer && typeof clearTimeout === 'function') {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    if (this._handleOnline && typeof window !== 'undefined') {
      window.removeEventListener('online', this._handleOnline);
      this._handleOnline = null;
    }
    if (this._handleVisibility && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._handleVisibility);
      this._handleVisibility = null;
    }
  }

  /** 한 번 동기화 — 내 변경을 올리고, 서버의 변경을 받아 옵니다. */
  async tick({ force = false } = {}) {
    if (this.flushing) return { pushed: 0, pulled: 0 };
    if (!this.authorized) {
      if (this.status !== 'login') this.setStatus('login', '로그인하면 서버와 맞춥니다');
      return { pushed: 0, pulled: 0 };
    }
    if (this.queue.length) await this.flush();
    this.ticks += 1;
    const full = force || this.ticks % Math.max(1, this.fullEvery) === 0;
    try {
      const rows = await this.client.listItems({ since: full ? '' : this.remoteTs });
      if (!rows.length) {
        if (this.status !== 'synced') this.setStatus('synced', '서버 연결됨');
        return { pushed: 0, pulled: 0 };
      }
      const pulled = await this._applyRemote(rows, { replaceTables: full });
      this.remoteTs = maxUpdatedAt(rows, full ? '' : this.remoteTs);
      this.setStatus('synced', pulled ? `다른 기기 변경 ${pulled}건 반영` : '서버 연결됨');
      if (pulled && this.store) {
        if (typeof this.store._notify === 'function') this.store._notify();
        if (typeof document !== 'undefined' && document.dispatchEvent) {
          document.dispatchEvent(new CustomEvent('kec:remote-change', { detail: { count: pulled } }));
        }
      }
      return { pushed: 0, pulled };
    } catch (error) {
      const offline = (error && error.status === 0) || (typeof navigator !== 'undefined' && navigator.onLine === false);
      const expired = error && error.status === 401;
      this.setStatus(
        expired ? 'login' : offline ? 'offline' : 'error',
        expired ? '로그인이 필요합니다 · 다시 로그인해 주세요' : offline ? '오프라인 · 기기 저장' : '서버 연결 지연 · 다시 시도합니다',
      );
      return { pushed: 0, pulled: 0, error };
    }
  }

  /** 앱에서 파일(사진 · 사업자등록증 · 서명)을 Storage 에 올립니다. 실패하면 ''. */
  async upload(dataUrl, options = {}) {
    try {
      return await this.client.uploadDataUrl(dataUrl, options);
    } catch (error) {
      console.warn('[sync] 파일 업로드 실패', error);
      return '';
    }
  }
}

/* ------------------------------------------------------------------ */
/* Store 에 연결                                                        */
/* ------------------------------------------------------------------ */

/** Store 인스턴스에 서버 동기화를 붙입니다(켜져 있지 않으면 아무 것도 하지 않음). */
export function attachSupabaseSync(store) {
  if (!store || store.remote) return null;
  if (!shouldSync()) {
    store.syncStatus = 'local';
    return null;
  }
  const auth = new SupabaseAuth();
  const client = new SupabaseClient({ auth });
  const sync = new SupabaseSync({ client });
  store.remote = sync;
  store.auth = auth;
  store.syncStatus = auth.hasSession() ? 'idle' : 'login';
  sync.onStatus(({ status }) => {
    store.syncStatus = status;
  });
  return sync;
}
