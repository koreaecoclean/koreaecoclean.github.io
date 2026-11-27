/**
 * views/quote-contract.js — 견적서 · 표준 도급 계약서 · 직원 계약서 시트.
 *
 * 대표(관리)와 고객 · 직원이 같은 서식을 봅니다. 한 화면 오버레이에서 열리고,
 * @media print 로 서식 본문만 A4로 인쇄/PDF 저장됩니다.
 */

import {
  $,
  esc,
  toast,
  fmtDateDot,
  fmtKoreanAmount,
  fmtNumber,
  fmtWon,
  copyText,
  confirmDialog,
} from '../ui.js';
import { store, QUOTE_STATUS, AGREEMENT_STATUS } from '../store.js';
import { getSession } from '../auth.js';
import { CATEGORY_META, STAFF_TYPES, SUPPLIER, PAYMENT_ACCOUNT } from '../seed.js';
import { companySealImg } from '../seal.js';
import { inviteUrl } from '../invite.js';
import {
  CONTRACT_TITLE,
  CONTRACT_SUBTITLE,
  CONTRACT_INTRO,
  CONTRACT_FOOTER,
  CONTRACT_CLAUSES,
} from '../contract-text.js';

/* ------------------------------------------------------------------ */
/* modal shell                                                         */
/* ------------------------------------------------------------------ */

let modal = null;
let active = null;

function ensureModal() {
  if (modal) return modal;
  modal = document.createElement('div');
  modal.className = 'sheet-modal';
  modal.id = 'sheet-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="sheet-modal__bar">
      <button class="btn btn--sm btn--quiet" type="button" data-sheet="close">닫기</button>
      <strong data-sheet-title>서식</strong>
      <button class="btn btn--sm btn--ghost" type="button" data-sheet="print">인쇄 / PDF</button>
    </div>
    <div class="sheet-modal__body" data-sheet-body></div>
  `;
  modal.addEventListener('click', (event) => {
    const action = event.target.closest('[data-sheet]')?.dataset.sheet;
    if (action === 'close') closeSheet();
    if (action === 'print') window.print();
    const docAction = event.target.closest('[data-doc-action]')?.dataset.docAction;
    if (docAction && active && typeof active.onAction === 'function') {
      active.onAction(docAction, event);
    }
  });
  document.body.appendChild(modal);
  return modal;
}

export function closeSheet() {
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove('sheet-open');
  active = null;
}

/**
 * 다른 화면이 같은 서식 시트를 열 수 있는 통로 (청소장비 · 봉투 영수증 등).
 * `actions` 는 시트 아래에 붙고, data-sheet="print"/"close" 는 이 모달이 직접 처리합니다.
 */
export function openDocumentSheet({ title, html, actions = '', onAction = null }) {
  active = { onAction };
  renderSheet({ title, html, actions });
}

function renderSheet({ title, html, actions = '', afterMount = null }) {
  const box = ensureModal();
  box.hidden = false;
  document.body.classList.add('sheet-open');
  $('[data-sheet-title]', box).textContent = title;
  $('[data-sheet-body]', box).innerHTML = `${html}${
    actions ? `<div class="sheet-actions">${actions}</div>` : ''
  }`;
  $('[data-sheet-body]', box).scrollTop = 0;
  if (typeof afterMount === 'function') afterMount($('[data-sheet-body]', box));
}

function actionButton(label, action, { tone = 'primary', extra = '' } = {}) {
  return `<button class="btn btn--${tone}" type="button" data-doc-action="${esc(action)}" ${extra}>${esc(label)}</button>`;
}

async function photoUrls(photos) {
  const out = [];
  for (const photo of photos || []) {
    const url = await store.photoFullUrl(photo);
    if (url) out.push({ url, caption: photo.caption || '' });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* signature pad — 전용 서명 창 (S펜 · 스타일러스 · 손가락 · 마우스)     */
/* ------------------------------------------------------------------ */

let signModal = null;
let signSession = null;

/**
 * 캔버스 필기판. PointerEvent + setPointerCapture + touch-action:none 로
 * S펜(pointerType 'pen'), 손가락('touch'), 마우스('mouse')를 모두 받습니다.
 * devicePixelRatio 를 반영해 고해상도로 그립니다.
 */
function createSignaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let dirty = false;
  let last = null;

  const strokeWidth = (event) => {
    if (event && event.pointerType === 'pen') {
      const pressure = Number(event.pressure) > 0 ? Number(event.pressure) : 0.5;
      return 1.7 + pressure * 2.6;
    }
    return 2.8;
  };

  const pointOf = (event) => {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const fit = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(240, Math.round(rect.width || 300));
    const height = Math.max(200, Math.round(rect.height || 240));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111c15';
    dirty = false;
    drawing = false;
    last = null;
  };

  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      /* 캡처를 못 해도 그리기는 계속합니다. */
    }
    drawing = true;
    last = pointOf(event);
    ctx.lineWidth = strokeWidth(event);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(last.x + 0.1, last.y + 0.1);
    ctx.stroke();
    dirty = true;
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    event.preventDefault();
    const next = pointOf(event);
    ctx.lineWidth = strokeWidth(event);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    last = next;
    dirty = true;
  });

  const stop = (event) => {
    if (!drawing) return;
    drawing = false;
    last = null;
    try {
      if (event && event.pointerId !== undefined && canvas.hasPointerCapture?.(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    } catch (error) {
      /* 무시 */
    }
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('pointerleave', stop);
  // 팜 리젝션 대신 스크롤·확대를 막습니다.
  canvas.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });

  return {
    fit,
    clear() {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      dirty = false;
      drawing = false;
      last = null;
    },
    isEmpty() {
      return !dirty;
    },
    toDataURL() {
      return dirty ? canvas.toDataURL('image/png') : '';
    },
  };
}

function ensureSignModal() {
  if (signModal) return signModal;
  signModal = document.createElement('div');
  signModal.className = 'sign-modal';
  signModal.id = 'sign-modal';
  signModal.hidden = true;
  signModal.innerHTML = `
    <div class="sign-modal__bar">
      <button class="btn btn--sm btn--quiet" type="button" data-sign="cancel">취소</button>
      <strong>전자서명</strong>
      <button class="btn btn--sm btn--ghost" type="button" data-sign="apply">서명 적용</button>
    </div>
    <div class="sign-modal__body">
      <p class="sign-modal__hint"><span data-sign-label>전자서명</span> — S펜·스타일러스, 손가락, 마우스로 서명해 주세요.</p>
      <div class="sign-modal__field">
        <span class="sign-modal__guide" aria-hidden="true">서 명</span>
        <canvas id="sign-modal-canvas" aria-label="전자서명 패드"></canvas>
        <span class="sign-modal__line" aria-hidden="true"></span>
      </div>
      <div class="sign-modal__actions">
        <button class="btn btn--quiet" type="button" data-sign="clear">지우기</button>
        <button class="btn btn--primary" type="button" data-sign="apply">서명 적용</button>
      </div>
    </div>`;
  signModal.addEventListener('click', (event) => {
    const action = event.target.closest('[data-sign]')?.dataset.sign;
    if (action) onSignAction(action);
  });
  document.body.appendChild(signModal);
  return signModal;
}

function openSignModal(holder) {
  const box = ensureSignModal();
  box.hidden = false;
  document.body.classList.add('sign-open');
  const canvas = $('#sign-modal-canvas', box);
  const pad = createSignaturePad(canvas);
  pad.fit();
  signSession = { holder, pad };
  const label = $('[data-sign-label]', box);
  if (label) label.textContent = holder.dataset.signLabel || '전자서명';
  // 이미 서명한 서식이면 새로 서명합니다.
  canvas.focus?.();
}

function closeSignModal() {
  if (!signModal) return;
  signModal.hidden = true;
  document.body.classList.remove('sign-open');
  signSession = null;
}

function updateSignaturePreview(holder) {
  const field = holder.pad;
  const image = $('[data-sign-preview]', holder);
  const empty = $('[data-sign-empty]', holder);
  const state = $('[data-sign-state]', holder);
  const value = field ? field.toDataURL() : '';
  if (image) {
    image.hidden = !value;
    if (value) image.src = value;
    else image.removeAttribute('src');
  }
  if (empty) empty.hidden = !!value;
  if (state) state.textContent = value ? '서명 완료' : '미서명';
  holder.dataset.signed = value ? 'true' : 'false';
}

function onSignAction(action) {
  if (!signSession) return;
  const { holder, pad } = signSession;
  if (action === 'cancel') {
    closeSignModal();
    return;
  }
  if (action === 'clear') {
    pad.clear();
    return;
  }
  if (action === 'apply') {
    if (pad.isEmpty()) {
      toast('먼저 서명을 해 주세요.', { tone: 'error' });
      return;
    }
    if (holder.pad) holder.pad.signature = pad.toDataURL();
    updateSignaturePreview(holder);
    closeSignModal();
    toast('서명을 넣었습니다. 아래 체결 버튼을 눌러 주세요.');
  }
}

/** 서명 박스(미리보기) — 누르면 전용 서명 창이 열립니다. */
function createSignatureField(holder) {
  const field = {
    signature: '',
    isEmpty() {
      return !field.signature;
    },
    toDataURL() {
      return field.signature;
    },
    clear() {
      field.signature = '';
      updateSignaturePreview(holder);
    },
    open() {
      openSignModal(holder);
    },
  };
  holder.pad = field;
  const box = $('[data-open-signature]', holder);
  if (box) {
    box.addEventListener('click', (event) => {
      event.preventDefault();
      field.open();
    });
  }
  updateSignaturePreview(holder);
  return field;
}

function signatureFieldTemplate(label, hint) {
  return `
    <div class="sign-pad" data-signature-pad data-sign-label="${esc(label)}">
      <div class="sign-pad__head">
        <span>${esc(label)}</span>
        <span class="sign-pad__state" data-sign-state>미서명</span>
      </div>
      <button class="sign-box" type="button" data-open-signature aria-label="${esc(label)} — 서명 창 열기">
        <span class="sign-box__empty" data-sign-empty>✍ 눌러서 서명 — S펜 · 손가락 · 마우스</span>
        <img class="sign-box__image" data-sign-preview alt="${esc(label)} 미리보기" hidden>
      </button>
      <p class="sign-pad__hint">${esc(hint || '서명 박스를 누르면 넓은 서명 창이 열립니다.')}</p>
    </div>`;
}

/**
 * 서명 창 크기가 바뀌면(회전·창 크기 변경) 캔버스를 다시 맞칩니다.
 * 그린 내용은 사라지므로 안내합니다.
 */
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('resize', () => {
    if (!signSession || !signModal || signModal.hidden) return;
    signSession.pad.fit();
  });
}

/* ------------------------------------------------------------------ */
/* 견적서                                                              */
/* ------------------------------------------------------------------ */

function amountLine(amount, vatIncluded) {
  const suffix = vatIncluded ? '부가세 포함' : '부가세 별도';
  return `일금 ${fmtKoreanAmount(amount)}원정 (₩${fmtNumber(amount)}) ${suffix}`;
}

export function quoteSheetHtml(quote, photos = []) {
  const meta = CATEGORY_META[quote.clientCategory] || {};
  const status = QUOTE_STATUS[quote.status] || QUOTE_STATUS.draft;
  const period =
    quote.startDate && quote.endDate
      ? `${fmtDateDot(quote.startDate)} ~ ${fmtDateDot(quote.endDate)} (${quote.periodMonths}개월)`
      : `${quote.periodMonths}개월`;
  return `
    <article class="sheet doc" data-doc="quote">
      <header class="doc__head">
        <h1>견 적 서</h1>
        <p class="doc__sub">QUOTATION · ${esc(quote.no || '')}</p>
        <span class="doc__state">${esc(status.label)}</span>
      </header>

      <table class="doc-table doc-table--kv">
        <tr><th>견적번호</th><td>${esc(quote.no || '-')}</td><th>작성일</th><td>${esc(fmtDateDot(String(quote.createdAt || '').slice(0, 10)))}</td></tr>
        <tr><th>유효기간</th><td>${esc(quote.validUntil ? `${fmtDateDot(quote.validUntil)}까지` : '협의')}</td><th>담당</th><td>${esc(SUPPLIER.ceo)}</td></tr>
      </table>

      <div class="doc__parties">
        <section>
          <h2>공급자</h2>
          <dl>
            <dt>상호</dt><dd>${esc(SUPPLIER.nameKo)}</dd>
            <dt>사업자등록번호</dt><dd>${esc(SUPPLIER.bizNumber)}</dd>
            <dt>대표</dt><dd>${esc(SUPPLIER.ceo)}</dd>
            <dt>연락처</dt><dd>${esc(SUPPLIER.phone)}</dd>
            <dt>이메일</dt><dd>${esc(SUPPLIER.email)}</dd>
            <dt>주소</dt><dd>${esc(SUPPLIER.address)}</dd>
          </dl>
        </section>
        <section>
          <h2>고객사</h2>
          <dl>
            <dt>상호</dt><dd><strong>${esc(quote.clientCompany)}</strong></dd>
            <dt>업종</dt><dd>${esc(meta.label || '')}</dd>
            <dt>담당자</dt><dd>${esc(quote.clientContact || '-')}</dd>
            <dt>연락처</dt><dd>${esc(quote.clientPhone || '-')}</dd>
            <dt>소재지</dt><dd>${esc(quote.clientAddress || '-')}</dd>
            <dt>사업자등록번호</dt><dd>${esc(quote.clientBizNumber || '-')}</dd>
          </dl>
        </section>
      </div>

      <h2 class="doc__h2">청소 범위 · 조건</h2>
      <table class="doc-table">
        <tr><th>청소 주기</th><td>${esc(quote.frequency)}</td></tr>
        <tr><th>기본 청소 범위</th><td class="preserve">${esc(quote.scope || '-')}</td></tr>
        <tr><th>추가 업무 · 공정</th><td class="preserve">${esc(quote.extraScope || '-')}</td></tr>
        <tr><th>면적</th><td>${esc(quote.area || '현장 확인 후 협의')}</td></tr>
        <tr><th>계약기간</th><td>${esc(period)}</td></tr>
      </table>

      <div class="doc__amount">
        <p>월 계약금액</p>
        <strong>${esc(fmtWon(quote.amount))}</strong>
        <em>${quote.vatIncluded ? '부가세 포함' : '부가세 별도'}</em>
        <p class="doc__words">${esc(amountLine(quote.amount, quote.vatIncluded))}</p>
        <p>결제일: 매월 ${esc(quote.billingDay)}일 · 계좌: ${esc(PAYMENT_ACCOUNT.bankName)} ${esc(PAYMENT_ACCOUNT.accountNumber)} (예금주: ${esc(PAYMENT_ACCOUNT.holder)})</p>
      </div>

      ${
        photos.length
          ? `<h2 class="doc__h2">현장 상태 사진</h2>
             <div class="doc__photos">
               ${photos
                 .map(
                   (photo) => `<figure><img src="${esc(photo.url)}" alt="${esc(photo.caption || '현장 사진')}"><figcaption>${esc(photo.caption || '')}</figcaption></figure>`,
                 )
                 .join('')}
             </div>`
          : ''
      }

      ${
        quote.terms || quote.memo
          ? `<h2 class="doc__h2">특약 · 비고</h2>
             <div class="doc__notes">
               ${quote.terms ? `<p class="preserve">${esc(quote.terms)}</p>` : ''}
               ${quote.memo ? `<p class="preserve muted">${esc(quote.memo)}</p>` : ''}
             </div>`
          : ''
      }

      <footer class="doc__foot">
        <p>${esc(CONTRACT_FOOTER)}</p>
        <p class="doc__sign-line">코리아 에코크린 · 대표 ${esc(SUPPLIER.ceo)} ${companySealImg({ className: 'doc__seal-img doc__seal-img--inline' })}</p>
      </footer>
    </article>`;
}

export async function openQuoteSheet(quoteId, options = {}) {
  // v2.8.2 — 견적서는 대표(최고관리자)와 그 견적의 고객만 열람합니다.
  const viewer = await getSession().catch(() => null);
  if (viewer && viewer.role === 'leader') {
    toast('견적서는 대표(최고관리자)만 볼 수 있습니다.', { tone: 'error' });
    return;
  }
  const quote = await store.getQuote(quoteId);
  if (!quote) {
    toast('견적을 찾을 수 없습니다.', { tone: 'error' });
    return;
  }
  const photos = await photoUrls(quote.photos);
  const role = options.role || 'admin';
  const reload = options.onChanged || (() => {});
  const actor = viewer && viewer.role !== 'leader' ? viewer : null;

  active = {
    async onAction(action) {
      if (action === 'send-quote') {
        const ok = await confirmDialog({
          title: '견적서를 발송할까요?',
          message: '고객 방에 ‘도착한 견적서’가 표시되고, 보낸 초대코드로 열람할 수 있습니다.',
          confirmLabel: '발송',
        });
        if (!ok) return;
        await store.sendQuote(quote.id, { actor });
        toast('견적서를 발송했습니다.');
        await reload();
        closeSheet();
        return;
      }
      if (action === 'to-contract') {
        const agreement = await store.createAgreementFromQuote(quote.id, { actor });
        await reload();
        closeSheet();
        await openAgreementSheet(agreement.id, { role: 'admin', onChanged: reload });
        return;
      }
      if (action === 'copy-invite') {
        // 링크·문구를 보낸다는 것은 발송이라는 뜻 — 작성 중이면 발송 상태로 바꿉니다.
        if (quote.status === 'draft') {
          const sent = await store.sendQuote(quote.id, { actor });
          await reload();
          await copyInviteText(sent);
          closeSheet();
          return;
        }
        await copyInviteText(quote);
        return;
      }
      if (action === 'start-contract') {
        const agreement = await store.createAgreementFromQuote(quote.id);
        await reload();
        closeSheet();
        await openAgreementSheet(agreement.id, { role: 'customer', onChanged: reload });
      }
    },
  };

  const actions =
    role === 'admin'
      ? [
          quote.status !== 'sent' && quote.status !== 'contracted'
            ? actionButton('견적서 발송', 'send-quote')
            : '',
          quote.status === 'contracted'
            ? ''
            : actionButton('계약서로 전환', 'to-contract', { tone: 'ghost' }),
          actionButton('초대 문구 복사', 'copy-invite', { tone: 'quiet' }),
        ]
          .filter(Boolean)
          .join('')
      : quote.status === 'sent' || quote.status === 'accepted'
        ? actionButton('이 견적으로 계약 진행', 'start-contract')
        : '';

  renderSheet({ title: `견적서 · ${quote.clientCompany}`, html: quoteSheetHtml(quote, photos), actions });
}

export async function copyInviteText(quote) {
  const message = [
    `[코리아 에코크린] ${quote.clientCompany} 담당자님, 정기청소 견적서가 도착했습니다.`,
    '아래 링크를 누르면 초대코드가 입력된 화면이 열립니다. 견적서와 계약서를 확인하고 바로 전자서명하실 수 있습니다.',
    `링크: ${inviteUrl(quote.inviteCode)}`,
    `1회용 코드: ${quote.inviteCode}`,
    `문의: 0507-1317-8369`,
  ].join('\n');
  const ok = await copyText(message);
  toast(
    ok ? `${quote.clientCompany} 초대 문구를 복사했습니다. 문자·카톡에 붙여넣으세요.` : '복사가 차단되었습니다. 코드를 길게 눌러 복사해 주세요.',
    { tone: ok ? 'default' : 'error', duration: 5000 },
  );
}

/* ------------------------------------------------------------------ */
/* 표준 도급 계약서                                                     */
/* ------------------------------------------------------------------ */

function clauseHtml(clause, agreement) {
  const title = clause.title ? `제${clause.no}조 (${esc(clause.title)})` : `제${clause.no}조`;
  let body = '';

  if (clause.render === 'scope') {
    const scope = (agreement.scope || '').split(/[,·\n]/).map((item) => item.trim()).filter(Boolean);
    body = `
      <p>이 계약을 따르는 청소업무의 내용은 다음과 같다.</p>
      <p class="doc__indent">(1) 정기관리 청소 업무</p>
      <p class="doc__indent2">- 기본 청소</p>
      <p class="doc__indent3">${scope.length ? scope.map((item) => esc(item)).join(', ') : '현장 확인 후 협의'}</p>
      <p class="doc__indent">(2) 정기관리 추가 업무</p>
      <p class="doc__indent2">${esc(agreement.extraScope || '현장 협의에 따라 정한다.')}</p>
      <p>업무의 범위 및 업무처리의 기준은 위 기본청소와 같이 정한다.</p>
      <p>기본청소에서 정하지 아니한 업무에 대해서는 필요에 따라 '갑'과 '을'이 협의하여 결정한다.</p>`;
  } else if (clause.render === 'period') {
    body = `
      <p>본 계약의 계약기간은</p>
      <p class="doc__indent">${esc(fmtDateDot(agreement.startDate) || '20   년    월    일')}로부터</p>
      <p class="doc__indent">${esc(fmtDateDot(agreement.endDate) || '20   년    월    일')}까지 &nbsp; ${esc(String(agreement.months))} 개월로 한다.</p>
      <p>단, 기간만료 1개월 전까지 '갑'과 '을'의 어느 일방으로부터 서면에 의한 의사표시가 없는 경우에는 이 계약은 종료조건으로서 1년간 연장되며 그 이후도 같다.</p>`;
  } else if (clause.render === 'amount') {
    body = `
      <p>본 계약에 따라서 '갑'이 '을'에게 지불하는 계약 금액은 아래와 같이 정한다.</p>
      <p>단, 청소업무 기간이 1개월 미만 일때는 일할 계산한다.</p>
      <p>'을'은 매월 1일부터 매월 말일을 기준으로 한 도급단가에 대한 청구서를 당월 말일 이내 '갑'에게 청구하며 '갑'은 청구서를 수령한 후 아래 결제일에 '을'의 예금계좌에 현금으로 지급한다.</p>
      <table class="doc-table doc-table--amount">
        <tr><th>계 약 금 액</th><td>${esc(amountLine(agreement.amount, agreement.vatIncluded))}</td></tr>
        <tr><th>결 제 일</th><td>매월 ${esc(agreement.billingDay)}일</td></tr>
        <tr><th>결제계좌번호</th><td>${esc(agreement.bankName)} ${esc(agreement.bankAccount)} &nbsp; 예금주 : ${esc(agreement.accountHolder)}</td></tr>
      </table>`;
  } else if (clause.render === 'special') {
    body = agreement.specialTerms
      ? `<p class="preserve">${esc(agreement.specialTerms)}</p>`
      : '<p class="doc__blank-line"> </p>';
  } else {
    body = (clause.paras || []).map((para) => `<p>${esc(para)}</p>`).join('');
  }

  return `<section class="doc__clause"><h3>${title}</h3>${body}</section>`;
}

function partyRows(agreement, editable) {
  const field = (id, label, value, placeholder) =>
    editable
      ? `<tr><th>${label}</th><td><input class="doc-input" id="${id}" type="text" value="${esc(value)}" placeholder="${esc(placeholder || '')}"></td></tr>`
      : `<tr><th>${label}</th><td>${esc(value || '-')}</td></tr>`;
  return `
    <tr><th rowspan="4" class="doc-table__side">갑</th><th>주&nbsp;&nbsp;소</th><td>${editable ? `<input class="doc-input" id="ct-address" type="text" value="${esc(agreement.clientAddress)}" placeholder="사업장 주소">` : esc(agreement.clientAddress || '-')}</td></tr>
    <tr><th>사 업 자 명</th><td>${editable ? `<input class="doc-input" id="ct-business" type="text" value="${esc(agreement.clientBusinessName)}" placeholder="사업자명(상호)">` : esc(agreement.clientBusinessName || '-')}</td></tr>
    <tr><th>사업자등록번호</th><td>${editable ? `<input class="doc-input" id="ct-biz" type="text" value="${esc(agreement.clientBizNumber)}" placeholder="000-00-00000">` : esc(agreement.clientBizNumber || '-')}</td></tr>
    <tr><th>대&nbsp;&nbsp;표&nbsp;&nbsp;자</th><td>${editable ? `<input class="doc-input" id="ct-ceo" type="text" value="${esc(agreement.clientCeo)}" placeholder="대표자 성명">` : esc(agreement.clientCeo || '-')}</td></tr>
    <tr><th rowspan="5" class="doc-table__side">을</th><th>주&nbsp;&nbsp;소</th><td>${esc(agreement.supplierAddress)}</td></tr>
    <tr><th>사 업 자 명</th><td>${esc(agreement.supplierBusinessName)}</td></tr>
    <tr><th>사업자등록번호</th><td>${esc(agreement.supplierBizNumber)}</td></tr>
    <tr><th>대&nbsp;&nbsp;표&nbsp;&nbsp;자</th><td>${esc(agreement.supplierCeo)} ${companySealImg({ className: 'doc__seal-img doc__seal-img--inline' })}</td></tr>
    <tr><th>업&nbsp;&nbsp;태 / 종목</th><td>${esc(agreement.supplierUpjong)} / ${esc(agreement.supplierJongmok)}</td></tr>
  `;
}

function signatureBlock(agreement, role, editable) {
  if (agreement.signature) {
    return `
      <div class="sign-pad sign-pad--done">
        <div class="sign-pad__head"><span>갑(고객) 전자서명</span><span>${esc(agreement.signedByName || '')} · ${esc(fmtDateDot(agreement.signedDate))}</span></div>
        <img class="sign-pad__image" src="${esc(agreement.signature)}" alt="고객 전자서명">
      </div>`;
  }
  if (!editable || role !== 'customer') {
    return `<div class="sign-pad sign-pad--empty"><span>갑(고객) 서명란 — 고객이 서명하면 이 자리에 서명 이미지가 표시됩니다.</span></div>`;
  }
  return signatureFieldTemplate('갑(고객) 전자서명');
}

export function agreementSheetHtml(agreement, { role = 'admin' } = {}) {
  const editable = role === 'customer' && agreement.status !== 'signed';
  const clauses = CONTRACT_CLAUSES.map((clause) => clauseHtml(clause, agreement)).join('');
  return `
    <article class="sheet doc doc--contract" data-doc="agreement">
      <header class="doc__head">
        <h1>${esc(CONTRACT_TITLE)}</h1>
        <p class="doc__sub">${esc(CONTRACT_SUBTITLE)}</p>
      </header>

      <p class="doc__intro">${esc(CONTRACT_INTRO)}</p>

      <ul class="doc__parties-list">
        <li><span>소재지</span><strong>${esc(agreement.clientAddress || '-')}</strong></li>
        <li><span>회사명</span><strong>${esc(agreement.clientBusinessName || '-')}</strong></li>
        <li><span>담당자</span><strong>${esc(agreement.contactName || '-')}</strong></li>
        <li><span>연락처</span><strong>${esc(agreement.contactPhone || '-')}</strong></li>
      </ul>

      ${clauses}

      <section class="doc__clause doc__clause--sign">
        <p class="doc__sign-date">${editable ? `<input class="doc-input doc-input--date" id="ct-signed-date" type="date" value="${esc(agreement.signedDate || new Date().toISOString().slice(0, 10))}">` : esc(fmtDateDot(agreement.signedDate))} 체결</p>
        <table class="doc-table doc-table--party">${partyRows(agreement, editable)}</table>
        ${signatureBlock(agreement, role, editable)}
      </section>

      <footer class="doc__foot">
        <p>${esc(CONTRACT_FOOTER)}</p>
      </footer>
    </article>`;
}

export async function openAgreementSheet(agreementId, options = {}) {
  // v2.8.2 — 고객 계약서는 대표와 그 고객만. 직원 화면에서는 열리지 않습니다.
  const viewer = await getSession().catch(() => null);
  if (viewer && viewer.role === 'leader') {
    toast('고객 계약서는 대표(최고관리자)만 볼 수 있습니다.', { tone: 'error' });
    return;
  }
  const role = options.role || 'admin';
  const reload = options.onChanged || (() => {});
  let agreement = await store.getAgreement(agreementId);
  if (!agreement) {
    toast('계약서를 찾을 수 없습니다.', { tone: 'error' });
    return;
  }

  active = {
    async onAction(action) {
      if (action === 'clear-sign') {
        const pad = $('[data-signature-pad]', modal);
        if (pad && pad.pad) pad.pad.clear();
        return;
      }
      if (action === 'send-agreement') {
        agreement = await store.sendAgreement(agreement.id, { actor: viewer });
        toast('계약서를 고객에게 보냈습니다. 고객 방에서 서명할 수 있습니다.');
        await reload();
        draw();
        return;
      }
      if (action === 'sign-agreement') {
        const pad = $('[data-signature-pad]', modal);
        if (!pad || !pad.pad) return;
        if (pad.pad.isEmpty()) {
          toast('서명란에 서명해 주세요.', { tone: 'error' });
          return;
        }
        const address = $('#ct-address', modal)?.value || '';
        const businessName = $('#ct-business', modal)?.value.trim() || '';
        const bizNumber = $('#ct-biz', modal)?.value || '';
        const ceo = $('#ct-ceo', modal)?.value || '';
        const signedDate = $('#ct-signed-date', modal)?.value || '';
        if (!businessName) {
          toast('사업자명(상호)을 확인해 주세요.', { tone: 'error' });
          return;
        }
        const ok = await confirmDialog({
          title: '계약을 체결할까요?',
          message: '서명한 계약서는 수정할 수 없습니다. 체결과 동시에 정기청소 현장이 등록됩니다.',
          confirmLabel: '계약 체결',
        });
        if (!ok) return;
        try {
          const result = await store.signAgreement(agreement.id, {
            signature: pad.pad.toDataURL(),
            address,
            businessName,
            bizNumber,
            ceo,
            signedDate,
          });
          toast(`${result.site.name} 정기청소 현장이 등록되었습니다.`);
          await reload();
          closeSheet();
        } catch (error) {
          toast(error.message || '계약을 체결하지 못했습니다.', { tone: 'error' });
        }
      }
    },
  };

  function draw() {
    const actions =
      role === 'admin'
        ? [
            agreement.status === 'draft' ? actionButton('고객에게 계약서 발송', 'send-agreement') : '',
            agreement.status === 'sent'
              ? `<p class="sheet-actions__note">고객 확인 · 서명을 기다리는 중입니다.</p>`
              : '',
          ]
            .filter(Boolean)
            .join('')
        : agreement.status === 'signed'
          ? `<p class="sheet-actions__note">체결 완료된 계약서입니다. 인쇄하거나 PDF로 저장할 수 있습니다.</p>`
          : actionButton('계약 체결 완료', 'sign-agreement');

    renderSheet({
      title: `도급 계약서 · ${agreement.clientBusinessName || '고객사'}`,
      html: agreementSheetHtml(agreement, { role }),
      actions,
      afterMount: (box) => {
        const holder = $('[data-signature-pad]', box);
        if (holder) createSignatureField(holder);
      },
    });
  }

  draw();
}

/* ------------------------------------------------------------------ */
/* 직원 계약서 (프리랜서 · 도급 · 일용직)                               */
/* ------------------------------------------------------------------ */

function staffTerms(contract, siteNames) {
  const type = contract.employmentType;
  const sites = siteNames.length ? siteNames.join(', ') : '배정 현장 없음';
  const period = `${fmtDateDot(contract.startDate)} ~ ${fmtDateDot(contract.endDate)}`;
  const amountText =
    type === 'daily'
      ? `일금 ${fmtKoreanAmount(contract.dailyAmount)}원정 (₩${fmtNumber(contract.dailyAmount)})`
      : type === 'parttime'
        ? `시간급 일금 ${fmtKoreanAmount(contract.hourlyAmount)}원정 (₩${fmtNumber(contract.hourlyAmount)})`
        : `일금 ${fmtKoreanAmount(contract.monthlyAmount)}원정 (₩${fmtNumber(contract.monthlyAmount)})`;

  const common = (no, title, paras) => ({ no, title, paras });

  if (type === 'freelancer') {
    const net = Math.round(contract.monthlyAmount * (1 - contract.feeRate / 100));
    return [
      common(1, '목적', ["본 계약은 '갑'(코리아 에코크린)이 '을'(프리랜서)에게 정기청소 업무를 위탁하고, '을'이 이를 수탁함에 있어 필요한 사항을 정함을 목적으로 한다."]),
      common(2, '업무의 범위', [`'을'은 다음 현장의 정기청소 업무를 수행한다: ${sites}`, `업무 내용: ${contract.scope || '현장 정기청소 일체'}`, `작업 순서: ${contract.process || '현장 안내에 따른다.'}`, "'을'은 위 범위를 벗어난 업무에 대해서는 '갑'과 별도로 협의한다."]),
      common(3, '계약기간', [`${period} (${contract.workDays || '일정 협의'})`, "계약 만료 1개월 전까지 서면 의사표시가 없으면 동일 조건으로 갱신한다."]),
      common(4, '수당 및 정산', [
        `월 정산금액은 ${amountText}으로 한다.`,
        `'갑'은 매월 ${contract.settlementDay}일에 '을'이 지정한 계좌(${contract.bankName} ${contract.bankAccount}, 예금주 ${contract.accountHolder})로 입금한다.`,
        `'을'은 프리랜서로서 사업소득세 ${contract.feeRate}%를 원천징수하며, 실수령액은 ₩${fmtNumber(net)}이다.`,
      ]),
      common(5, '지위', ["'을'은 근로기준법상 근로자가 아닌 프리랜서로서, 업무 시간과 방법은 현장 일정에 맞추어 '을'이 정한다. '갑'은 '을'에게 4대보험을 적용하지 않는다."]),
      common(6, '비밀유지', ["'을'은 업무 중 알게 된 고객사 정보, 현장 출입 정보, 계약 조건을 제3자에게 누설하여서는 안 된다."]),
      common(7, '손해배상', ["'을'의 고의 또는 중대한 과실로 '갑' 또는 고객사에 손해가 발생한 경우 '을'은 그 손해를 배상한다."]),
      common(8, '해지', ["어느 일방이 계약을 해지하려면 1개월 전 서면으로 통지한다. 중대한 계약 위반이 있는 경우에는 즉시 해지할 수 있다."]),
      common(9, '기타', ['본 계약에 정하지 않은 사항은 관계 법령과 상호 협의에 따른다.']),
    ];
  }

  if (type === 'daily') {
    return [
      common(1, '목적', ["'갑'(코리아 에코크린)과 '을'(일용근로자)은 아래와 같이 근로계약을 체결한다."]),
      common(2, '근무 장소 및 업무', [`근무 장소: ${sites}`, `업무 내용: ${contract.scope || '청소 업무'}`, `작업 순서: ${contract.process || '현장 안내에 따른다.'}`]),
      common(3, '근무일 및 근무시간', [`근무일: ${contract.workDays || fmtDateDot(contract.startDate)}`, `근무시간: ${contract.workHours || '현장 협의'}`]),
      common(4, '임금', [
        `일당은 ${amountText}으로 한다.`,
        `'갑'은 작업 완료 후 ${contract.settlementDay}에 '을'의 계좌(${contract.bankName} ${contract.bankAccount}, 예금주 ${contract.accountHolder})로 입금한다.`,
        '세금 및 4대보험은 관계 법령에 따라 처리한다.',
      ]),
      common(5, '안전수칙', [`'을'은 다음 안전수칙을 준수한다: ${contract.safety || '작업 전 안전 안내에 따른다.'}`, "'갑'은 작업에 필요한 안전 장비와 약품 사용법을 안내한다."]),
      common(6, '비밀유지', ["'을'은 업무 중 알게 된 고객사 정보와 현장 정보를 제3자에게 누설하여서는 안 된다."]),
      common(7, '계약 해지', ["근무 중 중대한 위반 또는 안전사고 위험이 있는 경우 '갑'은 즉시 계약을 해지할 수 있다."]),
      common(8, '기타', ['본 계약에 정하지 않은 사항은 근로기준법 등 관계 법령에 따른다.']),
    ];
  }

  if (type === 'parttime') {
    return [
      common(1, '목적', ["'갑'(코리아 에코크린)과 '을'(아르바이트 근로자)은 아래와 같이 근로계약을 체결한다."]),
      common(2, '근무 장소 및 업무', [`근무 장소: ${sites}`, `업무 내용: ${contract.scope || '청소 업무 보조'}`, `작업 순서: ${contract.process || '현장 안내에 따른다.'}`]),
      common(3, '근무일 및 근무시간', [`근무일: ${contract.workDays || '현장 협의'}`, `근무시간: ${contract.workHours || '현장 협의'}`]),
      common(4, '임금', [
        `시간급은 ${amountText}으로 한다.`,
        `'갑'은 매월 ${contract.settlementDay}일에 '을'의 계좌(${contract.bankName} ${contract.bankAccount}, 예금주 ${contract.accountHolder})로 입금한다.`,
        '주휴수당은 근로기준법이 정한 요건을 충족하는 경우 지급한다.',
      ]),
      common(5, '안전수칙', [`'을'은 다음 안전수칙을 준수한다: ${contract.safety || '작업 전 안전 안내에 따른다.'}`]),
      common(6, '비밀유지', ["'을'은 업무 중 알게 된 고객사 정보와 현장 정보를 제3자에게 누설하여서는 안 된다."]),
      common(7, '계약 해지', ["근무 중 중대한 위반 또는 안전사고 위험이 있는 경우 '갑'은 즉시 계약을 해지할 수 있다."]),
      common(8, '기타', ['본 계약에 정하지 않은 사항은 근로기준법 등 관계 법령에 따른다.']),
    ];
  }

  return [
    common(1, '목적', ["본 계약은 '갑'(코리아 에코크린)이 '을'(수급자)에게 정기청소 업무를 도급하고, '을'이 이를 완성하여 '갑'에게 인도함에 있어 필요한 사항을 정함을 목적으로 한다."]),
    common(2, '도급 업무', [`담당 현장: ${sites}`, `업무 범위: ${contract.scope || '현장 정기청소 일체'}`, `청소 공정: ${contract.process || '현장 안내에 따른다.'}`, `근무 일정: ${contract.workDays || '현장 협의'}`]),
    common(3, '계약기간', [`${period}`, "계약 만료 1개월 전까지 서면 의사표시가 없으면 동일 조건으로 갱신한다."]),
    common(4, '도급금액 및 지급', [
      `월 도급금액은 ${amountText}으로 한다. (부가세 별도)`,
      `'갑'은 매월 ${contract.settlementDay}일에 '을'의 계좌(${contract.bankName} ${contract.bankAccount}, 예금주 ${contract.accountHolder})로 입금한다.`,
    ]),
    common(5, '자재 및 장비', ["청소에 필요한 기구와 자재는 원칙적으로 '을'이 부담한다. 다만 '갑'이 제공하는 약품·소모품은 별도로 정한다."]),
    common(6, '안전 및 위생', [`'을'은 다음 안전수칙을 준수한다: ${contract.safety || '작업 전 안전 안내에 따른다.'}`, "'을'은 소속 작업자의 안전 교육과 위생 관리를 책임진다."]),
    common(7, '규율 및 복장', ["'을'과 소속 작업자는 제복과 명찰을 착용하고, 고객사 규율을 준수한다."]),
    common(8, '비밀유지', ["'을'은 업무 중 알게 된 고객사 정보, 출입 정보, 계약 조건을 제3자에게 누설하여서는 안 된다."]),
    common(9, '손해배상', ["'을'의 귀책 사유로 '갑' 또는 고객사에 손해가 발생한 경우 '을'이 배상한다. 배상 범위는 상호 협의한다."]),
    common(10, '해지', ["1개월 전 서면 통지로 해지할 수 있다. 중대한 계약 위반 시 즉시 해지할 수 있다."]),
    common(11, '기타', ['본 계약에 정하지 않은 사항은 상호 협의하여 정한다.']),
  ];
}

export function staffSheetHtml(contract, siteNames = []) {
  const meta = STAFF_TYPES[contract.employmentType] || STAFF_TYPES.freelancer;
  const signed = contract.status === 'signed';
  const total =
    contract.employmentType === 'daily'
      ? contract.dailyAmount
      : contract.employmentType === 'parttime'
        ? contract.hourlyAmount
        : contract.monthlyAmount;
  return `
    <article class="sheet doc doc--contract" data-doc="staff">
      <header class="doc__head">
        <h1>${esc(meta.label)}</h1>
        <p class="doc__sub">${esc(contract.no || '')}</p>
      </header>

      <table class="doc-table doc-table--kv">
        <tr><th>계약번호</th><td>${esc(contract.no || '-')}</td><th>체결일</th><td>${esc(fmtDateDot(contract.signedDate) || '미체결')}</td></tr>
      </table>

      <div class="doc__parties">
        <section>
          <h2>사업주 (갑)</h2>
          <dl>
            <dt>상호</dt><dd>${esc(SUPPLIER.nameKo)}</dd>
            <dt>대표</dt><dd>${esc(SUPPLIER.ceo)}</dd>
            <dt>사업자등록번호</dt><dd>${esc(SUPPLIER.bizNumber)}</dd>
            <dt>주소</dt><dd>${esc(SUPPLIER.address)}</dd>
            <dt>연락처</dt><dd>${esc(SUPPLIER.phone)}</dd>
          </dl>
        </section>
        <section>
          <h2>직원 (을)</h2>
          <dl>
            <dt>성명</dt><dd><strong>${esc(contract.name)}</strong></dd>
            <dt>직함</dt><dd>${esc(contract.roleTitle || '-')}</dd>
            <dt>연락처</dt><dd>${esc(contract.phone)}</dd>
            <dt>생년월일</dt><dd>${esc(contract.birthDate || '-')}</dd>
            <dt>${contract.employmentType === 'daily' ? '주민번호' : '사업자등록번호'}</dt><dd>${esc(contract.bizNumber || contract.residentId || '-')}</dd>
            <dt>계좌</dt><dd>${esc(contract.bankName)} ${esc(contract.bankAccount || '-')} (${esc(contract.accountHolder)})</dd>
          </dl>
        </section>
      </div>

      <div class="doc__amount doc__amount--compact">
        <p>${esc(meta.amountLabel)}</p>
        <strong>${esc(fmtWon(total))}</strong>
        <em>${contract.employmentType === 'freelancer' ? '3.3% 원천징수' : contract.employmentType === 'daily' ? '일당' : contract.employmentType === 'parttime' ? '주휴수당 별도' : '부가세 별도'}</em>
      </div>

      ${staffTerms(contract, siteNames)
        .map(
          (clause) =>
            `<section class="doc__clause"><h3>제${clause.no}조 (${esc(clause.title)})</h3>${clause.paras
              .map((para) => `<p class="preserve">${esc(para)}</p>`)
              .join('')}</section>`,
        )
        .join('')}

      <section class="doc__clause doc__clause--sign">
        <p class="doc__sign-date">${esc(fmtDateDot(contract.signedDate) || fmtDateDot(contract.startDate))}</p>
        <div class="doc__sign-pair">
          <div><span>사업주 (갑)</span><strong>코리아 에코크린 대표 ${esc(SUPPLIER.ceo)}</strong>${companySealImg({ className: 'doc__seal-img' })}</div>
          <div><span>직원 (을)</span><strong>${esc(contract.name)}</strong>${signed ? '<span class="doc__signed">서명 완료</span>' : ''}</div>
        </div>
        ${
          contract.signature
            ? `<div class="sign-pad sign-pad--done"><div class="sign-pad__head"><span>을 전자서명</span><span>${esc(fmtDateDot(contract.signedDate))}</span></div><img class="sign-pad__image" src="${esc(contract.signature)}" alt="직원 전자서명"></div>`
            : ''
        }
      </section>

      <footer class="doc__foot"><p>${esc(CONTRACT_FOOTER)}</p></footer>
    </article>`;
}

/* ------------------------------------------------------------------ */
/* 정기청소 도급계약서 (도급 유형 전용 · 실제 양식)                       */
/* ------------------------------------------------------------------ */

const SUBCONTRACT_ISSUER = {
  company: '코리아 에코크린',
  ceo: '채종병',
  bizNumber: '281-46-00169',
  address: '서울시 양천구 남부순환로36길 30, 1층 B01호 상가(신월동)',
  phone: '010-9900-8369',
};

function vatOf(amount) {
  return Math.round((Number(amount) || 0) * 0.1);
}

/** 제1조 ~ 제11조 — 도급인 양식 PDF 원문 그대로. */
function subcontractClauses(contract) {
  const start = fmtDateDot(contract.startDate) || '____.__.__.';
  const end = fmtDateDot(contract.endDate) || '____.__.__.';
  const day = String(contract.settlementDay || '15').replace(/[^0-9]/g, '') || '15';
  const amount = Number(contract.monthlyAmount) || 0;
  const vat = vatOf(amount);
  const amountLine = amount
    ? `최초 금 [일금 ${fmtKoreanAmount(amount)}원정] (₩${fmtNumber(amount)} / 부가세 별도 · 세액 ₩${fmtNumber(vat)})`
    : '최초 금 [____________] (₩____________ / 부가세 [별도])';
  const accountLine =
    contract.bankAccount || contract.accountHolder
      ? `* 계좌번호: [${contract.bankName || '은행명'} ${contract.bankAccount || '계좌번호'} / 예금주 ${contract.accountHolder || '예금주'}]`
      : '* 계좌번호: [은행명 계좌번호 / 예금주]';
  return [
    {
      no: 1,
      title: '목적',
      paras: [
        '본 계약은 "갑"이 지정한 대상물의 청소 업무를 "을"에게 위탁하고, "을"은 이를 자신의 책임하에 완성하여 "갑"에게 쾌적하고 위생적인 환경을 제공하는 것을 목적으로 한다.',
      ],
    },
    {
      no: 2,
      title: '청소 대상물 및 범위 : 별첨',
      paras: [
        '1. 대상물 소재지: 별첨',
        '2. 대상 범위: [예: 사무실 내부, 화장실, 탕비실, 복도 등 구체적으로 기재] 별첨',
        '3. 청소 주기 및 작업시간: [예: 주 3회(월, 수, 금)] 별첨',
        '4. 도급대상의 도급 금액: (별첨)',
      ],
    },
    {
      no: 3,
      title: '계약 기간',
      paras: [
        `1. 본 계약의 기간은 ${start}부터 ${end}까지로 한다.`,
        '2. 계약 만료 1개월 전까지 쌍방의 서면 거부가 없을 경우, 본 계약은 동일한 조건으로 1년간 자동 연장되는 것으로 본다.',
      ],
    },
    {
      no: 4,
      title: '도급 대금 및 지급 방법',
      paras: [
        `1. 월 도급 금액은 ${amountLine}으로 하며 도급대상 도급 금액 변동시 제2조 별첨본을 최우선으로 한다.`,
        `2. "을"은 매월 말일까지의 해당 월의 용역에 대한 현금영수증 또는 세금계산서를 발행하고, "갑"은 익월 [${day}]일까지 "을"이 지정한 금융 계좌로 대금을 현금 지급한다.`,
        accountLine,
      ],
    },
    {
      no: 5,
      title: '업무의 수행 및 지휘감독',
      paras: [
        '1. "을"은 독립된 자격으로서 자신의 책임과 지휘하에 인력을 배치하여 청소 업무를 완성해야 한다.',
        '2. "갑"은 "을"의 근로자에게 직접적인 업무 지시나 근무 시간 관리를 할 수 없으며, 요구사항이 있을 경우 "을"의 관리자 또는 대표자를 통하여 협의하여야 한다.',
        '3. "갑"과 "을"은 상호 원활한 소통을 위한 협의된 사안에 대해서는 신의 성실하게 협력한다.',
      ],
    },
    {
      no: 6,
      title: '장비 및 자재',
      paras: [
        '청소 업무 수행에 필요한 장비 및 세제 등의 소모품은 소요 비용이 큰 특수 장비를 제외하고는 원칙적으로 ["을"]의 부담으로 준비한다.',
      ],
    },
    {
      no: 7,
      title: '비밀유지 및 손해배상',
      paras: [
        '1. "을"과 "을"의 근로자는 업무 중 알게 된 "갑"의 업무상 비밀을 제3자에게 누설해서는 안 된다.',
        '2. "을"의 근로자가 청소 업무 중 과실로 인하여 "갑"의 시설물을 파손하거나 손해를 입힌 경우, "을"은 이를 원상복구 하거나 배상하여야 한다.',
      ],
    },
    {
      no: 8,
      title: '계약의 해지 및 무단 중단 금지',
      paras: [
        '1. "갑" 또는 "을"이 본 계약을 해지하고자 할 때는 최소 1개월 전에 상대방에게 서면으로 통보하여야 한다.',
        '2. "을"은 "갑"의 사전 서면 동의 없이 일방적으로 청소 업무를 중단하거나 계약을 파기할 수 없다.',
        '3. "을"이 전항을 위반하여 일방적으로 업무를 중단하는 경우, "갑"은 최고(독촉) 없이 즉시 계약을 해지할 수 있다.',
      ],
    },
    {
      no: 9,
      title: '을의 무단 이행거부에 따른 위약벌 및 상계 처리',
      paras: [
        '1. "을"이 제8조 제2항을 위반하여 일방적으로 업무를 수행하지 않거나 계약을 파기한 경우, "을"은 "갑"에게 위약벌로 [당해 월 도급대금의 2배]에 해당하는 금액을 즉시 지급하여야 한다.',
        '2. "을"의 일방적인 업무 중단으로 인해 "갑"이 임시 대체 인력을 고용하거나 타 업체와 긴급 계약을 체결하면서 발생한 추가 비용(대체 비용 일체)은 전액 "을"이 부담한다.',
        '3. "갑"은 "을"에게 지급해야 할 미지급 도급 대금이 있는 경우, 본 조에 따른 위약벌 및 손해배상액을 우선적으로 공제(상계)한 후 남은 금액만 지급할 수 있다. 만약 공제 후에도 부족한 금액이 있을 경우 "갑"은 "을"에게 추가로 청구할 수 있다.',
      ],
    },
    {
      no: 10,
      title: '기타 사항',
      paras: [
        '본 계약서에 명시되지 않은 사항은 관계 법령 및 일반적인 상관례에 따르며, 쌍방이 합의하여 별도의 특약 사항을 서면으로 작성할 수 있도록 한다. 본 계약의 성립을 증명하기 위하여 계약서 2부를 작성하고, "갑"과 "을"이 상호 서명 또는 날인한 후 각 1부씩 보관한다.',
      ],
    },
    {
      no: 11,
      title: '소송관할',
      paras: [
        '본 계약내용의 해석에 관한 이견이 발생한 경우에는 관계법령 및 관행에 따라 "갑"과 "을"이 협의하여 정하며 분쟁발생시의 소송 관할은 "갑"의 본사 소재지 관할법원으로 한다.',
      ],
    },
  ];
}

function subcontractField(id, label, value, editable, { placeholder = '', type = 'text' } = {}) {
  if (!editable) return `<dd><strong>${esc(value || '미정')}</strong></dd>`;
  return `<dd><input class="doc-input" id="${id}" type="${type}" value="${esc(value || '')}" placeholder="${esc(placeholder)}"></dd>`;
}

function subcontractPartiesHtml(contract, editable) {
  return `
    <div class="sub-parties">
      <section class="sub-party">
        <h2>도급인 (이하 "갑"이라 한다)</h2>
        <dl>
          <dt>성명(법인명)</dt><dd><strong>${esc(SUBCONTRACT_ISSUER.company)}</strong></dd>
          <dt>대표자</dt><dd><strong>${esc(SUBCONTRACT_ISSUER.ceo)}</strong></dd>
          <dt>사업자등록번호</dt><dd><strong>${esc(SUBCONTRACT_ISSUER.bizNumber)}</strong></dd>
          <dt>주소</dt><dd><strong>${esc(SUBCONTRACT_ISSUER.address)}</strong></dd>
          <dt>연락처</dt><dd><strong>${esc(SUBCONTRACT_ISSUER.phone)}</strong></dd>
        </dl>
      </section>

      <section class="sub-party sub-party--me">
        <h2>수급인 (이하 "을"이라 한다)</h2>
        <dl>
          <dt>회사명(상호)</dt>${subcontractField('sub-company', '회사명(상호)', contract.companyName || contract.name, editable, { placeholder: '예: 블링블링크린 / ○○청소 (법인)' })}
          <dt>대표자</dt>${subcontractField('sub-name', '대표자', contract.name, editable, { placeholder: '성명' })}
          <dt>사업자등록번호<br>/ 주민등록번호</dt>${subcontractField('sub-biz', '사업자등록번호(주민번호)', contract.bizNumber || contract.residentId, editable, { placeholder: '000-00-00000 (없으면 비워 두세요)' })}
          <dt>주소</dt>${subcontractField('sub-address', '주소', contract.address, editable, { placeholder: '사업장 또는 거주지 주소' })}
          <dt>연락처</dt>${subcontractField('sub-phone', '연락처', contract.phone, editable, { placeholder: '010-0000-0000' })}
          <dt>입금 계좌</dt>${subcontractField('sub-account', '입금 계좌', `${contract.bankName || ''} ${contract.bankAccount || ''}`.trim() ? `${contract.bankName || ''} ${contract.bankAccount || ''} (${contract.accountHolder || ''})`.trim() : '', editable, { placeholder: '은행명 계좌번호 / 예금주' })}
        </dl>
      </section>
    </div>`;
}

/** 별첨본 표의 행 — 배정된 현장에서 만들고, 모자라면 빈 행을 넣습니다. */
function annexRows(contract, sites, blank) {
  const rows = (sites || []).slice(0, 8).map((site) => ({
    name: site.name || '',
    address: site.address || '',
    cycle: site.frequency || '',
    // 현장마다 작업시간이 다르면 현장에 적어 둔 값을 씁니다(site.annexHours).
    hours: site.annexHours || contract.workHours || '협의',
    scope: site.annexScope || contract.scope || (CATEGORY_META[site.category] || {}).label || '정기청소 일체',
    // 현장 계약 정보의 도급금액이 있으면 그 금액을 그대로 씁니다.
    supply: Number((site.contract || {}).subcontractAmount) || 0,
  }));
  const total = Number(contract.monthlyAmount) || 0;
  const fixed = rows.filter((row) => row.supply > 0);
  const rest = rows.filter((row) => !row.supply);
  if (fixed.length && rest.length) {
    // 도급액이 적힌 현장은 그대로 두고, 남은 금액을 나머지 현장에 나눕니다.
    const remainder = Math.max(0, total - fixed.reduce((sum, row) => sum + row.supply, 0));
    const base = Math.floor(remainder / rest.length / 1000) * 1000;
    rest.forEach((row, index) => {
      row.supply = base;
      if (index === rest.length - 1) row.supply += remainder - base * rest.length;
    });
  } else if (!fixed.length && total && rows.length && contract.status !== 'signed') {
    // 현장별 도급액이 없으면 월 도급액을 현장 수로 나눕니다(기존 방식).
    // 체결된 계약서는 서명 당시 금액을 지키기 위해 나누지 않습니다(새 업장은 금액 공란).
    const base = Math.floor(total / rows.length / 1000) * 1000;
    rows.forEach((row, index) => {
      row.supply = base;
      if (index === rows.length - 1) row.supply += total - base * rows.length;
    });
  }
  rows.forEach((row) => {
    if (!row.supply) return;
    row.vat = vatOf(row.supply);
    row.sum = row.supply + row.vat;
  });
  const want = blank ? 6 : Math.max(3, rows.length);
  while (rows.length < want) rows.push({ name: '', address: '', cycle: '', hours: '', scope: '' });
  return rows;
}

/**
 * 별첨본 확인 질문의 선택 칸 — 누르면 체크(☑)가 되고 계약서 데이터에 저장됩니다.
 * 체결 전에는 대표·을 모두 누를 수 있고, 체결된 계약서는 저장된 표시만 보여 줍니다.
 */
function annexAckBox(contract, value, label) {
  const ack = contract.annexAck || (contract.signature ? 'yes' : '');
  const on = ack === value;
  const text = `${on ? '☑' : '□'} ${label}`;
  if (!contract.id || contract.signature) {
    return `<span class="annex-ask__box${on ? ' is-checked' : ''}">${esc(text)}</span>`;
  }
  return `<button class="annex-ask__box${on ? ' is-checked' : ''}" type="button" data-doc-action="annex-ack-${value}" data-annex-ack="${value}" data-annex-label="${esc(label)}" aria-pressed="${on}">${esc(text)}</button>`;
}

function subcontractAnnexHtml(contract, sites, { blank = false } = {}) {
  const rows = annexRows(contract, sites, blank);
  const totalSupply = rows.reduce((sum, row) => sum + (row.supply || 0), 0);
  const totalVat = rows.reduce((sum, row) => sum + (row.vat || 0), 0);
  const totalSum = totalSupply + totalVat;
  return `
    <article class="sheet doc doc--contract doc--sub-annex" data-doc="subcontract-annex">
      <header class="doc__head">
        <h1>정기청소 도급 계약서 (별첨본)</h1>
        <p class="doc__sub">${esc(contract.no || '')}${contract.name ? ` · ${esc(contract.name)}` : ''}</p>
      </header>

      <p class="doc__h2">1. 청소 대상 및 범위</p>
      <table class="annex-table">
        <thead>
          <tr>
            <th rowspan="2">대상물명</th>
            <th rowspan="2">소재지</th>
            <th rowspan="2">주기</th>
            <th rowspan="2">시간</th>
            <th rowspan="2">청소 범위</th>
            <th colspan="3">도급액 (VAT 별도)</th>
          </tr>
          <tr>
            <th class="annex-table__num">공급가</th>
            <th class="annex-table__num">세액</th>
            <th class="annex-table__num">합계</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
            <tr>
              <td>${esc(row.name || '')}</td>
              <td>${esc(row.address || '')}</td>
              <td>${esc(row.cycle || '')}</td>
              <td>${esc(row.hours || '')}</td>
              <td>${esc(row.scope || '')}</td>
              <td class="annex-table__num">${row.supply ? fmtNumber(row.supply) : ''}</td>
              <td class="annex-table__num">${row.vat ? fmtNumber(row.vat) : ''}</td>
              <td class="annex-table__num">${row.sum ? fmtNumber(row.sum) : ''}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="5" class="annex-table__total-label">총괄금액</td>
            <td class="annex-table__num">${totalSupply ? fmtNumber(totalSupply) : ''}</td>
            <td class="annex-table__num">${totalVat ? fmtNumber(totalVat) : ''}</td>
            <td class="annex-table__num">${totalSum ? fmtNumber(totalSum) : ''}</td>
          </tr>
        </tfoot>
      </table>

      <div class="annex-notes">
        <p>위 정기청소 도급계약서 별첨본은 정기청소 도급계약서 제2조와 제4조의 세부 내역이며 갑과 을이 상호 협의시 변경 될 수 있으며</p>
        <p>청소 지점일 외에 작업 수행을 못하거나 추가 작업,그래처 변동이 있을 경우 별도 협의를 통해 도급 대금 정산이 적용하도록 하며</p>
        <p>중도 투입 작업 또는 종료시, 법정휴무나 그래처 사정으로 인한 미작업시 도급액÷월 평균 작업일×총 작업일로 정산하여 지급한다.</p>
        <p>대상물의 주기,종료시에는 쌍방 협의 하여 별첨본 수정하여 작성 날인한다.</p>
      </div>

      <p class="annex-ask">
        "을"은 정기청소 수행업무에 대한 모든 내용을 확인하였습니까?
        ${annexAckBox(contract, 'no', '아니오 (서명)')}
        ${annexAckBox(contract, 'yes', '네 (서명)')}
      </p>

      <div class="annex-sign">
        <p class="annex-sign__date">${esc(contract.signedDate || contract.startDate ? `${contract.signedDate || contract.startDate}`.slice(0, 4) : '')}년 ${esc((contract.signedDate || contract.startDate || '').slice(5, 7) || '')}월 ${esc((contract.signedDate || contract.startDate || '').slice(8, 10) || '')}일</p>
        <div class="annex-sign__pair">
          <div class="annex-sign__party">
            <span>갑 (도급인)</span>
            <p>성명: ${esc(SUBCONTRACT_ISSUER.company)}</p>
            <p>서명: ${companySealImg({ className: 'doc__seal-img annex-sign__seal' })}</p>
          </div>
          <div class="annex-sign__party">
            <span>을 (수급인)</span>
            <p>성명: ${esc(contract.name || '')}</p>
            <p>서명: ${contract.signature ? '서명 완료' : ''}</p>
          </div>
        </div>
        ${contract.signature ? `<img class="sign-pad__image annex-sign__image" src="${esc(contract.signature)}" alt="을 전자서명">` : ''}
      </div>
    </article>`;
}

export function subcontractSheetHtml(contract, { sites = [], editable = false, blank = false } = {}) {
  const clauses = subcontractClauses(contract)
    .map(
      (clause) =>
        `<section class="doc__clause"><h3>제${clause.no}조 (${esc(clause.title)})</h3>${clause.paras
          .map((para) => `<p class="preserve">${esc(para)}</p>`)
          .join('')}</section>`,
    )
    .join('');
  const signedDate = contract.signedDate || contract.startDate || '';
  return `
    <article class="sheet doc doc--contract doc--subcontract" data-doc="subcontract">
      <header class="doc__head">
        <h1>정기청소 도급계약서</h1>
        <p class="doc__sub">${esc(contract.no || (blank ? '을 미정 (공란)' : ''))}${contract.status === 'signed' ? ' · 체결 완료' : ''}</p>
      </header>

      ${subcontractPartiesHtml(contract, editable)}

      <p class="sub-intro">"갑"과 "을"은 아래 건물(또는 시설)의 정기청소 업무에 관하여 다음과 같이 도급계약을 체결한다.</p>

      ${clauses}

      <section class="doc__clause doc__clause--sign">
        <p class="doc__sign-date">${signedDate ? `${esc(signedDate.slice(0, 4))}년 ${esc(signedDate.slice(5, 7))}월 ${esc(signedDate.slice(8, 10))}일` : '____년 ____월 ____일'}</p>
        <div class="sub-sign">
          <div class="sub-sign__party">
            <strong>갑 (도급인)</strong>
            <span>회사명: ${esc(SUBCONTRACT_ISSUER.company)}</span>
            <span>대표자: ${esc(SUBCONTRACT_ISSUER.ceo)} ${companySealImg({ className: 'doc__seal-img doc__seal-img--inline' })}</span>
            <span>사업자등록번호: ${esc(SUBCONTRACT_ISSUER.bizNumber)}</span>
          </div>
          <div class="sub-sign__party">
            <strong>을 (수급인)</strong>
            <span>회사명: ${esc(contract.companyName || contract.name || '')}</span>
            <span>대표자: ${esc(contract.name || '')} ${contract.signature ? '<span class="doc__signed">서명 완료</span>' : '<span class="doc__seal-slot">(인)</span>'}</span>
            <span>사업자등록번호: ${esc(contract.bizNumber || contract.residentId || '')}</span>
          </div>
        </div>
        ${contract.signature ? `<div class="sign-pad sign-pad--done"><div class="sign-pad__head"><span>을 전자서명</span><span>${esc(fmtDateDot(contract.signedDate))}</span></div><img class="sign-pad__image" src="${esc(contract.signature)}" alt="직원 전자서명"></div>` : ''}
      </section>
    </article>
    ${subcontractAnnexHtml(contract, sites, { blank })}`;
}

/** 대표: 을 미정(공란) 도급계약서 — 바로 인쇄/PDF 저장. */
export function openBlankSubcontractSheet() {
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  const end = new Date(today);
  end.setFullYear(end.getFullYear() + 1);
  end.setDate(end.getDate() - 1);
  const contract = {
    id: '',
    no: '',
    name: '',
    companyName: '',
    phone: '',
    address: '',
    bizNumber: '',
    bankName: '',
    bankAccount: '',
    accountHolder: '',
    employmentType: 'contract',
    status: 'draft',
    startDate: iso,
    endDate: end.toISOString().slice(0, 10),
    monthlyAmount: 0,
    settlementDay: '15',
    siteIds: [],
    signature: '',
  };
  openDocumentSheet({
    title: '을 미정 도급계약서 (공란)',
    html: subcontractSheetHtml(contract, { sites: [], blank: true }),
    actions: `
      <p class="sheet-actions__note">을(수급인) 칸을 비워 둔 공란 계약서입니다. 인쇄해 수기로 작성하거나 PDF로 저장해 보내세요.</p>
      <button class="btn btn--primary" type="button" data-sheet="print">인쇄 / PDF 저장</button>
      <button class="btn btn--quiet" type="button" data-sheet="close">닫기</button>`,
  });
}

/** 별첨본 확인 칸을 시트를 다시 그리지 않고 그 자리에서 체크 표시만 바꿉니다(읽던 위치 유지). */
function paintAnnexAck(value) {
  const box = modal ? modal.querySelector('[data-sheet-body]') : null;
  if (!box) return;
  box.querySelectorAll('[data-annex-ack]').forEach((btn) => {
    const on = btn.dataset.annexAck === value;
    btn.classList.toggle('is-checked', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.textContent = `${on ? '☑' : '□'} ${btn.dataset.annexLabel || ''}`.trim();
  });
}

export async function openStaffContractSheet(staffId, options = {}) {
  const role = options.role || 'admin';
  const reload = options.onChanged || (() => {});
  const viewer = await getSession().catch(() => null);
  let contract = null;
  try {
    // 직원은 본인 계약서만 — 다른 직원의 계약서(급여·주민번호)는 열리지 않습니다.
    contract = await store.getStaffContract(staffId, { actor: viewer && viewer.role === 'leader' ? viewer : null });
  } catch (error) {
    toast(error && error.message ? error.message : '내 계약서만 열 수 있습니다.', { tone: 'error' });
    return;
  }
  if (!contract) {
    toast('직원 계약서를 찾을 수 없습니다.', { tone: 'error' });
    return;
  }
  const sites = await store.listSites();
  // 별첨은 계약서의 siteIds + 팀장 계정에 배정된 업장을 합쳐 그립니다.
  const annexSiteIds = new Set(contract.siteIds || []);
  if (contract.accountId) {
    const account = await store.getAccount(contract.accountId);
    ((account && account.assignedSiteIds) || []).forEach((id) => annexSiteIds.add(id));
  }
  const siteNames = contract.siteIds
    .map((id) => (sites.find((site) => site.id === id) || {}).name)
    .filter(Boolean);
  const meta = STAFF_TYPES[contract.employmentType] || STAFF_TYPES.freelancer;

  active = {
    async onAction(action) {
      if (action === 'clear-sign') {
        const pad = $('[data-signature-pad]', modal);
        if (pad && pad.pad) pad.pad.clear();
        return;
      }
      if (action === 'annex-ack-yes' || action === 'annex-ack-no') {
        if (contract.status === 'signed') {
          toast('체결된 계약서는 확인 표시를 바꿀 수 없습니다.', { tone: 'error' });
          return;
        }
        const value = action === 'annex-ack-yes' ? 'yes' : 'no';
        // 같은 칸을 다시 누르면 체크를 취소합니다.
        const nextValue = contract.annexAck === value ? '' : value;
        try {
          contract = await store.updateStaffContract(
            contract.id,
            { annexAck: nextValue },
            { actor: viewer && viewer.role === 'leader' ? viewer : null },
          );
        } catch (error) {
          toast(error && error.message ? error.message : '확인 표시를 저장하지 못했습니다.', { tone: 'error' });
          return;
        }
        paintAnnexAck(nextValue);
        return;
      }
      if (action === 'send-staff') {
        contract = await store.sendStaffContract(contract.id, { actor: viewer });
        toast('직원에게 계약서를 보냈습니다. 직원관리방에서 서명할 수 있습니다.');
        await reload();
        draw();
        return;
      }
      if (action === 'sign-staff') {
        const pad = $('[data-signature-pad]', modal);
        if (!pad || !pad.pad || pad.pad.isEmpty()) {
          toast('서명란에 서명해 주세요.', { tone: 'error' });
          return;
        }
        const profile = {};
        if (contract.employmentType === 'contract') {
          profile.companyName = $('#sub-company', modal)?.value.trim() || '';
          profile.name = $('#sub-name', modal)?.value.trim() || '';
          profile.bizNumber = $('#sub-biz', modal)?.value.trim() || '';
          profile.address = $('#sub-address', modal)?.value.trim() || '';
          profile.phone = $('#sub-phone', modal)?.value.trim() || '';
          const account = $('#sub-account', modal)?.value.trim() || '';
          if (account) {
            profile.bankAccount = account;
            profile.accountHolder = profile.name || contract.accountHolder;
          }
          if (!profile.name) {
            toast('수급인(을) 성명을 입력해 주세요.', { tone: 'error' });
            return;
          }
        }
        contract = await store.signStaffContract(
          contract.id,
          {
            signature: pad.pad.toDataURL(),
            ...profile,
          },
          { actor: viewer && viewer.role === 'leader' ? viewer : null },
        );
        toast('직원 계약서 서명이 완료되었습니다.');
        await reload();
        draw();
      }
    },
  };

  function draw() {
    const editable = role === 'staff' && contract.status !== 'signed';
    const actions =
      role === 'admin'
        ? [
            contract.status === 'draft' ? actionButton('직원에게 계약서 발송', 'send-staff') : '',
            contract.status === 'sent' ? '<p class="sheet-actions__note">직원 서명을 기다리는 중입니다.</p>' : '',
          ]
            .filter(Boolean)
            .join('')
        : editable
          ? actionButton('직원 서명 완료', 'sign-staff')
          : contract.status === 'signed'
            ? '<p class="sheet-actions__note">체결 완료된 내 계약서입니다.</p>'
            : '';

    renderSheet({
      title: `${meta.short} 계약서 · ${contract.name}`,
      html:
        (contract.employmentType === 'contract'
          ? subcontractSheetHtml(contract, {
              sites: sites.filter((site) => annexSiteIds.has(site.id)),
              editable,
            })
          : staffSheetHtml(contract, siteNames)) +
        (editable
          ? `<div class="sheet-actions__pad">${signatureFieldTemplate('내 전자서명 (을)', '서명 박스를 누르면 넓은 서명 창이 열립니다.')}</div>`
          : ''),
      actions,
      afterMount: (box) => {
        const holder = $('[data-signature-pad]', box);
        if (holder) createSignatureField(holder);
      },
    });
  }

  draw();
}

/* 키보드로 닫기 — 서명 창이 열려 있으면 서명 창만 닫습니다. */
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (signModal && !signModal.hidden) {
      closeSignModal();
      return;
    }
    if (modal && !modal.hidden) closeSheet();
  });
}
