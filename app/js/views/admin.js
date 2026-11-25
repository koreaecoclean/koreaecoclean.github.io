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
import { preparePhoto } from '../photos.js';
import { getSession, loginAdmin, logout, demoAccounts } from '../auth.js';

export function createAdminView(container) {
  const state = {
    session: null,
    loginError: '',
    busy: false,
    newSiteOpen: false,
    newSiteError: '',
    newSite: { quote: [], deepClean: [] },
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
            <input type="file" accept="image/*" capture="environment" multiple hidden data-new-baseline="${key}">
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
            ${photoRow('quote', '① 첫 견적 사진 (오염 상태)', '지금 상태 그대로를 남깁니다. 나중에 고객이 비교해 볼 수 있습니다.')}
            ${photoRow('deepClean', '② 첫 청소 사진 (대청소)', '첫 대청소 완료 후 사진입니다.')}
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
    const stage = (key, label, record) => `
      <div class="baseline-row">
        <div class="baseline-row__who">
          <strong>${label}</strong>
          <span>${record && record.date ? formatStamp(record.date) : '날짜 미등록'} · ${(record && record.photos ? record.photos.length : 0)}장</span>
        </div>
        <div class="baseline-row__thumbs">
          ${((record && record.photos) || [])
            .slice(0, 3)
            .map((photo) => `<img src="${esc(store.photoThumbUrl(photo))}" alt="${esc(photo.caption || label)}" loading="lazy" decoding="async">`)
            .join('')}
        </div>
        <label class="link-btn baseline-row__add">
          사진 추가
          <input type="file" accept="image/*" multiple hidden data-baseline-input="${key}" data-site-id="${esc(site.id)}">
        </label>
      </div>`;
    return `
      <div class="baseline-admin">
        ${stage('quote', '① 첫 견적 · 오염 상태', baseline.quote)}
        ${stage('deepClean', '② 첫 청소 · 대청소', baseline.deepClean)}
      </div>`;
  }

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

        ${
          site.bizNumber || site.ceoName || site.taxEmail
            ? `<p class="site-biz">사업자 ${esc(site.bizNumber || '-')} · 대표 ${esc(site.ceoName || '-')}${site.taxEmail ? ` · 세금계산서 ${esc(site.taxEmail)}` : ''}</p>`
            : ''
        }

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

  /* ---------------- new site ---------------- */

  async function appendBaselinePhotos(siteId, stage, files) {
    const site = await store.getSite(siteId);
    if (!site) return;
    const existing = (site.baseline && site.baseline[stage] && site.baseline[stage].photos) || [];
    const added = [];
    for (const file of Array.from(files || [])) {
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
    for (const file of list) {
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

  async function onChange(event) {
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

  /* ---------------- events ---------------- */

  async function onSubmit(event) {
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
    container.addEventListener('change', onChange);
    mounted = true;
  }

  return { render };
}
