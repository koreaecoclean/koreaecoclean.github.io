/**
 * views/leader.js — 현장 보고 (팀장용)
 *
 * 입장: 전화번호 + 비밀번호 + 팀장 고유코드 (대표가 발급/관리)
 * 보고: ① 시건장치 확인 사진 ② 업장별 맞춤 청소 사진 ③ 특이사항 사진(선택) + 점검 항목 + 메모
 * 등록한 보고는 최고관리자(대표) 확인 후 고객 방에 제출됩니다.
 */

import {
  $,
  $$,
  esc,
  icons,
  uid,
  toast,
  confirmDialog,
  setBusy,
  fmtDateLong,
  fmtTime,
  fmtBytes,
  toISODate,
  nowHHMM,
  daysBetween,
  openLightbox,
  modeSwitchTemplate,
} from '../ui.js';
import { store, StoreError, countReportPhotos, STAFF_STATUS, reportStatus, reportStatusKey, reportNoOf, canUseSupply, MAX_BASELINE_PHOTOS, ASSIGN_STATUS, ASSIGN_REJECT_REASONS, HANDOVER_ACCESS_TYPES, SCHEDULE_STATUS, SCHEDULE_DAYS, SCHEDULE_OVERRIDE_TYPES, GPS_EXCEPTION_REASONS, scheduleDayText, scheduleTimeText, durationText, monthGrid, entriesByDate, CALENDAR_WEEKDAYS, ISSUE_STATUS, issueTitleOf, issueStatusKey } from '../store.js';
import { CATEGORY_META, PHOTO_GROUPS, STAFF_TYPES } from '../seed.js';
import { getSession, loginStaff, loginStaffInvite, logout, demoAccounts, getWorkMode, setWorkMode } from '../auth.js';
import { preparePhoto, prepareSamplePhoto, makePlaceholderPhoto, dataUrlBytes } from '../photos.js';
import { openStaffContractSheet } from './quote-contract.js';
import { openReportSheet } from './report-sheet.js';
import { peekPendingInvite, clearPendingInvite, inviteKind, inviteLabel } from '../invite.js';
import { supplyStaffPanel, openSupplyReceipt, submitSupplyRequest, refreshSupplyTotal } from './supply.js';

const SAMPLE_POOL = {
  security: [['photo-lock', '출입문 잠금장치 · 손잡이 확인']],
  cleaning: {
    office: [
      ['photo-2-meeting', '회의실 · 테이블과 바닥'],
      ['photo-1-office', '사무실 · 책상과 바닥'],
      ['photo-6-lounge', '라운지 · 좌석과 바닥'],
    ],
    clinic: [
      ['photo-3-clinic', '진료실 · 시술 베드'],
      ['photo-4-clinic-lounge', '대기 라운지'],
      ['photo-7-lounge', '공용 라운지 · 홀 바닥'],
    ],
    fitness: [
      ['photo-5-gym', '운동기구 존 · 바닥'],
      ['photo-7-lounge', '공용 라운지 · 홀 바닥'],
      ['photo-6-lounge', '라운지 · 좌석과 바닥'],
    ],
    retail: [
      ['photo-6-lounge', '홀 · 좌석과 바닥'],
      ['photo-7-lounge', '홀 바닥과 가구'],
      ['photo-1-office', '카운터 주변'],
    ],
  },
  issue: [['photo-issue', '현장에서 발견한 특이사항']],
};

const MEMO_CHIPS = ['소모품 보충 필요', '추가 견적 안내 필요', '다음 방문 시 재확인', '시설 문제 발견'];

/**
 * 전달 메모 칩 → `- 항목` 한 줄로 추가합니다.
 * 첫 항목은 그대로 `- 소모품 보충 필요`, 그다음부터는 줄바꿈 뒤에 붙습니다.
 * 이미 들어 있는 항목은 다시 넣지 않고, 빈 줄과 줄 끝 공백은 정리합니다.
 */
function memoChipLines(note) {
  return String(note || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''));
}

function memoHasChip(note, chip) {
  const wanted = `- ${chip}`;
  return memoChipLines(note).some((line) => {
    const row = line.trim();
    return row === wanted || row === chip || row === `• ${chip}`;
  });
}

function addMemoChip(note, chip) {
  const raw = String(note || '').replace(/\r\n/g, '\n');
  if (memoHasChip(raw, chip)) return raw;
  const body = memoChipLines(raw)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .trimEnd();
  return body ? `${body}\n- ${chip}` : `- ${chip}`;
}

/* ---------------- 청소공정 매뉴얼 ---------------- */

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_NAMES = { sun: '일', mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토' };

/** 현장의 요일별 매뉴얼 (없으면 빈 배열). */
function manualDays(site) {
  const days = site && site.manual && Array.isArray(site.manual.days) ? site.manual.days : [];
  return days.filter((day) => day && Array.isArray(day.areas));
}

/** 선택한 요일의 작업 항목을 구역 순서대로 펼칩니다. */
function manualItems(site, dayKey) {
  const days = manualDays(site);
  const day = days.find((row) => row.key === dayKey) || days[0];
  if (!day) return { day: null, items: [] };
  const items = [];
  day.areas.forEach((area, areaIndex) => {
    (area.items || []).forEach((label, itemIndex) => {
      items.push({
        id: `${day.key}:${areaIndex}:${itemIndex}`,
        area: area.label || '',
        floors: area.floors || '',
        label,
      });
    });
  });
  return { day, items };
}

/** 오늘 요일이 작업일이면 그 요일, 아니면 첫 요일. */
function defaultManualDay(site) {
  const days = manualDays(site);
  if (!days.length) return '';
  const todayKey = WEEKDAY_KEYS[new Date().getDay()];
  return (days.find((day) => day.key === todayKey) || days[0]).key;
}

/* ---------------- 처음 상태 사진 시트 ---------------- */

const BASELINE_STAGES_META = [
  { key: 'quote', num: '①', label: '첫 견적 · 오염 상태', hint: '방문 견적 시점의 오염 상태를 남겨 주세요.' },
  { key: 'deepClean', num: '②', label: '첫 청소 · 대청소', hint: '첫 대청소를 마친 뒤 결과 사진을 남겨 주세요.' },
];

let baselineSheet = null;
const baselineSheetState = { siteId: '', siteName: '', onChanged: null };

function stageMeta(stage) {
  return BASELINE_STAGES_META.find((row) => row.key === stage) || BASELINE_STAGES_META[0];
}

function baselineRecord(site, stage) {
  const record = site && site.baseline ? site.baseline[stage] : null;
  return {
    date: (record && record.date) || '',
    note: (record && record.note) || '',
    photos: (record && Array.isArray(record.photos) && record.photos) || [],
  };
}

function ensureBaselineSheet() {
  if (baselineSheet) return baselineSheet;
  baselineSheet = document.createElement('div');
  baselineSheet.className = 'baseline-sheet';
  baselineSheet.id = 'baseline-sheet';
  baselineSheet.hidden = true;
  baselineSheet.setAttribute('role', 'dialog');
  baselineSheet.setAttribute('aria-modal', 'true');
  baselineSheet.setAttribute('aria-label', '처음 상태 사진');
  baselineSheet.innerHTML = `
    <div class="baseline-sheet__backdrop" data-baseline-sheet="close"></div>
    <div class="baseline-sheet__panel">
      <span class="baseline-sheet__grab" aria-hidden="true"></span>
      <div class="baseline-sheet__bar">
        <div class="baseline-sheet__title">
          <strong>처음 상태 사진</strong>
          <span data-baseline-sheet-sub>첫 견적 · 대청소 · 단계마다 최대 ${MAX_BASELINE_PHOTOS}장</span>
        </div>
        <button class="baseline-sheet__close" type="button" data-baseline-sheet="close" aria-label="시트 닫기">×</button>
      </div>
      <div class="baseline-sheet__body" data-baseline-sheet-body></div>
    </div>
  `;
  baselineSheet.addEventListener('click', onBaselineSheetClick);
  baselineSheet.addEventListener('change', onBaselineSheetChange);
  document.addEventListener('keydown', onBaselineSheetKeydown);
  document.addEventListener('kec:navigate', () => closeBaselineSheet());
  document.body.appendChild(baselineSheet);
  return baselineSheet;
}

function closeBaselineSheet() {
  if (!baselineSheet || baselineSheet.hidden) return;
  baselineSheet.hidden = true;
  document.body.classList.remove('baseline-sheet-open');
  baselineSheetState.onChanged = null;
}

/** 팀장 화면의 '처음 상태 사진' 카드 → 시트를 엽니다. */
async function openBaselineSheet(siteId, options = {}) {
  if (!siteId) return;
  const box = ensureBaselineSheet();
  baselineSheetState.siteId = siteId;
  baselineSheetState.onChanged = typeof options.onChanged === 'function' ? options.onChanged : null;
  box.hidden = false;
  document.body.classList.add('baseline-sheet-open');
  await paintBaselineSheet();
}

async function paintBaselineSheet() {
  const box = ensureBaselineSheet();
  const site = await store.getSite(baselineSheetState.siteId);
  if (!site) {
    closeBaselineSheet();
    return;
  }
  baselineSheetState.siteName = site.name;
  const sub = $('[data-baseline-sheet-sub]', box);
  if (sub) sub.textContent = `${site.name} · 단계마다 최대 ${MAX_BASELINE_PHOTOS}장`;
  const body = $('[data-baseline-sheet-body]', box);
  if (!body) return;
  body.innerHTML = BASELINE_STAGES_META.map((meta) => {
    const record = baselineRecord(site, meta.key);
    const count = record.photos.length;
    const remaining = Math.max(0, MAX_BASELINE_PHOTOS - count);
    const full = remaining === 0;
    return `
      <section class="bs-stage" data-bs-stage="${meta.key}">
        <div class="bs-stage__head">
          <div class="bs-stage__title">
            <strong>${meta.num} ${esc(meta.label)}</strong>
            <span>${record.date ? esc(fmtDateLong(record.date)) : '날짜 미등록'}</span>
          </div>
          <span class="bs-stage__count${full ? ' is-full' : ''}">${count}/${MAX_BASELINE_PHOTOS}장</span>
        </div>
        <div class="bs-grid">
          ${record.photos
            .map(
              (photo, index) => `
                <span class="bs-thumb">
                  <button class="bs-thumb__view" type="button" data-baseline-view="${meta.key}" data-baseline-index="${index}"
                          aria-label="${esc(meta.label)} 사진 ${index + 1} 크게 보기">
                    <img src="${esc(store.photoThumbUrl(photo))}" alt="${esc(photo.caption || meta.label)}" loading="lazy" decoding="async">
                  </button>
                  <button class="bs-thumb__del" type="button" data-baseline-remove="${meta.key}" data-baseline-index="${index}"
                          aria-label="${esc(meta.label)} 사진 ${index + 1} 삭제">×</button>
                </span>`,
            )
            .join('')}
          ${
            full
              ? `<span class="bs-add bs-add--full"><span class="bs-add__label">${MAX_BASELINE_PHOTOS}장 모두 등록</span></span>`
              : `<label class="bs-add">
                   ${icons.camera}
                   <span class="bs-add__label">카메라</span>
                   <input type="file" accept="image/*" capture="environment" hidden data-bs-input="${meta.key}">
                 </label>
                 <label class="bs-add bs-add--album">
                   ${icons.image}
                   <span class="bs-add__label">앨범</span>
                   <input type="file" accept="image/*" multiple hidden data-bs-input="${meta.key}">
                 </label>`
          }
        </div>
        <p class="bs-stage__note">
          ${esc(meta.hint)}
          ${full ? `<br><strong>최대 ${MAX_BASELINE_PHOTOS}장까지 등록했습니다.</strong> 새로 넣으려면 사진을 하나 삭제해 주세요.` : `<br>${remaining}장 더 추가할 수 있습니다.`}
        </p>
      </section>`;
  }).join('');
}

async function notifyBaselineChanged() {
  if (!baselineSheetState.onChanged) return;
  try {
    await baselineSheetState.onChanged();
  } catch (error) {
    console.warn('[leader] baseline refresh failed', error);
  }
}

async function addBaselinePhotos(stage, files) {
  const siteId = baselineSheetState.siteId;
  if (!siteId) return;
  const list = Array.from(files || []);
  if (!list.length) return;
  const site = await store.getSite(siteId);
  if (!site) return;
  const record = baselineRecord(site, stage);
  const remaining = Math.max(0, MAX_BASELINE_PHOTOS - record.photos.length);
  if (!remaining) {
    toast(`사진은 최대 ${MAX_BASELINE_PHOTOS}장까지 등록할 수 있습니다.`, { tone: 'error' });
    return;
  }
  if (list.length > remaining) {
    toast(`최대 ${MAX_BASELINE_PHOTOS}장이라 ${remaining}장만 추가합니다.`, { tone: 'error' });
  }
  const accepted = list.slice(0, remaining);
  const added = [];
  for (let index = 0; index < accepted.length; index += 1) {
    toast(`사진 처리 중… (${index + 1}/${accepted.length})`, { duration: 1200 });
    try {
      const prepared = await preparePhoto(accepted[index]);
      added.push(
        await store.savePhoto({
          dataUrl: prepared.dataUrl,
          thumb: prepared.thumb,
          width: prepared.width,
          height: prepared.height,
          caption: stageMeta(stage).label,
        }),
      );
    } catch (error) {
      console.warn('[leader] baseline photo failed', error);
    }
  }
  if (!added.length) {
    toast('사진을 추가하지 못했습니다. 다른 사진으로 시도해 주세요.', { tone: 'error' });
    return;
  }
  await store.saveSiteBaseline(siteId, stage, {
    photos: record.photos.concat(added),
    date: record.date || toISODate(),
    note: record.note || (stage === 'quote' ? '첫 견적 방문 · 오염 상태 기록' : '첫 청소(대청소) 완료 기록'),
  });
  toast(`${stageMeta(stage).label} 사진 ${added.length}장을 저장했습니다.`);
  await paintBaselineSheet();
  await notifyBaselineChanged();
}

async function removeBaselinePhoto(stage, index) {
  const siteId = baselineSheetState.siteId;
  if (!siteId) return;
  const site = await store.getSite(siteId);
  if (!site) return;
  const record = baselineRecord(site, stage);
  const photo = record.photos[index];
  if (!photo) return;
  const ok = await confirmDialog({
    title: '사진을 삭제할까요?',
    message: `${stageMeta(stage).label} 사진 ${index + 1}번째를 이 현장에서 뺍니다. 고객 화면에서도 보이지 않습니다.`,
    confirmLabel: '삭제',
    tone: 'danger',
  });
  if (!ok) return;
  await store.saveSiteBaseline(siteId, stage, {
    photos: record.photos.filter((_, position) => position !== index),
  });
  toast('사진을 삭제했습니다.');
  await paintBaselineSheet();
  await notifyBaselineChanged();
}

async function viewBaselinePhotos(stage, startIndex = 0) {
  const siteId = baselineSheetState.siteId;
  if (!siteId) return;
  const site = await store.getSite(siteId);
  if (!site) return;
  const record = baselineRecord(site, stage);
  const items = [];
  let start = 0;
  for (let index = 0; index < record.photos.length; index += 1) {
    const photo = record.photos[index];
    const url = await store.photoFullUrl(photo);
    if (!url) continue;
    if (index === startIndex) start = items.length;
    items.push({ url, caption: photo.caption || stageMeta(stage).label });
  }
  if (!items.length) {
    toast('사진을 불러오지 못했습니다.', { tone: 'error' });
    return;
  }
  openLightbox(items, start);
}

async function onBaselineSheetClick(event) {
  if (event.target.closest('[data-baseline-sheet="close"]')) {
    closeBaselineSheet();
    return;
  }
  const viewButton = event.target.closest('[data-baseline-view]');
  if (viewButton) {
    await viewBaselinePhotos(viewButton.dataset.baselineView, Number(viewButton.dataset.baselineIndex) || 0);
    return;
  }
  const removeButton = event.target.closest('[data-baseline-remove]');
  if (removeButton) {
    await removeBaselinePhoto(removeButton.dataset.baselineRemove, Number(removeButton.dataset.baselineIndex) || 0);
  }
}

async function onBaselineSheetChange(event) {
  const input = event.target.closest('[data-bs-input]');
  if (!input) return;
  const files = Array.from(input.files || []);
  input.value = '';
  await addBaselinePhotos(input.dataset.bsInput, files);
}

function onBaselineSheetKeydown(event) {
  if (!baselineSheet || baselineSheet.hidden) return;
  if (event.key === 'Escape') closeBaselineSheet();
}

/** 다른 화면(관리)에서도 같은 시트를 열 수 있게 내보냅니다. */
export async function openInitialPhotoSheet(siteId, options = {}) {
  await openBaselineSheet(siteId, options);
}

export function createLeaderView(container) {
  const state = {
    session: null,
    siteId: null,
    draft: null,
    sent: null,
    loginError: '',
    staffError: '',
    myContracts: [],
    leaderTab: 'sites',
    // 대표(최고관리자) 전용 — 팀장 목록 → 그 팀장의 관리업장
    //  직원(관리팀장·부관리자) 화면에는 이 디렉토리가 열리지 않습니다(v2.8.2).
    managerMode: false,
    renderedMode: '',
    teamLeads: [],
    teamContracts: [],
    teamLeadId: '',
    siteStaff: [],
    assignments: [],
    supplyOrders: [],
    supplyCatalog: [],
    supplyRequestOpen: true,
    // 5단계 — 일정 · GPS 현장 도착/완료
    schedule: { entries: [], days: [], summary: {}, today: '' },
    scheduleMonth: '',
    scheduleMonthSchedule: { entries: [] },
    scheduleBusy: '',
    visitForm: { siteId: '', kind: 'arrive', reason: 'indoor', note: '', error: '' },
    // 6단계 — 월간 격자 달력 · 수정 요청 보완
    scheduleView: 'list',
    calendarDate: '',
    editingReportId: '',
    editingReport: null,
    existingPhotos: null,
    revisionCounts: {},
    busy: false,
    // 7단계 — 이 업장의 특이사항 · 현장에서 직접 등록하는 입력값
    siteIssues: [],
    issueDraft: { note: '', photos: [] },
  };
  const sampleCursor = { security: 0, cleaning: 0, issue: 0 };
  let mounted = false;
  /** #invite=S-… 로 자동으로 연 계약서 코드(같은 링크로 두 번 열지 않게). */
  let inviteOpened = '';

  /* ---------------- draft ---------------- */

  function emptyPhotos() {
    return { security: [], cleaning: [], issue: [] };
  }

  function startDraft(session, site) {
    state.draft = {
      date: toISODate(),
      time: nowHHMM(),
      leader: session.name,
      leaderRole: session.title || '팀장',
      duration: 90,
      durationTouched: false,
      note: '',
      issueNote: '',
      photos: emptyPhotos(),
      checks: site.checklist.map(() => false),
      manualDay: defaultManualDay(site),
      manual: {},
    };
  }

  function ensureDraft(session, site) {
    const days = manualDays(site);
    const staleManual = days.length > 0 && !days.some((day) => day.key === (state.draft && state.draft.manualDay));
    if (!state.draft || state.draft.checks.length !== site.checklist.length || staleManual) startDraft(session, site);
    return state.draft;
  }

  /* ---------------- 6단계 — 수정 요청 보완 ---------------- */

  /** 수정 요청받은 보고서 내용을 그대로 폼에 채웁니다(사진은 기존 것 유지 + 새로 추가). */
  function revisionDraft(session, site, report) {
    const rows = new Map((report.checklist || []).map((row) => [row.label, !!row.done]));
    const draft = {
      date: report.date || toISODate(),
      time: report.time || nowHHMM(),
      leader: report.leader || session.name,
      leaderRole: report.leaderRole || session.title || '팀장',
      duration: report.durationMin || 90,
      durationTouched: true,
      note: report.note || '',
      issueNote: report.issueNote || '',
      photos: emptyPhotos(),
      checks: site.checklist.map((label) => rows.get(label) || false),
      manualDay: defaultManualDay(site),
      manual: {},
    };
    if (manualDays(site).length) {
      const info = manualItems(site, draft.manualDay);
      info.items.forEach((item) => {
        const label = item.area ? `${item.area} · ${item.label}` : item.label;
        if (rows.get(label)) draft.manual[item.id] = true;
      });
    }
    return draft;
  }

  async function startRevision(reportId) {
    const report = await store.getReport(reportId);
    if (!report || !state.session) return;
    const site = (await store.getSiteFor(state.session, report.siteId)) || (await store.getSite(report.siteId));
    if (!site) {
      toast('현장 정보를 찾을 수 없습니다.', { tone: 'error' });
      return;
    }
    if (reportStatusKey(report) !== 'returned') {
      toast('지금은 수정 요청된 보고가 아닙니다.', { tone: 'error' });
      return;
    }
    state.siteId = report.siteId;
    state.sent = null;
    state.editingReportId = report.id;
    state.editingReport = report;
    state.existingPhotos = report.photos;
    state.draft = revisionDraft(state.session, site, report);
    await render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function cancelRevision() {
    state.editingReportId = '';
    state.editingReport = null;
    state.existingPhotos = null;
    if (state.session) {
      const site = state.siteId ? await store.getSiteFor(state.session, state.siteId) : null;
      if (site) startDraft(state.session, site);
    }
    await render();
  }

  function revisionBannerTemplate() {
    const report = state.editingReport;
    if (!state.editingReportId || !report) return '';
    return `
      <section class="panel sent-card revision-banner" data-revision-banner="${esc(report.id)}">
        <span class="sent-card__icon">${icons.clipboard}</span>
        <div>
          <strong>수정 요청 보완 · ${esc(reportNoOf(report))}</strong>
          <p>${report.revisionReason ? `${esc(report.revisionReason)}` : '대표가 수정 요청한 보고입니다.'}</p>
          <p class="sent-card__hint">고친 뒤 [보완해서 다시 제출]을 누르면 대표 확인 대기로 돌아갑니다. 기존 사진은 그대로 유지되고 새 사진이 더해집니다.</p>
        </div>
        <div class="btn-row">
          <button class="btn btn--quiet btn--sm" type="button" data-revision-cancel>수정 취소</button>
        </div>
      </section>`;
  }

  /* ---------------- login ---------------- */

  function demoPanelTemplate() {
    const rows = demoAccounts().filter((row) => row.role !== 'customer');
    // 실제 직원 계정은 공개 데모 목록에 올리지 않습니다 — 보여 줄 데모가 없으면 상자를 만들지 않습니다.
    if (!rows.length) return '';
    return `
      <details class="demo-panel">
        <summary>데모 계정 보기 (테스트용)</summary>
        <div class="demo-panel__body">
          <p class="tiny muted">팀장은 전화번호 · 비밀번호 · 팀장 고유코드가 모두 필요합니다.</p>
          ${rows
            .map(
              (row) => `
              <div class="demo-row">
                <div>
                  <strong>${esc(row.roleLabel)} · ${esc(row.name)} ${esc(row.title || '')}</strong>
                  <span>${esc(row.phone)} / ${esc(row.password)} / 코드 ${esc(row.leaderCode)}</span>
                </div>
                <button class="link-btn" type="button" data-fill-staff="${esc(row.phone)}|${esc(row.password)}|${esc(row.leaderCode)}">입력</button>
              </div>`,
            )
            .join('')}
        </div>
      </details>
    `;
  }

  function gateTemplate() {
    return `
      <section class="gate">
        <span class="hero__eyebrow">${icons.camera} 현장 보고 · 팀장용</span>
        <h2>팀장 로그인</h2>
        <p>전화번호 · 비밀번호 · <strong>팀장 고유코드</strong> 세 가지로 입장합니다. 고유코드는 대표가 발급·관리합니다.</p>
        <form class="gate__form" id="leader-login" novalidate>
          <input class="pin-input pin-input--text" id="l-phone" type="tel" inputmode="tel" autocomplete="tel"
                 placeholder="전화번호" aria-label="전화번호" maxlength="15">
          <input class="pin-input pin-input--text" id="l-password" type="password" autocomplete="current-password"
                 placeholder="비밀번호" aria-label="비밀번호" maxlength="30">
          <input class="pin-input pin-input--text" id="l-code" type="text" autocomplete="off" spellcheck="false"
                 placeholder="팀장 고유코드 (예: TL-0000)" aria-label="팀장 고유코드" maxlength="12">
          ${state.loginError ? `<p class="pin-error">${esc(state.loginError)}</p>` : ''}
          <button class="btn btn--primary" type="submit">입장</button>
          <button class="btn btn--ghost" type="button" data-action="go-admin">대표(관리자) 로그인</button>
        </form>
      </section>

      ${demoPanelTemplate()}

      ${staffGateTemplate()}

      <section class="panel">
        <div class="section-head"><h2>보고에 들어가는 내용</h2></div>
        <div class="steps">
          <div class="step"><span class="step__num">1</span><div><strong>시건장치 확인 사진</strong><span>출입문 잠금장치·손잡이 상태를 남깁니다. (필수)</span></div></div>
          <div class="step"><span class="step__num">2</span><div><strong>업장별 맞춤 청소 사진</strong><span>사무실·병원·매장·헬스장에 맞춘 결과 사진. (필수)</span></div></div>
          <div class="step"><span class="step__num">3</span><div><strong>새로 발생한 특이사항</strong><span>문제가 있을 때만 사진과 메모를 남깁니다. (선택)</span></div></div>
        </div>
        <p class="hint" style="margin-top:10px">등록된 보고는 최고관리자(대표) 확인을 거쳐 고객의 전용 방에 제출됩니다.</p>
      </section>
    `;
  }

  /* ---------------- site picker ---------------- */

  function employeeTabsTemplate(active, session) {
    // 2026-11-27 지시 — 직원 평가(근무태도 A~F)는 대표만 봅니다.
    //  직원 화면에는 평가 탭이 없고, 다른 직원의 관리업장도 열리지 않습니다.
    const tabs = [
      { key: 'sites', label: '관리업장' },
      { key: 'contracts', label: '계약서' },
    ];
    // 4단계 — 내게 온 팀장 배정 요청 (대표 요청 → 수락/거절 → 도급계약서 서명)
    if (canReceiveAssignments(session)) {
      const pending = (state.assignments || []).filter((row) => row.status === 'pending').length;
      tabs.push({ key: 'assign', label: pending ? `내 배정 ${pending}` : '내 배정' });
    }
    // 5단계 — 오늘 일정 · GPS 현장 도착/완료
    const todayCount = (state.schedule.entries || []).filter((row) => row.date === state.schedule.today).length;
    if (session) tabs.push({ key: 'schedule', label: todayCount ? `일정 ${todayCount}` : '일정' });
    // 청소장비 · 봉투는 구입 당사자 직원만 봅니다. 부관리자(본부장) 화면에는 나오지 않습니다.
    if (session && session.role === 'leader' && canUseSupply(session)) {
      tabs.push({ key: 'supply', label: '장비 · 봉투' });
    }
    return `
      <nav class="room-tabs${tabs.length >= 5 ? ' room-tabs--compact' : ''}" aria-label="내 직원 방">
        ${tabs
          .map(
            (tab) => `<button class="room-tab" type="button" data-leader-tab="${tab.key}"
              aria-pressed="${active === tab.key}">${esc(tab.label)}</button>`,
          )
          .join('')}
      </nav>`;
  }

  /* ---------------- 5단계 — 일정 · GPS 현장 도착/완료 (기획서 14·15장) ---------------- */

  function scheduleEntryOf(siteId) {
    return (state.schedule.entries || []).find(
      (entry) => entry.siteId === siteId && entry.date === state.schedule.today,
    ) || null;
  }

  /** 그 날짜의 일정 — 오늘 · 이번 주 · 월간에서 찾습니다(보고서 화면 연결용). */
  function scheduleEntryOfDate(siteId, date) {
    const rows = (state.schedule.entries || []).concat(
      (state.scheduleMonthSchedule && state.scheduleMonthSchedule.entries) || [],
    );
    return rows.find((entry) => entry.siteId === siteId && entry.date === date) || null;
  }

  /** 보고서 화면에 보여 주는 «현장 도착 = 시작 / 청소 완료 = 종료» 기록. */
  function workRecordCardTemplate(entry) {
    const start = entry && entry.actualStart ? fmtTime(entry.actualStart) : '';
    const end = entry && entry.actualEnd ? fmtTime(entry.actualEnd) : '';
    const duration = (entry && entry.workDurationText) || '';
    if (!start && !end) return '';
    const lines = [
      start ? `<span class="sched-work-line" data-report-start="${esc(entry.actualStart)}">시작 ${esc(start)}</span>` : '',
      end ? `<span class="sched-work-line" data-report-end="${esc(entry.actualEnd)}">종료 ${esc(end)}</span>` : '',
      duration ? `<span class="sched-work-line" data-report-duration="${esc(entry.workMinutes)}">소요 ${esc(duration)}</span>` : '',
    ].filter(Boolean);
    return `
      <section class="sched-work-card" data-report-worktime="${esc(entry.siteId)}">
        <strong>현장 도착 · 청소 완료 기록</strong>
        <p>${lines.join(' <span class="tiny muted">·</span> ')}</p>
        <p class="tiny muted">이 시작 · 종료 시간이 보고서에 함께 등록됩니다.</p>
        ${duration ? `<div><button class="link-btn" type="button" data-fill-duration="${esc(entry.workMinutes)}">소요 시간 ${esc(duration)}로 채우기</button></div>` : ''}
      </section>`;
  }

  function gpsBadgeTemplate(entry) {
    const gps = (entry && entry.gps) || { key: '', label: '' };
    const parts = [gps.arriveLabel, gps.doneLabel].filter(Boolean);
    if (!parts.length) return '<span class="badge" data-gps-status="none">도착 전</span>';
    const badgeOf = (text) => {
      const cls = text.indexOf('위치 인증') === 0
        ? 'badge--done'
        : text.indexOf('위치 기록') === 0
          ? 'badge--wait'
          : 'badge--stop';
      return `<span class="badge ${cls}">${esc(text)}</span>`;
    };
    return `<span data-gps-status="${esc(gps.key)}">${parts.map(badgeOf).join(' ')}</span>`;
  }

  function visitFormTemplate(siteId) {
    const form = state.visitForm || {};
    if (form.siteId !== siteId) return '';
    const kind = form.kind === 'done' ? 'done' : 'arrive';
    return `
      <form class="sched-exception" data-visit-manual-form="${esc(siteId)}" data-visit-site="${esc(siteId)}" novalidate>
        <input type="hidden" data-visit-kind value="${kind}">
        <p class="tiny"><strong>위치를 확인하지 못했습니다.</strong> 사유를 골라 기록하면 대표 화면에 ‘위치 미인증 · 예외’로 표시됩니다.</p>
        <label class="field">
          <span class="field__label">사유</span>
          <select class="input" data-visit-reason data-visit-reason-site="${esc(siteId)}">
            ${GPS_EXCEPTION_REASONS.map(
              (row) => `<option value="${esc(row.key)}"${row.key === (form.reason || 'indoor') ? ' selected' : ''}>${esc(row.label)}</option>`,
            ).join('')}
          </select>
        </label>
        <label class="field">
          <span class="field__label">메모 (선택)</span>
          <input class="input" type="text" maxlength="80" data-visit-note
                 data-visit-note-site="${esc(siteId)}" value="${esc(form.note || '')}" placeholder="예: 지하 작업실이라 위치가 잡히지 않음">
        </label>
        ${form.error ? `<p class="pin-error">${esc(form.error)}</p>` : ''}
        <div class="btn-row">
          <button class="btn btn--primary btn--sm" type="submit" data-visit-manual="${esc(siteId)}">예외로 기록</button>
          <button class="btn btn--quiet btn--sm" type="button" data-visit-cancel="${esc(siteId)}">취소</button>
        </div>
      </form>`;
  }

  function todayScheduleCardTemplate(entry) {
    const busy = state.scheduleBusy === entry.siteId;
    const done = entry.status === 'done';
    const started = !!entry.arrive;
    const finished = !!entry.done;
    const startClock = entry.actualStart ? fmtTime(entry.actualStart) : '';
    const endClock = entry.actualEnd ? fmtTime(entry.actualEnd) : '';
    const duration = entry.workDurationText || '';
    const overrideLabel = entry.override
      ? (SCHEDULE_OVERRIDE_TYPES[entry.override.type] || {}).label || '일정 변경'
      : '';
    return `
      <article class="sched-card" data-schedule-site="${esc(entry.siteId)}" data-schedule-date="${esc(entry.date)}" data-schedule-status="${esc(entry.status)}">
        <div class="sched-card__head">
          <div>
            <strong>${esc(entry.siteName)}</strong>
            <span class="tiny muted">${esc(entry.time || '시간 미설정')} · ${esc(entry.weekdayLabel)}요일</span>
          </div>
          <span class="badge ${esc(entry.statusBadge)}">${esc(entry.statusLabel)}</span>
        </div>
        ${entry.changed ? `<p class="tiny muted">일정 변경 · ${esc(overrideLabel)}${entry.override && entry.override.note ? ` · ${esc(entry.override.note)}` : ''}</p>` : ''}
        <div class="sched-work" data-work-times="${esc(entry.siteId)}">
          <div class="sched-work__row" data-work-start="${esc(entry.actualStart || '')}">
            <span class="sched-work__label">시작</span>
            <strong class="sched-work__value${started ? ' is-set' : ''}">${started ? esc(startClock) : '등록 전'}</strong>
          </div>
          <div class="sched-work__row" data-work-end="${esc(entry.actualEnd || '')}">
            <span class="sched-work__label">종료</span>
            <strong class="sched-work__value${finished ? ' is-set' : ''}">${finished ? esc(endClock) : '—'}</strong>
            ${duration ? `<span class="sched-work__dur" data-work-duration="${esc(entry.workMinutes)}분">소요 ${esc(duration)}</span>` : ''}
          </div>
        </div>
        <div class="sched-gps" data-gps-status="${esc((entry.gps || {}).key || '')}">
          ${gpsBadgeTemplate(entry)}
          ${entry.reportId ? '<span class="badge badge--done">보고 연결</span>' : ''}
        </div>
        ${entry.hasCoordinates === false ? '<p class="tiny muted">업장 좌표가 아직 없습니다 — 시각은 기록되고, 거리·반경 확인은 대표가 좌표를 등록한 뒤 가능합니다.</p>' : ''}
        ${
          finished
            ? `<p class="sched-work__done" data-work-summary="${esc(entry.siteId)}">${icons.check} 청소 완료${startClock && endClock ? ` · 시작 ${esc(startClock)} → 종료 ${esc(endClock)}` : ''}${duration ? ` (소요 ${esc(duration)})` : ''}</p>
               <button class="link-btn sched-work__redo" type="button" data-visit-redo-done="${esc(entry.siteId)}">완료 시간 다시 기록</button>`
            : started
              ? `<p class="sched-work__started" data-work-started="${esc(entry.siteId)}">${icons.check} 시작 등록됨 · ${esc(startClock)}</p>
                 <div class="btn-row">
                   <button class="btn btn--primary" type="button" data-visit-done="${esc(entry.siteId)}" ${busy ? 'disabled' : ''}>청소 완료 (종료 시간 등록)</button>
                 </div>
                 <button class="link-btn sched-work__redo" type="button" data-visit-arrive="${esc(entry.siteId)}" ${busy ? 'disabled' : ''}>시작 시간 다시 기록</button>`
              : `<div class="btn-row">
                   <button class="btn btn--primary" type="button" data-visit-arrive="${esc(entry.siteId)}" ${busy || done ? 'disabled' : ''}>현장 도착 (GPS 확인) · 시작 등록</button>
                   <button class="btn btn--quiet btn--sm" type="button" data-visit-done="${esc(entry.siteId)}" ${busy || done ? 'disabled' : ''}>청소 완료</button>
                 </div>
                 <p class="tiny muted sched-work__hint">현장에 도착해 [현장 도착]을 누르면 그 시각이 <strong>청소 시작 시간</strong>으로 등록됩니다.</p>`
        }
        ${visitFormTemplate(entry.siteId)}
      </article>`;
  }

  function monthKeyOf(value) {
    const date = value ? new Date(`${value}-01T12:00:00`) : new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function monthRangeOf(key) {
    const [year, month] = String(key || monthKeyOf()).split('-').map(Number);
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    const end = new Date(year, month, 0);
    const last = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    return { from: first, to: last };
  }

  function shiftMonthKey(key, delta) {
    const [year, month] = String(key || monthKeyOf()).split('-').map(Number);
    const date = new Date(year, month - 1 + Number(delta || 0), 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function monthLabelOf(key) {
    const [year, month] = String(key || monthKeyOf()).split('-').map(Number);
    return `${year}년 ${month}월`;
  }

  function scheduleCalendarTemplate() {
    const monthKey = state.scheduleMonth || monthKeyOf();
    const source = state.scheduleMonthSchedule || { entries: [] };
    const today = source.today || toISODate();
    const entries = (source.entries || []).filter(
      (entry) => entry.date >= today || entry.arrive || entry.done || entry.reportId,
    );
    const grid = monthGrid(monthKey, { today });
    const byDate = entriesByDate(entries);
    const selected = (state.calendarDate && state.calendarDate.startsWith(`${grid.key}-`))
      ? state.calendarDate
      : (today.startsWith(`${grid.key}-`) ? today : '');
    const dayEntries = selected ? byDate[selected] || [] : [];
    return `
      <div class="cal-grid" data-schedule-calendar="${esc(grid.key)}">
        <div class="cal-weekdays" role="row">
          ${CALENDAR_WEEKDAYS.map((day) => `<span role="columnheader">${esc(day.label)}</span>`).join('')}
        </div>
        ${grid.weeks
          .map(
            (week) => `<div class="cal-week" role="row">
              ${week
                .map((cell) => {
                  if (!cell.inMonth) return '<span class="cal-cell is-empty" aria-hidden="true"></span>';
                  const rows = byDate[cell.date] || [];
                  const classes = ['cal-cell'];
                  if (cell.isToday) classes.push('is-today');
                  if (cell.date === selected) classes.push('is-selected');
                  if (cell.weekday === 0) classes.push('is-sunday');
                  if (cell.weekday === 6) classes.push('is-saturday');
                  return `<button class="${classes.join(' ')}" type="button" data-cal-date="${esc(cell.date)}"
                    aria-pressed="${cell.date === selected}" aria-label="${esc(`${grid.month}월 ${cell.day}일 · 일정 ${rows.length}건`)}"
                    ${rows.length ? `data-cal-count="${rows.length}"` : ''} data-cal-statuses="${esc(rows.map((row) => row.status).join(','))}">
                    <span class="cal-cell__day">${cell.day}${cell.isToday ? '<span class="cal-cell__today">오늘</span>' : ''}</span>
                    <span class="cal-cell__marks">${rows
                      .slice(0, 4)
                      .map(
                        (entry) => `<i class="cal-mark cal-mark--${esc(entry.status)}" title="${esc(entry.siteName)} · ${esc(entry.statusLabel)}" aria-hidden="true">${esc(String(entry.siteName || '').slice(0, 2))}</i>`,
                      )
                      .join('')}</span>
                    ${rows.length ? `<span class="cal-cell__count">${rows.length}건</span>` : ''}
                  </button>`;
                })
                .join('')}
            </div>`,
          )
          .join('')}
      </div>
      <div class="cal-legend" aria-hidden="true">
        ${['planned', 'active', 'done', 'missed', 'off']
          .map((key) => `<span><i class="cal-mark cal-mark--${key}"></i>${esc((SCHEDULE_STATUS[key] || {}).short || key)}</span>`)
          .join('')}
      </div>
      <div class="cal-detail" data-cal-detail="${esc(selected)}">
        <div class="cal-detail__head">
          <strong>${selected ? esc(fmtDateLong(selected)) : '날짜를 누르면 일정이 보입니다'}</strong>
          <span class="tiny muted">${selected ? `${dayEntries.length}곳` : ''}</span>
        </div>
        ${
          selected && dayEntries.length
            ? dayEntries
                .map(
                  (entry) => `<div class="sched-row" data-schedule-site="${esc(entry.siteId)}" data-schedule-status="${esc(entry.status)}">
                    <span>${esc(entry.siteName)}</span>
                    <span class="tiny muted">${esc(entry.time || '시간 미설정')}</span>
                    <span class="badge ${esc(entry.statusBadge)}">${esc(entry.statusLabel)}</span>
                  </div>`,
                )
                .join('')
            : selected
              ? '<p class="tiny muted cal-empty">이 날은 일정이 없습니다.</p>'
              : ''
        }
      </div>`;
  }

  function scheduleMonthTemplate() {
    const monthKey = state.scheduleMonth || monthKeyOf();
    const monthSource = state.scheduleMonthSchedule || { entries: [] };
    // 지난 날은 실제 기록이 있는 날만 보여 줍니다.
    const entries = (monthSource.entries || []).filter(
      (entry) => entry.date >= (monthSource.today || toISODate()) || entry.arrive || entry.done || entry.reportId,
    );
    return `
      <section class="panel schedule-month" data-schedule-month-panel>
        <div class="section-head sched-month-head">
          <h2 style="font-size:15px">월간 일정</h2>
          <div class="sched-month-nav">
            <button class="link-btn" type="button" data-schedule-month="prev" aria-label="지난달">‹ ${esc(monthLabelOf(shiftMonthKey(monthKey, -1)))}</button>
            <strong>${esc(monthLabelOf(monthKey))}</strong>
            <button class="link-btn" type="button" data-schedule-month="next" aria-label="다음달">${esc(monthLabelOf(shiftMonthKey(monthKey, 1)))} ›</button>
          </div>
        </div>
        <div class="cal-toolbar">
          <span class="tiny muted">${entries.length}건</span>
          <div class="cal-view-toggle" role="group" aria-label="월간 일정 보기 방식">
            <button type="button" data-schedule-view="list" aria-pressed="${state.scheduleView !== 'grid'}">목록</button>
            <button type="button" data-schedule-view="grid" aria-pressed="${state.scheduleView === 'grid'}">달력</button>
          </div>
        </div>
        <div class="sched-view" data-schedule-view-panel="grid"${state.scheduleView === 'grid' ? '' : ' hidden'}>
          ${scheduleCalendarTemplate()}
        </div>
        <div class="sched-view" data-schedule-view-panel="list"${state.scheduleView === 'grid' ? ' hidden' : ''}>
          <div class="sched-month" data-schedule-month-list>
            ${entries.length
              ? entries
                  .map(
                    (entry) => `<div class="sched-month__row" data-schedule-site="${esc(entry.siteId)}" data-schedule-status="${esc(entry.status)}">
                      <span class="sched-month__date">${esc(entry.date.slice(5).replace('-', '.'))} (${esc(entry.weekdayLabel)})</span>
                      <span class="sched-month__name">${esc(entry.siteName)}</span>
                      <span class="tiny muted">${esc(entry.time || '시간 미설정')}</span>
                      <span class="badge ${esc(entry.statusBadge)}">${esc(entry.statusLabel)}</span>
                    </div>`,
                  )
                  .join('')
              : '<p class="tiny muted">이 달에는 일정이 없습니다.</p>'}
          </div>
        </div>
        <p class="tiny muted">정기 청소 요일을 기준으로 만든 한 달 일정입니다. 대표가 휴무 · 보강 · 시간 변경을 넣으면 바로 반영됩니다.</p>
      </section>`;
  }

  function schedulePanelTemplate() {
    const schedule = state.schedule || {};
    const today = schedule.today || toISODate();
    const entries = schedule.entries || [];
    const todayEntries = entries.filter((entry) => entry.date === today);
    // 상태 합계는 ‘오늘’ 기준입니다(이번 주 전체 합계가 아님).
    const summary = { planned: 0, active: 0, done: 0, missed: 0, off: 0 };
    todayEntries.forEach((entry) => {
      if (Object.prototype.hasOwnProperty.call(summary, entry.status)) summary[entry.status] += 1;
    });
    const week = entries.filter((entry) => entry.date !== today);
    const days = (schedule.days || []).filter((day) => day.date !== today);
    const statusRow = [
      ['planned', '예정'],
      ['active', '진행 중'],
      ['done', '완료'],
      ['missed', '미방문'],
    ]
      .map(
        ([key, label]) => `<div data-schedule-count="${key}"><strong>${Number(summary[key]) || 0}</strong><span>${label}</span></div>`,
      )
      .join('');
    const weekRows = days
      .map((day) => {
        const rows = week.filter((entry) => entry.date === day.date);
        if (!rows.length) return '';
        return `
          <div class="sched-day" data-schedule-day="${esc(day.date)}">
            <div class="sched-day__head">
              <strong>${esc(day.date.slice(5).replace('-', '.'))} (${esc(day.weekdayLabel)})</strong>
              <span class="tiny muted">${rows.length}건</span>
            </div>
            ${rows
              .map(
                (entry) => `
                <div class="sched-row" data-schedule-site="${esc(entry.siteId)}" data-schedule-status="${esc(entry.status)}">
                  <span>${esc(entry.siteName)}</span>
                  <span class="tiny muted">${esc(entry.time || '시간 미설정')}</span>
                  <span class="badge ${esc(entry.statusBadge)}">${esc(entry.statusLabel)}</span>
                </div>`,
              )
              .join('')}
          </div>`;
      })
      .join('');
    return `
      <section class="panel schedule-today" data-schedule-panel>
        <div class="section-head">
          <div>
            <h2>오늘 일정</h2>
            <p>${esc(fmtDateLong(today))}</p>
          </div>
          <span class="badge">${todayEntries.length}곳</span>
        </div>
        <div class="sched-stats">${statusRow}</div>
        <p class="hint">현장에 도착하면 [현장 도착]을 누르세요. 그 시각이 <strong>청소 시작 시간</strong>으로 등록되고, 위치가 확인되면 거리와 반경 안 여부도 함께 기록됩니다. [청소 완료]를 누르면 종료 시간과 <strong>소요 시간</strong>이 계산됩니다.</p>
      </section>
      <div class="sched-list">
        ${todayEntries.length ? todayEntries.map(todayScheduleCardTemplate).join('') : '<div class="empty"><strong>오늘 예정된 업장이 없습니다</strong><span>대표가 일정을 바꾸면 여기에 표시됩니다.</span></div>'}
      </div>
      <section class="panel">
        <div class="section-head">
          <h2>이번 주 일정</h2>
          <p>${days.length}일</p>
        </div>
        ${weekRows || '<p class="tiny muted">이번 주 남은 일정이 없습니다.</p>'}
      </section>
      ${scheduleMonthTemplate()}
      <section class="panel">
        <div class="section-head"><h2>기록 안내</h2></div>
        <p class="tiny muted">
          위치는 근무 중 현장 도착 · 완료를 누를 때 그 순간의 좌표만 기록합니다. 근무가 끝나면 위치를 추적하지 않습니다.
          위치 권한을 거부했거나 실내라 위치가 잡히지 않으면 사유를 골라 기록할 수 있고, 그 기록은 ‘위치 미인증 · 예외’로 표시됩니다.
          도착 시각은 청소 시작, 완료 시각은 종료로 남아 보고서에도 함께 등록됩니다.
        </p>
      </section>`;
  }

  /** 브라우저 위치 — 없거나 거부되면 예외 흐름으로 넘깁니다. */
  function currentPosition() {
    return new Promise((resolve, reject) => {
      const geo = typeof navigator !== 'undefined' ? navigator.geolocation : null;
      if (!geo || typeof geo.getCurrentPosition !== 'function') {
        const error = new Error('이 기기에서는 위치 기능을 쓸 수 없습니다.');
        error.code = 'unsupported';
        reject(error);
        return;
      }
      geo.getCurrentPosition(
        (position) => resolve(position),
        (error) => reject(error || new Error('위치를 확인하지 못했습니다.')),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      );
    });
  }

  async function recordVisitAtSite(siteId, kind) {
    if (!state.session || state.scheduleBusy) return;
    state.scheduleBusy = siteId;
    state.visitForm = { siteId: '', kind, reason: 'indoor', note: '', error: '' };
    await render();
    try {
      const position = await currentPosition();
      const coords = (position && position.coords) || {};
      const result = await store.recordSiteVisit(
        siteId,
        {
          kind,
          date: toISODate(),
          mode: 'gps',
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy,
        },
        { actor: state.session },
      );
      state.scheduleBusy = '';
      await render();
      toast(result.message, { duration: 5000 });
    } catch (error) {
      state.scheduleBusy = '';
      state.visitForm = {
        siteId,
        kind,
        reason: error && error.code === 'unsupported' ? 'unsupported' : error && error.code === 1 ? 'denied' : 'indoor',
        note: '',
        error: '',
      };
      await render();
      toast('위치를 확인하지 못했습니다. 사유를 골라 예외로 기록해 주세요.', { tone: 'error', duration: 6000 });
    }
  }

  async function submitVisitException(form) {
    if (!state.session) return;
    const siteId = form.dataset.visitManualForm || form.dataset.visitSite || '';
    const kindInput = form.querySelector('[data-visit-kind]');
    const reasonInput = form.querySelector('[data-visit-reason]');
    const noteInput = form.querySelector('[data-visit-note]');
    const kind = kindInput && kindInput.value === 'done' ? 'done' : 'arrive';
    state.scheduleBusy = siteId;
    try {
      const result = await store.recordSiteVisit(
        siteId,
        {
          kind,
          date: toISODate(),
          mode: 'manual',
          reason: reasonInput ? reasonInput.value : 'indoor',
          note: noteInput ? noteInput.value : '',
        },
        { actor: state.session },
      );
      state.visitForm = { siteId: '', kind: 'arrive', reason: 'indoor', note: '', error: '' };
      state.scheduleBusy = '';
      await render();
      toast(result.message, { duration: 5000 });
    } catch (error) {
      state.scheduleBusy = '';
      state.visitForm = {
        siteId,
        kind,
        reason: reasonInput ? reasonInput.value : 'indoor',
        note: noteInput ? noteInput.value : '',
        error: error.message || '기록하지 못했습니다.',
      };
      await render();
      toast(error.message || '현장 기록을 남기지 못했습니다.', { tone: 'error' });
    }
  }

  /* ---------------- 관리팀장별 관리업장 (대표 전용) ---------------- */

  /* ---------------- 내 도급 조건 (직원 화면 전용) ---------------- */

  /**
   * 직원이 확인할 수 있는 제한 정보 — 이 업장에 정해진 **본인 도급금액**과 지급일뿐입니다.
   * 고객과의 계약 조건은 대표만 봅니다(v2.8.2).
   */
  function staffPayTemplate(site, session) {
    if (!session || session.role !== 'leader') return '';
    const pay = site.staffPay || {};
    const amount = Number(pay.amount) || 0;
    // 1,430,000 처럼 천단위로 보여 줍니다(기기 로케일 데이터에 기대지 않습니다).
    const grouped = String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const amountText = amount ? `월 ${grouped}원` : '미정 · 대표에게 확인';
    return `
      <section class="panel staff-pay-card" data-staff-pay="${esc(site.id)}">
        <div class="section-head">
          <h2>내 도급 조건</h2>
          <p>이 업장에 정해진 금액</p>
        </div>
        <dl class="kv kv--left">
          <dt>도급금액</dt>
          <dd data-staff-pay-amount>${esc(amountText)}</dd>
          <dt>지급일</dt>
          <dd>내 도급계약서 확인</dd>
        </dl>
        <p class="hint">고객과의 계약 조건은 이 화면에 나오지 않습니다. 문의는 대표에게 해 주세요.</p>
      </section>`;
  }

  /* ---------------- 4단계 — 내 배정 요청 · 인수인계 (기획서 10·11장) ---------------- */

  /** 금액 표시 — 팀장 화면은 본인 도급금액만 보여 줍니다(고객 금액 없음). */
  function wonText(value) {
    const amount = Math.round(Number(value) || 0);
    if (!amount) return '미정';
    return `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;
  }

  function accessTypeLabel(key) {
    return (HANDOVER_ACCESS_TYPES.find((row) => row.key === key) || {}).label || '';
  }

  /** 인수인계 항목 — 값이 있는 줄만 보여 줍니다. */
  function handoverRowsHtml(handover) {
    const h = handover || {};
    const join = (...parts) => parts.filter(Boolean).join(' · ');
    const rows = [
      ['현장 주소', h.address],
      ['출입 방식', join(accessTypeLabel(h.accessType), h.accessMethod)],
      ['출입 가능 시간', h.accessHours],
      ['출입 담당', join(h.accessContact, h.accessNote)],
      ['경비실 · 관리실', join(h.guardDesk, h.guardContact)],
      ['주차', join(h.parking, h.parkingNote)],
      ['쓰레기', join(h.trashLocation, h.trashTime, h.trashSeparate ? '분리수거' : '분리수거 안 함', h.trashFood, h.trashNote)],
      ['도구 · 비품', join(h.storageTools, h.storageSupplies)],
      ['시설 · 연락처', join(h.facilityWater, h.facilityPower, h.facilityContact)],
      ['청소 요일 · 시간', join(h.workDays, h.workHours, h.workTarget)],
      ['청소 범위', h.workScope],
      ['주의사항', h.cautions],
    ].filter(([, value]) => value);
    if (!rows.length) return '';
    return `<dl class="kv kv--left handover-list">${rows
      .map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`)
      .join('')}</dl>`;
  }

  function handoverPhotosHtml(photos) {
    const list = Array.isArray(photos) ? photos : [];
    if (!list.length) return '';
    return `<div class="handover-photos" data-handover-photos>
      ${list
        .map(
          (photo) => `<figure class="handover-photo">
            <img src="${esc(photo.thumb)}" alt="${esc(photo.label || '현장 사진')}" loading="lazy" decoding="async">
            <figcaption>${esc(photo.label || photo.area || '현장')}${photo.caption ? ` · ${esc(photo.caption)}` : ''}</figcaption>
          </figure>`,
        )
        .join('')}
    </div>`;
  }

  function assignmentBadge(status) {
    const meta = ASSIGN_STATUS[status] || ASSIGN_STATUS.pending;
    return `<span class="badge ${meta.badge}">${esc(meta.label)}</span>`;
  }

  /** 배정 요청을 받는 사람 = 관리팀장. 본부장(부관리자)은 받지 않습니다. */
  function canReceiveAssignments(session) {
    if (!session || session.role !== 'leader') return false;
    if (session.account && session.account.canManageStaff) return false;
    return !/본부장/.test(session.title || '');
  }

  /** 수락 전 — 대표가 보낸 인수인계 · 도급금액만 보고 수락/거절합니다. */
  function pendingAssignmentCard(row) {
    const h = row.handover || {};
    return `
      <article class="panel assign-card" data-assignment="${esc(row.id)}" data-assignment-status="${esc(row.status)}">
        <div class="section-head">
          <div>
            <h2>${esc(row.site.name)}</h2>
            <p>${esc(row.site.code)} · ${esc(row.site.area || '')} · ${esc(row.site.frequency || '')}</p>
          </div>
          ${assignmentBadge(row.status)}
        </div>
        <p class="tiny muted">${esc(row.sentBy || '대표')}님이 ${esc(String(row.sentAt).slice(0, 16).replace('T', ' '))}에 보낸 배정 요청입니다.
          인수인계 v${esc(String(row.handoverVersion || 0))} · 아래 내용을 확인하고 수락 또는 거절해 주세요.</p>
        <div class="assign-pay" data-assign-pay="${esc(row.id)}">
          <span>도급금액 <strong>${esc(wonText(row.amount))}</strong></span>
          <span>지급일 <strong>${esc(row.payDay || '15')}일</strong></span>
        </div>
        ${handoverRowsHtml(h)}
        ${handoverPhotosHtml(h.photos)}
        ${row.terms ? `<p class="hint">지급 조건: ${esc(row.terms)}</p>` : ''}
        ${row.note ? `<p class="hint">대표 메모: ${esc(row.note)}</p>` : ''}
        <p class="hint">고객과의 계약 금액 · 계약 문서 · 견적 내용은 이 화면에 나오지 않습니다. 수락하면 이 내용으로 팀장 도급계약서가 만들어집니다.</p>
        <div class="btn-row">
          <button class="btn btn--primary" type="button" data-assign-accept="${esc(row.id)}">배정 수락</button>
        </div>
        <details class="assign-reject" data-assign-reject-box="${esc(row.id)}">
          <summary>거절하기 (사유 입력)</summary>
          <div class="field" style="margin-top:10px">
            <label for="reason-code-${esc(row.id)}">거절 사유</label>
            <select class="input" id="reason-code-${esc(row.id)}" data-assign-code="${esc(row.id)}">
              ${ASSIGN_REJECT_REASONS.map(
                (reason) => `<option value="${esc(reason.key)}">${esc(reason.label)}</option>`,
              ).join('')}
            </select>
          </div>
          <div class="field">
            <label for="reason-text-${esc(row.id)}">사유 메모 <span class="tiny muted">(기타를 고르면 필수)</span></label>
            <textarea class="textarea" id="reason-text-${esc(row.id)}" rows="2" maxlength="200" data-assign-reason="${esc(row.id)}"
                      placeholder="예: 그 시간대 다른 현장과 겹칩니다."></textarea>
          </div>
          <button class="btn btn--quiet" type="button" data-assign-reject="${esc(row.id)}">이 배정 거절</button>
        </details>
      </article>`;
  }

  /** 수락·거절·대체된 요청 — 결과와 계약서로 이어집니다. */
  function decidedAssignmentRow(row) {
    const when = String(row.decisionAt || row.sentAt || '').slice(0, 16).replace('T', ' ');
    return `
      <div class="my-doc-row assign-row" data-assignment="${esc(row.id)}" data-assignment-status="${esc(row.status)}">
        <div class="my-doc-row__who">
          <strong>${esc(row.site.name)}</strong>
          <span>${esc(row.site.code)} · 도급 ${esc(wonText(row.amount))} · ${esc(row.payDay || '15')}일 지급${when ? ` · ${esc(when)}` : ''}</span>
          ${row.rejectReason ? `<span class="tiny muted">거절 사유: ${esc(row.rejectReason)}</span>` : ''}
        </div>
        <div class="my-doc-row__right">
          ${assignmentBadge(row.status)}
          ${
            row.contractId
              ? `<button class="btn btn--sm btn--ghost" type="button" data-open-staff-contract="${esc(row.contractId)}">
                   ${row.confirmedAt ? '도급계약서 보기' : '확인 · 서명'}
                 </button>`
              : ''
          }
        </div>
      </div>`;
  }

  function assignmentPanelTemplate(session) {
    const rows = state.assignments || [];
    const pending = rows.filter((row) => row.status === 'pending');
    const decided = rows.filter((row) => row.status !== 'pending');
    return `
      <section data-assign-panel>
        <div class="section-head">
          <h2>내 배정</h2>
          <p>${pending.length ? `수락 대기 ${pending.length}건` : '대기 중인 배정 없음'}</p>
        </div>
        ${pending.length
          ? pending.map(pendingAssignmentCard).join('')
          : `<section class="panel"><div class="empty"><strong>지금은 받은 배정 요청이 없습니다</strong>
               <span>대표가 업장 · 도급금액 · 인수인계 내용을 담아 배정을 요청하면 이곳에 표시됩니다.</span></div></section>`}
        ${decided.length
          ? `<section class="panel" data-assign-history>
               <div class="section-head"><h2>지난 배정</h2><p>${decided.length}건</p></div>
               ${decided.map(decidedAssignmentRow).join('')}
             </section>`
          : ''}
        <section class="panel">
          <div class="section-head"><h2>최근 7일</h2></div>
          <div class="kv" id="week-summary"><dt>불러오는 중</dt><dd>-</dd></div>
        </section>
      </section>
      ${settingsTemplate(session)}`;
  }

  /** 배정이 확정된 업장의 인수인계 — 현장에서 바로 보는 정보(+출입 비밀번호 열람). */
  function handoverCardTemplate(site) {
    const handover = site.handover || {};
    if (!handover.version) return '';
    return `
      <section class="panel handover-card" data-handover-card="${esc(site.id)}" data-handover-version="${esc(String(handover.version))}">
        <div class="section-head">
          <h2>인수인계</h2>
          <p>v${esc(String(handover.version))} · ${esc(String(handover.updatedAt || '').slice(0, 10))} 저장</p>
        </div>
        ${site.assignee && site.assignee.name ? `<p class="tiny muted">담당 확정 ${esc(site.assignee.name)} · ${esc(String(site.assignee.since || '').slice(0, 10))}</p>` : ''}
        ${handoverRowsHtml(handover)}
        ${handoverPhotosHtml(handover.photos)}
        <dl class="kv kv--left handover-pay">
          <dt>도급금액</dt><dd data-handover-pay>${esc(wonText(handover.pay && handover.pay.amount))}</dd>
          <dt>지급일</dt><dd>${esc((handover.pay && handover.pay.payDay) || '15')}일</dd>
          ${handover.pay && handover.pay.terms ? `<dt>지급 조건</dt><dd>${esc(handover.pay.terms)}</dd>` : ''}
        </dl>
        <div class="secret-row" data-site-secret="${esc(site.id)}">
          <span>출입 비밀번호</span>
          ${
            site.secretSet
              ? `<strong data-secret-value>••••••</strong>
                 <button class="link-btn" type="button" data-reveal-secret="${esc(site.id)}">보기</button>
                 <span class="tiny muted" data-secret-note>열람 기록 ${esc(String(site.secretLogCount || 0))}건 · 누르면 기록이 남습니다</span>`
              : '<span class="ops-empty">미등록 · 대표에게 확인</span>'
          }
        </div>
        <p class="hint">현장에서 확인한 출입 · 쓰레기 · 주차 정보입니다. 바뀐 내용은 대표에게 알려 주세요.</p>
      </section>`;
  }

  function siteRowsTemplate(sites) {
    const today = toISODate();
    return Promise.all(
      sites.map(async (site) => {
        const reports = await store.listReports({ siteId: site.id, limit: 1 });
        const last = reports[0];
        const doneToday = last && last.date === today;
        const meta = CATEGORY_META[site.category] || {};
        let badge = '<span class="badge">기록 없음</span>';
        if (doneToday) badge = '<span class="badge badge--done">오늘 보고 완료</span>';
        const revisions = Number(state.revisionCounts[site.id]) || 0;
        if (revisions) {
          badge = `<span class="badge badge--revise" data-site-revision="${esc(site.id)}">수정 요청 ${revisions}건</span>`;
        }
        else if (last) {
          const due = daysBetween(last.date) >= (site.intervalDays || 7) - 1;
          badge = due
            ? '<span class="badge badge--wait">방문 예정</span>'
            : `<span class="badge">${daysBetween(last.date)}일 전 방문</span>`;
        }
        return `
          <button class="pick" type="button" data-pick-site="${esc(site.id)}">
            <span>
              <strong>${esc(site.name)}</strong>
              <span>${esc(meta.short || '')} · ${esc(site.code)} · ${esc(site.frequency)}</span>
            </span>
            <span class="pick__right">${badge}<span class="site-item__code">담당 ${esc(site.manager || '-')}</span></span>
          </button>`;
      }),
    );
  }

  /** 그 팀장과 연결된 계약서 — 관리자는 바로 열어 봅니다. */
  function leadContractTemplate(lead, session) {
    const contract =
      state.teamContracts.find((row) => row.accountId && row.accountId === lead.id) ||
      state.teamContracts.find((row) => row.name === lead.name) ||
      null;
    const canOpen = session.role === 'admin';
    if (!contract) {
      return `
        <section class="panel lead-contract" data-lead-contract="${esc(lead.id)}">
          <div class="section-head"><h2>팀장과의 계약서</h2><p>${esc(lead.name)} ${esc(lead.title || '')}</p></div>
          <p class="tiny muted">이 팀장과 연결된 계약서가 없습니다. 관리 → 직원 · 계약 관리에서 만들 수 있습니다.</p>
        </section>`;
    }
    const meta = STAFF_TYPES[contract.employmentType] || STAFF_TYPES.freelancer;
    const status = STAFF_STATUS[contract.status] || STAFF_STATUS.draft;
    return `
      <section class="panel lead-contract" data-lead-contract="${esc(contract.id)}">
        <div class="section-head">
          <h2>팀장과의 계약서</h2>
          <p>${esc(meta.label)} · ${esc(contract.no)}</p>
        </div>
        <div class="my-doc-row" data-team-contract-row="${esc(contract.id)}">
          <div class="my-doc-row__who">
            <strong>${esc(contract.name)} ${esc(contract.roleTitle || '')}</strong>
            <span>${esc(contract.no)} · ${esc(contract.startDate || '')} ~ ${esc(contract.endDate || '')} · 업장 ${contract.siteIds.length}곳</span>
          </div>
          <div class="my-doc-row__right">
            <span class="badge ${status.badge}">${esc(status.label)}</span>
            ${
              canOpen
                ? `<button class="btn btn--sm btn--ghost" type="button" data-team-contract="${esc(contract.id)}">계약서 열기</button>`
                : ''
            }
          </div>
        </div>
        <p class="hint">이 팀장에게 새 업장이 배정되면 별첨(관리업장 표)에 자동으로 추가됩니다.</p>
      </section>`;
  }

  /** 관리자용 팀장 계약서 목록 — 금액은 보여주지 않습니다(부관리자 화면 공통). */
  function teamContractsTemplate(rows, session) {
    if (!rows || !rows.length) return '';
    const canOpen = session.role === 'admin';
    return `
      <section class="panel" data-team-docs>
        <div class="section-head">
          <h2>팀장 계약서</h2>
          <p>${rows.length}건</p>
        </div>
        ${rows
          .map((contract) => {
            const meta = STAFF_TYPES[contract.employmentType] || STAFF_TYPES.freelancer;
            const status = STAFF_STATUS[contract.status] || STAFF_STATUS.draft;
            return `
              <div class="my-doc-row" data-team-contract-row="${esc(contract.id)}">
                <div class="my-doc-row__who">
                  <strong>${esc(contract.name)} ${esc(contract.roleTitle || '')}</strong>
                  <span>${esc(meta.short)} · ${esc(contract.no)} · 업장 ${contract.siteIds.length}곳</span>
                </div>
                <div class="my-doc-row__right">
                  <span class="badge ${status.badge}">${esc(status.label)}</span>
                  ${
                    canOpen
                      ? `<button class="btn btn--sm btn--ghost" type="button" data-team-contract="${esc(contract.id)}">계약서 열기</button>`
                      : ''
                  }
                </div>
              </div>`;
          })
          .join('')}
        <p class="hint">팀장과의 계약서는 팀장이 맡은 관리업장과 함께 별첨이 맞춰집니다.</p>
      </section>`;
  }

  /** 관리자 화면의 관리업장 — 팀장 목록 → 팀장별 업장. */
  async function managerSitesTemplate(session, sites) {
    const leads = state.teamLeads;
    const pickedId = state.teamLeadId;
    const picked = leads.find((lead) => lead.id === pickedId) || null;

    if (!pickedId) {
      return `
        <section data-lead-directory>
          <div class="section-head">
            <h2>관리팀장</h2>
            <p>${leads.length}명 · 팀장을 고르면 담당 업장이 열립니다</p>
          </div>
          <div class="lead-grid">
            ${leads
              .map(
                (lead) => `
              <button class="lead-card" type="button" data-pick-lead="${esc(lead.id)}">
                <span class="lead-card__avatar" aria-hidden="true">${esc(lead.name.slice(0, 1))}</span>
                <span class="lead-card__who">
                  <strong>${esc(lead.name)} ${esc(lead.title || '팀장')}</strong>
                  <span>${esc(lead.sites.map((site) => site.name).slice(0, 2).join(' · ') || '배정 업장 없음')}${lead.sites.length > 2 ? ` 외 ${lead.sites.length - 2}` : ''}</span>
                </span>
                <span class="lead-card__count">${lead.sites.length}<em>곳</em></span>
              </button>`,
              )
              .join('')}
            <button class="lead-card lead-card--all" type="button" data-pick-lead="__all__">
              <span class="lead-card__avatar" aria-hidden="true">
                ${esc(session.name.slice(0, 1))}
              </span>
              <span class="lead-card__who">
                <strong>전체 업장 보기</strong>
                <span>팀장 구분 없이 모든 현장을 봅니다</span>
              </span>
              <span class="lead-card__count">${sites.length}<em>곳</em></span>
            </button>
          </div>
          <p class="hint" style="margin-top:10px">팀장을 고르면 그 팀장의 관리업장·계약서가 함께 열립니다.</p>
        </section>
        <section class="panel">
          <div class="section-head"><h2>최근 7일</h2></div>
          <div class="kv" id="week-summary"><dt>불러오는 중</dt><dd>-</dd></div>
        </section>`;
    }

    const list = picked ? picked.sites : sites;
    const rows = await siteRowsTemplate(list);
    return `
      <section data-lead-sites="${esc(pickedId)}">
        <button class="btn btn--sm btn--quiet lead-back" type="button" data-lead-back>← 팀장 목록</button>
        <div class="section-head">
          <h2>${esc(picked ? `${picked.name} ${picked.title || ''}` : '전체 업장')} · 관리업장</h2>
          <p>${list.length}곳</p>
        </div>
        <div class="pick-list">${rows.join('')}</div>
        <p class="hint" style="margin-top:10px">현장을 고르면 사진·점검 항목을 기록하는 보고서가 열립니다.</p>
      </section>
      ${picked ? leadContractTemplate(picked, session) : ''}
      <section class="panel">
        <div class="section-head"><h2>최근 7일</h2></div>
        <div class="kv" id="week-summary"><dt>불러오는 중</dt><dd>-</dd></div>
      </section>`;
  }

  async function sitePickerTemplate(session, sites) {
    const today = toISODate();
    const rows = await Promise.all(
      sites.map(async (site) => {
        const reports = await store.listReports({ siteId: site.id, limit: 1 });
        const last = reports[0];
        const doneToday = last && last.date === today;
        const meta = CATEGORY_META[site.category] || {};
        let badge = '<span class="badge">기록 없음</span>';
        if (doneToday) badge = '<span class="badge badge--done">오늘 보고 완료</span>';
        const revisions = Number(state.revisionCounts[site.id]) || 0;
        if (revisions) {
          badge = `<span class="badge badge--revise" data-site-revision="${esc(site.id)}">수정 요청 ${revisions}건</span>`;
        }
        else if (last) {
          const due = daysBetween(last.date) >= (site.intervalDays || 7) - 1;
          badge = due
            ? '<span class="badge badge--wait">방문 예정</span>'
            : `<span class="badge">${daysBetween(last.date)}일 전 방문</span>`;
        }
        return `
          <button class="pick" type="button" data-pick-site="${esc(site.id)}">
            <span>
              <strong>${esc(site.name)}</strong>
              <span>${esc(meta.short || '')} · ${esc(site.code)} · ${esc(site.frequency)}</span>
            </span>
            <span class="pick__right">${badge}${site.manager ? `<span class="site-item__code">담당 ${esc(site.manager)}</span>` : ''}</span>
          </button>`;
      }),
    );

    const tab = state.leaderTab || 'sites';
    return `
      ${leaderBarTemplate(session)}
      ${employeeTabsTemplate(tab, session)}
      ${
        tab === 'contracts'
          ? state.managerMode
            ? teamContractsTemplate(state.teamContracts, session) ||
              `<section class="panel">${`<div class="empty"><strong>아직 팀장 계약서가 없습니다</strong><span>관리 → 직원 · 계약 관리에서 만들 수 있습니다.</span></div>`}</section>`
            : myDocsTemplate(state.myContracts) ||
              `<section class="panel">${`<div class="empty"><strong>아직 계약서가 없습니다</strong><span>대표가 계약서를 보내면 이곳에 표시됩니다.</span></div>`}</section>`
          : tab === 'supply'
            ? supplyStaffPanel({                  catalog: state.supplyCatalog,
                  orders: state.supplyOrders,
                  session,
                  state: { supply: { open: state.supplyRequestOpen } },
                })
              : tab === 'schedule'
                ? schedulePanelTemplate()
              : tab === 'assign' && canReceiveAssignments(session)
                ? assignmentPanelTemplate(session)
              : state.managerMode
                ? await managerSitesTemplate(session, sites)
                : `<section>
                 <div class="section-head">
                   <h2>관리업장</h2>
                   <p>${sites.length}곳 배정</p>
                 </div>
                 <div class="pick-list">${rows.join('')}</div>
                 <p class="hint" style="margin-top:10px">현장을 고르면 사진·점검 항목을 기록하는 보고서가 열립니다.</p>
               </section>
               <section class="panel">
                 <div class="section-head"><h2>최근 7일</h2></div>
                 <div class="kv" id="week-summary"><dt>불러오는 중</dt><dd>-</dd></div>
               </section>`
      }
      ${settingsTemplate(session)}
    `;
  }

  function leaderBarTemplate(session) {
    const isAdmin = session.role === 'admin';
    return `
      <div class="leader-bar">
        <div class="leader-bar__who">
          <span class="avatar" aria-hidden="true">${esc(session.name.slice(0, 1))}</span>
          <div>
            <strong>${esc(session.name)} ${esc(session.title || '팀장')}${isAdmin && !/대표/.test(session.title || '') ? ' · 대표' : ''}</strong>
            <span>${esc(session.phone || '')} · ${esc(fmtDateLong(toISODate()))}</span>
          </div>
        </div>
        <button class="btn btn--sm btn--quiet" type="button" data-action="logout">로그아웃</button>
      </div>
      ${isAdmin ? modeSwitchTemplate(getWorkMode()) : ''}
    `;
  }

  /* ---------------- report form ---------------- */

  function photoSectionTemplate(group, site, draft, index) {
    const photos = draft.photos[group.key] || [];
    // 수정 요청 보완 — 기존 보고서 사진은 지우지 않고 그대로 둔 채 새 사진만 더합니다.
    const kept = (state.existingPhotos && state.existingPhotos[group.key]) || [];
    const label = group.key === 'cleaning'
      ? `${CATEGORY_META[site.category]?.cleaningLabel || group.label} 사진`
      : `${group.label} 사진`;
    const required = group.required;
    const max = Number(group.max) || 0;
    const full = max > 0 && photos.length + kept.length >= max;
    const keptBlock = kept.length
      ? `<div class="kept-photos" data-kept-group="${esc(group.key)}">
           <p class="tiny muted">기존 사진 ${kept.length}장 · 유지됩니다 (새 사진은 뒤에 더해집니다)</p>
           <div class="thumbs">
             ${kept
               .map(
                 (photo) => `<div class="thumb"><img src="${esc(store.photoThumbUrl(photo))}" alt="기존 보고 사진" loading="lazy" decoding="async"></div>`,
               )
               .join('')}
           </div>
         </div>`
      : '';

    return `
      <section class="panel photo-panel photo-panel--${group.key}">
        <div class="section-head">
          <h2><span class="step-badge">${index + 1}</span>${esc(label)} ${required ? '<span class="req">*</span>' : '<span class="opt">선택</span>'}</h2>
          <p><span data-photo-count="${group.key}">${photos.length + kept.length}</span>${max ? `/${max}` : ''}장</p>
        </div>
        <p class="tiny muted" style="margin:-6px 0 10px">${esc(group.hint)}${max ? ` · 최대 ${max}장` : ''}</p>
        ${keptBlock}
        ${
          full
            ? `<p class="upload-full">${max}장을 모두 채웠습니다. 더 넣으려면 아래에서 사진을 삭제해 주세요.</p>`
            : ''
        }
        <div class="upload-pick${full ? ' is-full' : ''}">
          <label class="upload-pick__btn upload-pick__btn--camera" for="photo-${group.key}-camera">
            ${icons.camera}
            <strong>카메라 촬영</strong>
            <span>바로 찍기</span>
          </label>
          <label class="upload-pick__btn" for="photo-${group.key}-album">
            ${icons.image}
            <strong>앨범에서 선택</strong>
            <span>여러 장 한 번에</span>
          </label>
        </div>
        <input id="photo-${group.key}-camera" data-photo-input="${group.key}" type="file"
               accept="image/*" capture="environment" hidden${full ? ' disabled' : ''}>
        <input id="photo-${group.key}-album" data-photo-input="${group.key}" type="file"
               accept="image/*" multiple hidden${full ? ' disabled' : ''}>
        <div class="thumbs" id="thumbs-${group.key}" style="margin-top:10px">
          ${thumbsTemplate(group.key, photos)}
        </div>
        <div class="btn-row btn-row--stack" style="margin-top:10px">
          <button class="btn btn--quiet btn--sm" type="button" data-sample-group="${group.key}">
            샘플 사진 넣기 (카메라 없이 테스트)
          </button>
        </div>
        ${
          group.key === 'issue'
            ? `<div class="field" style="margin-top:12px">
                 <label for="r-issue-note">특이사항 메모</label>
                 <textarea class="textarea" id="r-issue-note" rows="3"
                   placeholder="예: 회의실 천장에 물얼룩 발견 · 관리사무소 전달 필요">${esc(draft.issueNote)}</textarea>
               </div>`
            : ''
        }
      </section>
    `;
  }

  function opsCardTemplate(site, { withProcess = true } = {}) {
    const ops = site.ops || {};
    const value = (text) => (text ? esc(text) : '<span class="ops-empty">미등록 · 관리자에게 확인</span>');

    return `
      <section class="panel ops-card" data-ops-card="${esc(site.id)}">
        <div class="section-head">
          <h2>현장 운영 정보</h2>
          <p>현장 필수 정보</p>
        </div>
        <p class="tiny muted" style="margin:-6px 0 10px">
          이 현장에서 바로 확인하는 정보입니다. ${withProcess ? '청소 공정·출입·쓰레기·주차를 확인하세요.' : '출입·쓰레기·주차를 확인하세요.'}
        </p>
        <dl class="kv kv--left ops-list">
          ${withProcess ? `<dt>청소 공정</dt>
          <dd data-ops-field="process">${value(ops.process)}</dd>` : ''}
          <dt>출입방법</dt>
          <dd data-ops-field="accessMethod">${value(ops.accessMethod)}</dd>
          <dt>쓰레기 배출위치</dt>
          <dd data-ops-field="trashLocation">${value(ops.trashLocation)}</dd>
          <dt>주차방법</dt>
          <dd data-ops-field="parkingMethod">${value(ops.parkingMethod)}</dd>
        </dl>
      </section>
    `;
  }

  /* ---------------- 내 계약서 · 배정 직원 (금액 없음) ---------------- */

  function myDocsTemplate(contracts) {
    if (!contracts || !contracts.length) return '';
    return `
      <section class="panel my-docs" data-my-docs>
        <div class="section-head">
          <h2>내 계약서</h2>
          <p>대표가 보낸 계약</p>
        </div>
        ${contracts
          .map((contract) => {
            const meta = STAFF_TYPES[contract.employmentType] || STAFF_TYPES.freelancer;
            const status = STAFF_STATUS[contract.status] || STAFF_STATUS.draft;
            return `
              <div class="my-doc-row" data-my-contract="${esc(contract.id)}">
                <div class="my-doc-row__who">
                  <strong>${esc(meta.label)}</strong>
                  <span>${esc(contract.no)} · ${esc(contract.startDate || '')} ~ ${esc(contract.endDate || '')}</span>
                </div>
                <div class="my-doc-row__right">
                  <span class="badge ${status.badge}">${esc(status.label)}</span>
                  <button class="btn btn--sm btn--ghost" type="button" data-open-staff-contract="${esc(contract.id)}">
                    ${contract.status === 'signed' ? '계약서 보기' : '확인 · 서명'}
                  </button>
                </div>
              </div>`;
          })
          .join('')}
        <p class="hint">계약 내용 확인과 전자서명은 이 화면에서 바로 할 수 있습니다.</p>
      </section>
    `;
  }

  function siteStaffTemplate(site, contracts) {
    return `
      <section class="panel site-staff" data-site-staff="${esc(site.id)}">
        <div class="section-head">
          <h2>배정 직원</h2>
          <p>${contracts.length}명</p>
        </div>
        ${contracts.length
          ? contracts
              .map((contract) => {
                const meta = STAFF_TYPES[contract.employmentType] || STAFF_TYPES.freelancer;
                const status = STAFF_STATUS[contract.status] || STAFF_STATUS.draft;
                return `<div class="my-doc-row">
                    <div class="my-doc-row__who"><strong>${esc(contract.name)} ${esc(contract.roleTitle || '')}</strong><span>${esc(meta.short)} · ${esc(contract.workDays || '일정 협의')}</span></div>
                    <span class="badge ${status.badge}">${esc(status.label)}</span>
                  </div>`;
              })
              .join('')
          : '<p class="tiny muted">이 현장에 배정된 직원 계약이 없습니다.</p>'}
        <p class="hint">대표가 계약을 발송하면 직원이 자기 계정으로 확인 · 서명합니다.</p>
      </section>
    `;
  }

  function staffGateTemplate() {
    const invite = peekPendingInvite();
    const inviteCode = invite && inviteKind(invite) === 'staff' ? invite : '';
    return `
      <section class="panel staff-gate">
        <div class="section-head">
          <h2>직원관리방 입장</h2>
          <p>프리랜서 · 도급 · 일용직</p>
        </div>
        ${
          inviteCode
            ? `<div class="invite-banner" data-invite-banner>
                 <strong>초대 링크로 접속하셨습니다 · ${esc(inviteLabel(inviteCode))}</strong>
                 <span>초대코드 <code>${esc(inviteCode)}</code> 가 입력되어 있습니다. 전화번호만 넣고 입장하면 내 계약서가 바로 열립니다.</span>
               </div>`
            : ''
        }
        <p class="tiny muted">
          대표가 보낸 <strong>1회용 직원 초대코드</strong>로 내 계약서를 확인하고 전자서명합니다.
          한 번 입장한 번호는 다음부터 전화번호만 입력해도 들어옵니다.
        </p>
        <form class="form" id="staff-invite-form" style="margin-top:12px" novalidate>
          <div class="field">
            <label for="si-phone">전화번호</label>
            <input class="input" id="si-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000" maxlength="15">
          </div>
          <div class="field">
            <label for="si-code">1회용 직원 초대코드 <span class="tiny muted">(처음 한 번만)</span></label>
            <input class="input" id="si-code" type="text" autocomplete="off" spellcheck="false" placeholder="예: S-H3K9P2" maxlength="12" value="${esc(inviteCode)}">
          </div>
          ${state.staffError ? `<p class="field__error">${esc(state.staffError)}</p>` : ''}
          <button class="btn btn--primary btn--block" type="submit">직원관리방 입장</button>
        </form>
        <p class="hint">초대코드는 대표가 직원에게 직접 전달합니다. 화면에 다른 직원의 코드·번호는 표시하지 않습니다.</p>
      </section>
    `;
  }

  /** 기본 화면에는 등록 장수만 — 사진은 시트에서 보고 · 추가 · 삭제합니다. */
  function baselinePanelTemplate(site) {
    const baseline = site.baseline || {};
    const countOf = (key) => ((baseline[key] && baseline[key].photos) || []).length;
    const quoteCount = countOf('quote');
    const deepCleanCount = countOf('deepClean');
    return `
      <section class="panel baseline-card" data-baseline-card="${esc(site.id)}">
        <div class="section-head">
          <h2>처음 상태 사진</h2>
          <p>첫 견적 · 대청소</p>
        </div>
        <button class="baseline-card__open" type="button" data-baseline-open="${esc(site.id)}">
          <span class="baseline-card__body">
            <span class="baseline-card__counts">
              <span><em>①</em> 첫 견적 <strong>${quoteCount}</strong>장</span>
              <span><em>②</em> 첫 대청소 <strong>${deepCleanCount}</strong>장</span>
            </span>
            <span class="baseline-card__hint">${
              quoteCount + deepCleanCount
                ? '눌러서 사진 보기 · 추가 · 삭제'
                : '아직 등록된 사진이 없습니다 · 눌러서 추가'
            } · 단계마다 최대 ${MAX_BASELINE_PHOTOS}장</span>
          </span>
          <span class="baseline-card__cta">열기</span>
        </button>
      </section>
    `;
  }

  function formTemplate(session, site) {
    const draft = ensureDraft(session, site);
    const meta = CATEGORY_META[site.category] || {};
    const hasManual = manualDays(site).length > 0;
    const workEntry = scheduleEntryOfDate(site.id, draft.date);
    // 현장 도착 · 청소 완료로 계산된 소요 시간이 있으면 처음 열 때 그 값으로 채워 둡니다
    //  (팀장이 직접 고친 뒤에는 덮어쓰지 않음).
    if (!draft.durationTouched && workEntry && Number(workEntry.workMinutes) > 0) {
      draft.duration = Number(workEntry.workMinutes);
    }

    return `
      ${leaderBarTemplate(session)}
      ${state.sent ? sentTemplate(state.sent) : ''}
      ${revisionBannerTemplate()}

      ${staffPayTemplate(site, session)}

      ${handoverCardTemplate(site)}

      ${
        hasManual
          ? [site.ops && site.ops.accessMethod, site.ops && site.ops.trashLocation, site.ops && site.ops.parkingMethod].some(Boolean)
            ? opsCardTemplate(site, { withProcess: false })
            : ''
          : opsCardTemplate(site)
      }

      ${state.siteStaff.length ? siteStaffTemplate(site, state.siteStaff) : ''}

      ${baselinePanelTemplate(site)}

      <section class="panel">
        <div class="section-head">
          <h2>${esc(site.name)}</h2>
          <button class="sort-btn" type="button" data-action="change-site">현장 변경</button>
        </div>
        <p class="tiny muted">${esc(meta.label || '')} · ${esc(site.code)} · ${esc(site.frequency)}</p>
        <div class="field-row" style="margin-top:12px">
          <div class="field">
            <label for="r-date">방문 날짜</label>
            <input class="input" id="r-date" type="date" value="${esc(draft.date)}" max="${esc(toISODate())}">
          </div>
          <div class="field">
            <label for="r-time">완료 시간</label>
            <input class="input" id="r-time" type="time" value="${esc(draft.time)}">
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>담당 팀장</label>
            <input class="input" type="text" value="${esc(`${draft.leader} ${draft.leaderRole}`)}" readonly>
          </div>
          <div class="field">
            <label for="r-duration">소요 시간(분)</label>
            <input class="input" id="r-duration" type="number" inputmode="numeric" min="10" max="480" step="5" value="${esc(draft.duration)}">
          </div>
        </div>
      </section>

      ${workRecordCardTemplate(workEntry)}

      ${hasManual ? manualCardTemplate(site, draft) : ''}

      ${PHOTO_GROUPS.map((group, index) => photoSectionTemplate(group, site, draft, index)).join('')}

      ${
        hasManual
          ? ''
          : `<section class="panel">
              <div class="section-head">
                <h2>점검 항목</h2>
                <button class="sort-btn" type="button" data-action="check-all">전체 선택</button>
              </div>
              <div class="progress-line">
                <span id="check-progress-text">${draft.checks.filter(Boolean).length}/${draft.checks.length}</span>
                <div class="progress-line__bar"><i id="check-progress" style="width:${progressPercent(draft)}%"></i></div>
              </div>
              <div class="check-list" style="margin-top:10px">
                ${site.checklist
                  .map(
                    (label, index) => `
                      <label class="check-item">
                        <input type="checkbox" data-check="${index}"${draft.checks[index] ? ' checked' : ''}>
                        <span>${esc(label)}</span>
                      </label>`,
                  )
                  .join('')}
              </div>
            </section>`
      }

      <section class="panel">
        <div class="section-head">
          <h2>전달 메모</h2>
          <p>고객에게 전달</p>
        </div>
        <textarea class="textarea" id="r-note" rows="4" placeholder="예: 회의실 카펫 얼룩 제거 완료, 핸드타월 2박스 보충했습니다.">${esc(draft.note)}</textarea>
        <div class="memo-chips">
          ${MEMO_CHIPS.map((chip) => {
            const on = memoHasChip(draft.note, chip);
            return `<button class="memo-chip${on ? ' is-on' : ''}" type="button" data-memo="${esc(chip)}" aria-pressed="${on}">+ ${esc(chip)}</button>`;
          }).join('')}
        </div>
        <p class="tiny muted memo-hint">칩을 누르면 한 줄에 하나씩 <strong>- 항목</strong> 으로 들어갑니다. 직접 쓰셔도 됩니다.</p>
      </section>

      ${issuePanelTemplate(site)}

      <p class="tiny muted" style="text-align:center;margin:4px 0 8px">
        ${state.editingReportId
          ? '고친 내용을 다시 제출하면 <strong>대표 확인 대기</strong>로 돌아갑니다. 고객에게는 대표가 제출한 뒤에 보입니다.'
          : '등록한 보고는 <strong>최고관리자(대표) 확인</strong>을 거쳐 고객사에 제출됩니다.'}
      </p>

      <div class="submit-bar">
        <button class="btn btn--primary" type="button" data-action="submit-report">${state.editingReportId ? '보완해서 다시 제출' : '보고 등록하기'}</button>
      </div>

      <section class="panel">
        <div class="section-head">
          <h2>최근 제출한 보고</h2>
          <p id="my-report-count"></p>
        </div>
        <div id="my-reports"><p class="tiny muted">불러오는 중…</p></div>
      </section>

      ${settingsTemplate(session)}
    `;
  }

  /* ---------------- 7단계 — 특이사항 (본인 업장) ---------------- */

  /**
   * 본인 업장의 특이사항 — 진행 상태만 보입니다(금액 · 다른 업장 · 다른 직원 정보 없음).
   * 보고서 없이 발견한 특이사항도 여기서 바로 등록합니다.
   */
  function issuePanelTemplate(site) {
    const rows = state.siteIssues || [];
    const draft = state.issueDraft || { note: '', photos: [] };
    const open = rows.filter((row) => issueStatusKey(row) !== 'done' && issueStatusKey(row) !== 'closed');
    const rowsHtml = rows.length
      ? `<div class="issue-site-list">${rows
          .slice(0, 6)
          .map((row) => {
            const status = ISSUE_STATUS[issueStatusKey(row)] || ISSUE_STATUS.discovered;
            const meta = [
              row.date ? fmtDateLong(row.date) : '',
              row.reportNo ? `보고 ${row.reportNo}` : '직접 등록',
              row.quoteStatus ? '추가 견적 진행' : '',
            ]
              .filter(Boolean)
              .join(' · ');
            return `
              <div class="issue-site-row" data-site-issue="${esc(row.id)}" data-issue-status="${esc(issueStatusKey(row))}">
                <div class="issue-site-row__body">
                  <strong>${esc(issueTitleOf(row))}</strong>
                  <span>${esc(meta)}</span>
                </div>
                <span class="badge ${status.badge}">${esc(status.label)}</span>
              </div>`;
          })
          .join('')}</div>`
      : '<p class="tiny muted">등록된 특이사항이 없습니다.</p>';
    return `
      <section class="panel issue-site" data-site-issues="${esc(site.id)}">
        <div class="section-head">
          <h2>특이사항</h2>
          <p>${open.length ? `진행 ${open.length}건` : '진행 중 없음'}</p>
        </div>
        <p class="tiny muted" style="margin:-6px 0 10px">
          보고서에 적은 특이사항은 자동으로 대표에게 전달됩니다. 보고서에 없던 내용도 여기서 바로 등록할 수 있고,
          진행 상태는 대표가 바꾸면 이 화면에도 보입니다.
        </p>
        ${rowsHtml}
        <div class="issue-form" data-issue-form="${esc(site.id)}">
          <textarea class="textarea" id="issue-note" rows="2" maxlength="1000"
            placeholder="예: 계단 난간 페인트 벗겨짐 · 보수 필요">${esc(draft.note)}</textarea>
          ${draft.photos.length ? `<div class="issue-form__photos">${draft.photos.map((photo) => `<img src="${esc(photo.thumb)}" alt="특이사항 사진">`).join('')}</div>` : ''}
          <div class="btn-row btn-row--stack">
            <label class="btn btn--quiet btn--sm">사진 추가
              <input type="file" accept="image/*" capture="environment" hidden data-issue-photo-input>
            </label>
            ${draft.note || draft.photos.length ? '<button class="btn btn--quiet btn--sm" type="button" data-issue-clear>입력 지우기</button>' : ''}
            <button class="btn btn--primary btn--sm" type="button" data-issue-submit="${esc(site.id)}">특이사항 등록</button>
          </div>
        </div>
      </section>`;
  }

  async function submitIssue(siteId, button) {
    const draft = state.issueDraft || { note: '', photos: [] };
    const note = String(draft.note || '').trim();
    if (!note && !draft.photos.length) {
      toast('특이사항 내용이나 사진을 1개 이상 넣어 주세요.', { tone: 'error' });
      return;
    }
    if (state.busy) return;
    state.busy = true;
    setBusy(button, true, '등록 중…');
    try {
      const photos = [];
      for (const photo of draft.photos) {
        photos.push(
          await store.savePhoto({
            dataUrl: photo.dataUrl,
            thumb: photo.thumb,
            width: photo.width,
            height: photo.height,
            caption: photo.caption || '특이사항',
          }),
        );
      }
      await store.addIssue(
        { siteId, note, photos, actor: state.session ? state.session.name : '팀장' },
        { actor: state.session },
      );
      state.issueDraft = { note: '', photos: [] };
      await render();
      toast('특이사항을 등록했습니다. 대표 확인 후 추가 견적으로 이어집니다.', { duration: 7000 });
    } catch (error) {
      toast(error.message || '특이사항을 등록하지 못했습니다.', { tone: 'error' });
    } finally {
      state.busy = false;
      setBusy(button, false);
    }
  }

  async function addIssuePhoto(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    const draft = state.issueDraft || { note: '', photos: [] };
    const remaining = Math.max(0, 3 - draft.photos.length);
    if (!remaining) {
      toast('특이사항 사진은 3장까지 넣을 수 있습니다.', { tone: 'error' });
      return;
    }
    const accepted = list.slice(0, remaining);
    if (accepted.length < list.length) toast(`사진은 3장까지라 ${accepted.length}장만 넣었습니다.`, { tone: 'error' });
    for (const file of accepted) {
      try {
        toast('사진 처리 중…', { duration: 1200 });
        const prepared = await preparePhoto(file);
        draft.photos.push({ ...prepared, caption: '특이사항' });
      } catch (error) {
        console.warn('[leader] issue photo failed', error);
      }
    }
    state.issueDraft = draft;
    await render();
    toast(`사진 ${accepted.length}장을 넣었습니다. [특이사항 등록]을 눌러 저장하세요.`);
  }

  function sentTemplate(sent) {
    const revised = !!sent.revised;
    return `
      <section class="sent-card">
        <span class="sent-card__icon">${icons.check}</span>
        <div>
          <strong>${revised ? '보완해서 다시 제출했습니다 · 대표 확인 대기' : '보고를 등록했습니다 · 관리자 확인 대기'}</strong>
          <p>${esc(sent.siteName)} · ${esc(fmtDateLong(sent.date))} ${esc(fmtTime(sent.time))}${sent.reportNo ? ` · ${esc(sent.reportNo)}` : ''}<br>
          시건장치 ${sent.photos.security.length}장 · 맞춤 청소 ${sent.photos.cleaning.length}장 · 특이사항 ${sent.photos.issue.length}장 ·
          점검 ${sent.doneCount}/${sent.totalCount}</p>
          <p class="sent-card__hint">${revised
            ? '수정 요청에 대한 보완 내용이 대표에게 전달됐습니다. 대표가 확인해 고객사에 제출하면 그때 고객 방에 보입니다.'
            : '최고관리자(대표)가 확인해 고객사에 제출하면 그때 고객 방에 보입니다.'}</p>
        </div>
        <div class="btn-row">
          <button class="btn btn--quiet btn--sm" type="button" data-action="dismiss-sent">닫기</button>
        </div>
      </section>
    `;
  }

  function thumbsTemplate(groupKey, photos) {
    if (!photos.length) {
      return `<p class="tiny muted" style="grid-column:1/-1">아직 추가된 사진이 없습니다.</p>`;
    }
    return photos
      .map(
        (photo) => `
          <div class="thumb">
            <img src="${esc(photo.thumb)}" alt="추가한 현장 사진" loading="lazy" decoding="async">
            <button class="thumb__remove" type="button" data-remove-photo="${esc(photo.tempId)}"
                    data-group="${esc(groupKey)}" aria-label="사진 삭제">×</button>
          </div>`,
      )
      .join('');
  }

  function manualBodyTemplate(site, draft) {
    const { day, items } = manualItems(site, draft.manualDay);
    if (!day) return '';
    const days = manualDays(site);
    const todayKey = WEEKDAY_KEYS[new Date().getDay()];
    const showDays = days.length > 1;
    const offDay = showDays && !days.some((row) => row.key === todayKey);
    const checked = draft.manual || {};
    const done = items.filter((item) => checked[item.id]).length;
    const percent = items.length ? Math.round((done / items.length) * 100) : 0;

    // 같은 구역(사무실 · 화장실 · 계단 · 주방 · 홀)을 묶어서 보여줍니다.
    const groups = [];
    for (const item of items) {
      let group = groups[groups.length - 1];
      if (!group || group.area !== item.area || group.floors !== item.floors) {
        group = { area: item.area, floors: item.floors, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    }

    return `
      ${
        showDays
          ? `<div class="manual-days">${days
              .map(
                (row) => `<button class="manual-day" type="button" data-manual-day="${esc(row.key)}"
                  aria-pressed="${row.key === draft.manualDay}">${esc(row.label)}</button>`,
              )
              .join('')}</div>`
          : ''
      }
      ${
        offDay
          ? `<p class="tiny muted manual-offday">오늘(${esc(WEEKDAY_NAMES[todayKey])})은 작업일이 아닙니다 · ${days
              .map((row) => esc(row.label))
              .join(' · ')} 중 고르세요</p>`
          : ''
      }
      ${groups
        .map(
          (group) => `
        <div class="manual-area">
          <div class="manual-area__head">
            <strong>${esc(group.area)}</strong>
            ${group.floors ? `<span>${esc(group.floors)}</span>` : ''}
          </div>
          <div class="check-list">
            ${group.items
              .map(
                (item) => `
              <label class="check-item">
                <input type="checkbox" data-manual-check="${esc(item.id)}"${checked[item.id] ? ' checked' : ''}>
                <span>${esc(item.label)}</span>
              </label>`,
              )
              .join('')}
          </div>
        </div>`,
        )
        .join('')}
      <div class="progress-line" style="margin-top:10px">
        <span data-manual-progress-text>${done}/${items.length}</span>
        <div class="progress-line__bar"><i data-manual-progress style="width:${percent}%"></i></div>
      </div>
    `;
  }

  /** 청소 가능 시간 한 줄 + (요일 버튼) + 톡톡 눌러 확인하는 작업 체크리스트. */
  function manualCardTemplate(site, draft) {
    const manual = site.manual || {};
    const { day, items } = manualItems(site, draft.manualDay);
    if (!day || !items.length) return '';
    const subtitle = day.key === 'daily' ? '매일 같은 작업' : `${day.label}요일 작업`;
    return `
      <section class="panel manual-card" id="manual-card" data-manual-card="${esc(site.id)}">
        <div class="section-head">
          <h2>${icons.check} 청소공정 매뉴얼</h2>
          <p data-manual-subtitle>${esc(subtitle)}</p>
        </div>
        ${
          manual.time || manual.timeNote
            ? `<p class="manual-time">
          <span class="manual-time__label">청소 가능 시간</span>
          <strong>${esc(manual.time || '')}</strong>
          ${manual.timeNote ? `<span class="manual-time__note">${esc(manual.timeNote)}</span>` : ''}
        </p>`
            : ''
        }
        <div data-manual-body>${manualBodyTemplate(site, draft)}</div>
      </section>
    `;
  }

  function progressPercent(draft) {
    if (!draft.checks.length) return 0;
    return Math.round((draft.checks.filter(Boolean).length / draft.checks.length) * 100);
  }

  function photoSizeLabel(draft) {
    const all = Object.values(draft.photos).flat();
    const bytes = all.reduce((sum, photo) => sum + (photo.bytes || dataUrlBytes(photo.dataUrl)), 0);
    return fmtBytes(bytes);
  }

  function settingsTemplate(session) {
    const isCeo = !!session && session.role === 'admin';
    return `
      <details class="settings">
        <summary>저장 공간 · 설정</summary>
        <div class="settings__body">
          <dl class="kv" id="storage-info">
            <dt>저장 방식</dt><dd>${esc(store.adapterName === 'indexeddb' ? 'IndexedDB (이 기기)' : store.adapterName === 'memory' ? '메모리 (임시)' : 'localStorage (이 기기)')}</dd>
            <dt>사용량</dt><dd id="storage-usage">계산 중…</dd>
          </dl>
          <div class="btn-row btn-row--stack">
            ${isCeo ? '<button class="btn btn--quiet btn--sm" type="button" data-action="reset-demo">데모 데이터 초기화</button>' : ''}
            <button class="btn btn--quiet btn--sm" type="button" data-action="logout">로그아웃</button>
          </div>
          <p class="hint">
            ${isCeo ? '초기화하면 이 기기의 모든 계정·보고·코드가 샘플 상태로 되돌아갑니다.' : '데이터 초기화는 대표(최고관리자)만 할 수 있습니다.'}
            실제 운영에서는 Supabase로 옮겨 기기 간 공유가 필요합니다(README 7장).
          </p>
        </div>
      </details>
    `;
  }

  /* ---------------- partial updates ---------------- */

  function refreshPhotos(groupKey) {
    const draft = state.draft;
    if (!draft) return;
    const photos = draft.photos[groupKey] || [];
    const box = $(`#thumbs-${groupKey}`, container);
    if (box) box.innerHTML = thumbsTemplate(groupKey, photos);
    const count = $(`[data-photo-count="${groupKey}"]`, container);
    if (count) count.textContent = String(photos.length);
    const group = PHOTO_GROUPS.find((row) => row.key === groupKey);
    const max = group ? Number(group.max) || 0 : 0;
    if (!max) return;
    const full = photos.length >= max;
    const panel = $('.photo-panel--' + groupKey, container);
    if (!panel) return;
    const pick = $('.upload-pick', panel);
    if (pick) pick.classList.toggle('is-full', full);
    $$(`[data-photo-input="${groupKey}"]`, panel).forEach((input) => {
      input.disabled = full;
    });
  }

  function refreshChecks() {
    const draft = state.draft;
    if (!draft) return;
    const done = draft.checks.filter(Boolean).length;
    const text = $('#check-progress-text', container);
    if (text) text.textContent = `${done}/${draft.checks.length}`;
    const bar = $('#check-progress', container);
    if (bar) bar.style.width = `${progressPercent(draft)}%`;
  }

  function refreshManualProgress() {
    const boxes = $$('[data-manual-check]', container);
    if (!boxes.length) return;
    const done = boxes.filter((box) => box.checked).length;
    const text = $('[data-manual-progress-text]', container);
    if (text) text.textContent = `${done}/${boxes.length}`;
    const bar = $('[data-manual-progress]', container);
    if (bar) bar.style.width = `${Math.round((done / boxes.length) * 100)}%`;
  }

  async function switchManualDay(dayKey) {
    const draft = state.draft;
    if (!draft || !dayKey) return;
    draft.manualDay = dayKey;
    const site = await store.getSiteFor(state.session, state.siteId);
    const body = $('[data-manual-body]', container);
    if (site && body) body.innerHTML = manualBodyTemplate(site, draft);
    const { day } = manualItems(site, dayKey);
    const subtitle = $('[data-manual-subtitle]', container);
    if (subtitle && day) subtitle.textContent = day.key === 'daily' ? '매일 같은 작업' : `${day.label}요일 작업`;
    $('[data-manual-card]', container)?.classList.add('is-day-changed');
  }

  async function refreshMyReports(session) {
    const box = $('#my-reports', container);
    if (!box) return;
    const rows = await store.listReports({ leader: session.name, limit: 6 }, { actor: session });
    const count = $('#my-report-count', container);
    if (count) count.textContent = rows.length ? `${rows.length}건` : '';
    if (!rows.length) {
      box.innerHTML = '<p class="tiny muted">아직 제출한 보고가 없습니다.</p>';
      return;
    }
    const sites = await store.listSitesFor(session);
    const names = new Map(sites.map((site) => [site.id, site.name]));
    box.innerHTML = rows
      .map(
        (report) => {
          const status = reportStatus(report);
          const key = reportStatusKey(report);
          const returned = key === 'returned';
          return `
          <div class="my-report" data-my-report="${esc(report.id)}" data-report-status="${esc(key)}">
            <div class="my-report__body">
              <strong>${esc(names.get(report.siteId) || report.siteName)}</strong>
              <span class="report-no" data-report-no>${esc(reportNoOf(report))}</span>
              <span>${esc(fmtDateLong(report.date))} ${esc(fmtTime(report.time))} · 사진 ${countReportPhotos(report)}장</span>
              <em class="badge ${status.badge} my-report__status">${esc(status.label)}</em>
              ${returned && report.revisionReason ? `<p class="my-report__reason" data-revision-reason><strong>수정 요청 사유</strong> ${esc(report.revisionReason)}</p>` : ''}
              <div class="my-report__actions">
                ${returned ? `<button class="btn btn--primary btn--sm" type="button" data-revise-start="${esc(report.id)}">보완해서 다시 제출</button>` : ''}
                <button class="link-btn" style="background:var(--surface-3);color:var(--body);border-color:var(--line)"
                        type="button" data-report-detail="${esc(report.id)}">상세 · 인쇄</button>
                ${returned ? '' : `<button class="link-btn" style="background:var(--surface-3);color:var(--body);border-color:var(--line)"
                        type="button" data-delete-report="${esc(report.id)}">삭제</button>`}
              </div>
            </div>
          </div>`;
        },
      )
      .join('');
  }

  async function refreshStorage() {
    const usage = await store.usage();
    const target = $('#storage-usage', container);
    if (!target) return;
    target.textContent =
      usage.supported && usage.quota ? `${fmtBytes(usage.usage)} / ${fmtBytes(usage.quota)}` : `${fmtBytes(usage.usage)} 사용`;
  }

  async function refreshWeekSummary(allowed = null) {
    const box = $('#week-summary', container);
    if (!box) return;
    const scope = Array.isArray(allowed) ? new Set(allowed.map((site) => site.id)) : null;
    let reports = await store.listReports({}, { actor: state.session });
    if (scope) reports = reports.filter((report) => scope.has(report.siteId));
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekKey = toISODate(weekAgo);
    const recent = reports.filter((report) => report.date >= weekKey);
    const photos = recent.reduce((sum, report) => sum + countReportPhotos(report), 0);
    box.innerHTML = `
      <dt>최근 7일 보고</dt><dd>${recent.length}건</dd>
      <dt>등록된 사진</dt><dd>${photos}장</dd>
      <dt>전체 누적</dt><dd>${reports.length}건</dd>
    `;
  }

  /* ---------------- render ---------------- */

  async function render(options = {}) {
    mount();
    if (options && options.tab && ['sites', 'contracts', 'supply', 'assign', 'schedule'].includes(options.tab)) {
      state.leaderTab = options.tab;
    }
    // 업장 바로 열기(초대·알림·테스트에서 씁니다) — 권한은 아래 배정 업장 목록으로 다시 검사합니다.
    if (options && options.siteId) state.siteId = options.siteId;
    const session = await getSession();
    state.session = session && (session.role === 'leader' || session.role === 'admin') ? session : null;

    if (!state.session) {
      state.siteId = null;
      state.draft = null;
      state.myContracts = [];
      state.leaderTab = 'sites';
      state.siteStaff = [];
      state.assignments = [];
      state.supplyCatalog = [];
      state.supplyOrders = [];
      state.managerMode = false;
      state.renderedMode = '';
      state.teamLeads = [];
      state.teamContracts = [];
      state.teamLeadId = '';
      state.schedule = { entries: [], days: [], summary: {}, today: '' };
      state.visitForm = { siteId: '', kind: 'arrive', reason: 'indoor', note: '', error: '' };
      closeBaselineSheet();
      container.innerHTML = gateTemplate();
      return;
    }

    // 직원에게는 배정된 업장만, 계약 금액·고객 개인정보를 뺀 제한 정보로 내려줍니다.
    const sites = await store.listSitesFor(state.session);
    // v2.8.2 — 팀장 목록(다른 직원의 관리)은 대표(최고관리자)만 봅니다.
    //  부관리자(본부장)도 직원으로서 본인 배정 업장만 봅니다.
    const managerRole = state.session.role === 'admin';
    // 최고관리자(대표)는 직원 모드로 바꿔 팀장처럼 보고서를 쓸 수 있습니다.
    const staffMode = managerRole && getWorkMode() === 'staff';
    const modeKey = managerRole ? (staffMode ? 'staff' : 'admin') : '';
    if (state.renderedMode !== modeKey) {
      if (state.renderedMode) {
        state.siteId = null;
        state.draft = null;
        state.teamLeadId = '';
      }
      state.renderedMode = modeKey;
    }
    state.managerMode = managerRole && !staffMode;
    const assigned = state.session.assignedSiteIds || [];
    // 직원 모드(대표)는 배정과 관계없이 모든 현장에서 보고서를 쓸 수 있습니다.
    const allowed = state.managerMode || staffMode
      ? sites
      : assigned.length
        ? sites.filter((site) => assigned.includes(site.id))
        : [];
    if (state.managerMode) {
      const accounts = await store.listAccounts({ role: 'leader' }, { actor: state.session });
      state.teamLeads = accounts
        .filter((account) => account.active !== false)
        .filter((account) => !account.canManageStaff && !/본부장/.test(account.title || ''))
        .map((account) => ({
          id: account.id,
          name: account.name,
          title: account.title || '팀장',
          phone: account.phonePretty || account.phone,
          sites: sites.filter(
            (site) =>
              (account.assignedSiteIds || []).includes(site.id) || (site.manager && site.manager === account.name),
          ),
        }))
        .filter((lead) => lead.sites.length);
      state.teamContracts = await store.listStaffContracts({}, { actor: state.session });
      if (
        state.teamLeadId &&
        state.teamLeadId !== '__all__' &&
        !state.teamLeads.some((lead) => lead.id === state.teamLeadId)
      ) {
        state.teamLeadId = '';
      }
    } else {
      state.teamLeads = [];
      state.teamContracts = [];
      state.teamLeadId = '';
    }
    state.myContracts = await store.listStaffContracts(
      { accountId: state.session.accountId },
      { actor: state.session },
    );
    // 4단계 — 내게 온 팀장 배정 요청 (본인 계정 것만 · 고객 금액 없음).
    state.assignments = canReceiveAssignments(state.session) ? await store.listAssignmentRequests(state.session) : [];
    // 5단계 — 본인 일정(대표는 전체) + 오늘 현장 도착/완료 기록. 서버·기기 어느 쪽에서든
    //  배정된 업장만 내려옵니다(store.listSchedule 이 권한별로 거릅니다).
    state.schedule = await store.listSchedule({}, { actor: state.session });
    // 6단계 — 수정 요청이 온 보고를 업장 목록에서 바로 알아볼 수 있게 셉니다.
    //  (화면이 두 번 그려져도 숫자가 두 배가 되지 않도록 지역 변수로 세고 한 번에 넣습니다.)
    const revisionCounts = {};
    if (!state.managerMode) {
      const returnedRows = await store.listReports({ status: 'returned' }, { actor: state.session }).catch(() => []);
      returnedRows.forEach((row) => {
        revisionCounts[row.siteId] = (Number(revisionCounts[row.siteId]) || 0) + 1;
      });
    }
    state.revisionCounts = revisionCounts;
    const monthRange = monthRangeOf(state.scheduleMonth || monthKeyOf());
    state.scheduleMonthSchedule = await store.listSchedule(
      { from: monthRange.from, to: monthRange.to },
      { actor: state.session },
    );

    // 청소장비 · 봉투: 구입 당사자 직원(부관리자·대표 제외)에게만 열립니다.
    const supplyAllowed = state.session.role === 'leader' && canUseSupply(state.session);
    if (supplyAllowed) {
      state.supplyCatalog = await store.listSupplyCatalog();
      state.supplyOrders = await store.listSupplyOrders(
        { accountId: state.session.accountId },
        { actor: state.session },
      );
    } else {
      state.supplyCatalog = [];
      state.supplyOrders = [];
      if (state.leaderTab === 'supply') state.leaderTab = 'sites';
    }

    if (!state.siteId) {
      state.draft = null;
      container.innerHTML = await sitePickerTemplate(state.session, allowed);
      refreshWeekSummary(allowed);
      refreshStorage();
      openInviteContractOnce(state.session);
      return;
    }

    const site = sites.find((item) => item.id === state.siteId);
    if (!site) {
      state.siteId = null;
      await render();
      return;
    }

    // 배정 직원 목록은 대표만 — 직원은 다른 직원의 계약을 볼 수 없습니다.
    state.siteStaff = state.managerMode
      ? await store.listStaffContracts({ siteId: site.id }, { actor: state.session })
      : [];
    // 7단계 — 이 업장의 특이사항(본인 업장 · 진행 상태만, 금액 없음).
    state.siteIssues = await store.listIssues({ siteId: site.id }, { actor: state.session }).catch(() => []);


    container.innerHTML = formTemplate(state.session, site);
    refreshMyReports(state.session);
    refreshStorage();
  }

  /* ---------------- 초대 링크 → 내 계약서 바로 열기 ---------------- */

  /** 대표가 보낸(서명 대기) 계약서가 있으면 그 계약서 창을 엽니다. */
  async function openMySentContract(session) {
    const accountId = (session && session.accountId) || (state.session && state.session.accountId);
    if (!accountId) return false;
    const rows = await store.listStaffContracts({ accountId }, { actor: session });
    const target = rows.find((row) => row.status === 'sent' && !row.signature);
    if (!target) return false;
    await openStaffContractSheet(target.id, { role: 'staff', onChanged: render });
    return true;
  }

  /** #invite=S-… 링크로 들어온 경우, 한 번만 계약서 창을 자동으로 엽니다. */
  function openInviteContractOnce(session) {
    const invite = peekPendingInvite();
    if (!invite || inviteKind(invite) !== 'staff' || inviteOpened === invite) return;
    inviteOpened = invite;
    clearPendingInvite();
    state.leaderTab = 'contracts';
    setTimeout(() => {
      openMySentContract(session).then((opened) => {
        if (!opened) render();
      });
    }, 0);
  }

  /* ---------------- photos ---------------- */

  async function addFiles(groupKey, files) {
    const draft = state.draft;
    if (!draft || !files || !files.length) return;
    const group = PHOTO_GROUPS.find((row) => row.key === groupKey) || { label: '사진' };
    const max = Number(group.max) || 0;
    let list = Array.from(files);
    if (max) {
      const remaining = Math.max(0, max - draft.photos[groupKey].length);
      if (!remaining) {
        toast(`${group.label} 사진은 최대 ${max}장까지 올릴 수 있습니다.`, { tone: 'error' });
        return;
      }
      if (list.length > remaining) {
        toast(`최대 ${max}장이라 ${remaining}장만 추가합니다.`, { tone: 'error' });
        list = list.slice(0, remaining);
      }
    }
    let failed = 0;

    for (let index = 0; index < list.length; index += 1) {
      toast(`사진 처리 중… (${index + 1}/${list.length})`, { duration: 1200 });
      try {
        const prepared = await preparePhoto(list[index]);
        draft.photos[groupKey].push({ tempId: uid('tmp'), ...prepared });
        refreshPhotos(groupKey);
      } catch (error) {
        failed += 1;
        console.warn('[leader] photo failed', error);
      }
    }

    if (failed) toast(`${failed}장은 처리하지 못했습니다. 다른 사진으로 시도해 주세요.`, { tone: 'error' });
    else toast(`사진 ${list.length}장을 추가했습니다.`);
  }

  async function addSamplePhoto(groupKey) {
    const draft = state.draft;
    if (!draft) return;
    const group = PHOTO_GROUPS.find((row) => row.key === groupKey) || {};
    const max = Number(group.max) || 0;
    if (max && draft.photos[groupKey].length >= max) {
      toast(`${group.label} 사진은 최대 ${max}장까지 올릴 수 있습니다.`, { tone: 'error' });
      return;
    }
    const site = await store.getSiteFor(state.session, state.siteId);
    const category = site ? site.category : 'office';
    const pool =
      groupKey === 'cleaning'
        ? SAMPLE_POOL.cleaning[category] || SAMPLE_POOL.cleaning.office
        : SAMPLE_POOL[groupKey] || SAMPLE_POOL.issue;
    const [name, caption] = pool[sampleCursor[groupKey] % pool.length];
    sampleCursor[groupKey] += 1;

    try {
      const prepared = await prepareSamplePhoto(`assets/samples/${name}.jpg`);
      draft.photos[groupKey].push({ tempId: uid('tmp'), ...prepared, caption });
      refreshPhotos(groupKey);
      toast('샘플 사진을 추가했습니다.');
    } catch (error) {
      const fallback = makePlaceholderPhoto({
        title: PHOTO_GROUPS.find((group) => group.key === groupKey)?.label || '현장 사진',
        subtitle: site ? site.name : '',
      });
      draft.photos[groupKey].push({ tempId: uid('tmp'), ...fallback, caption: '데모 이미지' });
      refreshPhotos(groupKey);
      toast('네트워크가 없어 데모 이미지로 대체했습니다.');
    }
  }

  function removePhoto(groupKey, tempId) {
    const draft = state.draft;
    if (!draft) return;
    draft.photos[groupKey] = draft.photos[groupKey].filter((photo) => photo.tempId !== tempId);
    refreshPhotos(groupKey);
  }

  /* ---------------- submit ---------------- */

  async function submitReport(button) {
    const draft = state.draft;
    const session = state.session;
    if (!draft || !session || state.busy) return;

    // 수정 요청 보완에서는 기존 사진이 그대로 남으므로 새 사진이 없어도 됩니다.
    const kept = state.existingPhotos || emptyPhotos();
    if (!draft.photos.security.length && !(kept.security || []).length) {
      toast('시건장치 확인 사진을 1장 이상 추가해 주세요.', { tone: 'error' });
      return;
    }
    if (!draft.photos.cleaning.length && !(kept.cleaning || []).length) {
      toast('업장별 맞춤 청소 사진을 1장 이상 추가해 주세요.', { tone: 'error' });
      return;
    }
    if (!draft.date) {
      toast('방문 날짜를 입력해 주세요.', { tone: 'error' });
      return;
    }
    const site = await store.getSiteFor(state.session, state.siteId);
    if (!site) {
      toast('현장 정보를 찾을 수 없습니다.', { tone: 'error' });
      return;
    }

    const manual = manualDays(site).length > 0;
    const manualDayInfo = manual ? manualItems(site, draft.manualDay) : { day: null, items: [] };
    const checkRows = manual
      ? manualDayInfo.items.map((item) => ({
          label: item.area ? `${item.area} · ${item.label}` : item.label,
          done: !!draft.manual[item.id],
        }))
      : site.checklist.map((label, index) => ({ label, done: !!draft.checks[index] }));

    if (!checkRows.some((row) => row.done)) {
      toast(manual ? '완료한 작업을 1개 이상 체크해 주세요.' : '완료한 점검 항목을 1개 이상 선택해 주세요.', {
        tone: 'error',
      });
      return;
    }

    state.busy = true;
    setBusy(button, true, '등록 중…');

    try {
      const photoRefs = emptyPhotos();
      for (const group of PHOTO_GROUPS) {
        for (const photo of draft.photos[group.key]) {
          const ref = await store.savePhoto({
            dataUrl: photo.dataUrl,
            thumb: photo.thumb,
            width: photo.width,
            height: photo.height,
            caption: photo.caption || '',
          });
          photoRefs[group.key].push(ref);
        }
      }

      const revisionId = state.editingReportId;
      const report = revisionId
        ? await store.resubmitReport(
            revisionId,
            {
              by: draft.leader,
              checklist: checkRows,
              note: draft.note,
              issueNote: draft.issueNote,
              durationMin: draft.duration,
              photos: photoRefs,
            },
            { actor: session },
          )
        : await store.addReport({
            siteId: site.id,
            date: draft.date,
            time: draft.time,
            leader: draft.leader,
            leaderRole: draft.leaderRole,
            // 로그인한 계정을 그대로 연결해 보고서 → 팀장 계약 → 업장이 이어집니다.
            accountId: session.accountId || '',
            durationMin: draft.duration,
            checklist: checkRows,
            note: draft.note,
            issueNote: draft.issueNote,
            manualDay: manual && manualDayInfo.day ? manualDayInfo.day.label : '',
            manualTime: manual && site.manual ? site.manual.time || '' : '',
            photos: photoRefs,
          });

      state.sent = {
        id: report.id,
        siteId: site.id,
        siteCode: site.code,
        siteName: site.name,
        reportNo: reportNoOf(report),
        date: report.date,
        time: report.time,
        photos: report.photos,
        doneCount: report.checklist.filter((item) => item.done).length,
        totalCount: report.checklist.length,
        revised: !!revisionId,
      };

      state.editingReportId = '';
      state.editingReport = null;
      state.existingPhotos = null;
      startDraft(session, site);
      await render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      toast(
        revisionId
          ? '보완한 보고를 다시 제출했습니다. 대표 확인 후 고객사에 제출됩니다.'
          : '보고를 등록했습니다. 최고관리자(대표) 확인 후 고객사에 제출됩니다.',
      );
    } catch (error) {
      console.error('[leader] submit failed', error);
      const message =
        error instanceof StoreError
          ? error.message
          : '보고를 저장하지 못했습니다. 저장 공간을 확인한 뒤 다시 시도해 주세요.';
      toast(message, { tone: 'error', duration: 6000 });
    } finally {
      state.busy = false;
      setBusy(button, false);
    }
  }

  function goToCustomer() {
    document.dispatchEvent(
      new CustomEvent('kec:navigate', { detail: { tab: 'customer', siteCode: state.sent?.siteCode || '' } }),
    );
  }

  /* ---------------- events ---------------- */

  function fillStaffFields(value) {
    const [phone, password, code] = String(value).split('|');
    const phoneInput = $('#l-phone', container);
    const passwordInput = $('#l-password', container);
    const codeInput = $('#l-code', container);
    if (phoneInput) phoneInput.value = phone;
    if (passwordInput) passwordInput.value = password;
    if (codeInput) codeInput.value = code;
    if (phoneInput) phoneInput.focus({ preventScroll: true });
  }

  async function onSubmit(event) {
    if (event.target.matches('[data-visit-manual-form]')) {
      event.preventDefault();
      await submitVisitException(event.target);
      return;
    }
    if (event.target.id === 'supply-request-form') {
      event.preventDefault();
      if (!state.session) return;
      await submitSupplyRequest(state.session, container, { onDone: render });
      return;
    }
    if (event.target.id === 'staff-invite-form') {
      event.preventDefault();
      state.staffError = '';
      const byInviteLink = !!peekPendingInvite();
      try {
        const session = await loginStaffInvite({
          phone: $('#si-phone', container)?.value || '',
          code: $('#si-code', container)?.value || '',
        });
        clearPendingInvite();
        if (byInviteLink) state.leaderTab = 'contracts';
        toast(`${session.name} ${session.title || '팀장'}님, 직원관리방에 입장했습니다.`);
        await render();
        if (byInviteLink) await openMySentContract(session);
      } catch (error) {
        state.staffError = error.message || '직원관리방 입장에 실패했습니다.';
        await render();
      }
      return;
    }

    if (event.target.id !== 'leader-login') return;
    event.preventDefault();
    state.loginError = '';
    try {
      const session = await loginStaff({
        phone: $('#l-phone', container)?.value || '',
        password: $('#l-password', container)?.value || '',
        leaderCode: $('#l-code', container)?.value || '',
      });
      toast(`${session.name} ${session.title || '팀장'}님, 입장했습니다.`);
      await render();
    } catch (error) {
      state.loginError = error.message || '로그인에 실패했습니다.';
      await render();
      const phoneInput = $('#l-phone', container);
      if (phoneInput) phoneInput.focus();
    }
  }

  async function onChange(event) {
    const target = event.target;
    const draft = state.draft;

    const issuePhoto = target.closest('[data-issue-photo-input]');
    if (issuePhoto) {
      const files = Array.from(issuePhoto.files || []);
      issuePhoto.value = '';
      await addIssuePhoto(files);
      return;
    }

    const photoInput = target.closest('[data-photo-input]');
    if (photoInput) {
      const files = Array.from(photoInput.files || []);
      photoInput.value = '';
      await addFiles(photoInput.dataset.photoInput, files);
      return;
    }

    if (!draft) return;
    const manualCheck = target.closest('[data-manual-check]');
    if (manualCheck) {
      draft.manual[manualCheck.dataset.manualCheck] = manualCheck.checked;
      refreshManualProgress();
      return;
    }
    if (target.matches('[data-check]')) {
      draft.checks[Number(target.dataset.check)] = target.checked;
      refreshChecks();
      return;
    }
    if (target.id === 'r-date') draft.date = target.value || toISODate();
    if (target.id === 'r-time') draft.time = target.value || nowHHMM();
    if (target.id === 'r-duration') {
      draft.duration = Number(target.value) || 90;
      draft.durationTouched = true;
    }
    if (target.id === 'r-note') draft.note = target.value;
    if (target.id === 'r-issue-note') draft.issueNote = target.value;
  }

  function onInput(event) {
    const supplyQty = event.target.closest('[data-supply-qty]');
    if (supplyQty) {
      refreshSupplyTotal(supplyQty.closest('form') || container);
      return;
    }
    const target = event.target;
    // 7단계 — 특이사항 직접 등록 입력값 (사진을 넣어 다시 그려도 글이 남게)
    if (target.id === 'issue-note') {
      state.issueDraft = { ...(state.issueDraft || { photos: [] }), note: target.value };
      return;
    }
    const draft = state.draft;
    if (!draft) return;
    if (target.id === 'r-note') draft.note = target.value;
    if (target.id === 'r-issue-note') draft.issueNote = target.value;
    if (target.id === 'r-date' && target.value) draft.date = target.value;
    if (target.id === 'r-time' && target.value) draft.time = target.value;
    if (target.id === 'r-duration') {
      draft.duration = Number(target.value) || 90;
      draft.durationTouched = true;
    }
  }

  async function onClick(event) {
    /* -------- 7단계 — 특이사항 등록 -------- */
    const issueSubmit = event.target.closest('[data-issue-submit]');
    if (issueSubmit) {
      await submitIssue(issueSubmit.dataset.issueSubmit, issueSubmit);
      return;
    }
    const issueClear = event.target.closest('[data-issue-clear]');
    if (issueClear) {
      state.issueDraft = { note: '', photos: [] };
      await render();
      return;
    }

    /* -------- 5단계 — 현장 도착(GPS) · 청소 완료 · 예외 기록 -------- */
    const arriveButton = event.target.closest('[data-visit-arrive]');
    if (arriveButton) {
      const siteId = arriveButton.dataset.visitArrive;
      const entry = scheduleEntryOfDate(siteId, toISODate());
      if (entry && entry.arrive) {
        const ok = await confirmDialog({
          title: '시작 시간을 다시 기록할까요?',
          message: `이미 시작 ${fmtTime(entry.actualStart)}으로 등록되어 있습니다.\n지금 시각으로 다시 기록하면 청소 시작 시간이 바뀌고 소요 시간도 다시 계산됩니다.`,
          confirmLabel: '다시 기록',
        });
        if (!ok) return;
      }
      await recordVisitAtSite(siteId, 'arrive');
      return;
    }
    const redoDone = event.target.closest('[data-visit-redo-done]');
    if (redoDone) {
      const siteId = redoDone.dataset.visitRedoDone;
      const entry = scheduleEntryOfDate(siteId, toISODate());
      const ok = await confirmDialog({
        title: '완료 시간을 다시 기록할까요?',
        message: `이미 종료 ${fmtTime(entry && entry.actualEnd)}로 등록되어 있습니다.\n지금 시각으로 다시 기록하면 종료 시간과 소요 시간이 바뀝니다.`,
        confirmLabel: '다시 기록',
      });
      if (!ok) return;
      await recordVisitAtSite(siteId, 'done');
      return;
    }
    const doneButton = event.target.closest('[data-visit-done]');
    if (doneButton) {
      await recordVisitAtSite(doneButton.dataset.visitDone, 'done');
      return;
    }
    const scheduleMonth = event.target.closest('[data-schedule-month]');
    if (scheduleMonth) {
      const delta = scheduleMonth.dataset.scheduleMonth === 'prev' ? -1 : 1;
      state.scheduleMonth = shiftMonthKey(state.scheduleMonth || monthKeyOf(), delta);
      state.calendarDate = '';
      await render();
      return;
    }
    const scheduleView = event.target.closest('[data-schedule-view]');
    if (scheduleView) {
      state.scheduleView = scheduleView.dataset.scheduleView === 'grid' ? 'grid' : 'list';
      await render();
      return;
    }
    const calDate = event.target.closest('[data-cal-date]');
    if (calDate) {
      state.calendarDate = calDate.dataset.calDate || '';
      await render();
      return;
    }
    // 현장 기록으로 계산한 소요 시간을 보고서 칸에 그대로 채웁니다.
    const fillDuration = event.target.closest('[data-fill-duration]');
    if (fillDuration && state.draft) {
      const minutes = Number(fillDuration.dataset.fillDuration) || 0;
      if (minutes > 0) {
        state.draft.duration = minutes;
        state.draft.durationTouched = true;
        const input = $('#r-duration', container);
        if (input) input.value = String(minutes);
        toast(`소요 시간을 ${durationText(minutes)}로 채웠습니다.`, { duration: 4000 });
      }
      return;
    }
    const visitCancel = event.target.closest('[data-visit-cancel]');
    if (visitCancel) {
      state.visitForm = { siteId: '', kind: 'arrive', reason: 'indoor', note: '', error: '' };
      await render();
      return;
    }

    const baselineOpen = event.target.closest('[data-baseline-open]');
    if (baselineOpen) {
      await openBaselineSheet(baselineOpen.dataset.baselineOpen, { onChanged: render });
      return;
    }

    const manualDay = event.target.closest('[data-manual-day]');
    if (manualDay) {
      await switchManualDay(manualDay.dataset.manualDay);
      return;
    }

    const leaderTab = event.target.closest('[data-leader-tab]');
    if (leaderTab) {
      state.leaderTab = leaderTab.dataset.leaderTab;
      await render();
      return;
    }

    const viewReceipt = event.target.closest('[data-supply-view]');
    if (viewReceipt) {
      await openSupplyReceipt(viewReceipt.dataset.supplyView);
      return;
    }

    const fillStaffCode = event.target.closest('[data-fill-staff-code]');
    if (fillStaffCode) {
      const [phone, code] = fillStaffCode.dataset.fillStaffCode.split('|');
      const phoneInput = $('#si-phone', container);
      const codeInput = $('#si-code', container);
      if (phoneInput) phoneInput.value = phone;
      if (codeInput) codeInput.value = code;
      return;
    }

    const openStaffContract = event.target.closest('[data-open-staff-contract]');
    if (openStaffContract) {
      await openStaffContractSheet(openStaffContract.dataset.openStaffContract, {
        role: 'staff',
        onChanged: render,
      });
      return;
    }

    /* -------- 4단계 — 배정 수락 / 거절 / 출입 비밀번호 열람 -------- */
    const acceptAssignment = event.target.closest('[data-assign-accept]');
    if (acceptAssignment) {
      const id = acceptAssignment.dataset.assignAccept;
      const row = (state.assignments || []).find((item) => item.id === id);
      const ok = await confirmDialog({
        title: '배정을 수락할까요?',
        message: `${row ? `${row.site.name} · 도급 ${wonText(row.amount)} · ${row.payDay || '15'}일 지급` : '배정 요청'}\n수락하면 이 내용으로 팀장 도급계약서가 만들어집니다. 서명을 마치면 담당 팀장으로 확정됩니다.`,
        confirmLabel: '수락',
      });
      if (!ok) return;
      setBusy(acceptAssignment, true, '수락 중…');
      try {
        const result = await store.acceptSiteAssignment(id, { actor: state.session });
        await render();
        toast(`배정을 수락했습니다. 도급계약서 ${result.contract.no}가 만들어졌습니다. 확인 후 서명해 주세요.`, {
          duration: 9000,
        });
        await openStaffContractSheet(result.contract.id, { role: 'staff', onChanged: render });
      } catch (error) {
        toast(error.message || '배정을 수락하지 못했습니다.', { tone: 'error' });
      } finally {
        setBusy(acceptAssignment, false);
      }
      return;
    }

    const rejectAssignment = event.target.closest('[data-assign-reject]');
    if (rejectAssignment) {
      const id = rejectAssignment.dataset.assignReject;
      const codeInput = $(`[data-assign-code="${id}"]`, container);
      const reasonInput = $(`[data-assign-reason="${id}"]`, container);
      const code = codeInput ? codeInput.value : 'etc';
      const reason = reasonInput ? reasonInput.value.trim() : '';
      const ok = await confirmDialog({
        title: '배정을 거절할까요?',
        message: '거절 사유가 대표에게 전달됩니다. 대표는 다른 팀장에게 바로 다시 배정할 수 있습니다.',
        confirmLabel: '거절',
        tone: 'danger',
      });
      if (!ok) return;
      setBusy(rejectAssignment, true, '보내는 중…');
      try {
        await store.rejectSiteAssignment(id, { code, reason }, { actor: state.session });
        await render();
        toast('배정을 거절했습니다.');
      } catch (error) {
        toast(error.message || '배정을 거절하지 못했습니다.', { tone: 'error' });
      } finally {
        setBusy(rejectAssignment, false);
      }
      return;
    }

    const revealSecret = event.target.closest('[data-reveal-secret]');
    if (revealSecret) {
      const siteId = revealSecret.dataset.revealSecret;
      try {
        const secret = await store.revealSiteSecret(siteId, { actor: state.session });
        const box = revealSecret.closest('[data-site-secret]');
        const value = box ? $('[data-secret-value]', box) : null;
        if (value) {
          value.textContent = secret.doorCode || '미등록';
          value.dataset.secretRevealed = 'true';
        }
        const note = box ? $('[data-secret-note]', box) : null;
        if (note) note.textContent = '열람 기록이 남았습니다 · 화면을 나가면 다시 가려집니다';
        if (revealSecret.parentNode) revealSecret.remove();
      } catch (error) {
        toast(error.message || '출입 비밀번호를 열 수 없습니다.', { tone: 'error' });
      }
      return;
    }

    const fill = event.target.closest('[data-fill-staff]');
    if (fill) {
      fillStaffFields(fill.dataset.fillStaff);
      return;
    }

    const pickLead = event.target.closest('[data-pick-lead]');
    if (pickLead) {
      state.teamLeadId = pickLead.dataset.pickLead;
      state.siteId = null;
      state.draft = null;
      await render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const leadBack = event.target.closest('[data-lead-back]');
    if (leadBack) {
      state.teamLeadId = '';
      await render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const teamContract = event.target.closest('[data-team-contract]');
    if (teamContract) {
      await openStaffContractSheet(teamContract.dataset.teamContract, { role: 'admin', onChanged: render });
      return;
    }

    const pick = event.target.closest('[data-pick-site]');
    if (pick) {
      closeBaselineSheet();
      state.siteId = pick.dataset.pickSite;
      state.sent = null;
      state.editingReportId = '';
      state.editingReport = null;
      state.existingPhotos = null;
      state.issueDraft = { note: '', photos: [] };
      const site = await store.getSiteFor(state.session, state.siteId);
      if (site && state.session) startDraft(state.session, site);
      await render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // 6단계 — 수정 요청 보완 · 보고서 상세(인쇄 / PDF)
    const reviseStart = event.target.closest('[data-revise-start]');
    if (reviseStart) {
      await startRevision(reviseStart.dataset.reviseStart);
      return;
    }
    const revisionCancel = event.target.closest('[data-revision-cancel]');
    if (revisionCancel) {
      await cancelRevision();
      return;
    }
    const reportDetail = event.target.closest('[data-report-detail]');
    if (reportDetail) {
      await openReportSheet(reportDetail.dataset.reportDetail, { actor: state.session });
      return;
    }

    const remove = event.target.closest('[data-remove-photo]');
    if (remove) {
      removePhoto(remove.dataset.group, remove.dataset.removePhoto);
      return;
    }

    const workMode = event.target.closest('[data-work-mode]');
    if (workMode) {
      const mode = workMode.dataset.workMode === 'staff' ? 'staff' : 'admin';
      if (mode === getWorkMode()) return;
      setWorkMode(mode);
      state.siteId = null;
      state.draft = null;
      state.teamLeadId = '';
      if (mode === 'admin') {
        document.dispatchEvent(new CustomEvent('kec:navigate', { detail: { tab: 'admin' } }));
        toast('관리자 모드로 전환했습니다.');
      } else {
        toast('직원 모드로 전환했습니다. 팀장처럼 현장을 골라 보고서를 쓸 수 있습니다.');
        await render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }

    const memo = event.target.closest('[data-memo]');
    if (memo) {
      const draft = state.draft;
      if (!draft) return;
      const chip = memo.dataset.memo;
      draft.note = addMemoChip(draft.note, chip);
      const note = $('#r-note', container);
      if (note) {
        note.value = draft.note;
        note.scrollTop = note.scrollHeight;
      }
      $$('[data-memo]', container).forEach((button) => {
        const on = memoHasChip(draft.note, button.dataset.memo);
        button.classList.toggle('is-on', on);
        button.setAttribute('aria-pressed', String(on));
      });
      return;
    }

    const deleteButton = event.target.closest('[data-delete-report]');
    if (deleteButton) {
      const ok = await confirmDialog({
        title: '보고를 삭제할까요?',
        message: '이 기기에 저장된 보고와 사진이 함께 삭제됩니다. 고객 방에서도 사라집니다.',
        confirmLabel: '삭제',
        tone: 'danger',
      });
      if (!ok) return;
      await store.deleteReport(deleteButton.dataset.deleteReport, { actor: state.session });
      if (state.sent && state.sent.id === deleteButton.dataset.deleteReport) state.sent = null;
      toast('보고를 삭제했습니다.');
      if (state.session) await refreshMyReports(state.session);
      return;
    }

    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;

    if (action === 'go-admin') {
      document.dispatchEvent(new CustomEvent('kec:navigate', { detail: { tab: 'admin' } }));
      return;
    }
    if (action === 'logout') {
      await logout();
      state.session = null;
      state.siteId = null;
      state.draft = null;
      state.sent = null;
      state.teamLeadId = '';
      await render();
      toast('로그아웃했습니다.');
      return;
    }
    if (action === 'change-site') {
      closeBaselineSheet();
      state.siteId = null;
      state.draft = null;
      state.editingReportId = '';
      state.editingReport = null;
      state.existingPhotos = null;
      await render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (action === 'add-sample') {
      await addSamplePhoto('cleaning');
      return;
    }
    if (action === 'check-all') {
      const draft = state.draft;
      if (!draft) return;
      const allOn = draft.checks.every(Boolean);
      draft.checks = draft.checks.map(() => !allOn);
      $$('[data-check]', container).forEach((input) => {
        input.checked = !allOn;
      });
      refreshChecks();
      return;
    }
    if (action === 'submit-report') {
      await submitReport(event.target.closest('[data-action]'));
      return;
    }
    if (action === 'view-customer') {
      goToCustomer();
      return;
    }
    if (action === 'dismiss-sent') {
      state.sent = null;
      await render();
      return;
    }
    if (action === 'reset-demo') {
      const ok = await confirmDialog({
        title: '데모 데이터를 초기화할까요?',
        message: '이 기기의 모든 계정·현장·보고·코드가 샘플 상태로 돌아갑니다. 로그인도 해제됩니다.',
        confirmLabel: '초기화',
        tone: 'danger',
      });
      if (!ok) return;
      await store.resetDemo({ actor: state.session });
      await logout();
      state.siteId = null;
      state.draft = null;
      state.sent = null;
      await render();
      toast('데모 데이터를 초기화했습니다.');
    }
  }

  /** Sample-photo buttons live outside the click handler's action list. */
  async function onSampleClick(event) {
    const button = event.target.closest('[data-sample-group]');
    if (!button) return;
    await addSamplePhoto(button.dataset.sampleGroup);
  }

  function mount() {
    if (mounted) return;
    container.addEventListener('submit', onSubmit);
    container.addEventListener('change', onChange);
    container.addEventListener('input', onInput);
    container.addEventListener('click', (event) => {
      onSampleClick(event);
      onClick(event);
    });
    mounted = true;
  }

  /** Deep-link API for tests / future links: open the report form for one site. */
  async function openSite(siteId) {
    const session = await getSession();
    if (!session || (session.role !== 'leader' && session.role !== 'admin')) return false;
    // 딥링크로도 배정되지 않은 남의 업장은 열리지 않습니다(v2.8.2).
    const site = await store.getSiteFor(session, siteId);
    if (!site) return false;
    state.session = session;
    state.siteId = site.id;
    state.sent = null;
    startDraft(session, site);
    await render();
    return true;
  }

  return { render, openSite };
}
