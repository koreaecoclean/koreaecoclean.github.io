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
import { CATEGORY_META, STAFF_TYPES, SUPPLIER, PAYMENT_ACCOUNT } from '../seed.js';
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
/* signature pad                                                       */
/* ------------------------------------------------------------------ */

function setupSignaturePad(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(260, Math.round(rect.width || canvas.clientWidth || 300));
  const height = 170;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#111c15';

  let drawing = false;
  let dirty = false;
  let last = null;

  const point = (event) => {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    drawing = true;
    last = point(event);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    event.preventDefault();
    const next = point(event);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    last = next;
    dirty = true;
  });
  const end = () => {
    drawing = false;
    last = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointerleave', end);
  canvas.addEventListener('pointercancel', end);

  return {
    clear() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      dirty = false;
    },
    isEmpty() {
      return !dirty;
    },
    toDataURL() {
      return dirty ? canvas.toDataURL('image/png') : '';
    },
  };
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
        <p class="doc__sign-line">코리아 에코크린 · 대표 ${esc(SUPPLIER.ceo)} <span class="doc__seal">(인)</span></p>
      </footer>
    </article>`;
}

export async function openQuoteSheet(quoteId, options = {}) {
  const quote = await store.getQuote(quoteId);
  if (!quote) {
    toast('견적을 찾을 수 없습니다.', { tone: 'error' });
    return;
  }
  const photos = await photoUrls(quote.photos);
  const role = options.role || 'admin';
  const reload = options.onChanged || (() => {});

  active = {
    async onAction(action) {
      if (action === 'send-quote') {
        const ok = await confirmDialog({
          title: '견적서를 발송할까요?',
          message: '고객 방에 ‘도착한 견적서’가 표시되고, 보낸 초대코드로 열람할 수 있습니다.',
          confirmLabel: '발송',
        });
        if (!ok) return;
        await store.sendQuote(quote.id);
        toast('견적서를 발송했습니다.');
        await reload();
        closeSheet();
        return;
      }
      if (action === 'to-contract') {
        const agreement = await store.createAgreementFromQuote(quote.id);
        await reload();
        closeSheet();
        await openAgreementSheet(agreement.id, { role: 'admin', onChanged: reload });
        return;
      }
      if (action === 'copy-invite') {
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
    `아래 주소에서 1회용 코드를 입력하시면 견적서와 계약서를 확인하고 바로 전자서명하실 수 있습니다.`,
    `주소: https://koreaecoclean.github.io/app/#customer`,
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
    <tr><th>대&nbsp;&nbsp;표&nbsp;&nbsp;자</th><td>${esc(agreement.supplierCeo)} &nbsp;<span class="doc__seal">(인)</span></td></tr>
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
  return `
    <div class="sign-pad" data-signature-pad>
      <div class="sign-pad__head">
        <span>갑(고객) 전자서명</span>
        <button class="link-btn" type="button" data-doc-action="clear-sign">지우기</button>
      </div>
      <canvas id="sign-canvas" aria-label="전자서명 패드"></canvas>
      <p class="sign-pad__hint">손가락이나 마우스로 서명해 주세요.</p>
    </div>`;
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
        agreement = await store.sendAgreement(agreement.id);
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
        const canvas = $('#sign-canvas', box);
        const pad = canvas ? setupSignaturePad(canvas) : null;
        const holder = $('[data-signature-pad]', box);
        if (holder && pad) holder.pad = pad;
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
          <div><span>사업주 (갑)</span><strong>코리아 에코크린 대표 ${esc(SUPPLIER.ceo)}</strong><span class="doc__seal">(인)</span></div>
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

export async function openStaffContractSheet(staffId, options = {}) {
  const role = options.role || 'admin';
  const reload = options.onChanged || (() => {});
  let contract = await store.getStaffContract(staffId);
  if (!contract) {
    toast('직원 계약서를 찾을 수 없습니다.', { tone: 'error' });
    return;
  }
  const sites = await store.listSites();
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
      if (action === 'send-staff') {
        contract = await store.sendStaffContract(contract.id);
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
        contract = await store.signStaffContract(contract.id, { signature: pad.pad.toDataURL() });
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
        staffSheetHtml(contract, siteNames) +
        (editable
          ? `
        <div class="sheet-actions__pad">
          <div class="sign-pad" data-signature-pad>
            <div class="sign-pad__head">
              <span>내 전자서명</span>
              <button class="link-btn" type="button" data-doc-action="clear-sign">지우기</button>
            </div>
            <canvas id="sign-canvas" aria-label="전자서명 패드"></canvas>
            <p class="sign-pad__hint">손가락이나 마우스로 서명해 주세요.</p>
          </div>
        </div>`
          : ''),
      actions,
      afterMount: (box) => {
        const canvas = $('#sign-canvas', box);
        const pad = canvas ? setupSignaturePad(canvas) : null;
        const holder = $('[data-signature-pad]', box);
        if (holder && pad) holder.pad = pad;
      },
    });
  }

  draw();
}

/* 키보드로 닫기 */
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal && !modal.hidden) closeSheet();
  });
}
