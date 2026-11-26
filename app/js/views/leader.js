/**
 * views/leader.js — 현장 보고 (팀장용)
 *
 * 입장: 전화번호 + 비밀번호 + 팀장 고유코드 (대표가 발급/관리)
 * 보고: ① 시건장치 확인 사진 ② 업장별 맞춤 청소 사진 ③ 특이사항 사진(선택) + 점검 항목 + 메모
 * 등록한 보고는 고객 방에 바로 표시됩니다.
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
} from '../ui.js';
import { store, StoreError, countReportPhotos, AGREEMENT_STATUS, canUseSupply } from '../store.js';
import { CATEGORY_META, PHOTO_GROUPS, STAFF_TYPES } from '../seed.js';
import { getSession, loginStaff, loginStaffInvite, logout, demoAccounts, demoStaffCodes } from '../auth.js';
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
    };
  }

  function ensureDraft(session, site) {
    if (!state.draft || state.draft.checks.length !== site.checklist.length) startDraft(session, site);
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
        <p class="hint" style="margin-top:10px">등록된 보고는 고객의 전용 방에 바로 표시됩니다.</p>
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
          ? myDocsTemplate(state.myContracts) ||
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
            <strong>${esc(session.name)} ${esc(session.title || '팀장')}${isAdmin ? ' · 대표' : ''}</strong>
            <span>${esc(session.phone || '')} · ${esc(fmtDateLong(toISODate()))}</span>
          </div>
        </div>
        <button class="btn btn--sm btn--quiet" type="button" data-action="logout">로그아웃</button>
      </div>
    `;
  }

  /* ---------------- report form ---------------- */

  function photoSectionTemplate(group, site, draft, index) {
    const photos = draft.photos[group.key] || [];
    const label = group.key === 'cleaning'
      ? `${CATEGORY_META[site.category]?.cleaningLabel || group.label} 사진`
      : `${group.label} 사진`;
    const required = group.required;

    return `
      <section class="panel photo-panel photo-panel--${group.key}">
        <div class="section-head">
          <h2><span class="step-badge">${index + 1}</span>${esc(label)} ${required ? '<span class="req">*</span>' : '<span class="opt">선택</span>'}</h2>
          <p><span data-photo-count="${group.key}">${photos.length}</span>장</p>
        </div>
        <p class="tiny muted" style="margin:-6px 0 10px">${esc(group.hint)}</p>
        <label class="upload-zone" for="photo-${group.key}">
          ${icons.camera}
          <strong>${group.key === 'issue' ? '특이사항 사진 추가' : '사진 촬영 · 선택'}</strong>
          <span>여러 장을 한 번에 올릴 수 있습니다 · 자동 압축 저장</span>
        </label>
        <input id="photo-${group.key}" data-photo-input="${group.key}" type="file"
               accept="image/*" capture="environment" multiple hidden>
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
            const status = AGREEMENT_STATUS[contract.status] || AGREEMENT_STATUS.draft;
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
                const status = AGREEMENT_STATUS[contract.status] || AGREEMENT_STATUS.draft;
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

  function baselinePanelTemplate(site) {
    const baseline = site.baseline || {};
    const row = (key, num, label, hint, record) => {
      const photos = (record && record.photos) || [];
      return `
        <div class="baseline-row">
          <div class="baseline-row__who">
            <strong>${num} ${esc(label)}</strong>
            <span>${record && record.date ? esc(fmtDateLong(record.date)) : '날짜 미등록'} · ${photos.length}장</span>
          </div>
          <div class="baseline-row__thumbs">
            ${photos
              .slice(0, 4)
              .map((photo) => `<img src="${esc(store.photoThumbUrl(photo))}" alt="${esc(photo.caption || label)}" loading="lazy" decoding="async">`)
              .join('')}
          </div>
          <label class="btn btn--quiet btn--sm baseline-row__add">
            사진 추가
            <input type="file" accept="image/*" capture="environment" multiple hidden
                   data-leader-baseline="${key}" data-site-id="${esc(site.id)}">
          </label>
          <p class="hint" style="margin:0">${esc(hint)}</p>
        </div>`;
    };

    return `
      <section class="panel">
        <div class="section-head">
          <h2>처음 상태 사진</h2>
          <p>첫 견적 · 대청소</p>
        </div>
        <p class="tiny muted" style="margin:-6px 0 10px">
          고객이 “예전 상태”와 비교할 수 있도록, 첫 견적(오염 상태)과 첫 대청소 후 사진을 현장에 남깁니다.
        </p>
        ${row('quote', '①', '첫 견적 · 오염 상태', '방문 견적 시점의 오염 상태를 남겨 주세요.', baseline.quote)}
        ${row('deepClean', '②', '첫 청소 · 대청소', '첫 대청소를 마친 뒤 결과 사진을 남겨 주세요.', baseline.deepClean)}
      </section>
    `;
  }

  function formTemplate(session, site) {
    const draft = ensureDraft(session, site);
    const meta = CATEGORY_META[site.category] || {};

    return `
      ${leaderBarTemplate(session)}
      ${state.sent ? sentTemplate(state.sent) : ''}

      ${opsCardTemplate(site)}

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

      ${PHOTO_GROUPS.map((group, index) => photoSectionTemplate(group, site, draft, index)).join('')}

      <section class="panel">
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
      </section>

      <section class="panel">
        <div class="section-head">
          <h2>전달 메모</h2>
          <p>고객에게 전달</p>
        </div>
        <textarea class="textarea" id="r-note" rows="4" placeholder="예: 회의실 카펫 얼룩 제거 완료, 핸드타월 2박스 보충했습니다.">${esc(draft.note)}</textarea>
        <div class="memo-chips">
          ${MEMO_CHIPS.map((chip) => `<button class="memo-chip" type="button" data-memo="${esc(chip)}">+ ${esc(chip)}</button>`).join('')}
        </div>
      </section>

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
          <strong>보고가 등록되었습니다</strong>
          <p>${esc(sent.siteName)} · ${esc(fmtDateLong(sent.date))} ${esc(fmtTime(sent.time))}<br>
          시건장치 ${sent.photos.security.length}장 · 맞춤 청소 ${sent.photos.cleaning.length}장 · 특이사항 ${sent.photos.issue.length}장 ·
          점검 ${sent.doneCount}/${sent.totalCount}</p>
        </div>
        <div class="btn-row">
          <button class="btn btn--primary btn--sm" type="button" data-action="view-customer">고객 화면 보기</button>
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
        (report) => `
          <div class="my-report">
            <div>
              <strong>${esc(names.get(report.siteId) || report.siteName)}</strong>
              <span>${esc(fmtDateLong(report.date))} ${esc(fmtTime(report.time))} · 사진 ${countReportPhotos(report)}장</span>
            </div>
            <button class="link-btn" style="background:var(--surface-3);color:var(--body);border-color:var(--line)"
                    type="button" data-delete-report="${esc(report.id)}">삭제</button>
          </div>`,
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
      state.staffCodes = await demoStaffCodes().catch(() => []);
      container.innerHTML = gateTemplate();
      return;
    }

    const sites = await store.listSites();
    const assigned = state.session.assignedSiteIds || [];
    const allowed = assigned.length
      ? sites.filter((site) => assigned.includes(site.id))
      : state.session.role === 'admin'
        ? sites
        : [];
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

  async function addBaselinePhotos(siteId, stage, files) {
    const site = await store.getSite(siteId);
    if (!site) return;
    const record = (site.baseline && site.baseline[stage]) || { date: '', note: '', photos: [] };
    const added = [];
    for (const file of Array.from(files || [])) {
      try {
        toast('사진 처리 중…', { duration: 1200 });
        const prepared = await preparePhoto(file);
        added.push(
          await store.savePhoto({
            dataUrl: prepared.dataUrl,
            thumb: prepared.thumb,
            width: prepared.width,
            height: prepared.height,
            caption: stage === 'quote' ? '첫 견적 · 오염 상태' : '첫 청소 · 대청소',
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
      photos: (record.photos || []).concat(added),
      date: record.date || toISODate(),
      note: record.note || (stage === 'quote' ? '첫 견적 방문 · 오염 상태 기록' : '첫 청소(대청소) 완료 기록'),
    });
    toast(`${stage === 'quote' ? '첫 견적(오염)' : '첫 청소(대청소)'} 사진 ${added.length}장을 현장에 저장했습니다.`);
    await render();
  }

  async function addFiles(groupKey, files) {
    const draft = state.draft;
    if (!draft || !files || !files.length) return;
    const list = Array.from(files);
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
    if (!draft.checks.some(Boolean)) {
      toast('완료한 점검 항목을 1개 이상 선택해 주세요.', { tone: 'error' });
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
        durationMin: draft.duration,
        checklist: site.checklist.map((label, index) => ({ label, done: !!draft.checks[index] })),
        note: draft.note,
        issueNote: draft.issueNote,
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
      toast('보고를 등록했습니다. 고객 방에 바로 표시됩니다.', {
        actionLabel: '고객 화면',
        onAction: () => goToCustomer(),
      });
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

    const baselineInput = target.closest('[data-leader-baseline]');
    if (baselineInput) {
      const files = Array.from(baselineInput.files || []);
      baselineInput.value = '';
      await addBaselinePhotos(baselineInput.dataset.siteId, baselineInput.dataset.leaderBaseline, files);
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

    const pick = event.target.closest('[data-pick-site]');
    if (pick) {
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

    const memo = event.target.closest('[data-memo]');
    if (memo) {
      const draft = state.draft;
      if (!draft) return;
      const chip = memo.dataset.memo;
      if (!draft.note.includes(chip)) draft.note = draft.note ? `${draft.note.trim()} ${chip}` : chip;
      const note = $('#r-note', container);
      if (note) note.value = draft.note;
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
      await render();
      toast('로그아웃했습니다.');
      return;
    }
    if (action === 'change-site') {
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
