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
import {
  store,
  StoreError,
  countReportPhotos,
  STAFF_STATUS,
  reportStatus,
  canUseSupply,
  MAX_BASELINE_PHOTOS,
} from '../store.js';
import { CATEGORY_META, PHOTO_GROUPS, STAFF_TYPES } from '../seed.js';
import { getSession, loginStaff, loginStaffInvite, logout, demoAccounts, demoStaffCodes, getWorkMode, setWorkMode } from '../auth.js';
import { preparePhoto, prepareSamplePhoto, makePlaceholderPhoto, dataUrlBytes } from '../photos.js';
import { openStaffContractSheet } from './quote-contract.js';
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
    myChecks: [],
    leaderTab: 'sites',
    // 관리자(대표·부관리자) 화면 — 팀장 목록 → 그 팀장의 관리업장
    managerMode: false,
    renderedMode: '',
    teamLeads: [],
    teamContracts: [],
    teamLeadId: '',
    siteStaff: [],
    staffCodes: [],
    supplyOrders: [],
    supplyCatalog: [],
    supplyRequestOpen: true,
    busy: false,
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

  /* ---------------- login ---------------- */

  function demoPanelTemplate() {
    const rows = demoAccounts().filter((row) => row.role !== 'customer');
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
                 placeholder="팀장 고유코드 (예: TL-4821)" aria-label="팀장 고유코드" maxlength="12">
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
    const tabs = [
      { key: 'sites', label: '관리업장' },
      { key: 'contracts', label: '계약서' },
      { key: 'attitude', label: '근무태도' },
    ];
    // 청소장비 · 봉투는 구입 당사자 직원만 봅니다. 부관리자(본부장) 화면에는 나오지 않습니다.
    if (session && session.role === 'leader' && canUseSupply(session)) {
      tabs.push({ key: 'supply', label: '장비 · 봉투' });
    }
    return `
      <nav class="room-tabs" aria-label="내 직원 방">
        ${tabs
          .map(
            (tab) => `<button class="room-tab" type="button" data-leader-tab="${tab.key}"
              aria-pressed="${active === tab.key}">${esc(tab.label)}</button>`,
          )
          .join('')}
      </nav>`;
  }

  function attitudeTemplate(checks) {
    const latest = checks[0];
    return `
      <section class="panel" data-my-attitude>
        <div class="section-head">
          <h2>근무태도</h2>
          <p>본부장 체크 · A &gt; B &gt; C &gt; D &gt; E &gt; F</p>
        </div>
        <div class="grade-scale">
          ${['A', 'B', 'C', 'D', 'E', 'F'].map((grade) => `<span class="grade grade--${grade}">${grade}</span>`).join('')}
        </div>
        ${
          latest
            ? `<p class="attitude-latest">최근 등급 <span class="grade grade--${esc(latest.grade)}">${esc(latest.grade)}</span> <span class="tiny muted">${esc(latest.date)} · ${esc(latest.reviewerName || '본부장')}</span></p>`
            : '<p class="tiny muted">아직 등록된 근무태도 체크가 없습니다.</p>'
        }
        ${
          checks.length
            ? `<ul class="check-history">${checks
                .map(
                  (row) =>
                    `<li><span class="grade grade--${esc(row.grade)}">${esc(row.grade)}</span><div><strong>${esc(row.date)}</strong><span>${esc(row.memo || '메모 없음')}</span></div></li>`,
                )
                .join('')}</ul>`
            : ''
        }
      </section>`;
  }

  /* ---------------- 관리팀장별 관리업장 (대표 · 부관리자) ---------------- */

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
            <span class="pick__right">${badge}<span class="site-item__code">담당 ${esc(site.manager)}</span></span>
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
          : tab === 'attitude'
            ? attitudeTemplate(state.myChecks)
            : tab === 'supply'
              ? supplyStaffPanel({
                  catalog: state.supplyCatalog,
                  orders: state.supplyOrders,
                  session,
                  state: { supply: { open: state.supplyRequestOpen } },
                })
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
      ${settingsTemplate()}
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
    const label = group.key === 'cleaning'
      ? `${CATEGORY_META[site.category]?.cleaningLabel || group.label} 사진`
      : `${group.label} 사진`;
    const required = group.required;
    const max = Number(group.max) || 0;
    const full = max > 0 && photos.length >= max;

    return `
      <section class="panel photo-panel photo-panel--${group.key}">
        <div class="section-head">
          <h2><span class="step-badge">${index + 1}</span>${esc(label)} ${required ? '<span class="req">*</span>' : '<span class="opt">선택</span>'}</h2>
          <p><span data-photo-count="${group.key}">${photos.length}</span>${max ? `/${max}` : ''}장</p>
        </div>
        <p class="tiny muted" style="margin:-6px 0 10px">${esc(group.hint)}${max ? ` · 최대 ${max}장` : ''}</p>
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

  function opsCardTemplate(site) {
    const ops = site.ops || {};
    const value = (text) => (text ? esc(text) : '<span class="ops-empty">미등록 · 관리자에게 확인</span>');

    return `
      <section class="panel ops-card" data-ops-card="${esc(site.id)}">
        <div class="section-head">
          <h2>현장 운영 정보</h2>
          <p>현장 필수 정보</p>
        </div>
        <p class="tiny muted" style="margin:-6px 0 10px">
          이 현장에서 바로 확인하는 정보입니다. 청소 공정·출입·쓰레기·주차를 확인하세요.
        </p>
        <dl class="kv kv--left ops-list">
          <dt>청소 공정</dt>
          <dd data-ops-field="process">${value(ops.process)}</dd>
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
        ${state.staffCodes.length
          ? `<details class="demo-panel" style="margin-top:10px">
               <summary>미사용 직원 초대코드 보기</summary>
               <div class="demo-panel__body">
                 ${state.staffCodes
                   .map(
                     (row) => `<div class="demo-row">
                        <div><strong>${esc(row.name)} · ${esc(row.typeLabel)}</strong><span>${esc(row.phone)} · ${esc(row.code)}</span></div>
                        <button class="link-btn" type="button" data-fill-staff-code="${esc(row.phone)}|${esc(row.code)}">입력</button>
                      </div>`,
                   )
                   .join('')}
               </div>
             </details>`
          : ''}
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

    return `
      ${leaderBarTemplate(session)}
      ${state.sent ? sentTemplate(state.sent) : ''}

      ${hasManual ? '' : opsCardTemplate(site)}

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

      <p class="tiny muted" style="text-align:center;margin:4px 0 8px">
        등록한 보고는 <strong>최고관리자(대표) 확인</strong>을 거쳐 고객사에 제출됩니다.
      </p>

      <div class="submit-bar">
        <button class="btn btn--primary" type="button" data-action="submit-report">보고 등록하기</button>
      </div>

      <section class="panel">
        <div class="section-head">
          <h2>최근 제출한 보고</h2>
          <p id="my-report-count"></p>
        </div>
        <div id="my-reports"><p class="tiny muted">불러오는 중…</p></div>
      </section>

      ${settingsTemplate()}
    `;
  }

  function sentTemplate(sent) {
    return `
      <section class="sent-card">
        <span class="sent-card__icon">${icons.check}</span>
        <div>
          <strong>보고를 등록했습니다 · 관리자 확인 대기</strong>
          <p>${esc(sent.siteName)} · ${esc(fmtDateLong(sent.date))} ${esc(fmtTime(sent.time))}<br>
          시건장치 ${sent.photos.security.length}장 · 맞춤 청소 ${sent.photos.cleaning.length}장 · 특이사항 ${sent.photos.issue.length}장 ·
          점검 ${sent.doneCount}/${sent.totalCount}</p>
          <p class="sent-card__hint">최고관리자(대표)가 확인해 고객사에 제출하면 그때 고객 방에 보입니다.</p>
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

  function settingsTemplate() {
    return `
      <details class="settings">
        <summary>저장 공간 · 데모 설정</summary>
        <div class="settings__body">
          <dl class="kv" id="storage-info">
            <dt>저장 방식</dt><dd>${esc(store.adapterName === 'indexeddb' ? 'IndexedDB (이 기기)' : store.adapterName === 'memory' ? '메모리 (임시)' : 'localStorage (이 기기)')}</dd>
            <dt>사용량</dt><dd id="storage-usage">계산 중…</dd>
          </dl>
          <div class="btn-row btn-row--stack">
            <button class="btn btn--quiet btn--sm" type="button" data-action="reset-demo">데모 데이터 초기화</button>
            <button class="btn btn--quiet btn--sm" type="button" data-action="logout">로그아웃</button>
          </div>
          <p class="hint">
            초기화하면 이 기기의 모든 계정·보고·코드가 샘플 상태로 되돌아갑니다.
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
    const site = await store.getSite(state.siteId);
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
    const rows = await store.listReports({ leader: session.name, limit: 6 });
    const count = $('#my-report-count', container);
    if (count) count.textContent = rows.length ? `${rows.length}건` : '';
    if (!rows.length) {
      box.innerHTML = '<p class="tiny muted">아직 제출한 보고가 없습니다.</p>';
      return;
    }
    const sites = await store.listSites();
    const names = new Map(sites.map((site) => [site.id, site.name]));
    box.innerHTML = rows
      .map(
        (report) => {
          const status = reportStatus(report);
          return `
          <div class="my-report">
            <div>
              <strong>${esc(names.get(report.siteId) || report.siteName)}</strong>
              <span>${esc(fmtDateLong(report.date))} ${esc(fmtTime(report.time))} · 사진 ${countReportPhotos(report)}장</span>
              <em class="badge ${status.badge} my-report__status">${esc(status.label)}</em>
            </div>
            <button class="link-btn" style="background:var(--surface-3);color:var(--body);border-color:var(--line)"
                    type="button" data-delete-report="${esc(report.id)}">삭제</button>
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

  async function refreshWeekSummary() {
    const box = $('#week-summary', container);
    if (!box) return;
    const reports = await store.listReports({});
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
    if (options && options.tab && ['sites', 'contracts', 'attitude', 'supply'].includes(options.tab)) {
      state.leaderTab = options.tab;
    }
    const session = await getSession();
    state.session = session && (session.role === 'leader' || session.role === 'admin') ? session : null;

    if (!state.session) {
      state.siteId = null;
      state.draft = null;
      state.myContracts = [];
      state.myChecks = [];
      state.leaderTab = 'sites';
      state.siteStaff = [];
      state.supplyCatalog = [];
      state.supplyOrders = [];
      state.managerMode = false;
      state.renderedMode = '';
      state.teamLeads = [];
      state.teamContracts = [];
      state.teamLeadId = '';
      state.staffCodes = await demoStaffCodes().catch(() => []);
      closeBaselineSheet();
      container.innerHTML = gateTemplate();
      return;
    }

    const sites = await store.listSites();
    // 대표 · 부관리자 — 관리자 화면: 팀장을 골라 그 팀장의 관리업장을 봅니다.
    const managerRole =
      state.session.role === 'admin' ||
      !!(state.session.account && state.session.account.canManageStaff) ||
      /본부장/.test(state.session.title || '');
    // 최고관리자(대표)는 직원 모드로 바꿔 팀장처럼 보고서를 쓸 수 있습니다.
    const staffMode = managerRole && state.session.role === 'admin' && getWorkMode() === 'staff';
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
      const accounts = await store.listAccounts({ role: 'leader' });
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
      state.teamContracts = await store.listStaffContracts();
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
    state.myContracts = await store.listStaffContracts({ accountId: state.session.accountId });
    state.myChecks = await store.listStaffChecks({ accountId: state.session.accountId });

    // 청소장비 · 봉투: 구입 당사자 직원(부관리자·대표 제외)에게만 열립니다.
    const supplyAllowed = state.session.role === 'leader' && canUseSupply(state.session);
    if (supplyAllowed) {
      state.supplyCatalog = await store.listSupplyCatalog();
      state.supplyOrders = await store.listSupplyOrders({ accountId: state.session.accountId });
    } else {
      state.supplyCatalog = [];
      state.supplyOrders = [];
      if (state.leaderTab === 'supply') state.leaderTab = 'sites';
    }

    if (!state.siteId) {
      state.draft = null;
      container.innerHTML = await sitePickerTemplate(state.session, allowed);
      refreshWeekSummary();
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

    const canManageStaff =
      (state.session.account && state.session.account.canManageStaff) || /본부장/.test(state.session.title || '');
    state.siteStaff = canManageStaff ? await store.listStaffContracts({ siteId: site.id }) : [];

    container.innerHTML = formTemplate(state.session, site);
    refreshMyReports(state.session);
    refreshStorage();
  }

  /* ---------------- 초대 링크 → 내 계약서 바로 열기 ---------------- */

  /** 대표가 보낸(서명 대기) 계약서가 있으면 그 계약서 창을 엽니다. */
  async function openMySentContract(session) {
    const accountId = (session && session.accountId) || (state.session && state.session.accountId);
    if (!accountId) return false;
    const rows = await store.listStaffContracts({ accountId });
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
    const site = await store.getSite(state.siteId);
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

    if (!draft.photos.security.length) {
      toast('시건장치 확인 사진을 1장 이상 추가해 주세요.', { tone: 'error' });
      return;
    }
    if (!draft.photos.cleaning.length) {
      toast('업장별 맞춤 청소 사진을 1장 이상 추가해 주세요.', { tone: 'error' });
      return;
    }
    if (!draft.date) {
      toast('방문 날짜를 입력해 주세요.', { tone: 'error' });
      return;
    }
    const site = await store.getSite(state.siteId);
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

      const report = await store.addReport({
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
        date: report.date,
        time: report.time,
        photos: report.photos,
        doneCount: report.checklist.filter((item) => item.done).length,
        totalCount: report.checklist.length,
      };

      startDraft(session, site);
      await render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      toast('보고를 등록했습니다. 최고관리자(대표) 확인 후 고객사에 제출됩니다.');
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
    if (target.id === 'r-duration') draft.duration = Number(target.value) || 90;
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
    const draft = state.draft;
    if (!draft) return;
    if (target.id === 'r-note') draft.note = target.value;
    if (target.id === 'r-issue-note') draft.issueNote = target.value;
    if (target.id === 'r-date' && target.value) draft.date = target.value;
    if (target.id === 'r-time' && target.value) draft.time = target.value;
    if (target.id === 'r-duration') draft.duration = Number(target.value) || 90;
  }

  async function onClick(event) {
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
      const site = await store.getSite(state.siteId);
      if (site && state.session) startDraft(state.session, site);
      await render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
      await store.deleteReport(deleteButton.dataset.deleteReport);
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
      await store.resetDemo();
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
    const site = await store.getSite(siteId);
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
