/**
 * views/admin-docs.js — 관리(대표) 화면의 견적 · 계약 · 직원 계약 서식들.
 *
 * 화면 상태는 admin.js가 들고 있고, 이 파일은 HTML 조각만 만듭니다.
 */

import { esc, fmtWon } from '../ui.js';
import {
  QUOTE_STATUS,
  AGREEMENT_STATUS,
  isAgreementClosed,
  STAFF_STATUS,
  SURVEY_PHOTO_AREAS,
  QUOTE_DIFFICULTIES,
  QUOTE_TEAM_SIZES,
} from '../store.js';
import { CATEGORY_META, STAFF_TYPES, SUPPLIER, PAYMENT_ACCOUNT, APP_URL, DEFAULT_CHECKLISTS } from '../seed.js';
import { inviteUrl, quoteSmsHref, quoteMailtoHref } from '../invite.js';

const money = (value) => esc(fmtWon(value));

/** 카테고리별 기본 청소 범위 (폼 자동 채우기). */
export function defaultScope(category) {
  return (DEFAULT_CHECKLISTS[category] || DEFAULT_CHECKLISTS.office).join(', ');
}

export function staffInviteMessage(contract) {
  const meta = STAFF_TYPES[contract.employmentType] || STAFF_TYPES.freelancer;
  return [
    `[코리아 에코크린] ${contract.name}님, ${meta.label}가 도착했습니다.`,
    '아래 링크를 누르면 초대코드가 입력된 화면이 열립니다. 내 계약서를 확인하고 전자서명하실 수 있습니다.',
    `링크: ${inviteUrl(contract.inviteCode)}`,
    `1회용 코드: ${contract.inviteCode}`,
    `문의: ${SUPPLIER.phone}`,
  ].join('\n');
}

/** 정기청소 현장 1회용 코드(추가 인원) 초대 문구. */
export function roomCodeInviteMessage(siteName, code) {
  return [
    `[코리아 에코크린] ${siteName || '현장'} 담당자님, 청소 확인 방 초대입니다.`,
    '아래 링크를 누르면 초대코드가 입력된 화면이 열립니다. 전화번호를 넣고 입장하세요.',
    `링크: ${inviteUrl(code)}`,
    `1회용 코드: ${code}`,
    `문의: ${SUPPLIER.phone}`,
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* 견적 · 계약                                                         */
/* ------------------------------------------------------------------ */

export function quoteFormTemplate(state) {
  const draft = state.newQuote || { photos: [] };
  const categoryOptions = Object.entries(CATEGORY_META)
    .map(([key, meta]) => `<option value="${esc(key)}">${esc(meta.label)}</option>`)
    .join('');

  return `
    <details class="settings new-site" ${state.newQuoteOpen ? 'open' : ''}>
      <summary>+ 새 견적 등록 (고객 초대 포함)</summary>
      <div class="settings__body">
        <form class="form" id="new-quote-form" novalidate>
          <p class="details-head">고객사 정보</p>
          <div class="field">
            <label for="nq-company">고객사명 · 상호 <span class="req">*</span></label>
            <input class="input" id="nq-company" type="text" placeholder="예: 그린피스 오피스 신정점" maxlength="60" required>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="nq-category">업종</label>
              <select class="select" id="nq-category">${categoryOptions}</select>
            </div>
            <div class="field">
              <label for="nq-area">면적 · 평수 <span class="tiny muted">(선택)</span></label>
              <input class="input" id="nq-area" type="text" placeholder="예: 약 110㎡ (33평)" maxlength="30">
            </div>
          </div>
          <div class="field">
            <label for="nq-address">소재지</label>
            <input class="input" id="nq-address" type="text" placeholder="예: 서울 양천구 신정로 123, 8층" maxlength="120">
          </div>
          <div class="field-row">
            <div class="field">
              <label for="nq-contact">담당자명</label>
              <input class="input" id="nq-contact" type="text" placeholder="예: 서지훈 과장" maxlength="30">
            </div>
            <div class="field">
              <label for="nq-phone">연락처</label>
              <input class="input" id="nq-phone" type="tel" inputmode="tel" placeholder="010-0000-0000" maxlength="20">
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="nq-biz">사업자등록번호 <span class="tiny muted">(선택)</span></label>
              <input class="input" id="nq-biz" type="text" inputmode="numeric" placeholder="000-00-00000" maxlength="20">
            </div>
            <div class="field">
              <label for="nq-ceo">대표자 <span class="tiny muted">(계약서 자동 연동)</span></label>
              <input class="input" id="nq-ceo" type="text" placeholder="예: 박한빛" maxlength="30">
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="nq-email">담당자 이메일 <span class="tiny muted">(초대 메일)</span></label>
              <input class="input" id="nq-email" type="email" inputmode="email" placeholder="예: name@company.com" maxlength="60">
            </div>
            <div class="field">
              <label for="nq-tax">세금계산서 이메일 <span class="tiny muted">(선택)</span></label>
              <input class="input" id="nq-tax" type="email" inputmode="email" placeholder="예: tax@company.com" maxlength="60">
            </div>
          </div>

          <p class="details-head">청소 범위 · 주기</p>
          <div class="field">
            <label for="nq-frequency">청소 주기</label>
            <input class="input" id="nq-frequency" type="text" value="주 2회 (화 · 금)" maxlength="40">
          </div>
          <div class="field">
            <label for="nq-scope">기본 청소 범위</label>
            <textarea class="textarea" id="nq-scope" rows="3" placeholder="쓰레기 분리수거, 바닥 청소 등">${esc(defaultScope('office'))}</textarea>
            <span class="field__hint">업종을 바꾸면 기본 범위가 자동으로 채워집니다.</span>
          </div>
          <div class="field">
            <label for="nq-extra">추가 업무 · 공정 <span class="tiny muted">(선택)</span></label>
            <textarea class="textarea" id="nq-extra" rows="2" placeholder="예: 회의실 카펫 흡입, 출입구 유리"></textarea>
          </div>

          <p class="details-head">금액 · 기간</p>
          <div class="field-row">
            <div class="field">
              <label for="nq-amount">월 계약금액(원) <span class="req">*</span></label>
              <input class="input" id="nq-amount" type="number" inputmode="numeric" min="0" step="1000" placeholder="예: 1900000" required>
            </div>
            <div class="field">
              <label for="nq-vat">부가세</label>
              <select class="select" id="nq-vat">
                <option value="excluded">별도 (기본)</option>
                <option value="included">포함</option>
              </select>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="nq-billing">결제일</label>
              <input class="input" id="nq-billing" type="number" inputmode="numeric" min="1" max="31" value="1">
            </div>
            <div class="field">
              <label for="nq-months">계약기간(개월)</label>
              <input class="input" id="nq-months" type="number" inputmode="numeric" min="1" max="120" value="12">
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="nq-start">시작일</label>
              <input class="input" id="nq-start" type="date">
            </div>
            <div class="field">
              <label for="nq-valid">견적 유효기간</label>
              <input class="input" id="nq-valid" type="date">
            </div>
          </div>
          <div class="field">
            <label for="nq-terms">특약사항 (계약서 제16조)</label>
            <textarea class="textarea" id="nq-terms" rows="2" placeholder="예: 계약 첫 달은 대청소를 포함하여 진행합니다."></textarea>
          </div>
          <div class="field">
            <label for="nq-memo">비고</label>
            <textarea class="textarea" id="nq-memo" rows="2" placeholder="예: 주차는 건물 방문 주차 1시간 지원 예정"></textarea>
          </div>

          <div class="field">
            <label>현장 오염상태 사진 <span class="tiny muted">(계약 시 첫 견적 사진으로 연결)</span></label>
            <div class="new-site-photos" data-new-quote-photos>
              ${(draft.photos || [])
                .map((photo) => `<img src="${esc(photo.thumb || photo.dataUrl || '')}" alt="현장 오염 사진" decoding="async">`)
                .join('')}
              <label class="new-site-photos__add">
                <span>+</span>
                <input type="file" accept="image/*" multiple hidden data-new-quote-photo>
              </label>
            </div>
            <span class="field__hint">사진은 기기에서 1600px JPEG로 압축해 저장됩니다.</span>
          </div>

          ${state.newQuoteError ? `<p class="field__error">${esc(state.newQuoteError)}</p>` : ''}
          <button class="btn btn--primary btn--block" type="submit">견적 저장 · 초대코드 발급</button>
          <p class="hint">저장하면 고객에게 보낼 1회용 초대코드가 자동 발급됩니다. 초대 문구를 복사해 문자·카톡으로 보내세요.</p>
        </form>
      </div>
    </details>`;
}

function quoteCardTemplate(quote, agreement) {
  const status = QUOTE_STATUS[quote.status] || QUOTE_STATUS.draft;
  const meta = CATEGORY_META[quote.clientCategory] || {};
  const inviteState = quote.inviteUsedAt
    ? `사용 완료 · ${String(quote.inviteUsedAt).slice(0, 10)}`
    : quote.status === 'contracted'
      ? '계약 체결'
      : '미사용';

  return `
    <article class="quote-card" data-quote-card="${esc(quote.id)}">
      <header class="quote-card__head">
        <div>
          <strong>${esc(quote.clientCompany)}</strong>
          <span>${esc(quote.no)} · ${esc(meta.short || '')} · ${esc(quote.frequency)}</span>
        </div>
        <span class="badge ${status.badge}">${esc(status.label)}</span>
      </header>
      <p class="quote-card__amount">월 ${money(quote.amount)} <em>${quote.vatIncluded ? '부가세 포함' : '부가세 별도'}</em></p>
      <p class="quote-card__contact">
        담당자 <strong>${esc(quote.clientContact || '미등록')}</strong>${quote.clientPhone ? ` · ${esc(quote.clientPhone)}` : ''}${quote.clientEmail || quote.clientTaxEmail ? ` · ${esc(quote.clientEmail || quote.clientTaxEmail)}` : ''}
      </p>
      ${quote.estimate
        ? `<p class="quote-card__estimate">
             <span>기준 ${quote.estimate.base ? `${esc(fmtWon(quote.estimate.base.min))}~${esc(fmtWon(quote.estimate.base.max))}` : '미설정'}</span>
             <span>권장 ${quote.estimate.recQuote === '' ? '—' : esc(fmtWon(quote.estimate.recQuote))}</span>
             <span>조정 ${esc(fmtWon(quote.estimate.adjustmentTotal || 0))}</span>
             <span>최종 ${esc(fmtWon(quote.amount))}</span>
           </p>`
        : ''}
      ${quote.estimate
        ? quote.approval && quote.approval.status === 'approved'
          ? `<p class="tiny muted">금액 승인 완료 · ${esc(quote.approval.by || '대표')} · ${esc(String(quote.approval.at || '').slice(0, 10))} · ${esc(fmtWon(quote.approval.amount))}</p>`
          : `<p class="tiny muted">금액 승인 대기 — 대표가 승인하면 계약서가 자동으로 만들어집니다.</p>`
        : ''}
      <div class="quote-card__invite">
        <code>${esc(quote.inviteCode)}</code>
        <span>${esc(inviteState)}</span>
        <a class="invite-link" href="${esc(inviteUrl(quote.inviteCode))}" data-invite-link="${esc(quote.inviteCode)}" target="_blank" rel="noreferrer">${esc(inviteUrl(quote.inviteCode))}</a>
        <button class="link-btn" type="button" data-copy-quote-invite="${esc(quote.id)}">초대 문구 복사</button>
        <button class="link-btn" type="button" data-copy-quote-link="${esc(quote.id)}">초대 링크 복사</button>
        <a class="link-btn" href="${esc(quoteSmsHref(quote))}" data-sms-invite="${esc(quote.id)}">문자로 보내기</a>
        <a class="link-btn" href="${esc(quoteMailtoHref(quote))}" data-mail-invite="${esc(quote.id)}">메일로 보내기</a>
        <button class="link-btn" type="button" data-regen-quote-invite="${esc(quote.id)}">재발급</button>
      </div>
      <div class="quote-card__actions">
        <button class="btn btn--primary btn--sm" type="button" data-open-quote="${esc(quote.id)}">견적서 열기</button>
        <button class="btn btn--ghost btn--sm" type="button" data-edit-quote="${esc(quote.id)}">견적 수정</button>
        ${quote.estimate && (!quote.approval || quote.approval.status !== 'approved')
          ? `<button class="btn btn--primary btn--sm" type="button" data-approve-quote="${esc(quote.id)}">금액 승인</button>`
          : ''}
        ${quote.status === 'draft' ? `<button class="btn btn--ghost btn--sm" type="button" data-send-quote="${esc(quote.id)}">견적서 발송</button>` : ''}
        ${
          agreement
            ? `<button class="btn btn--quiet btn--sm" type="button" data-open-agreement="${esc(agreement.id)}">계약서 보기 · ${esc((AGREEMENT_STATUS[agreement.status] || {}).label || '')}</button>`
            : `<button class="btn btn--quiet btn--sm" type="button" data-contract-from-quote="${esc(quote.id)}">계약서로 전환</button>`
        }
      </div>
      ${
        agreement && !isAgreementClosed(agreement.status)
          ? `<p class="hint">계약서 ${esc(agreement.no)} · ${esc((AGREEMENT_STATUS[agreement.status] || {}).label || '')}${agreement.status === 'draft' ? ' — 고객에게 발송하면 서명할 수 있습니다.' : ''}</p>`
          : agreement
            ? `<p class="hint">계약서 ${esc(agreement.no)} · ${esc((AGREEMENT_STATUS[agreement.status] || {}).label || '체결')} ${esc(agreement.signedDate || '')} · 현장 자동 등록 완료</p>`
            : ''
      }
    </article>`;
}

export function customerInvitePanelTemplate({ quotes }) {
  const rows = (quotes || []).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const open = rows.filter((quote) => quote.status !== 'contracted');
  const joined = open.filter((quote) => quote.inviteUsedAt);
  const contracted = rows.filter((quote) => quote.status === 'contracted');
  return `
    <section class="panel invite-panel" data-invite-panel>
      <div class="section-head">
        <div>
          <h2>고객사 초대</h2>
          <p>현장 방문 · 견적 뒤 담당자에게 링크 한 번에 보내기</p>
        </div>
      </div>
      <div class="admin-stats">
        <div><strong>${open.length}</strong><span>초대 진행</span></div>
        <div><strong>${joined.length}</strong><span>담당자 입장</span></div>
        <div><strong>${contracted.length}</strong><span>계약 체결</span></div>
        <div><strong>${rows.length}</strong><span>전체 견적</span></div>
      </div>
      ${
        open.length
          ? `<div class="stack-10">
               ${open
                 .map(
                   (quote) => `
                 <article class="invite-row" data-invite-row="${esc(quote.id)}">
                   <header class="invite-row__head">
                     <div>
                       <strong>${esc(quote.clientCompany)}</strong>
                       <span>${esc(quote.no)} · ${esc((QUOTE_STATUS[quote.status] || {}).label || '')}</span>
                     </div>
                     <span class="badge ${quote.inviteUsedAt ? 'badge--done' : 'badge--wait'}">${quote.inviteUsedAt ? '담당자 입장' : '미입장'}</span>
                   </header>
                   <p class="invite-row__who">
                     담당자 <strong>${esc(quote.clientContact || '미등록')}</strong>${quote.clientPhone ? ` · ${esc(quote.clientPhone)}` : ''}${quote.clientEmail || quote.clientTaxEmail ? ` · ${esc(quote.clientEmail || quote.clientTaxEmail)}` : ''}
                   </p>
                   <p class="invite-row__code"><code>${esc(quote.inviteCode)}</code><span>${esc(inviteUrl(quote.inviteCode))}</span></p>
                   <div class="invite-row__actions">
                     <button class="btn btn--primary btn--sm" type="button" data-copy-quote-invite="${esc(quote.id)}">문구 복사</button>
                     <button class="btn btn--ghost btn--sm" type="button" data-copy-quote-link="${esc(quote.id)}">링크 복사</button>
                     <a class="btn btn--quiet btn--sm" href="${esc(quoteSmsHref(quote))}" data-sms-invite="${esc(quote.id)}">문자</a>
                     <a class="btn btn--quiet btn--sm" href="${esc(quoteMailtoHref(quote))}" data-mail-invite="${esc(quote.id)}">메일</a>
                     <button class="btn btn--quiet btn--sm" type="button" data-regen-quote-invite="${esc(quote.id)}">재발급</button>
                   </div>
                 </article>`,
                 )
                 .join('')}
             </div>`
          : '<p class="tiny muted">초대할 견적이 없습니다. 현장 방문 · 자동 견적에서 견적을 만들면 초대 링크가 함께 발급됩니다.</p>'
      }
      <p class="hint">
        링크를 누르면 초대코드가 입력된 입장 화면이 열립니다. 담당자는 전화번호와 코드로 입장해 담당자 정보를 확인 · 등록하고,
        견적서 확인 → 계약서 전자서명까지 자기 폰에서 끝냅니다. 링크가 한 번 쓰이면 재발급하세요.
      </p>
    </section>`;
}

export function quotePanelTemplate({ quotes, agreements, state }) {
  const signed = agreements.filter((row) => isAgreementClosed(row.status)).length;
  const sent = quotes.filter((row) => row.status === 'sent' || row.status === 'accepted').length;
  return `
    <section class="panel quote-panel" data-quote-panel>
      <div class="section-head">
        <div>
          <h2>견적 · 계약</h2>
          <p>대표 전용 · 견적서 → 고객 초대 → 계약서 → 현장 자동 등록</p>
        </div>
      </div>
      <div class="admin-stats">
        <div><strong>${quotes.length}</strong><span>견적</span></div>
        <div><strong>${sent}</strong><span>고객 확인 중</span></div>
        <div><strong>${agreements.length}</strong><span>계약서</span></div>
        <div><strong>${signed}</strong><span>체결</span></div>
      </div>
      ${quoteFormTemplate(state)}
      <div class="stack-10">
        ${
          quotes.length
            ? quotes
                .map((quote) => quoteCardTemplate(quote, agreements.find((row) => row.id === quote.contractId) || agreements.find((row) => row.quoteId === quote.id) || null))
                .join('')
            : '<p class="tiny muted">아직 등록된 견적이 없습니다. 위에서 첫 견적을 등록해 보세요.</p>'
        }
      </div>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* 직원 · 계약 관리                                                    */
/* ------------------------------------------------------------------ */

export function staffFormTemplate(state, sites) {
  const typeOptions = Object.entries(STAFF_TYPES)
    .map(([key, meta]) => `<option value="${esc(key)}">${esc(meta.label)}</option>`)
    .join('');

  return `
    <details class="settings new-site" ${state.newStaffOpen ? 'open' : ''}>
      <summary>+ 새 직원 계약 등록 (초대코드 발급)</summary>
      <div class="settings__body">
        <form class="form" id="new-staff-form" novalidate>
          <p class="details-head">직원 정보</p>
          <div class="field">
            <label for="st-type">계약 유형 <span class="req">*</span></label>
            <select class="select" id="st-type">${typeOptions}</select>
            <span class="field__hint">프리랜서(3.3% 위수탁) · 도급(팀장·하도급) · 일용직 · 알바(시급)</span>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="st-name">성명 <span class="req">*</span></label>
              <input class="input" id="st-name" type="text" placeholder="예: 한지우" maxlength="30">
            </div>
            <div class="field">
              <label for="st-title">직함</label>
              <input class="input" id="st-title" type="text" placeholder="예: 팀장" maxlength="20">
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="st-phone">연락처 <span class="req">*</span></label>
              <input class="input" id="st-phone" type="tel" inputmode="tel" placeholder="010-0000-0000" maxlength="20">
            </div>
            <div class="field">
              <label for="st-birth">생년월일</label>
              <input class="input" id="st-birth" type="date">
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="st-biz">사업자등록번호 <span class="tiny muted">(프리랜서·도급)</span></label>
              <input class="input" id="st-biz" type="text" inputmode="numeric" placeholder="000-00-00000" maxlength="20">
            </div>
            <div class="field">
              <label for="st-resident">주민번호 <span class="tiny muted">(일용직, 선택)</span></label>
              <input class="input" id="st-resident" type="text" inputmode="numeric" placeholder="000000-0" maxlength="20">
            </div>
          </div>

          <p class="details-head">계좌 · 지급</p>
          <div class="field-row">
            <div class="field">
              <label for="st-bank">은행</label>
              <input class="input" id="st-bank" type="text" value="카카오뱅크" maxlength="20">
            </div>
            <div class="field">
              <label for="st-account">계좌번호</label>
              <input class="input" id="st-account" type="text" inputmode="numeric" placeholder="000-000-000000" maxlength="30">
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="st-holder">예금주</label>
              <input class="input" id="st-holder" type="text" placeholder="예금주 성명" maxlength="30">
            </div>
            <div class="field">
              <label for="st-settle">지급일</label>
              <input class="input" id="st-settle" type="text" value="15" maxlength="10">
            </div>
          </div>

          <p class="details-head">근무 조건</p>
          <div class="field-row">
            <div class="field">
              <label for="st-monthly">월 금액(원) <span class="tiny muted">(프리랜서·도급)</span></label>
              <input class="input" id="st-monthly" type="number" inputmode="numeric" min="0" step="1000" placeholder="예: 900000">
            </div>
            <div class="field">
              <label for="st-daily">일당(원) <span class="tiny muted">(일용직)</span></label>
              <input class="input" id="st-daily" type="number" inputmode="numeric" min="0" step="1000" placeholder="예: 120000">
            </div>
          </div>
          <div class="field">
            <label for="st-hourly">시급(원) <span class="tiny muted">(알바)</span></label>
            <input class="input" id="st-hourly" type="number" inputmode="numeric" min="0" step="100" placeholder="예: 12000">
          </div>
          <div class="field-row">
            <div class="field">
              <label for="st-start">시작일</label>
              <input class="input" id="st-start" type="date">
            </div>
            <div class="field">
              <label for="st-end">종료일</label>
              <input class="input" id="st-end" type="date">
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="st-days">근무일</label>
              <input class="input" id="st-days" type="text" placeholder="예: 주 3회 (월·수·금)" maxlength="60">
            </div>
            <div class="field">
              <label for="st-hours">근무시간</label>
              <input class="input" id="st-hours" type="text" placeholder="예: 10:00 ~ 12:00" maxlength="40">
            </div>
          </div>
          <div class="field">
            <label>배정 현장</label>
            <div class="check-list check-list--compact">
              ${
                sites.length
                  ? sites
                      .map(
                        (site) => `
                        <label class="check-item">
                          <input type="checkbox" data-staff-site="${esc(site.id)}">
                          <span>${esc(site.name)} ${esc(site.code)}</span>
                        </label>`,
                      )
                      .join('')
                  : '<p class="tiny muted">등록된 현장이 없습니다.</p>'
              }
            </div>
          </div>
          <div class="field">
            <label for="st-scope">업무 범위</label>
            <textarea class="textarea" id="st-scope" rows="2" placeholder="예: 바디캠프 · 하늘치과 정기청소"></textarea>
          </div>
          <div class="field">
            <label for="st-process">청소 공정</label>
            <textarea class="textarea" id="st-process" rows="2" placeholder="예: 기구 소독 → 거울 → 샤워실 → 탈의실 → 화장실"></textarea>
          </div>
          <div class="field">
            <label for="st-safety">안전수칙</label>
            <textarea class="textarea" id="st-safety" rows="2" placeholder="예: 락스·세정제 혼합 금지, 장갑·마스크 착용"></textarea>
          </div>
          <div class="field">
            <label for="st-terms">특약사항</label>
            <textarea class="textarea" id="st-terms" rows="2" placeholder="예: 3.3% 원천징수 후 계좌 입금"></textarea>
          </div>

          ${state.newStaffError ? `<p class="field__error">${esc(state.newStaffError)}</p>` : ''}
          <button class="btn btn--primary btn--block" type="submit">직원 계약 저장 · 초대코드 발급</button>
          <p class="hint">저장 후 [직원에게 계약서 발송]을 누르면 직원이 초대코드로 자기 계약서를 열어 서명할 수 있습니다.</p>
        </form>
      </div>
    </details>`;
}

function staffCardTemplate(contract, sites, checks = []) {
  const meta = STAFF_TYPES[contract.employmentType] || STAFF_TYPES.freelancer;
  const status = STAFF_STATUS[contract.status] || STAFF_STATUS.draft;
  const siteNames = contract.siteIds
    .map((id) => (sites.find((site) => site.id === id) || {}).name)
    .filter(Boolean);
  const amount =
    contract.employmentType === 'daily'
      ? contract.dailyAmount
      : contract.employmentType === 'parttime'
        ? contract.hourlyAmount
        : contract.monthlyAmount;
  const latest = checks.filter((row) => row.staffContractId === contract.id)[0];
  return `
    <article class="staff-card" data-staff-card="${esc(contract.id)}">
      <header class="staff-card__head">
        <div>
          <strong>${esc(contract.name)} ${esc(contract.roleTitle || '')}</strong>
          <span>${esc(meta.short)} · ${esc(contract.no)} · ${esc(siteNames.join(', ') || '현장 미배정')}</span>
        </div>
        <span class="badge ${status.badge}">${esc(status.label)}</span>
      </header>
      <p class="staff-card__amount">${esc(meta.amountLabel)} ${money(amount)} <em>${contract.employmentType === 'freelancer' ? `${contract.feeRate}% 원천징수` : contract.employmentType === 'daily' ? '당일 정산' : contract.employmentType === 'parttime' ? '주휴수당 별도' : '부가세 별도'}</em></p>
      <p class="tiny muted">근무태도 ${latest ? `<span class="grade grade--${esc(latest.grade)}">${esc(latest.grade)}</span> ${esc(latest.date)}` : '평가 전'}</p>
      <div class="quote-card__invite">
        <code>${esc(contract.inviteCode)}</code>
        <span>${contract.inviteUsedAt ? '사용 완료' : contract.status === 'signed' ? '체결 완료' : '미사용'}</span>
        <a class="invite-link" href="${esc(inviteUrl(contract.inviteCode))}" data-invite-link="${esc(contract.inviteCode)}" target="_blank" rel="noreferrer">${esc(inviteUrl(contract.inviteCode))}</a>
        <button class="link-btn" type="button" data-copy-staff-invite="${esc(contract.id)}">초대 문구 복사</button>
        <button class="link-btn" type="button" data-copy-staff-link="${esc(contract.id)}">초대 링크 복사</button>
        <button class="link-btn" type="button" data-regen-staff-invite="${esc(contract.id)}">재발급</button>
      </div>
      <div class="quote-card__actions">
        <button class="btn btn--primary btn--sm" type="button" data-open-staff-room="${esc(contract.id)}">직원방 열기</button>
        <button class="btn btn--quiet btn--sm" type="button" data-open-staff="${esc(contract.id)}">계약서 열기</button>
        ${contract.status === 'draft' ? `<button class="btn btn--ghost btn--sm" type="button" data-send-staff="${esc(contract.id)}">직원에게 발송</button>` : ''}
      </div>
    </article>`;
}

export function staffPanelTemplate({ staffContracts, staffChecks = [], sites, state }) {
  const signed = staffContracts.filter((row) => row.status === 'signed').length;
  const waiting = staffContracts.filter((row) => row.status === 'sent').length;
  return `
    <section class="panel staff-panel" data-staff-panel>
      <div class="section-head">
        <div>
          <h2>직원 · 계약 관리</h2>
          <p>대표 전용 · 프리랜서(3.3%) · 도급 · 일용직 · 알바</p>
        </div>
      </div>
      <div class="btn-row" style="margin-bottom:10px">
        <button class="btn btn--ghost btn--sm" type="button" data-blank-subcontract>을 미정(공란) 도급계약서 생성 / 인쇄</button>
      </div>
      <div class="admin-stats">
        <div><strong>${staffContracts.length}</strong><span>직원 계약</span></div>
        <div><strong>${waiting}</strong><span>서명 대기</span></div>
        <div><strong>${signed}</strong><span>체결</span></div>
        <div><strong>${sites.length}</strong><span>현장</span></div>
      </div>
      ${staffFormTemplate(state, sites)}
      <div class="stack-10">
        ${
          staffContracts.length
            ? staffContracts.map((row) => staffCardTemplate(row, sites, staffChecks)).join('')
            : '<p class="tiny muted">아직 등록된 직원 계약이 없습니다.</p>'
        }
      </div>
      <p class="hint">결제 계좌 기본값: ${esc(PAYMENT_ACCOUNT.bankName)} ${esc(PAYMENT_ACCOUNT.accountNumber)} (${esc(PAYMENT_ACCOUNT.holder)})</p>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* 본부장(관리자) 대시보드 — 현장관리 & 체크 · 직원관리 & 체크             */
/* 금액은 어떤 형태로도 표시하지 않습니다.                                */
/* ------------------------------------------------------------------ */

const GRADES = ['A', 'B', 'C', 'D', 'E', 'F'];

function gradeBadge(grade) {
  const value = String(grade || '').toUpperCase();
  return `<span class="grade grade--${esc(value || 'X')}">${esc(value || '-')}</span>`;
}

export function managerSitesTemplate(sites, lastBySite) {
  return `
    <section class="panel manager-sites" data-manager-sites>
      <div class="section-head">
        <div>
          <h2>현장관리 &amp; 체크</h2>
          <p>현장 운영 정보 · 최근 보고 확인</p>
        </div>
        <span class="badge">${sites.length}곳</span>
      </div>
      <div class="stack-10">
        ${
          sites.length
            ? sites
                .map((site) => {
                  const last = lastBySite[site.id] || null;
                  const ops = site.ops || {};
                  return `
                    <article class="manager-site" data-manager-site="${esc(site.id)}">
                      <header class="manager-site__head">
                        <div>
                          <strong>${esc(site.name)}</strong>
                          <span>${esc(site.code)} · ${esc(site.frequency)}</span>
                        </div>
                        ${
                          last
                            ? `<span class="badge badge--done">${esc(last.date)} 보고</span>`
                            : '<span class="badge badge--wait">보고 없음</span>'
                        }
                      </header>
                      <dl class="kv kv--left ops-list">
                        <dt>청소 공정</dt><dd>${esc(ops.process || '미등록')}</dd>
                        <dt>출입방법</dt><dd>${esc(ops.accessMethod || '미등록')}</dd>
                        <dt>쓰레기 배출위치</dt><dd>${esc(ops.trashLocation || '미등록')}</dd>
                        <dt>주차방법</dt><dd>${esc(ops.parkingMethod || '미등록')}</dd>
                      </dl>
                      <p class="hint">최근 보고 ${last ? `${esc(last.date)} ${esc(last.time || '')} · ${esc(last.leader || '')}` : '없음'} · 사진 ${last ? ((last.photos && ((last.photos.security || []).length + (last.photos.cleaning || []).length + (last.photos.issue || []).length)) || 0) : 0}장</p>
                    </article>`;
                })
                .join('')
            : '<p class="tiny muted">등록된 현장이 없습니다.</p>'
        }
      </div>
    </section>`;
}

/* v2.8.2 — 직원관리 & 근무태도 체크 패널은 없어졌습니다.
   직원 평가(A~F)와 다른 직원의 관리는 대표만 봅니다. */

export function managerDashboardTemplate({ session, sites, lastBySite, myContracts = [] }) {
  const myContract = myContracts[0] || null;
  const status = myContract ? STAFF_STATUS[myContract.status] || STAFF_STATUS.draft : null;
  return `
    <div class="leader-bar">
      <div class="leader-bar__who">
        <span class="avatar" aria-hidden="true">${esc(session.name.slice(0, 1))}</span>
        <div>
          <strong>${esc(session.name)} ${esc(session.title || '본부장')}</strong>
          <span>${esc(session.phone || '')} · 본인 담당 현장만</span>
        </div>
      </div>
      <button class="btn btn--sm btn--quiet" type="button" data-action="logout">로그아웃</button>
    </div>
    <section class="panel">
      <div class="admin-stats">
        <div><strong>${sites.length}</strong><span>내 담당 현장</span></div>
        <div><strong>${Object.values(lastBySite).filter(Boolean).length}</strong><span>보고 있는 현장</span></div>
        <div><strong>${myContract ? '1' : '0'}</strong><span>내 계약서</span></div>
      </div>
      <p class="hint" style="margin:10px 0 0">
        다른 직원의 관리업장 · 직원 평가 · 고객 계약 관련 서류와 고객 금액은 이 화면에 나오지 않습니다.
      </p>
    </section>
    ${managerSitesTemplate(sites, lastBySite)}
    ${
      myContract
        ? `<section class="panel" data-manager-my-contract="${esc(myContract.id)}">
             <div class="section-head"><h3>내 계약서</h3><p>${esc(myContract.no)}</p></div>
             <div class="my-doc-row">
               <div class="my-doc-row__who">
                 <strong>${esc(myContract.name)} ${esc(myContract.roleTitle || '')}</strong>
                 <span>${esc(myContract.startDate || '')} ~ ${esc(myContract.endDate || '')}</span>
               </div>
               <span class="badge ${status.badge}">${esc(status.label)}</span>
             </div>
             <button class="btn btn--primary btn--sm" type="button" data-open-staff="${esc(myContract.id)}">내 계약서 열기</button>
           </section>`
        : ''
    }
    <p class="hint">현장 보고 · 사진 · 청소공정은 [담당팀] 탭에서 확인하세요.</p>
  `;
}

/* ------------------------------------------------------------------ */
/* 직원방 — 직원 상세 (계약서 · 관리업장 · 근무태도)                      */
/* 최고관리자(대표) 전용. 직원 평가는 대표만 매기고 봅니다(v2.8.2).      */
/* ------------------------------------------------------------------ */

export function staffRoomTemplate({ contract, checks, sites, canSeeMoney, canSeeEvaluation = false, reportsBySite = {} }) {
  const meta = STAFF_TYPES[contract.employmentType] || STAFF_TYPES.freelancer;
  const status = STAFF_STATUS[contract.status] || STAFF_STATUS.draft;
  const siteName = (id) => (sites.find((site) => site.id === id) || {}).name || id;
  const own = checks.filter((row) => row.staffContractId === contract.id);
  const amount =
    contract.employmentType === 'daily'
      ? contract.dailyAmount
      : contract.employmentType === 'parttime'
        ? contract.hourlyAmount
        : contract.monthlyAmount;

  const sitesBlock = contract.siteIds.length
    ? `<div class="stack-10">${contract.siteIds
        .map((id) => {
          const site = sites.find((row) => row.id === id);
          if (!site) return '';
          const ops = site.ops || {};
          const last = reportsBySite[id];
          return `<article class="manager-site">
            <header class="manager-site__head">
              <div><strong>${esc(site.name)}</strong><span>${esc(site.code)} · ${esc(site.frequency)}</span></div>
              ${last ? `<span class="badge badge--done">${esc(last.date)} 보고</span>` : '<span class="badge badge--wait">보고 없음</span>'}
            </header>
            <dl class="kv kv--left ops-list">
              <dt>청소 공정</dt><dd>${esc(ops.process || '미등록')}</dd>
              <dt>출입방법</dt><dd>${esc(ops.accessMethod || '미등록')}</dd>
              <dt>쓰레기 배출위치</dt><dd>${esc(ops.trashLocation || '미등록')}</dd>
              <dt>주차방법</dt><dd>${esc(ops.parkingMethod || '미등록')}</dd>
            </dl>
          </article>`;
        })
        .join('')}</div>`
    : '<p class="tiny muted">배정된 현장이 없습니다.</p>';

  // 직원 평가(A~F) — 대표(최고관리자)만 봅니다.
  const attitudeBlock = `
      <section class="panel staff-room__section" data-staff-room-attitude>
        <div class="section-head"><h3>근무태도</h3><p>A &gt; B &gt; C &gt; D &gt; E &gt; F</p></div>
        <div class="grade-scale">
          ${['A', 'B', 'C', 'D', 'E', 'F'].map((grade) => `<span class="grade grade--${grade}">${grade}</span>`).join('')}
        </div>
        <details class="check-box">
          <summary>근무태도 체크 · 등급 부여</summary>
          <form class="form" data-staff-check-form="${esc(contract.id)}" novalidate>
            <div class="field-row">
              <div class="field">
                <label>등급</label>
                <select class="select" data-check-grade>
                  ${['A', 'B', 'C', 'D', 'E', 'F'].map((grade) => `<option value="${grade}">${grade}</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <label>현장</label>
                <select class="select" data-check-site>
                  ${contract.siteIds.map((id) => `<option value="${esc(id)}">${esc(siteName(id))}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="field"><label>날짜</label><input class="input" type="date" data-check-date></div>
            <div class="field"><label>체크 메모</label><textarea class="textarea" rows="2" data-check-memo></textarea></div>
            <button class="btn btn--primary btn--sm" type="submit">등급 저장</button>
          </form>
        </details>
        ${
          own.length
            ? `<ul class="check-history">${own
                .map(
                  (row) =>
                    `<li><span class="grade grade--${esc(row.grade)}">${esc(row.grade)}</span><div><strong>${esc(row.date)} · ${esc(siteName(row.siteId))}</strong><span>${esc(row.memo || '메모 없음')}${row.reviewerName ? ` · ${esc(row.reviewerName)}` : ''}</span></div></li>`,
                )
                .join('')}</ul>`
            : '<p class="tiny muted">아직 근무태도 체크가 없습니다.</p>'
        }
      </section>`;

  return `
    <div class="staff-room" data-staff-room="${esc(contract.id)}">
      <div class="leader-bar">
        <div class="leader-bar__who">
          <button class="link-btn" type="button" data-close-staff-room>← 직원 목록</button>
        </div>
        <span class="badge ${status.badge}">${esc(status.label)}</span>
        <span class="badge ${canSeeMoney ? 'badge--done' : 'badge--wait'}">${canSeeMoney ? '최고관리자(대표)' : '부관리자(본부장)'}</span>
      </div>

      <section class="panel staff-room__head">
        <div class="section-head">
          <div>
            <h2>${esc(contract.name)} ${esc(contract.roleTitle || '')}</h2>
            <p>${esc(meta.short)} · ${esc(contract.no)}</p>
          </div>
          ${canSeeEvaluation ? (own[0] ? `<span class="grade grade--${esc(own[0].grade)}">${esc(own[0].grade)}</span>` : '<span class="badge badge--wait">평가 전</span>') : ''}
        </div>
        <p class="tiny muted">${esc(contract.phone)} · ${esc(contract.workDays || '일정 협의')} ${contract.workHours ? `· ${esc(contract.workHours)}` : ''}</p>
      </section>

      <section class="panel staff-room__section" data-staff-room-contract>
        <div class="section-head"><h3>계약서</h3><p>${esc(meta.short)} · ${esc(status.label)}</p></div>
        <dl class="kv kv--left">
          <dt>계약기간</dt><dd>${esc(contract.startDate)} ~ ${esc(contract.endDate)}</dd>
          <dt>체결일</dt><dd>${esc(contract.signedDate || '미체결')}</dd>
          ${
            canSeeMoney
              ? `<dt>${esc(meta.amountLabel)}</dt><dd><strong>${money(amount)}</strong>${contract.employmentType === 'freelancer' ? ` <span class="tiny muted">${contract.feeRate}% 원천징수</span>` : ''}</dd>`
              : '<dt>금액</dt><dd class="tiny muted">부관리자 화면에서는 금액이 표시되지 않습니다.</dd>'
          }
        </dl>
        <button class="btn btn--primary btn--sm" type="button" data-open-staff="${esc(contract.id)}">계약서 열기 · 인쇄</button>
      </section>

      <section class="panel staff-room__section" data-staff-room-sites>
        <div class="section-head"><h3>관리업장</h3><p>${contract.siteIds.length}곳</p></div>
        ${sitesBlock}
      </section>

      ${canSeeEvaluation ? attitudeBlock : ''}
    </div>`;
}

/* ------------------------------------------------------------------ */
/* 2단계 — 현장 방문 · 구역 체크리스트 · 자동 견적 (기획서 4·6·7장)     */
/* ------------------------------------------------------------------ */

const dash = (value) => (value === '' || value === null || value === undefined ? '—' : value);

function statusChip(status, label) {
  if (status === 'applied') return `<span class="tag">반영</span>`;
  if (status === 'unset') return `<span class="tag tag--sky">미설정</span>`;
  if (status === 'base') return `<span class="tag tag--leaf">기준</span>`;
  return `<span class="tag tag--leaf">${esc(label || '조정 없음')}</span>`;
}

/** 자동 산출 결과 상자 — 기준/최소/권장/추가공정/인원/작업시간/최종 (기획서 7장). */
export function estimateBoxTemplate(estimate, { amount = '' } = {}) {
  const est = estimate && typeof estimate === 'object' ? estimate : {};
  const base = est.base;
  const finalValue = amount !== '' && amount !== null && amount !== undefined ? Number(amount) : est.final;
  const line = (label, value, extra = '') => {
    const display = typeof value === 'string' ? value || '—' : value === '' || value === null || value === undefined ? '—' : fmtWon(value);
    return `
    <div class="estimate-line">
      <span>${esc(label)}</span>
      <strong>${esc(display)}</strong>
      ${extra}
    </div>`;
  };
  const warnings = Array.isArray(est.warnings) ? est.warnings.filter(Boolean) : [];
  return `
    <div class="estimate-box" data-estimate-box>
      <div class="estimate-box__head">
        <strong>자동 견적 산출</strong>
        <span>${est.pyeong ? `${esc(est.pyeong)}평` : '평수 미입력'} · ${esc(est.baseNote || '기준표')}</span>
      </div>
      ${line('기준 견적', base ? `${fmtWon(base.min)} ~ ${fmtWon(base.max)}` : '—', base ? '' : '<span class="tag tag--sky">기준표 없음</span>')}
      ${line('최소 견적', est.minQuote)}
      ${line('권장 견적', est.recQuote, `<span class="tag tag--leaf">${esc(est.pickLabel || '권장')}</span>`)}
      ${line('추가 공정', est.extraTotal || 0, est.extraLines && est.extraLines.some((row) => row.status === 'unset') ? '<span class="tag tag--sky">일부 미설정</span>' : '')}
      ${est.hoursText ? `<div class="estimate-line"><span>예상 작업시간</span><strong>${esc(est.hoursText)}</strong></div>` : ''}
      <div class="estimate-line">
        <span>인원 조정</span>
        <strong>${est.teamAdjust ? esc(fmtWon(est.teamAdjust)) : '—'}</strong>
        ${statusChip(est.teamStatus)}
      </div>
      <div class="estimate-line">
        <span>청소 주기 조정</span>
        <strong>${est.frequency && est.frequency.amount ? esc(fmtWon(est.frequency.amount)) : '—'}</strong>
        ${statusChip(est.frequency && est.frequency.status, est.frequency && est.frequency.label)}
      </div>
      <div class="estimate-line">
        <span>난이도 조정</span>
        <strong>${est.difficulty && est.difficulty.amount ? esc(fmtWon(est.difficulty.amount)) : '—'}</strong>
        ${statusChip(est.difficulty && est.difficulty.status, est.difficulty && est.difficulty.label)}
      </div>
      ${est.hoursStatus && est.hoursStatus !== 'none' ? line('작업시간 조정', est.hoursAdjust) : ''}
      ${est.otherStatus && est.otherStatus !== 'none' ? line('기타 조건', est.otherAdjust) : ''}
      ${line('조정 합계', est.adjustmentTotal || 0)}
      ${line('최종 견적', finalValue, amount !== '' && amount !== null && amount !== undefined ? '<span class="tag">직접 입력</span>' : '<span class="tag tag--leaf">권장 + 조정</span>')}
      ${warnings.length ? `<ul class="estimate-warn">${warnings.map((row) => `<li>${esc(row)}</li>`).join('')}</ul>` : ''}
      ${est.lines && est.lines.length ? `<p class="estimate-lines">${est.lines.map((row) => `${esc(row.label)} ${row.amount === null ? '미설정' : esc(fmtWon(row.amount))}`).join(' · ')}</p>` : ''}
    </div>`;
}

function zoneChecklistTemplate(checklist, values = {}) {
  const zoneChecks = values.zoneChecks || {};
  return (checklist.zones || [])
    .map((zone) => {
      const checked = Array.isArray(zoneChecks[zone.key]) ? zoneChecks[zone.key] : [];
      return `
      <div class="survey-zone" data-survey-zone="${esc(zone.key)}">
        <p class="survey-zone__head">
          ${esc(zone.label)}
          ${zone.kind === 'extra' ? '<span class="tag tag--sky">추가 공정 · 단가 설정 시 자동 반영</span>' : ''}
        </p>
        <div class="survey-checks">
          ${zone.items
            .map(
              (item) => `
            <label class="check-item">
              <input type="checkbox" data-zone-check="${esc(zone.key)}" value="${esc(item)}" ${checked.includes(item) ? 'checked' : ''}>
              <span>${esc(item)}</span>
            </label>`,
            )
            .join('')}
        </div>
      </div>`;
    })
    .join('');
}

/** 현장 방문 등록 · 견적 수정 폼 (기획서 4·6장). */
export function surveyFormTemplate({ sites, checklist, settings, values, estimate, state }) {
  const form = values || {};
  const editing = !!(state && state.survey && state.survey.editQuoteId);
  const siteOptions = (sites || [])
    .map((site) => `<option value="${esc(site.id)}" ${form.siteId === site.id ? 'selected' : ''}>${esc(site.name)} · ${esc(site.code)}${site.clientName && site.clientName !== site.name ? ` (${esc(site.clientName)})` : ''}</option>`)
    .join('');
  const difficultyOptions = QUOTE_DIFFICULTIES.map(
    (row) => `<option value="${esc(row.key)}" ${form.difficulty === row.key ? 'selected' : ''}>${esc(row.label)}</option>`,
  ).join('');
  const teamOptions = QUOTE_TEAM_SIZES.map(
    (row) => `<option value="${esc(row.key)}" ${String(form.teamSize) === row.key ? 'selected' : ''}>${esc(row.label)}</option>`,
  ).join('');

  return `
    <form class="form" data-survey-form="${esc(state && state.survey && state.survey.editQuoteId ? state.survey.editQuoteId : '')}" novalidate>
      <div class="survey-picker">
        <div class="field">
          <label for="sv-site-pick">기존 업장 불러오기</label>
          <select class="select" id="sv-site-pick">
            <option value="">— 새 업장으로 등록 —</option>
            ${siteOptions}
          </select>
        </div>
        <button class="btn btn--ghost btn--sm" type="button" data-survey-load>업장 정보 채우기</button>
      </div>
      <p class="field__hint">기존 업장을 고르면 고객사·주소·담당자·면적·주기를 다시 적지 않습니다. 저장하면 그 업장에 견적이 붙습니다.</p>

      <p class="details-head">고객사 · 현장</p>
      <div class="field-row">
        <div class="field">
          <label for="sv-client">고객사명 <span class="req">*</span></label>
          <input class="input" id="sv-client" type="text" maxlength="60" value="${esc(form.clientName || '')}" placeholder="예: 한빛테크">
        </div>
        <div class="field">
          <label for="sv-name">사업장명</label>
          <input class="input" id="sv-name" type="text" maxlength="60" value="${esc(form.siteName || '')}" placeholder="예: 한빛테크 목동사옥">
        </div>
      </div>
      <div class="field">
        <label for="sv-address">주소</label>
        <input class="input" id="sv-address" type="text" maxlength="120" value="${esc(form.address || '')}" placeholder="예: 서울 양천구 목동서로 100, 6층">
      </div>
      <div class="field-row">
        <div class="field">
          <label for="sv-contact">담당자</label>
          <input class="input" id="sv-contact" type="text" maxlength="30" value="${esc(form.contactName || '')}" placeholder="예: 김도윤 과장">
        </div>
        <div class="field">
          <label for="sv-phone">연락처</label>
          <input class="input" id="sv-phone" type="tel" inputmode="tel" maxlength="20" value="${esc(form.contactPhone || '')}" placeholder="010-0000-0000">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="sv-date">방문일</label>
          <input class="input" id="sv-date" type="date" value="${esc(form.visitDate || '')}">
        </div>
        <div class="field">
          <label for="sv-surveyor">견적 담당자</label>
          <input class="input" id="sv-surveyor" type="text" maxlength="30" value="${esc(form.surveyor || '')}" placeholder="예: 채종병">
        </div>
      </div>
      <div class="field">
        <label for="sv-location">현장 위치</label>
        <input class="input" id="sv-location" type="text" maxlength="120" value="${esc(form.location || '')}" placeholder="예: 6층 로비 옆 사무실 전체 (엘리베이터 우측)">
      </div>

      <p class="details-head">청소 조건</p>
      <div class="field-row">
        <div class="field">
          <label for="sv-area">면적 · 평수</label>
          <input class="input" id="sv-area" type="text" maxlength="40" value="${esc(form.area || '')}" placeholder="예: 약 110㎡ (33평)">
          <span class="field__hint">‘33평’ 또는 ‘110㎡’ 어느 쪽으로 적어도 평수를 읽습니다.</span>
        </div>
        <div class="field">
          <label for="sv-frequency">청소 주기</label>
          <input class="input" id="sv-frequency" type="text" maxlength="40" value="${esc(form.frequency || '')}" placeholder="예: 주 2회 (화 · 금)">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="sv-hours">예상 작업시간</label>
          <input class="input" id="sv-hours" type="text" maxlength="30" value="${esc(form.hours || '')}" placeholder="예: 2시간 30분">
        </div>
        <div class="field">
          <label for="sv-team">작업 인원 예상</label>
          <select class="select" id="sv-team">${teamOptions}</select>
        </div>
      </div>
      <div class="field">
        <label for="sv-difficulty">현장 난이도</label>
        <select class="select" id="sv-difficulty">${difficultyOptions}</select>
      </div>
      <div class="field">
        <label for="sv-note">현장 특이사항</label>
        <textarea class="textarea" id="sv-note" rows="2" maxlength="400" placeholder="예: 계단 먼지 많음, 창고 출입 주의">${esc(form.note || '')}</textarea>
      </div>

      <p class="details-head">청소 구역 체크 (터치)</p>
      ${zoneChecklistTemplate(checklist, form)}

      <p class="details-head">조정 · 직접 입력</p>
      <div class="field-row">
        <div class="field">
          <label for="sv-extra-amount">추가 공정 금액 직접 입력 <span class="tiny muted">(선택)</span></label>
          <input class="input" id="sv-extra-amount" type="number" inputmode="numeric" min="0" step="1000" value="${esc(form.extraAmount ?? '')}" placeholder="관리자 단가 대신 직접 입력">
        </div>
        <div class="field">
          <label for="sv-amount">최종 견적 직접 입력 <span class="tiny muted">(선택)</span></label>
          <input class="input" id="sv-amount" type="number" inputmode="numeric" min="0" step="1000" value="${esc(form.amount ?? '')}" placeholder="비우면 자동 산출값">
          ${form.currentAmount ? `<span class="field__hint">현재 ${esc(fmtWon(form.currentAmount))} · 비우면 다시 계산</span>` : ''}
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label class="check-item" for="sv-apply-hours">
            <input type="checkbox" id="sv-apply-hours" ${form.applyHours ? 'checked' : ''}>
            <span>작업시간 조정</span>
          </label>
          <input class="input" id="sv-hours-amount" type="number" inputmode="numeric" min="0" step="1000" value="${esc(form.hoursAmount ?? '')}" placeholder="금액(원)">
        </div>
        <div class="field">
          <label class="check-item" for="sv-apply-other">
            <input type="checkbox" id="sv-apply-other" ${form.applyOther ? 'checked' : ''}>
            <span>기타 조건 조정</span>
          </label>
          <input class="input" id="sv-other-amount" type="number" inputmode="numeric" min="0" step="1000" value="${esc(form.otherAmount ?? '')}" placeholder="금액(원)">
        </div>
      </div>

      ${estimateBoxTemplate(estimate, { amount: form.amount })}

      ${state && state.survey && state.survey.error ? `<p class="field__error">${esc(state.survey.error)}</p>` : ''}
      <button class="btn btn--primary btn--block" type="submit">${editing ? '견적 수정 저장' : '방문 기록 저장 · 견적 만들기'}</button>
      ${editing ? `<button class="btn btn--quiet btn--sm" type="button" data-survey-cancel>수정 취소</button>` : ''}
      <p class="hint">저장하면 기준표와 설정으로 금액을 계산해 견적을 만들고, 방문 기록·사진은 업장에 남깁니다. 금액은 대표 승인 뒤 확정됩니다.</p>
    </form>`;
}

/** 구역별 현장 사진 등록 · 이력 (기획서 4장). */
export function surveyPhotoTemplate({ sites, state, photos }) {
  const survey = (state && state.survey) || {};
  const siteId = survey.photoSiteId || '';
  const site = (sites || []).find((row) => row.id === siteId) || null;
  const siteOptions = (sites || [])
    .map((row) => `<option value="${esc(row.id)}" ${row.id === siteId ? 'selected' : ''}>${esc(row.name)} · ${esc(row.code)}</option>`)
    .join('');
  const area = survey.photoArea || 'office';
  const now = new Date();
  const todayValue = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const grouped = SURVEY_PHOTO_AREAS.map((row) => ({
    ...row,
    photos: (photos || []).filter((photo) => photo.area === row.key),
  })).filter((row) => row.photos.length);

  return `
    <div class="survey-photo">
      <div class="field">
        <label for="sv-photo-site">사진을 남길 업장</label>
        <select class="select" id="sv-photo-site" data-photo-site>
          <option value="">— 업장을 고르세요 —</option>
          ${siteOptions}
        </select>
      </div>
      ${site ? '' : '<p class="field__hint">방문 기록을 먼저 저장하면 그 업장이 자동으로 선택됩니다.</p>'}
      <div class="field">
        <label>구역</label>
        <div class="chips survey-areas">
          ${SURVEY_PHOTO_AREAS.map(
            (row) => `<button class="chip" type="button" data-photo-area="${esc(row.key)}" aria-pressed="${row.key === area ? 'true' : 'false'}">${esc(row.label)}</button>`,
          ).join('')}
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label for="sv-photo-date">촬영 날짜</label>
          <input class="input" id="sv-photo-date" type="date" value="${esc(survey.photoDate || todayValue)}" data-photo-date>
        </div>
        <div class="field">
          <label for="sv-photo-by">촬영 담당자</label>
          <input class="input" id="sv-photo-by" type="text" maxlength="30" value="${esc(survey.photoBy || '')}" data-photo-by placeholder="예: 채종병">
        </div>
      </div>
      <div class="field">
        <label for="sv-photo-memo">메모</label>
        <input class="input" id="sv-photo-memo" type="text" maxlength="80" value="${esc(survey.photoMemo || '')}" data-photo-memo placeholder="예: 책상 아래 먼지, 바닥 얼룩">
      </div>
      <label class="check-item">
        <input type="checkbox" data-photo-first ${survey.photoFirst === false ? '' : 'checked'}>
        <span>최초 견적 사진으로 표시</span>
      </label>
      <label class="btn btn--primary btn--block ${siteId ? '' : 'is-disabled'}">
        사진 촬영 · 선택 (여러 장 가능)
        <input type="file" accept="image/*" multiple hidden data-photo-file ${siteId ? '' : 'disabled'}>
      </label>
      <p class="hint">사진은 1600px JPEG로 압축해 저장합니다. 같은 구역·같은 날짜라도 덮어쓰지 않고 이력으로 쌓입니다.</p>

      ${
        grouped.length
          ? grouped
              .map(
                (group) => `
        <div class="survey-photo-group">
          <p class="survey-zone__head">${esc(group.label)} · ${group.photos.length}장</p>
          <div class="survey-photo-grid">
            ${group.photos
              .map(
                (photo) => `
              <figure class="survey-photo-card">
                <img src="${esc(photoThumb(photo))}" alt="${esc(group.label)} 사진" loading="lazy" decoding="async">
                <figcaption>
                  <strong>${esc(photo.date || '날짜 미기록')} · ${esc(photo.by || '담당자 미기록')}</strong>
                  ${photo.memo ? `<span>${esc(photo.memo)}</span>` : ''}
                  ${photo.firstQuote ? '<em class="tag tag--leaf">최초 견적</em>' : ''}
                </figcaption>
              </figure>`,
              )
              .join('')}
          </div>
        </div>`,
              )
              .join('')
          : `<p class="tiny muted">${siteId ? '아직 등록된 현장 사진이 없습니다.' : '업장을 고르면 그 업장의 사진 이력이 보입니다.'}</p>`
      }
    </div>`;
}

function photoThumb(photo) {
  if (!photo || !photo.ref) return '';
  return photo.ref.thumbAsset || photo.ref.thumb || photo.ref.asset || '';
}

/** 금액 승인 대기 목록 (대표). */
export function quoteApprovalListTemplate(quotes) {
  const pending = (quotes || []).filter((quote) => quote.estimate && quote.amount && (!quote.approval || quote.approval.status !== 'approved'));
  if (!pending.length) return '<p class="tiny muted">승인을 기다리는 견적이 없습니다.</p>';
  return `
    <div class="approval-queue">
      ${pending
        .map(
          (quote) => `
        <div class="approval-queue__row">
          <div>
            <strong>${esc(quote.clientCompany)}</strong>
            <span>${esc(quote.no)} · ${esc(quote.frequency || '')} · 최종 ${esc(fmtWon(quote.amount))}</span>
          </div>
          <button class="btn btn--primary btn--sm" type="button" data-approve-quote="${esc(quote.id)}">금액 승인</button>
        </div>`,
        )
        .join('')}
    </div>`;
}

/** 현장 방문 · 사진 · 자동 견적 패널 (대표 화면). */
export function surveyPanelTemplate({ sites, checklist, settings, quotes, state, values, estimate }) {
  const survey = (state && state.survey) || {};
  const editing = !!survey.editQuoteId;
  const withEstimate = (quotes || []).filter((quote) => quote.estimate);
  const approved = withEstimate.filter((quote) => quote.approval && quote.approval.status === 'approved').length;
  const pending = withEstimate.length - approved;
  const selectedSite = (sites || []).find((row) => row.id === (survey.photoSiteId || ''));
  const photos = selectedSite ? selectedSite.surveyPhotos || [] : [];

  return `
    <section class="panel survey-panel" data-survey-panel>
      <div class="section-head">
        <div>
          <h2>현장 방문 · 자동 견적</h2>
          <p>방문 기록 → 구역 체크 → 기준표 산출 → 대표 승인 → 계약서</p>
        </div>
      </div>
      <div class="admin-stats">
        <div><strong>${withEstimate.length}</strong><span>산출 견적</span></div>
        <div><strong>${pending}</strong><span>승인 대기</span></div>
        <div><strong>${approved}</strong><span>승인 완료</span></div>
        <div><strong>${(sites || []).filter((site) => site.survey && site.survey.visitDate).length}</strong><span>방문 기록 업장</span></div>
      </div>

      <details class="settings" data-survey-form-box ${survey.open || editing ? 'open' : ''}>
        <summary>${editing ? '현장 방문 · 견적 수정' : '+ 현장 방문 등록 · 견적 만들기'}</summary>
        <div class="settings__body">
          ${surveyFormTemplate({ sites, checklist, settings, values, estimate, state })}
        </div>
      </details>

      <details class="settings" data-survey-photo-box ${survey.photoOpen ? 'open' : ''}>
        <summary>② 구역별 현장 사진 (이력 보존)</summary>
        <div class="settings__body">
          ${surveyPhotoTemplate({ sites, state, photos })}
        </div>
      </details>

      <details class="settings" data-approval-box ${pending ? 'open' : ''}>
        <summary>③ 금액 승인 대기 ${pending ? `(${pending})` : ''}</summary>
        <div class="settings__body">
          <p class="hint">견적 산출 뒤 대표가 최종 금액을 승인하면 같은 업장으로 계약서가 자동으로 만들어집니다.</p>
          ${quoteApprovalListTemplate(quotes)}
        </div>
      </details>
    </section>`;
}

/** 견적 기준표 · 조정 항목 · 체크리스트 설정 (대표, 기획서 6·7장). */
export function quoteSettingsPanelTemplate({ settings, checklist, state }) {
  const survey = (state && state.survey) || {};
  const adjustmentRow = (group, row) => `
    <div class="adjust-row">
      <span>${esc(row.label)}</span>
      <select class="select select--sm" data-adjust-mode="${esc(group)}:${esc(row.key || group)}">
        <option value="" ${row.mode === '' ? 'selected' : ''}>미설정</option>
        <option value="rate" ${row.mode === 'rate' ? 'selected' : ''}>%</option>
        <option value="amount" ${row.mode === 'amount' ? 'selected' : ''}>원</option>
      </select>
      <input class="input input--sm" type="number" inputmode="numeric" min="0" step="1"
             data-adjust-value="${esc(group)}:${esc(row.key || group)}" value="${esc(row.value)}" placeholder="미설정">
    </div>`;

  const history = (settings.history || []).slice(0, 3);
  const checklistZones = (checklist.zones || [])
    .map(
      (zone, index) => `
      <div class="checklist-editor" data-checklist-zone="${esc(zone.key)}">
        <div class="checklist-editor__head">
          <input class="input input--sm" data-zone-label value="${esc(zone.label)}" maxlength="30" aria-label="구역 이름">
          ${zone.kind === 'extra' ? '<span class="tag tag--sky">추가 공정</span>' : ''}
          <button class="link-btn" type="button" data-zone-remove>구역 삭제</button>
        </div>
        <textarea class="textarea" rows="3" data-zone-items aria-label="${esc(zone.label)} 항목">${esc(zone.items.join('\n'))}</textarea>
        <input type="hidden" data-zone-kind value="${esc(zone.kind || 'normal')}">
      </div>`,
    )
    .join('');

  return `
    <details class="settings" data-price-settings ${survey.settingsOpen ? 'open' : ''}>
      <summary>④ 견적 기준표 · 체크리스트 설정 (대표)</summary>
      <div class="settings__body">
        <p class="hint">
          기획서 7장 기준표를 그대로 등록했습니다. 값을 바꾸면 바뀐 칸만 전/후 값과 함께 이력에 남습니다.
          인원·주기·난이도·추가 공정 조정은 정해진 정책이 없어 <strong>비어 있으면 계산에서 빠지고 ‘미설정’으로 표시</strong>됩니다.
        </p>
        <form class="form" data-quote-settings-form novalidate>
          <p class="details-head">기준 가격표 (주 1회 청소 기준 · 월 견적)</p>
          <div class="price-table">
            <div class="price-row price-row--head"><span>평수</span><span>최소 금액</span><span>최대 금액</span></div>
            ${settings.priceTable
              .map(
                (row) => `
              <div class="price-row">
                <span>${esc(row.pyeong)}평</span>
                <input class="input input--sm" type="number" inputmode="numeric" min="0" step="1000" data-price-min="${esc(row.pyeong)}" value="${esc(row.min)}" aria-label="${esc(row.pyeong)}평 최소">
                <input class="input input--sm" type="number" inputmode="numeric" min="0" step="1000" data-price-max="${esc(row.pyeong)}" value="${esc(row.max)}" aria-label="${esc(row.pyeong)}평 최대">
              </div>`,
              )
              .join('')}
          </div>

          <p class="details-head">표에 없는 평수 · 권장 견적</p>
          <div class="field-row">
            <div class="field">
              <label for="qs-area-mode">산출 규칙</label>
              <select class="select" id="qs-area-mode" data-area-mode>
                <option value="" ${settings.areaRule.mode === '' ? 'selected' : ''}>미설정 (금액 만들지 않음)</option>
                <option value="perPyeong" ${settings.areaRule.mode === 'perPyeong' ? 'selected' : ''}>1평당 금액으로 계산</option>
                <option value="interpolate" ${settings.areaRule.mode === 'interpolate' ? 'selected' : ''}>양옆 기준표 사이 비율로 계산</option>
              </select>
            </div>
            <div class="field">
              <label for="qs-recommend">권장 견적 기준</label>
              <select class="select" id="qs-recommend" data-recommend>
                <option value="min" ${settings.recommend === 'min' ? 'selected' : ''}>표의 최소</option>
                <option value="mid" ${settings.recommend === 'mid' ? 'selected' : ''}>표의 중간(권장)</option>
                <option value="max" ${settings.recommend === 'max' ? 'selected' : ''}>표의 최대</option>
              </select>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="qs-per-min">1평당 최소(원)</label>
              <input class="input" id="qs-per-min" type="number" inputmode="numeric" min="0" step="100" data-area-per-min value="${esc(settings.areaRule.perPyeongMin)}" placeholder="미설정">
            </div>
            <div class="field">
              <label for="qs-per-max">1평당 최대(원)</label>
              <input class="input" id="qs-per-max" type="number" inputmode="numeric" min="0" step="100" data-area-per-max value="${esc(settings.areaRule.perPyeongMax)}" placeholder="미설정">
            </div>
          </div>
          <div class="field">
            <label for="qs-area-note">규칙 메모</label>
            <input class="input" id="qs-area-note" type="text" maxlength="120" data-area-note value="${esc(settings.areaRule.note)}" placeholder="예: 2026년 상반기 견적 협의 기준">
          </div>

          <p class="details-head">인원 조정 (미확정 정책 — 비우면 계산에서 빠짐)</p>
          <div class="adjust-list">${settings.team.map((row) => adjustmentRow('team', row)).join('')}</div>

          <p class="details-head">청소 주기 조정</p>
          <div class="adjust-list">${settings.frequency.map((row) => adjustmentRow('frequency', row)).join('')}</div>

          <p class="details-head">난이도 조정</p>
          <div class="adjust-list">${settings.difficulty.map((row) => adjustmentRow('difficulty', row)).join('')}</div>

          <p class="details-head">추가 공정 단가</p>
          <div class="adjust-list">${settings.extras.map((row) => adjustmentRow('extras', row)).join('')}</div>

          <p class="details-head">작업시간 · 기타 조건</p>
          <div class="adjust-list">${adjustmentRow('workHours', settings.workHours)}${adjustmentRow('other', settings.other)}</div>

          ${settings.error ? `<p class="field__error">${esc(settings.error)}</p>` : ''}
          <button class="btn btn--primary btn--block" type="submit">기준표 · 설정 저장</button>
          ${history.length ? `<div class="settings-history"><p class="details-head">최근 설정 변경</p>${history.map((row) => `<p class="tiny muted">${esc(String(row.at).slice(0, 10))} · ${esc(row.actor || '')} · ${esc(row.action)}${row.changes && row.changes.length ? ` (${esc(row.changes.map((c) => c.field).join(', '))})` : ''}</p>`).join('')}</div>` : ''}
        </form>

        <form class="form" data-quote-checklist-form novalidate style="margin-top:16px">
          <p class="details-head">청소 구역 체크리스트 (관리자 수정)</p>
          <p class="field__hint">구역 이름과 항목을 고치고, 항목은 한 줄에 하나씩 적습니다. ‘기타 공정’ 구역 항목은 설정한 단가가 있으면 견적에 더해집니다.</p>
          <div class="checklist-editor-list">${checklistZones}</div>
          <button class="btn btn--ghost btn--sm" type="button" data-zone-add>+ 구역 추가</button>
          <button class="btn btn--primary btn--block" type="submit">체크리스트 저장</button>
        </form>
      </div>
    </details>`;
}

/* ------------------------------------------------------------------ */
/* 직원 등록 · 코드 설정 (대표 전용)                                    */
/* ------------------------------------------------------------------ */

function staffAccountValues(account) {
  if (!account) {
    return {
      name: '',
      title: '팀장',
      phone: '',
      password: '',
      leaderCode: '',
      staffRole: 'leader',
      assignedSiteIds: [],
      active: true,
    };
  }
  return {
    name: account.name || '',
    title: account.title || (account.canManageStaff ? '본부장' : '팀장'),
    phone: account.phonePretty || account.phone || '',
    password: '',
    leaderCode: account.leaderCode || '',
    staffRole: account.canManageStaff || account.staffRole === 'manager' ? 'manager' : 'leader',
    assignedSiteIds: (account.assignedSiteIds || []).slice(),
    active: account.active !== false,
  };
}

export function staffAccountPanelTemplate({ accounts, sites, state }) {
  const leaders = (accounts || []).filter((account) => account.role === 'leader');
  const managers = leaders.filter((account) => account.canManageStaff || account.staffRole === 'manager');
  const inactive = leaders.filter((account) => account.active === false);
  const staffState = (state && state.staffAccount) || {};
  const editing = leaders.find((account) => account.id === staffState.editId) || null;
  const values = editing ? staffAccountValues(editing) : staffState.form || staffAccountValues(null);
  const siteChips = (sites || [])
    .map(
      (site) => `
      <label class="check-item">
        <input type="checkbox" data-account-site value="${esc(site.id)}" ${values.assignedSiteIds.includes(site.id) ? 'checked' : ''}>
        <span>${esc(site.name)}</span>
      </label>`,
    )
    .join('');

  return `
    <section class="panel staff-account-panel" data-staff-account-panel>
      <div class="section-head">
        <div>
          <h2>직원 등록 · 코드 설정</h2>
          <p>대표 전용 · 새 직원 계정을 만들고 전화번호 · 비밀번호 · 고유코드로 바로 로그인</p>
        </div>
      </div>
      <div class="admin-stats">
        <div><strong>${leaders.length}</strong><span>직원 계정</span></div>
        <div><strong>${leaders.length - managers.length}</strong><span>관리팀장</span></div>
        <div><strong>${managers.length}</strong><span>부관리자</span></div>
        <div><strong>${inactive.length}</strong><span>사용 중지</span></div>
      </div>

      <details class="settings" data-staff-account-box ${staffState.open || editing ? 'open' : ''}>
        <summary>${editing ? `직원 정보 수정 · ${esc(editing.name)}` : '+ 새 직원 등록 (계정 · 고유코드 발급)'}</summary>
        <div class="settings__body">
          <form class="form" data-staff-account-form="${esc(editing ? editing.id : '')}" novalidate>
            <div class="field-row">
              <div class="field">
                <label for="sa-name">이름 <span class="req">*</span></label>
                <input class="input" id="sa-name" type="text" maxlength="30" value="${esc(values.name)}" placeholder="예: 홍길동">
              </div>
              <div class="field">
                <label for="sa-title">직책</label>
                <input class="input" id="sa-title" type="text" maxlength="20" value="${esc(values.title)}" placeholder="예: 팀장 · 부장 · 본부장">
              </div>
            </div>
            <div class="field">
              <label for="sa-phone">전화번호 (로그인 ID) <span class="req">*</span></label>
              <input class="input" id="sa-phone" type="tel" inputmode="tel" maxlength="20" value="${esc(values.phone)}" placeholder="010-0000-0000">
            </div>
            <div class="field">
              <label for="sa-password">비밀번호 <span class="req">*</span></label>
              <input class="input" id="sa-password" type="text" maxlength="30" value="" placeholder="${editing ? '비우면 기존 비밀번호 유지' : '4자 이상'}">
              <div class="inline-actions"><button class="link-btn link-btn--dark" type="button" data-gen-password>임시 비밀번호 만들기</button></div>
            </div>
            <div class="field">
              <label for="sa-code">팀장 고유코드 <span class="req">*</span></label>
              <input class="input" id="sa-code" type="text" maxlength="8" value="${esc(values.leaderCode)}" placeholder="예: TL-0000">
              <div class="inline-actions"><button class="link-btn link-btn--dark" type="button" data-gen-code>자동생성</button></div>
              <span class="field__hint">현장 보고 로그인에 함께 쓰는 코드입니다. 직접 입력하거나 자동생성(TL-0000)을 쓰세요.</span>
            </div>
            <div class="field">
              <label for="sa-role">역할</label>
              <select class="select" id="sa-role">
                <option value="leader" ${values.staffRole === 'leader' ? 'selected' : ''}>관리팀장 — 담당 현장 관리 · 현장 보고</option>
                <option value="manager" ${values.staffRole === 'manager' ? 'selected' : ''}>부관리자(본부장) — 본인 담당 현장만 (금액 · 평가 비노출)</option>
              </select>
            </div>
            <div class="field">
              <label>담당 현장</label>
              <div class="survey-checks account-sites">${siteChips || '<span class="tiny muted">등록된 현장이 없습니다.</span>'}</div>
            </div>
            ${
              editing
                ? `<label class="check-item">
                     <input type="checkbox" id="sa-active" ${values.active ? 'checked' : ''}>
                     <span>계정 사용 (해제하면 로그인 중지)</span>
                   </label>`
                : ''
            }
            ${staffState.error ? `<p class="field__error">${esc(staffState.error)}</p>` : ''}
            <button class="btn btn--primary btn--block" type="submit">${editing ? '직원 정보 저장' : '직원 등록 · 코드 발급'}</button>
            ${editing ? '<button class="btn btn--quiet btn--sm" type="button" data-staff-account-cancel>수정 취소</button>' : ''}
            <p class="hint">등록하면 이 기기와 서버(accounts)에 바로 저장되어, 직원이 전화번호 · 비밀번호 · 고유코드로 즉시 로그인할 수 있습니다. 실제 직원 계정은 공개 데모 목록에 표시되지 않습니다.</p>
          </form>
        </div>
      </details>

      <div class="staff-list account-list">
        ${
          leaders.length
            ? leaders
                .map(
                  (account) => `
          <div class="staff-row account-row" data-staff-account="${esc(account.id)}">
            <div class="staff-row__who">
              <span class="avatar" aria-hidden="true">${esc(String(account.name || '?').slice(0, 1))}</span>
              <div>
                <strong>
                  ${esc(account.name)} ${esc(account.title || '팀장')}
                  <span class="tag ${account.canManageStaff ? 'tag--sky' : 'tag--leaf'}">${esc(account.canManageStaff ? '부관리자' : '관리팀장')}</span>
                  ${account.active === false ? '<span class="tag">중지</span>' : ''}
                </strong>
                <span>${esc(account.phonePretty || account.phone)} · 코드 <code>${esc(account.leaderCode || '-')}</code> · 담당 ${(account.assignedSiteIds || []).length}곳</span>
              </div>
            </div>
            <div class="staff-row__actions">
              <button class="link-btn" type="button" data-staff-account-edit="${esc(account.id)}">수정</button>
              <button class="link-btn" type="button" data-staff-account-guide="${esc(account.id)}">로그인 안내</button>
              <button class="link-btn" type="button" data-regen-leader="${esc(account.id)}">코드 재발급</button>
              <button class="link-btn" type="button" data-toggle-account="${esc(account.id)}">${account.active === false ? '사용 재개' : '사용 중지'}</button>
            </div>
          </div>`,
                )
                .join('')
            : '<p class="tiny muted">아직 등록된 직원 계정이 없습니다. 위에서 첫 직원을 등록하세요.</p>'
        }
      </div>
      <p class="hint">부관리자(본부장)도 직원과 같이 본인 담당 현장만 봅니다. 직원 평가 · 다른 팀장의 관리 · 고객 계약서·견적서 · 금액은 대표만 봅니다. 고유코드를 재발급하면 이전 코드는 즉시 사용할 수 없습니다.</p>
    </section>`;
}
