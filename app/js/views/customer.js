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
} from '../ui.js';
import { store, countReportPhotos } from '../store.js';
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
    return `
      <section class="panel auth-card">
        <span class="eyebrow">${icons.clipboard} 고객사 전용 방</span>
        <h2>우리 현장 청소 기록</h2>
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
          <div class="field">
            <label for="cust-code">1회용 청소코드 <span class="tiny muted">(처음 한 번만)</span></label>
            <input class="input" id="cust-code" type="text" inputmode="text" autocomplete="off" spellcheck="false"
                   placeholder="예: C-7F3K9Q" maxlength="12">
            <span class="field__hint">등록된 번호는 비워 두고 입장하세요.</span>
          </div>
          <div class="field">
            <label for="cust-name">이름 <span class="tiny muted">(선택)</span></label>
            <input class="input" id="cust-name" type="text" autocomplete="name" placeholder="예: 정하윤 총무" maxlength="20">
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
    if (!groups.length) {
      box.innerHTML = '<p class="tiny muted">발급된 코드가 없습니다. 관리자 화면에서 발급하세요.</p>';
      return;
    }
    box.innerHTML = groups
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
            <span>${esc(report.leader)} ${esc(report.leaderRole || '팀장')}${report.durationMin ? ` · ${report.durationMin}분` : ''}</span>
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
        </div>
      </article>
    `;
  }

  function listTemplate(reports) {
    if (!reports.length) {
      return `
        <div class="empty">
          <strong>아직 남겨진 보고가 없습니다</strong>
          <span>방문 후 팀장이 보고를 등록하면 이곳에 표시됩니다.</span>
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

  function roomTemplate(site, stats, viewer) {
    const meta = CATEGORY_META[site.category] || {};
    const last = stats.last;
    const reports = filterReports(stats.reports);
    const nextLabel = stats.nextDate ? `${fmtDateLong(stats.nextDate)} 예정` : '일정 확인 필요';

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
          <div class="site-head__stat"><strong>${last ? `${daysBetween(last.date)}일` : '-'}</strong><span>마지막 방문</span></div>
        </div>
        <div class="site-head__actions">
          <button class="link-btn" type="button" data-action="copy-code">현장 코드 복사</button>
          <button class="link-btn" type="button" data-action="toggle-sort">${state.sort === 'desc' ? '최신순' : '오래된순'}</button>
          ${viewer.preview ? '' : '<button class="link-btn" type="button" data-action="logout">로그아웃</button>'}
        </div>
      </section>

      <section class="panel">
        <dl class="kv kv--left">
          <dt>${viewer.preview ? '보는 사람' : '입장 계정'}</dt><dd>${esc(viewer.name)} ${esc(viewer.title || '')} · ${esc(viewer.phone || '')}${viewer.preview ? ' (미리보기)' : ''}</dd>
          <dt>다음 방문</dt><dd>${esc(nextLabel)}</dd>
          <dt>출입 안내</dt><dd>${esc(site.accessNote || '-')}</dd>
          <dt>최근 방문</dt><dd>${last ? `${esc(fmtDateLong(last.date))} ${esc(fmtTime(last.time))}` : '기록 없음'}</dd>
        </dl>
        <p class="hint" style="margin-top:10px">
          이 방에는 ${esc(site.clientName)} 현장 기록만 표시됩니다. 다음 방문일은 정기 주기를 기준으로 계산한 예상일입니다.
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
      </section>
    `;
  }

  /* ---------------- render ---------------- */

  async function render(options = {}) {
    const token = (renderToken += 1);
    mount();
    if (options && options.siteCode) state.previewCode = options.siteCode;

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
    const site = await store.getSite(session.siteId);
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

    const stats = await store.statsForSite(site);
    if (token !== renderToken) return;

    reportsById.clear();
    stats.reports.forEach((report) => reportsById.set(report.id, report));
    container.innerHTML = roomTemplate(site, stats, { ...session, preview: false });
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

    const stats = await store.statsForSite(site);
    reportsById.clear();
    stats.reports.forEach((report) => reportsById.set(report.id, report));

    const viewer = {
      name: session.name,
      title: session.title || (session.role === 'admin' ? '대표' : '팀장'),
      phone: session.phone || '',
      preview: true,
    };

    container.innerHTML = previewBanner(session, site, pool) + roomTemplate(site, stats, viewer);
  }

  /* ---------------- lightbox ---------------- */

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
    if (event.target.id === 'customer-login') {
      event.preventDefault();
      const phone = $('#cust-phone', container)?.value || '';
      const code = $('#cust-code', container)?.value || '';
      const nameRaw = $('#cust-name', container)?.value || '';
      const [name, ...rest] = nameRaw.trim().split(/\s+/);
      state.loginError = '';
      try {
        const session = await loginCustomer({ phone, code, name, title: rest.join(' ') });
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

  async function onClick(event) {
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
    mounted = true;
  }

  async function focusSite(code) {
    if (code) state.previewCode = code;
    await render();
  }

  return { render, focusSite };
}
