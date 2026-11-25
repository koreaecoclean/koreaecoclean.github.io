/**
 * app.js — app shell: boot, tab navigation (role aware), PWA lifecycle.
 */

import { $, toast, initLightbox } from './ui.js';
import { store } from './store.js';
import { getSession } from './auth.js';
import { createHomeView } from './views/home.js';
import { createCustomerView } from './views/customer.js';
import { createLeaderView } from './views/leader.js';
import { createAdminView } from './views/admin.js';

const TAB_NAMES = ['home', 'customer', 'leader', 'admin'];
const TAB_TITLES = {
  home: '코리아 에코크린 · 홈 상담',
  customer: '청소 확인 · 코리아 에코크린',
  leader: '현장 보고 · 코리아 에코크린',
  admin: '관리 · 코리아 에코크린',
};

const views = {
  home: createHomeView($('#view-home')),
  customer: createCustomerView($('#view-customer')),
  leader: createLeaderView($('#view-leader')),
  admin: createAdminView($('#view-admin')),
};

let activeTab = null;

/* ------------------------------------------------------------------ */
/* navigation                                                          */
/* ------------------------------------------------------------------ */

function paintTab(tab) {
  TAB_NAMES.forEach((name) => {
    const section = $(`#view-${name}`);
    if (section) section.hidden = name !== tab;
    const button = $(`.tab[data-tab="${name}"]`);
    if (button) button.setAttribute('aria-selected', String(name === tab));
  });
  document.title = TAB_TITLES[tab] || TAB_TITLES.home;
}

/** The 관리 tab appears only for the CEO/admin account (or while it is open). */
async function updateNav() {
  const session = await getSession().catch(() => null);
  const adminTab = $('.tab[data-tab="admin"]');
  if (adminTab) adminTab.hidden = !(session && session.role === 'admin') && activeTab !== 'admin';
  const leaderTab = $('.tab[data-tab="leader"]');
  if (leaderTab) leaderTab.dataset.role = session ? session.role : '';
}

export async function switchTab(tab, options = {}) {
  const name = TAB_NAMES.includes(tab) ? tab : 'home';
  activeTab = name;
  paintTab(name);

  if (window.location.hash !== `#${name}`) {
    window.history.replaceState(null, '', `#${name}`);
  }
  await updateNav();

  try {
    await views[name].render({ siteCode: options.siteCode || '' });
  } catch (error) {
    console.error('[app] render failed', error);
    toast('화면을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', { tone: 'error' });
  }

  window.scrollTo({ top: 0, behavior: 'instant' });
}

function bindNavigation() {
  document.addEventListener('click', (event) => {
    const tabButton = event.target.closest('[data-tab]');
    if (tabButton) {
      event.preventDefault();
      switchTab(tabButton.dataset.tab);
    }
  });

  document.addEventListener('kec:navigate', (event) => {
    const detail = event.detail || {};
    switchTab(detail.tab || 'home', { siteCode: detail.siteCode });
  });

  document.addEventListener('kec:session-changed', () => {
    updateNav();
    if (activeTab === 'admin') views.admin.render();
  });

  window.addEventListener('hashchange', () => {
    const name = window.location.hash.replace('#', '');
    if (TAB_NAMES.includes(name) && name !== activeTab) switchTab(name);
  });

  // Arrow keys move between the visible tabs (role="tablist").
  document.addEventListener('keydown', (event) => {
    if (!event.target.closest('.tabbar')) return;
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const visible = Array.from(document.querySelectorAll('.tab')).filter((tab) => !tab.hidden);
    const names = visible.map((tab) => tab.dataset.tab);
    const index = Math.max(0, names.indexOf(activeTab));
    const next = event.key === 'ArrowRight' ? (index + 1) % names.length : (index - 1 + names.length) % names.length;
    switchTab(names[next]);
    $(`#tab-${names[next]}`)?.focus({ preventScroll: true });
  });

  window.addEventListener('online', () => setNetworkPill(true));
  window.addEventListener('offline', () => setNetworkPill(false));
  setNetworkPill(navigator.onLine);
}

function setNetworkPill(online) {
  const pill = $('#net-pill');
  if (!pill) return;
  pill.hidden = !!online;
}

/* ------------------------------------------------------------------ */
/* PWA: install prompt + service worker                                */
/* ------------------------------------------------------------------ */

let deferredInstall = null;

function bindInstallPrompt() {
  const button = $('#install-btn');
  if (!button) return;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstall = event;
    button.hidden = false;
  });

  button.addEventListener('click', async () => {
    if (!deferredInstall) return;
    button.disabled = true;
    try {
      deferredInstall.prompt();
      const choice = await deferredInstall.userChoice;
      if (choice && choice.outcome === 'accepted') {
        toast('홈 화면에 앱을 추가했습니다.');
        button.hidden = true;
      }
    } finally {
      deferredInstall = null;
      button.disabled = false;
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    button.hidden = true;
    toast('코리아 에코크린 앱이 설치되었습니다.');
  });

  if (window.matchMedia('(display-mode: standalone)').matches) button.hidden = true;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('sw.js', { scope: './' });

      const announceUpdate = (worker) => {
        if (!worker || !navigator.serviceWorker.controller) return;
        toast('새 버전이 준비되었습니다.', {
          actionLabel: '새로고침',
          duration: 8000,
          onAction: () => worker.postMessage({ type: 'SKIP_WAITING' }),
        });
      };

      if (registration.waiting) announceUpdate(registration.waiting);

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed') announceUpdate(worker);
        });
      });

      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        window.location.reload();
      });
    } catch (error) {
      console.warn('[app] service worker registration failed', error);
    }
  });
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  initLightbox();
  bindNavigation();
  bindInstallPrompt();
  registerServiceWorker();

  try {
    await store.init();
  } catch (error) {
    console.error('[app] store init failed', error);
    toast('저장소를 열지 못했습니다. 시크릿 모드에서는 일부 기능이 제한됩니다.', { tone: 'error', duration: 6000 });
  }

  const fromHash = window.location.hash.replace('#', '');
  const initial = TAB_NAMES.includes(fromHash) ? fromHash : 'home';
  await switchTab(initial);

  document.body.dataset.appReady = 'true';
  document.documentElement.dataset.store = store.adapterName;

  // Keep the customer room fresh when a report is added elsewhere in the app.
  store.subscribe(() => {
    if (activeTab === 'customer') views.customer.render();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (activeTab === 'customer' || activeTab === 'leader')) {
      views[activeTab].render();
    }
  });
}

boot();

/* Tiny debug handle for local testing in the console. */
window.__kec = { store, views, switchTab };
