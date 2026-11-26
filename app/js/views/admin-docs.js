/**
 * views/admin-docs.js — 관리(대표) 화면의 견적 · 계약 · 직원 계약 서식들.
 *
 * 화면 상태는 admin.js가 들고 있고, 이 파일은 HTML 조각만 만듭니다.
 */

import { esc, fmtWon } from '../ui.js';
import { QUOTE_STATUS, AGREEMENT_STATUS } from '../store.js';
import { CATEGORY_META, STAFF_TYPES, SUPPLIER, PAYMENT_ACCOUNT, APP_URL, DEFAULT_CHECKLISTS } from '../seed.js';

const money = (value) => esc(fmtWon(value));

/** 카테고리별 기본 청소 범위 (폼 자동 채우기). */
export function defaultScope(category) {
  return (DEFAULT_CHECKLISTS[category] || DEFAULT_CHECKLISTS.office).join(', ');
}

export function quoteInviteMessage(quote) {
  return [
    `[코리아 에코크린] ${quote.clientCompany} 담당자님, 정기청소 견적서가 도착했습니다.`,
    '아래 주소에서 1회용 코드를 입력하시면 견적서와 계약서를 확인하고 바로 전자서명하실 수 있습니다.',
    `주소: ${APP_URL}#customer`,
    `1회용 코드: ${quote.inviteCode}`,
    `문의: ${SUPPLIER.phone}`,
  ].join('\n');
}

export function staffInviteMessage(contract) {
  const meta = STAFF_TYPES[contract.employmentType] || STAFF_TYPES.freelancer;
  return [
    `[코리아 에코크린] ${contract.name}님, ${meta.label}가 도착했습니다.`,
    '아래 주소의 [현장 보고] 화면에서 1회용 직원 초대코드를 입력하시면',
    '내 계약서를 확인하고 전자서명하실 수 있습니다.',
    `주소: ${APP_URL}#leader`,
    `1회용 코드: ${contract.inviteCode}`,
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
                <input type="file" accept="image/*" capture="environment" multiple hidden data-new-quote-photo>
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
      <div class="quote-card__invite">
        <code>${esc(quote.inviteCode)}</code>
        <span>${esc(inviteState)}</span>
        <button class="link-btn" type="button" data-copy-quote-invite="${esc(quote.id)}">초대 문구 복사</button>
        <button class="link-btn" type="button" data-regen-quote-invite="${esc(quote.id)}">재발급</button>
      </div>
      <div class="quote-card__actions">
        <button class="btn btn--primary btn--sm" type="button" data-open-quote="${esc(quote.id)}">견적서 열기</button>
        ${quote.status === 'draft' ? `<button class="btn btn--ghost btn--sm" type="button" data-send-quote="${esc(quote.id)}">견적서 발송</button>` : ''}
        ${
          agreement
            ? `<button class="btn btn--quiet btn--sm" type="button" data-open-agreement="${esc(agreement.id)}">계약서 보기 · ${esc((AGREEMENT_STATUS[agreement.status] || {}).label || '')}</button>`
            : `<button class="btn btn--quiet btn--sm" type="button" data-contract-from-quote="${esc(quote.id)}">계약서로 전환</button>`
        }
      </div>
      ${
        agreement && agreement.status !== 'signed'
          ? `<p class="hint">계약서 ${esc(agreement.no)} · ${esc((AGREEMENT_STATUS[agreement.status] || {}).label || '')}${agreement.status === 'draft' ? ' — 고객에게 발송하면 서명할 수 있습니다.' : ''}</p>`
          : agreement
            ? `<p class="hint">계약서 ${esc(agreement.no)} · 체결 ${esc(agreement.signedDate)} · 현장 자동 등록 완료</p>`
            : ''
      }
    </article>`;
}

export function quotePanelTemplate({ quotes, agreements, state }) {
  const signed = agreements.filter((row) => row.status === 'signed').length;
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
                .map((quote) => quoteCardTemplate(quote, agreements.find((row) => row.quoteId === quote.id) || null))
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
  const status = AGREEMENT_STATUS[contract.status] || AGREEMENT_STATUS.draft;
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
        <button class="link-btn" type="button" data-copy-staff-invite="${esc(contract.id)}">초대 문구 복사</button>
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

export function managerStaffTemplate({ staffContracts, checks, sites }) {
  const siteName = (id) => (sites.find((site) => site.id === id) || {}).name || '';
  return `
    <section class="panel manager-staff" data-manager-staff>
      <div class="section-head">
        <div>
          <h2>직원관리 &amp; 체크</h2>
          <p>배정 현장 · 계약 상태 · 근무태도 A~F</p>
        </div>
        <span class="badge">${staffContracts.length}명</span>
      </div>
      <div class="grade-scale">${GRADES.map((grade) => `<span class="grade grade--${grade}">${grade}</span>`).join('')}</div>
      <div class="stack-10">
        ${
          staffContracts.length
            ? staffContracts
                .map((contract) => {
                  const meta = STAFF_TYPES[contract.employmentType] || STAFF_TYPES.freelancer;
                  const status = AGREEMENT_STATUS[contract.status] || AGREEMENT_STATUS.draft;
                  const own = checks.filter((row) => row.staffContractId === contract.id);
                  const latest = own[0];
                  return `
                    <article class="manager-staff-card" data-manager-staff-card="${esc(contract.id)}">
                      <header class="manager-site__head">
                        <div>
                          <strong>${esc(contract.name)} ${esc(contract.roleTitle || '')}</strong>
                          <span>${esc(meta.short)} · ${esc(contract.siteIds.map(siteName).filter(Boolean).join(', ') || '현장 미배정')}</span>
                        </div>
                        ${latest ? gradeBadge(latest.grade) : '<span class="badge badge--wait">평가 전</span>'}
                      </header>
                      <p class="tiny muted">계약 ${esc(status.label)} · ${esc(contract.workDays || '일정 협의')}</p>
                      <button class="btn btn--ghost btn--sm" type="button" data-open-staff-room="${esc(contract.id)}">직원방 열기 (계약서 · 관리업장 · 근무태도)</button>
                      <details class="check-box">
                        <summary>근무태도 체크 (A~F)</summary>
                        <form class="form" data-staff-check-form="${esc(contract.id)}" novalidate>
                          <div class="field-row">
                            <div class="field">
                              <label>등급</label>
                              <select class="select" data-check-grade>
                                ${GRADES.map((grade) => `<option value="${grade}">${grade}</option>`).join('')}
                              </select>
                            </div>
                            <div class="field">
                              <label>현장</label>
                              <select class="select" data-check-site>
                                ${contract.siteIds
                                  .map((id) => `<option value="${esc(id)}">${esc(siteName(id) || id)}</option>`)
                                  .join('')}
                              </select>
                            </div>
                          </div>
                          <div class="field">
                            <label>날짜</label>
                            <input class="input" type="date" data-check-date>
                          </div>
                          <div class="field">
                            <label>체크 메모</label>
                            <textarea class="textarea" rows="2" data-check-memo placeholder="예: 보고 누락 없음 · 현장 정리 상태 양호"></textarea>
                          </div>
                          <button class="btn btn--primary btn--sm" type="submit">등급 저장</button>
                        </form>
                      </details>
                      ${
                        own.length
                          ? `<ul class="check-history">
                              ${own
                                .slice(0, 4)
                                .map(
                                  (row) => `<li>${gradeBadge(row.grade)}<span>${esc(row.date)} · ${esc(row.memo || '메모 없음')}</span></li>`,
                                )
                                .join('')}
                            </ul>`
                          : '<p class="tiny muted">아직 근무태도 체크가 없습니다.</p>'
                      }
                    </article>`;
                })
                .join('')
            : '<p class="tiny muted">등록된 직원이 없습니다.</p>'
        }
      </div>
      <p class="hint">이 화면에는 금액 정보가 표시되지 않습니다. 급여·계약 금액은 최고관리자(대표)만 확인합니다.</p>
    </section>`;
}

export function managerDashboardTemplate({ session, sites, lastBySite, staffContracts, checks }) {
  return `
    <div class="leader-bar">
      <div class="leader-bar__who">
        <span class="avatar" aria-hidden="true">${esc(session.name.slice(0, 1))}</span>
        <div>
          <strong>${esc(session.name)} 부관리자(본부장)</strong>
          <span>${esc(session.phone || '')} · 현장 · 직원 체크 권한</span>
        </div>
      </div>
      <button class="btn btn--sm btn--quiet" type="button" data-action="logout">로그아웃</button>
    </div>
    <section class="panel">
      <div class="admin-stats">
        <div><strong>${sites.length}</strong><span>담당 현장</span></div>
        <div><strong>${staffContracts.length}</strong><span>직원</span></div>
        <div><strong>${checks.length}</strong><span>근무태도 체크</span></div>
        <div><strong>${staffContracts.filter((row) => row.status === 'signed').length}</strong><span>계약 체결</span></div>
      </div>
    </section>
    ${managerSitesTemplate(sites, lastBySite)}
    ${managerStaffTemplate({ staffContracts, checks, sites })}
    <p class="hint">대표 전용 화면(매출 정리 · 고객 계약 · 직원 급여)은 부관리자 계정에서 열리지 않습니다.</p>
  `;
}

/* ------------------------------------------------------------------ */
/* 직원방 — 직원 상세 (계약서 · 관리업장 · 근무태도)                      */
/* 최고관리자(대표)와 부관리자(본부장)만 들어옵니다.                      */
/* ------------------------------------------------------------------ */

export function staffRoomTemplate({ contract, checks, sites, canSeeMoney, reportsBySite = {} }) {
  const meta = STAFF_TYPES[contract.employmentType] || STAFF_TYPES.freelancer;
  const status = AGREEMENT_STATUS[contract.status] || AGREEMENT_STATUS.draft;
  const siteName = (id) => (sites.find((site) => site.id === id) || {}).name || id;
  const own = checks.filter((row) => row.staffContractId === contract.id);
  const amount =
    contract.employmentType === 'daily'
      ? contract.dailyAmount
      : contract.employmentType === 'parttime'
        ? contract.hourlyAmount
        : contract.monthlyAmount;

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
          ${own[0] ? `<span class="grade grade--${esc(own[0].grade)}">${esc(own[0].grade)}</span>` : '<span class="badge badge--wait">평가 전</span>'}
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
        ${
          contract.siteIds.length
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
            : '<p class="tiny muted">배정된 현장이 없습니다.</p>'
        }
      </section>

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
      </section>
    </div>`;
}
