/**
 * store.js — data layer for the 코리아 에코크린 PWA.
 *
 * The UI only talks to `store` (a facade). `store` delegates every read/write to
 * an *adapter*, so the storage engine can be swapped without touching views.
 *
 * Shipped adapters
 *  - IndexedDbAdapter    : default. Handles photos as data URLs, plenty of room.
 *  - LocalStorageAdapter : fallback for browsers/private modes without IndexedDB.
 *  - MemoryAdapter       : last resort, nothing persists.
 *
 * Adapter contract (all async):
 *   init() / getAll(table) / get(table, key) / put(table, value) /
 *   remove(table, key) / clear(table?) / close()
 *   tables: sites | reports | photos | inquiries | accounts | roomCodes | grants | meta
 *
 * Supabase 로 교체하려면 같은 계약을 구현한 어댑터를 만들어
 * `new Store(adapter)` 에 넘기면 됩니다. 예시: js/store-remote.example.js,
 * 서버 스키마: supabase-schema.sql
 */

import { buildSeedData, SEED_VERSION } from './seed.js';

const DB_NAME = 'korea-ecoclean';
const DB_VERSION = 2;
const TABLES = ['sites', 'reports', 'photos', 'inquiries', 'accounts', 'roomCodes', 'grants', 'meta'];
const LS_PREFIX = 'kec:';

/** Code alphabet without look-alikes (0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export class StoreError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function uid(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

function randomCode(length) {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

export function normalizeCode(value) {
  return String(value || '').replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
}

export function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

export function countReportPhotos(report) {
  const photos = (report && report.photos) || {};
  if (Array.isArray(photos)) return photos.length;
  return (photos.security || []).length + (photos.cleaning || []).length + (photos.issue || []).length;
}

/** Older reports stored `photos: [...]`; keep them readable after the 3-group change. */
function normalizePhotos(photos) {
  if (Array.isArray(photos)) return { security: [], cleaning: photos, issue: [] };
  if (!photos || typeof photos !== 'object') return { security: [], cleaning: [], issue: [] };
  return {
    security: Array.isArray(photos.security) ? photos.security : [],
    cleaning: Array.isArray(photos.cleaning) ? photos.cleaning : [],
    issue: Array.isArray(photos.issue) ? photos.issue : [],
  };
}

function normalizeReport(report) {
  if (!report) return report;
  return { ...report, photos: normalizePhotos(report.photos), issueNote: report.issueNote || '' };
}

function isQuotaError(error) {
  if (!error) return false;
  return (
    error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    error.code === 22 ||
    /quota/i.test(error.message || '')
  );
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('저장소 요청이 실패했습니다.'));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('저장소 트랜잭션이 실패했습니다.'));
    tx.onabort = () => reject(tx.error || new Error('저장소 트랜잭션이 중단되었습니다.'));
  });
}

/* ------------------------------------------------------------------ */
/* IndexedDB adapter                                                   */
/* ------------------------------------------------------------------ */

export class IndexedDbAdapter {
  constructor(name = DB_NAME) {
    this.name = name;
    this.db = null;
  }

  static isSupported() {
    try {
      return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch (error) {
      return false;
    }
  }

  async init() {
    if (this.db) return this;
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('sites')) {
          db.createObjectStore('sites', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('reports')) {
          const store = db.createObjectStore('reports', { keyPath: 'id' });
          store.createIndex('siteId', 'siteId', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('photos')) {
          db.createObjectStore('photos', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('inquiries')) {
          const store = db.createObjectStore('inquiries', { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('accounts')) {
          const store = db.createObjectStore('accounts', { keyPath: 'id' });
          store.createIndex('phone', 'phone', { unique: false });
        }
        if (!db.objectStoreNames.contains('roomCodes')) {
          const store = db.createObjectStore('roomCodes', { keyPath: 'id' });
          store.createIndex('siteId', 'siteId', { unique: false });
          store.createIndex('code', 'code', { unique: false });
        }
        if (!db.objectStoreNames.contains('grants')) {
          const store = db.createObjectStore('grants', { keyPath: 'id' });
          store.createIndex('accountId', 'accountId', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB를 열 수 없습니다.'));
      request.onblocked = () =>
        reject(new StoreError('blocked', '다른 탭에서 저장소를 사용 중입니다. 새로고침 후 다시 시도해 주세요.'));
    });
    return this;
  }

  async getAll(table) {
    const tx = this.db.transaction(table, 'readonly');
    return requestToPromise(tx.objectStore(table).getAll());
  }

  async get(table, key) {
    const tx = this.db.transaction(table, 'readonly');
    return requestToPromise(tx.objectStore(table).get(key));
  }

  async put(table, value) {
    const tx = this.db.transaction(table, 'readwrite');
    tx.objectStore(table).put(value);
    await transactionDone(tx);
    return value;
  }

  async remove(table, key) {
    const tx = this.db.transaction(table, 'readwrite');
    tx.objectStore(table).delete(key);
    await transactionDone(tx);
  }

  async clear(table) {
    const targets = table ? [table] : TABLES;
    for (const name of targets) {
      const tx = this.db.transaction(name, 'readwrite');
      tx.objectStore(name).clear();
      await transactionDone(tx);
    }
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

/* ------------------------------------------------------------------ */
/* localStorage adapter (fallback)                                     */
/* ------------------------------------------------------------------ */

export class LocalStorageAdapter {
  constructor(namespace = LS_PREFIX) {
    this.ns = namespace;
  }

  static isSupported() {
    try {
      const probe = '__kec_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return true;
    } catch (error) {
      return false;
    }
  }

  async init() {
    return this;
  }

  _read(table) {
    try {
      const raw = window.localStorage.getItem(`${this.ns}${table}`);
      const value = raw ? JSON.parse(raw) : [];
      return Array.isArray(value) ? value : [];
    } catch (error) {
      return [];
    }
  }

  _write(table, rows) {
    try {
      window.localStorage.setItem(`${this.ns}${table}`, JSON.stringify(rows));
    } catch (error) {
      if (isQuotaError(error)) {
        throw new StoreError('quota', '기기 저장 공간이 가득 찼습니다.', error);
      }
      throw error;
    }
  }

  async getAll(table) {
    return this._read(table);
  }

  async get(table, key) {
    return this._read(table).find((row) => (row.id ?? row.key) === key);
  }

  async put(table, value) {
    const key = value.id ?? value.key;
    const rows = this._read(table).filter((row) => (row.id ?? row.key) !== key);
    rows.push(value);
    this._write(table, rows);
    return value;
  }

  async remove(table, key) {
    this._write(table, this._read(table).filter((row) => (row.id ?? row.key) !== key));
  }

  async clear(table) {
    const targets = table ? [table] : TABLES;
    for (const name of targets) {
      try {
        window.localStorage.removeItem(`${this.ns}${name}`);
      } catch (error) {
        /* ignore */
      }
    }
  }

  close() {}
}

/* ------------------------------------------------------------------ */
/* memory adapter (last resort)                                        */
/* ------------------------------------------------------------------ */

export class MemoryAdapter {
  constructor() {
    this.data = new Map(TABLES.map((table) => [table, []]));
  }
  async init() {
    return this;
  }
  async getAll(table) {
    return (this.data.get(table) || []).slice();
  }
  async get(table, key) {
    return (this.data.get(table) || []).find((row) => (row.id ?? row.key) === key);
  }
  async put(table, value) {
    const rows = this.data.get(table) || [];
    const key = value.id ?? value.key;
    this.data.set(table, rows.filter((row) => (row.id ?? row.key) !== key).concat(value));
    return value;
  }
  async remove(table, key) {
    const rows = this.data.get(table) || [];
    this.data.set(table, rows.filter((row) => (row.id ?? row.key) !== key));
  }
  async clear(table) {
    const targets = table ? [table] : TABLES;
    targets.forEach((name) => this.data.set(name, []));
  }
  close() {}
}

/* ------------------------------------------------------------------ */
/* Store facade                                                        */
/* ------------------------------------------------------------------ */

export class Store {
  constructor(adapter) {
    this.adapter = adapter;
    this.adapterName =
      adapter instanceof IndexedDbAdapter ? 'indexeddb' : adapter instanceof LocalStorageAdapter ? 'localstorage' : 'memory';
    this._ready = null;
    this._listeners = new Set();
  }

  init() {
    if (!this._ready) this._ready = this._init();
    return this._ready;
  }

  async _init() {
    await this.adapter.init();
    await this._migrate();
    await this._seedIfEmpty();
    return this;
  }

  /** Subscribe to data changes (report added/removed, codes issued, demo reset…). */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _notify() {
    this._listeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        console.warn('[store] listener failed', error);
      }
    });
  }

  /** Keep data written by older versions readable (photo groups, accounts). */
  async _migrate() {
    const reports = await this.adapter.getAll('reports');
    for (const report of reports) {
      if (Array.isArray(report.photos)) {
        await this.adapter.put('reports', { ...report, photos: normalizePhotos(report.photos) });
      }
    }
    const sites = await this.adapter.getAll('sites');
    const accounts = await this.adapter.getAll('accounts');
    if (sites.length && !accounts.length) {
      const { accounts: seedAccounts, roomCodes } = buildSeedData();
      for (const account of seedAccounts) await this.adapter.put('accounts', account);
      if (!(await this.adapter.getAll('roomCodes')).length) {
        for (const code of roomCodes) await this.adapter.put('roomCodes', code);
      }
    }
  }

  async _seedIfEmpty() {
    const sites = await this.adapter.getAll('sites');
    if (sites.length) return false;
    await this._writeSeed();
    return true;
  }

  async _writeSeed() {
    const { sites, reports, accounts, roomCodes } = buildSeedData();
    for (const site of sites) await this.adapter.put('sites', site);
    for (const report of reports) await this.adapter.put('reports', report);
    for (const account of accounts) await this.adapter.put('accounts', account);
    for (const code of roomCodes) await this.adapter.put('roomCodes', code);
    await this.setSetting('seedVersion', SEED_VERSION);
  }

  /* ---------------- sites ---------------- */

  async listSites() {
    const sites = await this.adapter.getAll('sites');
    return sites.sort((a, b) => String(a.code).localeCompare(String(b.code)));
  }

  async getSite(id) {
    return this.adapter.get('sites', id);
  }

  async findSiteByCode(code) {
    const needle = normalizeCode(code);
    if (!needle) return null;
    const sites = await this.listSites();
    return (
      sites.find((site) => normalizeCode(site.code) === needle) ||
      sites.find((site) => normalizeCode(site.code) === normalizeCode(`EC${needle}`)) ||
      null
    );
  }

  /* ---------------- reports ---------------- */

  static sortKey(report) {
    return `${report.date || ''} ${report.time || '00:00'}`;
  }

  async listReports({ siteId = null, leader = null, limit = 0 } = {}) {
    let reports = await this.adapter.getAll('reports');
    if (siteId) reports = reports.filter((report) => report.siteId === siteId);
    if (leader) reports = reports.filter((report) => report.leader === leader);
    reports = reports.map(normalizeReport);
    reports.sort((a, b) => Store.sortKey(b).localeCompare(Store.sortKey(a)));
    return limit > 0 ? reports.slice(0, limit) : reports;
  }

  async getReport(id) {
    return normalizeReport(await this.adapter.get('reports', id));
  }

  async addReport(input) {
    const site = await this.getSite(input.siteId);
    if (!site) throw new StoreError('no-site', '현장을 찾을 수 없습니다.');

    const report = {
      id: uid('rep'),
      siteId: site.id,
      siteCode: site.code,
      siteName: site.name,
      date: input.date,
      time: input.time,
      leader: input.leader,
      leaderRole: input.leaderRole || '팀장',
      durationMin: Number(input.durationMin) || null,
      checklist: (input.checklist || []).map((item) => ({ label: item.label, done: !!item.done })),
      note: String(input.note || '').trim(),
      issueNote: String(input.issueNote || '').trim(),
      photos: normalizePhotos(input.photos),
      createdAt: new Date().toISOString(),
      source: 'app',
    };

    await this.adapter.put('reports', report);
    this._notify();
    return report;
  }

  async deleteReport(id) {
    const report = await this.getReport(id);
    if (!report) return false;
    await this.adapter.remove('reports', id);
    const groups = normalizePhotos(report.photos);
    for (const group of Object.values(groups)) {
      for (const photo of group) {
        if (photo && photo.id) await this.adapter.remove('photos', photo.id).catch(() => {});
      }
    }
    this._notify();
    return true;
  }

  /* ---------------- photos ---------------- */

  /** Persist one photo and return the small reference a report stores. */
  async savePhoto(photo) {
    const record = {
      id: uid('ph'),
      dataUrl: photo.dataUrl,
      width: photo.width || null,
      height: photo.height || null,
      createdAt: new Date().toISOString(),
    };
    try {
      await this.adapter.put('photos', record);
    } catch (error) {
      if (isQuotaError(error) || error.code === 'quota') {
        throw new StoreError(
          'quota',
          '기기 저장 공간이 부족해 사진을 저장하지 못했습니다. 오래된 보고를 정리한 뒤 다시 시도해 주세요.',
          error,
        );
      }
      throw error;
    }
    return {
      id: record.id,
      thumb: photo.thumb,
      width: record.width,
      height: record.height,
      caption: photo.caption || '',
    };
  }

  photoThumbUrl(ref) {
    if (!ref) return '';
    return ref.thumbAsset || ref.thumb || ref.asset || '';
  }

  async photoFullUrl(ref) {
    if (!ref) return '';
    if (ref.asset) return ref.asset;
    if (ref.dataUrl) return ref.dataUrl;
    if (!ref.id) return '';
    const record = await this.adapter.get('photos', ref.id);
    return record ? record.dataUrl : '';
  }

  /* ---------------- accounts ---------------- */

  async listAccounts({ role = null } = {}) {
    const rows = await this.adapter.getAll('accounts');
    const filtered = role ? rows.filter((row) => row.role === role) : rows;
    return filtered.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  async getAccount(id) {
    return this.adapter.get('accounts', id);
  }

  async findAccountByPhone(phone, role = null) {
    const needle = normalizePhone(phone);
    if (!needle) return null;
    const rows = await this.adapter.getAll('accounts');
    return (
      rows.find((row) => normalizePhone(row.phone) === needle && (!role || row.role === role)) || null
    );
  }

  async updateAccount(id, patch) {
    const account = await this.getAccount(id);
    if (!account) throw new StoreError('no-account', '계정을 찾을 수 없습니다.');
    const next = { ...account, ...patch, updatedAt: new Date().toISOString() };
    await this.adapter.put('accounts', next);
    this._notify();
    return next;
  }

  /** Issue a fresh team-leader code (admin action). The old code stops working. */
  async regenerateLeaderCode(accountId) {
    const account = await this.getAccount(accountId);
    if (!account) throw new StoreError('no-account', '계정을 찾을 수 없습니다.');
    if (account.role === 'customer') {
      throw new StoreError('wrong-role', '고객 계정에는 팀장 코드를 발급하지 않습니다.');
    }

    const rows = await this.adapter.getAll('accounts');
    const taken = new Set(rows.map((row) => normalizeCode(row.leaderCode || '')));
    let code = '';
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const candidate = `TL-${String(1000 + Math.floor(Math.random() * 9000))}`;
      if (!taken.has(normalizeCode(candidate))) {
        code = candidate;
        break;
      }
    }
    if (!code) throw new StoreError('code-collision', '코드를 생성하지 못했습니다. 다시 시도해 주세요.');

    return this.updateAccount(accountId, {
      leaderCode: code,
      leaderCodeUpdatedAt: new Date().toISOString(),
    });
  }

  /* ---------------- one-time room codes ---------------- */

  async listRoomCodes({ siteId = null, unusedOnly = false } = {}) {
    let rows = await this.adapter.getAll('roomCodes');
    if (siteId) rows = rows.filter((row) => row.siteId === siteId);
    if (unusedOnly) rows = rows.filter((row) => !row.usedAt);
    return rows.sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt)));
  }

  async issueRoomCode(siteId, note = '') {
    const site = await this.getSite(siteId);
    if (!site) throw new StoreError('no-site', '현장을 찾을 수 없습니다.');

    const existing = await this.adapter.getAll('roomCodes');
    const taken = new Set(existing.map((row) => normalizeCode(row.code)));
    let code = '';
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const candidate = `C-${randomCode(6)}`;
      if (!taken.has(normalizeCode(candidate))) {
        code = candidate;
        break;
      }
    }
    if (!code) throw new StoreError('code-collision', '코드를 생성하지 못했습니다. 다시 시도해 주세요.');

    const record = {
      id: uid('rc'),
      siteId,
      code,
      issuedAt: new Date().toISOString(),
      usedAt: null,
      usedBy: null,
      note: note || '관리자 발급',
    };
    await this.adapter.put('roomCodes', record);
    this._notify();
    return record;
  }

  /**
   * Redeem a one-time cleaning code for a customer account.
   * Marks the code used and grants the account access to its room.
   */
  async redeemRoomCode(rawCode, account) {
    if (!account) throw new StoreError('no-account', '로그인이 필요합니다.');
    const needle = normalizeCode(rawCode);
    if (!needle) throw new StoreError('code-empty', '청소코드를 입력해 주세요.');

    const rows = await this.adapter.getAll('roomCodes');
    const found = rows.find((row) => normalizeCode(row.code) === needle);
    if (!found) {
      throw new StoreError('code-not-found', '등록되지 않은 청소코드입니다. 코드를 다시 확인해 주세요.');
    }
    if (found.siteId !== account.siteId) {
      throw new StoreError('code-wrong-site', '다른 현장에 발급된 코드입니다. 담당자에게 다시 요청해 주세요.');
    }
    if (found.usedAt) {
      throw new StoreError('code-used', '이미 사용된 청소코드입니다. 새 코드를 발급받아 주세요.');
    }

    const usedAt = new Date().toISOString();
    await this.adapter.put('roomCodes', { ...found, usedAt, usedBy: account.id });
    const grant = await this.createGrant(account.id, account.siteId, found.id);
    this._notify();
    return { code: { ...found, usedAt, usedBy: account.id }, grant };
  }

  /* ---------------- room access grants ---------------- */

  async listGrants({ accountId = null } = {}) {
    const rows = await this.adapter.getAll('grants');
    return accountId ? rows.filter((row) => row.accountId === accountId) : rows;
  }

  async getGrant(accountId, siteId) {
    const id = `${accountId}::${siteId}`;
    return this.adapter.get('grants', id);
  }

  async createGrant(accountId, siteId, codeId = '') {
    const grant = {
      id: `${accountId}::${siteId}`,
      accountId,
      siteId,
      codeId,
      createdAt: new Date().toISOString(),
    };
    await this.adapter.put('grants', grant);
    return grant;
  }

  /* ---------------- inquiries ---------------- */

  async listInquiries(limit = 0) {
    const rows = await this.adapter.getAll('inquiries');
    rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return limit > 0 ? rows.slice(0, limit) : rows;
  }

  async addInquiry(data) {
    const inquiry = {
      id: uid('inq'),
      spaceType: data.spaceType || '',
      district: data.district || '',
      size: data.size || '',
      frequency: data.frequency || '',
      timeWindow: data.timeWindow || '',
      phone: data.phone || '',
      memo: data.memo || '',
      message: data.message || '',
      createdAt: new Date().toISOString(),
      channel: data.channel || 'sms',
      status: data.status || 'sent-to-sms',
    };
    await this.adapter.put('inquiries', inquiry);
    this._notify();
    return inquiry;
  }

  /* ---------------- settings ---------------- */

  async getSetting(key, fallback = null) {
    const row = await this.adapter.get('meta', key);
    return row && 'value' in row ? row.value : fallback;
  }

  async setSetting(key, value) {
    await this.adapter.put('meta', { key, value });
    return value;
  }

  async removeSetting(key) {
    await this.adapter.remove('meta', key);
  }

  /* ---------------- aggregates ---------------- */

  async statsForSite(site) {
    const reports = await this.listReports({ siteId: site.id });
    const monthKey = new Date().toISOString().slice(0, 7);
    const last = reports[0] || null;
    const photoCount = reports.reduce((sum, report) => sum + countReportPhotos(report), 0);

    let nextDate = null;
    if (last) {
      const date = new Date(`${last.date}T12:00:00`);
      date.setDate(date.getDate() + (site.intervalDays || 7));
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      nextDate = `${y}-${m}-${d}`;
    }

    return {
      total: reports.length,
      monthCount: reports.filter((report) => String(report.date).startsWith(monthKey)).length,
      photoCount,
      last,
      nextDate,
      reports,
    };
  }

  async usage() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        return { usage, quota, supported: true };
      }
    } catch (error) {
      /* ignore */
    }
    return { usage: 0, quota: 0, supported: false };
  }

  /* ---------------- maintenance ---------------- */

  async resetDemo() {
    await this.adapter.clear();
    await this._writeSeed();
    this._notify();
  }
}

/* ------------------------------------------------------------------ */
/* singleton                                                           */
/* ------------------------------------------------------------------ */

export function createStore() {
  const adapter = IndexedDbAdapter.isSupported()
    ? new IndexedDbAdapter()
    : LocalStorageAdapter.isSupported()
      ? new LocalStorageAdapter()
      : new MemoryAdapter();
  return new Store(adapter);
}

export const store = createStore();
