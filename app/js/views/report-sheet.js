/**
 * views/report-sheet.js — 청소 보고서 상세 시트 · 무료 PDF(브라우저 인쇄).
 *
 * 한 화면 오버레이에서 보고서를 A4 서식으로 보여 주고, 위쪽 [인쇄 / PDF] 단추로
 * 브라우저 인쇄 창을 열어 PDF 로 저장합니다(유료 서비스 없음).
 *  - 대표 · 팀장: 보고서 번호 · 실제 시작/종료/소요 · 점검 · 분류 사진 + 수정 이력(내부)
 *  - 고객: 승인·제출된 최종 내용만 (반려 사유 · 수정 이력 · 원본 스냅샷 비노출)
 */

import { esc, fmtDateLong, fmtTime, fmtDateDot } from '../ui.js';
import {
  store,
  reportStatus,
  reportNoOf,
  countReportPhotos,
  REPORT_REVISION_ACTIONS,
  isCustomerActor,
} from '../store.js';
import { SUPPLIER, PHOTO_GROUPS, CATEGORY_META } from '../seed.js';
import { openDocumentSheet } from './quote-contract.js';

/* ------------------------------------------------------------------ */
/* markup                                                              */
/* ------------------------------------------------------------------ */

/** 시각 표시 — 저장은 UTC(ISO)지만 화면·인쇄는 기기 시간대(한국)로 보여 줍니다. */
function stampText(iso) {
  const text = String(iso || '');
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.replace('T', ' ').slice(0, 16);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function photoCardsTemplate(report, group) {
  const photos = (report.photos && report.photos[group.key]) || [];
  if (!photos.length) return '';
  return `
    <section class="report-doc__group" data-report-group="${esc(group.key)}">
      <h3>${esc(group.label)} <span>${photos.length}장</span></h3>
      <div class="report-doc__photos">
        ${photos
          .map(
            (photo) => `
          <figure>
            <img src="${esc(store.photoThumbUrl(photo))}" alt="${esc(photo.caption || group.label + ' 사진')}" loading="lazy" decoding="async">
            ${photo.caption ? `<figcaption>${esc(photo.caption)}</figcaption>` : ''}
          </figure>`,
          )
          .join('')}
      </div>
    </section>`;
}

function checklistTemplate(report) {
  const rows = Array.isArray(report.checklist) ? report.checklist : [];
  if (!rows.length) return '';
  const done = rows.filter((row) => row.done).length;
  return `
    <section class="report-doc__block" data-report-checklist>
      <h3>점검 항목 <span>${done}/${rows.length} 완료</span></h3>
      <ul class="report-doc__checks">
        ${rows
          .map(
            (row) => `<li class="${row.done ? 'is-done' : ''}"><span aria-hidden="true">${row.done ? '✓' : '—'}</span>${esc(row.label)}</li>`,
          )
          .join('')}
      </ul>
    </section>`;
}

function workTableTemplate(report, site) {
  const status = reportStatus(report);
  const start = report.workStartAt ? fmtTime(report.workStartAt) : '';
  const end = report.workEndAt ? fmtTime(report.workEndAt) : '';
  const category = (CATEGORY_META[site && site.category] || {}).label || '';
  return `
    <table class="doc-table doc-table--kv report-doc__meta">
      <tr><th>보고서 번호</th><td data-report-no>${esc(reportNoOf(report))}</td><th>상태</th><td data-report-status>${esc(status.short || status.label)}</td></tr>
      <tr><th>업장</th><td>${esc(report.siteName || (site && site.name) || '')}${category ? `<span class="report-doc__sub"> · ${esc(category)}</span>` : ''}</td><th>업장 코드</th><td>${esc(report.siteCode || (site && site.code) || '-')}</td></tr>
      <tr><th>방문 날짜</th><td>${esc(fmtDateLong(report.date))}</td><th>완료 시간</th><td>${esc(fmtTime(report.time))}</td></tr>
      <tr><th>담당</th><td>${esc(report.leader || '-')} ${esc(report.leaderRole || '팀장')}</td><th>사진</th><td>${countReportPhotos(report)}장</td></tr>
      <tr><th>실제 시작</th><td data-report-start>${start ? esc(start) : '미등록'}</td><th>실제 종료</th><td data-report-end>${end ? esc(end) : '미등록'}</td></tr>
      <tr><th>소요 시간</th><td data-report-duration colspan="3">${report.workDurationText ? esc(report.workDurationText) : report.durationMin ? `${esc(report.durationMin)}분` : '미등록'}</td></tr>
    </table>`;
}

function revisionHistoryTemplate(report) {
  const rows = Array.isArray(report.revisions) ? report.revisions : [];
  if (!rows.length) return '';
  return `
    <section class="report-doc__block report-doc__internal" data-report-revisions>
      <h3>수정 이력 <span>${rows.length}건</span></h3>
      <ol class="report-doc__history">
        ${rows
          .map(
            (row) => `
          <li data-revision="${esc(row.action)}">
            <strong>${esc(REPORT_REVISION_ACTIONS[row.action] || row.actionLabel || row.action)}</strong>
            <span>${esc(stampText(row.at))}${row.by ? ` · ${esc(row.by)}` : ''}</span>
            ${row.note ? `<p>${esc(row.note)}</p>` : ''}
            ${row.changes.length
              ? `<p class="report-doc__changes">${row.changes
                  .map((item) => `${esc(item.field)} ${esc(item.from)} → ${esc(item.to)}`)
                  .join(' · ')}</p>`
              : ''}
          </li>`,
          )
          .join('')}
      </ol>
    </section>`;
}

function originalTemplate(report) {
  const original = report.original || {};
  const rows = Array.isArray(original.checklist) ? original.checklist : [];
  if (!original.at || !rows.length) return '';
  const done = rows.filter((row) => row.done).length;
  return `
    <section class="report-doc__block report-doc__internal" data-report-original>
      <h3>처음 등록한 내용 <span>${esc(stampText(original.at))}</span></h3>
      <p class="report-doc__sub">점검 ${done}/${rows.length} · 사진 시건장치 ${Number(original.photos.security) || 0}장 ·
        맞춤청소 ${Number(original.photos.cleaning) || 0}장 · 특이사항 ${Number(original.photos.issue) || 0}장</p>
      ${original.note ? `<p><strong>전달 메모</strong> ${esc(original.note)}</p>` : ''}
      ${original.issueNote ? `<p><strong>특이사항</strong> ${esc(original.issueNote)}</p>` : ''}
    </section>`;
}

/**
 * A4 보고서 본문. `internal` 이 참일 때만 수정 이력 · 원본 · 반려 사유를 그립니다.
 */
export function reportSheetHtml(report, { site = null, internal = false } = {}) {
  if (!report) return '';
  const groups = PHOTO_GROUPS.map((group) => photoCardsTemplate(report, group)).join('');
  const reason = internal && report.revisionReason
    ? `<p class="report-doc__reason" data-report-reason><strong>수정 요청 사유</strong> ${esc(report.revisionReason)}</p>`
    : '';
  return `
    <article class="sheet doc report-doc" data-report-sheet="${esc(report.id)}" data-report-no-full="${esc(reportNoOf(report))}">
      <header class="doc__head report-doc__head">
        <div>
          <h1>청소 완료 보고서</h1>
          <p class="doc__sub">${esc(reportNoOf(report))} · ${esc(SUPPLIER.nameKo)}</p>
        </div>
        <img class="report-doc__logo" src="assets/logo.png" alt="" width="46" height="46" decoding="async">
      </header>

      ${workTableTemplate(report, site)}
      ${reason}
      ${checklistTemplate(report)}

      ${
        report.note
          ? `<section class="report-doc__block" data-report-note><h3>전달 메모</h3><p class="preserve">${esc(report.note)}</p></section>`
          : ''
      }
      ${
        report.issueNote
          ? `<section class="report-doc__block" data-report-issue><h3>특이사항</h3><p class="preserve">${esc(report.issueNote)}</p></section>`
          : ''
      }

      ${groups || '<p class="report-doc__sub">등록된 사진이 없습니다.</p>'}

      ${internal ? revisionHistoryTemplate(report) : ''}
      ${internal ? originalTemplate(report) : ''}

      <footer class="doc__foot report-doc__foot">
        <p>${esc(SUPPLIER.nameKo)} · 대표 ${esc(SUPPLIER.ceo)} · ${esc(SUPPLIER.phone)} · ${esc(SUPPLIER.email)}</p>
        <p>발행일 ${esc(fmtDateDot(new Date().toISOString().slice(0, 10)))} · ${esc(reportNoOf(report))}</p>
      </footer>
    </article>`;
}

/* ------------------------------------------------------------------ */
/* open                                                                */
/* ------------------------------------------------------------------ */

/**
 * 보고서 상세를 시트로 엽니다. 시트 위 [인쇄 / PDF] 로 브라우저 인쇄(A4)를 열면
 * 인쇄 대화상자에서 ‘PDF로 저장’을 고를 수 있습니다.
 */
export async function openReportSheet(reportOrId, { actor = null } = {}) {
  const report =
    reportOrId && typeof reportOrId === 'object'
      ? reportOrId
      : await store.getReport(String(reportOrId || ''), { actor });
  if (!report) {
    return null;
  }
  const site = report.siteId ? await store.getSite(report.siteId).catch(() => null) : null;
  const internal = !isCustomerActor(actor);
  openDocumentSheet({
    title: `보고서 ${reportNoOf(report)}`,
    html: reportSheetHtml(report, { site, internal }),
    actions: '<p class="tiny muted report-doc__hint">[인쇄 / PDF] 를 누르면 A4 보고서로 인쇄하거나 PDF로 저장할 수 있습니다.</p>',
  });
  return report;
}
