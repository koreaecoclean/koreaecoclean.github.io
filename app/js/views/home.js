/**
 * views/home.js — 홈 · 상담
 * Brand summary, four service categories, and the visit-estimate request form.
 */

import { $, esc, icons, isKoreanPhone, toast, fmtDateLong, fmtTime, toISODate } from '../ui.js';
import { store } from '../store.js';
import { CATEGORY_META } from '../seed.js';

export const BRAND = {
  name: '코리아 에코크린',
  ceo: '채종병',
  phone: '0507-1317-8369',
  phoneDigits: '050713178369',
  email: 'koreaecoclean@naver.com',
  address: '서울특별시 양천구 남부순환로36길 30, 1층 B01호 상가(신월동)',
  bizNumber: '281-46-00169',
  since: '2016',
};

const SERVICES = [
  {
    key: 'office',
    title: '사무실 정기청소',
    blurb: '업무 시간에 지장 없이, 매일 쌓이는 먼지까지',
    tags: ['책상 · 모니터 주변', '회의실', '탕비실'],
    scope: '책상·모니터 주변 먼지, 회의실·교육장, 탕비실·정수기 주변, 공용 화장실, 바닥·카펫·계단',
    cycle: '매일 ~ 주 1회 (사용 인원과 오염도에 맞춰 조정)',
    method: '출근 전이나 퇴근 후, 업무에 방해가 없는 시간대에 진행합니다.',
  },
  {
    key: 'clinic',
    title: '병원 · 클리닉 청소',
    blurb: '진료 전 마무리, 접촉부까지 높은 위생 기준',
    tags: ['진료실 · 시술실', '대기 라운지', '파우더룸'],
    scope: '진료실·시술실, 대기 라운지, 파우더룸·화장실, 손잡이·스위치·문고리 등 접촉부, 바닥 소독',
    cycle: '매일 ~ 주 2회 (진료 일정에 맞춰 조정)',
    method: '진료 시작 전 마무리하고, 사용 중인 공간은 동선을 피해 순차적으로 진행합니다.',
  },
  {
    key: 'retail',
    title: '상가 · 매장 · 식당 청소',
    blurb: '영업 전후 시간에 맞춘 홀·주방 관리',
    tags: ['홀 · 바닥', '유리 · 거울', '주방 트렌치'],
    scope: '홀·바닥(타일 박리 세척 포함), 유리·거울, 주방 트렌치·그리스트랩, 화장실, 테이블·의자',
    cycle: '매일 ~ 주 2회 · 바닥 박리 세척은 상태를 보고 별도 제안',
    method: '영업 전이나 마감 후에 진행하고, 냄새와 잔여물이 남지 않도록 마무리합니다.',
  },
  {
    key: 'fitness',
    title: '헬스장 · 사우나 · 공용부',
    blurb: '땀과 습기, 냄새까지 잡는 배수구 관리',
    tags: ['운동기구 존', '매트 · 거울', '샤워실 배수구'],
    scope: '운동기구 존과 매트, 거울, 샤워실·배수구, 탈의실·사물함, 건물 계단·엘리베이터·주차장',
    cycle: '매일 ~ 주 2회 (이용 인원에 맞춰 조정)',
    method: '이용객이 적은 시간대에 진행하고, 물때와 냄새가 남지 않도록 배수구까지 확인합니다.',
  },
];

const STRENGTHS = [
  { title: '하청 없는 대표 직접 관리', body: '견적과 현장 확인을 대표가 직접 하고, 부부팀·전문팀이 계속 관리합니다.' },
  { title: '17년 경력 · 4개 분야 1급', body: '집합건물·청소전문·냉난방기·부동산자산관리 1급, 2급 방화관리사 보유.' },
  { title: '100% 친환경 약품', body: '사람이 오래 머무는 공간이라 잔여물과 냄새까지 마무리합니다.' },
];

const STEPS = [
  { title: '전화 · 예약 상담', body: '공간의 종류와 규모, 원하시는 관리를 먼저 듣습니다.' },
  { title: '현장 확인 · 견적', body: '직접 확인한 뒤 필요한 범위로 정확한 견적을 드립니다.' },
  { title: '관리 계획 수립', body: '업무·영업 시간에 지장이 없도록 주기와 시간을 정합니다.' },
  { title: '정기 관리 · 점검', body: '정해진 항목과 주기로 관리하고, 현장 기록으로 상태를 확인합니다.' },
];

const SPACE_TYPES = ['사무실', '병원 · 클리닉', '상가 · 매장 · 식당', '헬스장 · 사우나 · 공용부', '기타'];
const DISTRICTS = ['양천구', '강서구', '구로구', '마포구', '금천구', '영등포구', '광명', '그 외 수도권'];
const FREQUENCIES = ['매일', '주 3회', '주 2회', '주 1회', '격주 1회', '상담 후 결정'];
const TIME_WINDOWS = ['업무 시작 전 (06~09시)', '업무 시간 외 (18시 이후)', '주말 · 공휴일', '협의 가능'];

function serviceTemplate(service) {
  const meta = CATEGORY_META[service.key] || {};
  return `
    <details class="svc">
      <summary>
        <span class="svc__icon" aria-hidden="true">${icons[meta.icon] || icons.office}</span>
        <span class="svc__head">
          <strong>${esc(service.title)}</strong>
          <span>${esc(service.blurb)}</span>
        </span>
        <span class="svc__caret" aria-hidden="true"></span>
      </summary>
      <div class="svc__body">
        <div class="chips">
          ${service.tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join('')}
        </div>
        <dl class="spec">
          <div><dt>작업 범위</dt><dd>${esc(service.scope)}</dd></div>
          <div><dt>추천 주기</dt><dd>${esc(service.cycle)}</dd></div>
          <div><dt>진행 방식</dt><dd>${esc(service.method)}</dd></div>
        </dl>
      </div>
    </details>
  `;
}

function optionsTemplate(list, selected) {
  return list
    .map((item) => `<option value="${esc(item)}"${item === selected ? ' selected' : ''}>${esc(item)}</option>`)
    .join('');
}

function formTemplate() {
  return `
    <form class="form" id="consult-form" novalidate>
      <div class="form-grid">
        <div class="field">
          <label for="c-space">공간 유형 <span class="req">*</span></label>
          <select class="select" id="c-space" name="spaceType" required>
            ${optionsTemplate(SPACE_TYPES, SPACE_TYPES[0])}
          </select>
        </div>
        <div class="field">
          <label for="c-district">지역</label>
          <select class="select" id="c-district" name="district">
            ${optionsTemplate(DISTRICTS, DISTRICTS[0])}
          </select>
        </div>
      </div>

      <div class="form-grid">
        <div class="field">
          <label for="c-size">규모</label>
          <input class="input" id="c-size" name="size" type="text" inputmode="numeric" placeholder="예: 30평 / 120㎡" autocomplete="off">
        </div>
        <div class="field">
          <label for="c-frequency">희망 주기</label>
          <select class="select" id="c-frequency" name="frequency">
            ${optionsTemplate(FREQUENCIES, '주 2회')}
          </select>
        </div>
      </div>

      <div class="field">
        <label for="c-time">희망 시간대</label>
        <select class="select" id="c-time" name="timeWindow">
          ${optionsTemplate(TIME_WINDOWS, TIME_WINDOWS[0])}
        </select>
      </div>

      <div class="field" id="c-phone-field">
        <label for="c-phone">연락처 <span class="req">*</span></label>
        <input class="input" id="c-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="010-0000-0000" required>
        <span class="field__hint">상담 시간을 정해 연락드립니다.</span>
      </div>

      <div class="field">
        <label for="c-memo">메모 (선택)</label>
        <textarea class="textarea" id="c-memo" name="memo" rows="3" placeholder="예: 화장실 2곳, 주방 배수구 냄새가 고민입니다."></textarea>
      </div>

      <div class="summary-box">
        <div class="summary-box__label">
          <span>문자로 보낼 내용</span>
          <button type="button" class="sort-btn" data-action="copy-consult">복사</button>
        </div>
        <pre id="consult-summary"></pre>
      </div>

      <div class="btn-row">
        <button class="btn btn--primary" type="submit" id="consult-send">문자로 상담 신청</button>
        <a class="btn btn--ghost" href="tel:${BRAND.phoneDigits}" data-action="call">전화하기</a>
      </div>
      <p class="hint">
        ‘문자로 상담 신청’을 누르면 문자 앱이 열리고 내용이 그대로 담깁니다.
        문자 앱이 열리지 않으면 복사한 뒤 ${esc(BRAND.phone)}로 보내 주세요.
        적으신 내용은 이 기기에만 보관되며 외부 서버로 전송되지 않습니다.
      </p>
    </form>
  `;
}

export function createHomeView(container) {
  let mounted = false;
  let lastMessage = '';

  function currentValues() {
    const form = $('#consult-form', container);
    if (!form) return null;
    return {
      spaceType: $('#c-space', form).value,
      district: $('#c-district', form).value,
      size: $('#c-size', form).value.trim(),
      frequency: $('#c-frequency', form).value,
      timeWindow: $('#c-time', form).value,
      phone: $('#c-phone', form).value.trim(),
      memo: $('#c-memo', form).value.trim(),
    };
  }

  function buildMessage(values) {
    return [
      '[코리아 에코크린 방문견적 상담]',
      `공간 유형: ${values.spaceType}`,
      `지역: ${values.district}`,
      `규모: ${values.size || '-'}`,
      `희망 주기: ${values.frequency}`,
      `희망 시간대: ${values.timeWindow}`,
      `연락처: ${values.phone || '-'}`,
      `메모: ${values.memo || '-'}`,
    ].join('\n');
  }

  function refreshSummary() {
    const values = currentValues();
    if (!values) return;
    lastMessage = buildMessage(values);
    const target = $('#consult-summary', container);
    if (target) target.textContent = lastMessage;
  }

  async function refreshInquiries() {
    const box = $('#recent-inquiries', container);
    if (!box) return;
    const rows = await store.listInquiries(3);
    if (!rows.length) {
      box.innerHTML = '';
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.innerHTML = `
      <div class="section-head" style="margin-bottom:8px">
        <h2 style="font-size:13px">최근 상담 신청</h2>
        <p>이 기기에 저장됨</p>
      </div>
      ${rows
        .map(
          (row) => `
            <div class="my-report">
              <div>
                <strong>${esc(row.spaceType)} · ${esc(row.district)}</strong>
                <span>${esc(fmtDateLong(toISODate(new Date(row.createdAt))))} ${esc(fmtTime(row.createdAt.slice(11, 16)))}</span>
              </div>
              <span class="badge">이 기기에 기록</span>
            </div>`,
        )
        .join('')}
    `;
  }

  async function onSubmit(event) {
    event.preventDefault();
    const values = currentValues();
    if (!values) return;

    const phoneField = $('#c-phone-field', container);
    phoneField.classList.remove('field--error');
    const oldError = $('.field__error', phoneField);
    if (oldError) oldError.remove();

    if (!isKoreanPhone(values.phone)) {
      phoneField.classList.add('field--error');
      const error = document.createElement('span');
      error.className = 'field__error';
      error.textContent = '연락 가능한 번호를 정확히 입력해 주세요.';
      phoneField.appendChild(error);
      $('#c-phone', container).focus();
      return;
    }

    const message = buildMessage(values);
    try {
      await store.addInquiry({ ...values, message });
    } catch (error) {
      console.warn('[home] inquiry save failed', error);
    }

    refreshInquiries();
    toast('문자 앱을 여는 중입니다. 내용을 확인하고 전송해 주세요.', {
      actionLabel: '복사',
      onAction: async () => {
        const ok = await navigator.clipboard?.writeText(message).then(() => true).catch(() => false);
        toast(ok ? '상담 내용을 복사했습니다.' : '복사가 차단되었습니다. 내용을 직접 선택해 주세요.');
      },
    });

    window.location.href = `sms:${BRAND.phoneDigits}?&body=${encodeURIComponent(message)}`;
  }

  async function onClick(event) {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'call') return; // plain tel: link
    if (action === 'copy-consult') {
      refreshSummary();
      const ok = await navigator.clipboard?.writeText(lastMessage).then(() => true).catch(() => false);
      toast(ok ? '상담 내용을 복사했습니다.' : '자동 복사가 차단되어 있습니다. 내용을 길게 눌러 복사해 주세요.');
      return;
    }
    if (action === 'open-customer') {
      document.dispatchEvent(new CustomEvent('kec:navigate', { detail: { tab: 'customer' } }));
      return;
    }
    if (action === 'open-leader') {
      document.dispatchEvent(new CustomEvent('kec:navigate', { detail: { tab: 'leader' } }));
      return;
    }
  }

  function mount() {
    if (mounted) return;
    container.addEventListener('submit', onSubmit);
    container.addEventListener('input', refreshSummary);
    container.addEventListener('change', refreshSummary);
    container.addEventListener('click', onClick);
    mounted = true;
  }

  async function render() {
    mount();
    container.innerHTML = `
      <section class="hero">
        <span class="hero__eyebrow">${icons.sparkle} SINCE ${BRAND.since} · 양천구 · 강서구 · 구로구</span>
        <h1>매일의 공간을,<br><em>17년의 기준</em>으로.</h1>
        <p>사무실과 병원, 상가와 헬스장. 사람이 하루의 대부분을 보내는 공간을 정기적으로 관리합니다.</p>
        <div class="hero__stats">
          <div class="hero__stat"><strong>17년</strong><span>현장 경력</span></div>
          <div class="hero__stat"><strong>4개 분야</strong><span>1급 자격</span></div>
          <div class="hero__stat"><strong>100%</strong><span>친환경 약품</span></div>
        </div>
        <div class="hero__actions">
          <a class="btn btn--primary" href="#consult">방문견적 상담</a>
          <a class="btn btn--ghost" href="tel:${BRAND.phoneDigits}">${icons.phone} 전화</a>
        </div>
      </section>

      <section class="panel">
        <div class="section-head">
          <h2>이미 계약하셨나요?</h2>
          <p>전용 방 입장</p>
        </div>
        <p class="tiny muted" style="margin-bottom:12px">
          고객은 계약 시 안내받은 <strong>전화번호 · 비밀번호</strong>와 대표가 발급한 <strong>1회용 청소코드</strong>로
          우리 현장 전용 방에 입장합니다. 방에는 그 현장의 청소 완료 보고만 표시됩니다.
        </p>
        <div class="btn-row btn-row--stack">
          <button class="btn btn--primary" type="button" data-action="open-customer">
            ${icons.clipboard} 고객 로그인 · 청소 기록 보기
          </button>
          <button class="btn btn--ghost" type="button" data-action="open-leader">
            ${icons.camera} 팀장 로그인 · 현장 보고
          </button>
        </div>
        <p class="hint" style="margin-top:10px">
          데모 계정은 로그인 화면의 ‘데모 계정 보기’에서 확인할 수 있습니다. (고객 010-2200-1042 / ecoclean)
        </p>
      </section>

      <section>
        <div class="section-head">
          <h2>왜 코리아 에코크린인가</h2>
        </div>
        <div class="panel" style="display:flex;flex-direction:column;gap:12px">
          ${STRENGTHS.map(
            (item) => `
              <div>
                <strong style="display:block;font-size:13.5px;letter-spacing:-.01em">${esc(item.title)}</strong>
                <span class="tiny muted">${esc(item.body)}</span>
              </div>`,
          ).join('<div class="divider" style="margin:0"></div>')}
        </div>
      </section>

      <section>
        <div class="section-head">
          <h2>업종에 맞춘 네 가지 정기청소</h2>
          <p>카드를 눌러 펼치기</p>
        </div>
        <div class="svc-list">
          ${SERVICES.map(serviceTemplate).join('')}
        </div>
      </section>

      <section class="panel">
        <div class="section-head">
          <h2>상담부터 관리까지</h2>
        </div>
        <div class="steps">
          ${STEPS.map(
            (step, index) => `
              <div class="step">
                <span class="step__num">${index + 1}</span>
                <div>
                  <strong>${esc(step.title)}</strong>
                  <span>${esc(step.body)}</span>
                </div>
              </div>`,
          ).join('')}
        </div>
      </section>

      <section class="panel" id="consult">
        <div class="section-head">
          <h2>방문견적 · 예약 상담</h2>
        </div>
        <p class="tiny muted" style="margin:-4px 0 14px">
          상담 후 1년 정기청소 계약을 체결하시면 대청소를 무료로 진행해 드립니다. 방문견적 상담은 무료입니다.
        </p>
        ${formTemplate()}
      </section>

      <section id="recent-inquiries" hidden></section>

      <section class="panel">
        <div class="section-head">
          <h2>사업장 안내</h2>
        </div>
        <dl class="contact-list">
          <div class="contact-row"><dt>상호</dt><dd>${esc(BRAND.name)}</dd></div>
          <div class="contact-row"><dt>대표</dt><dd>${esc(BRAND.ceo)}</dd></div>
          <div class="contact-row"><dt>전화</dt><dd><a href="tel:${BRAND.phoneDigits}">${esc(BRAND.phone)}</a></dd></div>
          <div class="contact-row"><dt>이메일</dt><dd><a href="mailto:${BRAND.email}">${esc(BRAND.email)}</a></dd></div>
          <div class="contact-row"><dt>주소</dt><dd>${esc(BRAND.address)}</dd></div>
          <div class="contact-row"><dt>사업자번호</dt><dd>${esc(BRAND.bizNumber)}</dd></div>
        </dl>
        <div class="btn-row btn-row--stack" style="margin-top:14px">
          <a class="btn btn--quiet" href="https://map.naver.com/p/search/${encodeURIComponent(BRAND.address)}" target="_blank" rel="noopener noreferrer">지도에서 보기</a>
        </div>
      </section>

      <p class="footer-note">
        코리아 에코크린 · 대표 ${esc(BRAND.ceo)} · ${esc(BRAND.phone)}<br>
        서울 양천구 · 강서구 · 구로구 · 마포구 · 금천구 · 영등포구 · 경기 광명
      </p>
    `;

    refreshSummary();
    await refreshInquiries();
  }

  return { render, refresh: refreshInquiries };
}
