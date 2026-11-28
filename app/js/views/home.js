/**
 * views/home.js — 홈
 *
 * The app exists for one job: the cleaning crew sends field photos, the client
 * checks them. So the home screen stays a simple launch pad — logo, field photo
 * gallery, the three role entries, and a banner to the company website.
 */

import { $, esc, icons, openLightbox } from '../ui.js';

export const BRAND = {
  name: '코리아 에코크린',
  homepage: 'https://koreaecoclean.github.io/',
};

/** Field photos bundled with the app (same set the demo reports use). */
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

function galleryTemplate() {
  return GALLERY.map(
    (item, index) => `
      <button class="home-gallery__item" type="button" data-gallery="${index}" aria-label="${esc(item.caption)} 크게 보기">
        <img src="assets/samples/thumbs/${item.name}.jpg" alt="${esc(item.caption)}" loading="lazy" decoding="async">
      </button>`,
  ).join('');
}

export function createHomeView(container) {
  let mounted = false;

  function openGallery(index) {
    const items = GALLERY.map((item) => ({
      url: `assets/samples/${item.name}.jpg`,
      caption: item.caption,
    }));
    openLightbox(items, index);
  }

  function onClick(event) {
    const tile = event.target.closest('[data-gallery]');
    if (tile) {
      openGallery(Number(tile.dataset.gallery) || 0);
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
    container.innerHTML = `
      <section class="home-hero">
        <img class="home-hero__logo" src="assets/logo.png" alt="${esc(BRAND.name)} 로고" width="96" height="96" decoding="async">
        <h1>${esc(BRAND.name)}</h1>
        <p class="home-hero__lead">현장 사진 전송 · 확인 · 보고</p>
        <p class="home-hero__body">
          팀장은 시건장치 · 맞춤 청소 · 특이사항 사진을 남기고,<br>
          고객사는 전용 방에서 우리 현장 기록을 바로 확인합니다.
        </p>
      </section>

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
      </section>

      <section class="panel">
        <div class="section-head">
          <h2>현장 사진</h2>
          <p>눌러서 크게 보기</p>
        </div>
        <div class="home-gallery">${galleryTemplate()}</div>
        <p class="hint" style="margin-top:10px">
          모든 보고는 <strong>시건장치 확인</strong> · <strong>업장별 맞춤 청소</strong> · <strong>특이사항</strong> 세 가지로 나뉘어 기록됩니다.
        </p>
      </section>

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
