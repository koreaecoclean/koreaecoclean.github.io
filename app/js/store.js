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
 * 무료 Supabase 다중 기기 동기화 (v2.5.0)
 *  - 기기 저장소는 그대로 쓰고, 그 위에 js/supabase-client.js 의 동기화 계층을
 *    덧씌웁니다. 모든 쓰기는 기기에 먼저 저장되고 곧바로 서버에도 올라가며,
 *    5초마다 다른 기기의 변경을 받아 옵니다.
 *  - 서버 스키마: supabase-schema.sql
 */

import { attachSupabaseSync } from './supabase-client.js';
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
  CLEANING_MANUALS,
  buildFastfiveManual,
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

/**
 * 청소 보고 상태 — 팀장이 등록하면 `pending`(관리자 확인 대기),
 * 최고관리자(대표)가 확인해 고객사에 제출하면 `submitted`(고객사 제출 완료)입니다.
 * 고객 방에는 `submitted` 만 보입니다.
 */
export const REPORT_STATUS = {
  pending: { label: '관리자 확인 대기', short: '확인 대기', badge: 'badge--wait' },
  submitted: { label: '고객사 제출 완료', short: '제출 완료', badge: 'badge--done' },
};

/** 상태 값이 없는 예전 보고는 이미 고객에게 보이던 기록이라 `submitted` 로 봅니다. */
export function reportStatusKey(report) {
  const key = report && report.status;
  return REPORT_STATUS[key] ? key : 'submitted';
}

export function reportStatus(report) {
  return REPORT_STATUS[reportStatusKey(report)];
}

/** 고객 방에 보여 줄 보고인지 — 승인 전 보고는 고객에게 보이지 않습니다. */
export function isReportVisible(report) {
  return reportStatusKey(report) === 'submitted';
}

function normalizeReport(report) {
  if (!report) return report;
  return {
    ...report,
    photos: normalizePhotos(report.photos),
    issueNote: report.issueNote || '',
    status: reportStatusKey(report),
    approvedAt: report.approvedAt || '',
    approvedBy: report.approvedBy || '',
    // 업장(siteId) 중심 연결 — 보고서도 어느 계약 · 어느 팀장 계약의 작업인지 가집니다.
    contractId: toText(report.contractId),
    staffContractId: toText(report.staffContractId),
    accountId: toText(report.accountId),
  };
}

/* ------------------------------------------------------------------ */
/* 연결 고리(업장 중심) · 변경 이력                                     */
/* ------------------------------------------------------------------ */

/**
 * 변경 이력은 레코드마다 최근 MAX_HISTORY 건만 보관합니다.
 * (서버 동기화되는 레코드라 무한히 커지지 않게 자릅니다.)
 */
export const MAX_HISTORY = 200;

/**
 * 이력 한 건.
 *  { id, at, actor, action, note, changes:[{field, from, to}] }
 * changes 는 값이 바뀐 칸만 담습니다(금액·담당·상태처럼 나중에 물어볼 수 있는 값).
 */
export function normalizeHistoryEntry(input) {
  const source = input && typeof input === 'object' ? input : {};
  const changes = (Array.isArray(source.changes) ? source.changes : [])
    .map((row) => ({ field: toText(row && row.field), from: toText(row && row.from), to: toText(row && row.to) }))
    .filter((row) => row.field);
  return {
    id: toText(source.id),
    at: toText(source.at),
    actor: toText(source.actor),
    action: toText(source.action),
    note: toText(source.note),
    changes,
  };
}

/** 이력 배열 — 최신이 앞. 같은 id 는 한 번만 남깁니다. */
export function normalizeHistory(list) {
  const rows = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const row = normalizeHistoryEntry(item);
    if (!row.action && !row.id) continue;
    if (row.id) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
    }
    rows.push(row);
  }
  return rows.slice(0, MAX_HISTORY);
}

/** 새 이력 한 건을 만듭니다. `at` 은 지금 시각(ISO). */
function makeHistoryEntry({ actor = '', action = '', note = '', changes = [] } = {}) {
  return normalizeHistoryEntry({
    id: uid('hist'),
    at: new Date().toISOString(),
    actor,
    action,
    note,
    changes,
  });
}

/** 이력 배열 맨 앞에 새 이력을 붙이고 MAX_HISTORY 로 자릅니다. */
function withHistory(list, entry) {
  if (!entry) return normalizeHistory(list);
  return normalizeHistory([entry, ...(Array.isArray(list) ? list : [])]);
}

/**
 * 값이 바뀐 칸만 추려 냅니다 — 이력에 "무엇이 얼마에서 얼마로" 남기기 위한 것.
 * labels 를 주면 화면에서 사람이 읽는 이름으로 보여 줍니다.
 */
export function diffFields(before, after, labels = {}) {
  const changes = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    const from = before ? before[key] : '';
    const to = after ? after[key] : '';
    const same = JSON.stringify(from ?? '') === JSON.stringify(to ?? '');
    if (same) continue;
    changes.push({ field: labels[key] || key, from: String(from ?? ''), to: String(to ?? '') });
  }
  return changes;
}

/** A site's 첫 상태 기록: ① 첫 견적(오염) ② 첫 청소(대청소). */
export const BASELINE_STAGES = ['quote', 'deepClean'];

/** 첫 상태 사진은 단계별 최대 20장까지 저장합니다. */
export const MAX_BASELINE_PHOTOS = 20;

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
/* 2단계 — 현장 방문 · 구역별 사진 · 맞춤 견적 (기획서 4·6·7장)          */
/* ------------------------------------------------------------------ */

/** 견적 방문 사진 구역 (기획서 4장). 사진마다 구역을 붙여 이력으로 보관합니다. */
export const SURVEY_PHOTO_AREAS = [
  { key: 'office', label: '사무실' },
  { key: 'restroom', label: '화장실' },
  { key: 'pantry', label: '탕비실' },
  { key: 'hallway', label: '복도' },
  { key: 'entrance', label: '출입구' },
  { key: 'glass', label: '유리' },
  { key: 'smoking', label: '흡연실' },
  { key: 'carpet', label: '카펫' },
  { key: 'etc', label: '기타' },
];

/** 방문 견적 체크리스트 기본값 (기획서 6장). 관리자가 설정에서 항목을 더하고 고칩니다. */
export const DEFAULT_QUOTE_CHECKLIST = {
  zones: [
    { key: 'office', label: '사무실', items: ['책상 주변', '바닥', '쓰레기', '먼지', '공용 테이블', '기타'] },
    { key: 'restroom', label: '화장실', items: ['변기', '세면대', '거울', '바닥', '배수구', '비품'] },
    { key: 'pantry', label: '탕비실', items: ['싱크대', '상판', '바닥', '쓰레기'] },
    { key: 'glass', label: '유리', items: ['내부 유리', '출입문', '유리벽', '기타'] },
    { key: 'hallway', label: '복도 및 공용공간', items: ['바닥', '쓰레기', '먼지', '출입구'] },
    { key: 'smoking', label: '흡연실', items: ['재떨이', '바닥', '벽면', '기타'] },
    { key: 'extra', label: '기타 공정', kind: 'extra', items: ['카펫', '왁스', '기계세척', '에어컨', '고압세척', '기타 추가공정'] },
  ],
};

/**
 * 기획서 7장 「주 1회 청소 기준 월 견적 금액」 표를 **1원도 바꾸지 않고** 그대로 옮겼습니다.
 * 표에 없는 평수는 관리자가 설정한 산출 규칙이 있을 때만 계산합니다(임의 확정 금지).
 */
export const PRICE_TABLE = [
  { pyeong: 5, min: 90000, max: 100000 },
  { pyeong: 10, min: 150000, max: 180000 },
  { pyeong: 15, min: 165000, max: 180000 },
  { pyeong: 20, min: 180000, max: 200000 },
  { pyeong: 25, min: 200000, max: 225000 },
  { pyeong: 30, min: 210000, max: 240000 },
  { pyeong: 35, min: 241500, max: 276500 },
  { pyeong: 40, min: 272000, max: 312000 },
  { pyeong: 45, min: 301500, max: 346500 },
  { pyeong: 50, min: 330000, max: 380000 },
  { pyeong: 55, min: 357500, max: 412500 },
  { pyeong: 60, min: 384000, max: 444000 },
  { pyeong: 65, min: 409500, max: 474000 },
  { pyeong: 70, min: 434000, max: 504000 },
  { pyeong: 75, min: 457500, max: 532500 },
  { pyeong: 80, min: 480000, max: 560000 },
  { pyeong: 85, min: 501500, max: 586500 },
  { pyeong: 90, min: 522000, max: 612000 },
  { pyeong: 95, min: 541500, max: 636500 },
  { pyeong: 100, min: 560000, max: 660000 },
  { pyeong: 280, min: 1540000, max: 1820000 },
];

export const QUOTE_DIFFICULTIES = [
  { key: 'easy', label: '쉬움' },
  { key: 'normal', label: '보통' },
  { key: 'hard', label: '어려움' },
  { key: 'veryHard', label: '매우 어려움' },
];

export const QUOTE_TEAM_SIZES = [
  { key: '1', label: '1인팀' },
  { key: '2', label: '2인팀' },
  { key: '3', label: '3인팀' },
  { key: '4', label: '4인 이상' },
];

export const QUOTE_FREQUENCIES = [
  { key: 'week1', label: '주 1회', perWeek: 1 },
  { key: 'week2', label: '주 2회', perWeek: 2 },
  { key: 'week3', label: '주 3회', perWeek: 3 },
  { key: 'week5', label: '주 5회', perWeek: 5 },
  { key: 'daily', label: '매일', perWeek: 7 },
];

export const QUOTE_EXTRA_PROCESSES = [
  { key: 'carpet', label: '카펫' },
  { key: 'wax', label: '왁스' },
  { key: 'machine', label: '기계세척' },
  { key: 'aircon', label: '에어컨' },
  { key: 'pressure', label: '고압세척' },
  { key: 'extraOther', label: '기타 추가공정' },
];

/** 조정 항목 한 칸 — 비어 있으면 '미설정'이고 계산에서 빠집니다(임의 기본값 없음). */
function normalizeAdjustment(input) {
  const source = input && typeof input === 'object' ? input : {};
  const mode = source.mode === 'rate' || source.mode === 'amount' ? source.mode : '';
  const raw = source.value;
  let value = '';
  if (raw !== '' && raw !== null && raw !== undefined) {
    const number = Number(raw);
    if (Number.isFinite(number) && number >= 0) value = number;
  }
  return { mode: value === '' ? '' : mode, value, note: toText(source.note) };
}

/** 관리자가 고칠 수 있는 기준 가격표 — 값이 없거나 깨진 줄은 기본 표로 돌아갑니다. */
export function normalizePriceTable(rows) {
  const source = Array.isArray(rows) && rows.length ? rows : PRICE_TABLE;
  const map = new Map();
  for (const row of source) {
    const pyeong = Math.round(Number(row && row.pyeong));
    if (!Number.isFinite(pyeong) || pyeong <= 0) continue;
    const min = toAmount(row && row.min);
    const max = toAmount(row && row.max);
    if (!min && !max) continue;
    map.set(pyeong, { pyeong, min, max: max || min });
  }
  if (!map.size) PRICE_TABLE.forEach((row) => map.set(row.pyeong, { ...row }));
  return [...map.values()].sort((a, b) => a.pyeong - b.pyeong);
}

/** 견적 설정 기본값 — 정책이 정해지지 않은 조정률·금액은 **비워 둡니다**. */
export function defaultQuoteSettings() {
  return {
    version: 1,
    priceTable: PRICE_TABLE.map((row) => ({ ...row })),
    areaRule: { mode: '', perPyeongMin: '', perPyeongMax: '', note: '' },
    recommend: 'mid',
    team: QUOTE_TEAM_SIZES.map((row) => ({ key: row.key, label: row.label, ...normalizeAdjustment(null) })),
    frequency: QUOTE_FREQUENCIES.map((row) => ({ key: row.key, label: row.label, perWeek: row.perWeek, ...normalizeAdjustment(null) })),
    difficulty: QUOTE_DIFFICULTIES.map((row) => ({ key: row.key, label: row.label, ...normalizeAdjustment(null) })),
    extras: QUOTE_EXTRA_PROCESSES.map((row) => ({ key: row.key, label: row.label, ...normalizeAdjustment(null) })),
    workHours: { label: '작업시간', ...normalizeAdjustment(null) },
    other: { label: '기타 조건', ...normalizeAdjustment(null) },
    updatedAt: '',
    by: '',
    history: [],
  };
}

function normalizeAdjustmentList(rows, defaults) {
  const list = Array.isArray(rows) ? rows : [];
  return defaults.map((row) => {
    const found = list.find((item) => item && item.key === row.key);
    const adjustment = normalizeAdjustment(found);
    return { key: row.key, label: toText(found && found.label) || row.label, ...adjustment };
  });
}

export function normalizeQuoteSettings(input) {
  const base = defaultQuoteSettings();
  const source = input && typeof input === 'object' ? input : {};
  const areaRule = source.areaRule && typeof source.areaRule === 'object' ? source.areaRule : {};
  const mode = ['perPyeong', 'interpolate'].includes(areaRule.mode) ? areaRule.mode : '';
  const numberOrBlank = (value) => {
    if (value === '' || value === null || value === undefined) return '';
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : '';
  };
  return {
    version: 1,
    priceTable: normalizePriceTable(source.priceTable),
    areaRule: {
      mode,
      perPyeongMin: numberOrBlank(areaRule.perPyeongMin),
      perPyeongMax: numberOrBlank(areaRule.perPyeongMax),
      note: toText(areaRule.note),
    },
    recommend: ['min', 'mid', 'max'].includes(source.recommend) ? source.recommend : base.recommend,
    team: normalizeAdjustmentList(source.team, base.team),
    frequency: normalizeAdjustmentList(source.frequency, base.frequency),
    difficulty: normalizeAdjustmentList(source.difficulty, base.difficulty),
    extras: normalizeAdjustmentList(source.extras, base.extras),
    workHours: { label: toText(source.workHours && source.workHours.label) || '작업시간', ...normalizeAdjustment(source.workHours) },
    other: { label: toText(source.other && source.other.label) || '기타 조건', ...normalizeAdjustment(source.other) },
    updatedAt: toText(source.updatedAt),
    by: toText(source.by),
    history: normalizeHistory(source.history),
  };
}

/** 체크리스트 설정 — 구역과 항목을 관리자가 더하고 고칩니다. */
export function normalizeQuoteChecklist(input) {
  const source = input && typeof input === 'object' ? input : {};
  const zones = (Array.isArray(source.zones) && source.zones.length ? source.zones : DEFAULT_QUOTE_CHECKLIST.zones)
    .map((zone, index) => {
      const key = toText(zone && zone.key) || `zone${index + 1}`;
      const items = (Array.isArray(zone && zone.items) ? zone.items : []).map((item) => toText(item)).filter(Boolean);
      return {
        key,
        label: toText(zone && zone.label) || key,
        kind: zone && zone.kind === 'extra' ? 'extra' : 'normal',
        items,
      };
    })
    .filter((zone) => zone.items.length || zone.kind === 'extra');
  return {
    zones: zones.length ? zones : DEFAULT_QUOTE_CHECKLIST.zones.map((zone) => ({ ...zone, items: zone.items.slice() })),
    updatedAt: toText(source.updatedAt),
    by: toText(source.by),
    history: normalizeHistory(source.history),
  };
}

/** 현장 방문 기록 — 업장(site.survey)과 견적(quote.survey)이 같은 모양을 씁니다. */
export function normalizeSurvey(input) {
  const source = input && typeof input === 'object' ? input : {};
  const zoneChecks = {};
  if (source.zoneChecks && typeof source.zoneChecks === 'object') {
    for (const [key, value] of Object.entries(source.zoneChecks)) {
      if (Array.isArray(value)) zoneChecks[key] = value.map((item) => toText(item)).filter(Boolean);
    }
  }
  const pyeong = source.pyeong === '' || source.pyeong === null || source.pyeong === undefined ? '' : Number(source.pyeong);
  return {
    visitDate: toText(source.visitDate),
    surveyor: toText(source.surveyor),
    clientName: toText(source.clientName),
    siteName: toText(source.siteName),
    address: toText(source.address),
    contactName: toText(source.contactName),
    contactPhone: toText(source.contactPhone),
    location: toText(source.location),
    area: toText(source.area),
    pyeong: Number.isFinite(pyeong) && pyeong > 0 ? pyeong : '',
    frequency: toText(source.frequency),
    hours: toText(source.hours),
    difficulty: QUOTE_DIFFICULTIES.some((row) => row.key === source.difficulty) ? source.difficulty : '',
    teamSize: QUOTE_TEAM_SIZES.some((row) => row.key === String(source.teamSize)) ? String(source.teamSize) : '',
    zones: Array.isArray(source.zones) ? source.zones.map((item) => toText(item)).filter(Boolean) : [],
    zoneChecks,
    extras: Array.isArray(source.extras) ? source.extras.map((item) => toText(item)).filter(Boolean) : [],
    note: toText(source.note),
    photoIds: Array.isArray(source.photoIds) ? source.photoIds.map((item) => toText(item)).filter(Boolean) : [],
    updatedAt: toText(source.updatedAt),
    by: toText(source.by),
  };
}

/** 방문 기록에서 이력에 남길 칸의 사람이 읽는 이름. */
const SURVEY_FIELD_LABELS = {
  visitDate: '방문일',
  surveyor: '견적 담당자',
  clientName: '고객사명',
  siteName: '사업장명',
  address: '주소',
  contactName: '담당자',
  contactPhone: '연락처',
  location: '현장 위치',
  area: '면적',
  pyeong: '평수',
  frequency: '청소 주기',
  hours: '예상 작업시간',
  difficulty: '현장 난이도',
  teamSize: '작업 인원',
  zones: '청소 구역',
  extras: '추가 공정',
  note: '현장 특이사항',
};

/** 이력 비교용 — 시간·작성자 칸은 빼고 사람이 읽는 값만 비교합니다. */
function surveyDisplay(survey) {
  const row = normalizeSurvey(survey);
  const out = {};
  for (const key of Object.keys(SURVEY_FIELD_LABELS)) out[key] = row[key];
  return out;
}

/** 견적 설정 이력 비교용 스냅샷. */
function quoteSettingsSnapshot(settings) {
  const out = {
    areaRuleMode: settings.areaRule.mode,
    areaPerMin: settings.areaRule.perPyeongMin,
    areaPerMax: settings.areaRule.perPyeongMax,
    recommend: settings.recommend,
    workHours: settings.workHours.mode ? `${settings.workHours.mode}:${settings.workHours.value}` : '',
    other: settings.other.mode ? `${settings.other.mode}:${settings.other.value}` : '',
  };
  for (const row of settings.priceTable) {
    out[`price_${row.pyeong}_min`] = row.min;
    out[`price_${row.pyeong}_max`] = row.max;
  }
  for (const group of ['team', 'frequency', 'difficulty', 'extras']) {
    for (const row of settings[group]) out[`${group}_${row.key}`] = row.mode ? `${row.mode}:${row.value}` : '';
  }
  return out;
}

const QUOTE_SETTINGS_LABELS = {
  areaRuleMode: '표 밖 평수 규칙',
  areaPerMin: '1평당 최소',
  areaPerMax: '1평당 최대',
  recommend: '권장 견적 기준',
  workHours: '작업시간 조정',
  other: '기타 조건 조정',
  team_1: '1인팀 조정',
  team_2: '2인팀 조정',
  team_3: '3인팀 조정',
  team_4: '4인 이상 조정',
  frequency_week1: '주 1회 조정',
  frequency_week2: '주 2회 조정',
  frequency_week3: '주 3회 조정',
  frequency_week5: '주 5회 조정',
  frequency_daily: '매일 조정',
  difficulty_easy: '난이도 쉬움 조정',
  difficulty_normal: '난이도 보통 조정',
  difficulty_hard: '난이도 어려움 조정',
  difficulty_veryHard: '난이도 매우 어려움 조정',
  extras_carpet: '카펫 단가',
  extras_wax: '왁스 단가',
  extras_machine: '기계세척 단가',
  extras_aircon: '에어컨 단가',
  extras_pressure: '고압세척 단가',
  extras_extraOther: '기타 추가공정 단가',
};

/** 현장 사진 한 장의 메타정보 (기획서 4장). 사진 자체는 ref(기기 사진 · Storage 주소)로 보관합니다. */
export function normalizeSitePhoto(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    id: toText(source.id),
    area: SURVEY_PHOTO_AREAS.some((row) => row.key === source.area) ? source.area : 'etc',
    date: toText(source.date),
    by: toText(source.by),
    memo: toText(source.memo),
    firstQuote: source.firstQuote !== false,
    quoteId: toText(source.quoteId),
    ref: source.ref && typeof source.ref === 'object' ? { ...source.ref } : null,
    createdAt: toText(source.createdAt),
  };
}

export function normalizeSitePhotos(list) {
  return (Array.isArray(list) ? list : []).map(normalizeSitePhoto).filter((row) => row.ref);
}

/** 견적 산출 결과 — 값은 그대로 보관하고, 없는 칸만 기본값으로 채웁니다. */
export function normalizeQuoteEstimate(input) {
  if (!input || typeof input !== 'object') return null;
  const source = input;
  const num = (value) => (value === '' || value === null || value === undefined || !Number.isFinite(Number(value)) ? '' : Math.round(Number(value)));
  return {
    ...source,
    pyeong: source.pyeong === '' || source.pyeong === undefined ? '' : Number(source.pyeong),
    base: source.base && typeof source.base === 'object' ? { min: toAmount(source.base.min), max: toAmount(source.base.max) } : null,
    tableRecommended: num(source.tableRecommended),
    extraTotal: num(source.extraTotal) || 0,
    adjustmentTotal: num(source.adjustmentTotal) || 0,
    minQuote: num(source.minQuote),
    recQuote: num(source.recQuote),
    final: num(source.final),
    warnings: Array.isArray(source.warnings) ? source.warnings.map((row) => toText(row)).filter(Boolean) : [],
    lines: Array.isArray(source.lines) ? source.lines : [],
    computedAt: toText(source.computedAt),
  };
}

/** 견적 금액 승인 — 대표가 최종 금액을 확인한 기록. */
export function normalizeQuoteApproval(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    status: source.status === 'approved' ? 'approved' : '',
    by: toText(source.by),
    at: toText(source.at),
    amount: toAmount(source.amount),
    note: toText(source.note),
  };
}

/** "약 110㎡ (33평)" · "33평" · "33" 어느 쪽이든 평수를 읽습니다. */
export function parsePyeong(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const pyeong = text.match(/([0-9]+(?:\.[0-9]+)?)\s*평/);
  if (pyeong) return Math.round(Number(pyeong[1]) * 10) / 10;
  const sqm = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:㎡|m2|m²|제곱미터)/i);
  if (sqm) return Math.round((Number(sqm[1]) / 3.305785) * 10) / 10;
  const plain = text.match(/^([0-9]+(?:\.[0-9]+)?)$/);
  if (plain) return Number(plain[1]);
  return null;
}

function frequencyKeyOf(text) {
  const value = String(text || '');
  if (/매일|주\s*7\s*회/.test(value)) return 'daily';
  const match = value.match(/주\s*([1-7])\s*회/);
  if (!match) return '';
  const count = Number(match[1]);
  if (count === 1) return 'week1';
  if (count === 2) return 'week2';
  if (count === 3) return 'week3';
  if (count === 5) return 'week5';
  return '';
}

function priceBaseFor(pyeong, settings) {
  if (!Number.isFinite(pyeong) || pyeong <= 0) {
    return { base: null, source: 'none', note: '면적(평수)을 입력하면 기준 견적이 계산됩니다.' };
  }
  const exact = settings.priceTable.find((row) => row.pyeong === pyeong);
  if (exact) return { base: { min: exact.min, max: exact.max }, source: 'table', note: `기준표 ${exact.pyeong}평` };
  const below = settings.priceTable.filter((row) => row.pyeong < pyeong).slice(-1)[0] || null;
  const above = settings.priceTable.filter((row) => row.pyeong > pyeong)[0] || null;
  const rule = settings.areaRule;
  if (rule.mode === 'perPyeong' && rule.perPyeongMin !== '' && rule.perPyeongMax !== '') {
    return {
      base: { min: Math.round(pyeong * rule.perPyeongMin), max: Math.round(pyeong * rule.perPyeongMax) },
      source: 'perPyeong',
      note: `관리자 규칙 · 1평당 ${rule.perPyeongMin.toLocaleString('ko-KR')}~${rule.perPyeongMax.toLocaleString('ko-KR')}원`,
    };
  }
  if (rule.mode === 'interpolate' && below && above) {
    const ratio = (pyeong - below.pyeong) / (above.pyeong - below.pyeong);
    const mix = (from, to) => Math.round(from + (to - from) * ratio);
    return {
      base: { min: mix(below.min, above.min), max: mix(below.max, above.max) },
      source: 'interpolate',
      note: `기준표 ${below.pyeong}평~${above.pyeong}평 사이 비율 계산`,
    };
  }
  return {
    base: null,
    source: 'none',
    note: `${pyeong}평은 기준표에 없는 평수입니다. 관리자 설정의 ‘표에 없는 평수 산출 규칙’을 먼저 정해 주세요.`,
  };
}

function adjustmentAmount(item, baseAmount) {
  if (!item || !item.mode || item.value === '') return null;
  if (item.mode === 'rate') return Math.round((baseAmount * Number(item.value)) / 100);
  return Math.round(Number(item.value));
}

/**
 * 기준표 + 관리자 설정으로 견적을 계산합니다.
 * - 설정이 비어 있는 조정 항목은 계산에서 빼고 `미설정`으로 알려 줍니다(임의 값 강제 없음).
 * - 기준표에 없는 평수는 관리자 규칙이 있을 때만 계산하고, 없으면 금액을 만들지 않습니다.
 */
export function estimateQuote(input = {}, settingsInput = null) {
  const settings = normalizeQuoteSettings(settingsInput || input.settings || null);
  const rawPyeong = input.pyeong === '' || input.pyeong === null || input.pyeong === undefined ? null : Number(input.pyeong);
  const pyeong = Number.isFinite(rawPyeong) && rawPyeong > 0 ? Math.round(rawPyeong * 10) / 10 : parsePyeong(input.area);
  const { base, source, note } = priceBaseFor(pyeong, settings);
  const pick = settings.recommend;
  const pickLabel = pick === 'min' ? '최소' : pick === 'max' ? '최대' : '권장(중간)';
  const tableRecommended = base
    ? pick === 'min'
      ? base.min
      : pick === 'max'
        ? base.max
        : Math.round((base.min + base.max) / 2)
    : null;
  const warnings = [];
  if (!base) warnings.push(note);
  const lines = [];
  let adjustmentTotal = 0;

  // ① 추가 공정 — 체크한 공정마다 관리자 단가가 있으면 더합니다.
  const extraLabels = Array.isArray(input.extras) ? input.extras.map((row) => toText(row)).filter(Boolean) : [];
  const extraLines = [];
  let extraTotal = 0;
  for (const label of extraLabels) {
    const item = settings.extras.find((row) => row.label === label || row.key === label);
    const amount = item ? adjustmentAmount(item, tableRecommended || 0) : null;
    if (amount === null) {
      extraLines.push({ label: item ? item.label : label, amount: null, status: 'unset', note: '단가 미설정' });
      warnings.push(`추가 공정 ‘${label}’ 단가가 설정되지 않았습니다.`);
      continue;
    }
    extraTotal += amount;
    extraLines.push({ label: item.label, amount, status: 'applied', mode: item.mode, value: item.value });
  }
  const directExtra = input.extraAmount === '' || input.extraAmount === null || input.extraAmount === undefined ? null : toAmount(input.extraAmount);
  if (directExtra !== null) {
    extraTotal = directExtra;
    extraLines.push({ label: '추가 공정 직접 입력', amount: directExtra, status: 'applied', direct: true });
  }
  if (extraTotal) {
    lines.push({ key: 'extra', label: '추가 공정', amount: extraTotal, status: 'applied' });
    adjustmentTotal += extraTotal;
  }

  // ② 인원 조정
  const teamKey = QUOTE_TEAM_SIZES.some((row) => row.key === String(input.teamSize)) ? String(input.teamSize) : '';
  const teamItem = teamKey ? settings.team.find((row) => row.key === teamKey) : null;
  let teamAdjust = 0;
  let teamStatus = 'none';
  if (teamItem) {
    const amount = adjustmentAmount(teamItem, tableRecommended || 0);
    if (amount === null) {
      teamStatus = 'unset';
      if (teamKey !== '1') warnings.push(`${teamItem.label} 조정률이 설정되지 않았습니다.`);
    } else {
      teamAdjust = amount;
      teamStatus = 'applied';
      lines.push({ key: 'team', label: teamItem.label, amount, status: 'applied', mode: teamItem.mode, value: teamItem.value });
      adjustmentTotal += amount;
    }
  }

  // ③ 청소 주기 — 기준표는 주 1회 기준입니다.
  const freqKey = frequencyKeyOf(input.frequency || '');
  const freqItem = freqKey ? settings.frequency.find((row) => row.key === freqKey) : null;
  let freqAdjust = 0;
  let freqStatus = 'none';
  if (freqKey === 'week1') {
    freqStatus = 'base';
  } else if (freqItem) {
    const amount = adjustmentAmount(freqItem, tableRecommended || 0);
    if (amount === null) {
      freqStatus = 'unset';
      warnings.push(`${freqItem.label} 조정률이 설정되지 않아 주 1회 기준 금액으로 계산했습니다.`);
    } else {
      freqAdjust = amount;
      freqStatus = 'applied';
      lines.push({ key: 'frequency', label: freqItem.label, amount, status: 'applied', mode: freqItem.mode, value: freqItem.value });
      adjustmentTotal += amount;
    }
  } else if (input.frequency) {
    freqStatus = 'unset';
    warnings.push(`청소 주기 ‘${input.frequency}’의 조정률이 설정되지 않았습니다.`);
  }

  // ④ 난이도
  const difficultyKey = QUOTE_DIFFICULTIES.some((row) => row.key === input.difficulty) ? input.difficulty : '';
  const diffItem = difficultyKey ? settings.difficulty.find((row) => row.key === difficultyKey) : null;
  let diffAdjust = 0;
  let diffStatus = 'none';
  if (difficultyKey === 'normal') {
    diffStatus = 'base';
  } else if (diffItem) {
    const amount = adjustmentAmount(diffItem, tableRecommended || 0);
    if (amount === null) {
      diffStatus = 'unset';
      warnings.push(`난이도(${diffItem.label}) 조정이 설정되지 않았습니다.`);
    } else {
      diffAdjust = amount;
      diffStatus = 'applied';
      lines.push({ key: 'difficulty', label: `난이도 ${diffItem.label}`, amount, status: 'applied', mode: diffItem.mode, value: diffItem.value });
      adjustmentTotal += amount;
    }
  }

  // ⑤ 작업시간 — 신청자가 조정을 적용할 때만 더합니다.
  let hoursAdjust = 0;
  let hoursStatus = 'none';
  if (input.applyHours) {
    const direct = input.hoursAmount === '' || input.hoursAmount === null || input.hoursAmount === undefined ? null : toAmount(input.hoursAmount);
    const amount = direct !== null ? direct : adjustmentAmount(settings.workHours, tableRecommended || 0);
    if (amount === null) {
      hoursStatus = 'unset';
      warnings.push('작업시간 조정 금액이 설정되지 않았습니다.');
    } else {
      hoursAdjust = amount;
      hoursStatus = 'applied';
      lines.push({ key: 'hours', label: `작업시간${input.hours ? ` (${input.hours})` : ''}`, amount, status: 'applied', direct: direct !== null });
      adjustmentTotal += amount;
    }
  }

  // ⑥ 기타 조건
  let otherAdjust = 0;
  let otherStatus = 'none';
  if (input.applyOther) {
    const direct = input.otherAmount === '' || input.otherAmount === null || input.otherAmount === undefined ? null : toAmount(input.otherAmount);
    const amount = direct !== null ? direct : adjustmentAmount(settings.other, tableRecommended || 0);
    if (amount === null) {
      otherStatus = 'unset';
      warnings.push('기타 조건 조정 금액이 설정되지 않았습니다.');
    } else {
      otherAdjust = amount;
      otherStatus = 'applied';
      lines.push({ key: 'other', label: settings.other.label || '기타 조건', amount, status: 'applied', direct: direct !== null });
      adjustmentTotal += amount;
    }
  }

  const minQuote = base ? base.min + adjustmentTotal : '';
  const recQuote = base ? tableRecommended + adjustmentTotal : '';
  return {
    pyeong: safePyeong(pyeong),
    area: toText(input.area),
    hoursText: toText(input.hours),
    base,
    baseSource: source,
    baseNote: note,
    pick,
    pickLabel,
    tableRecommended: tableRecommended === null ? '' : tableRecommended,
    extraTotal,
    extraLines,
    teamAdjust,
    teamStatus,
    frequency: { key: freqKey, label: freqItem ? freqItem.label : '', status: freqStatus, amount: freqAdjust },
    difficulty: { key: difficultyKey, label: diffItem ? diffItem.label : '', status: diffStatus, amount: diffAdjust },
    hoursAdjust,
    hoursStatus,
    otherAdjust,
    otherStatus,
    lines,
    adjustmentTotal,
    minQuote,
    recQuote,
    final: recQuote,
    warnings,
    settingsUpdatedAt: settings.updatedAt,
    computedAt: new Date().toISOString(),
  };
}

function safePyeong(value) {
  return Number.isFinite(value) && value > 0 ? Math.round(value * 10) / 10 : '';
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

/** 업장 정보에서 이력에 남길 칸의 사람이 읽는 이름. */
const SITE_FIELD_LABELS = {
  name: '업장명',
  clientName: '고객사',
  address: '주소',
  area: '면적',
  frequency: '청소 주기',
  contactName: '담당자',
  bizNumber: '사업자번호',
  ceoName: '대표자',
  taxEmail: '세금계산서 이메일',
  manager: '담당 팀장',
  managerRole: '담당 직함',
  accessNote: '출입 안내',
  category: '업종',
};

const CONTRACT_FIELD_LABELS = {
  contractAmount: '계약금',
  subcontractAmount: '도급금액',
  feeAmount: '수수료',
  contractDate: '계약일',
  billingDay: '청구일',
  note: '비고',
};

const OPS_FIELD_LABELS = {
  process: '청소 공정',
  accessMethod: '출입방법',
  trashLocation: '쓰레기 배출',
  parkingMethod: '주차',
};

/** 업장 정보에서 이력으로 남길 값만 추립니다. */
function siteHistorySnapshot(site) {
  const snapshot = {};
  for (const key of Object.keys(SITE_FIELD_LABELS)) snapshot[key] = toText(site[key]);
  const contract = normalizeContract(site.contract);
  for (const key of Object.keys(CONTRACT_FIELD_LABELS)) snapshot[key] = contract[key];
  const ops = normalizeOps(site.ops);
  for (const key of Object.keys(OPS_FIELD_LABELS)) snapshot[key] = ops[key];
  return snapshot;
}

const SITE_HISTORY_LABELS = {
  ...SITE_FIELD_LABELS,
  ...CONTRACT_FIELD_LABELS,
  ...OPS_FIELD_LABELS,
};

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
  renewed: { label: '갱신 완료', badge: 'badge--wait' },
  terminated: { label: '계약 종료', badge: 'badge--wait' },
};

/** 서명이 끝나 더 이상 서명·수정 화면을 열지 않는 계약 상태. */
export function isAgreementClosed(status) {
  return status === 'signed' || status === 'renewed' || status === 'terminated';
}

/** 서명 증빙 — 서명자 · 일시 · 문서 해시(무결성 확인값). */
export function normalizeSignatureAudit(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    name: toText(source.name),
    role: toText(source.role),
    phone: toText(source.phone),
    at: toText(source.at),
    method: toText(source.method) || '전자서명(스마트펜·손가락)',
    hash: toText(source.hash),
    algo: toText(source.algo),
  };
}

/** 직원 계약 상태 — 같은 status 값이라도 ‘고객 확인’이 아니라 ‘서명 대기’입니다. */
export const STAFF_STATUS = {
  draft: { label: '작성 중', badge: 'badge--wait' },
  sent: { label: '서명 대기', badge: 'badge--wait' },
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
    clientEmail: toText(source.clientEmail),
    clientCeo: toText(source.clientCeo),
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
    // 견적 → 계약 연결 (계약서를 만들면 그 계약서 id 가 들어갑니다).
    contractId: toText(source.contractId),
    // 2단계 — 현장 방문 기록 · 기준표 자동 산출 · 대표 금액 승인.
    survey: normalizeSurvey(source.survey),
    estimate: normalizeQuoteEstimate(source.estimate),
    approval: normalizeQuoteApproval(source.approval),
    history: normalizeHistory(source.history),
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
    // 3단계 — 계약서 자동 연동 정보 (기획서 8장): 작업시간 · 계약 담당자
    workHours: toText(source.workHours),
    managerName: toText(source.managerName),
    managerTitle: toText(source.managerTitle),
    specialTerms: toText(source.specialTerms),
    bizLicense: source.bizLicense && typeof source.bizLicense === 'object' ? source.bizLicense : null,
    contractMemo: toText(source.contractMemo),
    signedDate: toText(source.signedDate),
    signature: toText(source.signature),
    signedByName: toText(source.signedByName),
    signedAt: toText(source.signedAt),
    // 3단계 — 서명 증빙(서명자·일시·문서 무결성 해시)과 계약 상태 이력
    signatureAudit: normalizeSignatureAudit(source.signatureAudit),
    docHash: toText(source.docHash),
    docAlgo: toText(source.docAlgo),
    docHashAt: toText(source.docHashAt),
    docVersion: Number(source.docVersion) > 0 ? Math.round(Number(source.docVersion)) : 1,
    renewedFrom: toText(source.renewedFrom),
    renewedAt: toText(source.renewedAt),
    renewedTo: toText(source.renewedTo),
    terminatedAt: toText(source.terminatedAt),
    terminateReason: toText(source.terminateReason),
    createdAt: toText(source.createdAt),
    updatedAt: toText(source.updatedAt),
    source: toText(source.source) || 'app',
    history: normalizeHistory(source.history),
  };
}

/**
 * 업장 관리방(기획서 9장) — 계약 체결과 동시에 만들어지는 업장 전용 방의 상태.
 * 고객사 정보 · 계약서 · 견적서 · 최초 현장 사진 · 평수/주기/공정은 업장(siteId)에
 * 이미 붙어 있으므로, 이 값은 ‘방이 언제 어떤 계약으로 열렸는지’만 남깁니다.
 */
export function normalizeRoom(input) {
  const source = input && typeof input === 'object' ? input : {};
  const status = source.status === 'active' || source.status === 'ended' ? source.status : '';
  return {
    status,
    createdAt: toText(source.createdAt),
    endedAt: toText(source.endedAt),
    contractId: toText(source.contractId),
    quoteId: toText(source.quoteId),
    openedBy: toText(source.openedBy),
    pyeong: toText(source.pyeong),
    frequency: toText(source.frequency),
    note: toText(source.note),
  };
}

/* ---------------- 3단계 — 계약 문서 무결성 해시 ---------------- */

/** 계약서 수정 이력에 남길 칸의 사람이 읽는 이름. */
const AGREEMENT_HISTORY_LABELS = {
  clientBusinessName: '고객사명',
  clientBizNumber: '사업자등록번호',
  clientCeo: '대표자',
  clientAddress: '주소',
  contactName: '담당자',
  contactPhone: '담당자 연락처',
  amount: '월 계약금액',
  frequency: '청소 주기',
  scope: '청소 범위',
  extraScope: '추가 업무',
  startDate: '계약 시작일',
  endDate: '계약 종료일',
  months: '계약기간',
  workHours: '작업시간',
  specialTerms: '특약사항',
  managerName: '계약 담당자',
  billingDay: '결제일',
};

function agreementHistorySnapshot(agreement) {
  const row = normalizeAgreement(agreement);
  const out = {};
  for (const key of Object.keys(AGREEMENT_HISTORY_LABELS)) out[key] = row[key];
  return out;
}

/**
 * 서명 시점의 계약서 내용을 한 줄로 고정합니다. 서명 뒤 내용이 바뀌었는지
 * 비교할 수 있도록, 서명·해시처럼 나중에 붙는 값은 넣지 않습니다.
 */
export function agreementCanonicalText(agreement) {
  const row = normalizeAgreement(agreement);
  const lines = [
    `계약서번호:${row.no}`,
    `문서버전:${row.docVersion}`,
    `견적번호:${row.quoteId}`,
    `고객사명:${row.clientBusinessName}`,
    `사업자등록번호:${row.clientBizNumber}`,
    `대표자:${row.clientCeo}`,
    `주소:${row.clientAddress}`,
    `담당자:${row.contactName}`,
    `연락처:${row.contactPhone}`,
    `계약금액:${row.amount}`,
    `부가세:${row.vatIncluded ? '포함' : '별도'}`,
    `결제일:${row.billingDay}`,
    `청소주기:${row.frequency}`,
    `청소범위:${row.scope}`,
    `추가업무:${row.extraScope}`,
    `작업시간:${row.workHours}`,
    `계약기간:${row.startDate}~${row.endDate}(${row.months}개월)`,
    `특약사항:${row.specialTerms}`,
    `계약담당자:${row.managerName}`,
    `공급자:${row.supplierBusinessName}/${row.supplierBizNumber}/${row.supplierCeo}`,
  ];
  return lines.join('\n');
}

function hex32(value) {
  return String(value >>> 0).toString(16).padStart(8, '0');
}

/** crypto.subtle 이 없는 환경(테스트 · 구형 기기)을 위한 간이 해시. */
function fallbackHash(text) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= (code + index) & 0xff;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${hex32(h1)}${hex32(h2)}${hex32(h1 ^ h2)}${hex32(h1 + h2)}`;
}

/**
 * 문서 해시 — 브라우저에서는 SHA-256, 없으면 간이 해시.
 * 돌려주는 값: { hash, algo }
 */
export async function hashDocumentText(text) {
  const body = String(text || '');
  try {
    if (typeof crypto !== 'undefined' && crypto && crypto.subtle && crypto.subtle.digest && typeof TextEncoder !== 'undefined') {
      const bytes = new TextEncoder().encode(body);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const view = new Uint8Array(digest);
      let hex = '';
      for (let index = 0; index < view.length; index += 1) hex += view[index].toString(16).padStart(2, '0');
      return { hash: hex, algo: 'SHA-256' };
    }
  } catch (error) {
    /* 간이 해시로 대신합니다. */
  }
  return { hash: fallbackHash(body), algo: 'FNV-1a(간이)' };
}

/** 서명 시점의 문서 해시를 계산합니다. */
export async function agreementDocHash(agreement) {
  return hashDocumentText(agreementCanonicalText(agreement));
}

/**
 * 저장된 해시와 지금 계약서 내용의 해시를 비교합니다.
 * ok=false 면 서명 뒤 내용이 바뀐 것입니다.
 */
export async function verifyAgreementHash(agreement) {
  const row = normalizeAgreement(agreement);
  if (!row.docHash) return { ok: false, reason: '해시 없음', hash: '', saved: '', algo: '' };
  const now = await agreementDocHash(row);
  return {
    ok: now.hash === row.docHash || fallbackHash(agreementCanonicalText(row)) === row.docHash,
    reason: '',
    hash: now.hash,
    saved: row.docHash,
    algo: row.docAlgo || now.algo,
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
    companyName: toText(source.companyName),
    ceoName: toText(source.ceoName),
    address: toText(source.address),
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
    // 별첨본 확인 질문("을"은 내용을 확인하였습니까?) — 'yes' / 'no' / 빈 값.
    annexAck: source.annexAck === 'yes' || source.annexAck === 'no' ? source.annexAck : '',
    annexAckedAt: toText(source.annexAckedAt),
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
    history: normalizeHistory(source.history),
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
    // 2단계 — 현장 방문 기록 · 구역별 사진 이력(덮어쓰지 않고 쌓입니다).
    survey: normalizeSurvey(site.survey),
    surveyPhotos: normalizeSitePhotos(site.surveyPhotos),
    // 3단계 — 계약 체결과 함께 열린 업장 관리방
    contactPhone: toText(site.contactPhone),
    room: normalizeRoom(site.room),
    // 업장(siteId) 중심 연결 고리 — 이 업장이 어느 견적/계약/팀장 계약에서 왔는지.
    quoteId: toText(site.quoteId),
    contractId: toText(site.contractId),
    staffContractIds: (Array.isArray(site.staffContractIds) ? site.staffContractIds : [])
      .map((id) => toText(id))
      .filter(Boolean),
    history: normalizeHistory(site.history),
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

/* ------------------------------------------------------------------ */
/* 열람 권한 (v2.8.2)                                                  */
/*  · 대표(최고관리자) : 모든 업장 · 견적서 · 고객 계약 · 팀장 계약 ·   */
/*    직원 평가 · 금액(계약금·수수료·매출)                              */
/*  · 직원(관리팀장·부관리자) : 본인에게 배정된 업장의 제한 정보        */
/*    (본인 도급가 · 청소공정 · 출입/쓰레기/주차 · 현장 사진)과          */
/*    본인 도급계약서만. 다른 직원의 관리·평가, 고객 계약서·견적서,      */
/*    고객 계약금·수수료·매출은 열람할 수 없습니다.                     */
/* ------------------------------------------------------------------ */

export const ROLE_LABELS = { admin: '대표(최고관리자)', leader: '직원', customer: '고객' };

export function actorRole(actor) {
  return actor && typeof actor === 'object' ? String(actor.role || '') : '';
}

export function isCeoActor(actor) {
  return actorRole(actor) === 'admin';
}

export function isStaffActor(actor) {
  return actorRole(actor) === 'leader';
}

export function isCustomerActor(actor) {
  return actorRole(actor) === 'customer';
}

/**
 * 고객에게 보내는 업장 — 고객이 볼 칸만 남깁니다(계약 금액·내부 운영 정보 제외).
 * 고객 화면은 계약서(agreement)의 금액을 자기 계약 범위에서만 보기 때문입니다.
 */
export function siteForCustomer(site) {
  if (!site) return site;
  return {
    id: site.id,
    code: site.code,
    name: site.name,
    clientName: site.clientName,
    category: site.category,
    address: site.address,
    area: site.area,
    frequency: site.frequency,
    intervalDays: site.intervalDays,
    startDate: site.startDate,
    contactName: site.contactName,
    manager: site.manager,
    managerRole: site.managerRole,
    accessNote: site.accessNote,
    checklist: site.checklist,
    baseline: normalizeBaseline(site.baseline),
    room: normalizeRoom(site.room),
    quoteId: site.quoteId,
    contractId: site.contractId,
    active: site.active,
    locked: site.locked,
  };
}

/** 직원 평가(A~F · 평가 내용)는 대표만 봅니다. */
export function canSeeStaffEvaluation(session) {
  return isCeoActor(session);
}

/** 계약금 · 수수료 · 순수 매출 · 견적 금액은 대표만 봅니다. */
export function canSeeMoney(session) {
  return isCeoActor(session);
}

/** 고객 계약서 · 견적서는 대표만 봅니다(직원 도급계약서와는 별개). */
export function canSeeCustomerDocuments(session) {
  return isCeoActor(session);
}

/** 관리팀장 목록·디렉토리(다른 직원의 관리업장)는 대표만 봅니다. */
export function canSeeTeamDirectory(session) {
  return isCeoActor(session);
}

/** 로그인한 직원이 볼 수 있는 업장 id — 계정에 배정된 곳만. */
export function assignedSiteIdsOf(session) {
  if (!session) return [];
  const ids = Array.isArray(session.assignedSiteIds) ? session.assignedSiteIds : [];
  const fromAccount =
    session.account && Array.isArray(session.account.assignedSiteIds) ? session.account.assignedSiteIds : [];
  return [...new Set([...ids, ...fromAccount].map((id) => toText(id)).filter(Boolean))];
}

/** 이 사람이 이 업장을 열 수 있는가 — 대표는 전부, 직원은 배정된 곳만. */
export function canOpenSite(session, siteId) {
  if (!session) return false;
  if (isCeoActor(session)) return true;
  if (!isStaffActor(session)) return false;
  return assignedSiteIdsOf(session).includes(toText(siteId));
}

/**
 * 직원 화면에 넘기는 업장 — 고객사 정보 · 견적/계약 연결 · 계약 메모 ·
 * 사업자등록증 · 변경 이력은 지우고, 운영 정보와 **본인 도급가**만 남깁니다.
 */
export function siteForStaff(site) {
  if (!site) return site;
  const contract = normalizeContract(site.contract);
  return {
    id: site.id,
    code: site.code,
    name: site.name,
    category: site.category,
    address: site.address,
    area: site.area,
    frequency: site.frequency,
    intervalDays: site.intervalDays,
    startDate: site.startDate,
    active: site.active,
    manager: site.manager,
    managerRole: site.managerRole,
    accessNote: site.accessNote,
    ops: normalizeOps(site.ops),
    manual: site.manual,
    checklist: site.checklist,
    baseline: normalizeBaseline(site.baseline),
    locked: site.locked,
    annexHours: site.annexHours,
    staffContractIds: site.staffContractIds || [],
    // 본인 도급 조건 — 이 업장의 도급금액만. (고객 청구일·계약일 등은 넘기지 않습니다.)
    staffPay: { amount: contract.subcontractAmount },
  };
}

/** 세션에 맞춰 업장을 정리합니다 — 직원이면 제한 정보만. */
export function siteForSession(session, site) {
  if (!site) return site;
  if (!isStaffActor(session)) return site;
  const safe = siteForStaff(site);
  // 다른 직원의 담당 표시는 넘기지 않습니다(본인 담당일 때만).
  const mine = site.manager && session.name && site.manager === session.name;
  safe.manager = mine ? site.manager : '';
  safe.managerRole = mine ? site.managerRole : '';
  return safe;
}

/**
 * 직원(관리팀장 · 부관리자)이면 대표 전용 열람을 막습니다.
 * actor 를 넘기지 않는 내부 호출(시드 · 로그인 · 고객 방)은 그대로 둡니다.
 */
function denyStaff(actor, what) {
  if (isStaffActor(actor)) {
    throw new StoreError('permission-denied', `${what}은(는) 대표(최고관리자)만 볼 수 있습니다.`);
  }
}

/** 계약·견적서 작성·발송·수정은 대표만 — 고객 화면에서 보내는 요청도 막습니다. */
function denyCustomerWrites(actor, what) {
  if (isCustomerActor(actor)) {
    throw new StoreError('permission-denied', `${what}은(는) 대표(최고관리자)만 할 수 있습니다.`);
  }
}

function requireOwnStaffRecord(actor, row, what = '다른 직원의 계약서') {
  if (!isStaffActor(actor)) return;
  const sameAccount = row && actor.accountId && row.accountId && row.accountId === actor.accountId;
  const samePhone =
    row && actor.phone && row.phone && normalizePhone(row.phone) === normalizePhone(actor.phone);
  if (!sameAccount && !samePhone) {
    throw new StoreError('permission-denied', `${what}는 본인 것만 열 수 있습니다.`);
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
/* 직원 계정 (관리팀장 · 부관리자)                                       */
/* ------------------------------------------------------------------ */

/** 직원 역할 표기 — `leader` 는 관리팀장, `manager` 는 부관리자(본부장). */
export const STAFF_ROLE_LABELS = { leader: '관리팀장', manager: '부관리자' };

export function staffRoleKey(account) {
  if (!account) return 'leader';
  if (account.staffRole === 'manager' || account.canManageStaff) return 'manager';
  return 'leader';
}

export function staffRoleLabel(account) {
  return STAFF_ROLE_LABELS[staffRoleKey(account)] || STAFF_ROLE_LABELS.leader;
}

/** 'TL-1234' · 'tl1234' · '1234' → 'TL-1234'. 형식이 아니면 빈 값. */
export function normalizeLeaderCodeInput(value) {
  const text = String(value || '').toUpperCase().replace(/\s/g, '');
  const match = text.match(/^(?:TL-?)?([0-9]{4})$/);
  return match ? `TL-${match[1]}` : '';
}

/** 겹치지 않는 새 고유코드 — 기존 계정 코드와 비교합니다. */
function makeLeaderCode(rows) {
  const taken = new Set((rows || []).map((row) => normalizeCode(row && row.leaderCode)));
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const candidate = `TL-${String(1000 + Math.floor(Math.random() * 9000))}`;
    if (!taken.has(normalizeCode(candidate))) return candidate;
  }
  throw new StoreError('code-collision', '고유코드를 만들지 못했습니다. 다시 시도해 주세요.');
}

/** 직원 계정 등록·수정은 대표(최고관리자)만 — 화면 밖 호출도 같은 기준으로 막습니다. */
function requireAccountEditor(actor) {
  if (!actor) return;
  if (actor.role !== 'admin') {
    throw new StoreError('account-denied', '직원 계정 등록·수정은 대표(최고관리자)만 할 수 있습니다.');
  }
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
    /** 서버 동기화 계층 (js/supabase-client.js) — 꺼져 있으면 null. */
    this.remote = null;
    this.syncStatus = 'local';
  }

  init() {
    if (!this._ready) this._ready = this._init();
    return this._ready;
  }

  async _init() {
    await this.adapter.init();
    // ① 서버를 기준으로 기기 캐시를 맞춥니다(서버가 비었으면 이 기기 데이터를 올립니다).
    if (this.remote) {
      try {
        await this.remote.hydrate(this.adapter);
        // ② 이후 모든 쓰기가 서버에도 반영되도록 어댑터를 감쌉니다.
        this.adapter = this.remote.decorate(this.adapter);
      } catch (error) {
        console.warn('[store] 서버 동기화를 준비하지 못했습니다', error);
      }
    }
    await this._seedIfEmpty();
    await this._migrate();
    // ③ 5초 주기 · 화면 복귀 · 네트워크 복구 때 서버 변경을 받아 옵니다.
    if (this.remote) this.remote.start(this);
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
    await this._ensureSiteManual();
    await this._migrateSiteManuals();
    await this._ensureSeedQuotes();
    await this._ensureSeedStaffContracts();
    await this._ensureSeedStaffChecks();
    await this._ensureSeedSupply();
    // 마지막에 업장(siteId) 중심 연결 고리를 채웁니다 — 시드 · 기존 기기 모두 같은 결과가 됩니다.
    await this._migrateSiteLinks();
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
   * 청소공정 매뉴얼(청소 가능 시간 · 요일별 작업표)이 없는 현장에 시드 값을 채웁니다.
   * 이미 저장된 매뉴얼은 건드리지 않고, 현장의 청소 공정 설명이 비어 있을 때만
   * 시드의 한 줄 요약을 넣습니다 — 기존 기록을 덮어쓰지 않습니다.
   */
  async _ensureSiteManual() {
    const sites = await this.adapter.getAll('sites');
    if (!sites.length) return;
    const seedById = new Map(buildSites().map((site) => [site.id, site]));
    for (const site of sites) {
      const seed = seedById.get(site.id);
      if (!seed || !seed.manual) continue;
      const hasManual = !!site.manual && Array.isArray(site.manual.days) && site.manual.days.length > 0;
      const processEmpty = !site.ops || !String(site.ops.process || '').trim();
      if (hasManual && !processEmpty) continue;
      const next = { ...site };
      if (!hasManual) next.manual = JSON.parse(JSON.stringify(seed.manual));
      if (processEmpty && seed.ops && seed.ops.process) {
        next.ops = normalizeOps({ ...(site.ops || {}), process: seed.ops.process });
      }
      next.updatedAt = new Date().toISOString();
      await this.adapter.put('sites', next);
    }
  }

  /**
   * 청소공정 매뉴얼의 구조가 바뀐 현장은 새 매뉴얼로 갱신합니다.
   * (2026-11-27 패스트파이브 강남3호점 — 월·수·금 다이닝룸 분리 · 금요일 냉장고 케어)
   * 저장된 매뉴얼의 revision 또는 케어 기준 주(fridgeWeek)가 시드와 다를 때만
   * 그 현장의 manual 만 새로 쓰고, 나머지 현장 정보·보고 기록은 건드리지 않습니다.
   * 케어 기준 주가 넘어가면(다음 금요일) 스티커 날짜만 새 날짜로 맞춥니다.
   */
  async _migrateSiteManuals() {
    const sites = await this.adapter.getAll('sites');
    if (!sites.length) return;
    for (const site of sites) {
      if (site.id !== 'site_fastfive_gangnam3') continue;
      const current = site.manual;
      const fresh = buildFastfiveManual();
      if (!current || typeof current !== 'object') continue; // _ensureSiteManual 이 채웁니다
      if (current.revision === fresh.revision && current.fridgeWeek === fresh.fridgeWeek) continue;
      await this.adapter.put('sites', {
        ...site,
        manual: JSON.parse(JSON.stringify(fresh)),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * v12 — 업장(siteId) 중심 연결 고리를 **기존 데이터에 채워 넣습니다**.
   *
   * 원칙
   *  · 이미 값이 있는 칸은 절대 바꾸지 않고, **비어 있는 칸만** 채웁니다.
   *  · 어떤 레코드도 지우거나 금액 · 날짜 · 서명을 다시 쓰지 않습니다.
   *  · 같은 기기 · 다른 기기에서 여러 번 돌아도 결과가 같습니다(멱등).
   *
   * 채우는 연결
   *  계약 → 업장(siteId) · 견적(quoteId) / 견적 → 계약(contractId) · 업장(siteId)
   *  업장 → 견적(quoteId) · 계약(contractId) · 팀장 계약(staffContractIds)
   *  보고 → 업장의 계약(contractId) · 팀장 계약(staffContractId) · 계정(accountId)
   */
  async _migrateSiteLinks() {
    const sites = await this.adapter.getAll('sites');
    if (!sites.length) return { sites: 0, quotes: 0, contracts: 0, staffContracts: 0, reports: 0 };

    const quotes = (await this.adapter.getAll('quotes')).map(normalizeQuote);
    const contracts = (await this.adapter.getAll('contracts')).map(normalizeAgreement);
    const staffContracts = (await this.adapter.getAll('staffContracts')).map(normalizeStaffContract);
    const reports = await this.adapter.getAll('reports');
    const accounts = await this.adapter.getAll('accounts');

    const siteById = new Map(sites.map((site) => [site.id, site]));
    const quoteById = new Map(quotes.map((quote) => [quote.id, quote]));
    /** '(주) 라이트하우스코스메틱' ↔ '라이트하우스코스메틱' — 같은 이름으로 보기 위한 비교값. */
    const normName = (value) =>
      String(value || '')
        .replace(/\(주\)|주식회사|유한회사|\s|[-–—_.,·]/g, '')
        .toLowerCase();
    const findSiteByName = (name) => {
      const needle = normName(name);
      if (!needle) return null;
      return (
        sites.find((site) => normName(site.name) === needle) ||
        sites.find((site) => normName(site.clientName) === needle) ||
        null
      );
    };

    const sitePatch = new Map();
    const quotePatch = new Map();
    const contractPatch = new Map();
    const reportPatch = new Map();
    const staffPatch = new Map();
    const touchedSites = new Set();

    const patchSite = (site, patch) => {
      const current = sitePatch.get(site.id) || { ...site };
      sitePatch.set(site.id, { ...current, ...patch });
      touchedSites.add(site.id);
    };

    // 1) 고지 계약 → 업장 · 견적
    for (const contract of contracts) {
      const quote = contract.quoteId ? quoteById.get(contract.quoteId) || null : null;
      let siteId = contract.siteId || '';
      if (!siteId) {
        if (quote && quote.siteId && siteById.has(quote.siteId)) siteId = quote.siteId;
        else {
          const byName = findSiteByName(contract.clientBusinessName);
          if (byName) siteId = byName.id;
        }
      }
      if (siteId && siteId !== contract.siteId) {
        contractPatch.set(contract.id, { siteId });
      }
      if (quote) {
        const patch = {};
        if (!quote.contractId) patch.contractId = contract.id;
        if (!quote.siteId && siteId) patch.siteId = siteId;
        if (contract.quoteId !== quote.id) patch.quoteId = contract.quoteId;
        if (Object.keys(patch).length) quotePatch.set(quote.id, { ...(quotePatch.get(quote.id) || {}), ...patch });
      }
    }

    // 2) 업장 → 계약 · 팀장 계약
    for (const site of sites) {
      const mine = contracts.filter((contract) => (contractPatch.get(contract.id) || contract).siteId === site.id);
      const signed = mine.filter((contract) => contract.status === 'signed');
      const pick = signed[signed.length - 1] || mine[mine.length - 1] || null;
      const patch = {};
      if (!site.contractId && pick) patch.contractId = pick.id;
      const contractId = site.contractId || patch.contractId || '';
      const boundQuote =
        (contractId && (contracts.find((row) => row.id === contractId) || {}).quoteId) ||
        (quotes.find((row) => row.siteId === site.id) || {}).id ||
        '';
      if (!site.quoteId && boundQuote) patch.quoteId = boundQuote;
      const staffIds = new Set(site.staffContractIds || []);
      for (const row of staffContracts) {
        if (row.siteIds.includes(site.id)) staffIds.add(row.id);
      }
      if (staffIds.size !== (site.staffContractIds || []).length) patch.staffContractIds = [...staffIds];
      if (Object.keys(patch).length) patchSite(site, patch);
    }

    // 3) 보고 → 계약 · 팀장 계약 · 계정
    for (const report of reports) {
      const site = siteById.get(report.siteId) || null;
      const patch = {};
      if (!report.contractId) {
        const bound = site ? sitePatch.get(site.id) || site : null;
        if (bound && bound.contractId) patch.contractId = bound.contractId;
      }
      if (!report.accountId && report.leader) {
        const account = accounts.find((row) => row.role !== 'customer' && row.name === report.leader);
        if (account) patch.accountId = account.id;
      }
      if (!report.staffContractId) {
        const accountId = report.accountId || patch.accountId || '';
        const mine = staffContracts.filter((row) => row.siteIds.includes(report.siteId));
        const found =
          mine.find((row) => accountId && row.accountId === accountId) ||
          mine.find((row) => row.name === report.leader) ||
          null;
        if (found) patch.staffContractId = found.id;
      }
      if (Object.keys(patch).length) reportPatch.set(report.id, patch);
    }

    // 4) 팀장 계약 — 계정이 비어 있고 같은 번호의 계정이 있으면 연결(반복 입력 방지)
    for (const row of staffContracts) {
      if (row.accountId) continue;
      const account = accounts.find((account2) => normalizePhone(account2.phone) === normalizePhone(row.phone) && account2.role === 'leader');
      if (account) staffPatch.set(row.id, { accountId: account.id });
    }

    let siteCount = 0;
    let quoteCount = 0;
    let contractCount = 0;
    let staffContractCount = 0;
    let reportCount = 0;

    for (const [id, patch] of contractPatch) {
      const row = contracts.find((item) => item.id === id);
      const next = normalizeAgreement({ ...row, ...patch, updatedAt: new Date().toISOString() });
      await this.adapter.put('contracts', next);
      contractCount += 1;
    }
    for (const [id, patch] of quotePatch) {
      const row = quoteById.get(id);
      if (!row) continue;
      const next = normalizeQuote({ ...row, ...patch, updatedAt: new Date().toISOString() });
      // 견적의 업장 연결은 계약에서 파생된 것이므로 이력에 남기지 않습니다(불필요한 기록만 늘림).
      await this.adapter.put('quotes', next);
      quoteCount += 1;
    }
    for (const [id, patch] of staffPatch) {
      const row = staffContracts.find((item) => item.id === id);
      const next = normalizeStaffContract({ ...row, ...patch, updatedAt: new Date().toISOString() });
      await this.adapter.put('staffContracts', next);
      staffContractCount += 1;
    }
    for (const [id, patch] of reportPatch) {
      const row = reports.find((item) => item.id === id);
      if (!row) continue;
      await this.adapter.put('reports', { ...row, ...patch });
      reportCount += 1;
    }
    for (const [id, patch] of sitePatch) {
      const row = sites.find((item) => item.id === id);
      if (!row) continue;
      const siteHistory = row.history;
      // 삭제 변동만 이력에 남깁니다 — 같은 기기에서 다시 돌아도 같은 id 라 한 번만 남습니다.
      const entry = makeHistoryEntry({
        actor: '시스템',
        action: '기존 데이터 연결 정리',
        note: '기존 기록은 그대로 두고, 업장 기준 연결 정보만 추가했습니다.',
      });
      entry.id = `hist_link_${id}_${SEED_VERSION}`;
      const next = {
        ...row,
        ...patch,
        history: withHistory(siteHistory, entry),
        updatedAt: new Date().toISOString(),
      };
      await this.adapter.put('sites', normalizeSite(next));
      siteCount += 1;
    }

    await this.setSetting('seedVersion', SEED_VERSION);
    if (siteCount || quoteCount || contractCount || staffContractCount || reportCount) {
      this._notify();
    }
    return {
      sites: siteCount,
      quotes: quoteCount,
      contracts: contractCount,
      staffContracts: staffContractCount,
      reports: reportCount,
    };
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

  /* ---------------- 연결 고리 (업장 siteId 중심) · 변경 이력 ---------------- */

  /**
   * 레코드 한 건에 변경 이력을 남깁니다.
   *  table : sites · quotes · contracts · staffContracts
   * 이력은 그 레코드 안(`history`)에 쌓여 서버로도 같이 동기화됩니다.
   * (새 서버 컬렉션을 만들지 않아 스키마를 바꾸지 않아도 됩니다.)
   */
  async recordHistory(table, id, { actor = '', action = '', note = '', changes = [] } = {}) {
    const key = toText(id);
    if (!key) return null;
    const row = await this.adapter.get(table, key);
    if (!row) return null;
    const entry = makeHistoryEntry({ actor, action, note, changes });
    const next = { ...row, history: withHistory(row.history, entry) };
    if (table !== 'sites') next.updatedAt = entry.at;
    await this.adapter.put(table, next);
    return entry;
  }

  /** 업장·견적·계약·팀장 계약의 이력을 한 줄기로 모읍니다(최신이 앞). */
  async listSiteHistory(siteId, { limit = 0 } = {}) {
    const site = await this.getSite(siteId);
    if (!site) return [];
    const quotes = (await this.adapter.getAll('quotes'))
      .map(normalizeQuote)
      .filter((row) => row.id === site.quoteId || row.siteId === site.id);
    const quoteIds = new Set(quotes.map((row) => row.id));
    const contracts = (await this.adapter.getAll('contracts'))
      .map(normalizeAgreement)
      .filter((row) => row.id === site.contractId || row.siteId === site.id || (row.quoteId && quoteIds.has(row.quoteId)));
    const staffContracts = (await this.adapter.getAll('staffContracts'))
      .map(normalizeStaffContract)
      .filter((row) => row.siteIds.includes(site.id) || (site.staffContractIds || []).includes(row.id));

    const push = (rows, { source, sourceLabel, ownerId, ownerName }) => {
      const out = [];
      for (const row of normalizeHistory(rows)) {
        out.push({ ...row, source, sourceLabel, ownerId, ownerName });
      }
      return out;
    };

    const all = [
      ...push(site.history, { source: 'site', sourceLabel: '업장', ownerId: site.id, ownerName: site.name }),
      ...quotes.flatMap((quote) =>
        push(quote.history, { source: 'quote', sourceLabel: '견적', ownerId: quote.id, ownerName: quote.no || quote.clientCompany }),
      ),
      ...contracts.flatMap((contract) =>
        push(contract.history, { source: 'contract', sourceLabel: '고객 계약', ownerId: contract.id, ownerName: contract.no }),
      ),
      ...staffContracts.flatMap((contract) =>
        push(contract.history, {
          source: 'staffContract',
          sourceLabel: '팀장 계약',
          ownerId: contract.id,
          ownerName: `${contract.name} ${contract.no ? `(${contract.no})` : ''}`.trim(),
        }),
      ),
    ];
    all.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return limit > 0 ? all.slice(0, limit) : all;
  }

  /**
   * 업장 하나에 이어진 기록을 한 번에 — 견적 · 고객 계약 · 팀장 계약 · 보고 · 고객 계정 · 이력.
   * 화면에서는 이 값으로 "이 업장이 어디서 왔고 누가 맡고 있는지"를 보여 줍니다.
   */
  async siteLinks(siteId) {
    const site = await this.getSite(siteId);
    if (!site) return null;
    const [quotes, contracts, staffContracts, reports, accounts, history] = await Promise.all([
      this.adapter.getAll('quotes'),
      this.adapter.getAll('contracts'),
      this.adapter.getAll('staffContracts'),
      this.adapter.getAll('reports'),
      this.adapter.getAll('accounts'),
      this.listSiteHistory(site.id, { limit: 8 }),
    ]);

    const quoteRows = quotes.map(normalizeQuote);
    const quote =
      quoteRows.find((row) => row.id === site.quoteId) ||
      quoteRows.find((row) => row.siteId === site.id) ||
      null;
    const contractRows = contracts.map(normalizeAgreement);
    const contract =
      contractRows.find((row) => row.id === site.contractId) ||
      contractRows.find((row) => row.siteId === site.id) ||
      (quote ? contractRows.find((row) => row.quoteId === quote.id) : null) ||
      null;
    const staffRows = staffContracts
      .map(normalizeStaffContract)
      .filter((row) => row.siteIds.includes(site.id) || (site.staffContractIds || []).includes(row.id));
    const siteReports = reports.filter((row) => row.siteId === site.id);
    const customers = accounts.filter((row) => row.role === 'customer' && row.siteId === site.id);

    return {
      site,
      quote,
      contract,
      staffContracts: staffRows,
      customers,
      reports: {
        total: siteReports.length,
        pending: siteReports.filter((row) => (row.status || 'submitted') === 'pending').length,
        last: siteReports.sort((a, b) => Store.sortKey(b).localeCompare(Store.sortKey(a)))[0] || null,
      },
      history,
    };
  }

  /** 현장 목록 전체의 연결 요약 (관리 화면 카드용, 한 번에 읽습니다). */
  async listSiteLinks() {
    const [sites, quotes, contracts, staffContracts, reports] = await Promise.all([
      this.listSites(),
      this.adapter.getAll('quotes'),
      this.adapter.getAll('contracts'),
      this.adapter.getAll('staffContracts'),
      this.adapter.getAll('reports'),
    ]);
    const quoteRows = quotes.map(normalizeQuote);
    const contractRows = contracts.map(normalizeAgreement);
    const staffRows = staffContracts.map(normalizeStaffContract);
    const out = {};
    for (const site of sites) {
      const quote =
        quoteRows.find((row) => row.id === site.quoteId) || quoteRows.find((row) => row.siteId === site.id) || null;
      const contract =
        contractRows.find((row) => row.id === site.contractId) ||
        contractRows.find((row) => row.siteId === site.id) ||
        (quote ? contractRows.find((row) => row.quoteId === quote.id) : null) ||
        null;
      const staff = staffRows.filter((row) => row.siteIds.includes(site.id) || (site.staffContractIds || []).includes(row.id));
      const siteReports = reports.filter((row) => row.siteId === site.id);
      const last = siteReports.sort((a, b) => Store.sortKey(b).localeCompare(Store.sortKey(a)))[0] || null;
      // 카드에서 바로 보여 줄 최근 이력 — 업장 · 견적 · 계약 · 팀장 계약을 합쳐 최신 4건.
      const history = [
        ...(site.history || []).map((row) => ({ ...row, sourceLabel: '업장' })),
        ...(quote ? (quote.history || []).map((row) => ({ ...row, sourceLabel: '견적' })) : []),
        ...(contract ? (contract.history || []).map((row) => ({ ...row, sourceLabel: '고객 계약' })) : []),
        ...staff.flatMap((row) => (row.history || []).map((item) => ({ ...item, sourceLabel: '팀장 계약' }))),
      ]
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .slice(0, 4);
      out[site.id] = {
        site,
        quote,
        contract,
        staffContracts: staff,
        reportTotal: siteReports.length,
        reportPending: siteReports.filter((row) => (row.status || 'submitted') === 'pending').length,
        lastReport: last,
        history,
        historyCount: (site.history || []).length,
      };
    }
    return out;
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
   * 화면이 쓰는 업장 목록 — 직원에게는 **배정된 업장만**, 계약 금액·고객 정보를
   * 지운 형태로 돌려줍니다(v2.8.2). 대표는 기존과 같이 전체 업장입니다.
   */
  async listSitesFor(session) {
    const sites = await this.listSites();
    if (!session) return [];
    if (isCeoActor(session)) return sites;
    // 고객 — 계약한 업장(방 입장 권한 있음) + 견적을 진행 중인 업장만.
    if (isCustomerActor(session)) {
      const ids = await this._customerSiteIds(session);
      return sites.filter((site) => ids.includes(site.id)).map((site) => siteForCustomer(site));
    }
    if (!isStaffActor(session)) return [];
    const mine = new Set(assignedSiteIdsOf(session));
    return sites.filter((site) => mine.has(site.id)).map((site) => siteForSession(session, site));
  }

  /** 업장 한 곳 — 직원은 배정된 곳만, 고객은 계약·진행 중 견적의 업장만. */
  async getSiteFor(session, id) {
    if (!session) return null;
    if (isCustomerActor(session)) {
      const ids = await this._customerSiteIds(session);
      if (!ids.includes(toText(id))) return null;
      const site = await this.getSite(id);
      return site ? siteForCustomer(site) : null;
    }
    if (!isCeoActor(session)) {
      if (!isStaffActor(session) || !canOpenSite(session, id)) return null;
    }
    const site = await this.getSite(id);
    if (!site) return null;
    return siteForSession(session, site);
  }

  /**
   * 고객 계정이 열 수 있는 업장 id (기획서 5장 — 자신이 계약하거나 견적을 진행 중인 업장만).
   *  · 계약 후: 방 입장 권한이 있는 자기 업장
   *  · 계약 전: 이 계정이 초대받아 진행 중인 견적의 업장
   */
  async _customerSiteIds(session) {
    if (!session) return [];
    const ids = [];
    const add = (value) => {
      const id = toText(value);
      if (id && !ids.includes(id)) ids.push(id);
    };
    const ownSiteId = toText(session.siteId);
    if (ownSiteId && session.accountId) {
      // 계정에 저장된 자기 업장이면 허용합니다. 입장 코드를 아직 안 쓴 계정도
      // 업장 이름·주소를 확인한 뒤 코드 입력 화면으로 갈 수 있어야 합니다.
      const account = await this.getAccount(session.accountId);
      if (account && account.role === 'customer' && toText(account.siteId) === ownSiteId) add(ownSiteId);
    }

    const quotes = (await this.adapter.getAll('quotes')).map(normalizeQuote);
    const mine = quotes.filter(
      (quote) =>
        session.accountId &&
        (quote.inviteUsedBy === session.accountId || (session.quoteId && quote.id === session.quoteId)),
    );
    for (const quote of mine) {
      if (quote.status === 'contracted') continue;
      add(quote.siteId);
    }
    return ids;
  }

  /**
   * Register a site from the admin screen (a new contract, a real client, ...).
   * Business registration details are kept with the site and shown in the app.
   */
  async addSite(input = {}, { actor = null } = {}) {
    denyStaff(actor, '새 현장 등록');
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
      contactPhone: String(input.contactPhone || '').trim(),
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
      // 2·3단계 — 방문 기록 · 구역 사진 · 관리방 상태를 처음부터 함께 저장합니다.
      survey: normalizeSurvey(input.survey),
      surveyPhotos: normalizeSitePhotos(input.surveyPhotos),
      room: normalizeRoom(input.room),
      createdAt: new Date().toISOString(),
      source: 'app',
    };
    site.history = withHistory([], makeHistoryEntry({
      actor: toText(input.actor) || '대표',
      action: '업장 등록',
      note: `${site.name} · ${site.code}${input.quoteId ? ` · 견적 ${input.quoteId}` : ''}`,
    }));
    if (input.quoteId) site.quoteId = toText(input.quoteId);
    if (input.contractId) site.contractId = toText(input.contractId);

    await this.adapter.put('sites', site);
    await this.assignLeadersToSite(site.id, input.leaderIds || []);
    // 새 업장은 담당 팀장의 도급계약서 별첨에도 바로 올립니다.
    await this.syncStaffContractSites(site.id);
    this._notify();
    return site;
  }

  async updateSite(id, patch = {}, { actor = null } = {}) {
    denyStaff(actor, '현장 정보 수정');
    const site = await this.getSite(id);
    if (!site) throw new StoreError('no-site', '현장을 찾을 수 없습니다.');
    const next = { ...site, ...patch, id: site.id, updatedAt: new Date().toISOString() };
    if (patch.baseline) next.baseline = normalizeBaseline(patch.baseline);
    if (patch.contract !== undefined) next.contract = normalizeContract(patch.contract);
    if (patch.ops !== undefined) next.ops = normalizeOps(patch.ops);
    delete next.leaderIds;
    const changes = diffFields(siteHistorySnapshot(site), siteHistorySnapshot(next), SITE_HISTORY_LABELS);
    if (changes.length) {
      next.history = withHistory(site.history, makeHistoryEntry({
        actor: toText(patch.actor) || '앱',
        action: '업장 정보 수정',
        changes,
      }));
    }
    await this.adapter.put('sites', next);
    if (Array.isArray(patch.leaderIds)) await this.assignLeadersToSite(site.id, patch.leaderIds);
    // 담당 팀장이 바뀌면 팀장 계약서 별첨도 함께 맞춥니다.
    if (Array.isArray(patch.leaderIds) || 'manager' in patch || 'managerRole' in patch) {
      await this.syncStaffContractSites(site.id);
    }
    this._notify();
    return normalizeSite(await this.getSite(site.id));
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
  async updateSiteDetails(siteId, patch = {}, { actor = null } = {}) {
    denyStaff(actor, '계약 · 운영 정보 수정');
    const site = await this.getSite(siteId);
    if (!site) throw new StoreError('no-site', '현장을 찾을 수 없습니다.');
    const next = { ...site };
    if (patch.contract && typeof patch.contract === 'object') {
      next.contract = normalizeContract({ ...site.contract, ...patch.contract });
    }
    if (patch.ops && typeof patch.ops === 'object') {
      next.ops = normalizeOps({ ...site.ops, ...patch.ops });
    }
    for (const key of ['name', 'clientName', 'address', 'area', 'frequency', 'contactName', 'contactPhone', 'bizNumber', 'ceoName', 'taxEmail', 'manager', 'managerRole', 'accessNote']) {
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
    const changes = diffFields(siteHistorySnapshot(site), siteHistorySnapshot(next), SITE_HISTORY_LABELS);
    next.updatedAt = new Date().toISOString();
    if (changes.length) {
      next.history = withHistory(site.history, makeHistoryEntry({
        actor: toText(patch.actor) || '앱',
        action: '계약 · 운영 정보 수정',
        changes,
      }));
    }
    await this.adapter.put('sites', next);
    // 업장에서 고친 고객사 정보(대표자·사업자번호·주소·담당자)는 연결된 견적서의
    // **비어 있는 칸**에도 채워, 견적서·계약서에 같은 값을 다시 적지 않게 합니다.
    if (site.quoteId) {
      const quote = await this.getQuote(site.quoteId).catch(() => null);
      if (quote) {
        const quotePatch = {};
        const pairs = [
          ['clientCeo', 'ceoName'],
          ['clientBizNumber', 'bizNumber'],
          ['clientAddress', 'address'],
          ['clientContact', 'contactName'],
          ['clientPhone', 'contactPhone'],
        ];
        for (const [quoteKey, siteKey] of pairs) {
          if (!quote[quoteKey] && next[siteKey]) quotePatch[quoteKey] = next[siteKey];
        }
        if (Object.keys(quotePatch).length) {
          await this.adapter.put('quotes', normalizeQuote({
            ...quote,
            ...quotePatch,
            updatedAt: new Date().toISOString(),
            history: withHistory(quote.history, makeHistoryEntry({
              actor: toText(patch.actor) || '앱',
              action: '업장 정보에서 승계',
              note: `${Object.keys(quotePatch).join(', ')} — 업장 정보와 같게 맞춤`,
            })),
          }));
        }
      }
    }
    // 담당 팀장을 바꾸면 팀장 계약서 별첨도 함께 맞춥니다.
    if ('manager' in patch || 'managerRole' in patch) await this.syncStaffContractSites(siteId);
    this._notify();
    return normalizeSite(await this.getSite(siteId));
  }

  /** 전체 매출 정리 — 행별 내역과 합계 (관리자 화면 전용). */
  async revenueSummary({ actor = null } = {}) {
    denyStaff(actor, '매출 정리');
    const sites = (await this.listSites()).filter((site) => site.active !== false);
    return { rows: sites.map(contractRow), totals: revenueTotals(sites) };
  }

  /** Give the chosen team leaders this site (never removes their other sites). */
  async assignLeadersToSite(siteId, leaderIds = [], { actor = null } = {}) {
    denyStaff(actor, '담당 직원 배정');
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

  /**
   * 현장 담당 팀장 계정 — 배정(assignedSiteIds) 또는 담당자 이름으로 찾습니다.
   * (이름만 적어 둔 예전 현장도 팀장 계정과 이어지게 합니다.)
   */
  async _siteManagers(site) {
    const accounts = await this.adapter.getAll('accounts');
    return accounts.filter((account) => {
      if (account.role !== 'leader') return false;
      if ((account.assignedSiteIds || []).includes(site.id)) return true;
      return !!site.manager && account.name === site.manager;
    });
  }

  /**
   * 현장을 담당 팀장의 계약서 별첨(siteIds)에 반영합니다.
   *  - 담당 팀장의 계약서에는 이 현장을 더합니다(체결된 계약서도 별첨 줄만 더하고
   *    금액·서명·기간은 건드리지 않습니다).
   *  - 담당이 아닌 팀장의 ‘미체결’ 계약서에서는 이 현장을 뺍니다.
   *    (체결된 계약서는 서명 당시 조건을 지키기 위해 그대로 둡니다.)
   */
  async syncStaffContractSites(siteId, { remove = true } = {}) {
    const site = await this.getSite(siteId);
    if (!site) return [];
    const managers = await this._siteManagers(site);
    const managerIds = new Set(managers.map((account) => account.id));
    const rows = (await this.adapter.getAll('staffContracts')).map(normalizeStaffContract);
    const changed = [];
    const linkedIds = new Set(site.staffContractIds || []);
    for (const contract of rows) {
      const mine = contract.accountId
        ? managerIds.has(contract.accountId)
        : managers.some((account) => account.name === contract.name);
      const has = contract.siteIds.includes(site.id);
      if (mine && has) {
        linkedIds.add(contract.id);
        continue;
      }
      if (mine && !has) {
        const entry = makeHistoryEntry({
          actor: '앱',
          action: '업장 배정',
          note: `${contract.name} ${contract.roleTitle || '팀장'} · ${contract.no} 별첨에 추가`,
        });
        const next = normalizeStaffContract({
          ...contract,
          siteIds: [...contract.siteIds, site.id],
          updatedAt: new Date().toISOString(),
          history: withHistory(contract.history, entry),
        });
        await this.adapter.put('staffContracts', next);
        changed.push({ id: contract.id, action: 'added' });
        linkedIds.add(contract.id);
      } else if (remove && !mine && has && contract.status !== 'signed') {
        const next = normalizeStaffContract({
          ...contract,
          siteIds: contract.siteIds.filter((id) => id !== site.id),
          updatedAt: new Date().toISOString(),
          history: withHistory(contract.history, makeHistoryEntry({
            actor: '앱',
            action: '업장 배정 해제',
            note: `${site.name} 이(가) 담당에서 빠졌습니다.`,
          })),
        });
        await this.adapter.put('staffContracts', next);
        changed.push({ id: contract.id, action: 'removed' });
        linkedIds.delete(contract.id);
      }
    }
    // 업장 쪽에도 팀장 계약 id 를 같은 값으로 유지합니다(업장 → 팀장 계약 연결).
    const before = (site.staffContractIds || []).slice().sort().join(',');
    const after = [...linkedIds].sort().join(',');
    if (before !== after) {
      const current = await this.getSite(site.id);
      await this.adapter.put('sites', { ...current, staffContractIds: [...linkedIds] });
    }
    if (changed.length) {
      await this.recordHistory('sites', site.id, {
        actor: '앱',
        action: '담당 팀장 · 팀장 계약 변경',
        note: changed
          .map((row) => {
            const contract = rows.find((item) => item.id === row.id);
            const name = contract ? `${contract.name} ${contract.no}` : row.id;
            return `${name} ${row.action === 'added' ? '별첨 추가' : '별첨 제외'}`;
          })
          .join(' · '),
      });
      this._notify();
    }
    return changed;
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
      photos: Array.isArray(patch.photos)
        ? patch.photos.slice(0, MAX_BASELINE_PHOTOS)
        : current.photos.slice(0, MAX_BASELINE_PHOTOS),
    };
    const next = { ...site, baseline, updatedAt: new Date().toISOString() };
    await this.adapter.put('sites', next);
    this._notify();
    return next;
  }

  /* ---------------- 견적 기준표 · 체크리스트 설정 (기획서 6·7장) ---------------- */

  /** 기준 가격표 · 조정 항목 · 표 밖 평수 규칙 — 저장된 값이 없으면 기본값(미설정)입니다. */
  async getQuoteSettings() {
    return normalizeQuoteSettings(await this.getSetting('quoteSettings', null));
  }

  /** 관리자가 기준표 · 조정 금액/률 · 산출 규칙을 바꿉니다. 바뀐 칸은 전/후 값과 함께 이력에 남습니다. */
  async saveQuoteSettings(patch = {}, { actor = '대표' } = {}) {
    if (typeof actor === 'object' && actor) denyStaff(actor, '견적 기준표 설정');
    const before = await this.getQuoteSettings();
    const source = patch && typeof patch === 'object' ? patch : {};
    const merged = normalizeQuoteSettings({
      ...before,
      ...source,
      areaRule: { ...before.areaRule, ...(source.areaRule || {}) },
      workHours: { ...before.workHours, ...(source.workHours || {}) },
      other: { ...before.other, ...(source.other || {}) },
    });
    const labels = { ...QUOTE_SETTINGS_LABELS };
    for (const row of merged.priceTable) {
      labels[`price_${row.pyeong}_min`] = `${row.pyeong}평 최소`;
      labels[`price_${row.pyeong}_max`] = `${row.pyeong}평 최대`;
    }
    const changes = diffFields(quoteSettingsSnapshot(before), quoteSettingsSnapshot(merged), labels);
    const who = toText(actor) || '대표';
    const next = {
      ...merged,
      updatedAt: new Date().toISOString(),
      by: who,
      history: withHistory(
        before.history,
        makeHistoryEntry({
          actor: who,
          action: changes.length ? '견적 기준표 · 설정 수정' : '견적 설정 저장',
          changes,
        }),
      ),
    };
    await this.setSetting('quoteSettings', next);
    this._notify();
    return normalizeQuoteSettings(next);
  }

  /** 견적 체크리스트(구역·항목) — 기본값은 기획서 6장입니다. */
  async getQuoteChecklist() {
    return normalizeQuoteChecklist(await this.getSetting('quoteChecklist', null));
  }

  async saveQuoteChecklist(input, { actor = '대표' } = {}) {
    if (typeof actor === 'object' && actor) denyStaff(actor, '견적 체크리스트 설정');
    const before = await this.getQuoteChecklist();
    const next = normalizeQuoteChecklist({ ...input, updatedAt: new Date().toISOString(), by: toText(actor) || '대표' });
    const labels = {};
    const snapshot = (checklist) => {
      const out = {};
      for (const zone of checklist.zones) {
        labels[`zone_${zone.key}`] = zone.label;
        out[`zone_${zone.key}`] = `${zone.label}: ${zone.items.join(' | ')}`;
      }
      return out;
    };
    const changes = diffFields(snapshot(before), snapshot(next), labels);
    const who = toText(actor) || '대표';
    const saved = {
      ...next,
      history: withHistory(
        before.history,
        makeHistoryEntry({
          actor: who,
          action: '견적 체크리스트 수정',
          note: `${next.zones.length}개 구역 · 항목 ${next.zones.reduce((sum, zone) => sum + zone.items.length, 0)}개`,
          changes,
        }),
      ),
    };
    await this.setSetting('quoteChecklist', saved);
    this._notify();
    return normalizeQuoteChecklist(saved);
  }

  /* ---------------- 현장 방문 · 구역별 사진 (기획서 4장) ---------------- */

  /** 방문 기록 저장 — 비어 있는 칸만 바꾸고, 바뀐 칸은 업장 이력에 남깁니다. */
  async updateSiteSurvey(siteId, patch = {}, { actor = '앱' } = {}) {
    if (typeof actor === 'object' && actor) denyStaff(actor, '현장 방문 · 견적 기록');
    const site = await this.getSite(siteId);
    if (!site) throw new StoreError('no-site', '현장을 찾을 수 없습니다.');
    const before = normalizeSurvey(site.survey);
    const now = new Date().toISOString();
    const survey = normalizeSurvey({
      ...before,
      ...(patch || {}),
      updatedAt: now,
      by: toText(actor) || before.by || '앱',
    });
    const changes = diffFields(surveyDisplay(before), surveyDisplay(survey), SURVEY_FIELD_LABELS);
    const next = {
      ...site,
      survey,
      updatedAt: now,
      history: withHistory(
        site.history,
        makeHistoryEntry({
          actor: toText(actor) || '앱',
          action: changes.length ? '현장 방문 정보 수정' : '현장 방문 정보 저장',
          note: `${survey.visitDate || '방문일 미기록'} · ${survey.siteName || survey.clientName || site.name}`,
          changes,
        }),
      ),
    };
    await this.adapter.put('sites', next);
    this._notify();
    return normalizeSite(await this.getSite(siteId));
  }

  /**
   * 현장 사진 한 장 등록 — 같은 구역·같은 날짜라도 **덮어쓰지 않고** 뒤에 쌓습니다.
   * 계약 전에 찍은 사진은 `firstQuote: true` 로 남아 첫 견적 사진으로 쓰입니다.
   */
  async addSitePhoto(siteId, input = {}, { actor = null } = {}) {
    denyStaff(actor, '현장 방문 사진 · 견적 기록');
    const site = await this.getSite(siteId);
    if (!site) throw new StoreError('no-site', '현장을 찾을 수 없습니다.');
    if (!input.ref || typeof input.ref !== 'object' || !input.ref.id) {
      throw new StoreError('photo-empty', '사진을 먼저 촬영하거나 선택해 주세요.');
    }
    const now = new Date().toISOString();
    const entry = normalizeSitePhoto({
      id: uid('sitephoto'),
      area: input.area,
      date: toText(input.date) || todayISO(),
      by: toText(input.by),
      memo: toText(input.memo),
      firstQuote: input.firstQuote !== false,
      quoteId: toText(input.quoteId),
      ref: input.ref,
      createdAt: now,
    });
    const photos = [...normalizeSitePhotos(site.surveyPhotos), entry];
    const areaLabel = (SURVEY_PHOTO_AREAS.find((row) => row.key === entry.area) || {}).label || '기타';
    const next = {
      ...site,
      surveyPhotos: photos,
      updatedAt: now,
      history: withHistory(
        site.history,
        makeHistoryEntry({
          actor: entry.by || '앱',
          action: '현장 사진 등록',
          note: `${areaLabel}${entry.memo ? ` · ${entry.memo}` : ''} · 누적 ${photos.length}장${entry.firstQuote ? ' · 첫 견적 사진' : ''}`,
        }),
      ),
    };
    await this.adapter.put('sites', next);
    this._notify();
    return entry;
  }

  async listSitePhotos(siteId) {
    const site = await this.getSite(siteId);
    return site ? normalizeSitePhotos(site.surveyPhotos) : [];
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

  async listQuotes({ siteId = null, status = null } = {}, { actor = null } = {}) {
    denyStaff(actor, '견적서');
    let rows = (await this.adapter.getAll('quotes')).map(normalizeQuote);
    if (isCustomerActor(actor)) {
      // 3단계 — 고객은 자기 견적만 봅니다(다른 고객·다른 업장 견적은 목록에도 없음).
      rows = rows.filter((quote) => this._quoteAllowed(quote, actor));
    }
    if (siteId) rows = rows.filter((quote) => quote.siteId === siteId);
    if (status) rows = rows.filter((quote) => quote.status === status);
    return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async getQuote(id, { actor = null } = {}) {
    denyStaff(actor, '견적서');
    const row = await this.adapter.get('quotes', id);
    if (!row) return null;
    const quote = normalizeQuote(row);
    if (isCustomerActor(actor) && !this._quoteAllowed(quote, actor)) {
      throw new StoreError('permission-denied', '다른 고객·다른 업장의 견적서는 볼 수 없습니다.');
    }
    return quote;
  }

  /** 이 고객 계정이 이 견적을 볼 수 있는가 — 초대받은 견적, 계약 후 자기 업장의 견적만. */
  _quoteAllowed(quote, session) {
    if (!quote) return false;
    if (!isCustomerActor(session)) return true;
    if (session.accountId && quote.inviteUsedBy === session.accountId) return true;
    if (session.quoteId && quote.id === session.quoteId) return true;
    if (quote.siteId && session.siteId && quote.siteId === session.siteId) return true;
    return false;
  }

  /**
   * 견적 등록 — 저장과 동시에 1회용 초대코드를 발급합니다.
   * `siteId`를 주면 그 업장의 고객사 · 주소 · 담당자 · 연락처 · 사업자번호 · 청소 조건을
   * **이미 등록된 값에서 그대로 가져 옵니다**(비어 있는 칸만 채움). 같은 내용을 두 번 적지 않습니다.
   */
  async addQuote(input = {}, { actor = null } = {}) {
    denyStaff(actor, '견적서 작성');
    denyCustomerWrites(actor, '견적서 작성');
    const site = input.siteId ? await this.getSite(input.siteId) : null;
    const pick = (key, siteValue) => toText(input[key]) || toText(siteValue);
    const fromSite = {
      siteId: site ? site.id : toText(input.siteId),
      clientCompany: pick('clientCompany', site ? site.clientName || site.name : ''),
      clientCategory: input.clientCategory || (site ? site.category : ''),
      clientAddress: pick('clientAddress', site ? site.address : ''),
      clientContact: pick('clientContact', site ? site.contactName : ''),
      clientBizNumber: pick('clientBizNumber', site ? site.bizNumber : ''),
      clientCeo: pick('clientCeo', site ? site.ceoName : ''),
      clientEmail: pick('clientEmail', site ? site.taxEmail : ''),
      clientTaxEmail: pick('clientTaxEmail', site ? site.taxEmail : ''),
      frequency: pick('frequency', site ? site.frequency : ''),
      area: pick('area', site ? site.area : ''),
      scope: pick('scope', site && site.ops ? site.ops.process : ''),
    };
    const company = toText(fromSite.clientCompany);
    if (!company) throw new StoreError('company-empty', '고객사명(상호)을 입력해 주세요.');
    const amount = toAmount(input.amount);
    if (!amount) throw new StoreError('amount-empty', '월 계약금액을 입력해 주세요.');

    const months = Number(input.periodMonths) > 0 ? Math.round(Number(input.periodMonths)) : 12;
    const startDate = toText(input.startDate) || todayISO();
    const endDate = toText(input.endDate) || addMonthsISO(startDate, months);
    const now = new Date().toISOString();
    const validUntil = toText(input.validUntil) || addDaysISO(todayISO(), QUOTE_VALID_DAYS);
    // 빈 문자열은 "입력하지 않음"으로 보고, 업장에서 가져온 값을 지우지 않습니다.
    const typed = {};
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'string' && !value.trim()) continue;
      typed[key] = value;
    }
    const quote = normalizeQuote({
      ...fromSite,
      ...typed,
      siteId: fromSite.siteId,
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
      history: withHistory([], makeHistoryEntry({
        actor: toText(input.actor) || '앱',
        action: '견적 작성',
        note: site
          ? `${site.name} 업장 정보에서 자동 승계 · ${company} · 월 ${amount.toLocaleString('ko-KR')}원`
          : `${company} · 월 ${amount.toLocaleString('ko-KR')}원`,
      })),
    });
    await this.adapter.put('quotes', quote);
    if (site) {
      const patch = {};
      if (!site.quoteId) patch.quoteId = quote.id;
      if (Object.keys(patch).length) {
        await this.adapter.put('sites', { ...(await this.adapter.get('sites', site.id)), ...patch });
      }
    }
    this._notify();
    return normalizeQuote(await this.adapter.get('quotes', quote.id));
  }

  /**
   * 기존 업장에서 바로 견적을 만듭니다(현장 방문 견적).
   * 금액만 정해 주면 업장 정보 · 청소 조건은 다시 적지 않습니다.
   */
  async createQuoteForSite(siteId, patch = {}, { actor = null } = {}) {
    denyStaff(actor, '견적서 작성');
    const site = await this.getSite(siteId);
    if (!site) throw new StoreError('no-site', '현장을 찾을 수 없습니다.');
    return this.addQuote({
      ...patch,
      siteId: site.id,
      clientCompany: patch.clientCompany || site.clientName || site.name,
      clientAddress: patch.clientAddress || site.address,
      clientContact: patch.clientContact || site.contactName,
      clientBizNumber: patch.clientBizNumber || site.bizNumber,
      clientTaxEmail: patch.clientTaxEmail || site.taxEmail,
      clientCategory: patch.clientCategory || site.category,
    });
  }

  async updateQuote(id, patch = {}, { actor = null } = {}) {
    denyStaff(actor, '견적서 수정');
    denyCustomerWrites(actor, '견적서 수정');
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
    const changes = [];
    if (quote.amount !== next.amount) changes.push({ field: '월 견적금액', from: String(quote.amount), to: String(next.amount) });
    if (quote.clientCompany !== next.clientCompany) changes.push({ field: '고객사', from: quote.clientCompany, to: next.clientCompany });
    if (quote.frequency !== next.frequency) changes.push({ field: '청소 주기', from: quote.frequency, to: next.frequency });
    if (quote.area !== next.area) changes.push({ field: '면적', from: quote.area, to: next.area });
    // 승인된 뒤 금액을 바꾸면 그 승인은 더 이상 그 금액의 승인이 아닙니다 — 승인을 풀고 다시 받습니다.
    if (quote.approval && quote.approval.status === 'approved' && quote.amount !== next.amount) {
      next.approval = normalizeQuoteApproval({});
      changes.push({ field: '금액 승인', from: '승인 완료', to: '금액 변경으로 승인 해제' });
    }
    if (changes.length) {
      next.history = withHistory(quote.history, makeHistoryEntry({
        actor: toText(patch.actor) || '앱',
        action: '견적 수정',
        changes,
      }));
    }
    await this.adapter.put('quotes', next);
    this._notify();
    return next;
  }

  /**
   * 현장 방문 기록 · 자동 산출 결과를 견적에 붙입니다.
   * 무엇이 바뀌었는지(방문 정보 · 최종 금액)를 견적 이력에 남깁니다.
   */
  async saveQuoteSurvey(quoteId, { survey, estimate, actor = '앱', note = '' } = {}) {
    if (typeof actor === 'object' && actor) denyCustomerWrites(actor, '견적서 수정');
    const quote = await this.getQuote(quoteId);
    if (!quote) throw new StoreError('no-quote', '견적을 찾을 수 없습니다.');
    const nextSurvey = normalizeSurvey({ ...normalizeSurvey(quote.survey), ...(survey || {}) });
    const nextEstimate = estimate === null ? null : normalizeQuoteEstimate(estimate || quote.estimate);
    const changes = diffFields(surveyDisplay(quote.survey), surveyDisplay(nextSurvey), SURVEY_FIELD_LABELS);
    const beforeFinal = quote.estimate ? quote.estimate.final : '';
    const afterFinal = nextEstimate ? nextEstimate.final : '';
    if (String(beforeFinal) !== String(afterFinal)) {
      changes.push({ field: '자동 견적 최종', from: String(beforeFinal), to: String(afterFinal) });
    }
    const next = normalizeQuote({
      ...quote,
      survey: nextSurvey,
      estimate: nextEstimate,
      updatedAt: new Date().toISOString(),
      history: withHistory(
        quote.history,
        makeHistoryEntry({ actor: toText(actor) || '앱', action: '현장 방문 · 견적 산출', note, changes }),
      ),
    });
    await this.adapter.put('quotes', next);
    this._notify();
    return next;
  }

  /**
   * 현장 방문 등록 → 업장(방문 기록 · 사진 자리) → 견적(기준표 자동 산출).
   * 기존 업장(siteId)을 주면 그 업장을 그대로 쓰고, 새 업장이면 하나만 만듭니다(중복 업장 방지).
   */
  async createSurveyQuote(input = {}) {
    const actor = toText(input.actor) || '앱';
    const settings = await this.getQuoteSettings();
    const checklist = await this.getQuoteChecklist();
    const zoneChecks = input.zoneChecks && typeof input.zoneChecks === 'object' ? input.zoneChecks : {};
    const zones = Array.isArray(input.zones) && input.zones.length
      ? input.zones
      : checklist.zones
          .filter((zone) => zone.kind !== 'extra' && Array.isArray(zoneChecks[zone.key]) && zoneChecks[zone.key].length)
          .map((zone) => zone.key);
    const extras = Array.isArray(input.extras) && input.extras.length
      ? input.extras
      : ((zoneChecks.extra || []).slice());
    let survey = normalizeSurvey({ ...input, zones, extras });
    // 구역 체크를 그대로 청소 범위 문구로 만듭니다 — 계약서 · 업장 공정에 다시 적지 않도록.
    const scopeText = checklist.zones
      .filter((zone) => zone.kind !== 'extra')
      .map((zone) => {
        const checked = Array.isArray(zoneChecks[zone.key]) ? zoneChecks[zone.key] : [];
        return checked.length ? `${zone.label}: ${checked.join(', ')}` : '';
      })
      .filter(Boolean)
      .join(' / ');
    const extraText = (Array.isArray(zoneChecks.extra) ? zoneChecks.extra : extras).join(', ');
    const estimate = estimateQuote(
      {
        ...input,
        pyeong: survey.pyeong,
        area: survey.area,
        frequency: survey.frequency,
        teamSize: survey.teamSize,
        difficulty: survey.difficulty,
        extras: survey.extras,
        hours: survey.hours,
        extraAmount: input.extraAmount,
        hoursAmount: input.hoursAmount,
        otherAmount: input.otherAmount,
        applyHours: input.applyHours,
        applyOther: input.applyOther,
      },
      settings,
    );
    if (!survey.pyeong && estimate.pyeong) survey = normalizeSurvey({ ...survey, pyeong: estimate.pyeong });
    const amount = toAmount(input.amount) || toAmount(estimate.final);
    if (!amount) {
      throw new StoreError('amount-empty', '기준표에 없는 평수입니다. 최종 견적 금액을 직접 입력해 주세요.');
    }

    let site = input.siteId ? await this.getSite(input.siteId) : null;
    const clientName = toText(survey.clientName) || toText(survey.siteName) || (site ? site.clientName || site.name : '');
    if (!clientName) throw new StoreError('company-empty', '고객사명을 입력해 주세요.');

    if (!site) {
      site = await this.addSite({
        name: toText(survey.siteName) || clientName,
        clientName,
        category: input.category || 'office',
        address: survey.address,
        area: survey.area || (survey.pyeong ? `${survey.pyeong}평` : ''),
        frequency: survey.frequency || '주 1회 (일정 협의)',
        contactName: survey.contactName,
        actor,
      });
    }
    await this.updateSiteSurvey(site.id, survey, { actor });
    const quote = await this.createQuoteForSite(site.id, {
      clientCompany: clientName,
      clientContact: survey.contactName,
      clientPhone: survey.contactPhone,
      clientAddress: survey.address,
      clientCategory: input.category || site.category,
      area: survey.area || (survey.pyeong ? `${survey.pyeong}평` : ''),
      frequency: survey.frequency,
      scope: scopeText,
      extraScope: extraText,
      amount,
      memo: survey.note,
      survey,
      estimate,
      actor,
    });
    const savedQuote = await this.saveQuoteSurvey(quote.id, {
      survey,
      estimate,
      actor,
      note: `${clientName} · 방문 ${survey.visitDate || '날짜 미기록'} · 최종 ${amount.toLocaleString('ko-KR')}원`,
    });
    return { quote: savedQuote, site: await this.getSite(site.id), estimate };
  }

  /**
   * 대표(최고관리자) 최종 금액 승인 → 계약서 자동 연동.
   * 업장이 연결된 견적은 그 업장을 그대로 씁니다(중복 업장 금지).
   */
  async approveQuoteAmount(quoteId, { by = '대표', note = '', role = 'admin' } = {}) {
    if (role !== 'admin') {
      throw new StoreError('approve-denied', '견적 금액 승인은 대표(최고관리자)만 할 수 있습니다.');
    }
    const quote = await this.getQuote(quoteId);
    if (!quote) throw new StoreError('no-quote', '견적을 찾을 수 없습니다.');
    if (!quote.amount) throw new StoreError('amount-empty', '견적 금액이 없습니다. 금액을 먼저 정해 주세요.');
    const now = new Date().toISOString();
    const who = toText(by) || '대표';
    const approval = normalizeQuoteApproval({ status: 'approved', by: who, at: now, amount: quote.amount, note });
    const next = normalizeQuote({
      ...quote,
      approval,
      status: quote.status === 'contracted' ? 'contracted' : 'accepted',
      updatedAt: now,
      history: withHistory(
        quote.history,
        makeHistoryEntry({
          actor: who,
          action: '견적 금액 승인',
          note: `최종 ${quote.amount.toLocaleString('ko-KR')}원${note ? ` · ${note}` : ''}`,
        }),
      ),
    });
    await this.adapter.put('quotes', next);
    // 승인 후 계약서 자동 연동 — createAgreementFromQuote 는 같은 견적의 계약서를 두 번 만들지 않습니다.
    const agreement = await this.createAgreementFromQuote(quote.id, { actor: { role: 'admin', name: who } });
    const site = quote.siteId ? await this.getSite(quote.siteId) : null;
    if (site) {
      await this.recordHistory('sites', site.id, {
        actor: who,
        action: '견적 금액 승인',
        note: `${next.no} · 최종 ${quote.amount.toLocaleString('ko-KR')}원 · 계약서 ${agreement.no}`,
      });
    }
    this._notify();
    return {
      quote: await this.getQuote(quote.id),
      agreement: await this.getAgreement(agreement.id),
      site,
    };
  }

  /** 견적서 발송 — 고객 방에서 열람할 수 있는 상태로 바꿉니다. */
  async sendQuote(id, { actor = null } = {}) {
    denyStaff(actor, '견적서 발송');
    denyCustomerWrites(actor, '견적서 발송');
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
  async regenerateQuoteInvite(id, { actor = null } = {}) {
    denyStaff(actor, '견적서 초대코드');
    denyCustomerWrites(actor, '견적서 초대코드');
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
  async enterQuoteRoomWithCode({ phone, code, name = '', title = '', email = '' }) {
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
        email: toText(email),
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
      account = {
        ...account,
        quoteId: quote.id,
        // 처음 적어 넣은 담당자 정보만 채웁니다(이미 있는 값은 그대로).
        name: account.name && !/^고객 /.test(account.name) ? account.name : toText(name) || account.name,
        title: toText(title) || account.title,
        email: account.email || toText(email),
        updatedAt: new Date().toISOString(),
      };
    }
    await this.adapter.put('accounts', account);

    const now = new Date().toISOString();
    const consumed = { ...quote, inviteUsedAt: now, inviteUsedBy: account.id, invitedPhone: digits, updatedAt: now };
    await this.adapter.put('quotes', consumed);
    await this.recordHistory('quotes', quote.id, {
      actor: account.name || '고객',
      action: '고객 방 입장',
      note: `${account.name || ''} ${account.title || ''} · 초대코드 사용`.trim(),
    });
    this._notify();
    return { account, quote: normalizeQuote(await this.adapter.get('quotes', quote.id)) };
  }

  /**
   * 고객 담당자 정보 확인 · 등록 (기획서 5장).
   * 초대코드로 들어온 사람이 자기 이름 · 직함 · 이메일을 확인해 저장하면, 같은 값이
   * 진행 중인 견적과 계약서의 담당자 칸에도 반영됩니다(같은 내용을 두 번 적지 않도록).
   */
  async updateCustomerContact(accountId, patch = {}, { actor = null } = {}) {
    const account = await this.getAccount(accountId);
    if (!account || account.role !== 'customer') {
      throw new StoreError('no-account', '고객 계정을 찾을 수 없습니다.');
    }
    if (actor && !isCeoActor(actor) && actor.accountId && actor.accountId !== account.id) {
      throw new StoreError('permission-denied', '본인 담당자 정보만 바꿀 수 있습니다.');
    }
    const name = toText(patch.name) || account.name;
    const title = patch.title !== undefined ? toText(patch.title) : toText(account.title);
    const email = patch.email !== undefined ? toText(patch.email) : toText(account.email);
    if (!name) throw new StoreError('name-empty', '담당자 이름을 입력해 주세요.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new StoreError('email-invalid', '이메일 주소를 확인해 주세요.');
    }
    const now = new Date().toISOString();
    const contactChanged =
      name !== toText(account.name) ||
      title !== toText(account.title) ||
      email !== toText(account.email);
    const next = {
      ...account,
      name,
      title,
      email,
      contactConfirmedAt: now,
      updatedAt: now,
    };
    await this.adapter.put('accounts', next);

    // 이 계정이 보고 있는 견적·계약서의 담당자 칸도 같은 값으로 맞춥니다.
    const quotes = (await this.adapter.getAll('quotes')).map(normalizeQuote);
    for (const quote of quotes) {
      if (quote.inviteUsedBy !== account.id && quote.id !== account.quoteId) continue;
      const quotePatch = {};
      if (name && quote.clientContact !== name) quotePatch.clientContact = name;
      if (quote.clientPhone !== account.phonePretty && quote.clientPhone !== account.phone) {
        quotePatch.clientPhone = account.phonePretty || account.phone;
      }
      if (email && quote.clientEmail !== email) quotePatch.clientEmail = email;
      if (!Object.keys(quotePatch).length) continue;
      await this.adapter.put('quotes', normalizeQuote({
        ...quote,
        ...quotePatch,
        updatedAt: now,
        history: withHistory(quote.history, makeHistoryEntry({
          actor: name,
          action: '담당자 정보 확인',
          note: `${name}${title ? ` ${title}` : ''}${email ? ` · ${email}` : ''}`,
        })),
      }));
    }
    const agreements = (await this.adapter.getAll('contracts')).map(normalizeAgreement);
    for (const agreement of agreements) {
      if (!account.siteId || agreement.siteId !== account.siteId) continue;
      // 서명된 계약서 원문은 그대로 둡니다(문서 해시 보존). 담당자 변경은 계정·견적에만 반영하고 이력에 남깁니다.
      const signed = agreement.status === 'signed' || agreement.status === 'renewed' || agreement.status === 'terminated';
      // 바뀐 담당자 정보가 없으면 서명된 계약서 이력에 같은 줄을 되풀이하지 않습니다.
      if (!contactChanged) continue;
      const agreementPatch = {};
      if (!signed && name && agreement.contactName !== name) agreementPatch.contactName = name;
      if (!Object.keys(agreementPatch).length && !signed) continue;
      await this.adapter.put('contracts', normalizeAgreement({
        ...agreement,
        ...agreementPatch,
        updatedAt: now,
        history: withHistory(agreement.history, makeHistoryEntry({
          actor: name,
          action: '담당자 정보 확인',
          note: `${name}${title ? ` ${title}` : ''}${signed ? ' · 서명된 계약서 원문은 그대로 보관' : ''}`,
        })),
      }));
    }
    this._notify();
    return next;
  }

  /* ---------------- contracts (도급 계약서 · 대표 전용) ---------------- */

  async listAgreements({ siteId = null, status = null } = {}, { actor = null } = {}) {
    denyStaff(actor, '고객 계약서');
    let rows = (await this.adapter.getAll('contracts')).map(normalizeAgreement);
    if (isCustomerActor(actor)) {
      // 3단계 — 고객은 자기 계약서만 봅니다.
      rows = rows.filter((row) => this._agreementAllowed(row, actor));
    }
    if (siteId) rows = rows.filter((row) => row.siteId === siteId);
    if (status) rows = rows.filter((row) => row.status === status);
    return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async getAgreement(id, { actor = null } = {}) {
    denyStaff(actor, '고객 계약서');
    const row = await this.adapter.get('contracts', id);
    if (!row) return null;
    const agreement = normalizeAgreement(row);
    if (isCustomerActor(actor) && !this._agreementAllowed(agreement, actor)) {
      throw new StoreError('permission-denied', '다른 고객·다른 업장의 계약서는 볼 수 없습니다.');
    }
    return agreement;
  }

  /** 이 고객 계정이 이 계약서를 볼 수 있는가 — 자기 업장 계약, 초대받은 견적의 계약만. */
  _agreementAllowed(agreement, session) {
    if (!agreement) return false;
    if (!isCustomerActor(session)) return true;
    if (agreement.siteId && session.siteId && agreement.siteId === session.siteId) return true;
    const quoteId = agreement.quoteId;
    if (!quoteId) return false;
    if (session.quoteId && session.quoteId === quoteId) return true;
    return false;
  }

  async getAgreementByQuote(quoteId, { actor = null } = {}) {
    denyStaff(actor, '고객 계약서');
    if (!quoteId) return null;
    const rows = (await this.adapter.getAll('contracts')).map(normalizeAgreement);
    const found = rows.find((row) => row.quoteId === quoteId) || null;
    if (found && isCustomerActor(actor) && !this._agreementAllowed(found, actor)) {
      throw new StoreError('permission-denied', '다른 고객·다른 업장의 계약서는 볼 수 없습니다.');
    }
    return found;
  }

  /** 견적을 표준 도급 계약서로 전환합니다 (이미 있으면 그 계약서). */
  /**
   * 견적을 표준 도급 계약서로 전환합니다 (이미 있으면 그 계약서).
   * 견적이 업장에 연결되어 있으면 **그 업장을 그대로 이어받습니다**(새 업장을 만들지 않음).
   */
  async createAgreementFromQuote(quoteId, { actor = null } = {}) {
    denyStaff(actor, '고객 계약서 작성');
    const quote = await this.getQuote(quoteId);
    if (!quote) throw new StoreError('no-quote', '견적을 찾을 수 없습니다.');
    // 고객은 자기 견적으로만 계약서를 열 수 있습니다(계약 진행 버튼).
    if (isCustomerActor(actor) && !this._quoteAllowed(quote, actor)) {
      throw new StoreError('permission-denied', '다른 고객·다른 업장의 견적으로는 계약을 만들 수 없습니다.');
    }
    const existing = await this.getAgreementByQuote(quote.id);
    if (existing) return existing;

    // 견적에 업장이 연결되어 있지 않으면 같은 상호의 업장을 찾아 잇습니다.
    let site = quote.siteId ? await this.getSite(quote.siteId) : null;
    if (!site) {
      const norm = (value) => String(value || '').replace(/\(주\)|주식회사|\s|[-–—_.,·]/g, '').toLowerCase();
      const needle = norm(quote.clientCompany);
      site = (await this.listSites()).find((row) => norm(row.name) === needle || norm(row.clientName) === needle) || null;
    }

    const now = new Date().toISOString();
    const actorName = toText(actor && actor.name) || toText(actor && actor.title) || '';
    const adminActor = !!actor && actor.role === 'admin';
    // 기획서 8장 — 견적에서 그대로 이어받는 계약 정보 13가지.
    //  고객사명 · 사업자등록번호 · 대표자 · 주소 · 담당자 · 계약 금액 · 청소 주기 ·
    //  청소 범위 · 계약 시작일 · 계약 종료일 · 작업시간 · 특약사항 · 계약 담당자
    const autoWorkHours =
      toText(quote.survey && quote.survey.hours) ||
      toText(site && site.survey && site.survey.hours) ||
      '';
    const autoCeo = toText(quote.clientCeo) || toText(site && site.ceoName) || '';
    const agreement = normalizeAgreement({
      id: uid('contract'),
      no: await this._nextDocNumber('contracts', 'CT'),
      quoteId: quote.id,
      siteId: site ? site.id : '',
      status: 'draft',
      clientAddress: quote.clientAddress || (site ? site.address : ''),
      clientBusinessName: quote.clientCompany,
      clientBizNumber: quote.clientBizNumber || (site ? site.bizNumber : ''),
      clientCeo: autoCeo,
      contactName: quote.clientContact || (site ? site.contactName : ''),
      contactPhone: quote.clientPhone || (site ? site.contactPhone : ''),
      startDate: quote.startDate,
      endDate: quote.endDate,
      months: quote.periodMonths,
      amount: quote.amount,
      vatIncluded: quote.vatIncluded,
      billingDay: quote.billingDay,
      scope: quote.scope,
      extraScope: quote.extraScope,
      frequency: quote.frequency,
      workHours: autoWorkHours,
      managerName: (adminActor ? actorName : '') || SUPPLIER.ceo,
      managerTitle: '대표',
      specialTerms: [quote.terms, quote.memo].filter(Boolean).join('\n'),
      docVersion: 1,
      createdAt: now,
      updatedAt: now,
      source: 'app',
      history: withHistory([], makeHistoryEntry({
        actor: '앱',
        action: '계약서 자동 생성',
        note: `견적 ${quote.no} 승인 — 고객사 · 사업자번호 · 대표자 · 주소 · 담당자 · 금액 · 주기 · 범위 · 기간 · 작업시간 · 특약을 견적에서 그대로 옮겼습니다`,
      })),
    });
    await this.adapter.put('contracts', agreement);
    const nextQuote = normalizeQuote({
      ...quote,
      status: quote.status === 'sent' ? 'accepted' : quote.status,
      contractId: agreement.id,
      siteId: quote.siteId || (site ? site.id : ''),
      // 비어 있던 고객사 정보는 이 기회에 업장 값에서 채웁니다(이미 있는 값은 그대로).
      clientCeo: quote.clientCeo || autoCeo,
      clientBizNumber: quote.clientBizNumber || (site ? site.bizNumber : ''),
      clientAddress: quote.clientAddress || (site ? site.address : ''),
      clientContact: quote.clientContact || (site ? site.contactName : ''),
      clientPhone: quote.clientPhone || (site ? site.contactPhone : ''),
      updatedAt: now,
      history: withHistory(quote.history, makeHistoryEntry({
        actor: '앱',
        action: '계약서 작성',
        note: `${agreement.no} 계약서로 전환${site ? ` · 업장 ${site.name} 연결` : ''}`,
      })),
    });
    await this.adapter.put('quotes', nextQuote);
    if (site) {
      const current = await this.getSite(site.id);
      const patch = {};
      if (!current.quoteId) patch.quoteId = quote.id;
      if (!current.contractId) patch.contractId = agreement.id;
      if (Object.keys(patch).length) await this.adapter.put('sites', { ...current, ...patch });
      await this.recordHistory('sites', site.id, {
        actor: '앱',
        action: '고객 계약서 작성',
        note: `${agreement.no} · 견적 ${quote.no}`,
      });
    }
    this._notify();
    return normalizeAgreement(await this.adapter.get('contracts', agreement.id));
  }

  async updateAgreement(id, patch = {}, { actor = null } = {}) {
    denyStaff(actor, '고객 계약서 수정');
    denyCustomerWrites(actor, '고객 계약서 수정');
    const agreement = await this.getAgreement(id);
    if (!agreement) throw new StoreError('no-contract', '계약서를 찾을 수 없습니다.');
    if (isAgreementClosed(agreement.status)) {
      throw new StoreError('already-signed', '체결·갱신·종료된 계약서는 수정할 수 없습니다.');
    }
    const next = normalizeAgreement({
      ...agreement,
      ...patch,
      id: agreement.id,
      quoteId: agreement.quoteId,
      createdAt: agreement.createdAt,
      updatedAt: new Date().toISOString(),
    });
    // 3단계 — 계약 수정은 무엇이 바뀌었는지 history[] 에 남깁니다.
    const changes = diffFields(agreementHistorySnapshot(agreement), agreementHistorySnapshot(next), AGREEMENT_HISTORY_LABELS);
    if (changes.length) {
      next.history = withHistory(agreement.history, makeHistoryEntry({
        actor: toText(actor && actor.name) || toText(patch.actor) || '대표',
        action: '계약서 수정',
        changes,
      }));
    }
    await this.adapter.put('contracts', next);
    this._notify();
    return next;
  }

  /** 계약서에 붙는 고객사 사업자등록증 · 특이사항 (체결 후에도 고칠 수 있음). */
  async updateAgreementMeta(id, patch = {}, { actor = null } = {}) {
    denyStaff(actor, '고객 계약서 수정');
    const agreement = await this.getAgreement(id);
    if (!agreement) throw new StoreError('no-contract', '계약서를 찾을 수 없습니다.');
    if (isCustomerActor(actor) && !this._agreementAllowed(agreement, actor)) {
      throw new StoreError('permission-denied', '다른 고객·다른 업장의 계약서는 고칠 수 없습니다.');
    }
    const before = {
      사업자등록증: agreement.bizLicense && agreement.bizLicense.id ? '등록' : '미등록',
      특이사항: agreement.contractMemo,
    };
    const next = normalizeAgreement({
      ...agreement,
      bizLicense: patch.bizLicense !== undefined ? patch.bizLicense : agreement.bizLicense,
      contractMemo: patch.contractMemo !== undefined ? patch.contractMemo : agreement.contractMemo,
      updatedAt: new Date().toISOString(),
    });
    const after = {
      사업자등록증: next.bizLicense && next.bizLicense.id ? '등록' : '미등록',
      특이사항: next.contractMemo,
    };
    const changes = diffFields(before, after, { 사업자등록증: '사업자등록증', 특이사항: '특이사항' });
    if (changes.length) {
      next.history = withHistory(agreement.history, makeHistoryEntry({
        actor: toText(actor && actor.name) || '대표',
        action: '계약서 특이사항 수정',
        changes,
      }));
    }
    await this.adapter.put('contracts', next);
    this._notify();
    return next;
  }

  /** 계약서를 고객에게 보냅니다 (고객 방에 ‘서명’ 카드가 뜨는 상태). */
  async sendAgreement(id, { actor = null } = {}) {
    denyStaff(actor, '고객 계약서 발송');
    denyCustomerWrites(actor, '고객 계약서 발송');
    const agreement = await this.getAgreement(id);
    if (!agreement) throw new StoreError('no-contract', '계약서를 찾을 수 없습니다.');
    if (isAgreementClosed(agreement.status)) return agreement;
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
  async signAgreement(contractId, payload = {}, { actor = null } = {}) {
    const agreement = await this.getAgreement(contractId);
    if (!agreement) throw new StoreError('no-contract', '계약서를 찾을 수 없습니다.');
    if (isStaffActor(actor)) {
      throw new StoreError('permission-denied', '고객 계약서에는 서명할 수 없습니다.');
    }
    if (isCustomerActor(actor) && !this._agreementAllowed(agreement, actor)) {
      throw new StoreError('permission-denied', '다른 고객·다른 업장의 계약서에는 서명할 수 없습니다.');
    }
    // 고객은 대표가 발송한 계약서에만 서명합니다(초안 상태에서 먼저 서명하지 않도록).
    if (isCustomerActor(actor) && agreement.status !== 'sent') {
      throw new StoreError('contract-not-sent', '대표가 계약서를 발송하면 서명할 수 있습니다.');
    }
    if (agreement.status === 'signed' && agreement.siteId) {
      return { agreement, site: await this.getSite(agreement.siteId) };
    }
    if (agreement.status === 'renewed' || agreement.status === 'terminated') {
      throw new StoreError('contract-closed', '갱신·종료된 계약서에는 다시 서명할 수 없습니다.');
    }
    // 서명 창에서 [서명 적용]을 누른 서명만 계약서에 들어갑니다.
    if (!toText(payload.signature)) {
      throw new StoreError('signature-empty', '서명란에 서명해 주세요.');
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
    const pyeong =
      toText(quote && quote.survey && quote.survey.pyeong ? String(quote.survey.pyeong) : '') ||
      toText(parsePyeong(quote ? quote.area : '')) ||
      '';

    let site = agreement.siteId ? await this.getSite(agreement.siteId) : null;
    if (!site) {
      site = (await this.listSites()).find((row) => row.name === client.businessName) || null;
    }

    // 견적 방문 사진(구역별)은 계약 뒤에도 첫 견적 사진으로 남습니다.
    const surveyPhotos = quote && quote.siteId
      ? await this.listSitePhotos(quote.siteId).catch(() => [])
      : [];
    const baselineQuotePhotos =
      quote && quote.photos && quote.photos.length
        ? quote.photos.slice()
        : surveyPhotos.map((photo) => ({
            ...(photo.ref || {}),
            caption: `${(SURVEY_PHOTO_AREAS.find((row) => row.key === photo.area) || {}).label || '현장'}${photo.memo ? ` · ${photo.memo}` : ''}`,
          }));
    const room = normalizeRoom({
      status: 'active',
      createdAt: now,
      contractId: agreement.id,
      quoteId: quote ? quote.id : '',
      openedBy: '고객 계약 체결',
      pyeong,
      frequency,
      note: '계약서·견적서·최초 현장 사진·청소 조건을 그대로 이어받은 업장 관리방',
    });

    if (!site) {
      site = await this.addSite({
        name: client.businessName,
        clientName: client.businessName,
        // 같은 계약에서 나온 업장이라는 것을 바로 남깁니다(나중에 다시 찾지 않도록).
        quoteId: quote ? quote.id : '',
        contractId: agreement.id,
        category,
        address: client.address,
        area: (quote ? quote.area : '') || (pyeong ? `${pyeong}평` : ''),
        frequency,
        intervalDays: intervalFromFrequency(frequency),
        startDate: agreement.startDate || signedDate,
        contactName: agreement.contactName || (quote ? quote.clientContact : ''),
        contactPhone: agreement.contactPhone || (quote ? quote.clientPhone : ''),
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
        survey: quote ? quote.survey : null,
        surveyPhotos,
        room,
        baseline: {
          quote: {
            date: signedDate,
            note: '계약 전 견적 방문 · 오염 상태',
            photos: baselineQuotePhotos,
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
        contactName: site.contactName || agreement.contactName || '',
        contactPhone: site.contactPhone || agreement.contactPhone || '',
        area: site.area || (quote ? quote.area : '') || (pyeong ? `${pyeong}평` : ''),
        frequency: site.frequency || frequency,
        ceoName: site.ceoName || client.ceo,
        bizNumber: site.bizNumber || client.bizNumber,
      });
    }

    // 견적에 남긴 현장 방문 기록을 업장으로 옮깁니다 — 계약 뒤에도 업장 관리에서 그대로 봅니다.
    if (quote && quote.survey && quote.survey.visitDate) {
      const current = await this.getSite(site.id);
      if (!current.survey || !current.survey.visitDate) {
        site = await this.updateSiteSurvey(site.id, quote.survey, { actor: '고객 계약' });
      }
    }

    // 3단계 — 업장 관리방(기획서 9장)을 계약과 함께 엽니다.
    {
      const current = await this.getSite(site.id);
      const currentRoom = normalizeRoom(current.room);
      const nextRoom = normalizeRoom({
        ...currentRoom,
        ...room,
        // 이미 열려 있는 방이면 처음 연 시각은 그대로 둡니다.
        createdAt: currentRoom.createdAt || room.createdAt,
      });
      const patch = { room: nextRoom, updatedAt: now };
      if (!current.quoteId && quote) patch.quoteId = quote.id;
      if (!current.contractId) patch.contractId = agreement.id;
      // 최초 견적 사진이 비어 있으면 방문 사진 · 견적 사진으로 채웁니다(덮어쓰지 않음).
      if (baselineQuotePhotos.length) {
        const baseline = normalizeBaseline(current.baseline);
        if (!baseline.quote.photos.length) {
          baseline.quote = { date: signedDate, note: '계약 전 견적 방문 · 오염 상태', photos: baselineQuotePhotos };
          patch.baseline = baseline;
        }
      }
      await this.adapter.put('sites', { ...current, ...patch });
      site = normalizeSite(await this.getSite(site.id));
      await this.recordHistory('sites', site.id, {
        actor: '고객',
        action: '고객 계약 체결 · 업장 관리방 생성',
        note: `${agreement.no} · ${client.businessName} · 월 ${agreement.amount.toLocaleString('ko-KR')}원 · ${frequency}${pyeong ? ` · ${pyeong}평` : ''}`,
      });
      site = await this.getSite(site.id);
    }

    // 서명 이미지는 Storage 에 올려 여러 기기에서 같은 서명을 보게 합니다(실패 시 dataURL).
    const signature = await this.storeSignature(toText(payload.signature));
    // 3단계 — 서명 시점의 문서 해시(무결성 확인값)를 남깁니다.
    const doc = await agreementDocHash({
      ...agreement,
      siteId: site.id,
      clientAddress: client.address,
      clientBusinessName: client.businessName,
      clientBizNumber: client.bizNumber,
      clientCeo: client.ceo,
    });
    const nextAgreement = normalizeAgreement({
      ...agreement,
      status: 'signed',
      siteId: site.id,
      clientAddress: client.address,
      clientBusinessName: client.businessName,
      clientBizNumber: client.bizNumber,
      clientCeo: client.ceo,
      signedDate,
      signedByName: client.ceo || agreement.contactName || agreement.signedByName,
      signature: signature || agreement.signature,
      signedAt: now,
      docHash: doc.hash,
      docAlgo: doc.algo,
      docHashAt: now,
      signatureAudit: normalizeSignatureAudit({
        name: client.ceo || agreement.contactName || client.businessName,
        role: '갑(고객)',
        phone: agreement.contactPhone,
        at: now,
        method: '전자서명(스마트펜·손가락)',
        hash: doc.hash,
        algo: doc.algo,
      }),
      updatedAt: now,
      history: withHistory(agreement.history, makeHistoryEntry({
        actor: '고객',
        action: '고객 계약 체결',
        note: `${site.name} · 서명 ${signedDate} · 문서 해시 ${doc.hash.slice(0, 12)}… (${doc.algo})`,
      })),
    });
    await this.adapter.put('contracts', nextAgreement);

    if (quote) {
      await this.adapter.put(
        'quotes',
        normalizeQuote({
          ...quote,
          siteId: site.id,
          contractId: agreement.id,
          status: 'contracted',
          contractedAt: now,
          updatedAt: now,
          history: withHistory(quote.history, makeHistoryEntry({
            actor: '고객',
            action: '계약 체결',
            note: `${agreement.no} · ${site.name}`,
          })),
        }),
      );
    }

    // 업장 → 견적 · 계약 연결 (비어 있는 칸만). 팀장 계약 별첨도 이 업장을 포함합니다.
    {
      const current = await this.getSite(site.id);
      const patch = {};
      if (!current.quoteId && quote) patch.quoteId = quote.id;
      if (!current.contractId) patch.contractId = agreement.id;
      if (Object.keys(patch).length) {
        await this.adapter.put('sites', { ...current, ...patch });
        site = { ...current, ...patch };
      }
    }
    // 이 업장을 맡은 팀장의 도급계약서 별첨에 업장을 더합니다.
    // (서명으로 기존 계약의 별첨 줄을 빼지는 않습니다 — add-only)
    await this.syncStaffContractSites(site.id, { remove: false });

    // 견적 방에 있던 고객 계정을 새 현장 방으로 옮깁니다.
    // 계약 담당자 번호로 이미 계정이 있고 아직 방이 없으면 그 계정도 이 방에 연결합니다.
    const accounts = await this.adapter.getAll('accounts');
    const contactPhone = normalizePhone(agreement.contactPhone || (quote ? quote.clientPhone : ''));
    for (const account of accounts) {
      if (account.role !== 'customer') continue;
      const byQuote = quote && account.quoteId === quote.id;
      const byPhone =
        contactPhone &&
        normalizePhone(account.phone) === contactPhone &&
        (!account.siteId || account.siteId === site.id);
      if (!byQuote && !byPhone) continue;
      if (account.siteId && account.siteId !== site.id) continue;
      await this.adapter.put('accounts', {
        ...account,
        siteId: site.id,
        quoteId: '',
        updatedAt: now,
      });
      await this.createGrant(account.id, site.id, '');
    }

    this._notify();
    return { agreement: normalizeAgreement(nextAgreement), site };
  }

  /**
   * 계약 갱신 — 기존 계약서는 ‘갱신 완료’로 남기고, 같은 조건에서 기간·금액만
   * 고친 새 계약서(초안)를 만듭니다. 서명 이력은 계약서마다 따로 보관됩니다.
   */
  async renewAgreement(id, { months = 0, startDate = '', endDate = '', amount = 0, actor = null, note = '' } = {}) {
    denyStaff(actor, '고객 계약서 갱신');
    denyCustomerWrites(actor, '고객 계약서 갱신');
    const agreement = await this.getAgreement(id);
    if (!agreement) throw new StoreError('no-contract', '계약서를 찾을 수 없습니다.');
    if (agreement.status !== 'signed') {
      throw new StoreError('renew-needs-sign', '체결된 계약서만 갱신할 수 있습니다.');
    }
    const period = Number(months) > 0 ? Math.round(Number(months)) : agreement.months;
    const start = toText(startDate) || (agreement.endDate ? addDaysISO(agreement.endDate, 1) : todayISO());
    const end = toText(endDate) || addMonthsISO(start, period);
    const now = new Date().toISOString();
    const who = toText(actor && actor.name) || '대표';

    const previous = normalizeAgreement({
      ...agreement,
      status: 'renewed',
      renewedAt: now,
      updatedAt: now,
      history: withHistory(agreement.history, makeHistoryEntry({
        actor: who,
        action: '계약 갱신',
        note: `${start} ~ ${end} (${period}개월) 새 계약서로 이어집니다${note ? ` · ${note}` : ''}`,
      })),
    });
    const next = normalizeAgreement({
      ...agreement,
      id: uid('contract'),
      no: await this._nextDocNumber('contracts', 'CT'),
      status: 'draft',
      startDate: start,
      endDate: end,
      months: period,
      amount: toAmount(amount) || agreement.amount,
      signedDate: '',
      signature: '',
      signedByName: '',
      signedAt: '',
      signatureAudit: normalizeSignatureAudit({}),
      docHash: '',
      docAlgo: '',
      docHashAt: '',
      renewedFrom: agreement.id,
      renewedAt: '',
      renewedTo: '',
      terminatedAt: '',
      terminateReason: '',
      docVersion: (agreement.docVersion || 1) + 1,
      createdAt: now,
      updatedAt: now,
      history: withHistory([], makeHistoryEntry({
        actor: who,
        action: '계약 갱신 초안',
        note: `${agreement.no} 갱신 — ${start} ~ ${end} (${period}개월) · ${(toAmount(amount) || agreement.amount).toLocaleString('ko-KR')}원`,
      })),
    });
    previous.renewedTo = next.id;
    await this.adapter.put('contracts', previous);
    await this.adapter.put('contracts', next);

    if (agreement.siteId) {
      const site = await this.getSite(agreement.siteId);
      if (site) {
        const room = normalizeRoom(site.room);
        const patch = { contractId: next.id, updatedAt: now };
        if (room.createdAt) {
          patch.room = normalizeRoom({ ...room, status: 'active', contractId: next.id, endedAt: '' });
        }
        await this.adapter.put('sites', { ...site, ...patch });
        await this.recordHistory('sites', site.id, {
          actor: who,
          action: '계약 갱신',
          note: `${agreement.no} → ${next.no} · ${start} ~ ${end}`,
        });
      }
    }
    if (agreement.quoteId) {
      const quote = await this.getQuote(agreement.quoteId);
      if (quote) {
        await this.adapter.put('quotes', normalizeQuote({
          ...quote,
          contractId: next.id,
          updatedAt: now,
          history: withHistory(quote.history, makeHistoryEntry({
            actor: who,
            action: '계약 갱신',
            note: `${agreement.no} → ${next.no}`,
          })),
        }));
      }
    }
    this._notify();
    return {
      previous: normalizeAgreement(await this.adapter.get('contracts', previous.id)),
      agreement: normalizeAgreement(await this.adapter.get('contracts', next.id)),
      site: agreement.siteId ? await this.getSite(agreement.siteId) : null,
    };
  }

  /** 계약 종료 — 사유와 시각을 남기고 업장 관리방을 닫습니다(기록은 보관). */
  async terminateAgreement(id, { reason = '', date = '', actor = null } = {}) {
    denyStaff(actor, '고객 계약서 종료');
    denyCustomerWrites(actor, '고객 계약서 종료');
    const agreement = await this.getAgreement(id);
    if (!agreement) throw new StoreError('no-contract', '계약서를 찾을 수 없습니다.');
    if (agreement.status === 'terminated') {
      return { agreement, site: agreement.siteId ? await this.getSite(agreement.siteId) : null };
    }
    if (agreement.status !== 'signed' && agreement.status !== 'renewed') {
      throw new StoreError('terminate-needs-sign', '체결된 계약서만 종료할 수 있습니다.');
    }
    const now = new Date().toISOString();
    const who = toText(actor && actor.name) || '대표';
    const closedAt = toText(date) || todayISO();
    const next = normalizeAgreement({
      ...agreement,
      status: 'terminated',
      terminatedAt: now,
      terminateReason: toText(reason),
      updatedAt: now,
      history: withHistory(agreement.history, makeHistoryEntry({
        actor: who,
        action: '계약 종료',
        note: `${closedAt} 종료${reason ? ` · 사유: ${reason}` : ''}`,
      })),
    });
    await this.adapter.put('contracts', next);

    let site = agreement.siteId ? await this.getSite(agreement.siteId) : null;
    if (site) {
      const room = normalizeRoom(site.room);
      if (room.createdAt) {
        await this.adapter.put('sites', {
          ...site,
          room: normalizeRoom({ ...room, status: 'ended', endedAt: now }),
          updatedAt: now,
        });
      }
      await this.recordHistory('sites', site.id, {
        actor: who,
        action: '계약 종료',
        note: `${agreement.no} · ${closedAt}${reason ? ` · ${reason}` : ''}`,
      });
      site = await this.getSite(site.id);
    }
    this._notify();
    return { agreement: normalizeAgreement(next), site };
  }

  /* ---------------- staff contracts (직원 계약 · 직원관리방) ---------------- */

  async listStaffContracts({ accountId = null, siteId = null, status = null } = {}, { actor = null } = {}) {
    // 직원은 자기 계약서만 — 다른 직원의 계약·급여는 대표만 봅니다.
    if (isStaffActor(actor) && (!accountId || accountId !== actor.accountId)) {
      throw new StoreError('permission-denied', '다른 직원의 계약서는 본인 것만 볼 수 있습니다.');
    }
    let rows = (await this.adapter.getAll('staffContracts')).map(normalizeStaffContract);
    if (accountId) rows = rows.filter((row) => row.accountId === accountId);
    if (siteId) rows = rows.filter((row) => row.siteIds.includes(siteId));
    if (status) rows = rows.filter((row) => row.status === status);
    return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async getStaffContract(id, { actor = null } = {}) {
    const row = await this.adapter.get('staffContracts', id);
    if (!row) return null;
    requireOwnStaffRecord(actor, row, '다른 직원의 계약서');
    return normalizeStaffContract(row);
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

  /** 직원 계약 등록 — 저장과 동시에 1회용 직원 초대코드를 발급합니다. (대표 전용) */
  async addStaffContract(input = {}, { actor = null } = {}) {
    if (actor && !isCeoActor(actor)) {
      throw new StoreError('permission-denied', '직원 계약 등록은 대표(최고관리자)만 할 수 있습니다.');
    }
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
    // 팀장 계정과 연결된 계약서는 그 팀장이 맡은 업장을 별첨에 그대로 이어받습니다.
    //  계정을 고르지 않았어도 같은 번호의 팀장 계정이 있으면 자동으로 잇습니다(반복 입력 방지).
    const accounts = await this.adapter.getAll('accounts');
    const account =
      (input.accountId ? await this.getAccount(input.accountId) : null) ||
      accounts.find((row) => row.role !== 'customer' && normalizePhone(row.phone) === phone) ||
      null;
    const siteIds =
      Array.isArray(input.siteIds) && input.siteIds.length
        ? input.siteIds.filter(Boolean)
        : (account && Array.isArray(account.assignedSiteIds) ? account.assignedSiteIds.slice() : []);
    const contract = normalizeStaffContract({
      ...input,
      id: uid('staff'),
      accountId: account ? account.id : toText(input.accountId),
      siteIds,
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
      history: withHistory([], makeHistoryEntry({
        actor: toText(input.actor) || '대표',
        action: '직원 계약 등록',
        note: `${STAFF_TYPES[type].short} · 월/일/시급 ${monthlyAmount || dailyAmount || hourlyAmount}원`,
      })),
    });
    await this.adapter.put('staffContracts', contract);
    // 업장 쪽에도 이 팀장 계약 id 를 남깁니다(업장 ↔ 팀장 계약 연결).
    for (const siteId of siteIds) {
      const site = await this.getSite(siteId);
      if (!site) continue;
      const linked = new Set(site.staffContractIds || []);
      if (!linked.has(contract.id)) {
        linked.add(contract.id);
        await this.adapter.put('sites', { ...site, staffContractIds: [...linked] });
      }
    }
    this._notify();
    return contract;
  }

  async updateStaffContract(id, patch = {}, { actor = null } = {}) {
    const contract = await this.getStaffContract(id);
    // 직원은 본인 계약서의 별첨 확인 표시만 바꿀 수 있습니다.
    requireOwnStaffRecord(actor, contract, '다른 직원의 계약서');
    if (isStaffActor(actor)) {
      const allowed = new Set(['annexAck', 'annexAckedAt']);
      const keys = Object.keys(patch || {}).filter((key) => key !== 'actor');
      if (keys.some((key) => !allowed.has(key))) {
        throw new StoreError('permission-denied', '직원은 본인 계약서의 내용을 고칠 수 없습니다.');
      }
    }
    if (!contract) throw new StoreError('no-staff-contract', '직원 계약서를 찾을 수 없습니다.');
    if (contract.status === 'signed') {
      throw new StoreError('already-signed', '체결된 계약서는 수정할 수 없습니다.');
    }
    const now = new Date().toISOString();
    const next = normalizeStaffContract({
      ...contract,
      ...patch,
      // 별첨본 확인 표시를 바꾸면 그 시각도 함께 남깁니다.
      ...('annexAck' in patch ? { annexAckedAt: toText(patch.annexAck) ? now : '' } : {}),
      id: contract.id,
      inviteCode: contract.inviteCode,
      createdAt: contract.createdAt,
      updatedAt: now,
    });
    const changes = [];
    const amounts = [
      ['monthlyAmount', '월 도급금액'],
      ['dailyAmount', '일당'],
      ['hourlyAmount', '시급'],
    ];
    for (const [key, label] of amounts) {
      if (contract[key] !== next[key]) changes.push({ field: label, from: String(contract[key]), to: String(next[key]) });
    }
    if (contract.employmentType !== next.employmentType) {
      changes.push({ field: '계약 유형', from: contract.employmentType, to: next.employmentType });
    }
    if (changes.length) {
      next.history = withHistory(contract.history, makeHistoryEntry({
        actor: toText(patch.actor) || '대표',
        action: '직원 계약 수정',
        changes,
      }));
    }
    await this.adapter.put('staffContracts', next);
    // 별첨 업장이 바뀌면 업장 쪽 연결(staffContractIds)도 맞춥니다.
    if (Array.isArray(patch.siteIds)) {
      const before = new Set(contract.siteIds);
      const after = new Set(next.siteIds);
      for (const siteId of new Set([...before, ...after])) {
        const site = await this.getSite(siteId);
        if (!site) continue;
        const linked = new Set(site.staffContractIds || []);
        const shouldLink = after.has(siteId);
        if (shouldLink && !linked.has(next.id)) linked.add(next.id);
        if (!shouldLink && linked.has(next.id) && contract.status !== 'signed') linked.delete(next.id);
        if (linked.size !== (site.staffContractIds || []).length) {
          await this.adapter.put('sites', { ...site, staffContractIds: [...linked] });
        }
      }
    }
    this._notify();
    return normalizeStaffContract(await this.adapter.get('staffContracts', next.id));
  }

  /** 직원에게 계약서를 보냅니다 (직원관리방에 ‘서명 대기’로 표시). */
  async sendStaffContract(id, { actor = null } = {}) {
    denyStaff(actor, '직원 계약서 발송');
    const contract = await this.getStaffContract(id);
    if (!contract) throw new StoreError('no-staff-contract', '직원 계약서를 찾을 수 없습니다.');
    if (contract.status === 'signed') return contract;
    const next = { ...contract, status: 'sent', updatedAt: new Date().toISOString() };
    await this.adapter.put('staffContracts', next);
    this._notify();
    return normalizeStaffContract(next);
  }

  async regenerateStaffInvite(id, { actor = null } = {}) {
    denyStaff(actor, '직원 계약서 초대코드');
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
  async signStaffContract(id, payload = {}, { actor = null } = {}) {
    requireOwnStaffRecord(actor, await this.getStaffContract(id), '다른 직원의 계약서');
    const contract = await this.getStaffContract(id);
    if (!contract) throw new StoreError('no-staff-contract', '직원 계약서를 찾을 수 없습니다.');
    if (contract.status === 'signed') return contract;
    if (!toText(payload.signature)) {
      throw new StoreError('signature-empty', '서명란에 서명해 주세요.');
    }
    const now = new Date().toISOString();
    const signature = await this.storeSignature(toText(payload.signature));
    const next = normalizeStaffContract({
      ...contract,
      // 도급 계약서 — 직원이 직접 확인·입력한 수급인(을) 정보를 함께 저장합니다.
      name: toText(payload.name) || contract.name,
      companyName: toText(payload.companyName) || contract.companyName,
      ceoName: toText(payload.ceoName) || contract.ceoName,
      phone: toText(payload.phone) || contract.phone,
      address: toText(payload.address) || contract.address,
      bizNumber: toText(payload.bizNumber) || contract.bizNumber,
      birthDate: toText(payload.birthDate) || contract.birthDate,
      bankName: toText(payload.bankName) || contract.bankName,
      bankAccount: toText(payload.bankAccount) || contract.bankAccount,
      accountHolder: toText(payload.accountHolder) || contract.accountHolder,
      status: 'signed',
      signature: signature || contract.signature,
      signedDate: toText(payload.signedDate) || todayISO(),
      signedByName: toText(payload.name) || contract.name,
      signedAt: now,
      updatedAt: now,
      history: withHistory(contract.history, makeHistoryEntry({
        actor: contract.name || '직원',
        action: '직원 계약 체결',
        note: `${contract.no} · 서명 ${toText(payload.signedDate) || todayISO()}`,
      })),
    });
    await this.adapter.put('staffContracts', next);

    // 서명한 직원의 계정에 별첨 업장을 배정하고, 업장에도 이 계약 id를 남깁니다.
    if (next.accountId) {
      const account = await this.getAccount(next.accountId);
      if (account) {
        const assigned = new Set(account.assignedSiteIds || []);
        let added = 0;
        for (const siteId of next.siteIds) {
          if (!assigned.has(siteId)) {
            assigned.add(siteId);
            added += 1;
          }
        }
        if (added) {
          await this.adapter.put('accounts', {
            ...account,
            assignedSiteIds: [...assigned],
            updatedAt: now,
          });
        }
      }
    }
    for (const siteId of next.siteIds) {
      const site = await this.getSite(siteId);
      if (!site) continue;
      const linked = new Set(site.staffContractIds || []);
      const patch = {};
      if (!linked.has(next.id)) {
        linked.add(next.id);
        patch.staffContractIds = [...linked];
      }
      if (Object.keys(patch).length) {
        await this.adapter.put('sites', { ...site, ...patch });
      }
      await this.recordHistory('sites', siteId, {
        actor: next.name || '직원',
        action: '팀장 계약 체결',
        note: `${next.name} ${next.roleTitle || ''} · ${next.no}`.trim(),
      });
    }

    this._notify();
    return normalizeStaffContract(await this.adapter.get('staffContracts', next.id));
  }

  /* ---------------- staff checks (근무태도 A~F · 본부장 체크) ---------------- */

  async listStaffChecks({ staffContractId = null, accountId = null, siteId = null } = {}, { actor = null } = {}) {
    denyStaff(actor, '직원 평가(근무태도)');
    let rows = (await this.adapter.getAll('staffChecks')).map(normalizeStaffCheck);
    if (staffContractId) rows = rows.filter((row) => row.staffContractId === staffContractId);
    if (accountId) rows = rows.filter((row) => row.accountId === accountId);
    if (siteId) rows = rows.filter((row) => row.siteId === siteId);
    return rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  /** 근무태도 A~F — 대표(최고관리자)만 체크합니다(v2.8.2). */
  async addStaffCheck(input = {}, { actor = null } = {}) {
    if (actor && !isCeoActor(actor)) {
      throw new StoreError('permission-denied', '직원 평가는 대표(최고관리자)만 매길 수 있습니다.');
    }
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

  async listSupplyOrders({ accountId = null, status = null } = {}, { actor = null } = {}) {
    if (isStaffActor(actor) && (!accountId || accountId !== actor.accountId)) {
      throw new StoreError('permission-denied', '장비·봉투 영수증은 본인 것만 볼 수 있습니다.');
    }
    let rows = (await this.adapter.getAll('supplyOrders')).map(normalizeSupplyOrder);
    if (accountId) rows = rows.filter((row) => row.toAccountId === accountId || row.requesterAccountId === accountId);
    if (status) rows = rows.filter((row) => row.status === status);
    return rows.sort((a, b) =>
      String(b.issuedAt || b.requestedAt || b.createdAt).localeCompare(String(a.issuedAt || a.requestedAt || a.createdAt)),
    );
  }

  async getSupplyOrder(id, { actor = null } = {}) {
    const row = await this.adapter.get('supplyOrders', id);
    if (isStaffActor(actor) && row) {
      const own = row.requesterAccountId === actor.accountId || row.toAccountId === actor.accountId;
      if (!own) throw new StoreError('permission-denied', '장비·봉투 영수증은 본인 것만 볼 수 있습니다.');
    }
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

  async listReports({ siteId = null, leader = null, status = null, limit = 0 } = {}, { actor = null } = {}) {
    let reports = await this.adapter.getAll('reports');
    // 직원은 본인 배정 업장의 보고만 — 다른 팀장 관리업장 보고는 보이지 않습니다.
    if (isStaffActor(actor)) {
      const mine = new Set(assignedSiteIdsOf(actor));
      reports = reports.filter((report) => mine.has(report.siteId));
    }
    // 3단계 — 고객은 자기 업장 보고만.
    if (isCustomerActor(actor)) {
      const mine = await this._customerSiteIds(actor);
      if (siteId && mine.indexOf(toText(siteId)) < 0) {
        throw new StoreError('permission-denied', '다른 업장의 청소 보고는 볼 수 없습니다.');
      }
      reports = reports.filter((report) => mine.indexOf(toText(report.siteId)) >= 0);
    }
    if (siteId) reports = reports.filter((report) => report.siteId === siteId);
    if (leader) reports = reports.filter((report) => report.leader === leader);
    if (status) reports = reports.filter((report) => reportStatusKey(report) === status);
    reports = reports.map(normalizeReport);
    reports.sort((a, b) => Store.sortKey(b).localeCompare(Store.sortKey(a)));
    return limit > 0 ? reports.slice(0, limit) : reports;
  }

  async getReport(id, { actor = null } = {}) {
    const row = await this.adapter.get('reports', id);
    if (!row) return null;
    if (isCustomerActor(actor)) {
      const mine = await this._customerSiteIds(actor);
      if (mine.indexOf(toText(row.siteId)) < 0) {
        throw new StoreError('permission-denied', '다른 업장의 청소 보고는 볼 수 없습니다.');
      }
    }
    return normalizeReport(row);
  }

  /**
   * 보고를 어느 계약 · 어느 팀장 계약의 작업인지 이어 붙입니다.
   * (업장의 계약 id 와 팀장 계약의 별첨 업장으로 찾아냅니다.)
   */
  async _reportLinks(site, input = {}) {
    const staffContracts = (await this.adapter.getAll('staffContracts')).map(normalizeStaffContract);
    const accounts = await this.adapter.getAll('accounts');
    let accountId = toText(input.accountId);
    if (!accountId && input.leader) {
      const found = accounts.find((row) => row.role !== 'customer' && row.name === input.leader);
      if (found) accountId = found.id;
    }    const mine = staffContracts.filter((row) => row.siteIds.includes(site.id));
    const contract =
      mine.find((row) => accountId && row.accountId === accountId) ||
      mine.find((row) => row.name === input.leader) ||
      null;
    return {
      accountId,
      staffContractId: contract ? contract.id : '',
      contractId: toText(site.contractId),
    };
  }

  async addReport(input) {
    const site = await this.getSite(input.siteId);
    if (!site) throw new StoreError('no-site', '현장을 찾을 수 없습니다.');
    const links = await this._reportLinks(site, input);

    const report = {
      id: uid('rep'),
      siteId: site.id,
      siteCode: site.code,
      siteName: site.name,
      contractId: links.contractId,
      staffContractId: links.staffContractId,
      accountId: links.accountId,
      date: input.date,
      time: input.time,
      leader: input.leader,
      leaderRole: input.leaderRole || '팀장',
      durationMin: Number(input.durationMin) || null,
      checklist: (input.checklist || []).map((item) => ({ label: item.label, done: !!item.done })),
      note: String(input.note || '').trim(),
      issueNote: String(input.issueNote || '').trim(),
      photos: normalizePhotos(input.photos),
      manualDay: String(input.manualDay || '').trim(),
      manualTime: String(input.manualTime || '').trim(),
      // 팀장이 등록한 보고는 곧바로 고객에게 가지 않고 최고관리자 확인을 기다립니다.
      status: 'pending',
      approvedAt: '',
      approvedBy: '',
      createdAt: new Date().toISOString(),
      source: 'app',
    };

    await this.adapter.put('reports', report);
    await this.recordHistory('sites', site.id, {
      actor: toText(input.leader) || toText(input.actor) || '팀장',
      action: '청소 보고 등록',
      note: `${report.date} ${report.time || ''} · ${report.leader} · 사진 ${countReportPhotos(report)}장`,
    });
    this._notify();
    return normalizeReport(report);
  }

  /** 최고관리자(대표)가 내용을 확인하고 고객사에 제출합니다 — 이때 고객 방에 보입니다. */
  async approveReport(id, { by = '', actor = null } = {}) {
    denyStaff(actor, '보고서 고객사 제출');
    const report = await this.getReport(id);
    if (!report) throw new StoreError('no-report', '보고를 찾지 못했습니다.');
    if (reportStatusKey(report) === 'submitted') return report;
    const next = {
      ...report,
      status: 'submitted',
      approvedAt: new Date().toISOString(),
      approvedBy: String(by || '').trim(),
    };
    await this.adapter.put('reports', next);
    await this.recordHistory('sites', report.siteId, {
      actor: String(by || '').trim() || '최고관리자',
      action: '고객사 제출',
      note: `${report.date} ${report.time || ''} 보고 확인 · 고객 방 공개`,
    });
    this._notify();
    return normalizeReport(next);
  }

  async deleteReport(id, { actor = null } = {}) {
    const report = await this.getReport(id);
    if (!report) return false;
    // 직원은 자기가 올린 보고만 삭제합니다.
    if (isStaffActor(actor)) {
      const own = report.accountId === actor.accountId || (!report.accountId && report.leader === actor.name);
      if (!own) throw new StoreError('permission-denied', '다른 직원의 보고는 삭제할 수 없습니다.');
    }
    await this.adapter.remove('reports', id);
    const groups = normalizePhotos(report.photos);
    for (const group of Object.values(groups)) {
      for (const photo of group) {
        if (photo && photo.id) await this.adapter.remove('photos', photo.id).catch(() => {});
      }
    }
    await this.recordHistory('sites', report.siteId, {
      actor: '앱',
      action: '청소 보고 삭제',
      note: `${report.date} ${report.time || ''} · ${report.leader}`,
    });
    this._notify();
    return true;
  }

  /* ---------------- photos ---------------- */

  /** 서버 Storage 에 파일을 올리고 공개 주소를 돌려줍니다(동기화 꺼짐 · 실패 시 ''). */
  async uploadFile(dataUrl, options = {}) {
    if (!this.remote || !dataUrl || !/^data:/i.test(String(dataUrl))) return '';
    try {
      return await this.remote.upload(dataUrl, options);
    } catch (error) {
      return '';
    }
  }

  /** 서명 dataURL → Storage 주소. 올리지 못하면 dataURL 을 그대로 저장합니다. */
  async storeSignature(dataUrl) {
    const value = String(dataUrl || '');
    if (!value.startsWith('data:')) return value;
    const url = await this.uploadFile(value, { folder: 'signatures', name: 'sign.png' });
    return url || value;
  }

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
    // 다른 기기에서도 원본을 볼 수 있도록 Storage 에도 올립니다(실패해도 썸네일로 표시).
    const asset = await this.uploadFile(photo.dataUrl, { folder: 'photos', name: 'photo.jpg' });
    return {
      id: record.id,
      thumb: photo.thumb,
      width: record.width,
      height: record.height,
      caption: photo.caption || '',
      ...(asset ? { asset } : {}),
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

  async listAccounts({ role = null } = {}, { actor = null } = {}) {
    // 직원 명부(전화번호·역할)는 대표만 봅니다.
    denyStaff(actor, '직원 명부');
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

  /* ---------------- 직원 계정 등록 · 코드 설정 (대표 전용) ---------------- */

  /** 고유코드 후보 — 기존 계정과 겹치지 않는 TL-0000. */
  async suggestLeaderCode() {
    return makeLeaderCode(await this.adapter.getAll('accounts'));
  }

  /**
   * 대표가 새 직원(관리팀장 · 부관리자) 계정을 직접 등록합니다.
   * 등록 즉시 `accounts` 에 저장되어 동기화되고, 전화번호 · 비밀번호 · 고유코드로 바로 로그인합니다.
   * 실직원 계정이므로 공개 데모 목록에는 올리지 않습니다(`demoHidden: true`).
   */
  async addStaffAccount(input = {}, { actor = null } = {}) {
    requireAccountEditor(actor);
    const name = toText(input.name);
    const digits = normalizePhone(input.phone);
    const password = String(input.password || '').trim();
    const staffRole = input.staffRole === 'manager' ? 'manager' : 'leader';
    if (!name) throw new StoreError('name-empty', '직원 이름을 입력해 주세요.');
    if (digits.length < 9) throw new StoreError('phone-invalid', '전화번호를 정확히 입력해 주세요.');
    if (password.length < 4) throw new StoreError('password-weak', '비밀번호는 4자 이상으로 정해 주세요.');

    const rows = await this.adapter.getAll('accounts');
    if (rows.some((row) => normalizePhone(row.phone) === digits)) {
      throw new StoreError('phone-taken', '이미 등록된 전화번호입니다. 기존 직원 정보를 수정해 주세요.');
    }
    const code = toText(input.leaderCode) ? normalizeLeaderCodeInput(input.leaderCode) : makeLeaderCode(rows);
    if (!code) throw new StoreError('code-format', '고유코드는 TL-0000 형식으로 입력해 주세요.');
    if (rows.some((row) => normalizeCode(row.leaderCode) === normalizeCode(code))) {
      throw new StoreError('code-taken', '이미 사용 중인 고유코드입니다. 다른 코드를 정해 주세요.');
    }

    const now = new Date().toISOString();
    const who = toText(input.actor) || (actor ? actor.name : '') || '대표';
    const title = toText(input.title) || (staffRole === 'manager' ? '본부장' : '팀장');
    const account = {
      id: uid('acc'),
      role: 'leader',
      staffRole,
      canManageStaff: staffRole === 'manager',
      name,
      title,
      phone: digits,
      phonePretty: prettyPhone(digits),
      password,
      leaderCode: code,
      leaderCodeUpdatedAt: now,
      assignedSiteIds: [...new Set((input.assignedSiteIds || []).filter(Boolean).map(String))],
      staffAccess: true,
      employmentType: toText(input.employmentType) || 'contract',
      // 실제 직원 계정 — 공개 데모 계정 목록에는 올리지 않습니다.
      demoHidden: true,
      active: true,
      createdAt: now,
      updatedAt: now,
      createdBy: who,
      source: 'app',
      history: [
        makeHistoryEntry({
          actor: who,
          action: '직원 계정 등록',
          note: `${name} ${title} · ${prettyPhone(digits)} · ${code}`,
        }),
      ],
    };
    await this.adapter.put('accounts', account);
    this._notify();
    return account;
  }

  /**
   * 기존 직원 계정 수정 — 이름 · 직책 · 전화번호 · 비밀번호 · 고유코드 · 역할 · 담당 현장.
   * 비밀번호를 비워 두면 기존 비밀번호를 그대로 씁니다.
   */
  async updateStaffAccount(id, patch = {}, { actor = null } = {}) {
    requireAccountEditor(actor);
    const account = await this.getAccount(id);
    if (!account) throw new StoreError('no-account', '계정을 찾을 수 없습니다.');
    if (account.role !== 'leader') {
      throw new StoreError('wrong-role', '직원(관리팀장 · 부관리자) 계정만 수정할 수 있습니다.');
    }
    const rows = await this.adapter.getAll('accounts');
    const now = new Date().toISOString();
    const who = toText(actor && actor.name) || toText(patch.actor) || '대표';
    const next = { ...account };
    const changes = [];

    if (patch.name !== undefined) {
      const name = toText(patch.name);
      if (!name) throw new StoreError('name-empty', '직원 이름을 입력해 주세요.');
      if (name !== account.name) changes.push({ field: '이름', from: account.name || '', to: name });
      next.name = name;
    }
    if (patch.title !== undefined && toText(patch.title)) {
      if (toText(patch.title) !== account.title) changes.push({ field: '직책', from: account.title || '', to: toText(patch.title) });
      next.title = toText(patch.title);
    }
    if (patch.phone !== undefined) {
      const digits = normalizePhone(patch.phone);
      if (digits.length < 9) throw new StoreError('phone-invalid', '전화번호를 정확히 입력해 주세요.');
      if (rows.some((row) => row.id !== id && normalizePhone(row.phone) === digits)) {
        throw new StoreError('phone-taken', '다른 계정이 쓰는 전화번호입니다.');
      }
      if (digits !== normalizePhone(account.phone)) {
        changes.push({ field: '전화번호', from: prettyPhone(account.phone), to: prettyPhone(digits) });
      }
      next.phone = digits;
      next.phonePretty = prettyPhone(digits);
    }
    if (patch.password !== undefined && String(patch.password).trim()) {
      const password = String(patch.password).trim();
      if (password.length < 4) throw new StoreError('password-weak', '비밀번호는 4자 이상으로 정해 주세요.');
      if (password !== account.password) changes.push({ field: '비밀번호', from: '', to: '변경' });
      next.password = password;
    }
    if (patch.leaderCode !== undefined && toText(patch.leaderCode)) {
      const code = normalizeLeaderCodeInput(patch.leaderCode);
      if (!code) throw new StoreError('code-format', '고유코드는 TL-0000 형식으로 입력해 주세요.');
      if (rows.some((row) => row.id !== id && normalizeCode(row.leaderCode) === normalizeCode(code))) {
        throw new StoreError('code-taken', '이미 사용 중인 고유코드입니다.');
      }
      if (normalizeCode(code) !== normalizeCode(account.leaderCode)) {
        changes.push({ field: '고유코드', from: account.leaderCode || '', to: code });
        next.leaderCode = code;
        next.leaderCodeUpdatedAt = now;
      }
    }
    if (patch.staffRole !== undefined) {
      const staffRole = patch.staffRole === 'manager' ? 'manager' : 'leader';
      const before = staffRoleKey(account);
      if (staffRole !== before) changes.push({ field: '역할', from: STAFF_ROLE_LABELS[before], to: STAFF_ROLE_LABELS[staffRole] });
      next.staffRole = staffRole;
      next.canManageStaff = staffRole === 'manager';
    }
    if (Array.isArray(patch.assignedSiteIds)) {
      const sites = [...new Set(patch.assignedSiteIds.filter(Boolean).map(String))];
      const before = (account.assignedSiteIds || []).slice().sort().join(',');
      if (sites.slice().sort().join(',') !== before) {
        changes.push({ field: '담당 현장', from: String((account.assignedSiteIds || []).length), to: String(sites.length) });
      }
      next.assignedSiteIds = sites;
    }
    if (patch.active !== undefined) {
      const active = patch.active !== false;
      if (active !== (account.active !== false)) changes.push({ field: '사용 상태', from: account.active === false ? '중지' : '사용', to: active ? '사용' : '중지' });
      next.active = active;
    }
    next.updatedAt = now;
    next.history = [
      makeHistoryEntry({ actor: who, action: '직원 계정 수정', changes }),
      ...(Array.isArray(account.history) ? account.history : []),
    ].slice(0, 50);
    await this.adapter.put('accounts', next);
    this._notify();
    return next;
  }

  /** Issue a fresh team-leader code (admin action). The old code stops working. */
  async regenerateLeaderCode(accountId, { actor = null } = {}) {
    denyStaff(actor, '팀장 고유코드 재발급');
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

  async listRoomCodes({ siteId = null, unusedOnly = false } = {}, { actor = null } = {}) {
    denyStaff(actor, '고객 1회용 코드');
    let rows = await this.adapter.getAll('roomCodes');
    if (siteId) rows = rows.filter((row) => row.siteId === siteId);
    if (unusedOnly) rows = rows.filter((row) => !row.usedAt);
    return rows.sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt)));
  }

  async issueRoomCode(siteId, note = '', { actor = null } = {}) {
    denyStaff(actor, '고객 1회용 코드 발급');
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
  async enterCustomerRoomWithCode({ phone, code, name = '', title = '', email = '' }) {
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
        email: toText(email),
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

  async listGrants({ accountId = null } = {}, { actor = null } = {}) {
    denyStaff(actor, '고객 방 입장 정보');
    const rows = await this.adapter.getAll('grants');
    return accountId ? rows.filter((row) => row.accountId === accountId) : rows;
  }

  async getGrant(accountId, siteId) {
    const id = `${accountId}::${siteId}`;
    return this.adapter.get('grants', id);
  }

  async createGrant(accountId, siteId, codeId = '', { actor = null } = {}) {
    denyStaff(actor, '고객 방 입장 권한');
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

  /** customerFacing: 고객 방(그리고 그 미리보기)에서 쓰는 값 — 승인 전 보고는 빼고 셉니다. */
  async statsForSite(site, { customerFacing = false } = {}) {
    const all = await this.listReports({ siteId: site.id });
    const reports = customerFacing ? all.filter(isReportVisible) : all;
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

  async resetDemo({ actor = null } = {}) {
    // 이 기기의 모든 데이터를 샘플로 되돌립니다 — 직원 화면에서는 막습니다.
    denyStaff(actor, '데모 데이터 초기화');
    await this.adapter.clear();
    await this._writeSeed();
    await this._migrateSiteLinks();
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
  const instance = new Store(adapter);
  attachRemoteSync(instance);
  return instance;
}

/**
 * 무료 Supabase 동기화를 붙입니다.
 * - 운영 주소(koreaecoclean.github.io)에서는 기본으로 켜집니다.
 * - 로컬 개발 · 자동 테스트(127.0.0.1, localhost, file:)에서는 운영 DB 를 건드리지 않도록
 *   기본으로 꺼져 있습니다. 켜려면 `?sync=on`, 끄려면 `?sync=off`.
 */
function attachRemoteSync(instance) {
  if (typeof attachSupabaseSync !== 'function') return null;
  try {
    return attachSupabaseSync(instance);
  } catch (error) {
    console.warn('[store] 서버 동기화를 시작하지 못했습니다', error);
    return null;
  }
}

export const store = createStore();
