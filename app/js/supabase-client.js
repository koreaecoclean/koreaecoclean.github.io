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
export const SUPABASE_BUCKET = 'ecoclean-files';

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
    bucket = SUPABASE_BUCKET,
    timeout = 12000,
  } = {}) {
    this.url = String(url).replace(/\/+$/, '');
    this.key = key;
    this.table = table;
    this.bucket = bucket;
    this.timeout = timeout;
  }

  headers(extra = {}) {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      ...extra,
    };
  }

  async request(path, options = {}) {
    if (typeof fetch !== 'function') {
      throw new SupabaseError('이 브라우저에서는 서버 동기화를 쓸 수 없습니다.', 0);
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeout) : null;
    try {
      const response = await fetch(`${this.url}${path}`, {
        ...options,
        headers: this.headers(options.headers || {}),
        signal: controller ? controller.signal : undefined,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new SupabaseError(`Supabase ${response.status}`, response.status, detail.slice(0, 300));
      }
      return response;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 모든 레코드(또는 since 이후 바뀐 레코드)를 읽습니다. */
  async listItems({ since = '' } = {}) {
    const params = new URLSearchParams({
      select: 'collection,id,data,updated_at',
      order: 'updated_at.asc',
    });
    if (since) params.set('updated_at', `gt.${since}`);
    const response = await this.request(`/rest/v1/${this.table}?${params.toString()}`);
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
  local: { label: '기기 저장', tone: 'wait' },
};

export class SupabaseSync {
  constructor({ client = new SupabaseClient(), interval = 5000, fullEvery = 12 } = {}) {
    this.client = client;
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
    if (isDeviceLocal(table, key)) return;
    this.queue.push({ type: 'delete', table, key: String(key) });
    this._writes += 1;
    this._schedule();
  }

  queueClear(table) {
    if (!remoteCollection(table)) return;
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
    if (!this.queue.length) return true;
    this.flushing = true;
    this.setStatus('syncing', '변경 사항 저장 중');
    const ops = this.queue.slice();
    this.queue = [];
    try {
      while (ops.length) {
        const op = ops.shift();
        const collection = remoteCollection(op.table);
        if (!collection) continue;
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
      }
      this.lastFlushAt = Date.now();
      this.setStatus('synced', '서버에 저장됨');
      return true;
    } catch (error) {
      console.warn('[sync] 저장 실패', error);
      this.queue = ops.concat(this.queue);
      this.lastFlushAt = Date.now();
      const offline = error && error.status === 0;
      this.setStatus(offline ? 'offline' : 'error', offline ? '오프라인 · 기기에 저장됨' : '서버 저장 지연 · 다시 시도합니다');
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
      this.setStatus(offline ? 'offline' : 'error', offline ? '오프라인 · 기기 저장' : '서버 연결 지연 · 다시 시도합니다');
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
  const sync = new SupabaseSync({ client: new SupabaseClient() });
  store.remote = sync;
  store.syncStatus = 'idle';
  sync.onStatus(({ status }) => {
    store.syncStatus = status;
  });
  return sync;
}
