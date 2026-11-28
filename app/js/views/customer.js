/**
 * views/customer.js — 청소 확인 (고객용)
 *
 * 입장 흐름: 전화번호 + 비밀번호 → 1회용 청소코드 인증 → 우리 현장 방
 * 방 안에서는 그 고객사 기록만 보입니다 (일자별 청소 완료 보고).
 */

import {
  $,
  esc,
  icons,
  toast,
  confirmDialog,
  fmtDateLong,
  fmtMonthLabel,
  fmtMonthDay,
  fmtTime,
  relDayLabel,
  weekdayShort,
  openLightbox,
  copyText,
  daysBetween,
  toISODate,
  fmtWon,
  localDateOf,
} from '../ui.js';
import { store, countReportPhotos, reportNoOf, QUOTE_STATUS, AGREEMENT_STATUS, isExtraQuote, INVOICE_STATUS, billingMonthLabel, COMPLAINT_TYPES } from '../store.js';
import { CATEGORY_META, PHOTO_GROUPS } from '../seed.js';
import {
  getSession,
  loginCustomer,
  logout,
  hasRoomAccess,
  redeemRoomCode,
  demoRoomCodes,
  demoRegisteredCustomers,
} from '../auth.js';
import { openQuoteSheet, openAgreementSheet } from './quote-contract.js';
import { openReportSheet } from './report-sheet.js';
import { preparePhoto } from '../photos.js';
import { peekPendingInvite, clearPendingInvite, inviteKind, inviteLabel } from '../invite.js';

const FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'month', label: '이번 달' },
  { key: 'photos', label: '사진 포함' },
  { key: 'issue', label: '특이사항' },
];

const GROUP_LABEL = Object.fromEntries(PHOTO_GROUPS.map((group) => [group.key, group.label]));

export function createCustomerView(container) {
  const state = {
    session: null,
    site: null,
    filter: 'all',
    sort: 'desc',
    loginError: '',
    codeError: '',
    category: '',
    previewCode: '',
    roomTab: '',
    // 10단계 — 고객이 보내는 불편 사항(컴플레인) 초안 · 접수 목록
    complaint: { photos: [] },
    complaints: [],
  };
  const reportsById = new Map();
  let mounted = false;
  let renderToken = 0;

  /* ---------------- data ---------------- */

  function filterReports(reports) {
    const monthKey = toISODate().slice(0, 7);
    let rows = reports.slice();
    if (state.filter === 'month') rows = rows.filter((report) => String(report.date).startsWith(monthKey));
    if (state.filter === 'photos') rows = rows.filter((report) => countReportPhotos(report) > 0);
    if (state.filter === 'issue') {
      rows = rows.filter((report) => (report.photos?.issue || []).length > 0 || report.issueNote);
    }
    rows.sort((a, b) => {
      const ka = `${a.date} ${a.time || ''}`;
      const kb = `${b.date} ${b.time || ''}`;
      return state.sort === 'desc' ? kb.localeCompare(ka) : ka.localeCompare(kb);
    });
    return rows;
  }

  const doneCount = (report) => (report.checklist || []).filter((item) => item.done).length;

  /* ---------------- login ---------------- */

  function demoPanelTemplate(registered) {
    const rows = registered || [];
    return `
      <details class="demo-panel">
        <summary>등록된 번호 · 미사용 코드 보기</summary>
        <div class="demo-panel__body">
          <p class="tiny muted">
            이미 등록된 번호는 전화번호만 입력하면 바로 입장합니다. 새 번호는 아래 미사용 1회용 코드를 함께 입력하세요.
          </p>
          ${
            rows.length
              ? rows
                  .map(
                    (row) => `
              <div class="demo-row">
                <div>
                  <strong>${esc(row.name)} ${esc(row.title || '')}</strong>
                  <span>${esc(row.phone)} · ${esc(row.siteName)}${row.siteCode ? ` (${esc(row.siteCode)})` : ''}</span>
                </div>
                <button class="link-btn" type="button" data-fill-phone="${esc(row.phone)}">번호 입력</button>
              </div>`,
                  )
                  .join('')
              : '<p class="tiny muted">아직 등록된 번호가 없습니다.</p>'
          }
          <div id="demo-code-list"><p class="tiny muted">미사용 코드 불러오는 중…</p></div>
        </div>
      </details>
    `;
  }

  function loginTemplate(registered) {
    const invite = peekPendingInvite();
    const inviteCode = invite && inviteKind(invite) !== 'staff' ? invite : '';
    return `
      <section class="panel auth-card">
        <span class="eyebrow">${icons.clipboard} 고객사 전용 방</span>
        <h2>우리 현장 청소 기록</h2>
        ${
          inviteCode
            ? `<div class="invite-banner" data-invite-banner>
                 <strong>초대 링크로 접속하셨습니다 · ${esc(inviteLabel(inviteCode))}</strong>
                 <span>초대코드 <code>${esc(inviteCode)}</code> 가 입력되어 있습니다. 전화번호만 넣고 입장하세요.</span>
               </div>`
            : ''
        }
        <p class="tiny muted">
          <strong>등록된 번호</strong>는 전화번호만 입력하면 바로 입장합니다.
          처음 오신 분(추가 인원 포함)은 대표가 발급한 <strong>1회용 청소코드</strong>를 함께 입력해 주세요.
          코드는 한 번만 사용할 수 있습니다.
        </p>
        <form class="form" id="customer-login" style="margin-top:14px" novalidate>
          <div class="field">
            <label for="cust-phone">전화번호 <span class="req">*</span></label>
            <input class="input" id="cust-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000" required>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="cust-code">1회용 청소코드 <span class="tiny muted">(처음 한 번만)</span></label>
              <input class="input" id="cust-code" type="text" inputmode="text" autocomplete="off" spellcheck="false"
                     placeholder="예: C-7F3K9Q" maxlength="14" value="${esc(inviteCode)}">
              <span class="field__hint">등록된 번호는 비워 두고 입장하세요.</span>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="cust-name">이름 <span class="tiny muted">(선택)</span></label>
              <input class="input" id="cust-name" type="text" autocomplete="name" placeholder="예: 정하윤" maxlength="20">
            </div>
            <div class="field">
              <label for="cust-title">직함 <span class="tiny muted">(선택)</span></label>
              <input class="input" id="cust-title" type="text" placeholder="예: 총무" maxlength="20">
            </div>
          </div>
          <div class="field">
            <label for="cust-email">이메일 <span class="tiny muted">(선택 · 계약서 안내)</span></label>
            <input class="input" id="cust-email" type="email" inputmode="email" autocomplete="email" placeholder="예: name@company.com" maxlength="60">
            <span class="field__hint">나중에 ‘담당자 정보’에서 언제든 고칠 수 있습니다.</span>
          </div>
          ${state.loginError ? `<p class="field__error">${esc(state.loginError)}</p>` : ''}
          <button class="btn btn--primary btn--block" type="submit">입장</button>
        </form>
        ${demoPanelTemplate(registered)}
      </section>

      <section class="panel">
        <div class="section-head"><h2>입장 방법</h2></div>
        <div class="steps">
          <div class="step"><span class="step__num">1</span><div><strong>등록된 번호</strong><span>전화번호만 입력하면 우리 현장 전용 방이 열립니다.</span></div></div>
          <div class="step"><span class="step__num">2</span><div><strong>처음 · 추가 인원</strong><span>대표에게 받은 1회용 코드를 함께 입력합니다. 코드는 한 번만 사용됩니다.</span></div></div>
          <div class="step"><span class="step__num">3</span><div><strong>우리 방만 보임</strong><span>방에는 우리 현장의 청소 보고만 표시됩니다.</span></div></div>
        </div>
      </section>
    `;
  }

  /* ---------------- one-time code gate ---------------- */

  function codeGateTemplate(session, site) {
    const meta = CATEGORY_META[site?.category] || {};
    return `
      <section class="panel auth-card">
        <span class="eyebrow">${icons.clipboard} 입장 확인</span>
        <h2>1회용 청소코드 입력</h2>
        <p class="tiny muted">
          ${esc(session.name)} ${esc(session.title || '')}님, <strong>${esc(site?.name || '현장')}</strong> 방에 입장하려면
          담당자에게 받은 1회용 청소코드가 필요합니다.
        </p>
        <div class="site-chip">
          <span class="site-item__code">${esc(site?.code || '')}</span>
          <span>${esc(meta.short || '')} · ${esc(site?.frequency || '')}</span>
        </div>
        <form class="code-form" id="room-code-form" style="margin-top:14px" novalidate>
          <input class="input" id="room-code" type="text" inputmode="text" autocomplete="off" spellcheck="false"
                 placeholder="예: C-7F3K9Q" aria-label="1회용 청소코드" maxlength="12">
          <button class="btn btn--primary" type="submit">입장</button>
        </form>
        ${state.codeError ? `<p class="field__error" style="margin-top:8px">${esc(state.codeError)}</p>` : ''}
        <p class="hint" style="margin-top:10px">
          코드는 1회만 사용할 수 있습니다. 사용 후에는 이 계정으로 다시 입장할 때 코드가 필요하지 않습니다.
          코드를 잃어버렸다면 대표(0507-1317-8369)에게 재발급을 요청해 주세요.
        </p>
        <div class="btn-row btn-row--stack" style="margin-top:12px">
          <button class="btn btn--quiet btn--sm" type="button" data-action="logout">다른 계정으로 로그인</button>
        </div>
      </section>
      ${demoCodesTemplate()}
    `;
  }

  function demoCodesTemplate() {
    return `
      <details class="demo-panel" id="demo-codes">
        <summary>데모용 미사용 코드 보기</summary>
        <div class="demo-panel__body">
          <p class="tiny muted">아래 코드를 그대로 입력해 입장을 테스트할 수 있습니다.</p>
          <div id="demo-code-list"><p class="tiny muted">불러오는 중…</p></div>
        </div>
      </details>
    `;
  }

  async function fillDemoCodes() {
    const box = $('#demo-code-list', container);
    if (!box) return;
    const groups = await demoRoomCodes();
    const quotes = (await store.listQuotes()).filter((quote) => !quote.inviteUsedAt && quote.status !== 'draft');
    if (!groups.length && !quotes.length) {
      box.innerHTML = '<p class="tiny muted">발급된 코드가 없습니다. 관리자 화면에서 발급하세요.</p>';
      return;
    }
    box.innerHTML =
      quotes
        .map(
          (quote) => `
          <div class="demo-row">
            <div>
              <strong>${esc(quote.clientCompany)} · 견적 초대</strong>
              <span>${esc(quote.no)} · ${esc(quote.inviteCode)}</span>
            </div>
            <button class="link-btn" type="button" data-fill-code="${esc(quote.inviteCode)}">입력</button>
          </div>`,
        )
        .join('') +
      groups
        .map(
          (group) => `
          <div class="demo-row">
            <div>
              <strong>${esc(group.siteName)}</strong>
              <span>${esc(group.siteCode)} · ${group.codes.length ? group.codes.map((code) => esc(code)).join(', ') : '미사용 코드 없음'}</span>
            </div>
            ${group.codes.length ? `<button class="link-btn" type="button" data-fill-code="${esc(group.codes[0])}">입력</button>` : ''}
          </div>`,
        )
        .join('');
  }

  /* ---------------- report markup ---------------- */

  function photoGrid(photos, report, groupKey) {
    const visible = photos.slice(0, 3);
    const extra = photos.length - visible.length;
    return `
      <div class="report__photos report__photos--${Math.min(visible.length, 3)}">
        ${visible
          .map(
            (photo, index) => `
              <button class="photo-btn" type="button" data-photo-report="${esc(report.id)}"
                      data-photo-group="${esc(groupKey)}" data-photo-index="${index}"
                      aria-label="${esc(photo.caption || `${GROUP_LABEL[groupKey]} 사진 ${index + 1}`)} 크게 보기">
                <img src="${esc(store.photoThumbUrl(photo))}" alt="${esc(photo.caption || `${GROUP_LABEL[groupKey]} 사진 ${index + 1}`)}"
                     loading="lazy" decoding="async">
                ${index === visible.length - 1 && extra > 0 ? `<span class="photo-btn__more">+${extra}</span>` : ''}
              </button>`,
          )
          .join('')}
      </div>
    `;
  }

  function photoGroupsTemplate(report) {
    const groups = PHOTO_GROUPS.filter((group) => {
      const photos = report.photos?.[group.key] || [];
      if (group.key === 'issue') return photos.length > 0 || report.issueNote;
      return photos.length > 0;
    });
    if (!groups.length) return '';

    return `
      <div class="photo-groups">
        ${groups
          .map((group) => {
            const photos = report.photos?.[group.key] || [];
            const label =
              group.key === 'cleaning'
                ? CATEGORY_META[state.category || '']?.cleaningLabel || group.label
                : group.label;
            return `
              <div class="photo-group photo-group--${group.key}">
                <div class="photo-group__head">
                  <span class="photo-group__label">${esc(label)}</span>
                  <span class="photo-group__count">${photos.length}장</span>
                </div>
                ${photos.length ? photoGrid(photos, report, group.key) : ''}
                ${group.key === 'issue' && report.issueNote ? `<p class="issue-note">${esc(report.issueNote)}</p>` : ''}
              </div>`;
          })
          .join('')}
      </div>
    `;
  }

  function reportTemplate(report) {
    const done = doneCount(report);
    const total = (report.checklist || []).length;
    const rel = relDayLabel(report.date);
    const issueCount = (report.photos?.issue || []).length;

    return `
      <article class="report" data-report="${esc(report.id)}">
        <header class="report__head">
          <div class="report__date">
            <strong>${esc(fmtMonthDay(report.date))}</strong>
            <span>${esc(weekdayShort(report.date))}</span>
          </div>
          <div class="report__title">
            <strong>${esc(fmtTime(report.time))} 완료${rel ? ` · ${esc(rel)}` : ''}</strong>
            <span>${esc(report.leader)} ${esc(report.leaderRole || '팀장')}${report.workDurationText ? '' : report.durationMin ? ` · ${report.durationMin}분` : ''}${report.manualDay ? ` · ${esc(report.manualDay)}요일 청소공정` : ''}</span>
            <span class="report-no" data-report-no>${esc(reportNoOf(report))}</span>
            ${report.workStartAt || report.workEndAt
              ? `<span class="sched-work-line" data-report-work="${esc(report.id)}">${report.workStartAt ? `시작 ${esc(fmtTime(report.workStartAt))}` : ''}${report.workStartAt && report.workEndAt ? ' → ' : ''}${report.workEndAt ? `완료 ${esc(fmtTime(report.workEndAt))}` : ''}${report.workDurationText ? ` (${esc(report.workDurationText)})` : ''}</span>`
              : ''}
          </div>
          <span class="badge badge--done">${icons.check} 완료</span>
        </header>

        ${photoGroupsTemplate(report)}

        <div class="report__body">
          <button class="checkline" type="button" data-check-toggle="${esc(report.id)}" aria-expanded="false">
            <span>점검 항목 <span class="count">${done}/${total}</span> 완료</span>
            <span class="checkline__caret" aria-hidden="true"></span>
          </button>
          <ul class="checks" data-check-list="${esc(report.id)}" hidden>
            ${(report.checklist || [])
              .map(
                (item) => `
                  <li class="${item.done ? '' : 'is-off'}">
                    ${item.done ? icons.check : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>'}
                    <span>${esc(item.label)}</span>
                  </li>`,
              )
              .join('')}
          </ul>
          ${report.note ? `<p class="report__note">${esc(report.note)}</p>` : ''}
          ${issueCount && !report.issueNote ? `<p class="tiny muted">특이사항 사진 ${issueCount}장이 등록되었습니다.</p>` : ''}
          <div class="report__actions">
            <button class="link-btn" type="button" data-report-print="${esc(report.id)}">인쇄 · PDF 저장</button>
          </div>
        </div>
      </article>
    `;
  }

  function listTemplate(reports) {
    if (!reports.length) {
      return `
        <div class="empty">
          <strong>아직 남겨진 보고가 없습니다</strong>
          <span>방문 후 팀장이 보고를 등록하고 대표 확인이 끝나면 이곳에 표시됩니다.</span>
        </div>`;
    }
    const rows = [];
    let currentMonth = '';
    reports.forEach((report) => {
      const month = fmtMonthLabel(report.date);
      if (month !== currentMonth) {
        currentMonth = month;
        rows.push(`<div class="month-label">${esc(month)}</div>`);
      }
      rows.push(reportTemplate(report));
    });
    return rows.join('');
  }

  /* ---------------- room markup ---------------- */

  /* ---------------- 처음부터 지금까지 (3단계 비교) ---------------- */

  function baselinePhotoGrid(stage, stageRecord) {
    const photos = stageRecord.photos || [];
    if (!photos.length) {
      return `<div class="compare__empty">${stage === 'quote' ? '첫 견적 사진 준비 중' : '대청소 사진 준비 중'}</div>`;
    }
    return `
      <div class="compare__photos">
        ${photos
          .slice(0, 4)
          .map(
            (photo, index) => `
              <button class="photo-btn" type="button" data-baseline-stage="${esc(stage)}" data-baseline-index="${index}"
                      aria-label="${esc(photo.caption || '첫 상태 사진')} 크게 보기">
                <img src="${esc(store.photoThumbUrl(photo))}" alt="${esc(photo.caption || '첫 상태 사진')}" loading="lazy" decoding="async">
              </button>`,
          )
          .join('')}
      </div>
    `;
  }

  function regularStageBody(stats) {
    const latest = stats.last;
    if (!latest) return '<div class="compare__empty">정기 관리 기록 준비 중</div>';
    const photos = [];
    for (const group of PHOTO_GROUPS) {
      (latest.photos?.[group.key] || []).forEach((photo, index) => {
        photos.push({ photo, group: group.key, index });
      });
    }
    const visible = photos.slice(0, 4);
    if (!visible.length) return '<div class="compare__empty">정기 관리 사진 준비 중</div>';
    return `
      <div class="compare__photos">
        ${visible
          .map(
            ({ photo, group, index }) => `
              <button class="photo-btn" type="button" data-photo-report="${esc(latest.id)}"
                      data-photo-group="${esc(group)}" data-photo-index="${index}"
                      aria-label="${esc(photo.caption || '정기 관리 사진')} 크게 보기">
                <img src="${esc(store.photoThumbUrl(photo))}" alt="${esc(photo.caption || '정기 관리 사진')}" loading="lazy" decoding="async">
              </button>`,
          )
          .join('')}
      </div>
    `;
  }

  function compareTemplate(site, stats) {
    const baseline = site.baseline || {};
    const quote = baseline.quote || { date: '', note: '', photos: [] };
    const deepClean = baseline.deepClean || { date: '', note: '', photos: [] };
    const latest = stats.last;

    const stageCard = (key, num, title, tag, record, body) => `
      <article class="compare__stage compare__stage--${key}">
        <header class="compare__head">
          <span class="compare__num" aria-hidden="true">${num}</span>
          <strong>${esc(title)}</strong>
          <span class="compare__tag">${esc(tag)}</span>
        </header>
        <p class="compare__date">${record && record.date ? esc(fmtDateLong(record.date)) : '날짜 미등록'}</p>
        ${body}
        ${record && record.note ? `<p class="compare__note">${esc(record.note)}</p>` : ''}
      </article>
    `;

    return `
      <section class="compare">
        <div class="section-head">
          <h2>처음부터 지금까지</h2>
          <p>상태 비교</p>
        </div>
        <p class="tiny muted" style="margin:-4px 0 12px">
          처음 견적 때의 상태와 대청소 후, 그리고 지금 관리되고 있는 모습을 사진으로 비교할 수 있습니다. 사진을 누르면 크게 보입니다.
        </p>
        <div class="compare__stages">
          ${stageCard('quote', '①', '첫 견적', '오염 상태', quote, baselinePhotoGrid('quote', quote))}
          ${stageCard('deepclean', '②', '첫 청소', '대청소', deepClean, baselinePhotoGrid('deepClean', deepClean))}
          ${stageCard(
            'regular',
            '③',
            '이후 정기 관리',
            latest ? `${fmtMonthDay(latest.date)} 최근` : '진행 중',
            latest ? { date: latest.date, note: '' } : { date: '', note: '' },
            regularStageBody(stats),
          )}
        </div>
      </section>
    `;
  }

  /* ---------------- 견적서 · 계약서 카드 ---------------- */

  function docsTemplate(documents) {
    const agreements = (documents && documents.agreements) || [];
    const quotes = ((documents && documents.quotes) || []).filter((quote) => quote.status !== 'draft');
    const closed = (status) => status === 'signed' || status === 'renewed' || status === 'terminated';
    const signed = agreements.filter((row) => closed(row.status));
    const pending = agreements.filter((row) => !closed(row.status));
    const openQuotes = signed.length || pending.length ? [] : quotes.filter((quote) => quote.status !== 'contracted');

    const cards = [];
    openQuotes.forEach((quote) => {
      cards.push(`
        <article class="doc-banner doc-banner--quote">
          <span class="doc-banner__tag">도착한 견적서</span>
          <strong>${esc(quote.clientCompany)} 정기청소 견적서</strong>
          <p>${esc(quote.frequency)} · ${esc(quote.area || '현장 확인 후 협의')}<br>견적서를 확인하고 그대로 계약까지 진행하실 수 있습니다.</p>
          <button class="btn btn--primary btn--sm" type="button" data-open-quote="${esc(quote.id)}">견적서 확인</button>
        </article>`);
    });
    pending.forEach((agreement) => {
      const sent = agreement.status === 'sent';
      cards.push(`
        <article class="doc-banner doc-banner--sign">
          <span class="doc-banner__tag">${sent ? '계약서 확인 및 서명' : '계약서 준비 중'}</span>
          <strong>${esc(agreement.clientBusinessName || '표준 계약서')}</strong>
          <p>${sent ? '계약 내용을 확인하시고 전자서명해 주세요. 서명하시면 정기청소가 바로 시작됩니다.' : '대표가 계약서를 발송하면 확인하고 서명하실 수 있습니다.'}</p>
          <button class="btn btn--primary btn--sm" type="button" data-open-agreement="${esc(agreement.id)}">${sent ? '계약서 열기 · 서명' : '계약서 확인'}</button>
        </article>`);
    });
    signed.forEach((agreement) => {
      const label = (AGREEMENT_STATUS[agreement.status] || {}).label || '체결 완료';
      cards.push(`
        <article class="doc-banner doc-banner--done">
          <span class="doc-banner__tag">${agreement.status === 'terminated' ? '종료된 계약서' : '체결된 계약서'}</span>
          <strong>${esc(agreement.clientBusinessName || '표준 계약서')}</strong>
          <p>${esc(agreement.signedDate || '')} ${esc(label)} · 인쇄하거나 PDF로 저장할 수 있습니다.</p>
          <button class="btn btn--ghost btn--sm" type="button" data-open-agreement="${esc(agreement.id)}">계약서 보기</button>
        </article>`);
    });
    if (!cards.length) return '';
    return `<section class="doc-banners">${cards.join('')}</section>`;
  }

  function roomTabsTemplate(active, hasSite) {
    const tabs = [
      { key: 'quote', label: '① 견적' },
      { key: 'contract', label: '② 계약' },
    ];
    if (hasSite) tabs.push({ key: 'manage', label: '③ 관리' });
    return `
      <nav class="room-tabs" aria-label="고객 방 단계">
        ${tabs
          .map(
            (tab) => `<button class="room-tab" type="button" data-room-tab="${tab.key}"
              aria-pressed="${active === tab.key}">${esc(tab.label)}</button>`,
          )
          .join('')}
      </nav>`;
  }

  function emptyDoc(title, hint) {
    return `<div class="empty"><strong>${esc(title)}</strong><span>${esc(hint || '')}</span></div>`;
  }

  function quotePhotosTemplate(quote) {
    const photos = quote.photos || [];
    if (!photos.length) return '';
    return `
      <div class="doc-thumbs">
        ${photos
          .map(
            (photo, index) => `
            <button class="photo-btn" type="button" data-quote-photo="${esc(quote.id)}"
                    data-quote-photo-index="${index}" aria-label="견적 현장 사진 크게 보기">
              <img src="${esc(store.photoThumbUrl(photo))}" alt="${esc(photo.caption || '견적 현장 사진')}" loading="lazy" decoding="async">
            </button>`,
          )
          .join('')}
      </div>`;
  }

  /* ---------------- 7단계 — 추가 작업 견적 · 특이사항 안내 ---------------- */

  const CUSTOMER_ISSUE_BADGE = {
    discovered: 'badge--wait',
    reviewing: 'badge--wait',
    quoted: 'badge--revise',
    scheduled: 'badge--wait',
    done: 'badge--done',
    closed: 'badge--wait',
  };

  /** 추가 작업(1회) 견적 — 정기 청소와 별도 금액. 고객이 바로 승인/보류합니뀀. */
  function extraQuoteCardTemplate(quote) {
    const status = QUOTE_STATUS[quote.status] || QUOTE_STATUS.draft;
    const statusText = quote.customerDecision === 'approved'
      ? '승인 완료'
      : quote.customerDecision === 'declined'
        ? '보류'
        : quote.status === 'sent'
          ? '확인 대기'
          : status.label;
    const decided = quote.customerDecision === 'approved'
      ? '승인하셨습니다'
      : quote.customerDecision === 'declined'
        ? '이번에는 진행하지 않기로 하셨습니다'
        : '';
    const decidedAt = quote.customerDecidedAt ? fmtDateLong(String(quote.customerDecidedAt).slice(0, 10)) : '';
    const work = quote.scope || quote.issueTitle || '';
    // 안내 문구가 작업 내용과 같으면 두 번 보여 주지 않습니다.
    const memo = String(quote.memo || '').trim();
    const showMemo = memo && memo !== work && memo !== String(quote.issueTitle || '').trim();
    return `
      <section class="panel doc-tab extra-quote-card" data-extra-quote="${esc(quote.id)}">
        <div class="section-head">
          <div>
            <h2>추가 작업 견적</h2>
            <p>${esc(quote.no)} · ${esc(quote.issueTitle || work || '현장 추가 작업')}</p>
          </div>
          <span class="badge ${quote.customerDecision === 'approved' ? 'badge--done' : status.badge}">${esc(statusText)}</span>
        </div>
        <dl class="kv kv--left">
          <dt>작업 내용</dt><dd>${esc(work || '-')}</dd>
          <dt>작업 구분</dt><dd>추가 작업 · 1회 (정기 청소와 별도)</dd>
          <dt>견적 금액</dt><dd><strong>${esc(fmtWon(quote.amount))}</strong> <span class="tiny muted">${quote.vatIncluded ? '부가세 포함' : '부가세 별도'}</span></dd>
          ${showMemo ? `<dt>안내</dt><dd>${esc(memo)}</dd>` : ''}
        </dl>
        ${quotePhotosTemplate(quote)}
        ${
          decided
            ? `<p class="extra-quote-decision${quote.customerDecision === 'declined' ? ' extra-quote-decision--hold' : ''}" data-extra-quote-decision="${esc(quote.id)}">${esc(decided)}${decidedAt ? ` · ${esc(decidedAt)}` : ''}</p>`
            : ''
        }
        ${
          quote.status === 'sent' && !quote.customerDecision
            ? `<div class="extra-quote-actions">
                 <button class="btn btn--primary btn--sm" type="button" data-extra-quote-accept="${esc(quote.id)}">이 추가 견적 승인</button>
                 <button class="btn btn--quiet btn--sm" type="button" data-extra-quote-decline="${esc(quote.id)}">이번에는 진행 안 함</button>
               </div>`
            : ''
        }
      </section>`;
  }

  /** 현장에서 발견한 특이사항과 진행 상태 — 공개된 건만 넘어옵니다(직원 id · 내부 메모 없음). */
  function customerIssueListTemplate(issues) {
    const rows = Array.isArray(issues) ? issues : [];
    if (!rows.length) return '';
    return `
      <section class="panel" data-customer-issues>
        <div class="section-head">
          <h2>추가 작업 안내</h2>
          <p>${rows.length}건</p>
        </div>
        <p class="tiny muted" style="margin:-6px 0 8px">
          현장에서 발견한 특이사항과 진행 상태입니다. 추가 작업 견적은 위에서 확인하고 승인하실 수 있습니다.
        </p>
        <div class="customer-issue-list">
          ${rows
            .map(
              (issue) => `
            <div class="customer-issue" data-customer-issue="${esc(issue.id)}">
              <div class="customer-issue__head">
                <strong>${esc(issue.title || '현장 특이사항')}</strong>
                <span class="badge ${CUSTOMER_ISSUE_BADGE[issue.status] || 'badge--wait'}">${esc(issue.statusLabel || '안내')}</span>
              </div>
              ${issue.note ? `<p>${esc(issue.note)}</p>` : ''}
              ${issue.date ? `<p class="tiny muted">발견 ${esc(fmtDateLong(issue.date))}</p>` : ''}
              ${
                issue.photos && issue.photos.length
                  ? `<div class="doc-thumbs">${issue.photos
                      .map((photo) => `<img src="${esc(store.photoThumbUrl(photo))}" alt="특이사항 사진" loading="lazy" decoding="async">`)
                      .join('')}</div>`
                  : ''
              }
              ${issue.quoteAmount ? `<p class="tiny muted">추가 작업 견적 ${esc(fmtWon(issue.quoteAmount))}${issue.customerDecision === 'approved' ? ' · 승인 완료' : ''}</p>` : ''}
            </div>`,
            )
            .join('')}
        </div>
      </section>`;
  }

  function quoteTabTemplate(documents) {
    const all = (documents.quotes || []).filter((quote) => quote.status !== 'draft');
    const extra = all.filter(isExtraQuote);
    const quotes = all.filter((quote) => !isExtraQuote(quote));
    const issues = documents.issues || [];
    const empty = !quotes.length && !extra.length && !issues.length;
    if (empty) {
      return `<section class="panel">${emptyDoc('아직 견적서가 없습니다', '견적서가 도착하면 이곳에서 확인하실 수 있습니다.')}</section>`;
    }
    return `
      <div class="stack-10">
        ${extra.length ? `<div class="stack-10" data-extra-quotes>${extra.map(extraQuoteCardTemplate).join('')}</div>` : ''}
        ${customerIssueListTemplate(issues)}
        ${quotes
          .map((quote) => {
            const status = QUOTE_STATUS[quote.status] || QUOTE_STATUS.draft;
            const meta = CATEGORY_META[quote.clientCategory] || {};
            return `
              <section class="panel doc-tab" data-quote-tab="${esc(quote.id)}">
                <div class="section-head">
                  <div>
                    <h2>견적서</h2>
                    <p>${esc(quote.no)} · ${esc(meta.short || '')}</p>
                  </div>
                  <span class="badge ${status.badge}">${esc(status.label)}</span>
                </div>
                <dl class="kv kv--left">
                  <dt>청소 주기</dt><dd>${esc(quote.frequency)}</dd>
                  <dt>기본 청소</dt><dd>${esc(quote.scope || '-')}</dd>
                  <dt>추가 업무</dt><dd>${esc(quote.extraScope || '-')}</dd>
                  <dt>면적</dt><dd>${esc(quote.area || '현장 확인 후 협의')}</dd>
                  <dt>월 견적금액</dt><dd><strong>${esc(fmtWon(quote.amount))}</strong> <span class="tiny muted">${quote.vatIncluded ? '부가세 포함' : '부가세 별도'}</span></dd>
                  <dt>유효기간</dt><dd>${esc(quote.validUntil ? `${quote.validUntil}까지` : '협의')}</dd>
                </dl>
                ${quotePhotosTemplate(quote)}
                <button class="btn btn--primary btn--block" type="button" data-open-quote="${esc(quote.id)}">견적서 시트 보기</button>
              </section>`;
          })
          .join('')}
      </div>`;
  }

  function bizLicenseTemplate(agreement) {
    const ref = agreement ? agreement.bizLicense : null;
    return `
      <div class="biz-license" data-biz-license>
        <div class="section-head">
          <h3>고객사 사업자등록증</h3>
          <p>${ref ? '등록됨' : '미등록'}</p>
        </div>
        ${
          ref
            ? `<div class="biz-license__preview"><img src="${esc(store.photoThumbUrl(ref))}" alt="사업자등록증" loading="lazy" decoding="async"></div>`
            : '<p class="tiny muted">사업자등록증 사진을 올려 주세요. 계약 정보 확인에 사용됩니다.</p>'
        }
        ${
          agreement
            ? `<label class="btn btn--quiet btn--sm biz-license__btn">
                 ${ref ? '사진 다시 올리기' : '사업자등록증 올리기'}
                 <input type="file" accept="image/*" hidden data-biz-license-input="${esc(agreement.id)}">
               </label>`
            : ''
        }
      </div>`;
  }

  function contractMemoTemplate(agreement) {
    if (!agreement) return '';
    return `
      <div class="field contract-memo">
        <label for="contract-memo">특이사항</label>
        <textarea class="textarea" id="contract-memo" rows="3" maxlength="400"
          placeholder="예: 주차 1시간 지원, 엘리베이터 사용 시간 협의">${esc(agreement.contractMemo)}</textarea>
        <button class="btn btn--quiet btn--sm" type="button" data-save-contract-memo="${esc(agreement.id)}">특이사항 저장</button>
      </div>`;
  }

  function contractTabTemplate(documents) {
    const agreement = (documents.agreements || [])[0] || null;
    if (!agreement) {
      return `
        <section class="panel">
          <div class="section-head"><h2>계약서</h2><p>준비 중</p></div>
          ${emptyDoc('아직 계약서가 없습니다', '견적서를 확인하고 계약을 진행하시면 표준 계약서가 만들어집니다.')}
          ${bizLicenseTemplate(null)}
        </section>`;
    }
    const status = AGREEMENT_STATUS[agreement.status] || AGREEMENT_STATUS.draft;
    const closed = agreement.status === 'signed' || agreement.status === 'renewed' || agreement.status === 'terminated';
    const audit = agreement.signatureAudit || {};
    const history = (agreement.history || []).slice(0, 3);
    return `
      <section class="panel doc-tab" data-contract-tab="${esc(agreement.id)}">
        <div class="section-head">
          <div>
            <h2>표준 계약서</h2>
            <p>${esc(agreement.no)} · ${esc(status.label)}</p>
          </div>
          <span class="badge ${status.badge}">${esc(status.label)}</span>
        </div>
        <dl class="kv kv--left">
          <dt>계약기간</dt><dd>${esc(agreement.startDate)} ~ ${esc(agreement.endDate)} (${esc(String(agreement.months))}개월)</dd>
          <dt>청소 주기</dt><dd>${esc(agreement.frequency || '-')}</dd>
          <dt>작업시간</dt><dd>${esc(agreement.workHours || '현장 협의')}</dd>
          <dt>계약 담당자</dt><dd>${esc(agreement.managerName || '코리아 에코크린')} ${esc(agreement.managerTitle || '')}</dd>
          <dt>결제일</dt><dd>매월 ${esc(agreement.billingDay)}일</dd>
          <dt>체결일</dt><dd>${esc(agreement.signedDate || '미체결')}</dd>
          ${
            agreement.status === 'terminated'
              ? `<dt>종료</dt><dd>${esc(String(agreement.terminatedAt || '').slice(0, 10))}${agreement.terminateReason ? ` · ${esc(agreement.terminateReason)}` : ''}</dd>`
              : ''
          }
          ${agreement.renewedFrom ? `<dt>갱신</dt><dd>이전 계약서에서 이어받은 갱신 계약입니다.</dd>` : ''}
        </dl>
        ${
          agreement.specialTerms
            ? `<details class="settings" open><summary>특약사항</summary><div class="settings__body"><p class="tiny preserve">${esc(agreement.specialTerms)}</p></div></details>`
            : ''
        }
        <button class="btn btn--primary btn--block" type="button" data-open-agreement="${esc(agreement.id)}">
          ${closed ? '계약서 보기 · 인쇄' : agreement.status === 'sent' ? '계약서 확인 · 서명' : '계약서 확인 (발송 대기)'}
        </button>
        ${
          audit.hash
            ? `<div class="sign-evidence" data-sign-evidence="${esc(agreement.id)}">
                 <strong>전자서명 증빙</strong>
                 <dl class="kv kv--left">
                   <dt>서명자</dt><dd>${esc(audit.name || agreement.signedByName || '갑(고객)')} ${esc(audit.role || '')}</dd>
                   <dt>서명 일시</dt><dd>${esc(String(audit.at || agreement.signedAt || '').slice(0, 16).replace('T', ' '))}</dd>
                   <dt>문서 확인값</dt><dd><code>${esc(String(agreement.docHash || audit.hash).slice(0, 16))}</code> <span class="tiny muted">${esc(agreement.docAlgo || audit.algo || '')}</span></dd>
                 </dl>
                 <p class="tiny muted">서명한 계약서 원본과 이 확인값이 같아야 합니다.</p>
               </div>`
            : ''
        }
        ${
          history.length
            ? `<details class="settings"><summary>계약 변경 이력 ${esc(String((agreement.history || []).length))}건</summary>
                 <div class="settings__body"><ul class="site-history__list">
                   ${history
                     .map((row) => `<li><span class="site-history__when">${esc(String(row.at || '').slice(0, 10))}</span><span>${esc(row.action)}</span></li>`)
                     .join('')}
                 </ul></div></details>`
            : ''
        }
        ${bizLicenseTemplate(agreement)}
        ${contractMemoTemplate(agreement)}
      </section>`;
  }

  function profilePanelTemplate(session, { open = false } = {}) {
    const account = session.account || {};
    const confirmed = !!account.contactConfirmedAt;
    const name = account.name || session.name || '';
    const title = account.title || session.title || '';
    const email = account.email || '';
    const form = `
      <p class="tiny muted">
        초대받은 담당자 정보입니다. 이름 · 직함 · 이메일을 확인해 주세요. 회사 정보와 계약 내용은 대표가 등록한 값 그대로입니다.
      </p>
      <form class="form" id="customer-profile-form" style="margin-top:10px" novalidate>
        <div class="field-row">
          <div class="field">
            <label for="cp-name">이름 <span class="req">*</span></label>
            <input class="input" id="cp-name" type="text" autocomplete="name" maxlength="20" value="${esc(name)}" placeholder="담당자 이름">
          </div>
          <div class="field">
            <label for="cp-title">직함</label>
            <input class="input" id="cp-title" type="text" maxlength="20" value="${esc(title)}" placeholder="예: 총무">
          </div>
        </div>
        <div class="field">
          <label for="cp-email">이메일 <span class="tiny muted">(선택)</span></label>
          <input class="input" id="cp-email" type="email" inputmode="email" autocomplete="email" maxlength="60" value="${esc(email)}" placeholder="예: name@company.com">
          <span class="field__hint">계약서 · 견적서 안내를 받을 메일입니다.</span>
        </div>
        <p class="tiny muted">연락처 ${esc(session.phone || '')} · 이 번호가 입장 번호입니다.</p>
        <button class="btn ${confirmed ? 'btn--quiet' : 'btn--primary'} btn--sm" type="submit">담당자 정보 저장</button>
      </form>`;
    // 확인이 끝났거나 이미 쓰던 업장 방이면 접어 두고, 필요할 때만 펼쳐 고칩니다.
    // (초대받아 처음 들어온 견적 방에서만 크게 열어 확인을 요청합니다.)
    if (confirmed || !open) {
      return `
        <details class="settings customer-profile" data-customer-profile>
          <summary>담당자 정보 · ${esc(name)} ${esc(title)} ${confirmed ? '(확인 완료)' : '(확인 전)'}</summary>
          <div class="settings__body">${form}</div>
        </details>`;
    }
    return `
      <section class="panel customer-profile" data-customer-profile>
        <div class="section-head">
          <div>
            <h2>담당자 정보</h2>
            <p>한 번만 확인해 주세요</p>
          </div>
          <span class="badge badge--wait">확인 필요</span>
        </div>
        ${form}
      </section>`;
  }

  function visitScheduleTemplate(schedule) {
    const entries = ((schedule && schedule.entries) || []).filter((entry) => entry.status !== 'off' || entry.changed);
    const next = entries.slice(0, 12);
    if (!schedule) return '';
    const cls = (status) =>
      status === 'done' ? 'badge--done' : status === 'active' ? 'badge--wait' : status === 'missed' ? 'badge--stop' : status === 'off' ? 'badge--stop' : 'badge';
    return `
      <section class="panel customer-schedule" data-customer-schedule>
        <div class="section-head">
          <div>
            <h2>방문 일정</h2>
            <p>앞으로 2주 · 정기 청소 일정</p>
          </div>
          <span class="badge">${next.length}회</span>
        </div>
        ${next.length
          ? `<ul class="sched-customer">${next
              .map(
                (entry) => `<li data-customer-schedule-date="${esc(entry.date)}" data-customer-schedule-status="${esc(entry.status)}">
                  <span class="sched-customer__date">${esc(fmtDateLong(entry.date))}</span>
                  <span class="tiny muted">${esc(entry.time || '시간 협의')}</span>
                  <span class="badge ${cls(entry.status)}">${esc(entry.statusLabel)}</span>
                  ${entry.actualStart ? `<span class="sched-work-line" data-customer-work-start="${esc(entry.actualStart)}">시작 ${esc(fmtTime(entry.actualStart))}</span>` : ''}
                  ${entry.actualEnd ? `<span class="sched-work-line" data-customer-work-end="${esc(entry.actualEnd)}">완료 ${esc(fmtTime(entry.actualEnd))}${entry.workDurationText ? ` (${esc(entry.workDurationText)})` : ''}</span>` : ''}
                  ${entry.changed ? '<span class="tiny muted">일정 변경</span>' : ''}
                </li>`,
              )
              .join('')}</ul>`
          : '<p class="tiny muted">예정된 방문이 없습니다. 대표에게 문의해 주세요.</p>'}
        <p class="hint">정기 청소 요일을 기준으로 만든 일정입니다. 휴무 · 시간 변경이 있으면 이곳에 바로 표시됩니다. 팀장이 현장에 도착해 시작을 등록하면 <strong>실제 시작 · 완료 시각</strong>이 함께 나옵니다. 현장 작업 기록은 아래 방문 보고에서 확인하실 수 있습니다.</p>
      </section>`;
  }

  /**
   * 청구 · 입금 — 본인 업장의 청구 내역 · 입금 상태 · 세금계산서 발행 여부만 보입니다.
   * (직원 이름 · 내부 메모 · 팀장 정산 · 다른 업장은 나오지 않습니다.)
   */
  /* ---------------- 10단계 — 불편 사항 · 요청 (컴플레인) ---------------- */

  const CUSTOMER_COMPLAINT_BADGE = { open: 'badge--wait', handling: 'badge--revise', resolved: 'badge--done' };

  function customerComplaintsTemplate(complaints) {
    const rows = Array.isArray(complaints) ? complaints : [];
    const draft = state.complaint || { photos: [] };
    const openCount = rows.filter((row) => row.status !== 'resolved').length;
    return `
      <section class="panel customer-complaints" data-customer-complaints>
        <div class="section-head">
          <h2>불편 사항 · 요청</h2>
          <p>${rows.length ? `진행 ${openCount}건 · 전체 ${rows.length}건` : '접수된 요청 없음'}</p>
        </div>
        <p class="tiny muted" style="margin:-6px 0 10px">
          청소 상태 · 일정 · 직원 응대 등 불편한 점이나 요청 사항을 보내 주세요.
          접수되면 코리아 에코크린 대표가 확인하고, 조치 내용을 이 화면에서 알려 드립니다.
        </p>
        ${
          rows.length
            ? `<div class="customer-complaint-list">${rows
                .map(
                  (row) => `
              <article class="customer-complaint" data-customer-complaint="${esc(row.id)}" data-complaint-status="${esc(row.status)}">
                <div class="customer-complaint__head">
                  <strong>${esc(row.title || '불편 사항')}</strong>
                  <span class="badge ${CUSTOMER_COMPLAINT_BADGE[row.status] || 'badge--wait'}">${esc(row.statusLabel || '접수')}</span>
                </div>
                <p>${esc(row.content || '')}</p>
                ${
                  row.photos && row.photos.length
                    ? `<div class="doc-thumbs">${row.photos
                        .map(
                          (photo, index) =>
                            `<button class="photo-btn" type="button" data-complaint-photo="${esc(row.id)}" data-complaint-photo-index="${index}" aria-label="불편 사항 사진 크게 보기"><img src="${esc(store.photoThumbUrl(photo))}" alt="불편 사항 사진" loading="lazy" decoding="async"></button>`,
                        )
                        .join('')}</div>`
                    : ''
                }
                <p class="tiny muted">
                  ${esc(row.typeLabel || '')}
                  ${row.createdAt ? ` · 접수 ${esc(fmtDateLong(localDateOf(row.createdAt)))}` : ''}
                  ${row.resolvedAt ? ` · 해결 ${esc(fmtDateLong(localDateOf(row.resolvedAt)))}` : ''}
                </p>
                ${
                  row.resolutionNote
                    ? `<div class="customer-complaint__result"><strong>조치 내용</strong><p>${esc(row.resolutionNote)}</p></div>`
                    : ''
                }
              </article>`,
                )
                .join('')}</div>`
            : ''
        }
        <details class="complaint-new" ${rows.length ? '' : 'open'}>
          <summary>불편 사항 보내기</summary>
          <form class="form" data-customer-complaint-form novalidate>
            <div class="field">
              <label for="cc-title">제목</label>
              <input class="input" id="cc-title" type="text" maxlength="80" data-customer-complaint-title placeholder="예: 화장실 냄새가 심합니다">
            </div>
            <div class="field">
              <label for="cc-type">유형</label>
              <select class="select" id="cc-type" data-customer-complaint-type>
                ${Object.entries(COMPLAINT_TYPES)
                  .map(([key, label]) => `<option value="${esc(key)}">${esc(label)}</option>`)
                  .join('')}
              </select>
            </div>
            <div class="field">
              <label for="cc-content">내용</label>
              <textarea class="textarea" id="cc-content" rows="4" maxlength="2000" data-customer-complaint-content placeholder="언제 · 어디서 · 어떤 점이 불편했는지 적어 주세요."></textarea>
            </div>
            ${
              draft.photos.length
                ? `<div class="issue-form__photos">${draft.photos.map((photo) => `<img src="${esc(store.photoThumbUrl(photo))}" alt="첨부 사진">`).join('')}</div>`
                : ''
            }
            <div class="btn-row btn-row--stack">
              <label class="btn btn--quiet btn--sm">사진 첨부 (최대 4장)
                <input type="file" accept="image/*" multiple hidden data-customer-complaint-photo>
              </label>
              <button class="btn btn--primary btn--sm" type="submit">보내기</button>
            </div>
          </form>
        </details>
      </section>`;
  }

  function customerBillingTemplate(invoices) {
    const rows = Array.isArray(invoices) ? invoices : [];
    if (!rows.length) return '';
    const paidTotal = rows.filter((row) => row.status === 'paid').reduce((sum, row) => sum + (Number(row.paidAmount) || Number(row.total) || 0), 0);
    const waiting = rows
      .filter((row) => row.status === 'billed' || row.status === 'overdue' || row.status === 'scheduled')
      .reduce((sum, row) => sum + (Number(row.total) || 0), 0);
    return `
      <section class="panel customer-billing" data-customer-billing>
        <div class="section-head">
          <h2>청구 · 입금</h2>
          <p>${rows.length}건</p>
        </div>
        <div class="customer-billing__sum">
          <span>입금 완료 <strong data-customer-billing-total="paid">${esc(fmtWon(paidTotal))}</strong></span>
          <span>입금 전 <strong data-customer-billing-total="waiting">${esc(fmtWon(waiting))}</strong></span>
        </div>
        <p class="tiny muted" style="margin:6px 0 10px">
          정기청소 청구와 입금 상태입니다. 부가세는 공급가와 따로 표시됩니다.
        </p>
        <div class="customer-billing__list">
          ${rows
            .map((row) => {
              const status = INVOICE_STATUS[row.status] || INVOICE_STATUS.scheduled;
              return `
                <div class="customer-billing__row" data-customer-invoice="${esc(row.id)}" data-invoice-status="${esc(row.status)}">
                  <div class="customer-billing__head">
                    <strong>${esc(row.monthLabel || billingMonthLabel(row.month))} ${esc(row.kindLabel || '')}</strong>
                    <span class="badge ${status.badge}">${esc(row.statusLabel || status.label)}</span>
                  </div>
                  <div class="customer-billing__money">
                    <span>공급가 ${esc(fmtWon(row.amount))}</span>
                    <span>부가세 ${esc(fmtWon(row.vat))}</span>
                    <strong>합계 ${esc(fmtWon(row.total))}</strong>
                  </div>
                  <p class="tiny muted">
                    ${row.dueDate ? `납기 ${esc(fmtDateLong(row.dueDate))}` : '납기 협의'}
                    · 세금계산서 ${esc(row.taxInvoiceLabel || '미발행')}${row.taxIssuedAt ? ` (${esc(String(row.taxIssuedAt).slice(0, 10))})` : ''}
                    ${row.status === 'paid' && row.paidAt ? ` · 입금 ${esc(fmtDateLong(row.paidAt))}` : ''}
                  </p>
                </div>`;
            })
            .join('')}
        </div>
      </section>`;
  }

  function manageTabTemplate(site, stats, viewer, schedule, invoices, complaints = []) {    const last = stats.last;
    const reports = filterReports(stats.reports);
    const nextLabel = stats.nextDate ? `${fmtDateLong(stats.nextDate)} 예정` : '일정 확인 필요';
    const room = site.room || {};
    const roomLabel = room.status === 'active' ? '운영 중' : room.status === 'ended' ? '종료' : '연결 중';
    return `
      ${compareTemplate(site, stats)}

      ${visitScheduleTemplate(schedule)}

      ${customerBillingTemplate(invoices)}

      ${customerComplaintsTemplate(complaints)}

      <section class="panel">
        <dl class="kv kv--left">
          <dt>${viewer.preview ? '보는 사람' : '입장 계정'}</dt><dd>${esc(viewer.name)} ${esc(viewer.title || '')} · ${esc(viewer.phone || '')}${viewer.preview ? ' (미리보기)' : ''}</dd>
          <dt>업장 관리방</dt><dd>${esc(roomLabel)}${room.createdAt ? ` · ${esc(fmtDateLong(String(room.createdAt).slice(0, 10)))} 연결` : ''}</dd>
          <dt>청소 조건</dt><dd>${esc(site.area || '-')} · ${esc(site.frequency || '-')}</dd>
          <dt>다음 방문</dt><dd>${esc(nextLabel)}</dd>
          <dt>출입 안내</dt><dd>${esc(site.accessNote || '-')}</dd>
          <dt>최근 방문</dt><dd>${last ? `${esc(fmtDateLong(last.date))} ${esc(fmtTime(last.time))}` : '기록 없음'}</dd>
        </dl>
        <p class="hint" style="margin-top:10px">
          이 방에는 ${esc(site.clientName)} 현장 기록만 표시됩니다. 계약서 · 견적서 · 첫 견적 사진은 ② 계약 · ① 견적 탭에서 보고, 다음 방문일은 정기 주기를 기준으로 계산한 예상일입니다.
        </p>
      </section>

      <section>
        <div class="filter-bar">
          <div class="chips">
            ${FILTERS.map(
              (filter) => `<button class="chip" type="button" data-filter="${filter.key}"
                aria-pressed="${state.filter === filter.key}">${esc(filter.label)}</button>`,
            ).join('')}
          </div>
          <span class="tiny muted">${reports.length}건</span>
        </div>
        <div class="view" style="gap:10px;margin-top:12px">
          ${listTemplate(reports)}
        </div>
      </section>`;
  }

  function quoteRoomTemplate(session, quote, agreement) {
    const status = QUOTE_STATUS[quote.status] || QUOTE_STATUS.draft;
    const tab = state.roomTab === 'contract' ? 'contract' : 'quote';
    const documents = { quotes: [quote], agreements: agreement ? [agreement] : [] };
    return `
      <section class="site-head site-head--doc">
        <div class="site-head__top">
          <div>
            <span class="site-head__code">견적 · 계약 전용 방</span>
            <h2>${esc(quote.clientCompany)}</h2>
          </div>
          <span class="badge" style="background:rgba(255,255,255,.14);color:#eaf4e4">${esc(status.label)}</span>
        </div>
        <p class="site-head__meta">
          ${esc(quote.clientContact || session.name)} ${esc(quote.clientPhone || '')}<br>
          ${esc(quote.clientAddress || '소재지 확인 중')}<br>
          ${esc(quote.frequency)}
        </p>
      </section>

      ${profilePanelTemplate(session, { open: true })}

      ${roomTabsTemplate(tab, false)}

      ${
        tab === 'quote'
          ? `<section class="doc-banner doc-banner--quote">
               <span class="doc-banner__tag">도착한 견적서</span>
               <strong>${esc(quote.clientCompany)} 정기청소 견적서</strong>
               <p>견적서를 확인하신 뒤 <b>이 견적으로 계약 진행</b>을 누르면 표준 계약서로 넘어갑니다. 계약서에 전자서명하시면 정기청소 현장이 바로 등록됩니다.</p>
               <button class="btn btn--primary btn--block" type="button" data-open-quote="${esc(quote.id)}">견적서 확인 · 계약 진행</button>
             </section>
             ${quoteTabTemplate(documents)}`
          : contractTabTemplate(documents)
      }

      <section class="panel">
        <div class="section-head"><h2>진행 순서</h2></div>
        <div class="steps">
          <div class="step"><span class="step__num">1</span><div><strong>견적 확인</strong><span>청소 범위 · 주기 · 월 금액을 확인합니다.</span></div></div>
          <div class="step"><span class="step__num">2</span><div><strong>계약서 전자서명</strong><span>표준 계약서 내용을 확인하고 서명합니다.</span></div></div>
          <div class="step"><span class="step__num">3</span><div><strong>정기청소 시작</strong><span>서명과 동시에 현장이 등록되고, 청소 후 사진을 이 방에서 확인합니다.</span></div></div>
        </div>
        <p class="hint" style="margin-top:10px">문의 ${esc('0507-1317-8369')} · koreaecoclean@naver.com</p>
      </section>

      <div class="btn-row btn-row--stack" style="margin-top:4px">
        <button class="btn btn--quiet btn--sm" type="button" data-action="logout">로그아웃</button>
      </div>
    `;
  }

  function roomTemplate(site, stats, viewer, documents, schedule) {
    const meta = CATEGORY_META[site.category] || {};
    const tab = ['quote', 'contract', 'manage'].includes(state.roomTab) ? state.roomTab : 'manage';
    return `
      <section class="site-head">
        <div class="site-head__top">
          <div>
            <span class="site-head__code">${esc(site.code)} · 전용 방</span>
            <h2>${esc(site.name)}</h2>
          </div>
          <span class="badge" style="background:rgba(255,255,255,.14);color:#eaf4e4">${esc(meta.short || '')}</span>
        </div>
        <p class="site-head__meta">
          ${esc(site.clientName)} · ${esc(site.area)}<br>
          ${esc(site.address)}<br>
          담당 ${esc(site.manager)} ${esc(site.managerRole || '팀장')} · ${esc(site.frequency)}
        </p>
        <div class="site-head__stats">
          <div class="site-head__stat"><strong>${stats.monthCount}회</strong><span>이번 달 방문</span></div>
          <div class="site-head__stat"><strong>${stats.photoCount}장</strong><span>누적 현장 사진</span></div>
          <div class="site-head__stat"><strong>${stats.last ? `${daysBetween(stats.last.date)}일` : '-'}</strong><span>마지막 방문</span></div>
        </div>
        <div class="site-head__actions">
          <button class="link-btn" type="button" data-action="copy-code">현장 코드 복사</button>
          <button class="link-btn" type="button" data-action="toggle-sort">${state.sort === 'desc' ? '최신순' : '오래된순'}</button>
          ${viewer.preview ? '' : '<button class="link-btn" type="button" data-action="logout">로그아웃</button>'}
        </div>
      </section>

      ${roomTabsTemplate(tab, true)}

      ${viewer.preview ? '' : profilePanelTemplate(viewer)}

      ${tab === 'quote' ? quoteTabTemplate(documents) : tab === 'contract' ? contractTabTemplate(documents) : manageTabTemplate(site, stats, viewer, schedule, documents.invoices, documents.complaints)}
    `;
  }

  /* ---------------- render ---------------- */

  async function render(options = {}) {
    const token = (renderToken += 1);
    mount();
    if (options && options.siteCode) state.previewCode = options.siteCode;
    if (options && options.tab) state.roomTab = options.tab;

    const session = await getSession();
    if (token !== renderToken) return;

    if (session && (session.role === 'leader' || session.role === 'admin')) {
      const sites = await store.listSites();
      if (token !== renderToken) return;
      await renderStaffPreview(session, sites);
      return;
    }

    if (!session || session.role !== 'customer') {
      state.session = null;
      const registered = await demoRegisteredCustomers().catch(() => []);
      if (token !== renderToken) return;
      container.innerHTML = loginTemplate(registered);
      await fillDemoCodes();
      return;
    }

    state.session = session;

    if (session.quoteId) {
      // 3단계 — 고객은 자기에게 온 견적만 열 수 있습니다(store 가 한 번 더 막습니다).
      const quote = await store.getQuote(session.quoteId, { actor: session }).catch(() => null);
      const agreement = quote ? await store.getAgreementByQuote(quote.id, { actor: session }).catch(() => null) : null;
      if (token !== renderToken) return;
      if (quote) {
        if (!state.roomTab) state.roomTab = 'quote';
        container.innerHTML = quoteRoomTemplate(session, quote, agreement);
        return;
      }
    }

    const site = await store.getSiteFor(session, session.siteId);
    state.category = site ? site.category : '';
    if (token !== renderToken) return;

    if (!site) {
      container.innerHTML = `<div class="empty"><strong>연결된 현장이 없습니다</strong><span>대표(0507-1317-8369)에게 문의해 주세요.</span></div>`;
      return;
    }

    const access = await hasRoomAccess(session);
    if (token !== renderToken) return;

    if (!access) {
      state.site = site;
      container.innerHTML = codeGateTemplate(session, site);
      await fillDemoCodes();
      return;
    }

    // 방에 들어온 뒤에도 「불편 사항 보내기」가 업장을 알 수 있도록 기억합니다.
    state.site = site;

    const stats = await store.statsForSite(site, { customerFacing: true });
    if (token !== renderToken) return;
    // 5단계 — 자기 업장의 방문 일정만(직원 위치·좌표·거리는 오지 않습니다).
    const scheduleFrom = toISODate();
    const scheduleEnd = new Date(`${scheduleFrom}T12:00:00`);
    scheduleEnd.setDate(scheduleEnd.getDate() + 13);
    const schedule = await store
      .listSchedule({ from: scheduleFrom, to: toISODate(scheduleEnd) }, { actor: session })
      .catch(() => null);
    if (token !== renderToken) return;

    reportsById.clear();
    stats.reports.forEach((report) => reportsById.set(report.id, report));
    const documents = {
      quotes: await store.listQuotes({ siteId: site.id }, { actor: session }),
      agreements: await store.listAgreements({ siteId: site.id }, { actor: session }),
      // 7단계 — 본인 업장의 공개된 추가 작업 안내만(서버가 걸러서 넘깁니다).
      issues: await store.listIssues({ siteId: site.id }, { actor: session }).catch(() => []),
      // 9단계 — 본인 업장의 청구 · 입금 · 세금계산서 발행 여부만(금액 · 상태만).
      invoices: await store.listInvoices({ siteId: site.id }, { actor: session }).catch(() => []),
      // 10단계 — 본인 업장의 불편 사항(접수 · 진행 상태 · 조치 내용). 내부 메모는 오지 않습니다.
      complaints: await store.listComplaints({ siteId: site.id }, { actor: session }).catch(() => []),
    };
    state.complaints = documents.complaints;
    if (!['quote', 'contract', 'manage'].includes(state.roomTab)) state.roomTab = 'manage';
    if (token !== renderToken) return;
    container.innerHTML = roomTemplate(site, stats, { ...session, preview: false }, documents, schedule);
  }

  /* ---------------- staff preview (팀장·대표) ---------------- */

  function previewBanner(session, site, sites) {
    return `
      <section class="preview-banner">
        <div>
          <strong>${icons.camera} 팀장 미리보기</strong>
          <span>${esc(session.name)} ${esc(session.title || '')}님이 보는 화면입니다. 고객에게는 이 기록만 보입니다.</span>
        </div>
        <div class="chips">
          ${sites
            .map(
              (item) => `<button class="chip" type="button" data-preview-site="${esc(item.code)}"
                aria-pressed="${item.id === site.id}">${esc(item.name)}</button>`,
            )
            .join('')}
        </div>
      </section>
    `;
  }

  async function renderStaffPreview(session, sites) {
    const allowed =
      session.role === 'admin' || !(session.assignedSiteIds || []).length
        ? sites
        : sites.filter((site) => session.assignedSiteIds.includes(site.id));
    const pool = allowed.length ? allowed : sites;
    if (!pool.length) {
      container.innerHTML = '<div class="empty"><strong>현장이 없습니다</strong><span>관리자 화면에서 현장을 확인해 주세요.</span></div>';
      return;
    }

    const site =
      pool.find((item) => item.code === state.previewCode) ||
      pool.find((item) => item.code === state.site?.code) ||
      pool[0];
    state.site = site;
    state.category = site.category;

    const stats = await store.statsForSite(site, { customerFacing: true });
    reportsById.clear();
    stats.reports.forEach((report) => reportsById.set(report.id, report));
    const documents = {
      // v2.8.2 유지 — 직원(팀장·본부장) 미리보기에는 고객 견적서·계약서를 넘기지 않습니다.
      quotes: session.role === 'admin' ? await store.listQuotes({ siteId: site.id }) : [],
      agreements: session.role === 'admin' ? await store.listAgreements({ siteId: site.id }) : [],
      issues: session.role === 'admin' ? await store.listIssues({ siteId: site.id }, { actor: session }).catch(() => []) : [],
      // 9단계 — 청구 금액은 대표만. 팀장 미리보기에는 넘기지 않습니다.
      invoices: session.role === 'admin' ? await store.listInvoices({ siteId: site.id }, { actor: session }).catch(() => []) : [],
      // 10단계 — 불편 사항은 대표 · 배정 팀장(요청 내용만) 미리보기.
      complaints: await store.listComplaints({ siteId: site.id }, { actor: session }).catch(() => []),
    };
    state.complaints = documents.complaints;

    const viewer = {
      name: session.name,
      title: session.title || (session.role === 'admin' ? '대표' : '팀장'),
      phone: session.phone || '',
      preview: true,
    };

    const previewSchedule = await store
      .listSchedule({ from: toISODate(), to: toISODate(new Date(Date.now() + 13 * 86400000)) }, { actor: session })
      .catch(() => null);

    container.innerHTML = previewBanner(session, site, pool) + roomTemplate(site, stats, viewer, documents, previewSchedule);
  }

  /* ---------------- lightbox ---------------- */

  async function showBaselinePhotos(stage, startIndex) {
    const site = state.site;
    const record = site && site.baseline ? site.baseline[stage] : null;
    const photos = (record && record.photos) || [];
    if (!photos.length) return;
    const items = [];
    for (const photo of photos) {
      const url = await store.photoFullUrl(photo);
      if (!url) continue;
      items.push({
        url,
        caption: [stage === 'quote' ? '① 첫 견적 · 오염 상태' : '② 첫 청소 · 대청소', photo.caption || '', record.date ? fmtDateLong(record.date) : '']
          .filter(Boolean)
          .join(' · '),
      });
    }
    if (!items.length) {
      toast('사진을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', { tone: 'error' });
      return;
    }
    openLightbox(items, Math.min(startIndex, items.length - 1));
  }

  async function showPhotos(reportId, groupKey, startIndex) {
    const report = reportsById.get(reportId);
    if (!report) return;
    const photos = report.photos?.[groupKey] || [];
    if (!photos.length) return;

    const items = [];
    for (const photo of photos) {
      const url = await store.photoFullUrl(photo);
      if (!url) continue;
      items.push({
        url,
        caption: [
          `${GROUP_LABEL[groupKey] || '현장 사진'}`,
          photo.caption || '',
          `${fmtDateLong(report.date)} ${fmtTime(report.time)} · ${report.leader} ${report.leaderRole || '팀장'}`,
        ]
          .filter(Boolean)
          .join(' · '),
      });
    }
    if (!items.length) {
      toast('사진을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', { tone: 'error' });
      return;
    }
    openLightbox(items, Math.min(startIndex, items.length - 1));
  }

  /* ---------------- events ---------------- */

  function fillPhoneField(phone) {
    const phoneInput = $('#cust-phone', container);
    if (phoneInput) {
      phoneInput.value = phone;
      phoneInput.focus({ preventScroll: true });
    }
  }

  async function onSubmit(event) {
    if (event.target.matches('[data-customer-complaint-form]')) {
      event.preventDefault();
      await submitComplaint(event.target);
      return;
    }
    if (event.target.id === 'customer-profile-form') {
      event.preventDefault();
      const name = $('#cp-name', container)?.value || '';
      const title = $('#cp-title', container)?.value || '';
      const email = $('#cp-email', container)?.value || '';
      if (!name.trim()) {
        toast('담당자 이름을 입력해 주세요.', { tone: 'error' });
        return;
      }
      try {
        await store.updateCustomerContact(state.session.accountId, { name, title, email }, { actor: state.session });
        toast('담당자 정보를 저장했습니다. 견적서 · 계약서 담당자 칸에도 반영됩니다.');
        await render();
      } catch (error) {
        toast(error.message || '담당자 정보를 저장하지 못했습니다.', { tone: 'error' });
      }
      return;
    }

    if (event.target.id === 'customer-login') {
      event.preventDefault();
      const phone = $('#cust-phone', container)?.value || '';
      const code = $('#cust-code', container)?.value || '';
      const nameRaw = $('#cust-name', container)?.value || '';
      const titleInput = $('#cust-title', container)?.value || '';
      const email = $('#cust-email', container)?.value || '';
      const [name, ...rest] = nameRaw.trim().split(/\s+/);
      state.loginError = '';
      try {
        const session = await loginCustomer({ phone, code, name, title: titleInput || rest.join(' '), email });
        clearPendingInvite();
        toast(`${session.name}님, ${session.title || ''} · 우리 현장 방에 입장했습니다.`);
        await render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (error) {
        state.loginError = error.message || '입장에 실패했습니다.';
        await render();
        const phoneInput = $('#cust-phone', container);
        if (phoneInput) phoneInput.focus();
      }
      return;
    }

    if (event.target.id === 'room-code-form') {
      event.preventDefault();
      const code = $('#room-code', container)?.value || '';
      state.codeError = '';
      try {
        const { code: redeemed } = await redeemRoomCode(state.session, code);
        toast(`1회용 청소코드 ${redeemed.code} 인증 완료 · 방이 열렸습니다.`);
        await render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (error) {
        state.codeError = error.message || '코드를 확인하지 못했습니다.';
        await render();
        const input = $('#room-code', container);
        if (input) input.focus();
      }
      return;
    }
  }

  async function showQuotePhotos(quoteId, startIndex) {
    const quote = await store.getQuote(quoteId, { actor: state.session }).catch(() => null);
    if (!quote) return;
    const items = [];
    for (const photo of quote.photos || []) {
      const url = await store.photoFullUrl(photo);
      if (url) items.push({ url, caption: photo.caption || '견적 방문 · 현장 사진' });
    }
    if (!items.length) {
      toast('사진을 불러오지 못했습니다.', { tone: 'error' });
      return;
    }
    openLightbox(items, Math.min(startIndex, items.length - 1));
  }

  async function saveContractMemo(agreementId) {
    const value = $('#contract-memo', container)?.value || '';
    try {
      await store.updateAgreementMeta(agreementId, { contractMemo: value });
      await render();
      toast('특이사항을 저장했습니다.');
    } catch (error) {
      toast(error.message || '특이사항을 저장하지 못했습니다.', { tone: 'error' });
    }
  }

  async function uploadBizLicense(agreementId, files) {
    const file = Array.from(files || [])[0];
    if (!file) return;
    try {
      toast('사업자등록증 처리 중…', { duration: 1200 });
      const prepared = await preparePhoto(file);
      const ref = await store.savePhoto({
        dataUrl: prepared.dataUrl,
        thumb: prepared.thumb,
        width: prepared.width,
        height: prepared.height,
        caption: '고객사 사업자등록증',
      });
      await store.updateAgreementMeta(agreementId, { bizLicense: ref });
      await render();
      toast('사업자등록증을 저장했습니다.');
    } catch (error) {
      toast(error.message || '사업자등록증을 저장하지 못했습니다.', { tone: 'error' });
    }
  }

  async function onChange(event) {
    const complaintPhoto = event.target.closest('[data-customer-complaint-photo]');
    if (complaintPhoto) {
      const files = Array.from(complaintPhoto.files || []);
      complaintPhoto.value = '';
      await addComplaintPhotos(files);
      return;
    }
    const input = event.target.closest('[data-biz-license-input]');
    if (!input) return;
    const files = Array.from(input.files || []);
    input.value = '';
    await uploadBizLicense(input.dataset.bizLicenseInput, files);
  }

  /* ---------------- 10단계 — 불편 사항 접수 · 사진 ---------------- */

  async function addComplaintPhotos(files) {
    const room = 4 - (state.complaint.photos.length || 0);
    const list = Array.from(files || []).slice(0, Math.max(0, room));
    if (!list.length) {
      toast('사진은 최대 4장까지 첨부할 수 있습니다.', { tone: 'error' });
      return;
    }
    try {
      toast('사진 처리 중…', { duration: 1000 });
      for (const file of list) {
        const prepared = await preparePhoto(file);
        const ref = await store.savePhoto({
          dataUrl: prepared.dataUrl,
          thumb: prepared.thumb,
          width: prepared.width,
          height: prepared.height,
          caption: '불편 사항 사진',
        });
        state.complaint.photos.push(ref);
      }
      await render();
    } catch (error) {
      toast(error.message || '사진을 첨부하지 못했습니다.', { tone: 'error' });
    }
  }

  async function submitComplaint(form) {
    const siteId = (state.site && state.site.id) || (state.session && state.session.siteId) || '';
    if (!state.session || !siteId) return;
    const title = form.querySelector('[data-customer-complaint-title]')?.value || '';
    const type = form.querySelector('[data-customer-complaint-type]')?.value || 'etc';
    const content = form.querySelector('[data-customer-complaint-content]')?.value || '';
    if (!content.trim()) {
      toast('불편 사항 내용을 적어 주세요.', { tone: 'error' });
      return;
    }
    const button = form.querySelector('button[type=submit]');
    if (button) button.disabled = true;
    try {
      const saved = await store.addComplaint(
        {
          siteId,
          title,
          type,
          content,
          photos: state.complaint.photos.slice(),
          actor: state.session.name,
        },
        { actor: state.session },
      );
      state.complaint = { photos: [] };
      await render();
      toast(`불편 사항을 접수했습니다. (${saved.no || ''}) 대표가 확인하고 조치 내용을 알려 드립니다.`, { duration: 9000 });
      const panel = $('[data-customer-complaints]', container);
      if (panel) panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (error) {
      if (button) button.disabled = false;
      toast(error.message || '접수하지 못했습니다. 잠시 후 다시 시도해 주세요.', { tone: 'error' });
    }
  }

  async function openComplaintPhotos(complaintId, startIndex) {
    const row = (state.complaints || []).find((item) => item.id === complaintId);
    if (!row) return;
    const items = [];
    for (const photo of row.photos || []) {
      const url = await store.photoFullUrl(photo);
      if (url) items.push({ url, caption: row.title || '불편 사항 사진' });
    }
    if (!items.length) {
      toast('사진을 불러오지 못했습니다.', { tone: 'error' });
      return;
    }
    openLightbox(items, Math.min(Number(startIndex) || 0, items.length - 1));
  }

  /* ---------------- 7단계 — 추가 견적 승인 / 보류 ---------------- */

  async function decideExtraQuote(quoteId, decision, button) {
    const approved = decision === 'approved';
    const ok = await confirmDialog({
      title: approved ? '추가 작업을 진행할까요?' : '이번에는 진행하지 않을까요?',
      message: approved
        ? '승인하시면 코리아 에코크린에서 작업 일정을 잡아 안내드립니다.'
        : '보류로 기록됩니다. 필요하실 때 다시 문의하실 수 있습니다.',
      confirmLabel: approved ? '승인' : '보류',
    });
    if (!ok) return;
    if (button) button.disabled = true;
    try {
      await store.decideExtraQuote(quoteId, {
        decision: approved ? 'approved' : 'declined',
        by: state.session ? state.session.name : '',
        actor: state.session,
      });
      await render();
      toast(
        approved
          ? '추가 작업 견적을 승인했습니다. 일정은 코리아 에코크린에서 안내드립니다.'
          : '보류로 기록했습니다. 필요하실 때 다시 문의해 주세요.',
        { duration: 8000 },
      );
    } catch (error) {
      if (button) button.disabled = false;
      toast(error.message || '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.', { tone: 'error' });
    }
  }

  async function onClick(event) {
    const extraAccept = event.target.closest('[data-extra-quote-accept]');
    if (extraAccept) {
      await decideExtraQuote(extraAccept.dataset.extraQuoteAccept, 'approved', extraAccept);
      return;
    }
    const extraDecline = event.target.closest('[data-extra-quote-decline]');
    if (extraDecline) {
      await decideExtraQuote(extraDecline.dataset.extraQuoteDecline, 'declined', extraDecline);
      return;
    }

    const complaintPhoto = event.target.closest('[data-complaint-photo]');
    if (complaintPhoto) {
      await openComplaintPhotos(complaintPhoto.dataset.complaintPhoto, complaintPhoto.dataset.complaintPhotoIndex);
      return;
    }

    const reportPrint = event.target.closest('[data-report-print]');
    if (reportPrint) {
      await openReportSheet(reportPrint.dataset.reportPrint, { actor: state.session });
      return;
    }

    const roomTab = event.target.closest('[data-room-tab]');
    if (roomTab) {
      state.roomTab = roomTab.dataset.roomTab;
      await render();
      return;
    }

    const quotePhoto = event.target.closest('[data-quote-photo]');
    if (quotePhoto) {
      await showQuotePhotos(quotePhoto.dataset.quotePhoto, Number(quotePhoto.dataset.quotePhotoIndex) || 0);
      return;
    }

    const saveMemo = event.target.closest('[data-save-contract-memo]');
    if (saveMemo) {
      await saveContractMemo(saveMemo.dataset.saveContractMemo);
      return;
    }

    const openQuote = event.target.closest('[data-open-quote]');
    if (openQuote) {
      await openQuoteSheet(openQuote.dataset.openQuote, { role: 'customer', onChanged: render });
      return;
    }

    const openAgreement = event.target.closest('[data-open-agreement]');
    if (openAgreement) {
      await openAgreementSheet(openAgreement.dataset.openAgreement, { role: 'customer', onChanged: render });
      return;
    }

    const fill = event.target.closest('[data-fill-phone]');
    if (fill) {
      fillPhoneField(fill.dataset.fillPhone);
      return;
    }

    const fillCode = event.target.closest('[data-fill-code]');
    if (fillCode) {
      const input = $('#room-code', container) || $('#cust-code', container);
      if (input) {
        input.value = fillCode.dataset.fillCode;
        input.focus({ preventScroll: true });
      }
      return;
    }

    const previewButton = event.target.closest('[data-preview-site]');
    if (previewButton) {
      state.previewCode = previewButton.dataset.previewSite;
      await render();
      return;
    }

    const filterButton = event.target.closest('[data-filter]');
    if (filterButton) {
      state.filter = filterButton.dataset.filter;
      await render();
      return;
    }

    const baselinePhoto = event.target.closest('[data-baseline-stage]');
    if (baselinePhoto) {
      await showBaselinePhotos(baselinePhoto.dataset.baselineStage, Number(baselinePhoto.dataset.baselineIndex) || 0);
      return;
    }

    const photoButton = event.target.closest('[data-photo-report]');
    if (photoButton) {
      await showPhotos(
        photoButton.dataset.photoReport,
        photoButton.dataset.photoGroup,
        Number(photoButton.dataset.photoIndex) || 0,
      );
      return;
    }

    const checkToggle = event.target.closest('[data-check-toggle]');
    if (checkToggle) {
      const id = checkToggle.dataset.checkToggle;
      const list = $(`[data-check-list="${id}"]`, container);
      const expanded = checkToggle.getAttribute('aria-expanded') === 'true';
      checkToggle.setAttribute('aria-expanded', String(!expanded));
      if (list) list.hidden = expanded;
      return;
    }

    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;

    if (action === 'logout') {
      await logout();
      state.session = null;
      state.site = null;
      state.filter = 'all';
      state.roomTab = '';
      state.loginError = '';
      state.codeError = '';
      toast('로그아웃했습니다.');
      await render();
      return;
    }
    if (action === 'copy-code') {
      const ok = await copyText(state.site?.code || '');
      toast(ok ? `${state.site?.code} 코드를 복사했습니다.` : '복사가 차단되었습니다.');
      return;
    }
    if (action === 'toggle-sort') {
      state.sort = state.sort === 'desc' ? 'asc' : 'desc';
      await render();
    }
  }

  function mount() {
    if (mounted) return;
    container.addEventListener('submit', onSubmit);
    container.addEventListener('click', onClick);
    container.addEventListener('change', onChange);
    mounted = true;
  }

  async function focusSite(code) {
    if (code) state.previewCode = code;
    await render();
  }

  return { render, focusSite };
}
