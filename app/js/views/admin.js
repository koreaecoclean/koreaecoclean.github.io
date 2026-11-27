/**
 * views/admin.js — 관리 (최고관리자(대표))
 *
 * - 현장별 1회용 청소코드 발급 / 상태(미사용·사용 완료) 확인 / 복사
 * - 팀장 고유코드 발급·재발급, 계정 사용 중지
 * - 고객 계정과 방 입장 상태 확인
 */

import { $, esc, icons, toast, confirmDialog, copyText, setBusy, fmtWon, fmtNumber, toISODate, fmtDateLong, fmtTime, openLightbox, modeSwitchTemplate } from '../ui.js';
import { store, netProfit, MAX_BASELINE_PHOTOS, reportStatus, countReportPhotos, QUOTE_STATUS, AGREEMENT_STATUS, SURVEY_PHOTO_AREAS, QUOTE_TEAM_SIZES, QUOTE_DIFFICULTIES, parsePyeong, estimateQuote } from '../store.js';
import { CATEGORY_META, PHOTO_GROUPS } from '../seed.js';
import { preparePhoto } from '../photos.js';
import { getSession, loginAdmin, logout, demoAccounts, getWorkMode, setWorkMode } from '../auth.js';
import {
  quotePanelTemplate,
  staffPanelTemplate,
  quoteInviteMessage,
  staffInviteMessage,
  roomCodeInviteMessage,
  defaultScope,
  managerDashboardTemplate,
  staffRoomTemplate,
  surveyPanelTemplate,
  quoteSettingsPanelTemplate,
  estimateBoxTemplate,
} from './admin-docs.js';
import { inviteUrl } from '../invite.js';

/**
 * 초대 링크를 보낸다는 것은 곧 발송이라는 뜻입니다.
 * 아직 작성 중(draft)인 견적·직원 계약은 링크·문구를 복사할 때 발송 상태로 바꿉니다.
 */
async function ensureQuoteSent(quote) {
  if (!quote || quote.status !== 'draft') return quote;
  try {
    return await store.sendQuote(quote.id);
  } catch (error) {
    return quote;
  }
}

async function ensureStaffSent(contract) {
  if (!contract || contract.status !== 'draft') return contract;
  try {
    return await store.sendStaffContract(contract.id);
  } catch (error) {
    return contract;
  }
}
import { openQuoteSheet, openAgreementSheet, openStaffContractSheet, openBlankSubcontractSheet } from './quote-contract.js';
import {
  supplyAdminPanel,
  openSupplyReceipt,
  submitSupplyIssue,
  saveSupplyPrice,
  addSupplyItemFromForm,
  removeSupplyItem,
  refreshSupplyTotal,
} from './supply.js';

export function createAdminView(container) {  const state = {
    session: null,
    isCeo: false,
    loginError: '',
    busy: false,
    newSiteOpen: false,
    newSiteError: '',
    newSite: { quote: [], deepClean: [] },
    newQuoteOpen: false,
    newQuoteError: '',
    newQuote: { photos: [] },
    newStaffOpen: false,
    newStaffError: '',
    staffDetail: '',
    openDetails: '',
    survey: {
      open: false,
      photoOpen: false,
      error: '',
      editQuoteId: '',
      siteId: '',
      photoSiteId: '',
      photoArea: 'office',
      photoMemo: '',
      photoBy: '',
      photoDate: '',
      photoFirst: true,
      settingsOpen: false,
      form: null,
    },
    supply: {
      open: false,
      catalogOpen: false,
      requestId: '',
      toAccountId: '',
      toName: '',
      date: '',
      note: '',
      quantities: {},
    },
  };
  let mounted = false;
  let renderToken = 0;

  function formatStamp(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}.${m}.${d}`;
  }

  /* ---------------- login ---------------- */

  function loginTemplate() {
    const admin = demoAccounts().find((row) => row.role === 'admin');
    return `
      <section class="panel auth-card">
        <span class="eyebrow">${icons.sparkle} 관리자</span>
        <h2>최고관리자(대표)${admin ? ` · ${esc(admin.name)}` : ''} 로그인</h2>
        <p class="tiny muted">
          <strong>최고관리자(대표)</strong>는 전화번호와 비밀번호로,
          <strong>부관리자(본부장)</strong>은 팀장 고유코드까지 함께 입력해 입장합니다.
          본부장 화면에는 금액 정보가 표시되지 않습니다.
        </p>
        <form class="form" id="admin-login" style="margin-top:14px" novalidate>
          <div class="field">
            <label for="a-phone">전화번호</label>
            <input class="input" id="a-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000">
          </div>
          <div class="field">
            <label for="a-password">비밀번호</label>
            <input class="input" id="a-password" type="password" autocomplete="current-password" placeholder="비밀번호">
          </div>
          <div class="field">
            <label for="a-code">팀장 고유코드 <span class="tiny muted">(본부장만)</span></label>
            <input class="input" id="a-code" type="text" autocomplete="off" spellcheck="false" placeholder="예: TL-1638" maxlength="12">
          </div>
          ${state.loginError ? `<p class="field__error">${esc(state.loginError)}</p>` : ''}
          <button class="btn btn--primary btn--block" type="submit">관리자 로그인</button>
        </form>
        ${
          admin
            ? `<details class="demo-panel">
                 <summary>데모 계정 (대표 · 본부장)</summary>
                 <div class="demo-panel__body">
                   <div class="demo-row">
                     <div><strong>대표 · ${esc(admin.name)}</strong><span>${esc(admin.phone)} / ${esc(admin.password)}</span></div>
                     <button class="link-btn" type="button" data-fill-admin="${esc(admin.phone)}|${esc(admin.password)}|">입력</button>
                   </div>
                   <div class="demo-row">
                     <div><strong>본부장 · 박희승</strong><span>010-4994-1638 / team1234 / TL-1638</span></div>
                     <button class="link-btn" type="button" data-fill-admin="010-4994-1638|team1234|TL-1638">입력</button>
                   </div>
                 </div>
               </details>`
            : ''
        }
      </section>

      <section class="panel">
        <div class="section-head"><h2>관리자 화면에서 하는 일</h2></div>
        <div class="steps">
          <div class="step"><span class="step__num">1</span><div><strong>1회용 청소코드 발급</strong><span>고객사 현장별로 코드를 만들어 문자로 전달합니다.</span></div></div>
          <div class="step"><span class="step__num">2</span><div><strong>사용 여부 확인</strong><span>고객이 입장하며 쓴 코드는 ‘사용 완료’로 바뀝니다.</span></div></div>
          <div class="step"><span class="step__num">3</span><div><strong>팀장 고유코드 관리</strong><span>팀장별 코드를 재발급하거나 계정을 중지합니다.</span></div></div>
        </div>
      </section>
    `;
  }

  function newSitePanelTemplate(leaders) {
    const newSite = state.newSite || { quote: [], deepClean: [] };
    const photoRow = (key, label, hint) => `
      <div class="field">
        <label>${label}</label>
        <div class="new-site-photos" data-new-photos="${key}">
          ${(newSite[key] || [])
            .map((photo) => `<img src="${esc(photo.thumb || photo.dataUrl || '')}" alt="${esc(label)}" decoding="async">`)
            .join('')}
          <label class="new-site-photos__add">
            <span>+</span>
            <input type="file" accept="image/*" multiple hidden data-new-baseline="${key}">
          </label>
        </div>
        <span class="field__hint">${hint}</span>
      </div>`;

    const categoryOptions = Object.entries(CATEGORY_META)
      .map(([key, meta]) => `<option value="${esc(key)}">${esc(meta.label)}</option>`)
      .join('');

    return `
      <details class="settings new-site" ${state.newSiteOpen ? 'open' : ''}>
        <summary>+ 새 현장 등록</summary>
        <div class="settings__body">
          <form class="form" id="new-site-form" novalidate>
            <div class="field">
              <label for="ns-name">현장명 · 상호 <span class="req">*</span></label>
              <input class="input" id="ns-name" type="text" placeholder="예: (주) 라이트하우스코스메틱" maxlength="60">
            </div>
            <div class="field">
              <label for="ns-category">업종</label>
              <select class="select" id="ns-category">${categoryOptions}</select>
            </div>
            <div class="field">
              <label for="ns-address">주소</label>
              <input class="input" id="ns-address" type="text" placeholder="서울특별시 마포구 양화로 108, 7층" maxlength="120">
            </div>
            <div class="field-row">
              <div class="field">
                <label for="ns-biz">사업자번호</label>
                <input class="input" id="ns-biz" type="text" inputmode="numeric" placeholder="000-00-00000" maxlength="20">
              </div>
              <div class="field">
                <label for="ns-ceo">대표자</label>
                <input class="input" id="ns-ceo" type="text" placeholder="예: 신성민, 윤한수" maxlength="40">
              </div>
            </div>
            <div class="field">
              <label for="ns-tax">세금계산서 이메일</label>
              <input class="input" id="ns-tax" type="email" inputmode="email" placeholder="예: skltm0518@gmail.com" maxlength="60">
            </div>
            <div class="field">
              <label for="ns-contact">담당자명</label>
              <input class="input" id="ns-contact" type="text" placeholder="예: 신성민 대표" maxlength="40">
            </div>

            <p class="details-head">계약 정보 (관리자 전용 · 선택)</p>
            <div class="field-row">
              <div class="field">
                <label for="ns-contract-amount">계약금(원)</label>
                <input class="input" id="ns-contract-amount" type="number" inputmode="numeric" min="0" step="1000" placeholder="예: 2200000">
              </div>
              <div class="field">
                <label for="ns-subcontract-amount">도급금액(원)</label>
                <input class="input" id="ns-subcontract-amount" type="number" inputmode="numeric" min="0" step="1000" placeholder="예: 1430000">
              </div>
            </div>
            <div class="field-row">
              <div class="field">
                <label for="ns-fee-amount">수수료(원)</label>
                <input class="input" id="ns-fee-amount" type="number" inputmode="numeric" min="0" step="1000" placeholder="예: 110000">
              </div>
              <div class="field">
                <label for="ns-contract-date">계약일</label>
                <input class="input" id="ns-contract-date" type="date">
              </div>
            </div>
            <div class="field">
              <label for="ns-billing-day">청구일</label>
              <input class="input" id="ns-billing-day" type="text" maxlength="20" placeholder="예: 매월 10일">
            </div>
            <div class="field">
              <label for="ns-contract-note">비고</label>
              <textarea class="textarea" id="ns-contract-note" rows="2" maxlength="300" placeholder="예: 월 단위 청구 · 부가세 별도"></textarea>
            </div>

            <p class="details-head">직원용 현장 정보 (팀장 화면에 표시)</p>
            <div class="field">
              <label for="ns-process">청소 공정</label>
              <textarea class="textarea" id="ns-process" rows="3" placeholder="예: 책상 먼지 → 회의실 → 탕비실 → 화장실 → 바닥 → 유리"></textarea>
            </div>
            <div class="field">
              <label for="ns-access-method">출입방법</label>
              <textarea class="textarea" id="ns-access-method" rows="2" placeholder="예: 출근 전 07:00~08:30 · 관리사무소에서 카드 수령"></textarea>
            </div>
            <div class="field-row">
              <div class="field">
                <label for="ns-trash-location">쓰레기 배출위치</label>
                <textarea class="textarea" id="ns-trash-location" rows="2" placeholder="예: 5층 화장실 옆 분리수거함"></textarea>
              </div>
              <div class="field">
                <label for="ns-parking-method">주차방법</label>
                <textarea class="textarea" id="ns-parking-method" rows="2" placeholder="예: 지하 1층 30분 무료"></textarea>
              </div>
            </div>
            <div class="field">
              <label>담당 팀장</label>
              <div class="check-list check-list--compact">
                ${
                  leaders.length
                    ? leaders
                        .map(
                          (leader) => `
                          <label class="check-item">
                            <input type="checkbox" data-new-leader="${esc(leader.id)}">
                            <span>${esc(leader.name)} ${esc(leader.title || '팀장')}</span>
                          </label>`,
                        )
                        .join('')
                    : '<p class="tiny muted">등록된 팀장이 없습니다.</p>'
                }
              </div>
            </div>
            ${photoRow('quote', '① 첫 견적 사진 (오염 상태)', `지금 상태 그대로를 남깁니다. 나중에 고객이 비교해 볼 수 있습니다. 단계당 최대 ${MAX_BASELINE_PHOTOS}장.`)}
            ${photoRow('deepClean', '② 첫 청소 사진 (대청소)', `첫 대청소 완료 후 사진입니다. 단계당 최대 ${MAX_BASELINE_PHOTOS}장.`)}
            ${state.newSiteError ? `<p class="field__error">${esc(state.newSiteError)}</p>` : ''}
            <button class="btn btn--primary btn--block" type="submit">현장 저장</button>
            <p class="hint">저장하면 현장 카드가 생기고 바로 1회용 청소코드를 발급할 수 있습니다.</p>
          </form>
        </div>
      </details>`;
  }

  /* ---------------- dashboard ---------------- */

  function baselineAdminTemplate(site) {
    const baseline = site.baseline || {};
    const stage = (key, label, record) => {
      const count = (record && record.photos ? record.photos.length : 0);
      const full = count >= MAX_BASELINE_PHOTOS;
      return `
      <div class="baseline-row">
        <div class="baseline-row__who">
          <strong>${label}</strong>
          <span>${record && record.date ? formatStamp(record.date) : '날짜 미등록'} · ${count}/${MAX_BASELINE_PHOTOS}장</span>
        </div>
        <div class="baseline-row__thumbs">
          ${((record && record.photos) || [])
            .slice(0, 3)
            .map((photo) => `<img src="${esc(store.photoThumbUrl(photo))}" alt="${esc(photo.caption || label)}" loading="lazy" decoding="async">`)
            .join('')}
          ${count > 3 ? `<span class="baseline-row__more">+${count - 3}</span>` : ''}
        </div>
        ${
          full
            ? `<span class="link-btn baseline-row__add is-full">${MAX_BASELINE_PHOTOS}장 모두 등록</span>`
            : `<label class="link-btn baseline-row__add">
                 사진 추가 (${MAX_BASELINE_PHOTOS - count}장 가능)
                 <input type="file" accept="image/*" multiple hidden data-baseline-input="${key}" data-site-id="${esc(site.id)}">
               </label>`
        }
      </div>`;
    };
    return `
      <div class="baseline-admin">
        ${stage('quote', '① 첫 견적 · 오염 상태', baseline.quote)}
        ${stage('deepClean', '② 첫 청소 · 대청소', baseline.deepClean)}
      </div>`;
  }

  /* ---------------- contract · field ops (admin only) ---------------- */

  function revenueSummaryTemplate(summary) {
    const { rows, totals } = summary;
    return `
      <section class="panel rev-panel" data-revenue-summary>
        <div class="section-head">
          <h2>전체 매출 정리</h2>
          <p>${totals.sites}개 현장 합계</p>
        </div>
        <div class="rev-totals">
          <div><span>계약금 합계</span><strong data-revenue-total="contractAmount">${esc(fmtWon(totals.contractAmount))}</strong></div>
          <div><span>도급액 합계</span><strong data-revenue-total="subcontractAmount">${esc(fmtWon(totals.subcontractAmount))}</strong></div>
          <div><span>수수료 합계</span><strong data-revenue-total="feeAmount">${esc(fmtWon(totals.feeAmount))}</strong></div>
          <div class="rev-totals__net"><span>순수 매출금 합계</span><strong data-revenue-total="netProfit">${esc(fmtWon(totals.netProfit))}</strong></div>
        </div>
        <div class="rev-table">
          <div class="rev-row rev-row--head" role="row">
            <span>고객사 · 현장</span><span>계약금</span><span>도급액</span><span>수수료</span><span>순수 매출</span>
          </div>
          ${rows
            .map(
              (row) => `
                <div class="rev-row" role="row" data-revenue-row="${esc(row.siteId)}">
                  <span class="rev-name"><strong>${esc(row.clientName)}</strong><em>${esc(row.name)} · ${esc(row.code)}</em></span>
                  <span data-rev-field="contractAmount">${esc(fmtNumber(row.contractAmount))}</span>
                  <span data-rev-field="subcontractAmount">${esc(fmtNumber(row.subcontractAmount))}</span>
                  <span data-rev-field="feeAmount">${esc(fmtNumber(row.feeAmount))}</span>
                  <span class="rev-net" data-rev-field="netProfit">${esc(fmtNumber(row.netProfit))}</span>
                </div>`,
            )
            .join('')}
        </div>
        <p class="hint">단위: 원. 순수 매출금 = 계약금 − 도급금액 − 수수료. 아래 현장 카드에서 금액을 바꾸면 이 합계도 함께 다시 계산됩니다.</p>
      </section>`;
  }

  function siteMoneyLine(site) {
    const contract = site.contract || {};
    const net = netProfit(contract);
    return `
      <div class="site-money" data-site-money="${esc(site.id)}">
        <span>계약금 <strong>${esc(fmtWon(contract.contractAmount))}</strong></span>
        <span>도급 <strong>${esc(fmtWon(contract.subcontractAmount))}</strong></span>
        <span>수수료 <strong>${esc(fmtWon(contract.feeAmount))}</strong></span>
        <span class="site-money__net">순수 매출 <strong>${esc(fmtWon(net))}</strong></span>
      </div>`;
  }

  /**
   * 업장 하나의 연결 줄 — 견적 · 고객 계약 · 팀장 계약 · 보고가 업장 id 하나로 이어져 있음을 보여 줍니다.
   * 값이 없는 칸은 '없음'으로 두고, 실제로 연결된 것만 링크처럼 보여 줍니다.
   */
  function siteLinksBlockTemplate(link) {
    if (!link) return '';
    const quote = link.quote;
    const contract = link.contract;
    const staff = link.staffContracts || [];
    const quoteStatus = quote ? (QUOTE_STATUS[quote.status] || {}).label || '' : '';
    const contractStatus = contract ? (AGREEMENT_STATUS[contract.status] || {}).label || '' : '';
    const history = (link.history || []).slice(0, 4);
    // 이력 값 보기 — 숫자면 천 단위, 글이면 앞부분만(스크롤 길어짐 방지).
    const showValue = (value) => {
      const text = String(value ?? '');
      if (/^-?\d+$/.test(text)) return fmtNumber(text);
      return text.length > 30 ? `${text.slice(0, 30)}…` : text;
    };
    return `
      <div class="site-links" data-site-links="${esc(link.site ? link.site.id : '')}">
        <p class="details-head">연결 정보 (업장 기준)</p>
        <div class="site-links__grid">
          <span><em>견적</em><strong>${quote ? `${esc(quote.no)} · ${esc(quoteStatus)}` : '없음'}</strong></span>
          <span><em>고객 계약</em><strong>${contract ? `${esc(contract.no)} · ${esc(contractStatus)}` : '없음'}</strong></span>
          <span><em>팀장 계약</em><strong>${staff.length ? staff.map((row) => `${esc(row.name)} ${esc(row.no)}`).join(' / ') : '없음'}</strong></span>
          <span><em>보고</em><strong>${link.reportTotal}건${link.reportPending ? ` · 확인 대기 ${link.reportPending}` : ''}</strong></span>
        </div>
        ${link.lastReport ? `<p class="tiny muted">최근 보고 ${esc(link.lastReport.date)} ${esc(link.lastReport.time || '')} · ${esc(link.lastReport.leader)}</p>` : ''}
        ${
          history.length
            ? `<details class="site-history">
                 <summary>최근 변경 이력 ${esc(String((link.history || []).length))}건</summary>
                 <ul class="site-history__list">
                   ${history
                     .map(
                       (row) => `<li>
                         <span class="site-history__when">${esc(String(row.at).slice(0, 16).replace('T', ' '))}</span>
                         <span class="site-history__what"><strong>${esc(row.sourceLabel || '')}</strong> ${esc(row.action)}</span>
                         ${row.note ? `<span class="site-history__note">${esc(row.note)}</span>` : ''}
                         ${(row.changes || [])
                           .slice(0, 4)
                           .map(
                             (change) => `<span class="site-history__note">· ${esc(change.field)}: ${esc(showValue(change.from))} → <strong>${esc(showValue(change.to))}</strong></span>`,
                           )
                           .join('')}
                       </li>`,
                     )
                     .join('')}
                 </ul>
               </details>`
            : '<p class="hint">아직 기록된 변경 이력이 없습니다.</p>'
        }
      </div>`;
  }

  function siteDetailsTemplate(site, link) {
    const id = esc(site.id);
    const contract = site.contract || {};
    const ops = site.ops || {};
    const net = netProfit(contract);
    const amountField = (key, label, value) => `
      <div class="field">
        <label for="sd-${key}-${id}">${label}</label>
        <input class="input" id="sd-${key}-${id}" type="number" inputmode="numeric" min="0" step="1000"
               value="${esc(value)}" data-contract-field="${key}">
      </div>`;
    const opsField = (key, label, value, rows) => `
      <div class="field">
        <label for="so-${key}-${id}">${label}</label>
        <textarea class="textarea" id="so-${key}-${id}" rows="${rows || 2}"
                  data-ops-field="${key}">${esc(value)}</textarea>
      </div>`;

    return `
      <details class="settings site-details" data-site-details="${id}" ${state.openDetails === site.id ? 'open' : ''}>
        <summary>계약 · 운영 정보 관리</summary>
        <div class="settings__body">
          <div class="rev-mini">
            <span>계약일 <strong>${contract.contractDate ? esc(contract.contractDate) : '미등록'}</strong></span>
            <span>청구 <strong>${esc(contract.billingDay || '미등록')}</strong></span>
            <span>순수 매출 <strong data-net-profit-view="${id}">${esc(fmtWon(net))}</strong></span>
          </div>
          <form class="form" data-site-details-form="${id}" novalidate>
            <p class="details-head">계약 정보 (관리자 전용)</p>
            <div class="field-row">
              ${amountField('contractAmount', '계약금(원)', contract.contractAmount)}
              ${amountField('subcontractAmount', '도급금액(원)', contract.subcontractAmount)}
            </div>
            <div class="field-row">
              ${amountField('feeAmount', '수수료(원)', contract.feeAmount)}
              <div class="field">
                <label for="sd-net-${id}">순수 매출금 (자동 계산)</label>
                <input class="input" id="sd-net-${id}" type="text" value="${esc(fmtWon(net))}"
                       data-net-profit readonly aria-readonly="true">
              </div>
            </div>
            <div class="field-row">
              <div class="field">
                <label for="sd-date-${id}">계약일</label>
                <input class="input" id="sd-date-${id}" type="date" value="${esc(contract.contractDate)}"
                       data-contract-field="contractDate">
              </div>
              <div class="field">
                <label for="sd-billing-${id}">청구일</label>
                <input class="input" id="sd-billing-${id}" type="text" maxlength="20" placeholder="예: 매월 10일"
                       value="${esc(contract.billingDay)}" data-contract-field="billingDay">
              </div>
            </div>
            <div class="field">
              <label for="sd-note-${id}">비고</label>
              <textarea class="textarea" id="sd-note-${id}" rows="2" maxlength="300"
                        data-contract-field="note">${esc(contract.note)}</textarea>
            </div>

            <p class="details-head">직원용 현장 정보 (팀장 화면에 표시)</p>
            ${opsField('process', '청소 공정', ops.process, 3)}
            ${opsField('accessMethod', '출입방법', ops.accessMethod, 2)}
            <div class="field-row">
              ${opsField('trashLocation', '쓰레기 배출위치', ops.trashLocation, 2)}
              ${opsField('parkingMethod', '주차방법', ops.parkingMethod, 2)}
            </div>
            <button class="btn btn--primary btn--sm" type="submit">계약 · 운영 정보 저장</button>
            <p class="hint">도급금액은 팀장(현장) 화면에 표시됩니다. 계약금 · 수수료 · 순수 매출은 관리자만 볼 수 있습니다.</p>
          </form>
          ${siteLinksBlockTemplate(link)}
          ${siteSurveyBlockTemplate(site)}
        </div>
      </details>`;
  }

  function siteCodeCardTemplate(site, codes, link) {
    const unused = codes.filter((code) => !code.usedAt);
    const used = codes.filter((code) => code.usedAt);
    const meta = CATEGORY_META[site.category] || {};

    return `
      <section class="panel code-card" data-site-card="${esc(site.id)}">
        <div class="section-head">
          <div>
            <h2>${esc(site.name)}</h2>
            <p>${esc(meta.short || '')} · ${esc(site.code)}</p>
          </div>
          <span class="badge ${unused.length ? 'badge--done' : 'badge--wait'}">미사용 ${unused.length}</span>
        </div>

        ${
          site.bizNumber || site.ceoName || site.taxEmail
            ? `<p class="site-biz">사업자 ${esc(site.bizNumber || '-')} · 대표 ${esc(site.ceoName || '-')}${site.taxEmail ? ` · 세금계산서 ${esc(site.taxEmail)}` : ''}</p>`
            : ''
        }

        ${siteMoneyLine(site)}
        ${siteDetailsTemplate(site, link)}

        ${baselineAdminTemplate(site)}

        <ul class="code-list">
          ${codes.length
            ? codes
                .map(
                  (code) => `
                    <li class="code-row ${code.usedAt ? 'is-used' : ''}">
                      <div>
                        <code>${esc(code.code)}</code>
                        <span>${code.usedAt ? `사용 완료 · ${formatStamp(code.usedAt)}` : `미사용 · ${formatStamp(code.issuedAt)} 발급`}</span>
                      </div>
                      <button class="link-btn" type="button" data-copy-code="${esc(code.code)}">복사</button>
                      <button class="link-btn" type="button" data-copy-code-link="${esc(code.code)}|${esc(site.name)}">초대 링크</button>
                    </li>`,
                )
                .join('')
            : '<li class="tiny muted">아직 발급된 코드가 없습니다.</li>'}
        </ul>

        <div class="btn-row btn-row--stack" style="margin-top:10px">
          <button class="btn btn--primary btn--sm" type="button" data-issue-site="${esc(site.id)}">
            + 새 1회용 청소코드 발급
          </button>
        </div>
        <p class="hint">미사용 ${unused.length}개 · 사용 완료 ${used.length}개 · 1회용 코드는 고객 1명이 한 번만 사용할 수 있습니다.</p>
      </section>
    `;
  }

  function leaderCardTemplate(account, sites) {
    const assigned = sites.filter((item) => (account.assignedSiteIds || []).includes(item.id));
    const siteLabel = assigned.length
      ? ` · ${assigned.map((item) => item.name).join(' · ')}${assigned.length > 1 ? ` (${assigned.length}곳)` : ''}`
      : '';
    return `
      <div class="staff-row" data-leader-row="${esc(account.id)}">
        <div class="staff-row__who">
          <span class="avatar" aria-hidden="true">${esc(account.name.slice(0, 1))}</span>
          <div>
            <strong>${esc(account.name)} ${esc(account.title || '팀장')}${account.active === false ? ' · 중지됨' : ''}</strong>
            <span>${esc(account.phonePretty || account.phone)}${esc(siteLabel)}</span>
          </div>
        </div>
        <div class="staff-row__code">
          <code>${esc(account.leaderCode || '-')}</code>
          <div class="staff-row__actions">
            <button class="link-btn" type="button" data-copy-code="${esc(account.leaderCode || '')}">복사</button>
            <button class="link-btn" type="button" data-regen-leader="${esc(account.id)}">재발급</button>
            <button class="link-btn" type="button" data-toggle-account="${esc(account.id)}">${account.active === false ? '사용 재개' : '사용 중지'}</button>
          </div>
        </div>
      </div>
    `;
  }

  /* ---------------- 보고 확인 · 고객사 제출 (대표) ---------------- */

  function approvalThumbsTemplate(report, groupKey) {
    const photos = (report.photos && report.photos[groupKey]) || [];
    if (!photos.length) return '';
    const shown = photos.slice(0, 4);
    return `
      <div class="approval-photos">
        ${shown
          .map(
            (photo, index) => `
              <button class="approval-thumb" type="button" data-approval-photo="${esc(report.id)}"
                      data-photo-group="${esc(groupKey)}" data-photo-index="${index}"
                      aria-label="${esc(photo.caption || '현장 사진')} 크게 보기">
                <img src="${esc(store.photoThumbUrl(photo))}" alt="${esc(photo.caption || '현장 사진')}" loading="lazy" decoding="async">
              </button>`,
          )
          .join('')}
        ${photos.length > shown.length ? `<span class="approval-more">+${photos.length - shown.length}</span>` : ''}
      </div>`;
  }

  function approvalCardTemplate(report) {
    const status = reportStatus(report);
    const done = (report.checklist || []).filter((item) => item.done).length;
    const total = (report.checklist || []).length;
    const pending = report.status !== 'submitted';
    const groupRows = PHOTO_GROUPS.map((group) => {
      const count = ((report.photos && report.photos[group.key]) || []).length;
      return `
        <div class="approval-group">
          <div class="approval-group__head">
            <strong>${esc(group.label)}</strong>
            <span>${count}장</span>
          </div>
          ${approvalThumbsTemplate(report, group.key)}
        </div>`;
    }).join('');

    return `
      <article class="approval-card" data-approval-card="${esc(report.id)}">
        <header class="approval-card__head">
          <div>
            <strong>${esc(report.siteName || '')}</strong>
            <span>${esc(fmtDateLong(report.date))} ${esc(fmtTime(report.time))} · ${esc(report.leader)} ${esc(report.leaderRole || '팀장')}${report.durationMin ? ` · ${report.durationMin}분` : ''}</span>
          </div>
          <span class="badge ${status.badge}">${esc(status.label)}</span>
        </header>
        <p class="tiny muted approval-meta">사진 ${countReportPhotos(report)}장 · 점검 ${done}/${total}</p>
        ${groupRows}
        ${report.note ? `<div class="approval-block"><strong>전달 메모</strong><p class="report__note">${esc(report.note)}</p></div>` : ''}
        ${report.issueNote ? `<div class="approval-block"><strong>특이사항 메모</strong><p class="issue-note">${esc(report.issueNote)}</p></div>` : ''}
        ${
          pending
            ? `<div class="approval-actions">
                 <button class="btn btn--primary btn--sm" type="button" data-approve-report="${esc(report.id)}">확인 · 고객사 제출</button>
                 <span class="tiny muted">제출하면 고객 방에 바로 보입니다.</span>
               </div>`
            : `<p class="tiny muted approval-done">${esc(report.approvedAt ? `${fmtDateLong(String(report.approvedAt).slice(0, 10))} 고객사 제출 완료` : '고객사 제출 완료')}${report.approvedBy ? ` · ${esc(report.approvedBy)}` : ''}</p>`
        }
      </article>`;
  }

  function reportApprovalPanelTemplate({ pending, recent }) {
    return `
      <section class="panel approval-panel" data-approval-panel>
        <div class="section-head">
          <h2>보고 확인 · 고객사 제출</h2>
          <p>${pending.length ? `${pending.length}건 확인 대기` : '확인 대기 없음'}</p>
        </div>
        <p class="tiny muted" style="margin:-4px 0 12px">
          팀장이 등록한 보고는 <strong>대표 확인 전까지 고객에게 보이지 않습니다.</strong>
          사진 · 전달 메모 · 특이사항을 확인하고 <strong>확인 · 고객사 제출</strong>을 누르면 그때 고객 방에 표시됩니다.
        </p>
        ${pending.length ? pending.map(approvalCardTemplate).join('') : '<p class="tiny muted">확인을 기다리는 보고가 없습니다.</p>'}
        ${
          recent.length
            ? `<details class="approval-recent">
                 <summary>최근 고객사 제출 ${recent.length}건</summary>
                 <div class="stack-10" style="margin-top:8px">${recent.map(approvalCardTemplate).join('')}</div>
               </details>`
            : ''
        }
      </section>
    `;
  }

  async function openApprovalPhoto(reportId, groupKey, startIndex) {
    const report = await store.getReport(reportId);
    if (!report) return;
    const photos = (report.photos && report.photos[groupKey]) || [];
    if (!photos.length) return;
    const groupLabel = (PHOTO_GROUPS.find((group) => group.key === groupKey) || {}).label || '현장 사진';
    const items = [];
    for (const photo of photos) {
      const url = await store.photoFullUrl(photo);
      if (!url) continue;
      items.push({
        url,
        caption: [groupLabel, photo.caption || '', `${fmtDateLong(report.date)} ${fmtTime(report.time)} · ${report.leader}`]
          .filter(Boolean)
          .join(' · '),
      });
    }
    if (!items.length) {
      toast('사진을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', { tone: 'error' });
      return;
    }
    openLightbox(items, Math.min(Number(startIndex) || 0, items.length - 1));
  }

  async function approveReportToCustomer(reportId, button) {
    if (state.busy) return;
    const report = await store.getReport(reportId);
    if (!report) {
      toast('보고를 찾지 못했습니다.', { tone: 'error' });
      return;
    }
    const ok = await confirmDialog({
      title: '고객사에 제출할까요?',
      message: `${report.siteName || ''} · ${fmtDateLong(report.date)} ${fmtTime(report.time)} 보고를 고객 방에 제출합니다. 제출 후에는 고객이 바로 볼 수 있습니다.`,
      confirmLabel: '고객사 제출',
    });
    if (!ok) return;
    state.busy = true;
    setBusy(button, true, '제출 중…');
    try {
      const next = await store.approveReport(reportId, { by: state.session ? state.session.name : '' });
      toast(`${next.siteName || ''} 보고를 고객사에 제출했습니다.`);
      await render();
    } catch (error) {
      toast('보고를 제출하지 못했습니다. 잠시 후 다시 시도해 주세요.', { tone: 'error' });
    } finally {
      state.busy = false;
      setBusy(button, false);
    }
  }

  /* ---------------- 2단계 현장 방문 · 자동 견적 ---------------- */

  function todayStamp() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function surveyFormDefault() {
    return {
      siteId: '',
      clientName: '',
      siteName: '',
      address: '',
      contactName: '',
      contactPhone: '',
      visitDate: todayStamp(),
      surveyor: state.session ? state.session.name : '',
      location: '',
      area: '',
      frequency: '주 1회 (일정 협의)',
      hours: '',
      difficulty: 'normal',
      teamSize: '1',
      note: '',
      zoneChecks: {},
      extras: [],
      extraAmount: '',
      hoursAmount: '',
      otherAmount: '',
      applyHours: false,
      applyOther: false,
      amount: '',
    };
  }

  function surveyFormFromSite(site) {
    const survey = site.survey || {};
    return {
      ...surveyFormDefault(),
      siteId: site.id,
      clientName: survey.clientName || site.clientName || site.name,
      siteName: survey.siteName || site.name,
      address: survey.address || site.address || '',
      contactName: survey.contactName || site.contactName || '',
      contactPhone: survey.contactPhone || '',
      visitDate: survey.visitDate || todayStamp(),
      surveyor: survey.surveyor || (state.session ? state.session.name : ''),
      location: survey.location || '',
      area: survey.area || site.area || '',
      frequency: survey.frequency || site.frequency || '주 1회 (일정 협의)',
      hours: survey.hours || '',
      difficulty: survey.difficulty || 'normal',
      teamSize: String(survey.teamSize || '1'),
      note: survey.note || '',
      zoneChecks: survey.zoneChecks || {},
      extras: survey.extras || [],
    };
  }

  function surveyFormFromQuote(quote) {
    const survey = quote.survey || {};
    return {
      ...surveyFormDefault(),
      siteId: quote.siteId || '',
      clientName: survey.clientName || quote.clientCompany || '',
      siteName: survey.siteName || '',
      address: survey.address || quote.clientAddress || '',
      contactName: survey.contactName || quote.clientContact || '',
      contactPhone: survey.contactPhone || quote.clientPhone || '',
      visitDate: survey.visitDate || todayStamp(),
      surveyor: survey.surveyor || '',
      location: survey.location || '',
      area: survey.area || quote.area || '',
      frequency: survey.frequency || quote.frequency || '주 1회 (일정 협의)',
      hours: survey.hours || '',
      difficulty: survey.difficulty || 'normal',
      teamSize: String(survey.teamSize || '1'),
      note: survey.note || '',
      zoneChecks: survey.zoneChecks || {},
      extras: survey.extras || [],
      // 자동 산출로 만든 견적은 금액을 비워 두어 지금 조건으로 다시 계산합니다.
      amount: quote.estimate ? '' : String(quote.amount || ''),
      currentAmount: quote.amount || '',
    };
  }

  function estimateInputOf(values) {
    const pyeong = Number(values.pyeong) > 0 ? Number(values.pyeong) : parsePyeong(values.area);
    return {
      pyeong: pyeong || '',
      area: values.area || '',
      frequency: values.frequency || '',
      teamSize: values.teamSize || '',
      difficulty: values.difficulty || '',
      extras: values.extras || [],
      hours: values.hours || '',
      extraAmount: values.extraAmount,
      hoursAmount: values.hoursAmount,
      otherAmount: values.otherAmount,
      applyHours: !!values.applyHours,
      applyOther: !!values.applyOther,
    };
  }

  function surveyValues() {
    return state.survey.form || surveyFormDefault();
  }

  /** 폼에 지금 적힌 값을 그대로 읽습니다(리렌더 전에 잃지 않도록). */
  function readSurveyForm(form) {
    const val = (selector) => {
      const element = $(selector, form);
      return element ? String(element.value || '').trim() : '';
    };
    const zoneChecks = {};
    form.querySelectorAll('[data-zone-check]').forEach((input) => {
      if (!input.checked) return;
      const key = input.dataset.zoneCheck;
      (zoneChecks[key] = zoneChecks[key] || []).push(input.value);
    });
    const pick = $('#sv-site-pick', form);
    return {
      ...surveyFormDefault(),
      siteId: pick ? pick.value : state.survey.siteId,
      clientName: val('#sv-client'),
      siteName: val('#sv-name'),
      address: val('#sv-address'),
      contactName: val('#sv-contact'),
      contactPhone: val('#sv-phone'),
      visitDate: val('#sv-date'),
      surveyor: val('#sv-surveyor'),
      location: val('#sv-location'),
      area: val('#sv-area'),
      frequency: val('#sv-frequency'),
      hours: val('#sv-hours'),
      difficulty: ($('#sv-difficulty', form) || {}).value || 'normal',
      teamSize: String(($('#sv-team', form) || {}).value || '1'),
      note: val('#sv-note'),
      zoneChecks,
      extras: (zoneChecks.extra || []).slice(),
      extraAmount: val('#sv-extra-amount'),
      hoursAmount: val('#sv-hours-amount'),
      otherAmount: val('#sv-other-amount'),
      applyHours: !!($('#sv-apply-hours', form) || {}).checked,
      applyOther: !!($('#sv-apply-other', form) || {}).checked,
      amount: val('#sv-amount'),
    };
  }

  function captureSurveyForm() {
    const form = $('[data-survey-form]', container);
    if (!form) return;
    state.survey.form = readSurveyForm(form);
    state.survey.siteId = state.survey.form.siteId || '';
  }

  /** 입력하는 동안 자동 산출 결과를 바로 갱신합니다(저장 전 미리보기). */
  function refreshEstimatePreview() {
    const form = $('[data-survey-form]', container);
    if (!form) return;
    const values = readSurveyForm(form);
    const estimate = estimateQuote(estimateInputOf(values), state.quoteSettings || null);
    const box = $('[data-estimate-box]', form);
    if (box && typeof box.replaceWith === 'function') {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = estimateBoxTemplate(estimate, { amount: values.amount });
      const nextBox = wrapper.querySelector ? wrapper.querySelector('[data-estimate-box]') : null;
      if (nextBox) box.replaceWith(nextBox);
    }
    const amountInput = $('#sv-amount', form);
    if (amountInput) {
      amountInput.placeholder = estimate.final
        ? `${Number(estimate.final).toLocaleString('ko-KR')} (자동 산출)`
        : '기준표 없음 · 직접 입력';
    }
  }

  function siteSurveyBlockTemplate(site) {
    const survey = site.survey || {};
    const photos = site.surveyPhotos || [];
    if (!survey.visitDate && !survey.location && !photos.length) return '';
    const difficulty = (QUOTE_DIFFICULTIES.find((row) => row.key === survey.difficulty) || {}).label || '-';
    const team = (QUOTE_TEAM_SIZES.find((row) => row.key === String(survey.teamSize)) || {}).label || '-';
    const zones = state.quoteChecklist && state.quoteChecklist.zones ? state.quoteChecklist.zones : [];
    const zoneText = Object.entries(survey.zoneChecks || {})
      .filter(([, items]) => items && items.length)
      .map(([key, items]) => {
        const zone = zones.find((row) => row.key === key);
        return `${zone ? zone.label : key} ${items.length}개`;
      })
      .join(' · ');
    return `
      <div class="site-survey" data-site-survey="${esc(site.id)}">
        <p class="details-head">현장 방문 기록</p>
        <div class="site-links__grid">
          <span><em>방문일</em><strong>${esc(survey.visitDate || '미등록')}</strong></span>
          <span><em>견적 담당</em><strong>${esc(survey.surveyor || '-')}</strong></span>
          <span><em>면적</em><strong>${esc(survey.area || '-')}</strong></span>
          <span><em>청소 주기</em><strong>${esc(survey.frequency || '-')}</strong></span>
          <span><em>난이도</em><strong>${esc(difficulty)}</strong></span>
          <span><em>작업 인원</em><strong>${esc(team)}</strong></span>
        </div>
        ${survey.location ? `<p class="tiny muted">현장 위치: ${esc(survey.location)}</p>` : ''}
        ${zoneText ? `<p class="tiny muted">구역 체크: ${esc(zoneText)}</p>` : ''}
        ${survey.note ? `<p class="tiny muted">특이사항: ${esc(survey.note)}</p>` : ''}
        ${
          photos.length
            ? `<p class="details-head">현장 사진 이력 (${photos.length}장)</p>
               <div class="site-survey__photos">
                 ${SURVEY_PHOTO_AREAS.filter((area) => photos.some((photo) => photo.area === area.key))
                   .map(
                     (area) => `
                   <div class="site-survey__area">
                     <span>${esc(area.label)} ${photos.filter((photo) => photo.area === area.key).length}장</span>
                     <div class="site-survey__thumbs">
                       ${photos
                         .filter((photo) => photo.area === area.key)
                         .slice(-6)
                         .map(
                           (photo) => `<figure><img src="${esc(store.photoThumbUrl(photo.ref))}" alt="${esc(area.label)}" loading="lazy" decoding="async"><figcaption>${photo.firstQuote ? '최초 · ' : ''}${esc(String(photo.date || '').slice(5))}</figcaption></figure>`,
                         )
                         .join('')}
                     </div>
                   </div>`,
                   )
                   .join('')}
               </div>`
            : '<p class="tiny muted">아직 현장 사진이 없습니다.</p>'
        }
      </div>`;
  }

  /* ---------------- 2단계 동작 ---------------- */

  async function submitSurvey(form) {
    const editId = form.dataset.surveyForm || state.survey.editQuoteId || '';
    const values = readSurveyForm(form);
    state.survey.form = values;
    state.survey.error = '';
    state.survey.open = true;
    const actor = state.session ? state.session.name : '';
    try {
      if (editId) {
        const settings = state.quoteSettings || (await store.getQuoteSettings());
        const estimate = estimateQuote(estimateInputOf(values), settings);
        const amount = Number(values.amount) > 0 ? Number(values.amount) : estimate.final;
        if (!amount) throw new Error('기준표에 없는 평수입니다. 최종 견적 금액을 직접 입력해 주세요.');
        await store.updateQuote(editId, {
          amount,
          area: values.area,
          frequency: values.frequency,
          clientCompany: values.clientName,
          clientContact: values.contactName,
          clientPhone: values.contactPhone,
          clientAddress: values.address,
        });
        await store.saveQuoteSurvey(editId, {
          survey: { ...values, pyeong: Number(values.pyeong) || parsePyeong(values.area) || '' },
          estimate,
          actor,
        });
        // 이 업장의 대표 견적이면 업장의 방문 기록도 같은 내용으로 맞춥니다(업장 카드 ↔ 견적이 어긋나지 않게).
        const quote = await store.getQuote(editId);
        if (quote && quote.siteId) {
          const site = await store.getSite(quote.siteId);
          if (site && site.quoteId === editId) {
            await store.updateSiteSurvey(
              site.id,
              { ...values, pyeong: Number(values.pyeong) || parsePyeong(values.area) || '' },
              { actor },
            );
          }
        }
        state.survey.editQuoteId = '';
        state.survey.open = false;
        state.survey.form = null;
        await render();
        toast('견적 수정을 저장했습니다. 금액이 바뀌면 대표 승인을 다시 받아야 합니다.');
      } else {
        const result = await store.createSurveyQuote({ ...values, actor });
        state.survey.siteId = result.site.id;
        state.survey.photoSiteId = result.site.id;
        state.survey.open = false;
        state.survey.form = null;
        await render();
        toast(`${result.quote.clientCompany} 방문 기록 · 견적 ${result.quote.no} · 최종 ${fmtWon(result.quote.amount)}`, {
          duration: 8000,
        });
      }
    } catch (error) {
      state.survey.error = error.message || '방문 기록을 저장하지 못했습니다.';
      await render();
    }
  }

  async function submitQuoteSettings(form) {
    const priceTable = [];
    form.querySelectorAll('[data-price-min]').forEach((input) => {
      const pyeong = Number(input.dataset.priceMin);
      const max = form.querySelector(`[data-price-max="${pyeong}"]`);
      priceTable.push({ pyeong, min: input.value, max: max ? max.value : input.value });
    });
    const readAdjust = (group, key) => {
      const modeElement = form.querySelector(`[data-adjust-mode="${group}:${key}"]`);
      const valueElement = form.querySelector(`[data-adjust-value="${group}:${key}"]`);
      const labelElement = modeElement ? modeElement.closest('.adjust-row') : null;
      return {
        key,
        label: labelElement ? String(labelElement.querySelector('span')?.textContent || '').trim() : key,
        mode: modeElement ? modeElement.value : '',
        value: valueElement ? valueElement.value : '',
      };
    };
    const list = (group) => {
      const rows = [];
      form.querySelectorAll(`[data-adjust-mode^="${group}:"]`).forEach((element) => {
        const key = element.dataset.adjustMode.split(':')[1];
        rows.push(readAdjust(group, key));
      });
      return rows;
    };
    const patch = {
      priceTable,
      areaRule: {
        mode: (form.querySelector('[data-area-mode]') || {}).value || '',
        perPyeongMin: (form.querySelector('[data-area-per-min]') || {}).value || '',
        perPyeongMax: (form.querySelector('[data-area-per-max]') || {}).value || '',
        note: (form.querySelector('[data-area-note]') || {}).value || '',
      },
      recommend: (form.querySelector('[data-recommend]') || {}).value || 'mid',
      team: list('team'),
      frequency: list('frequency'),
      difficulty: list('difficulty'),
      extras: list('extras'),
      workHours: { ...readAdjust('workHours', 'workHours'), label: '작업시간' },
      other: { ...readAdjust('other', 'other'), label: '기타 조건' },
    };
    try {
      state.quoteSettings = await store.saveQuoteSettings(patch, { actor: state.session ? state.session.name : '대표' });
      state.survey.settingsOpen = true;
      await render();
      toast('견적 기준표 · 설정을 저장했습니다. 다음 산출부터 적용됩니다.');
    } catch (error) {
      toast(error.message || '설정을 저장하지 못했습니다.', { tone: 'error' });
    }
  }

  async function submitQuoteChecklist(form) {
    const boxes = Array.from(form.querySelectorAll('[data-checklist-zone]'));
    const zones = [];
    boxes.forEach((box, index) => {
      const labelEl = $('[data-zone-label]', box);
      const itemsEl = $('[data-zone-items]', box);
      const kindEl = $('[data-zone-kind]', box);
      const items = String((itemsEl && itemsEl.value) || '')
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean);
      if (!items.length) return;
      zones.push({
        key: box.dataset.checklistZone || `zone${index + 1}`,
        label: String((labelEl && labelEl.value) || '').trim() || `구역 ${index + 1}`,
        kind: kindEl && kindEl.value === 'extra' ? 'extra' : 'normal',
        items,
      });
    });
    try {
      state.quoteChecklist = await store.saveQuoteChecklist({ zones }, { actor: state.session ? state.session.name : '대표' });
      state.survey.settingsOpen = true;
      await render();
      toast(`체크리스트 ${state.quoteChecklist.zones.length}개 구역을 저장했습니다.`);
    } catch (error) {
      toast(error.message || '체크리스트를 저장하지 못했습니다.', { tone: 'error' });
    }
  }

  async function addSurveyPhotos(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    const siteId = state.survey.photoSiteId;
    if (!siteId) {
      toast('사진을 남길 업장을 먼저 고르세요.', { tone: 'error' });
      return;
    }
    const area = state.survey.photoArea || 'office';
    const areaLabel = (SURVEY_PHOTO_AREAS.find((row) => row.key === area) || {}).label || '기타';
    // 사진을 고르는 순간 화면에 적힌 값을 그대로 읽습니다(입력 중이어도 잃지 않음).
    const dateInput = $('[data-photo-date]', container);
    const byInput = $('[data-photo-by]', container);
    const memoInput = $('[data-photo-memo]', container);
    const firstInput = $('[data-photo-first]', container);
    const date = (dateInput && dateInput.value) || state.survey.photoDate || todayStamp();
    const by = (byInput && byInput.value.trim()) || state.survey.photoBy || (state.session ? state.session.name : '');
    const memo = (memoInput && memoInput.value.trim()) || state.survey.photoMemo || '';
    const firstQuote = firstInput ? !!firstInput.checked : state.survey.photoFirst !== false;
    state.survey.photoDate = date;
    state.survey.photoBy = by;
    state.survey.photoMemo = memo;
    state.survey.photoFirst = firstQuote;
    let added = 0;
    for (const file of list) {
      try {
        toast('사진 처리 중…', { duration: 1000 });
        const prepared = await preparePhoto(file);
        const ref = await store.savePhoto({
          dataUrl: prepared.dataUrl,
          thumb: prepared.thumb,
          width: prepared.width,
          height: prepared.height,
          caption: `${areaLabel} 현장 사진`,
        });
        await store.addSitePhoto(siteId, { area, date, by, memo, firstQuote, ref });
        added += 1;
      } catch (error) {
        console.warn('[admin] survey photo failed', error);
      }
    }
    if (!added) {
      toast('사진을 등록하지 못했습니다. 다른 사진으로 시도해 주세요.', { tone: 'error' });
      return;
    }
    state.survey.photoOpen = true;
    await render();
    toast(`현장 사진 ${added}장을 ${areaLabel} 구역에 등록했습니다. 기존 사진은 그대로 남습니다.`);
  }

  async function dashboardTemplate(session) {
    const sites = await store.listSites();
    const codes = await store.listRoomCodes();
    const accounts = await store.listAccounts();
    const leaders = accounts.filter((account) => account.role === 'leader');
    const customers = accounts.filter((account) => account.role === 'customer');
    const grants = await store.listGrants();
    const revenue = await store.revenueSummary();
    const quotes = await store.listQuotes();
    const agreements = await store.listAgreements();
    const staffContracts = await store.listStaffContracts();
    const staffChecks = await store.listStaffChecks();
    const supplyCatalog = await store.listSupplyCatalog();
    const supplyOrders = await store.listSupplyOrders();
    const pendingReports = await store.listReports({ status: 'pending' });
    const recentSubmitted = await store.listReports({ status: 'submitted', limit: 3 });
    // 업장(siteId) 중심 연결 요약 — 견적 · 계약 · 팀장 계약 · 보고 · 이력을 한 번에 읽습니다.
    const links = await store.listSiteLinks().catch(() => ({}));
    // 2단계 — 기준표 · 체크리스트 설정과 방문 폼 미리보기
    const quoteSettings = await store.getQuoteSettings();
    const quoteChecklist = await store.getQuoteChecklist();
    state.quoteSettings = quoteSettings;
    state.quoteChecklist = quoteChecklist;
    const surveyFormValues = surveyValues();
    const surveyPreview = estimateQuote(estimateInputOf(surveyFormValues), quoteSettings);

    const unusedTotal = codes.filter((code) => !code.usedAt).length;
    const usedTotal = codes.filter((code) => code.usedAt).length;

    return `
      <div class="leader-bar">
        <div class="leader-bar__who">
          <span class="avatar" aria-hidden="true">${esc(session.name.slice(0, 1))}</span>
          <div>
            <strong>${esc(session.name)} 최고관리자(대표)</strong>
            <span>${esc(session.phone || '')} · 코드 발급 권한</span>
          </div>
        </div>
        <button class="btn btn--sm btn--quiet" type="button" data-action="logout">로그아웃</button>
      </div>
      ${modeSwitchTemplate(getWorkMode())}

      <section class="panel">
        <div class="admin-stats">
          <div><strong>${sites.length}</strong><span>관리 현장</span></div>
          <div><strong>${unusedTotal}</strong><span>미사용 코드</span></div>
          <div><strong>${usedTotal}</strong><span>사용 완료</span></div>
          <div><strong>${leaders.length}</strong><span>팀장</span></div>
        </div>
      </section>

      ${reportApprovalPanelTemplate({ pending: pendingReports, recent: recentSubmitted })}

      ${revenueSummaryTemplate(revenue)}

      ${surveyPanelTemplate({
        sites,
        checklist: quoteChecklist,
        settings: quoteSettings,
        quotes,
        state,
        values: surveyFormValues,
        estimate: surveyPreview,
      })}

      ${quotePanelTemplate({ quotes, agreements, state })}

      ${quoteSettingsPanelTemplate({ settings: quoteSettings, checklist: quoteChecklist, state })}

      ${staffPanelTemplate({ staffContracts, staffChecks, sites, state })}

      ${supplyAdminPanel({ catalog: supplyCatalog, orders: supplyOrders, accounts, state })}

      <section>
        <div class="section-head">
          <h2>현장</h2>
          <p>${sites.length}곳</p>
        </div>
        ${newSitePanelTemplate(leaders)}
      </section>

      <section>
        <div class="section-head">
          <h2>1회용 청소코드</h2>
          <p>현장별 발급 · 사용 확인</p>
        </div>
        <div class="stack-10">
          ${sites
            .map((site) => siteCodeCardTemplate(site, codes.filter((code) => code.siteId === site.id), links[site.id] || null))
            .join('')}
        </div>
      </section>

      <section class="panel">
        <div class="section-head">
          <h2>팀장 고유코드</h2>
          <p>${leaders.length}명</p>
        </div>
        <div class="staff-list">
          ${leaders.map((account) => leaderCardTemplate(account, sites)).join('')}
        </div>
        <p class="hint">코드를 재발급하면 이전 코드는 즉시 사용할 수 없습니다. 팀장에게 새 코드를 전달해 주세요.</p>
      </section>

      <section class="panel">
        <div class="section-head">
          <h2>고객 계정</h2>
          <p>방 입장 상태</p>
        </div>
        <div class="staff-list">
          ${customers
            .map((account) => {
              const site = sites.find((item) => item.id === account.siteId);
              const granted = grants.some((grant) => grant.accountId === account.id && grant.siteId === account.siteId);
              return `
                <div class="staff-row">
                  <div class="staff-row__who">
                    <span class="avatar" aria-hidden="true">${esc(account.name.slice(0, 1))}</span>
                    <div>
                      <strong>${esc(account.name)} ${esc(account.title || '')}</strong>
                      <span>${esc(account.phonePretty || account.phone)}${site ? ` · ${esc(site.name)}` : ''}</span>
                    </div>
                  </div>
                  <span class="badge ${granted ? 'badge--done' : 'badge--wait'}">${granted ? '방 입장 완료' : '코드 대기'}</span>
                </div>`;
            })
            .join('')}
        </div>
      </section>

      <details class="settings">
        <summary>데모 설정</summary>
        <div class="settings__body">
          <p class="hint">
            초기화하면 이 기기의 계정·현장·보고·코드가 모두 샘플 상태로 돌아갑니다.
            실제 운영에서는 Supabase(무료 플랜)로 옮겨 기기 간 공유하세요.
          </p>
          <div class="btn-row btn-row--stack">
            <button class="btn btn--quiet btn--sm" type="button" data-action="reset-demo">데모 데이터 초기화</button>
            <button class="btn btn--quiet btn--sm" type="button" data-action="logout">로그아웃</button>
          </div>
        </div>
      </details>
    `;
  }

  /* ---------------- render ---------------- */

  async function render(options = {}) {
    const token = (renderToken += 1);
    mount();
    if (options && options.staffDetail !== undefined) state.staffDetail = options.staffDetail;
    const session = await getSession();
    if (token !== renderToken) return;

    const canManage =
      !!session && (session.role === 'admin' || (session.account && session.account.canManageStaff));
    if (!session || !canManage) {
      state.session = null;
      state.isCeo = false;
      container.innerHTML = loginTemplate();
      return;
    }

    state.session = session;
    state.isCeo = session.role === 'admin';
    // 관리 화면은 관리자 모드입니다 — 직원 모드로 있다가 들어오면 관리자 모드로 돌아옵니다.
    if (state.isCeo && getWorkMode() !== 'admin') setWorkMode('admin');

    if (state.staffDetail) {
      const sites = await store.listSites();
      const contract = await store.getStaffContract(state.staffDetail);
      if (contract) {
        const checks = await store.listStaffChecks();
        const reportsBySite = {};
        for (const id of contract.siteIds) {
          const rows = await store.listReports({ siteId: id, limit: 1 });
          reportsBySite[id] = rows[0] || null;
        }
        if (token !== renderToken) return;
        container.innerHTML = staffRoomTemplate({
          contract,
          checks,
          sites,
          canSeeMoney: state.isCeo,
          reportsBySite,
        });
        return;
      }
      state.staffDetail = '';
    }

    if (!state.isCeo) {
      const sites = await store.listSites();
      const assigned = session.assignedSiteIds || [];
      const allowed = assigned.length ? sites.filter((site) => assigned.includes(site.id)) : sites;
      const staffContracts = await store.listStaffContracts();
      const checks = await store.listStaffChecks();
      const lastBySite = {};
      for (const site of allowed) {
        const reports = await store.listReports({ siteId: site.id, limit: 1 });
        lastBySite[site.id] = reports[0] || null;
      }
      if (token !== renderToken) return;
      container.innerHTML = managerDashboardTemplate({
        session,
        sites: allowed,
        lastBySite,
        staffContracts,
        checks,
      });
      return;
    }

    container.innerHTML = await dashboardTemplate(session);
  }

  /* ---------------- events ---------------- */

  /* ---------------- new site ---------------- */

  async function appendBaselinePhotos(siteId, stage, files) {
    const site = await store.getSite(siteId);
    if (!site) return;
    const existing = (site.baseline && site.baseline[stage] && site.baseline[stage].photos) || [];
    const remaining = Math.max(0, MAX_BASELINE_PHOTOS - existing.length);
    if (!remaining) {
      toast(`처음 상태 사진은 최대 ${MAX_BASELINE_PHOTOS}장까지 등록할 수 있습니다.`, { tone: 'error' });
      return;
    }
    const list = Array.from(files || []).slice(0, remaining);
    if (list.length < (files || []).length) {
      toast(`최대 ${MAX_BASELINE_PHOTOS}장이라 ${list.length}장만 추가합니다.`, { tone: 'error' });
    }
    const added = [];
    for (const file of list) {
      try {
        toast('사진 처리 중…', { duration: 1200 });
        const prepared = await preparePhoto(file);
        const ref = await store.savePhoto({
          dataUrl: prepared.dataUrl,
          thumb: prepared.thumb,
          width: prepared.width,
          height: prepared.height,
          caption: stage === 'quote' ? '첫 견적 · 오염 상태' : '첫 청소 · 대청소',
        });
        added.push(ref);
      } catch (error) {
        console.warn('[admin] baseline photo failed', error);
      }
    }
    if (!added.length) {
      toast('사진을 추가하지 못했습니다. 다른 사진으로 시도해 주세요.', { tone: 'error' });
      return;
    }
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    await store.saveSiteBaseline(siteId, stage, {
      photos: existing.concat(added),
      date: (site.baseline && site.baseline[stage] && site.baseline[stage].date) || date,
      note:
        (site.baseline && site.baseline[stage] && site.baseline[stage].note) ||
        (stage === 'quote' ? '첫 견적 방문 · 오염 상태 기록' : '첫 청소(대청소) 완료 기록'),
    });
    await render();
    toast(`${stage === 'quote' ? '첫 견적(오염)' : '첫 청소(대청소)'} 사진 ${added.length}장을 저장했습니다.`);
  }

  async function addNewSitePhotos(stage, files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    const box = $(`[data-new-photos="${stage}"]`, container);
    const remaining = Math.max(0, MAX_BASELINE_PHOTOS - (state.newSite[stage] || []).length);
    if (!remaining) {
      toast(`처음 상태 사진은 최대 ${MAX_BASELINE_PHOTOS}장까지 등록할 수 있습니다.`, { tone: 'error' });
      return;
    }
    const accepted = list.slice(0, remaining);
    if (accepted.length < list.length) {
      toast(`최대 ${MAX_BASELINE_PHOTOS}장이라 ${accepted.length}장만 추가합니다.`, { tone: 'error' });
    }
    for (const file of accepted) {
      try {
        toast('사진 처리 중…', { duration: 1200 });
        const prepared = await preparePhoto(file);
        state.newSite[stage].push(prepared);
        state.newSiteOpen = true;
        if (box) {
          const img = document.createElement('img');
          img.src = prepared.thumb;
          img.alt = stage === 'quote' ? '첫 견적 사진' : '첫 청소 사진';
          img.decoding = 'async';
          const addButton = $('.new-site-photos__add', box);
          if (addButton) box.insertBefore(img, addButton);
          else box.appendChild(img);
        }
      } catch (error) {
        console.warn('[admin] new site photo failed', error);
      }
    }
    toast('사진을 추가했습니다. 현장 저장을 누르면 함께 저장됩니다.');
  }

  async function submitNewSite(event) {
    event.preventDefault();
    state.newSiteError = '';
    state.newSiteOpen = true;

    const name = $('#ns-name', container)?.value.trim() || '';
    if (!name) {
      state.newSiteError = '현장명(상호)을 입력해 주세요.';
      await render();
      return;
    }

    const leaderIds = Array.from(container.querySelectorAll('[data-new-leader]'))
      .filter((input) => input.checked)
      .map((input) => input.dataset.newLeader);

    const today = new Date();
    const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    try {
      const site = await store.addSite({
        name,
        category: $('#ns-category', container)?.value || 'office',
        address: $('#ns-address', container)?.value || '',
        bizNumber: $('#ns-biz', container)?.value || '',
        ceoName: $('#ns-ceo', container)?.value || '',
        taxEmail: $('#ns-tax', container)?.value || '',
        contactName: $('#ns-contact', container)?.value || '',
        contract: {
          contractAmount: $('#ns-contract-amount', container)?.value || 0,
          subcontractAmount: $('#ns-subcontract-amount', container)?.value || 0,
          feeAmount: $('#ns-fee-amount', container)?.value || 0,
          contractDate: $('#ns-contract-date', container)?.value || '',
          billingDay: $('#ns-billing-day', container)?.value || '',
          note: $('#ns-contract-note', container)?.value || '',
        },
        ops: {
          process: $('#ns-process', container)?.value || '',
          accessMethod: $('#ns-access-method', container)?.value || '',
          trashLocation: $('#ns-trash-location', container)?.value || '',
          parkingMethod: $('#ns-parking-method', container)?.value || '',
        },
        leaderIds,
      });

      for (const stage of ['quote', 'deepClean']) {
        const prepared = state.newSite[stage] || [];
        if (!prepared.length) continue;
        const refs = [];
        for (const photo of prepared) {
          refs.push(
            await store.savePhoto({
              dataUrl: photo.dataUrl,
              thumb: photo.thumb,
              width: photo.width,
              height: photo.height,
              caption: stage === 'quote' ? '첫 견적 · 오염 상태' : '첫 청소 · 대청소',
            }),
          );
        }
        await store.saveSiteBaseline(site.id, stage, {
          photos: refs,
          date: todayISO,
          note: stage === 'quote' ? '첫 견적 방문 · 오염 상태 기록' : '첫 청소(대청소) 완료 기록',
        });
      }

      state.newSite = { quote: [], deepClean: [] };
      state.newSiteOpen = false;
      await render();
      toast(`${site.name} 현장을 등록했습니다. 아래에서 1회용 코드를 발급하세요.`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      state.newSiteError = error.message || '현장을 등록하지 못했습니다.';
      await render();
    }
  }

  /* ---------------- 견적 · 계약 ---------------- */

  async function addNewQuotePhotos(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    const box = $('[data-new-quote-photos]', container);
    for (const file of list) {
      try {
        toast('사진 처리 중…', { duration: 1200 });
        const prepared = await preparePhoto(file);
        state.newQuote.photos.push(prepared);
        state.newQuoteOpen = true;
        if (box) {
          const img = document.createElement('img');
          img.src = prepared.thumb;
          img.alt = '현장 오염 사진';
          img.decoding = 'async';
          const addButton = $('.new-site-photos__add', box);
          if (addButton) box.insertBefore(img, addButton);
          else box.appendChild(img);
        }
      } catch (error) {
        console.warn('[admin] quote photo failed', error);
      }
    }
    toast('사진을 추가했습니다. 견적 저장 시 함께 저장됩니다.');
  }

  async function submitNewQuote(event) {
    event.preventDefault();
    state.newQuoteError = '';
    state.newQuoteOpen = true;
    try {
      const photos = [];
      for (const photo of state.newQuote.photos) {
        photos.push(
          await store.savePhoto({
            dataUrl: photo.dataUrl,
            thumb: photo.thumb,
            width: photo.width,
            height: photo.height,
            caption: '견적 방문 · 현장 오염 상태',
          }),
        );
      }
      const quote = await store.addQuote({
        clientCompany: $('#nq-company', container)?.value || '',
        clientCategory: $('#nq-category', container)?.value || 'office',
        clientAddress: $('#nq-address', container)?.value || '',
        clientContact: $('#nq-contact', container)?.value || '',
        clientPhone: $('#nq-phone', container)?.value || '',
        clientBizNumber: $('#nq-biz', container)?.value || '',
        clientTaxEmail: $('#nq-tax', container)?.value || '',
        frequency: $('#nq-frequency', container)?.value || '',
        scope: $('#nq-scope', container)?.value || '',
        extraScope: $('#nq-extra', container)?.value || '',
        area: $('#nq-area', container)?.value || '',
        amount: $('#nq-amount', container)?.value || 0,
        vatIncluded: $('#nq-vat', container)?.value === 'included',
        billingDay: $('#nq-billing', container)?.value || '1',
        periodMonths: $('#nq-months', container)?.value || 12,
        startDate: $('#nq-start', container)?.value || '',
        validUntil: $('#nq-valid', container)?.value || '',
        terms: $('#nq-terms', container)?.value || '',
        memo: $('#nq-memo', container)?.value || '',
        photos,
      });
      state.newQuote = { photos: [] };
      state.newQuoteOpen = false;
      await store.sendQuote(quote.id);
      await render();
      toast(`${quote.clientCompany} 견적 · 초대코드 ${quote.inviteCode}`, {
        actionLabel: '초대 문구 복사',
        onAction: () => copyText(quoteInviteMessage(quote)),
        duration: 9000,
      });
    } catch (error) {
      state.newQuoteError = error.message || '견적을 저장하지 못했습니다.';
      await render();
    }
  }

  async function submitNewStaff(event) {
    event.preventDefault();
    state.newStaffError = '';
    state.newStaffOpen = true;
    const siteIds = Array.from(container.querySelectorAll('[data-staff-site]'))
      .filter((input) => input.checked)
      .map((input) => input.dataset.staffSite);
    try {
      const contract = await store.addStaffContract({
        employmentType: $('#st-type', container)?.value || 'freelancer',
        name: $('#st-name', container)?.value || '',
        roleTitle: $('#st-title', container)?.value || '',
        phone: $('#st-phone', container)?.value || '',
        birthDate: $('#st-birth', container)?.value || '',
        bizNumber: $('#st-biz', container)?.value || '',
        residentId: $('#st-resident', container)?.value || '',
        bankName: $('#st-bank', container)?.value || '',
        bankAccount: $('#st-account', container)?.value || '',
        accountHolder: $('#st-holder', container)?.value || '',
        settlementDay: $('#st-settle', container)?.value || '15',
        monthlyAmount: $('#st-monthly', container)?.value || 0,
        dailyAmount: $('#st-daily', container)?.value || 0,
        hourlyAmount: $('#st-hourly', container)?.value || 0,
        startDate: $('#st-start', container)?.value || '',
        endDate: $('#st-end', container)?.value || '',
        workDays: $('#st-days', container)?.value || '',
        workHours: $('#st-hours', container)?.value || '',
        siteIds,
        scope: $('#st-scope', container)?.value || '',
        process: $('#st-process', container)?.value || '',
        safety: $('#st-safety', container)?.value || '',
        specialTerms: $('#st-terms', container)?.value || '',
      });
      state.newStaffOpen = false;
      await render();
      toast(`${contract.name} ${contract.no} · 초대코드 ${contract.inviteCode}`, {
        actionLabel: '초대 문구 복사',
        onAction: () => copyText(staffInviteMessage(contract)),
        duration: 9000,
      });
    } catch (error) {
      state.newStaffError = error.message || '직원 계약을 저장하지 못했습니다.';
      await render();
    }
  }

  async function onChange(event) {
    const photoFile = event.target.closest('[data-photo-file]');
    if (photoFile) {
      const files = Array.from(photoFile.files || []);
      photoFile.value = '';
      await addSurveyPhotos(files);
      return;
    }
    if (event.target.matches('[data-photo-site]')) {
      captureSurveyForm();
      state.survey.photoSiteId = event.target.value;
      state.survey.photoOpen = true;
      await render();
      return;
    }
    if (event.target.matches('[data-photo-date]')) {
      state.survey.photoDate = event.target.value;
      return;
    }
    if (event.target.matches('[data-photo-by]')) {
      state.survey.photoBy = event.target.value;
      return;
    }
    if (event.target.matches('[data-photo-memo]')) {
      state.survey.photoMemo = event.target.value;
      return;
    }
    if (event.target.matches('[data-photo-first]')) {
      state.survey.photoFirst = !!event.target.checked;
      return;
    }
    if (event.target.id === 'sup-to') {
      const nameInput = $('#sup-to-name', container);
      const option = event.target.selectedOptions && event.target.selectedOptions[0];
      if (nameInput && event.target.value && option) nameInput.value = String(option.textContent || '').trim();
      return;
    }

    const quotePhoto = event.target.closest('[data-new-quote-photo]');
    if (quotePhoto) {
      const files = Array.from(quotePhoto.files || []);
      quotePhoto.value = '';
      await addNewQuotePhotos(files);
      return;
    }

    if (event.target.id === 'nq-category') {
      const scope = $('#nq-scope', container);
      if (scope) scope.value = defaultScope(event.target.value);
      return;
    }

    const newPhoto = event.target.closest('[data-new-baseline]');
    if (newPhoto) {
      const files = Array.from(newPhoto.files || []);
      newPhoto.value = '';
      await addNewSitePhotos(newPhoto.dataset.newBaseline, files);
      return;
    }

    const baselinePhoto = event.target.closest('[data-baseline-input]');
    if (baselinePhoto) {
      const files = Array.from(baselinePhoto.files || []);
      baselinePhoto.value = '';
      await appendBaselinePhotos(baselinePhoto.dataset.siteId, baselinePhoto.dataset.baselineInput, files);
    }
  }

  /* ---------------- contract · field ops save ---------------- */

  async function submitSiteDetails(form) {
    const siteId = form.dataset.siteDetailsForm;
    const contract = {};
    const ops = {};
    form.querySelectorAll('[data-contract-field]').forEach((input) => {
      contract[input.dataset.contractField] = input.value;
    });
    form.querySelectorAll('[data-ops-field]').forEach((input) => {
      ops[input.dataset.opsField] = input.value;
    });
    state.openDetails = siteId;
    try {
      const site = await store.updateSiteDetails(siteId, {
        contract,
        ops,
        actor: state.session ? state.session.name : '',
      });
      await render();
      toast(`${site.name} 계약 · 운영 정보를 저장했습니다.`);
    } catch (error) {
      toast(error.message || '계약 정보를 저장하지 못했습니다.', { tone: 'error' });
    }
  }

  function onInput(event) {
    if (event.target.matches('[data-photo-memo]')) {
      state.survey.photoMemo = event.target.value;
      return;
    }
    if (event.target.matches('[data-photo-by]')) {
      state.survey.photoBy = event.target.value;
      return;
    }
    if (event.target.matches('[data-photo-date]')) {
      state.survey.photoDate = event.target.value;
      return;
    }
    if (event.target.closest('[data-survey-form]')) {
      refreshEstimatePreview();
      return;
    }
    const supplyQty = event.target.closest('[data-supply-qty]');
    if (supplyQty) {
      refreshSupplyTotal(supplyQty.closest('form') || container);
      return;
    }
    const form = event.target.closest('[data-site-details-form]');
    if (!form) return;
    const amount = (key) => Number($(`[data-contract-field="${key}"]`, form)?.value) || 0;
    const net = amount('contractAmount') - amount('subcontractAmount') - amount('feeAmount');
    const output = $('[data-net-profit]', form);
    if (output) output.value = fmtWon(net);
    const view = $(`[data-net-profit-view="${form.dataset.siteDetailsForm}"]`, container);
    if (view) view.textContent = fmtWon(net);
  }

  /* ---------------- events ---------------- */

  async function onSubmit(event) {
    if (event.target.matches('[data-survey-form]')) {
      event.preventDefault();
      await submitSurvey(event.target);
      return;
    }
    if (event.target.matches('[data-quote-settings-form]')) {
      event.preventDefault();
      await submitQuoteSettings(event.target);
      return;
    }
    if (event.target.matches('[data-quote-checklist-form]')) {
      event.preventDefault();
      await submitQuoteChecklist(event.target);
      return;
    }
    if (event.target.id === 'supply-issue-form') {
      event.preventDefault();
      const order = await submitSupplyIssue(state.session, container, {
        onDone: async () => {
          state.supply = {
            ...state.supply,
            open: false,
            requestId: '',
            toAccountId: '',
            toName: '',
            date: '',
            note: '',
            quantities: {},
          };
          await render();
        },
      });
      if (order) await openSupplyReceipt(order.id);
      return;
    }
    if (event.target.id === 'supply-item-form') {
      event.preventDefault();
      const item = await addSupplyItemFromForm(state.session, event.target);
      if (item) {
        state.supply.catalogOpen = true;
        await render();
      }
      return;
    }
    if (event.target.matches('[data-site-details-form]')) {
      event.preventDefault();
      await submitSiteDetails(event.target);
      return;
    }
    if (event.target.matches('[data-staff-check-form]')) {
      event.preventDefault();
      const form = event.target;
      try {
        await store.addStaffCheck({
          staffContractId: form.dataset.staffCheckForm,
          grade: form.querySelector('[data-check-grade]')?.value || 'A',
          siteId: form.querySelector('[data-check-site]')?.value || '',
          date: form.querySelector('[data-check-date]')?.value || '',
          memo: form.querySelector('[data-check-memo]')?.value || '',
          reviewerId: state.session ? state.session.accountId : '',
          reviewerName: state.session ? state.session.name : '',
        });
        await render();
        toast('근무태도 체크를 저장했습니다.');
      } catch (error) {
        toast(error.message || '근무태도를 저장하지 못했습니다.', { tone: 'error' });
      }
      return;
    }
    if (event.target.id === 'new-quote-form') {
      await submitNewQuote(event);
      return;
    }
    if (event.target.id === 'new-staff-form') {
      await submitNewStaff(event);
      return;
    }
    if (event.target.id === 'new-site-form') {
      await submitNewSite(event);
      return;
    }
    if (event.target.id !== 'admin-login') return;
    event.preventDefault();
    state.loginError = '';
    try {
      const session = await loginAdmin({
        phone: $('#a-phone', container)?.value || '',
        password: $('#a-password', container)?.value || '',
        leaderCode: $('#a-code', container)?.value || '',
      });
      toast(
        session.role === 'admin'
          ? `${session.name} 대표로 로그인했습니다.`
          : `${session.name} 본부장으로 로그인했습니다. 현장 · 직원 체크 화면입니다.`,
      );
      await render();
    } catch (error) {
      state.loginError = error.message || '로그인에 실패했습니다.';
      await render();
      const phoneInput = $('#a-phone', container);
      if (phoneInput) phoneInput.focus();
    }
  }

  async function onClick(event) {
    /* ---------------- 2단계 현장 방문 · 사진 · 금액 승인 ---------------- */
    const surveyLoad = event.target.closest('[data-survey-load]');
    if (surveyLoad) {
      captureSurveyForm();
      const pick = $('#sv-site-pick', container);
      const siteId = pick ? pick.value : '';
      if (!siteId) {
        toast('불러올 업장을 먼저 고르세요.', { tone: 'error' });
        return;
      }
      const site = await store.getSite(siteId);
      if (!site) {
        toast('업장을 찾을 수 없습니다.', { tone: 'error' });
        return;
      }
      state.survey.form = surveyFormFromSite(site);
      state.survey.siteId = site.id;
      state.survey.photoSiteId = site.id;
      state.survey.open = true;
      await render();
      toast(`${site.name} 업장 정보를 채웠습니다. 사진·구역만 확인하고 저장하세요.`);
      return;
    }

    const editQuote = event.target.closest('[data-edit-quote]');
    if (editQuote) {
      const quote = await store.getQuote(editQuote.dataset.editQuote);
      if (!quote) return;
      state.survey.editQuoteId = quote.id;
      state.survey.form = surveyFormFromQuote(quote);
      state.survey.open = true;
      state.survey.error = '';
      await render();
      const box = $('[data-survey-form-box]', container);
      if (box) {
        box.open = true;
        box.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
      return;
    }

    const cancelEdit = event.target.closest('[data-survey-cancel]');
    if (cancelEdit) {
      state.survey.editQuoteId = '';
      state.survey.form = null;
      state.survey.error = '';
      state.survey.open = false;
      await render();
      return;
    }

    const approveQuote = event.target.closest('[data-approve-quote]');
    if (approveQuote) {
      captureSurveyForm();
      const quote = await store.getQuote(approveQuote.dataset.approveQuote);
      if (!quote) return;
      const ok = await confirmDialog({
        title: '최종 금액을 승인할까요?',
        message: `${quote.clientCompany} · ${quote.no} · 최종 ${fmtWon(quote.amount)}. 승인하면 같은 업장으로 계약서가 자동으로 만들어집니다.`,
        confirmLabel: '승인',
      });
      if (!ok) return;
      try {
        const result = await store.approveQuoteAmount(quote.id, {
          by: state.session ? state.session.name : '대표',
          role: 'admin',
        });
        await render();
        toast(`금액 승인 완료 · 계약서 ${result.agreement.no}가 만들어졌습니다.`, { duration: 8000 });
      } catch (error) {
        toast(error.message || '금액을 승인하지 못했습니다.', { tone: 'error' });
      }
      return;
    }

    const photoArea = event.target.closest('[data-photo-area]');
    if (photoArea) {
      captureSurveyForm();
      state.survey.photoArea = photoArea.dataset.photoArea;
      state.survey.photoOpen = true;
      await render();
      return;
    }

    const zoneAdd = event.target.closest('[data-zone-add]');
    if (zoneAdd) {
      const list = $('.checklist-editor-list', container);
      if (!list) return;
      const key = `zone${Date.now().toString(36)}`;
      const wrap = document.createElement('div');
      wrap.className = 'checklist-editor';
      wrap.dataset.checklistZone = key;
      wrap.innerHTML = '<div class="checklist-editor__head"><input class="input input--sm" data-zone-label placeholder="새 구역 이름" maxlength="30" aria-label="구역 이름"><span class="tag tag--sky">새 구역</span><button class="link-btn" type="button" data-zone-remove>구역 삭제</button></div><textarea class="textarea" rows="3" data-zone-items aria-label="새 구역 항목" placeholder="한 줄에 항목 하나씩"></textarea><input type="hidden" data-zone-kind value="normal">';
      list.appendChild(wrap);
      const first = wrap.querySelector ? wrap.querySelector('[data-zone-label]') : null;
      if (first && first.focus) first.focus();
      return;
    }

    const zoneRemove = event.target.closest('[data-zone-remove]');
    if (zoneRemove) {
      const box = zoneRemove.closest('.checklist-editor');
      if (box && box.remove) box.remove();
      return;
    }

    /* ---------------- 최고관리자 화면 모드 전환 ---------------- */
    const workMode = event.target.closest('[data-work-mode]');
    if (workMode) {
      const mode = workMode.dataset.workMode === 'staff' ? 'staff' : 'admin';
      if (mode === getWorkMode()) return;
      setWorkMode(mode);
      if (mode === 'staff') {
        toast('직원 모드로 전환했습니다. 팀장처럼 현장을 골라 보고서를 쓸 수 있습니다.');
        document.dispatchEvent(new CustomEvent('kec:navigate', { detail: { tab: 'leader' } }));
      } else {
        toast('관리자 모드로 전환했습니다.');
        await render();
      }
      return;
    }

    /* ---------------- 보고 확인 · 고객사 제출 ---------------- */
    const approvalPhoto = event.target.closest('[data-approval-photo]');
    if (approvalPhoto) {
      await openApprovalPhoto(
        approvalPhoto.dataset.approvalPhoto,
        approvalPhoto.dataset.photoGroup,
        approvalPhoto.dataset.photoIndex,
      );
      return;
    }

    const approveButton = event.target.closest('[data-approve-report]');
    if (approveButton) {
      await approveReportToCustomer(approveButton.dataset.approveReport, approveButton);
      return;
    }

    /* ---------------- 청소장비 · 봉투 영수증 (대표) ---------------- */
    const blankSubcontract = event.target.closest('[data-blank-subcontract]');
    if (blankSubcontract) {
      openBlankSubcontractSheet();
      return;
    }

    const issueFromRequest = event.target.closest('[data-supply-issue]');
    if (issueFromRequest) {
      const order = await store.getSupplyOrder(issueFromRequest.dataset.supplyIssue);
      if (!order) return;
      state.supply = {
        ...state.supply,
        open: true,
        requestId: order.id,
        toAccountId: order.toAccountId || '',
        toName: order.toName || order.requesterName || '',
        date: toISODate(),
        note: order.note || '',
        quantities: Object.fromEntries((order.items || []).map((line) => [line.catalogId, line.qty])),
      };
      await render();
      const panel = $('[data-supply-issue-panel]', container);
      if (panel) {
        panel.open = true;
        panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
      return;
    }

    const viewReceipt = event.target.closest('[data-supply-view]');
    if (viewReceipt) {
      await openSupplyReceipt(viewReceipt.dataset.supplyView);
      return;
    }

    const savePrice = event.target.closest('[data-supply-price-save]');
    if (savePrice) {
      const id = savePrice.dataset.supplyPriceSave;
      const input = $(`[data-supply-price-input="${id}"]`, container);
      const item = await saveSupplyPrice(state.session, id, input ? input.value : 0);
      if (item) await render();
      return;
    }

    const removeItem = event.target.closest('[data-supply-remove]');
    if (removeItem) {
      const item = await store.getSupplyItem(removeItem.dataset.supplyRemove);
      if (!item) return;
      if (await removeSupplyItem(state.session, item)) await render();
      return;
    }

    const openStaffRoom = event.target.closest('[data-open-staff-room]');
    if (openStaffRoom) {
      state.staffDetail = openStaffRoom.dataset.openStaffRoom;
      await render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const closeStaffRoom = event.target.closest('[data-close-staff-room]');
    if (closeStaffRoom) {
      state.staffDetail = '';
      await render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const openQuote = event.target.closest('[data-open-quote]');
    if (openQuote) {
      await openQuoteSheet(openQuote.dataset.openQuote, { role: 'admin', onChanged: render });
      return;
    }

    const sendQuote = event.target.closest('[data-send-quote]');
    if (sendQuote) {
      try {
        const quote = await store.sendQuote(sendQuote.dataset.sendQuote);
        await render();
        toast(`${quote.clientCompany} 견적서를 발송했습니다.`);
      } catch (error) {
        toast(error.message || '견적서를 발송하지 못했습니다.', { tone: 'error' });
      }
      return;
    }

    const contractFromQuote = event.target.closest('[data-contract-from-quote]');
    if (contractFromQuote) {
      try {
        const agreement = await store.createAgreementFromQuote(contractFromQuote.dataset.contractFromQuote);
        await render();
        await openAgreementSheet(agreement.id, { role: 'admin', onChanged: render });
      } catch (error) {
        toast(error.message || '계약서를 만들지 못했습니다.', { tone: 'error' });
      }
      return;
    }

    const openAgreement = event.target.closest('[data-open-agreement]');
    if (openAgreement) {
      await openAgreementSheet(openAgreement.dataset.openAgreement, { role: 'admin', onChanged: render });
      return;
    }

    const copyQuoteInvite = event.target.closest('[data-copy-quote-invite]');
    if (copyQuoteInvite) {
      const quote = await store.getQuote(copyQuoteInvite.dataset.copyQuoteInvite);
      if (quote) {
        const sent = await ensureQuoteSent(quote);
        const ok = await copyText(quoteInviteMessage(sent));
        toast(ok ? `${sent.clientCompany} 초대 문구를 복사했습니다.` : '복사가 차단되었습니다.', { tone: ok ? 'default' : 'error' });
        if (sent !== quote) await render();
      }
      return;
    }

    // 초대 링크만 복사 — 링크를 받은 사람이 열면 코드가 입력된 입장 화면이 뜨는습니다.
    const copyQuoteLink = event.target.closest('[data-copy-quote-link]');
    if (copyQuoteLink) {
      const quote = await store.getQuote(copyQuoteLink.dataset.copyQuoteLink);
      if (quote) {
        const sent = await ensureQuoteSent(quote);
        const ok = await copyText(inviteUrl(sent.inviteCode));
        toast(ok ? `초대 링크를 복사했습니다 · ${inviteUrl(sent.inviteCode)}` : inviteUrl(sent.inviteCode), {
          tone: ok ? 'default' : 'error',
          duration: 7000,
        });
        if (sent !== quote) await render();
      }
      return;
    }

    const regenQuoteInvite = event.target.closest('[data-regen-quote-invite]');
    if (regenQuoteInvite) {
      const ok = await confirmDialog({
        title: '초대코드를 재발급할까요?',
        message: '이전 초대코드는 즉시 사용할 수 없게 됩니다. 새 문구를 고객에게 다시 보내 주세요.',
        confirmLabel: '재발급',
      });
      if (!ok) return;
      try {
        const quote = await store.regenerateQuoteInvite(regenQuoteInvite.dataset.regenQuoteInvite);
        await render();
        toast(`새 초대코드 ${quote.inviteCode}`, {
          actionLabel: '초대 문구 복사',
          onAction: () => copyText(quoteInviteMessage(quote)),
          duration: 8000,
        });
      } catch (error) {
        toast(error.message || '초대코드를 재발급하지 못했습니다.', { tone: 'error' });
      }
      return;
    }

    const openStaff = event.target.closest('[data-open-staff]');
    if (openStaff) {
      await openStaffContractSheet(openStaff.dataset.openStaff, { role: 'admin', onChanged: render });
      return;
    }

    const sendStaff = event.target.closest('[data-send-staff]');
    if (sendStaff) {
      try {
        const contract = await store.sendStaffContract(sendStaff.dataset.sendStaff);
        await render();
        toast(`${contract.name}님에게 계약서를 보냈습니다.`);
      } catch (error) {
        toast(error.message || '계약서를 보내지 못했습니다.', { tone: 'error' });
      }
      return;
    }

    const copyStaffInvite = event.target.closest('[data-copy-staff-invite]');
    if (copyStaffInvite) {
      const found = await store.getStaffContract(copyStaffInvite.dataset.copyStaffInvite);
      if (found) {
        const contract = await ensureStaffSent(found);
        const ok = await copyText(staffInviteMessage(contract));
        toast(ok ? `${contract.name}님 직원 초대 문구를 복사했습니다.` : '복사가 차단되었습니다.', { tone: ok ? 'default' : 'error' });
        if (contract !== found) await render();
      }
      return;
    }

    // 직원 · 도급처 계약서 초대 링크만 복사.
    const copyStaffLink = event.target.closest('[data-copy-staff-link]');
    if (copyStaffLink) {
      const found = await store.getStaffContract(copyStaffLink.dataset.copyStaffLink);
      if (found) {
        const contract = await ensureStaffSent(found);
        const ok = await copyText(inviteUrl(contract.inviteCode));
        toast(ok ? `초대 링크를 복사했습니다 · ${inviteUrl(contract.inviteCode)}` : inviteUrl(contract.inviteCode), {
          tone: ok ? 'default' : 'error',
          duration: 7000,
        });
        if (contract !== found) await render();
      }
      return;
    }

    const regenStaffInvite = event.target.closest('[data-regen-staff-invite]');
    if (regenStaffInvite) {
      const ok = await confirmDialog({
        title: '직원 초대코드를 재발급할까요?',
        message: '이전 코드는 즉시 사용할 수 없게 됩니다.',
        confirmLabel: '재발급',
      });
      if (!ok) return;
      try {
        const contract = await store.regenerateStaffInvite(regenStaffInvite.dataset.regenStaffInvite);
        await render();
        toast(`새 직원 초대코드 ${contract.inviteCode}`, {
          actionLabel: '초대 문구 복사',
          onAction: () => copyText(staffInviteMessage(contract)),
          duration: 8000,
        });
      } catch (error) {
        toast(error.message || '초대코드를 재발급하지 못했습니다.', { tone: 'error' });
      }
      return;
    }

    const fill = event.target.closest('[data-fill-admin]');
    if (fill) {
      const [phone, password, code] = fill.dataset.fillAdmin.split('|');
      const phoneInput = $('#a-phone', container);
      const passwordInput = $('#a-password', container);
      const codeInput = $('#a-code', container);
      if (phoneInput) phoneInput.value = phone;
      if (passwordInput) passwordInput.value = password;
      if (codeInput) codeInput.value = code || '';
      return;
    }

    const copy = event.target.closest('[data-copy-code]');
    if (copy) {
      const ok = await copyText(copy.dataset.copyCode);
      toast(ok ? `${copy.dataset.copyCode} 코드를 복사했습니다.` : '복사가 차단되었습니다. 코드를 길게 눌러 복사해 주세요.');
      return;
    }

    // 정기청소 현장 1회용 코드(C-…) 초대 링크 · 문구.
    const copyCodeLink = event.target.closest('[data-copy-code-link]');
    if (copyCodeLink) {
      const [code, siteName] = String(copyCodeLink.dataset.copyCodeLink).split('|');
      const ok = await copyText(roomCodeInviteMessage(siteName, code));
      toast(ok ? `초대 문구를 복사했습니다 · ${inviteUrl(code)}` : '복사가 차단되었습니다.', {
        tone: ok ? 'default' : 'error',
        duration: 7000,
      });
      return;
    }

    const issue = event.target.closest('[data-issue-site]');
    if (issue) {
      if (state.busy) return;
      state.busy = true;
      setBusy(issue, true, '발급 중…');
      try {
        const record = await store.issueRoomCode(issue.dataset.issueSite);
        await render();
        toast(`새 1회용 코드 ${record.code}를 발급했습니다.`, {
          actionLabel: '복사',
          onAction: () => copyText(record.code),
          duration: 8000,
        });
      } catch (error) {
        toast(error.message || '코드를 발급하지 못했습니다.', { tone: 'error' });
      } finally {
        state.busy = false;
      }
      return;
    }

    const regen = event.target.closest('[data-regen-leader]');
    if (regen) {
      const ok = await confirmDialog({
        title: '팀장 고유코드를 재발급할까요?',
        message: '기존 코드는 즉시 사용할 수 없게 됩니다. 새 코드를 팀장에게 전달해 주세요.',
        confirmLabel: '재발급',
      });
      if (!ok) return;
      try {
        const account = await store.regenerateLeaderCode(regen.dataset.regenLeader);
        await render();
        toast(`${account.name} 팀장 새 코드 ${account.leaderCode}`, {
          actionLabel: '복사',
          onAction: () => copyText(account.leaderCode),
          duration: 8000,
        });
      } catch (error) {
        toast(error.message || '코드를 재발급하지 못했습니다.', { tone: 'error' });
      }
      return;
    }

    const toggle = event.target.closest('[data-toggle-account]');
    if (toggle) {
      const account = await store.getAccount(toggle.dataset.toggleAccount);
      if (!account) return;
      const nextActive = account.active === false;
      await store.updateAccount(account.id, { active: nextActive });
      await render();
      toast(`${account.name} ${account.title || '팀장'} 계정을 ${nextActive ? '다시 사용' : '중지'}했습니다.`);
      return;
    }

    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;

    if (action === 'logout') {
      await logout();
      await render();
      toast('로그아웃했습니다.');
      return;
    }
    if (action === 'reset-demo') {
      const ok = await confirmDialog({
        title: '데모 데이터를 초기화할까요?',
        message: '이 기기의 모든 계정·현장·보고·코드가 샘플 상태로 돌아갑니다.',
        confirmLabel: '초기화',
        tone: 'danger',
      });
      if (!ok) return;
      await store.resetDemo();
      await logout();
      await render();
      toast('데모 데이터를 초기화했습니다.');
    }
  }

  function mount() {
    if (mounted) return;
    container.addEventListener('submit', onSubmit);
    container.addEventListener('click', onClick);
    container.addEventListener('change', onChange);
    container.addEventListener('input', onInput);
    // 단가 관리 상자를 열어 둔 채로 저장해도 그대로 열려 있게 합니다.
    container.addEventListener(
      'toggle',
      (event) => {
        if (event.target.matches && event.target.matches('[data-supply-catalog]')) {
          state.supply.catalogOpen = !!event.target.open;
        }
      },
      true,
    );
    mounted = true;
  }

  return { render };
}
