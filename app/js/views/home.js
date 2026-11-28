/**
 * views/home.js — 홈
 *
 * The app exists for one job: the cleaning crew sends field photos, the client
 * checks them. So the home screen stays a simple launch pad — logo, field photo
 * gallery, the three role entries, and a banner to the company website.
 *
 * v2.16.2 — 지정 업체 외 타 업체 정보 차단
 *  · 비로그인: 샘플 현장 사진을 포함해 어떤 업체의 현장 사진도 내보내지 않습니다.
 *  · 고객사 · 관리팀장: **본인 지정 업장**의 이름 · 최근 보고 · 사진만 보입니다.
 *  · 관리자(대표): 회사 전체를 관리하므로 기존 현장 사진 안내를 그대로 둡니다.
 */

import { $, esc, icons, openLightbox, fmtDateLong, relDayLabel } from '../ui.js';
import { store, countReportPhotos } from '../store.js';
import { getSession } from '../auth.js';

export const BRAND = {
  name: '코리아 에코크린',
  homepage: 'https://koreaecoclean.github.io/',
};

/** Bundled sample photos — 관리자(대표) 홈에서만 안내용으로 보여 줍니다. */
const GALLERY = [
  { name: 'photo-1-office', caption: '사무실 · 책상과 바닥' },
  { name: 'photo-2-meeting', caption: '회의실 · 테이블과 바닥' },
  { name: 'photo-3-clinic', caption: '진료실 · 시술 베드' },
  { name: 'photo-4-clinic-lounge', caption: '대기 라운지' },
  { name: 'photo-5-gym', caption: '운동기구 존 · 바닥' },
  { name: 'photo-lock', caption: '시건장치 · 출입문 잠금 확인' },
];

const ROLES = [
  {
    key: 'customer',
    icon: 'clipboard',
    label: '고객사',
    body: '우리 현장 청소 기록 · 사진 확인',
    tone: 'primary',
  },
  {
    key: 'leader',
    icon: 'camera',
    label: '담당팀',
    body: '시건장치 · 맞춤 청소 · 특이사항 사진 전송',
    tone: 'ghost',
  },
  {
    key: 'admin',
    icon: 'check',
    label: '관리자',
    body: '1회용 코드 발급 · 팀장 코드 관리',
    tone: 'quiet',
  },
];

const PHOTO_TYPES = [
  { icon: 'check', label: '시건장치 확인', body: '출입문 잠금 상태' },
  { icon: 'camera', label: '맞춤 청소', body: '업장별 결과 사진' },
  { icon: 'clipboard', label: '특이사항', body: '새로 생긴 문제' },
];

function galleryTemplate() {
  return GALLERY.map(
    (item, index) => `
      <button class="home-gallery__item" type="button" data-gallery="${index}" aria-label="${esc(item.caption)} 크게 보기">
        <img src="assets/samples/thumbs/${item.name}.jpg" alt="${esc(item.caption)}" loading="lazy" decoding="async">
      </button>`,
  ).join('');
}

function roleGridTemplate() {
  return `
    <section class="role-grid" aria-label="앱 입구">
      ${ROLES.map(
        (role) => `
        <button class="role-card role-card--${role.tone}" type="button" data-action="open-${role.key}">
          <span class="role-card__icon" aria-hidden="true">${icons[role.icon]}</span>
          <span class="role-card__text">
            <strong>${esc(role.label)}</strong>
            <span>${esc(role.body)}</span>
          </span>
        </button>`,
      ).join('')}
    </section>`;
}

/** 비로그인 — 업체 사진은 한 장도 보이지 않습니다. */
function guestPhotosTemplate() {
  return `
    <section class="panel" data-home-photos="guest">
      <div class="section-head">
        <h2>현장 사진</h2>
        <p>로그인 후 확인</p>
      </div>
      <div class="steps">
        ${PHOTO_TYPES.map(
          (item, index) => `
          <div class="step">
            <span class="step__num">${index + 1}</span>
            <div><strong>${esc(item.label)}</strong><span>${esc(item.body)}</span></div>
          </div>`,
        ).join('')}
      </div>
      <p class="hint" style="margin-top:10px">
        현장 사진은 <strong>고객사 · 담당팀 로그인</strong> 후 <strong>본인 업장</strong>의 기록만 열립니다.
        다른 업체의 사진 · 이름 · 정보는 표시되지 않습니다.
      </p>
    </section>`;
}

/** 로그인한 고객사 · 관리팀장 — 본인 지정 업장의 기록만. */
async function mySitesTemplate(session) {
  let sites = [];
  try {
    sites = await store.listSitesFor(session);
  } catch (error) {
    console.warn('[home] 내 업장을 불러오지 못했습니다', error);
  }
  if (!sites.length) {
    return {
      items: [],
      html: `
      <section class="panel" data-home-photos="empty">
        <div class="section-head">
          <h2>우리 현장</h2>
          <p>${esc(session.name)}님</p>
        </div>
        <div class="empty">
          <strong>아직 지정된 업장이 없습니다</strong>
          <span>대표가 업장을 지정하면 이곳에 우리 현장 기록이 표시됩니다.</span>
        </div>
      </section>`,
    };
  }

  const picked = [];
  const cards = [];
  for (const site of sites.slice(0, 4)) {
    let reports = [];
    try {
      reports = await store.listReports({ siteId: site.id, limit: 30 }, { actor: session });
    } catch (error) {
      reports = [];
    }
    const visible = reports.filter((report) => report && report.status !== 'draft');
    const latest = visible[0] || null;
    const photoCount = visible.reduce((sum, report) => sum + (countReportPhotos(report) || 0), 0);
    for (const report of visible.slice(0, 3)) {
      for (const group of ['security', 'cleaning', 'issue']) {
        for (const photo of (report.photos && report.photos[group]) || []) {
          if (picked.length >= 6) break;
          picked.push({ photo, report, site });
        }
      }
    }
    cards.push(`
      <button class="pick" type="button" data-home-site="${esc(site.id)}">
        <span>
          <strong>${esc(site.name)}</strong>
          <span>${esc(site.code)} · ${esc(site.frequency || '')}</span>
        </span>
        <span class="pick__right">
          <span class="badge">${latest ? `${esc(relDayLabel(latest.date) || fmtDateLong(latest.date))} 방문` : '기록 없음'}</span>
          <span class="site-item__code">사진 ${photoCount}장</span>
        </span>
      </button>`);
  }

  const gallery = picked.length
    ? `
      <div class="home-gallery">
        ${picked
          .map(
            (item, index) => `
          <button class="home-gallery__item" type="button" data-home-photo="${index}"
                  aria-label="${esc(`${item.site.name} 현장 사진 ${index + 1}`)} 크게 보기">
            <img src="${esc(store.photoThumbUrl(item.photo))}" alt="${esc(item.site.name)} 현장 사진" loading="lazy" decoding="async">
          </button>`,
          )
          .join('')}
      </div>`
    : `<div class="empty"><strong>아직 등록된 현장 사진이 없습니다</strong><span>담당팀이 보고를 올리면 이곳에 표시됩니다.</span></div>`;

  return {
    items: picked,
    html: `
    <section class="panel" data-home-photos="mine">
      <div class="section-head">
        <h2>우리 현장</h2>
        <p>${esc(session.name)}님 · ${sites.length}곳</p>
      </div>
      <div class="pick-list">${cards.join('')}</div>
      <div class="section-head" style="margin-top:16px">
        <h2>현장 사진</h2>
        <p>눌러서 크게 보기</p>
      </div>
      ${gallery}
      <p class="hint" style="margin-top:10px">
        우리 업장 기록만 표시됩니다. 다른 업체의 사진 · 이름 · 정보는 표시되지 않습니다.
      </p>
    </section>`,
  };
}

export function createHomeView(container) {
  let mounted = false;
  let lightboxItems = [];

  async function openGallery(index) {
    const items = GALLERY.map((item) => ({
      url: `assets/samples/${item.name}.jpg`,
      caption: item.caption,
    }));
    openLightbox(items, index);
  }

  async function openMyPhotos(index) {
    if (!lightboxItems.length) return;
    openLightbox(lightboxItems, Math.min(index, lightboxItems.length - 1));
  }

  function onClick(event) {
    const tile = event.target.closest('[data-gallery]');
    if (tile) {
      openGallery(Number(tile.dataset.gallery) || 0);
      return;
    }
    const myPhoto = event.target.closest('[data-home-photo]');
    if (myPhoto) {
      openMyPhotos(Number(myPhoto.dataset.homePhoto) || 0);
      return;
    }
    const siteButton = event.target.closest('[data-home-site]');
    if (siteButton) {
      document.dispatchEvent(new CustomEvent('kec:navigate', { detail: { tab: 'customer' } }));
      return;
    }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    const tab = action.replace('open-', '');
    if (['customer', 'leader', 'admin'].includes(tab)) {
      document.dispatchEvent(new CustomEvent('kec:navigate', { detail: { tab } }));
    }
  }

  function mount() {
    if (mounted) return;
    container.addEventListener('click', onClick);
    mounted = true;
  }

  async function render() {
    mount();
    const session = await getSession().catch(() => null);
    const role = session ? session.role : '';
    const restricted = role === 'customer' || role === 'leader';
    lightboxItems = [];

    let photosSection = '';
    if (restricted) {
      const mine = await mySitesTemplate(session);
      photosSection = mine.html;
      lightboxItems = await Promise.all(
        mine.items.map(async (item) => ({
          url: (await store.photoFullUrl(item.photo)) || store.photoThumbUrl(item.photo),
          caption: `${item.site.name} · ${fmtDateLong(item.report.date)}`,
        })),
      );
    } else if (role === 'admin') {
      photosSection = `
        <section class="panel" data-home-photos="admin">
          <div class="section-head">
            <h2>현장 사진</h2>
            <p>관리자 · 전체 업장</p>
          </div>
          <div class="home-gallery">${galleryTemplate()}</div>
          <p class="hint" style="margin-top:10px">
            모든 보고는 <strong>시건장치 확인</strong> · <strong>업장별 맞춤 청소</strong> · <strong>특이사항</strong> 세 가지로 나뉘어 기록됩니다.
          </p>
        </section>`;
    } else {
      photosSection = guestPhotosTemplate();
    }

    const hello = session
      ? `<p class="home-hero__body"><strong>${esc(session.name)} ${esc(session.title || '')}</strong>님, 우리 현장 기록만 보입니다.</p>`
      : `<p class="home-hero__body">
          팀장은 시건장치 · 맞춤 청소 · 특이사항 사진을 남기고,<br>
          고객사는 전용 방에서 우리 현장 기록을 바로 확인합니다.
        </p>`;

    container.innerHTML = `
      <section class="home-hero">
        <img class="home-hero__logo" src="assets/logo.png" alt="${esc(BRAND.name)} 로고" width="96" height="96" decoding="async">
        <h1>${esc(BRAND.name)}</h1>
        <p class="home-hero__lead">현장 사진 전송 · 확인 · 보고</p>
        ${hello}
      </section>

      ${roleGridTemplate()}

      ${photosSection}

      <a class="site-banner" href="${esc(BRAND.homepage)}" target="_blank" rel="noopener noreferrer">
        <span class="site-banner__text">
          <strong>코리아 에코크린 홈페이지</strong>
          <span>회사 소개 · 서비스 안내 · 상담 문의</span>
        </span>
        <span class="site-banner__arrow" aria-hidden="true">→</span>
      </a>

      <p class="footer-note">${esc(BRAND.name)} · 정기청소 현장 기록 앱</p>
    `;
  }

  return { render };
}
