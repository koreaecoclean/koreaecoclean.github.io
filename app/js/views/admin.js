/**
 * views/admin.js — 관리 (대표 · 최고관리자)
 *
 * - 현장별 1회용 청소코드 발급 / 상태(미사용·사용 완료) 확인 / 복사
 * - 팀장 고유코드 발급·재발급, 계정 사용 중지
 * - 고객 계정과 방 입장 상태 확인
 */

import { $, esc, icons, toast, confirmDialog, copyText, setBusy } from '../ui.js';
import { store } from '../store.js';
import { CATEGORY_META } from '../seed.js';
import { getSession, loginAdmin, logout, demoAccounts } from '../auth.js';

export function createAdminView(container) {
  const state = { session: null, loginError: '', busy: false };
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
        <h2>대표(최고관리자)${admin ? ` · ${esc(admin.name)}` : ''} 로그인</h2>
        <p class="tiny muted">
          전화번호와 비밀번호로 입장합니다. 로그인하면 현장별 <strong>1회용 청소코드</strong>를 발급하고
          <strong>팀장 고유코드</strong>를 관리할 수 있습니다.
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
          ${state.loginError ? `<p class="field__error">${esc(state.loginError)}</p>` : ''}
          <button class="btn btn--primary btn--block" type="submit">관리자 로그인</button>
        </form>
        ${
          admin
            ? `<details class="demo-panel">
                 <summary>데모 관리자 계정</summary>
                 <div class="demo-panel__body">
                   <div class="demo-row">
                     <div><strong>대표 · ${esc(admin.name)}</strong><span>${esc(admin.phone)} / ${esc(admin.password)}</span></div>
                     <button class="link-btn" type="button" data-fill-admin="${esc(admin.phone)}|${esc(admin.password)}">입력</button>
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

  /* ---------------- dashboard ---------------- */

  function siteCodeCardTemplate(site, codes) {
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
    const site = sites.find((item) => (account.assignedSiteIds || []).includes(item.id));
    return `
      <div class="staff-row" data-leader-row="${esc(account.id)}">
        <div class="staff-row__who">
          <span class="avatar" aria-hidden="true">${esc(account.name.slice(0, 1))}</span>
          <div>
            <strong>${esc(account.name)} ${esc(account.title || '팀장')}${account.active === false ? ' · 중지됨' : ''}</strong>
            <span>${esc(account.phonePretty || account.phone)}${site ? ` · ${esc(site.name)}` : ''}</span>
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

  async function dashboardTemplate(session) {
    const sites = await store.listSites();
    const codes = await store.listRoomCodes();
    const accounts = await store.listAccounts();
    const leaders = accounts.filter((account) => account.role === 'leader');
    const customers = accounts.filter((account) => account.role === 'customer');
    const grants = await store.listGrants();

    const unusedTotal = codes.filter((code) => !code.usedAt).length;
    const usedTotal = codes.filter((code) => code.usedAt).length;

    return `
      <div class="leader-bar">
        <div class="leader-bar__who">
          <span class="avatar" aria-hidden="true">${esc(session.name.slice(0, 1))}</span>
          <div>
            <strong>${esc(session.name)} 대표 · 최고관리자</strong>
            <span>${esc(session.phone || '')} · 코드 발급 권한</span>
          </div>
        </div>
        <button class="btn btn--sm btn--quiet" type="button" data-action="logout">로그아웃</button>
      </div>

      <section class="panel">
        <div class="admin-stats">
          <div><strong>${sites.length}</strong><span>관리 현장</span></div>
          <div><strong>${unusedTotal}</strong><span>미사용 코드</span></div>
          <div><strong>${usedTotal}</strong><span>사용 완료</span></div>
          <div><strong>${leaders.length}</strong><span>팀장</span></div>
        </div>
      </section>

      <section>
        <div class="section-head">
          <h2>1회용 청소코드</h2>
          <p>현장별 발급 · 사용 확인</p>
        </div>
        <div class="stack-10">
          ${sites
            .map((site) => siteCodeCardTemplate(site, codes.filter((code) => code.siteId === site.id)))
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

  async function render() {
    const token = (renderToken += 1);
    mount();
    const session = await getSession();
    if (token !== renderToken) return;

    if (!session || session.role !== 'admin') {
      state.session = null;
      container.innerHTML = loginTemplate();
      return;
    }

    state.session = session;
    container.innerHTML = await dashboardTemplate(session);
  }

  /* ---------------- events ---------------- */

  async function onSubmit(event) {
    if (event.target.id !== 'admin-login') return;
    event.preventDefault();
    state.loginError = '';
    try {
      const session = await loginAdmin({
        phone: $('#a-phone', container)?.value || '',
        password: $('#a-password', container)?.value || '',
      });
      toast(`${session.name} 대표로 로그인했습니다.`);
      await render();
    } catch (error) {
      state.loginError = error.message || '로그인에 실패했습니다.';
      await render();
      const phoneInput = $('#a-phone', container);
      if (phoneInput) phoneInput.focus();
    }
  }

  async function onClick(event) {
    const fill = event.target.closest('[data-fill-admin]');
    if (fill) {
      const [phone, password] = fill.dataset.fillAdmin.split('|');
      const phoneInput = $('#a-phone', container);
      const passwordInput = $('#a-password', container);
      if (phoneInput) phoneInput.value = phone;
      if (passwordInput) passwordInput.value = password;
      return;
    }

    const copy = event.target.closest('[data-copy-code]');
    if (copy) {
      const ok = await copyText(copy.dataset.copyCode);
      toast(ok ? `${copy.dataset.copyCode} 코드를 복사했습니다.` : '복사가 차단되었습니다. 코드를 길게 눌러 복사해 주세요.');
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
    mounted = true;
  }

  return { render };
}
