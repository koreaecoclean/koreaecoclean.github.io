/**
 * views/supply.js — 청소장비 · 배접봉투 구입 신청과 영수증.
 *
 * 권한
 *  - 최고관리자(대표) : 품목·단가 관리, 영수증 발행, 전체 영수증 열람
 *  - 구입 당사자 직원 : 자기 구입 신청, 자기 영수증 인쇄/PDF (다른 직원 것은 보이지 않음)
 *  - 부관리자(본부장) · 고객 : 이 화면 자체가 열리지 않습니다 (store.canUseSupply).
 *
 * 영수증은 첨부된 ‘직원 청소도구 구입’ 영수증 사진의 서식을 그대로 따릅니다.
 */

import { esc, fmtWon, fmtNumber, toast, confirmDialog, toISODate } from '../ui.js';
import { store, SUPPLY_STATUS, supplyTotals } from '../store.js';
import { RECEIPT_ISSUER, SUPPLY_GROUPS } from '../seed.js';
import { companySealImg } from '../seal.js';
import { openDocumentSheet } from './quote-contract.js';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** '2026-11-25' → '2026년 11월 25일' (ISO 타임스탬프도 날짜만 씀니다) */
export function formatReceiptDate(iso) {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-');
  if (!y || !m || !d) return String(iso || '');
  return `${Number(y)}년 ${Number(m)}월 ${Number(d)}일`;
}

/** '2026-11-25' → '2026.11.25.' — 목록용 짧은 날짜 */
function shortDate(value) {
  const [y, m, d] = String(value || '').slice(0, 10).split('-');
  if (!y || !m || !d) return String(value || '');
  return `${y}.${m}.${d}.`;
}

/** 단가가 0원(미정)이면 ‘단가 미정’. */
export function supplyPriceLabel(price) {
  return Number(price) > 0 ? fmtWon(price) : '단가 미정';
}

function groupKey(item) {
  return SUPPLY_GROUPS[item.group] ? item.group : 'equipment';
}

function groupsOf(catalog) {
  return Object.keys(SUPPLY_GROUPS)
    .map((key) => ({ key, label: SUPPLY_GROUPS[key].label, items: catalog.filter((item) => groupKey(item) === key) }))
    .filter((group) => group.items.length);
}

/** '배접봉투 특대 … 2 · 마포걸레 2' — 목록 한 줄 요약. */
export function supplyItemsSummary(order) {
  return (order.items || [])
    .filter((row) => Number(row.qty) > 0)
    .map((row) => `${row.name} ${fmtNumber(row.qty)}`)
    .join(' · ');
}

/** 등록된 직원 중 구입자가 될 수 있는 사람 — 부관리자(본부장)는 금액을 다루지 않으므로 제외합니다. */
export function supplyEligibleBuyers(accounts = []) {
  return accounts
    .filter((account) => account && account.active !== false)
    .filter((account) => account.role === 'admin' || account.role === 'leader')
    .filter((account) => !(account.role === 'leader' && (account.canManageStaff || /본부장/.test(account.title || ''))));
}

/** 폼 안의 수량 입력을 { catalogId: qty } 로 읽습니다. */
export function readSupplyQuantities(root) {
  const out = {};
  root.querySelectorAll('[data-supply-qty]').forEach((input) => {
    const qty = Math.max(0, Math.round(Number(input.value) || 0));
    if (qty > 0) out[input.dataset.supplyQty] = qty;
  });
  return out;
}

/** 수량 입력이 바뀔 때마다 합계와 ‘단가 미정’ 안내를 다시 계산합니다. */
export function refreshSupplyTotal(root) {
  const target = root.querySelector('[data-supply-total]');
  if (!target) return;
  let total = 0;
  let pending = false;
  root.querySelectorAll('[data-supply-qty]').forEach((input) => {
    const qty = Math.max(0, Math.round(Number(input.value) || 0));
    if (!qty) return;
    const price = Number(input.dataset.supplyPrice) || 0;
    if (!price) pending = true;
    total += price * qty;
  });
  target.textContent = fmtWon(total);
  const note = root.querySelector('[data-supply-pending]');
  if (note) note.hidden = !pending;
}

/* ------------------------------------------------------------------ */
/* 영수증 시트                                                          */
/* ------------------------------------------------------------------ */

/* 영수증 도장은 대표가 준 실제 직인 이미지(assets/company-seal.png)를 씁니다. */

export function supplyReceiptHtml(order) {
  const rows = order.items || [];
  const { total, pending } = supplyTotals(rows);
  const buyer = order.toName || order.requesterName || '';
  return `
    <article class="sheet receipt" data-doc="receipt" data-receipt="${esc(order.id)}">
      <header class="receipt__head">
        <img class="receipt__logo" src="assets/logo.png" alt="코리아 에코크린" width="84" height="84" decoding="async">
        <h1 class="receipt__title">영 수 증</h1>
        <p class="receipt__sub">${esc(RECEIPT_ISSUER.subtitle)}</p>
      </header>

      <dl class="receipt__meta">
        <div><dt>상호</dt><dd>${esc(RECEIPT_ISSUER.name)}</dd></div>
        <div><dt>대표</dt><dd>${esc(RECEIPT_ISSUER.ceo)}</dd></div>
        <div><dt>사업자번호</dt><dd>${esc(RECEIPT_ISSUER.bizNumber)}</dd></div>
        <div><dt>주소</dt><dd>${esc(RECEIPT_ISSUER.address)}</dd></div>
        <div><dt>전화</dt><dd>${esc(RECEIPT_ISSUER.phone)}</dd></div>
        <div><dt>발행일</dt><dd>${esc(formatReceiptDate(order.date || order.issuedAt))}</dd></div>
      </dl>

      <div class="receipt__buyer">
        <span>구입자</span>
        <strong>${esc(buyer)}</strong>
      </div>

      <table class="receipt__table">
        <thead>
          <tr><th scope="col">품목</th><th scope="col">수량</th><th scope="col">금액</th></tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
            <tr>
              <td class="receipt__item">
                <strong>${esc(row.name)}</strong>
                <span class="receipt__unit">${row.price > 0 ? `단가 ${fmtWon(row.price)}` : '단가 미정'}${row.note ? ` · ${esc(row.note)}` : ''}</span>
              </td>
              <td class="receipt__qty">${fmtNumber(row.qty)}</td>
              <td class="receipt__amount">${fmtWon(row.amount)}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>

      <div class="receipt__total">
        <span>합계 (현금가)</span>
        <strong>${fmtWon(total)}</strong>
      </div>
      <p class="receipt__vat">※ 현금 결제 금액 · 부가세 별도</p>
      ${pending ? '<p class="receipt__pending">※ 단가 미정 품목이 포함되어 있습니다. 대표가 단가를 입력하면 금액이 확정됩니다.</p>' : ''}
      ${order.note ? `<p class="receipt__memo">${esc(order.note)}</p>` : ''}

      <div class="receipt__foot">
        <p class="receipt__confirm">위 금액을 정히 영수합니다.</p>
        <div class="receipt__sign">
          <span>코리아에코크린 대표 ${esc(RECEIPT_ISSUER.ceo)}</span>
          <span class="receipt__seal">${companySealImg({ className: 'receipt__seal-img', alt: '코리아 에코크린 대표 직인' })}</span>
        </div>
        <p class="receipt__thanks">감사합니다</p>
      </div>
    </article>`;
}

/** 영수증 시트 열기 — 시트 아래 [인쇄 / PDF 저장] 버튼으로 A4 인쇄가 됩니다. */
export async function openSupplyReceipt(orderId) {
  const order = await store.getSupplyOrder(orderId);
  if (!order) {
    toast('영수증을 찾지 못했습니다.', { tone: 'error' });
    return;
  }
  openDocumentSheet({
    title: `영수증 · ${order.toName || order.requesterName} · ${order.no}`,
    html: supplyReceiptHtml(order),
    actions: `
      <button class="btn btn--primary" type="button" data-sheet="print">인쇄 / PDF 저장</button>
      <button class="btn btn--quiet" type="button" data-sheet="close">닫기</button>`,
  });
}

/* ------------------------------------------------------------------ */
/* 공통 조각                                                            */
/* ------------------------------------------------------------------ */

function quantityRow(item, qty, { staffView = false } = {}) {
  return `
    <div class="supply-line">
      <div class="supply-line__name">
        <strong>${esc(item.name)}</strong>
        <span>${esc(supplyPriceLabel(item.price))}${item.note ? ` · ${esc(item.note)}` : ''}</span>
      </div>
      <label class="supply-line__qty">
        <span>수량</span>
        <input class="input" type="number" inputmode="numeric" min="0" max="999" step="1"
               value="${qty || 0}" data-supply-qty="${esc(item.id)}" data-supply-price="${item.price}"
               aria-label="${esc(item.name)} 수량"${staffView ? '' : ' data-supply-admin="1"'}>
      </label>
    </div>`;
}

function quantityBlocks(catalog, quantities = {}, options = {}) {
  return groupsOf(catalog)
    .map(
      (group) => `
      <div class="supply-group">
        <p class="supply-group-title">${esc(group.label)} <span class="tiny muted">${group.items.length}종</span></p>
        ${group.items.map((item) => quantityRow(item, quantities[item.id], options)).join('')}
      </div>`,
    )
    .join('');
}

function totalBlock(label = '합계', total = 0) {
  return `
    <div class="supply-total">
      <span>${esc(label)}</span>
      <strong data-supply-total>${fmtWon(total)}</strong>
    </div>
    <p class="supply-pending tiny" data-supply-pending hidden>※ 단가 미정 품목이 있습니다. 대표가 단가를 넣으면 금액이 확정됩니다.</p>`;
}

/** 화면에 채워진 수량으로 합계를 미리 계산합니다. */
function quantitiesTotal(catalog, quantities = {}) {
  return catalog.reduce((sum, item) => sum + (Number(quantities[item.id]) || 0) * item.price, 0);
}

function orderRow(order, actionHtml) {
  const status = SUPPLY_STATUS[order.status] || SUPPLY_STATUS.requested;
  const when = shortDate(order.date || order.requestedAt);
  return `
    <div class="supply-row" data-supply-order="${esc(order.id)}">
      <div class="supply-row__who">
        <strong>${esc(order.toName || order.requesterName)} <span class="badge ${status.badge}">${esc(status.label)}</span></strong>
        <span>${esc(when)} · ${esc(order.no)}</span>
        <span class="supply-row__items">${esc(supplyItemsSummary(order))}</span>
      </div>
      <div class="supply-row__right">
        <strong>${fmtWon(order.total)}</strong>
        ${actionHtml}
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* 최고관리자(대표) 패널                                                */
/* ------------------------------------------------------------------ */

export function supplyAdminPanel({ catalog = [], orders = [], accounts = [], state = {} }) {
  const form = (state && state.supply) || {};
  const requested = orders.filter((order) => order.status === 'requested');
  const issued = orders.filter((order) => order.status === 'issued');
  const buyers = supplyEligibleBuyers(accounts);
  const quantities = form.quantities || {};
  const requestOrder = form.requestId ? requested.find((order) => order.id === form.requestId) : null;

  return `
    <section class="panel supply-panel" data-supply-panel>
      <div class="section-head">
        <h2>청소장비 · 봉투 영수증</h2>
        <p>대표 전용 · 금액 관리</p>
      </div>

      <div class="supply-block" data-supply-requests>
        <div class="section-head"><h3>직원 구입 신청</h3><p>${requested.length}건</p></div>
        ${
          requested.length
            ? requested
                .map((order) =>
                  orderRow(
                    order,
                    `<button class="btn btn--sm btn--ghost" type="button" data-supply-issue="${esc(order.id)}">영수증 발행</button>`,
                  ),
                )
                .join('')
            : '<p class="tiny muted">대기 중인 신청이 없습니다. 아래에서 바로 발행할 수 있습니다.</p>'
        }
      </div>

      <details class="settings" data-supply-issue-panel ${form.open ? 'open' : ''}>
        <summary>+ 영수증 발행</summary>
        <div class="settings__body">
          ${
            requestOrder
              ? `<p class="hint">${esc(requestOrder.requesterName)} 님의 신청을 그대로 채웠습니다. 수량과 단가를 확인하고 발행하세요.</p>`
              : ''
          }
          <form class="form" id="supply-issue-form" novalidate data-supply-request="${esc(form.requestId || '')}">
            <div class="field">
              <label for="sup-to">구입자 선택</label>
              <select class="select" id="sup-to">
                <option value="">직접 입력</option>
                ${buyers
                  .map(
                    (account) =>
                      `<option value="${esc(account.id)}" ${account.id === form.toAccountId ? 'selected' : ''}>${esc(account.name)} ${esc(account.title || '')}</option>`,
                  )
                  .join('')}
              </select>
            </div>
            <div class="field">
              <label for="sup-to-name">구입자 이름 <span class="req">*</span></label>
              <input class="input" id="sup-to-name" type="text" maxlength="30" placeholder="예: 김미영 팀장" value="${esc(form.toName || '')}">
            </div>
            <div class="field">
              <label for="sup-date">발행일</label>
              <input class="input" id="sup-date" type="date" value="${esc(form.date || toISODate())}">
            </div>

            <p class="details-head">품목 · 수량 (여러 품목 선택 가능)</p>
            ${quantityBlocks(catalog, quantities, { staffView: true })}
            ${totalBlock('합계 (현금가)', quantitiesTotal(catalog, quantities))}

            <div class="field">
              <label for="sup-note">비고 (선택)</label>
              <input class="input" id="sup-note" type="text" maxlength="60" placeholder="예: 하늘치과 현장 봉투 소진" value="${esc(form.note || '')}">
            </div>
            <button class="btn btn--primary btn--block" type="submit">영수증 발행</button>
            <p class="hint">발행하면 직원의 ‘내 영수증’에 바로 표시되고, 직원이 인쇄 / PDF로 저장할 수 있습니다.</p>
          </form>
        </div>
      </details>

      <div class="supply-block" data-supply-issued>
        <div class="section-head"><h3>발행된 영수증</h3><p>${issued.length}건</p></div>
        ${
          issued.length
            ? issued
                .map((order) =>
                  orderRow(
                    order,
                    `<button class="btn btn--sm btn--quiet" type="button" data-supply-view="${esc(order.id)}">영수증 보기</button>`,
                  ),
                )
                .join('')
            : '<p class="tiny muted">아직 발행한 영수증이 없습니다.</p>'
        }
      </div>

      <details class="settings" data-supply-catalog ${form.catalogOpen ? 'open' : ''}>
        <summary>품목 · 단가 관리 (${catalog.length}개)</summary>
        <div class="settings__body">
          <p class="hint">단가를 고치고 [저장]을 누르면 바로 반영됩니다. 단가 0원은 ‘미정’으로 표시됩니다.</p>
          <div class="supply-catalog">
            ${groupsOf(catalog)
              .map(
                (group) => `
              <p class="supply-group-title">${esc(group.label)}</p>
              ${group.items
                .map(
                  (item) => `
                <div class="supply-price-row" data-supply-item="${esc(item.id)}">
                  <div class="supply-price-row__name">
                    <strong>${esc(item.name)}</strong>
                    <span>${esc(item.unit || '')}${item.note ? ` · ${esc(item.note)}` : ''}</span>
                  </div>
                  <div class="supply-price-row__edit">
                    <label class="supply-price-row__field">
                      <span>단가</span>
                      <input class="input" type="number" inputmode="numeric" min="0" step="100" value="${item.price}"
                             data-supply-price-input="${esc(item.id)}" aria-label="${esc(item.name)} 단가">
                    </label>
                    <button class="btn btn--sm btn--quiet" type="button" data-supply-price-save="${esc(item.id)}">저장</button>
                    <button class="btn btn--sm btn--quiet" type="button" data-supply-remove="${esc(item.id)}" aria-label="${esc(item.name)} 삭제">삭제</button>
                  </div>
                </div>`,
                )
                .join('')}`,
              )
              .join('')}
          </div>

          <form class="form supply-new-item" id="supply-item-form" novalidate>
            <p class="details-head">새 품목 추가</p>
            <div class="field">
              <label for="sup-new-name">품목명 <span class="req">*</span></label>
              <input class="input" id="sup-new-name" type="text" maxlength="60" placeholder="예: 배접봉투 왕특대 (검정색 · 10장 1묶음)">
            </div>
            <div class="field-row">
              <div class="field">
                <label for="sup-new-group">구분</label>
                <select class="select" id="sup-new-group">
                  <option value="equipment">청소장비</option>
                  <option value="bag">배접봉투</option>
                </select>
              </div>
              <div class="field">
                <label for="sup-new-price">단가(원)</label>
                <input class="input" id="sup-new-price" type="number" inputmode="numeric" min="0" step="100" value="0">
              </div>
            </div>
            <div class="field">
              <label for="sup-new-note">설명 (선택)</label>
              <input class="input" id="sup-new-note" type="text" maxlength="60" placeholder="예: 본체+5Ah 배터리 2개+듀얼충전기">
            </div>
            <button class="btn btn--ghost btn--block" type="submit">품목 추가</button>
          </form>
        </div>
      </details>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* 직원(구입 당사자) 패널                                               */
/* ------------------------------------------------------------------ */

export function supplyStaffPanel({ catalog = [], orders = [], session = null, state = {} }) {
  const form = (state && state.supply) || {};
  const mine = orders.filter((order) => {
    if (!session) return false;
    return order.toAccountId === session.accountId || order.requesterAccountId === session.accountId;
  });
  const requested = mine.filter((order) => order.status === 'requested');
  const receipts = mine.filter((order) => order.status === 'issued');

  return `
    <section class="panel supply-panel" data-supply-staff>
      <div class="section-head">
        <h2>청소장비 · 봉투 구입</h2>
        <p>신청 · 내 영수증</p>
      </div>
      <p class="tiny muted">필요한 품목의 수량을 적어 신청하면, 대표가 단가를 확인해 영수증을 발행합니다. 발행된 영수증은 이 화면에서 인쇄 / PDF로 저장할 수 있습니다.</p>

      <details class="settings" data-supply-request-panel ${form.open === false ? '' : 'open'}>
        <summary>+ 구입 신청서</summary>
        <div class="settings__body">
          <form class="form" id="supply-request-form" novalidate>
            ${quantityBlocks(catalog, form.quantities || {}, { staffView: true })}
            ${totalBlock('예상 합계', quantitiesTotal(catalog, form.quantities || {}))}
            <div class="field">
              <label for="sup-req-note">메모 (선택)</label>
              <input class="input" id="sup-req-note" type="text" maxlength="60" placeholder="예: 하늘치과 현장 봉투 소진">
            </div>
            <button class="btn btn--primary btn--block" type="submit">구입 신청</button>
          </form>
        </div>
      </details>

      <div class="supply-block" data-my-supply-requests>
        <div class="section-head"><h3>내 신청</h3><p>${requested.length}건</p></div>
        ${
          requested.length
            ? requested.map((order) => orderRow(order, '')).join('')
            : '<p class="tiny muted">대기 중인 신청이 없습니다.</p>'
        }
      </div>

      <div class="supply-block" data-my-receipts>
        <div class="section-head"><h3>내 영수증</h3><p>${receipts.length}건</p></div>
        ${
          receipts.length
            ? receipts
                .map((order) =>
                  orderRow(
                    order,
                    `<button class="btn btn--sm btn--ghost" type="button" data-supply-view="${esc(order.id)}">영수증 보기</button>`,
                  ),
                )
                .join('')
            : '<p class="tiny muted">아직 발행된 영수증이 없습니다.</p>'
        }
      </div>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* 동작                                                                 */
/* ------------------------------------------------------------------ */

/** 수량 입력 → 신청 품목 배열 */
export function supplyQuantitiesToItems(quantities, catalog) {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  return Object.entries(quantities)
    .map(([catalogId, qty]) => {
      const item = byId.get(catalogId);
      return item ? { catalogId, name: item.name, price: item.price, qty } : null;
    })
    .filter(Boolean);
}

/** 직원: 구입 신청 저장 */
export async function submitSupplyRequest(session, root, { onDone } = {}) {
  const quantities = readSupplyQuantities(root);
  if (!Object.keys(quantities).length) {
    toast('구입할 품목의 수량을 하나 이상 적어 주세요.', { tone: 'error' });
    return null;
  }
  const note = (root.querySelector('#sup-req-note') || {}).value || '';
  try {
    const order = await store.createSupplyRequest(
      { accountId: session.accountId, name: session.name, items: Object.entries(quantities).map(([catalogId, qty]) => ({ catalogId, qty })), note },
      { actor: session },
    );
    toast(`${order.no} 구입 신청을 보냈습니다.`);
    if (typeof onDone === 'function') await onDone();
    return order;
  } catch (error) {
    toast(error && error.message ? error.message : '구입 신청을 저장하지 못했습니다.', { tone: 'error' });
    return null;
  }
}

/** 대표: 영수증 발행 (직원 신청 확정 또는 새 발행) */
export async function submitSupplyIssue(session, root, { onDone } = {}) {
  const form = root.querySelector('#supply-issue-form');
  if (!form) return null;
  const quantities = readSupplyQuantities(form);
  if (!Object.keys(quantities).length) {
    toast('영수증에 넣을 품목의 수량을 하나 이상 적어 주세요.', { tone: 'error' });
    return null;
  }
  const select = form.querySelector('#sup-to');
  const toAccountId = (select && select.value) || '';
  const toName = ((form.querySelector('#sup-to-name') || {}).value || '').trim();
  if (!toName) {
    toast('구입자 이름을 입력해 주세요.', { tone: 'error' });
    return null;
  }
  const date = (form.querySelector('#sup-date') || {}).value || toISODate();
  const note = (form.querySelector('#sup-note') || {}).value || '';
  const requestId = form.dataset.supplyRequest || '';
  try {
    const order = await store.issueSupplyOrder(
      requestId,
      { toAccountId, toName, date, note, items: Object.entries(quantities).map(([catalogId, qty]) => ({ catalogId, qty })) },
      { actor: session },
    );
    toast(`${order.no} 영수증을 발행했습니다.`);
    if (typeof onDone === 'function') await onDone();
    return order;
  } catch (error) {
    toast(error && error.message ? error.message : '영수증을 발행하지 못했습니다.', { tone: 'error' });
    return null;
  }
}

/** 대표: 품목 단가 저장 */
export async function saveSupplyPrice(session, itemId, value) {
  try {
    const item = await store.updateSupplyItem(itemId, { price: Number(value) || 0 }, { actor: session });
    toast(`${item.name} 단가를 ${supplyPriceLabel(item.price)}(으)로 저장했습니다.`);
    return item;
  } catch (error) {
    toast(error && error.message ? error.message : '단가를 저장하지 못했습니다.', { tone: 'error' });
    return null;
  }
}

/** 대표: 새 품목 추가 */
export async function addSupplyItemFromForm(session, form) {
  const name = ((form.querySelector('#sup-new-name') || {}).value || '').trim();
  if (!name) {
    toast('품목명을 입력해 주세요.', { tone: 'error' });
    return null;
  }
  try {
    const item = await store.addSupplyItem(
      {
        name,
        group: (form.querySelector('#sup-new-group') || {}).value || 'equipment',
        price: Number((form.querySelector('#sup-new-price') || {}).value) || 0,
        note: ((form.querySelector('#sup-new-note') || {}).value || '').trim(),
      },
      { actor: session },
    );
    toast(`${item.name} 품목을 추가했습니다.`);
    return item;
  } catch (error) {
    toast(error && error.message ? error.message : '품목을 추가하지 못했습니다.', { tone: 'error' });
    return null;
  }
}

/** 대표: 품목 삭제 (이미 쓰인 품목은 목록에서만 감춥니다) */
export async function removeSupplyItem(session, item) {
  const ok = await confirmDialog({
    title: `${item.name} 품목을 삭제할까요?`,
    message: '이미 발행된 영수증의 품목과 금액은 그대로 남습니다. 목록에서만 사라집니다.',
    confirmLabel: '삭제',
    tone: 'danger',
  });
  if (!ok) return false;
  try {
    const result = await store.removeSupplyItem(item.id, { actor: session });
    toast(result.removed ? `${item.name} 품목을 삭제했습니다.` : `${item.name} 품목을 목록에서 감췄습니다.`);
    return true;
  } catch (error) {
    toast(error && error.message ? error.message : '품목을 삭제하지 못했습니다.', { tone: 'error' });
    return false;
  }
}

