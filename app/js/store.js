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

import {
  buildSeedData,
  buildSites,
  buildRoomCodes,
  buildQuotes,
  buildStaffContracts,
  buildStaffChecks,
  buildSupplyCatalog,
  buildSupplyOrders,
  SEED_VERSION,
  DEMO_ACCOUNTS,
  DEFAULT_CHECKLISTS,
  STAFF_TYPES,
  SUPPLIER,
  PAYMENT_ACCOUNT,
  QUOTE_VALID_DAYS,
  addMonthsISO,
  addDaysISO,
  intervalFromFrequency,
} from './seed.js';

const DB_NAME = 'korea-ecoclean';
const DB_VERSION = 4;
const TABLES = [
  'sites',
  'reports',
  'photos',
  'inquiries',
  'accounts',
  'roomCodes',
  'grants',
  'quotes',
  'contracts',
  'staffContracts',
  'staffChecks',
  'supplyCatalog',
  'supplyOrders',
  'meta',
];
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

function todayISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toText(value) {
  return String(value ?? '').trim();
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

/** 01012345678 → 010-1234-5678 (best effort, any other length returned as digits). */
export function prettyPhone(value) {
  const digits = normalizePhone(value);
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return digits;
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

/** A site's 첫 상태 기록: ① 첫 견적(오염) ② 첫 청소(대청소). */
export const BASELINE_STAGES = ['quote', 'deepClean'];

export function normalizeBaseline(baseline) {
  const source = baseline && typeof baseline === 'object' ? baseline : {};
  const out = {};
  for (const stage of BASELINE_STAGES) {
    const value = source[stage] && typeof source[stage] === 'object' ? source[stage] : {};
    out[stage] = {
      date: value.date || '',
      note: value.note || '',
      photos: Array.isArray(value.photos) ? value.photos : [],
    };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* contract + field operations info                                     */
/* ------------------------------------------------------------------ */

/** Money fields are whole won; anything unparsable becomes 0. */
function toAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number);
}

/**
 * 계약 정보 (관리자 전용).
 * 순수 매출금 = 계약금 - 도급금액 - 수수료  → netProfit()
 */
export function normalizeContract(contract) {
  const source = contract && typeof contract === 'object' ? contract : {};
  return {
    contractAmount: toAmount(source.contractAmount),
    subcontractAmount: toAmount(source.subcontractAmount),
    feeAmount: toAmount(source.feeAmount),
    contractDate: String(source.contractDate || ''),
    billingDay: String(source.billingDay || ''),
    note: String(source.note || ''),
  };
}

/** 팀장(현장) 전용 운영 정보 — 금액은 도급금액만 포함합니다. */
export function normalizeOps(ops) {
  const source = ops && typeof ops === 'object' ? ops : {};
  return {
    process: String(source.process || ''),
    accessMethod: String(source.accessMethod || ''),
    trashLocation: String(source.trashLocation || ''),
    parkingMethod: String(source.parkingMethod || ''),
  };
}

/** 순수 매출금 (계약금 - 도급금액 - 수수료). */
export function netProfit(contract) {
  const row = normalizeContract(contract);
  return row.contractAmount - row.subcontractAmount - row.feeAmount;
}

/** 계약 정보 한 줄(합계 계산용). */
export function contractRow(site) {
  const contract = normalizeContract(site && site.contract);
  return {
    ...contract,
    netProfit: netProfit(contract),
    siteId: site ? site.id : '',
    code: site ? site.code : '',
    name: site ? site.name : '',
    clientName: site ? site.clientName || site.name : '',
  };
}

/** 전체 매출 합계 — 순수 매출금은 행별 합계로 계산합니다. */
export function revenueTotals(sites) {
  const rows = (sites || []).filter((site) => site && site.active !== false).map(contractRow);
  return {
    sites: rows.length,
    contractAmount: rows.reduce((sum, row) => sum + row.contractAmount, 0),
    subcontractAmount: rows.reduce((sum, row) => sum + row.subcontractAmount, 0),
    feeAmount: rows.reduce((sum, row) => sum + row.feeAmount, 0),
    netProfit: rows.reduce((sum, row) => sum + row.netProfit, 0),
  };
}

/* ------------------------------------------------------------------ */
/* quotes (견적) · contracts (도급 계약서) — 대표 전용                */
/* ------------------------------------------------------------------ */

export const QUOTE_STATUS = {
  draft: { label: '작성 중', badge: 'badge--wait' },
  sent: { label: '발송 완료', badge: 'badge--wait' },
  accepted: { label: '계약 진행', badge: 'badge--done' },
  contracted: { label: '계약 체결', badge: 'badge--done' },
};

export const AGREEMENT_STATUS = {
  draft: { label: '작성 중', badge: 'badge--wait' },
  sent: { label: '고객 확인 대기', badge: 'badge--wait' },
  signed: { label: '체결 완료', badge: 'badge--done' },
};

/** 견적 한 건 — 금액은 원 단위 정수, 부가세 포함 여부를 따로 둡니다. */
export function normalizeQuote(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    id: toText(source.id),
    no: toText(source.no),
    siteId: toText(source.siteId),
    clientCompany: toText(source.clientCompany),
    clientCategory: Object.prototype.hasOwnProperty.call(DEFAULT_CHECKLISTS, source.clientCategory)
      ? source.clientCategory
      : 'office',
    clientAddress: toText(source.clientAddress),
    clientContact: toText(source.clientContact),
    clientPhone: toText(source.clientPhone),
    clientBizNumber: toText(source.clientBizNumber),
    clientTaxEmail: toText(source.clientTaxEmail),
    frequency: toText(source.frequency) || '주 1회 (일정 협의)',
    scope: toText(source.scope),
    extraScope: toText(source.extraScope),
    area: toText(source.area),
    amount: toAmount(source.amount),
    vatIncluded: !!source.vatIncluded,
    billingDay: toText(source.billingDay) || '1',
    periodMonths: Number(source.periodMonths) > 0 ? Math.round(Number(source.periodMonths)) : 12,
    startDate: toText(source.startDate),
    endDate: toText(source.endDate),
    terms: toText(source.terms),
    memo: toText(source.memo),
    validUntil: toText(source.validUntil),
    status: QUOTE_STATUS[source.status] ? source.status : 'draft',
    photos: Array.isArray(source.photos) ? source.photos.slice() : [],
    inviteCode: toText(source.inviteCode),
    inviteIssuedAt: toText(source.inviteIssuedAt),
    inviteUsedAt: toText(source.inviteUsedAt),
    inviteUsedBy: toText(source.inviteUsedBy),
    invitedPhone: toText(source.invitedPhone),
    createdAt: toText(source.createdAt),
    updatedAt: toText(source.updatedAt),
    sentAt: toText(source.sentAt),
    contractedAt: toText(source.contractedAt),
    source: toText(source.source) || 'app',
  };
}

/** 도급 계약서 한 건 — 서명 이미지와 갑/을 정보를 함께 보관합니다. */
export function normalizeAgreement(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    id: toText(source.id),
    no: toText(source.no),
    quoteId: toText(source.quoteId),
    siteId: toText(source.siteId),
    status: AGREEMENT_STATUS[source.status] ? source.status : 'draft',
    clientAddress: toText(source.clientAddress),
    clientBusinessName: toText(source.clientBusinessName),
    clientBizNumber: toText(source.clientBizNumber),
    clientCeo: toText(source.clientCeo),
    contactName: toText(source.contactName),
    contactPhone: toText(source.contactPhone),
    startDate: toText(source.startDate),
    endDate: toText(source.endDate),
    months: Number(source.months) > 0 ? Math.round(Number(source.months)) : 12,
    amount: toAmount(source.amount),
    vatIncluded: !!source.vatIncluded,
    billingDay: toText(source.billingDay) || '1',
    bankName: toText(source.bankName) || PAYMENT_ACCOUNT.bankName,
    bankAccount: toText(source.bankAccount) || PAYMENT_ACCOUNT.accountNumber,
    accountHolder: toText(source.accountHolder) || PAYMENT_ACCOUNT.holder,
    supplierAddress: toText(source.supplierAddress) || SUPPLIER.address,
    supplierBusinessName: toText(source.supplierBusinessName) || SUPPLIER.name,
    supplierBizNumber: toText(source.supplierBizNumber) || SUPPLIER.bizNumber,
    supplierCeo: toText(source.supplierCeo) || SUPPLIER.ceo,
    supplierUpjong: toText(source.supplierUpjong) || SUPPLIER.upjong,
    supplierJongmok: toText(source.supplierJongmok) || SUPPLIER.jongmok,
    scope: toText(source.scope),
    extraScope: toText(source.extraScope),
    frequency: toText(source.frequency),
    specialTerms: toText(source.specialTerms),
    bizLicense: source.bizLicense && typeof source.bizLicense === 'object' ? source.bizLicense : null,
    contractMemo: toText(source.contractMemo),
    signedDate: toText(source.signedDate),
    signature: toText(source.signature),
    signedByName: toText(source.signedByName),
    signedAt: toText(source.signedAt),
    createdAt: toText(source.createdAt),
    updatedAt: toText(source.updatedAt),
    source: toText(source.source) || 'app',
  };
}

/** 직원 계약 한 건 — 프리랜서(3.3%) · 도급 · 일용직. */
export function normalizeStaffContract(input) {
  const source = input && typeof input === 'object' ? input : {};
  const type = STAFF_TYPES[source.employmentType] ? source.employmentType : 'freelancer';
  return {
    id: toText(source.id),
    no: toText(source.no),
    accountId: toText(source.accountId),
    name: toText(source.name),
    phone: toText(source.phone),
    employmentType: type,
    roleTitle: toText(source.roleTitle) || (type === 'daily' ? '일용직' : '팀장'),
    residentId: toText(source.residentId),
    birthDate: toText(source.birthDate),
    bizNumber: toText(source.bizNumber),
    bankName: toText(source.bankName) || PAYMENT_ACCOUNT.bankName,
    bankAccount: toText(source.bankAccount),
    accountHolder: toText(source.accountHolder) || toText(source.name),
    siteIds: Array.isArray(source.siteIds) ? source.siteIds.filter(Boolean).map(String) : [],
    startDate: toText(source.startDate),
    endDate: toText(source.endDate),
    monthlyAmount: toAmount(source.monthlyAmount),
    dailyAmount: toAmount(source.dailyAmount),
    hourlyAmount: toAmount(source.hourlyAmount),
    feeRate: Number(source.feeRate) >= 0 ? Number(source.feeRate) : 3.3,
    settlementDay: toText(source.settlementDay) || '15',
    workDays: toText(source.workDays),
    workHours: toText(source.workHours),
    scope: toText(source.scope),
    process: toText(source.process),
    safety: toText(source.safety),
    specialTerms: toText(source.specialTerms),
    status: AGREEMENT_STATUS[source.status] ? source.status : 'draft',
    inviteCode: toText(source.inviteCode),
    inviteIssuedAt: toText(source.inviteIssuedAt),
    inviteUsedAt: toText(source.inviteUsedAt),
    inviteUsedBy: toText(source.inviteUsedBy),
    signature: toText(source.signature),
    signedDate: toText(source.signedDate),
    signedByName: toText(source.signedByName),
    signedAt: toText(source.signedAt),
    createdAt: toText(source.createdAt),
    updatedAt: toText(source.updatedAt),
    source: toText(source.source) || 'app',
  };
}

/** 근무태도 등급 — 본부장이 체크합니다. */
export const STAFF_GRADES = ['A', 'B', 'C', 'D', 'E', 'F'];

export function normalizeStaffCheck(input) {
  const source = input && typeof input === 'object' ? input : {};
  const grade = String(source.grade || '').toUpperCase();
  return {
    id: toText(source.id),
    staffContractId: toText(source.staffContractId),
    accountId: toText(source.accountId),
    name: toText(source.name),
    siteId: toText(source.siteId),
    date: toText(source.date),
    grade: STAFF_GRADES.includes(grade) ? grade : 'B',
    memo: toText(source.memo),
    reviewerId: toText(source.reviewerId),
    reviewerName: toText(source.reviewerName),
    createdAt: toText(source.createdAt),
    source: toText(source.source) || 'app',
  };
}

function normalizeSite(site) {
  if (!site) return site;
  return {
    ...site,
    baseline: normalizeBaseline(site.baseline),
    contract: normalizeContract(site.contract),
    ops: normalizeOps(site.ops),
    bizLicense: site.bizLicense && typeof site.bizLicense === 'object' ? site.bizLicense : null,
    contractMemo: toText(site.contractMemo),
  };
}

/* ------------------------------------------------------------------ */
/* 청소장비 · 배접봉투 구입 (대표 · 구입 당사자 직원)                  */
/* ------------------------------------------------------------------ */

export const SUPPLY_STATUS = {
  requested: { label: '발행 대기', badge: 'badge--wait' },
  issued: { label: '영수증 발행', badge: 'badge--done' },
};

/** 품목 · 단가 마스터 한 줄. 단가가 0원이면 ‘미정'. */
export function normalizeSupplyItem(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    id: toText(source.id),
    group: source.group === 'bag' ? 'bag' : 'equipment',
    name: toText(source.name),
    price: toAmount(source.price),
    unit: toText(source.unit) || '개',
    note: toText(source.note),
    sort: Number.isFinite(Number(source.sort)) ? Math.round(Number(source.sort)) : 999,
    active: source.active !== false,
    createdAt: toText(source.createdAt),
    updatedAt: toText(source.updatedAt),
    source: toText(source.source) || 'app',
  };
}

/** 영수증 · 구입 신청 한 건 — 품목은 이름·단가를 그대로 복사해 둡니다. */
export function normalizeSupplyOrder(input) {
  const source = input && typeof input === 'object' ? input : {};
  const items = (Array.isArray(source.items) ? source.items : []).map((row) => {
    const price = toAmount(row && row.price);
    const qty = Math.max(0, Math.round(Number(row && row.qty) || 0));
    return {
      catalogId: toText(row && row.catalogId),
      name: toText(row && row.name) || toText(row && row.catalogId),
      note: toText(row && row.note),
      unit: toText(row && row.unit),
      price,
      qty,
      amount: price * qty,
    };
  });
  return {
    id: toText(source.id),
    no: toText(source.no),
    status: SUPPLY_STATUS[source.status] ? source.status : 'requested',
    requesterAccountId: toText(source.requesterAccountId),
    requesterName: toText(source.requesterName),
    toAccountId: toText(source.toAccountId),
    toName: toText(source.toName) || toText(source.requesterName),
    date: toText(source.date),
    requestedAt: toText(source.requestedAt),
    issuedAt: toText(source.issuedAt),
    items,
    total: items.reduce((sum, row) => sum + row.amount, 0),
    note: toText(source.note),
    createdAt: toText(source.createdAt),
    updatedAt: toText(source.updatedAt),
    source: toText(source.source) || 'app',
  };
}

/** 영수증 합계 — 단가가 미정(0원)인 품목이 남아 있는지도 알려 줍니다. */
export function supplyTotals(items) {
  const rows = Array.isArray(items) ? items : [];
  return {
    total: rows.reduce((sum, row) => sum + toAmount(row && row.price) * Math.max(0, Number(row && row.qty) || 0), 0),
    pending: rows.some((row) => Number(row && row.qty) > 0 && !toAmount(row && row.price)),
  };
}

/** 대표(최고관리자)만 장비 · 봉투의 단가와 영수증을 다룹니다. */
export function canManageSupply(session) {
  return !!session && session.role === 'admin';
}

/**
 * 구입 신청과 내 영수증은 구입 당사자 직원과 대표만 봅니다.
 * 부관리자(본부장)와 고객 화면에는 금액이 일체 나오지 않습니다.
 */
export function canUseSupply(session) {
  if (!session) return false;
  if (session.role === 'admin') return true;
  if (session.role !== 'leader') return false;
  if (session.account && session.account.canManageStaff) return false;
  if (/본부장/.test(session.title || '')) return false;
  return true;
}

function requireSupplyEditor(actor) {
  if (!canManageSupply(actor)) {
    throw new StoreError('supply-denied', '청소장비 · 봉투 영수증은 대표(최고관리자)만 발행할 수 있습니다.');
  }
}

function requireSupplyUser(actor) {
  if (!canUseSupply(actor)) {
    throw new StoreError('supply-denied', '청소장비 · 봉투는 구입 당사자 직원과 대표만 다룰 수 있습니다.');
  }
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
        if (!db.objectStoreNames.contains('quotes')) {
          const store = db.createObjectStore('quotes', { keyPath: 'id' });
          store.createIndex('siteId', 'siteId', { unique: false });
          store.createIndex('status', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains('contracts')) {
          const store = db.createObjectStore('contracts', { keyPath: 'id' });
          store.createIndex('siteId', 'siteId', { unique: false });
          store.createIndex('quoteId', 'quoteId', { unique: false });
        }
        if (!db.objectStoreNames.contains('staffContracts')) {
          const store = db.createObjectStore('staffContracts', { keyPath: 'id' });
          store.createIndex('accountId', 'accountId', { unique: false });
          store.createIndex('status', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains('staffChecks')) {
          const store = db.createObjectStore('staffChecks', { keyPath: 'id' });
          store.createIndex('staffContractId', 'staffContractId', { unique: false });
          store.createIndex('accountId', 'accountId', { unique: false });
        }
        if (!db.objectStoreNames.contains('supplyCatalog')) {
          db.createObjectStore('supplyCatalog', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('supplyOrders')) {
          const store = db.createObjectStore('supplyOrders', { keyPath: 'id' });
          store.createIndex('toAccountId', 'toAccountId', { unique: false });
          store.createIndex('status', 'status', { unique: false });
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
    await this._seedIfEmpty();
    await this._migrate();
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
    await this._migrateAdminPhone(accounts);
    await this._ensureSeedSites();
    await this._ensureSeedAccounts();
    await this._ensureSeedGrants();
    await this._ensureSeedAssignments();
    await this._ensureSeedCodes();
    await this._ensureSiteBaseline();
    await this._ensureSiteContractOps();
    await this._ensureSeedQuotes();
    await this._ensureSeedStaffContracts();
    await this._ensureSeedStaffChecks();
    await this._ensureSeedSupply();
  }

  /**
   * 청소장비 · 배접봉투 품목과 데모 영수증이 기존 기기에도 생깁니다.
   * 이미 저장된 품목·단가는 절대 덮어쓰지 않고, 없는 품목만 추가합니다.
   * 데모 영수증은 영수증 표가 비어 있을 때만 넣어, 사용자가 지운 기록을 되살리지 않습니다.
   */
  async _ensureSeedSupply() {
    const catalog = await this.adapter.getAll('supplyCatalog');
    const ids = new Set(catalog.map((row) => row.id));
    for (const item of buildSupplyCatalog()) {
      if (ids.has(item.id)) continue;
      await this.adapter.put('supplyCatalog', JSON.parse(JSON.stringify(item)));
      ids.add(item.id);
    }
    // 데모 영수증은 한 번만 — 대표가 지운 영수증을 다시 살리지 않습니다.
    if (await this.getSetting('supplyOrdersSeeded', false)) return;
    const orders = await this.adapter.getAll('supplyOrders');
    if (!orders.length) {
      for (const order of buildSupplyOrders()) {
        await this.adapter.put('supplyOrders', JSON.parse(JSON.stringify(order)));
      }
    }
    await this.setSetting('supplyOrdersSeeded', true);
  }

  /** Seeded staff contracts reach devices that already hold data. */
  async _ensureSeedStaffContracts() {
    const rows = await this.adapter.getAll('staffContracts');
    const ids = new Set(rows.map((row) => row.id));
    for (const contract of buildStaffContracts()) {
      if (ids.has(contract.id)) continue;
      await this.adapter.put('staffContracts', JSON.parse(JSON.stringify(contract)));
      ids.add(contract.id);
    }
  }

  /** Seeded 근무태도 체크(A~F) reach devices that already hold data. */
  async _ensureSeedStaffChecks() {
    const rows = await this.adapter.getAll('staffChecks');
    const ids = new Set(rows.map((row) => row.id));
    for (const check of buildStaffChecks()) {
      if (ids.has(check.id)) continue;
      await this.adapter.put('staffChecks', JSON.parse(JSON.stringify(check)));
      ids.add(check.id);
    }
  }

  /** Seeded quotes (데모 견적) reach devices that already hold data. */
  async _ensureSeedQuotes() {
    const rows = await this.adapter.getAll('quotes');
    const ids = new Set(rows.map((row) => row.id));
    for (const quote of buildQuotes()) {
      if (ids.has(quote.id)) continue;
      await this.adapter.put('quotes', JSON.parse(JSON.stringify(quote)));
      ids.add(quote.id);
    }
  }

  /** Sites added to the seed later (a real client, for example) reach older devices. */
  async _ensureSeedSites() {
    const sites = await this.adapter.getAll('sites');
    if (!sites.length) return; // an empty store is filled by _seedIfEmpty()
    const ids = new Set(sites.map((site) => site.id));
    const codes = new Set(sites.map((site) => normalizeCode(site.code)));
    for (const site of buildSites()) {
      if (ids.has(site.id) || codes.has(normalizeCode(site.code))) continue;
      await this.adapter.put('sites', JSON.parse(JSON.stringify(site)));
      ids.add(site.id);
      codes.add(normalizeCode(site.code));
    }
  }

  /** Seeded team leaders keep every site the seed assigns them, including new ones. */
  async _ensureSeedAssignments() {
    const accounts = await this.adapter.getAll('accounts');
    if (!accounts.length) return;
    const siteIds = new Set((await this.adapter.getAll('sites')).map((site) => site.id));
    for (const account of accounts) {
      const seed = DEMO_ACCOUNTS.find((row) => row.id === account.id);
      if (!seed || !seed.assignedSiteIds) continue;
      const current = new Set(account.assignedSiteIds || []);
      const missing = seed.assignedSiteIds.filter((id) => siteIds.has(id) && !current.has(id));
      if (!missing.length) continue;
      await this.adapter.put('accounts', {
        ...account,
        assignedSiteIds: [...current, ...missing],
        updatedAt: new Date().toISOString(),
      });
    }
  }

  /** One-time codes that come with the seed exist on older devices too. */
  async _ensureSeedCodes() {
    const codes = await this.adapter.getAll('roomCodes');
    const siteIds = new Set((await this.adapter.getAll('sites')).map((site) => site.id));
    const existing = new Set(codes.map((row) => normalizeCode(row.code)));
    for (const code of buildRoomCodes()) {
      if (!siteIds.has(code.siteId) || existing.has(normalizeCode(code.code))) continue;
      await this.adapter.put('roomCodes', { ...code });
      existing.add(normalizeCode(code.code));
    }
  }

  /** Every site carries its 첫 상태 기록(견적·대청소) so the customer can compare. */
  async _ensureSiteBaseline() {
    const sites = await this.adapter.getAll('sites');
    if (!sites.length) return;
    const seedById = new Map(buildSites().map((site) => [site.id, site]));
    for (const site of sites) {
      const hasBoth = site.baseline && site.baseline.quote && site.baseline.deepClean;
      if (hasBoth) continue;
      const seed = seedById.get(site.id);
      const baseline = normalizeBaseline(site.baseline);
      for (const stage of BASELINE_STAGES) {
        if (site.baseline && site.baseline[stage]) continue;
        if (seed && seed.baseline && seed.baseline[stage]) {
          baseline[stage] = JSON.parse(JSON.stringify(seed.baseline[stage]));
        }
      }
      await this.adapter.put('sites', { ...site, baseline });
    }
  }

  /**
   * Every site carries 계약 정보(관리자)와 운영 정보(팀장). Sites stored by an older
   * build have neither, so they are backfilled once from the seed when the site
   * came from the seed, and with editable empty defaults otherwise. Idempotent and
   * non-destructive: a site that already has both objects is left untouched, and a
   * half-filled object only gains its missing keys.
   */
  async _ensureSiteContractOps() {
    const sites = await this.adapter.getAll('sites');
    if (!sites.length) return;
    const seedById = new Map(buildSites().map((site) => [site.id, site]));
    for (const site of sites) {
      const hasContract = !!site.contract && typeof site.contract === 'object';
      const hasOps = !!site.ops && typeof site.ops === 'object';
      const contractComplete =
        hasContract && Object.keys(normalizeContract(null)).every((key) => key in site.contract);
      const opsComplete = hasOps && Object.keys(normalizeOps(null)).every((key) => key in site.ops);
      if (contractComplete && opsComplete) continue;
      const seed = seedById.get(site.id);
      const contract = normalizeContract(
        hasContract ? site.contract : seed ? seed.contract : null,
      );
      const ops = normalizeOps(hasOps ? site.ops : seed ? seed.ops : null);
      await this.adapter.put('sites', { ...site, contract, ops, updatedAt: new Date().toISOString() });
    }
  }

  /**
   * Customers now enter their room with the registered phone number alone, so the
   * demo client accounts must already hold their room grant. On a device that ran
   * an older build (where the grant came from redeeming a code) this only adds a
   * missing grant; nothing else is rewritten.
   */
  async _ensureSeedGrants() {
    const accounts = await this.adapter.getAll('accounts');
    if (!accounts.length) return;
    const grants = await this.adapter.getAll('grants');
    const existing = new Set(grants.map((row) => row.id));
    for (const account of accounts) {
      if (account.role !== 'customer' || !account.siteId) continue;
      const id = `${account.id}::${account.siteId}`;
      if (existing.has(id)) continue;
      const seeded = DEMO_ACCOUNTS.some((row) => row.id === account.id && row.role === 'customer');
      if (!seeded) continue;
      const site = await this.adapter.get('sites', account.siteId);
      if (!site) continue;
      await this.adapter.put('grants', {
        id,
        accountId: account.id,
        siteId: account.siteId,
        codeId: '',
        createdAt: new Date().toISOString(),
        source: 'seed',
      });
      existing.add(id);
    }
  }

  /**
   * Accounts added to the seed after a device already had data (새 팀장 계정 등) must
   * appear on devices that ran an older build. Only an account whose `id` and phone
   * number are both absent is added — idempotent and non-destructive: existing
   * accounts (including deactivated ones), reports, codes, grants and sessions are
   * never touched.
   */
  async _ensureSeedAccounts() {
    const rows = await this.adapter.getAll('accounts');
    if (!rows.length) return; // no accounts yet: _seedIfEmpty() writes the full seed
    const ids = new Set(rows.map((row) => row.id));
    const phones = new Set(rows.map((row) => normalizePhone(row.phone)));
    const { accounts: seedAccounts } = buildSeedData();
    for (const account of seedAccounts) {
      if (ids.has(account.id) || phones.has(normalizePhone(account.phone))) continue;
      await this.adapter.put('accounts', account);
      ids.add(account.id);
      phones.add(normalizePhone(account.phone));
    }
  }

  /**
   * The 대표(최고관리자) login number changed 010-4400-8369 → 010-9900-8369.
   * Devices that already stored the old demo seed keep every existing record;
   * only the admin account's number is moved to the new value.
   */
  async _migrateAdminPhone(accounts) {
    const LEGACY_PHONE = '01044008369';
    const NEW_PHONE = '01099008369';
    const NEW_PHONE_PRETTY = '010-9900-8369';
    const rows = accounts || (await this.adapter.getAll('accounts'));
    if (!rows.length) return;
    const taken = new Set(rows.map((row) => normalizePhone(row.phone)));
    for (const row of rows) {
      if (normalizePhone(row.phone) !== LEGACY_PHONE) continue;
      if (row.role !== 'admin' && row.id !== 'acc_admin_ceo') continue;
      if (taken.has(NEW_PHONE)) continue;
      await this.adapter.put('accounts', {
        ...row,
        phone: NEW_PHONE,
        phonePretty: NEW_PHONE_PRETTY,
        updatedAt: new Date().toISOString(),
      });
      taken.add(NEW_PHONE);
    }
  }

  async _seedIfEmpty() {
    const sites = await this.adapter.getAll('sites');
    if (sites.length) return false;
    await this._writeSeed();
    return true;
  }

  async _writeSeed() {
    const { sites, reports, accounts, roomCodes, grants, quotes, contracts, staffContracts, staffChecks, supplyCatalog, supplyOrders } = buildSeedData();
    for (const site of sites) await this.adapter.put('sites', site);
    for (const report of reports) await this.adapter.put('reports', report);
    for (const account of accounts) await this.adapter.put('accounts', account);
    for (const code of roomCodes) await this.adapter.put('roomCodes', code);
    for (const grant of grants) await this.adapter.put('grants', grant);
    for (const quote of quotes) await this.adapter.put('quotes', quote);
    for (const contract of contracts) await this.adapter.put('contracts', contract);
    for (const staff of staffContracts) await this.adapter.put('staffContracts', staff);
    for (const check of staffChecks) await this.adapter.put('staffChecks', check);
    for (const item of supplyCatalog) await this.adapter.put('supplyCatalog', item);
    for (const order of supplyOrders) await this.adapter.put('supplyOrders', order);
    await this.setSetting('supplyOrdersSeeded', true);
    await this.setSetting('seedVersion', SEED_VERSION);
  }

  /* ---------------- sites ---------------- */

  async listSites() {
    const sites = await this.adapter.getAll('sites');
    return sites.map(normalizeSite).sort((a, b) => String(a.code).localeCompare(String(b.code)));
  }

  async getSite(id) {
    return normalizeSite(await this.adapter.get('sites', id));
  }

  /**
   * Register a site from the admin screen (a new contract, a real client, ...).
   * Business registration details are kept with the site and shown in the app.
   */
  async addSite(input = {}) {
    const name = String(input.name || '').trim();
    if (!name) throw new StoreError('name-empty', '현장명(상호)을 입력해 주세요.');

    const category = Object.prototype.hasOwnProperty.call(DEFAULT_CHECKLISTS, input.category) ? input.category : 'office';
    const sites = await this.adapter.getAll('sites');
    const taken = new Set(sites.map((site) => normalizeCode(site.code)));
    let code = '';
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const candidate = `EC-${1000 + Math.floor(Math.random() * 9000)}`;
      if (!taken.has(normalizeCode(candidate))) {
        code = candidate;
        break;
      }
    }
    if (!code) throw new StoreError('code-collision', '현장 코드를 만들지 못했습니다. 다시 시도해 주세요.');

    const today = new Date();
    const startDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const site = {
      id: uid('site'),
      code,
      name,
      clientName: String(input.clientName || name).trim(),
      category,
      address: String(input.address || '').trim(),
      area: String(input.area || '').trim(),
      frequency: String(input.frequency || '주 1회 (일정 협의)').trim(),
      intervalDays: Number(input.intervalDays) || 7,
      startDate: String(input.startDate || startDate),
      manager: String(input.manager || '').trim(),
      managerRole: String(input.managerRole || '팀장').trim(),
      accessNote: String(input.accessNote || '').trim(),
      contactName: String(input.contactName || '').trim(),
      bizNumber: String(input.bizNumber || '').trim(),
      ceoName: String(input.ceoName || '').trim(),
      taxEmail: String(input.taxEmail || '').trim(),
      contract: normalizeContract(input.contract),
      ops: normalizeOps(input.ops),
      bizLicense: input.bizLicense && typeof input.bizLicense === 'object' ? input.bizLicense : null,
      contractMemo: toText(input.contractMemo),
      checklist: (DEFAULT_CHECKLISTS[category] || DEFAULT_CHECKLISTS.office).slice(),
      locked: true,
      baseline: normalizeBaseline(input.baseline),
      createdAt: new Date().toISOString(),
      source: 'app',
    };

    await this.adapter.put('sites', site);
    await this.assignLeadersToSite(site.id, input.leaderIds || []);
    this._notify();
    return site;
  }

  async updateSite(id, patch = {}) {
    const site = await this.getSite(id);
    if (!site) throw new StoreError('no-site', '현장을 찾을 수 없습니다.');
    const next = { ...site, ...patch, id: site.id, updatedAt: new Date().toISOString() };
    if (patch.baseline) next.baseline = normalizeBaseline(patch.baseline);
    if (patch.contract !== undefined) next.contract = normalizeContract(patch.contract);
    if (patch.ops !== undefined) next.ops = normalizeOps(patch.ops);
    await this.adapter.put('sites', next);
    this._notify();
    return next;
  }

  /** Alias kept for the documented admin API (새 현장 등록). */
  async createSite(input = {}) {
    return this.addSite(input);
  }

  /**
   * 관리자 화면의 현장 계약 · 운영 정보 저장.
   * `contract` / `ops` patches are merged into the stored objects key by key, so a
   * form that edits only some fields never wipes the others.
   */
  async updateSiteDetails(siteId, patch = {}) {
    const site = await this.getSite(siteId);
    if (!site) throw new StoreError('no-site', '현장을 찾을 수 없습니다.');
    const next = { ...site };
    if (patch.contract && typeof patch.contract === 'object') {
      next.contract = normalizeContract({ ...site.contract, ...patch.contract });
    }
    if (patch.ops && typeof patch.ops === 'object') {
      next.ops = normalizeOps({ ...site.ops, ...patch.ops });
    }
    for (const key of ['name', 'clientName', 'address', 'area', 'frequency', 'contactName', 'bizNumber', 'ceoName', 'taxEmail', 'manager', 'managerRole', 'accessNote']) {
      if (patch[key] !== undefined) next[key] = String(patch[key]).trim();
    }
    if (patch.category && Object.prototype.hasOwnProperty.call(DEFAULT_CHECKLISTS, patch.category)) {
      next.category = patch.category;
    }
    if (patch.bizLicense !== undefined) {
      next.bizLicense = patch.bizLicense && typeof patch.bizLicense === 'object' ? patch.bizLicense : null;
    }
    if (patch.contractMemo !== undefined) next.contractMemo = toText(patch.contractMemo);
    if (typeof next.name !== 'string' || !next.name.trim()) {
      throw new StoreError('name-empty', '현장명(상호)을 입력해 주세요.');
    }
    next.updatedAt = new Date().toISOString();
    await this.adapter.put('sites', next);
    this._notify();
    return next;
  }

  /** 전체 매출 정리 — 행별 내역과 합계 (관리자 화면 전용). */
  async revenueSummary() {
    const sites = (await this.listSites()).filter((site) => site.active !== false);
    return { rows: sites.map(contractRow), totals: revenueTotals(sites) };
  }

  /** Give the chosen team leaders this site (never removes their other sites). */
  async assignLeadersToSite(siteId, leaderIds = []) {
    const wanted = new Set((leaderIds || []).filter(Boolean));
    if (!wanted.size) return [];
    const accounts = await this.adapter.getAll('accounts');
    const updated = [];
    for (const account of accounts) {
      if (account.role !== 'leader' || !wanted.has(account.id)) continue;
      const current = new Set(account.assignedSiteIds || []);
      if (current.has(siteId)) continue;
      current.add(siteId);
      const next = { ...account, assignedSiteIds: [...current], updatedAt: new Date().toISOString() };
      await this.adapter.put('accounts', next);
      updated.push(next);
    }
    return updated;
  }

  /** Save the 첫 견적(오염) or 첫 청소(대청소) record of a site. */
  async saveSiteBaseline(siteId, stage, patch = {}) {
    if (!BASELINE_STAGES.includes(stage)) throw new StoreError('bad-stage', '사진 단계를 확인해 주세요.');
    const site = await this.getSite(siteId);
    if (!site) throw new StoreError('no-site', '현장을 찾을 수 없습니다.');
    const baseline = normalizeBaseline(site.baseline);
    const current = baseline[stage];
    baseline[stage] = {
      date: patch.date !== undefined ? String(patch.date) : current.date,
      note: patch.note !== undefined ? String(patch.note) : current.note,
      photos: Array.isArray(patch.photos) ? patch.photos.slice() : current.photos,
    };
    const next = { ...site, baseline, updatedAt: new Date().toISOString() };
    await this.adapter.put('sites', next);
    this._notify();
    return next;
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

  /* ---------------- quotes (견적 · 대표 전용) ---------------- */

  async _nextDocNumber(table, prefix) {
    const rows = await this.adapter.getAll(table);
    const year = new Date().getFullYear();
    const head = `${prefix}-${year}-`;
    const used = rows.filter((row) => toText(row.no).startsWith(head)).length;
    return `${head}${String(used + 1).padStart(3, '0')}`;
  }

  async _nextInviteCode() {
    const rows = await this.adapter.getAll('quotes');
    const taken = new Set(rows.map((row) => normalizeCode(row.inviteCode)));
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const candidate = `Q-${randomCode(6)}`;
      if (!taken.has(normalizeCode(candidate))) return candidate;
    }
    throw new StoreError('code-collision', '초대코드를 생성하지 못했습니다. 다시 시도해 주세요.');
  }

  async listQuotes({ siteId = null, status = null } = {}) {
    let rows = (await this.adapter.getAll('quotes')).map(normalizeQuote);
    if (siteId) rows = rows.filter((quote) => quote.siteId === siteId);
    if (status) rows = rows.filter((quote) => quote.status === status);
    return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async getQuote(id) {
    const row = await this.adapter.get('quotes', id);
    return row ? normalizeQuote(row) : null;
  }

  /** 견적 등록 — 저장과 동시에 1회용 초대코드를 발급합니다. */
  async addQuote(input = {}) {
    const company = toText(input.clientCompany);
    if (!company) throw new StoreError('company-empty', '고객사명(상호)을 입력해 주세요.');
    const amount = toAmount(input.amount);
    if (!amount) throw new StoreError('amount-empty', '월 계약금액을 입력해 주세요.');

    const months = Number(input.periodMonths) > 0 ? Math.round(Number(input.periodMonths)) : 12;
    const startDate = toText(input.startDate) || todayISO();
    const endDate = toText(input.endDate) || addMonthsISO(startDate, months);
    const now = new Date().toISOString();
    const validUntil = toText(input.validUntil) || addDaysISO(todayISO(), QUOTE_VALID_DAYS);
    const quote = normalizeQuote({
      ...input,
      id: uid('quote'),
      no: toText(input.no) || (await this._nextDocNumber('quotes', 'Q')),
      clientCompany: company,
      amount,
      periodMonths: months,
      startDate,
      endDate,
      validUntil,
      status: 'draft',
      photos: Array.isArray(input.photos) ? input.photos.slice() : [],
      inviteCode: await this._nextInviteCode(),
      inviteIssuedAt: now,
      inviteUsedAt: '',
      inviteUsedBy: '',
      createdAt: now,
      updatedAt: now,
      source: 'app',
    });
    await this.adapter.put('quotes', quote);
    this._notify();
    return quote;
  }

  async updateQuote(id, patch = {}) {
    const quote = await this.getQuote(id);
    if (!quote) throw new StoreError('no-quote', '견적을 찾을 수 없습니다.');
    const next = normalizeQuote({
      ...quote,
      ...patch,
      id: quote.id,
      inviteCode: quote.inviteCode,
      createdAt: quote.createdAt,
      updatedAt: new Date().toISOString(),
    });
    if (!next.clientCompany) throw new StoreError('company-empty', '고객사명(상호)을 입력해 주세요.');
    if (!next.amount) throw new StoreError('amount-empty', '월 계약금액을 입력해 주세요.');
    await this.adapter.put('quotes', next);
    this._notify();
    return next;
  }

  /** 견적서 발송 — 고객 방에서 열람할 수 있는 상태로 바꿉니다. */
  async sendQuote(id) {
    const quote = await this.getQuote(id);
    if (!quote) throw new StoreError('no-quote', '견적을 찾을 수 없습니다.');
    if (quote.status === 'contracted') return quote;
    const now = new Date().toISOString();
    const next = { ...quote, status: 'sent', sentAt: quote.sentAt || now, updatedAt: now };
    await this.adapter.put('quotes', next);
    this._notify();
    return normalizeQuote(next);
  }

  /** 초대코드 재발급 — 이전 코드는 즉시 쓸 수 없게 됩니다. */
  async regenerateQuoteInvite(id) {
    const quote = await this.getQuote(id);
    if (!quote) throw new StoreError('no-quote', '견적을 찾을 수 없습니다.');
    const now = new Date().toISOString();
    const next = {
      ...quote,
      inviteCode: await this._nextInviteCode(),
      inviteIssuedAt: now,
      inviteUsedAt: '',
      inviteUsedBy: '',
      invitedPhone: '',
      updatedAt: now,
    };
    await this.adapter.put('quotes', next);
    this._notify();
    return normalizeQuote(next);
  }

  async findQuoteByInviteCode(code) {
    const needle = normalizeCode(code);
    if (!needle) return null;
    const rows = (await this.adapter.getAll('quotes')).map(normalizeQuote);
    return rows.find((quote) => normalizeCode(quote.inviteCode) === needle) || null;
  }

  /**
   * 1회용 초대코드로 견적 방 입장 — 아직 현장이 없는 고객도 견적서 · 계약서를
   * 볼 수 있도록 계정에 `quoteId`를 연결합니다. 계약 체결 시 `siteId`로 바뀝니다.
   */
  async enterQuoteRoomWithCode({ phone, code, name = '', title = '' }) {
    const digits = normalizePhone(phone);
    if (!digits) throw new StoreError('phone-empty', '전화번호를 입력해 주세요.');
    const needle = normalizeCode(code);
    if (!needle) throw new StoreError('code-required', '1회용 초대코드를 입력해 주세요.');

    const quote = await this.findQuoteByInviteCode(needle);
    if (!quote) throw new StoreError('invite-not-found', '등록되지 않은 초대코드입니다. 코드를 다시 확인해 주세요.');
    if (quote.inviteUsedAt) {
      throw new StoreError('invite-used', '이미 사용된 초대코드입니다. 대표에게 새 코드를 요청해 주세요.');
    }
    if (quote.status === 'draft') {
      throw new StoreError('invite-draft', '아직 발송 전인 견적입니다. 대표에게 확인해 주세요.');
    }
    if (quote.status === 'contracted' && quote.siteId) {
      throw new StoreError('invite-contracted', '이미 계약이 체결된 견적입니다. 등록된 번호로 입장해 주세요.');
    }

    const accounts = await this.adapter.getAll('accounts');
    let account = accounts.find((row) => row.role === 'customer' && normalizePhone(row.phone) === digits) || null;
    if (account && account.active === false) {
      throw new StoreError('inactive', '사용이 중지된 번호입니다. 대표에게 문의해 주세요.');
    }
    if (account && account.siteId) {
      throw new StoreError('other-site', '이미 다른 현장에 등록된 번호입니다. 대표에게 문의해 주세요.');
    }

    if (!account) {
      let nameValue = toText(name);
      let titleValue = toText(title);
      if (!titleValue && /\s/.test(nameValue)) {
        const parts = nameValue.split(/\s+/);
        nameValue = parts[0];
        titleValue = parts.slice(1).join(' ');
      }
      account = {
        id: uid('acc_customer'),
        role: 'customer',
        name: nameValue || `고객 ${digits.slice(-4)}`,
        title: titleValue || '담당자',
        phone: digits,
        phonePretty: prettyPhone(digits),
        password: '',
        siteId: '',
        quoteId: quote.id,
        active: true,
        createdAt: new Date().toISOString(),
        source: 'quote-invite',
      };
    } else {
      account = { ...account, quoteId: quote.id, updatedAt: new Date().toISOString() };
    }
    await this.adapter.put('accounts', account);

    const now = new Date().toISOString();
    const consumed = { ...quote, inviteUsedAt: now, inviteUsedBy: account.id, invitedPhone: digits, updatedAt: now };
    await this.adapter.put('quotes', consumed);
    this._notify();
    return { account, quote: normalizeQuote(consumed) };
  }

  /* ---------------- contracts (도급 계약서 · 대표 전용) ---------------- */

  async listAgreements({ siteId = null, status = null } = {}) {
    let rows = (await this.adapter.getAll('contracts')).map(normalizeAgreement);
    if (siteId) rows = rows.filter((row) => row.siteId === siteId);
    if (status) rows = rows.filter((row) => row.status === status);
    return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async getAgreement(id) {
    const row = await this.adapter.get('contracts', id);
    return row ? normalizeAgreement(row) : null;
  }

  async getAgreementByQuote(quoteId) {
    if (!quoteId) return null;
    const rows = (await this.adapter.getAll('contracts')).map(normalizeAgreement);
    return rows.find((row) => row.quoteId === quoteId) || null;
  }

  /** 견적을 표준 도급 계약서로 전환합니다 (이미 있으면 그 계약서). */
  async createAgreementFromQuote(quoteId) {
    const quote = await this.getQuote(quoteId);
    if (!quote) throw new StoreError('no-quote', '견적을 찾을 수 없습니다.');
    const existing = await this.getAgreementByQuote(quote.id);
    if (existing) return existing;

    const now = new Date().toISOString();
    const agreement = normalizeAgreement({
      id: uid('contract'),
      no: await this._nextDocNumber('contracts', 'CT'),
      quoteId: quote.id,
      siteId: quote.siteId,
      status: 'draft',
      clientAddress: quote.clientAddress,
      clientBusinessName: quote.clientCompany,
      clientBizNumber: quote.clientBizNumber,
      clientCeo: '',
      contactName: quote.clientContact,
      contactPhone: quote.clientPhone,
      startDate: quote.startDate,
      endDate: quote.endDate,
      months: quote.periodMonths,
      amount: quote.amount,
      vatIncluded: quote.vatIncluded,
      billingDay: quote.billingDay,
      scope: quote.scope,
      extraScope: quote.extraScope,
      frequency: quote.frequency,
      specialTerms: [quote.terms, quote.memo].filter(Boolean).join('\n'),
      createdAt: now,
      updatedAt: now,
      source: 'app',
    });
    await this.adapter.put('contracts', agreement);
    const nextQuote = normalizeQuote({ ...quote, status: quote.status === 'sent' ? 'accepted' : quote.status, updatedAt: now });
    await this.adapter.put('quotes', nextQuote);
    this._notify();
    return agreement;
  }

  async updateAgreement(id, patch = {}) {
    const agreement = await this.getAgreement(id);
    if (!agreement) throw new StoreError('no-contract', '계약서를 찾을 수 없습니다.');
    if (agreement.status === 'signed') {
      throw new StoreError('already-signed', '체결된 계약서는 수정할 수 없습니다.');
    }
    const next = normalizeAgreement({
      ...agreement,
      ...patch,
      id: agreement.id,
      quoteId: agreement.quoteId,
      createdAt: agreement.createdAt,
      updatedAt: new Date().toISOString(),
    });
    await this.adapter.put('contracts', next);
    this._notify();
    return next;
  }

  /** 계약서에 붙는 고객사 사업자등록증 · 특이사항 (체결 후에도 고칠 수 있음). */
  async updateAgreementMeta(id, patch = {}) {
    const agreement = await this.getAgreement(id);
    if (!agreement) throw new StoreError('no-contract', '계약서를 찾을 수 없습니다.');
    const next = normalizeAgreement({
      ...agreement,
      bizLicense: patch.bizLicense !== undefined ? patch.bizLicense : agreement.bizLicense,
      contractMemo: patch.contractMemo !== undefined ? patch.contractMemo : agreement.contractMemo,
      updatedAt: new Date().toISOString(),
    });
    await this.adapter.put('contracts', next);
    this._notify();
    return next;
  }

  /** 계약서를 고객에게 보냅니다 (고객 방에 ‘서명’ 카드가 뜨는 상태). */
  async sendAgreement(id) {
    const agreement = await this.getAgreement(id);
    if (!agreement) throw new StoreError('no-contract', '계약서를 찾을 수 없습니다.');
    if (agreement.status === 'signed') return agreement;
    const now = new Date().toISOString();
    const next = { ...agreement, status: 'sent', updatedAt: now };
    await this.adapter.put('contracts', next);
    this._notify();
    return normalizeAgreement(next);
  }

  /**
   * 계약 체결 — 서명 · 갑 정보를 저장하고, 같은 건을 정식 정기청소 현장(sites)으로
   * 자동 등록합니다. 계약금 · 계약일 · 청소 공정 · 첫 견적(오염) 사진이 그대로
   * 넘어가 관리자 매출 정리와 고객 방 3단계 비교에 바로 표시됩니다.
   */
  async signAgreement(contractId, payload = {}) {
    const agreement = await this.getAgreement(contractId);
    if (!agreement) throw new StoreError('no-contract', '계약서를 찾을 수 없습니다.');
    if (agreement.status === 'signed' && agreement.siteId) {
      return { agreement, site: await this.getSite(agreement.siteId) };
    }

    const quote = agreement.quoteId ? await this.getQuote(agreement.quoteId) : null;
    const client = {
      address: toText(payload.address) || agreement.clientAddress,
      businessName:
        toText(payload.businessName) || agreement.clientBusinessName || (quote ? quote.clientCompany : ''),
      bizNumber: toText(payload.bizNumber) || agreement.clientBizNumber,
      ceo: toText(payload.ceo) || agreement.clientCeo,
    };
    if (!client.businessName) {
      throw new StoreError('company-empty', '사업자명(상호)을 입력해 주세요.');
    }

    const signedDate = toText(payload.signedDate) || todayISO();
    const now = new Date().toISOString();
    const category = quote && DEFAULT_CHECKLISTS[quote.clientCategory] ? quote.clientCategory : 'office';
    const frequency = agreement.frequency || (quote ? quote.frequency : '') || '주 1회 (일정 협의)';
    const process =
      [agreement.scope || (quote ? quote.scope : ''), agreement.extraScope || (quote ? quote.extraScope : '')]
        .filter(Boolean)
        .join(' → ') || '';
    const note = `${agreement.months}개월 · 부가세 ${agreement.vatIncluded ? '포함' : '별도'} · ${frequency}`;

    let site = agreement.siteId ? await this.getSite(agreement.siteId) : null;
    if (!site) {
      site = (await this.listSites()).find((row) => row.name === client.businessName) || null;
    }

    if (!site) {
      site = await this.addSite({
        name: client.businessName,
        clientName: client.businessName,
        category,
        address: client.address,
        area: quote ? quote.area : '',
        frequency,
        intervalDays: intervalFromFrequency(frequency),
        startDate: agreement.startDate || signedDate,
        contactName: agreement.contactName || (quote ? quote.clientContact : ''),
        bizNumber: client.bizNumber,
        ceoName: client.ceo,
        taxEmail: quote ? quote.clientTaxEmail : '',
        contract: {
          contractAmount: agreement.amount,
          subcontractAmount: 0,
          feeAmount: 0,
          contractDate: agreement.startDate || signedDate,
          billingDay: `매월 ${agreement.billingDay}일`,
          note,
        },
        ops: { process, accessMethod: '', trashLocation: '', parkingMethod: '' },
        baseline: {
          quote: {
            date: signedDate,
            note: '계약 전 견적 방문 · 오염 상태',
            photos: quote ? quote.photos.slice() : [],
          },
        },
      });
    } else {
      const contract = site.contract || normalizeContract(null);
      site = await this.updateSiteDetails(site.id, {
        contract: {
          ...contract,
          contractAmount: agreement.amount,
          contractDate: contract.contractDate || agreement.startDate || signedDate,
          billingDay: contract.billingDay || `매월 ${agreement.billingDay}일`,
        },
        ops: site.ops && site.ops.process ? site.ops : { process },
      });
    }

    const nextAgreement = normalizeAgreement({
      ...agreement,
      status: 'signed',
      siteId: site.id,
      clientAddress: client.address,
      clientBusinessName: client.businessName,
      clientBizNumber: client.bizNumber,
      clientCeo: client.ceo,
      signedDate,
      signedByName: client.ceo || agreement.signedByName,
      signature: toText(payload.signature) || agreement.signature,
      signedAt: now,
      updatedAt: now,
    });
    await this.adapter.put('contracts', nextAgreement);

    if (quote) {
      await this.adapter.put(
        'quotes',
        normalizeQuote({ ...quote, siteId: site.id, status: 'contracted', contractedAt: now, updatedAt: now }),
      );
    }

    // 견적 방에 있던 고객 계정을 새 현장 방으로 옮깁니다.
    const accounts = await this.adapter.getAll('accounts');
    for (const account of accounts) {
      if (account.role !== 'customer') continue;
      if (quote && account.quoteId === quote.id) {
        await this.adapter.put('accounts', {
          ...account,
          siteId: site.id,
          quoteId: '',
          updatedAt: now,
        });
        await this.createGrant(account.id, site.id, '');
      }
    }

    this._notify();
    return { agreement: normalizeAgreement(nextAgreement), site };
  }

  /* ---------------- staff contracts (직원 계약 · 직원관리방) ---------------- */

  async listStaffContracts({ accountId = null, siteId = null, status = null } = {}) {
    let rows = (await this.adapter.getAll('staffContracts')).map(normalizeStaffContract);
    if (accountId) rows = rows.filter((row) => row.accountId === accountId);
    if (siteId) rows = rows.filter((row) => row.siteIds.includes(siteId));
    if (status) rows = rows.filter((row) => row.status === status);
    return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async getStaffContract(id) {
    const row = await this.adapter.get('staffContracts', id);
    return row ? normalizeStaffContract(row) : null;
  }

  async findStaffContractByInviteCode(code) {
    const needle = normalizeCode(code);
    if (!needle) return null;
    const rows = (await this.adapter.getAll('staffContracts')).map(normalizeStaffContract);
    return rows.find((row) => normalizeCode(row.inviteCode) === needle) || null;
  }

  async _nextLeaderCode() {
    const rows = await this.adapter.getAll('accounts');
    const taken = new Set(rows.map((row) => normalizeCode(row.leaderCode || '')));
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const candidate = `TL-${String(1000 + Math.floor(Math.random() * 9000))}`;
      if (!taken.has(normalizeCode(candidate))) return candidate;
    }
    throw new StoreError('code-collision', '팀장 코드를 생성하지 못했습니다. 다시 시도해 주세요.');
  }

  async _nextStaffInviteCode() {
    const rows = await this.adapter.getAll('staffContracts');
    const taken = new Set(rows.map((row) => normalizeCode(row.inviteCode)));
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const candidate = `S-${randomCode(6)}`;
      if (!taken.has(normalizeCode(candidate))) return candidate;
    }
    throw new StoreError('code-collision', '직원 초대코드를 생성하지 못했습니다. 다시 시도해 주세요.');
  }

  /** 직원 계약 등록 — 저장과 동시에 1회용 직원 초대코드를 발급합니다. */
  async addStaffContract(input = {}) {
    const name = toText(input.name);
    if (!name) throw new StoreError('staff-name-empty', '직원 성명을 입력해 주세요.');
    const phone = normalizePhone(input.phone);
    if (!phone) throw new StoreError('staff-phone-empty', '직원 연락처를 입력해 주세요.');
    const type = STAFF_TYPES[input.employmentType] ? input.employmentType : 'freelancer';
    const monthlyAmount = toAmount(input.monthlyAmount);
    const dailyAmount = toAmount(input.dailyAmount);
    const hourlyAmount = toAmount(input.hourlyAmount);
    const required = type === 'daily' ? !dailyAmount : type === 'parttime' ? !hourlyAmount : !monthlyAmount;
    if (required) {
      throw new StoreError(
        'staff-amount-empty',
        type === 'daily' ? '일당을 입력해 주세요.' : type === 'parttime' ? '시급을 입력해 주세요.' : '월 금액을 입력해 주세요.',
      );
    }

    const now = new Date().toISOString();
    const contract = normalizeStaffContract({
      ...input,
      id: uid('staff'),
      no: toText(input.no) || (await this._nextDocNumber('staffContracts', 'S')),
      name,
      phone,
      employmentType: type,
      monthlyAmount,
      dailyAmount,
      hourlyAmount,
      status: 'draft',
      inviteCode: await this._nextStaffInviteCode(),
      inviteIssuedAt: now,
      inviteUsedAt: '',
      inviteUsedBy: '',
      createdAt: now,
      updatedAt: now,
      source: 'app',
    });
    await this.adapter.put('staffContracts', contract);
    this._notify();
    return contract;
  }

  async updateStaffContract(id, patch = {}) {
    const contract = await this.getStaffContract(id);
    if (!contract) throw new StoreError('no-staff-contract', '직원 계약서를 찾을 수 없습니다.');
    if (contract.status === 'signed') {
      throw new StoreError('already-signed', '체결된 계약서는 수정할 수 없습니다.');
    }
    const next = normalizeStaffContract({
      ...contract,
      ...patch,
      id: contract.id,
      inviteCode: contract.inviteCode,
      createdAt: contract.createdAt,
      updatedAt: new Date().toISOString(),
    });
    await this.adapter.put('staffContracts', next);
    this._notify();
    return next;
  }

  /** 직원에게 계약서를 보냅니다 (직원관리방에 ‘서명 대기’로 표시). */
  async sendStaffContract(id) {
    const contract = await this.getStaffContract(id);
    if (!contract) throw new StoreError('no-staff-contract', '직원 계약서를 찾을 수 없습니다.');
    if (contract.status === 'signed') return contract;
    const next = { ...contract, status: 'sent', updatedAt: new Date().toISOString() };
    await this.adapter.put('staffContracts', next);
    this._notify();
    return normalizeStaffContract(next);
  }

  async regenerateStaffInvite(id) {
    const contract = await this.getStaffContract(id);
    if (!contract) throw new StoreError('no-staff-contract', '직원 계약서를 찾을 수 없습니다.');
    const now = new Date().toISOString();
    const next = {
      ...contract,
      inviteCode: await this._nextStaffInviteCode(),
      inviteIssuedAt: now,
      inviteUsedAt: '',
      inviteUsedBy: '',
      updatedAt: now,
    };
    await this.adapter.put('staffContracts', next);
    this._notify();
    return normalizeStaffContract(next);
  }

  /**
   * 1회용 직원 초대코드로 직원관리방 입장. 처음 한 번은 코드가 필요하고,
   * 그 뒤에는 같은 번호로 바로 들어옵니다(`staffAccess`).
   */
  async enterStaffRoomWithCode({ phone, code, name = '' }) {
    const digits = normalizePhone(phone);
    if (!digits) throw new StoreError('phone-empty', '전화번호를 입력해 주세요.');
    const needle = normalizeCode(code);
    if (!needle) throw new StoreError('staff-code-required', '1회용 직원 초대코드를 입력해 주세요.');

    const contract = await this.findStaffContractByInviteCode(needle);
    if (!contract) throw new StoreError('staff-code-not-found', '등록되지 않은 직원 초대코드입니다.');
    if (contract.inviteUsedAt) {
      throw new StoreError('staff-code-used', '이미 사용된 초대코드입니다. 대표에게 새 코드를 요청해 주세요.');
    }
    if (contract.status === 'draft') {
      throw new StoreError('staff-code-draft', '아직 발송 전인 계약서입니다. 대표에게 확인해 주세요.');
    }

    const accounts = await this.adapter.getAll('accounts');
    let account = accounts.find((row) => normalizePhone(row.phone) === digits) || null;
    if (account && account.role === 'customer') {
      throw new StoreError('staff-customer', '고객 번호로는 직원관리방에 입장할 수 없습니다.');
    }
    if (account && contract.accountId && account.id !== contract.accountId) {
      throw new StoreError('staff-other', '다른 직원에게 발급된 초대코드입니다.');
    }
    if (account && account.active === false) {
      throw new StoreError('inactive', '사용이 중지된 계정입니다. 대표에게 문의해 주세요.');
    }

    const siteIds = contract.siteIds.slice();
    if (!account) {
      account = {
        id: uid('acc_staff'),
        role: 'leader',
        name: contract.name || toText(name) || `직원 ${digits.slice(-4)}`,
        title: contract.roleTitle || '팀장',
        phone: digits,
        phonePretty: prettyPhone(digits),
        password: '',
        leaderCode: await this._nextLeaderCode(),
        assignedSiteIds: siteIds,
        staffAccess: true,
        employmentType: contract.employmentType,
        active: true,
        createdAt: new Date().toISOString(),
        source: 'staff-invite',
      };
    } else {
      const assigned = new Set(account.assignedSiteIds || []);
      siteIds.forEach((id) => assigned.add(id));
      account = {
        ...account,
        staffAccess: true,
        employmentType: contract.employmentType,
        assignedSiteIds: [...assigned],
        updatedAt: new Date().toISOString(),
      };
    }
    await this.adapter.put('accounts', account);

    const now = new Date().toISOString();
    const consumed = { ...contract, accountId: account.id, inviteUsedAt: now, inviteUsedBy: account.id, updatedAt: now };
    await this.adapter.put('staffContracts', consumed);
    this._notify();
    return { account, contract: normalizeStaffContract(consumed) };
  }

  /** 직원 전자서명 — 체결 완료로 저장합니다. */
  async signStaffContract(id, payload = {}) {
    const contract = await this.getStaffContract(id);
    if (!contract) throw new StoreError('no-staff-contract', '직원 계약서를 찾을 수 없습니다.');
    if (contract.status === 'signed') return contract;
    const now = new Date().toISOString();
    const next = normalizeStaffContract({
      ...contract,
      status: 'signed',
      signature: toText(payload.signature) || contract.signature,
      signedDate: toText(payload.signedDate) || todayISO(),
      signedByName: toText(payload.name) || contract.name,
      signedAt: now,
      updatedAt: now,
    });
    await this.adapter.put('staffContracts', next);
    this._notify();
    return next;
  }

  /* ---------------- staff checks (근무태도 A~F · 본부장 체크) ---------------- */

  async listStaffChecks({ staffContractId = null, accountId = null, siteId = null } = {}) {
    let rows = (await this.adapter.getAll('staffChecks')).map(normalizeStaffCheck);
    if (staffContractId) rows = rows.filter((row) => row.staffContractId === staffContractId);
    if (accountId) rows = rows.filter((row) => row.accountId === accountId);
    if (siteId) rows = rows.filter((row) => row.siteId === siteId);
    return rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  /** 본부장이 근무태도를 A~F로 체크합니다. */
  async addStaffCheck(input = {}) {
    const contract = await this.getStaffContract(input.staffContractId);
    if (!contract) throw new StoreError('no-staff-contract', '직원 계약을 찾을 수 없습니다.');
    const grade = String(input.grade || '').toUpperCase();
    if (!STAFF_GRADES.includes(grade)) throw new StoreError('bad-grade', '근무태도 등급은 A~F 중에서 고르세요.');
    const check = normalizeStaffCheck({
      id: uid('chk'),
      staffContractId: contract.id,
      accountId: contract.accountId,
      name: contract.name,
      siteId: toText(input.siteId) || contract.siteIds[0] || '',
      date: toText(input.date) || todayISO(),
      grade,
      memo: toText(input.memo),
      reviewerId: toText(input.reviewerId),
      reviewerName: toText(input.reviewerName),
      createdAt: new Date().toISOString(),
      source: 'app',
    });
    await this.adapter.put('staffChecks', check);
    this._notify();
    return check;
  }

  /* ---------------- 청소장비 · 배접봉투 (대표 · 구입 직원) ---------------- */

  async listSupplyCatalog({ activeOnly = true } = {}) {
    let rows = (await this.adapter.getAll('supplyCatalog')).map(normalizeSupplyItem);
    if (activeOnly) rows = rows.filter((row) => row.active !== false);
    return rows.sort(
      (a, b) => a.sort - b.sort || String(a.name).localeCompare(String(b.name), 'ko'),
    );
  }

  async getSupplyItem(id) {
    const row = await this.adapter.get('supplyCatalog', id);
    return row ? normalizeSupplyItem(row) : null;
  }

  /** 새 품목 등록 — 대표 전용. */
  async addSupplyItem(input = {}, { actor } = {}) {
    requireSupplyEditor(actor);
    const name = toText(input.name);
    if (!name) throw new StoreError('supply-name-empty', '품목명을 입력해 주세요.');
    const rows = (await this.adapter.getAll('supplyCatalog')).map(normalizeSupplyItem);
    if (rows.some((row) => row.name === name)) {
      throw new StoreError('supply-name-taken', '같은 이름의 품목이 이미 있습니다.');
    }
    const now = new Date().toISOString();
    const maxSort = rows.reduce((max, row) => Math.max(max, row.sort), 0);
    const item = normalizeSupplyItem({
      ...input,
      id: uid('sup'),
      name,
      sort: Number.isFinite(Number(input.sort)) ? input.sort : maxSort + 1,
      active: true,
      createdAt: now,
      updatedAt: now,
      source: 'app',
    });
    await this.adapter.put('supplyCatalog', item);
    this._notify();
    return item;
  }

  /** 단가 · 이름 · 비고 수정 — 대표 전용. */
  async updateSupplyItem(id, patch = {}, { actor } = {}) {
    requireSupplyEditor(actor);
    const row = await this.adapter.get('supplyCatalog', id);
    if (!row) throw new StoreError('no-supply-item', '품목을 찾지 못했습니다.');
    const next = normalizeSupplyItem({
      ...row,
      ...patch,
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: new Date().toISOString(),
    });
    if (!next.name) throw new StoreError('supply-name-empty', '품목명을 입력해 주세요.');
    await this.adapter.put('supplyCatalog', next);
    this._notify();
    return next;
  }

  /**
   * 품목 삭제 — 이미 영수증·신청에 쓰인 품목은 지우지 않고 목록에서만 감춥니다(active:false).
   * 지난 영수증의 품목·단가는 한 줄도 바뀌지 않습니다.
   */
  async removeSupplyItem(id, { actor } = {}) {
    requireSupplyEditor(actor);
    const row = await this.adapter.get('supplyCatalog', id);
    if (!row) throw new StoreError('no-supply-item', '품목을 찾지 못했습니다.');
    const orders = await this.adapter.getAll('supplyOrders');
    const used = orders.some((order) => (order.items || []).some((line) => line.catalogId === id));
    if (used) {
      const next = normalizeSupplyItem({ ...row, active: false, updatedAt: new Date().toISOString() });
      await this.adapter.put('supplyCatalog', next);
      this._notify();
      return { removed: false, item: next };
    }
    await this.adapter.remove('supplyCatalog', id);
    this._notify();
    return { removed: true, item: normalizeSupplyItem(row) };
  }

  async listSupplyOrders({ accountId = null, status = null } = {}) {
    let rows = (await this.adapter.getAll('supplyOrders')).map(normalizeSupplyOrder);
    if (accountId) rows = rows.filter((row) => row.toAccountId === accountId || row.requesterAccountId === accountId);
    if (status) rows = rows.filter((row) => row.status === status);
    return rows.sort((a, b) =>
      String(b.issuedAt || b.requestedAt || b.createdAt).localeCompare(String(a.issuedAt || a.requestedAt || a.createdAt)),
    );
  }

  async getSupplyOrder(id) {
    const row = await this.adapter.get('supplyOrders', id);
    return row ? normalizeSupplyOrder(row) : null;
  }

  /** 직원의 구입 신청 — 단가는 신청 시점의 품목 단가를 복사해 둡니다. */
  async createSupplyRequest(input = {}, { actor } = {}) {
    requireSupplyUser(actor);
    const accountId = toText(input.accountId) || toText(actor && actor.accountId);
    const name = toText(input.name) || toText(actor && actor.name) || '직원';
    const catalog = new Map(
      (await this.adapter.getAll('supplyCatalog')).map((row) => {
        const item = normalizeSupplyItem(row);
        return [item.id, item];
      }),
    );
    const items = [];
    for (const row of Array.isArray(input.items) ? input.items : []) {
      const item = catalog.get(toText(row && row.catalogId));
      const qty = Math.max(0, Math.round(Number(row && row.qty) || 0));
      if (!item || !qty) continue;
      items.push({ catalogId: item.id, name: item.name, note: item.note, unit: item.unit, price: item.price, qty });
    }
    if (!items.length) {
      throw new StoreError('supply-items-empty', '구입할 품목과 수량을 하나 이상 골라 주세요.');
    }
    const now = new Date().toISOString();
    const order = normalizeSupplyOrder({
      id: uid('supply_order'),
      no: await this._nextDocNumber('supplyOrders', 'R'),
      status: 'requested',
      requesterAccountId: accountId,
      requesterName: name,
      toAccountId: accountId,
      toName: name,
      requestedAt: todayISO(),
      items,
      note: toText(input.note),
      createdAt: now,
      updatedAt: now,
      source: 'app',
    });
    await this.adapter.put('supplyOrders', order);
    this._notify();
    return order;
  }

  /**
   * 영수증 발행 — 대표 전용. 직원 신청건이면 그 신청을 그대로 영수증으로 확정하고,
   * 신청 없이 새로 발행할 수도 있습니다. 단가를 바꿔 발행하면 그 단가가 영수증에 남습니다.
   */
  async issueSupplyOrder(id, input = {}, { actor } = {}) {
    requireSupplyEditor(actor);
    const key = toText(id) || toText(input.id);
    const row = key ? await this.adapter.get('supplyOrders', key) : null;
    const catalog = new Map(
      (await this.adapter.getAll('supplyCatalog')).map((item) => {
        const normalized = normalizeSupplyItem(item);
        return [normalized.id, normalized];
      }),
    );
    const wanted = Array.isArray(input.items) && input.items.length ? input.items : row ? row.items : [];
    const items = [];
    for (const line of wanted) {
      const item = catalog.get(toText(line && line.catalogId));
      const qty = Math.max(0, Math.round(Number(line && line.qty) || 0));
      if (!qty) continue;
      const price =
        line && line.price !== undefined && line.price !== '' && toAmount(line.price) > 0
          ? toAmount(line.price)
          : item
            ? item.price
            : 0;
      items.push({
        catalogId: toText(line && line.catalogId) || (item ? item.id : ''),
        name: item ? item.name : toText(line && line.name),
        note: item ? item.note : toText(line && line.note),
        unit: item ? item.unit : toText(line && line.unit),
        price,
        qty,
      });
    }
    if (!items.length) {
      throw new StoreError('supply-items-empty', '영수증에 넣을 품목과 수량을 골라 주세요.');
    }
    const toName = toText(input.toName) || (row && row.toName) || '';
    if (!toName) throw new StoreError('supply-buyer-empty', '구입자 이름을 입력해 주세요.');

    const now = new Date().toISOString();
    const order = normalizeSupplyOrder({
      ...(row || {}),
      id: row ? row.id : uid('supply_order'),
      no: (row && row.no) || (await this._nextDocNumber('supplyOrders', 'R')),
      status: 'issued',
      requesterAccountId: (row && row.requesterAccountId) || toText(input.toAccountId),
      requesterName: (row && row.requesterName) || toName,
      toAccountId: toText(input.toAccountId) || (row && row.toAccountId) || '',
      toName,
      date: toText(input.date) || todayISO(),
      requestedAt: (row && row.requestedAt) || todayISO(),
      issuedAt: now,
      items,
      note: input.note !== undefined ? toText(input.note) : (row && row.note) || '',
      createdAt: (row && row.createdAt) || now,
      updatedAt: now,
      source: (row && row.source) || 'app',
    });
    await this.adapter.put('supplyOrders', order);
    this._notify();
    return order;
  }

  /** 영수증 · 신청 삭제 — 대표 전용. */
  async deleteSupplyOrder(id, { actor } = {}) {
    requireSupplyEditor(actor);
    const row = await this.adapter.get('supplyOrders', id);
    if (!row) throw new StoreError('no-supply-order', '영수증을 찾지 못했습니다.');
    await this.adapter.remove('supplyOrders', id);
    this._notify();
    return normalizeSupplyOrder(row);
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

  /**
   * Enter a customer room with a one-time code (first visit, or an extra person
   * joining an existing room). The code is consumed; the phone number becomes a
   * customer account for that site when it is new, and gets room access.
   */
  async enterCustomerRoomWithCode({ phone, code, name = '', title = '' }) {
    const digits = normalizePhone(phone);
    if (!digits) throw new StoreError('phone-empty', '전화번호를 입력해 주세요.');
    const needle = normalizeCode(code);
    if (!needle) throw new StoreError('code-required', '1회용 코드를 입력해 주세요.');

    const rows = await this.adapter.getAll('roomCodes');
    const found = rows.find((row) => normalizeCode(row.code) === needle);
    if (!found) {
      throw new StoreError('code-not-found', '등록되지 않은 청소코드입니다. 코드를 다시 확인해 주세요.');
    }
    if (found.usedAt) {
      throw new StoreError(
        'code-used',
        '이미 사용된 코드입니다. 추가 인원은 관리자에게 새 1회용 코드를 발급받아 주세요.',
      );
    }
    const site = await this.getSite(found.siteId);
    if (!site) throw new StoreError('no-site', '코드에 연결된 현장을 찾을 수 없습니다.');

    const accounts = await this.adapter.getAll('accounts');
    let account = accounts.find((row) => row.role === 'customer' && normalizePhone(row.phone) === digits) || null;
    if (account && account.active === false) {
      throw new StoreError('inactive', '사용이 중지된 번호입니다. 관리자에게 문의해 주세요.');
    }
    if (account && account.siteId && account.siteId !== site.id) {
      throw new StoreError('other-site', '이미 다른 현장에 등록된 번호입니다. 담당자에게 문의해 주세요.');
    }

    if (!account) {
      // "이수민 실장" → 이름 이수민 · 직함 실장
      let nameValue = String(name || '').trim();
      let titleValue = String(title || '').trim();
      if (!titleValue && /\s/.test(nameValue)) {
        const parts = nameValue.split(/\s+/);
        nameValue = parts[0];
        titleValue = parts.slice(1).join(' ');
      }
      account = {
        id: uid('acc_customer'),
        role: 'customer',
        name: nameValue || `고객 ${digits.slice(-4)}`,
        title: titleValue || '담당자',
        phone: digits,
        phonePretty: prettyPhone(digits),
        password: '',
        siteId: site.id,
        active: true,
        createdAt: new Date().toISOString(),
        source: 'code',
      };
      await this.adapter.put('accounts', account);
    } else if (account.siteId !== site.id) {
      account = { ...account, siteId: site.id, updatedAt: new Date().toISOString() };
      await this.adapter.put('accounts', account);
    }

    const usedAt = new Date().toISOString();
    const consumed = { ...found, usedAt, usedBy: account.id };
    await this.adapter.put('roomCodes', consumed);
    const grant = await this.createGrant(account.id, site.id, found.id);
    this._notify();
    return { account, site, grant, code: consumed };
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
