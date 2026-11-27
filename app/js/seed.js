/**
 * seed.js — demo content for the app.
 *
 * Brand facts (name, phone, address, credentials, services) come from the
 * official site. Client sites, people, phone numbers and passwords are
 * fictional demo data. Demo dates are generated relative to "today".
 *
 * Demo credentials are also listed in README.md and shown in the app's
 * "데모 계정" panel.
 */

export const SEED_VERSION = 11;

/** 앱 공개 주소 — 초대 문구에 들어갑니다. */
export const APP_URL = 'https://koreaecoclean.github.io/app/';

/** 공급자(을) 정보 — 견적서 · 도급 계약서에 그대로 인쇄됩니다. */
export const SUPPLIER = {
  name: '코리아 에코크린(KOREA ECO CLEAN)',
  nameKo: '코리아 에코크린',
  bizNumber: '281-46-00169',
  ceo: '채종병',
  phone: '0507-1317-8369',
  email: 'koreaecoclean@naver.com',
  address: '서울시 양천구 남부순환로36길 30, 1층 B01호 상가(신월동)',
  upjong: '서비스업',
  jongmok: '청소대행업',
};

/** 결제 계좌 — 대표 지시(2026-11-26)로 우리은행에서 카카오뱅크로 변경. */
export const PAYMENT_ACCOUNT = {
  bankName: '카카오뱅크',
  accountNumber: '3333-15-4406523',
  holder: '채종병(코리아 에코크린)',
};

/** 견적 유효기간 기본값(일). */
export const QUOTE_VALID_DAYS = 30;

/**
 * 영수증에 인쇄되는 발행자 정보 — 첨부된 직원 청소도구 구입 영수증 사진과 같은 표기.
 * (SUPPLIER 주소는 상가 표기가 붙어 있어 영수증에는 이 값을 씁니다.)
 */
export const RECEIPT_ISSUER = {
  name: '코리아에코크린',
  ceo: '채종병',
  bizNumber: '281-46-00169',
  address: '서울 양천구 남부순환로36길 30, 1층 B01호',
  phone: '0507-1317-8369',
  subtitle: '직원 청소도구 구입',
};

/** 청소장비 · 배접봉투 구입 품목 구분. */
export const SUPPLY_GROUPS = {
  equipment: { label: '청소장비', short: '장비' },
  bag: { label: '배접봉투', short: '봉투' },
};

/** 직원 계약 3종 — 프리랜서(3.3%) · 도급(하도급) · 일용직. */
export const STAFF_TYPES = {
  freelancer: {
    label: '프리랜서 업무위수탁 계약서',
    short: '프리랜서(3.3%)',
    badge: 'badge--wait',
    amountLabel: '월 정산금액',
  },
  contract: {
    label: '도급(하도급) 계약서',
    short: '도급',
    badge: 'badge--done',
    amountLabel: '월 도급금액',
  },
  daily: {
    label: '일용직 근로계약서',
    short: '일용직',
    badge: 'badge--done',
    amountLabel: '일당',
  },
  parttime: {
    label: '아르바이트 근로계약서',
    short: '알바',
    badge: 'badge--done',
    amountLabel: '시급',
  },
};

/** The three required photo categories for every site report. */
export const PHOTO_GROUPS = [
  {
    key: 'security',
    label: '시건장치 확인',
    short: '시건장치',
    hint: '출입문 잠금장치 · 손잡이 상태',
    required: true,
  },
  {
    key: 'cleaning',
    label: '업장별 맞춤 청소',
    short: '맞춤 청소',
    hint: '업종에 맞춘 청소 결과',
    required: true,
    /** 업장별 맞춤 청소 결과는 한 번 보고에 최대 50장까지. */
    max: 50,
  },
  {
    key: 'issue',
    label: '특이사항',
    short: '특이사항',
    hint: '새로 발생한 문제 (선택)',
    required: false,
  },
];

export const CATEGORY_META = {
  office: {
    label: '사무실 정기청소',
    short: '사무실',
    icon: 'office',
    blurb: '업무 시간에 지장 없이, 매일 쌓이는 먼지까지',
    cleaningLabel: '사무실 맞춤 청소',
  },
  clinic: {
    label: '병원 · 클리닉 청소',
    short: '병원·클리닉',
    icon: 'clinic',
    blurb: '진료 전 마무리, 접촉부까지 높은 위생 기준',
    cleaningLabel: '병원 맞춤 청소',
  },
  retail: {
    label: '상가 · 매장 · 식당 청소',
    short: '상가·매장',
    icon: 'retail',
    blurb: '영업 전후 시간에 맞춘 홀·주방 관리',
    cleaningLabel: '매장 맞춤 청소',
  },
  fitness: {
    label: '헬스장 · 사우나 · 공용부',
    short: '헬스장·공용부',
    icon: 'fitness',
    blurb: '땀과 습기, 냄새까지 잡는 배수구 관리',
    cleaningLabel: '헬스장 맞춤 청소',
  },
};

/**
 * 패스트파이브 강남3호점 매뉴얼 구조판. 구역·항목 구성이 바뀔 때마다 올리면,
 * 이미 저장된 기기·서버(store.js _migrateSiteManuals)도 같은 매뉴얼로 맞춰집니다.
 */
export const FASTFIVE_MANUAL_REVISION = 2;

/** M/D 표기 (예: 11/27, 12/4). */
function monthDay(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * 금요일 냉장고 케어 기준 날짜.
 *  - base   : 케어하는 금요일 (오늘이 금요일이면 오늘, 아니면 다가오는 금요일)
 *  - white  : 흰색 스티커 기준일 (금요일 −2일 = 수요일)
 *  - next   : 노란색 스티커를 새로 붙이는 다음 케어 금요일 (+7일)
 * 2026-11-27 케어에서는 11/27 · 11/25 · 12/4 가 나옵니다.
 */
export function fridgeCareDates(now = new Date()) {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  base.setDate(base.getDate() + ((5 - base.getDay() + 7) % 7));
  const white = new Date(base);
  white.setDate(white.getDate() - 2);
  const next = new Date(base);
  next.setDate(next.getDate() + 7);
  return {
    fridayISO: toISO(base),
    friday: monthDay(base),
    white: monthDay(white),
    next: monthDay(next),
  };
}

/**
 * 패스트파이브 강남3호점 — 주 5회(월~금) 사무실 정기청소.
 * 2026-11-27 대표 요청: 월·수·금 **다이닝룸 청소를 별도 구역으로** 빼고,
 * 금요일에 **냉장고 케어**(매주 금요일 새벽 · 스티커 색 교체)를 따로 둡니다.
 *  · 주 1회 비움 : 그날 비우는 층 · 호실
 *  · 바닥 청소   : 사무실 + 공용부를 밀대로 진행하는 구역
 *  · 다이닝룸 청소 : 바닥 청소와 섞지 않고 따로 체크하는 구역
 *  · 냉장고 케어 : 스티커 날짜는 케어하는 금요일 기준으로 매주 자동 계산
 */
export function buildFastfiveManual(now = new Date()) {
  const fridge = fridgeCareDates(now);
  const extraEmpty = () => ({ label: '추가 비움', floors: '', items: ['추가 비움 있을 경우 (호실 별도 사진 공유)'] });
  const weeklyEmpty = (label) => ({ label: '주 1회 비움', floors: '', items: [label] });
  const floorCare = (label) => ({ label: '바닥 청소', floors: '사무실+공용부 = 밀대 진행', items: [label] });
  const dining = (label, floors = '') => ({ label: '다이닝룸 청소', floors, items: [label] });

  return {
    revision: FASTFIVE_MANUAL_REVISION,
    fridgeWeek: fridge.fridayISO,
    time: '',
    timeNote: '',
    days: [
      {
        key: 'mon',
        label: '월',
        areas: [
          extraEmpty(),
          weeklyEmpty('4층 (401호~435호)'),
          floorCare('4층 (401호~435호)'),
          dining('4층 다이닝룸 바닥 케어', '4층'),
        ],
      },
      {
        key: 'tue',
        label: '화',
        areas: [extraEmpty(), weeklyEmpty('5층 (501~535호)'), floorCare('5층 (501~535호)')],
      },
      {
        key: 'wed',
        label: '수',
        areas: [
          extraEmpty(),
          weeklyEmpty('5층 (536~553호), 6층 (601~616호)'),
          floorCare('5층 (536~553호), 6층 (601~616호)'),
          dining('다이닝룸 바닥 청소'),
        ],
      },
      {
        key: 'thu',
        label: '목',
        areas: [
          extraEmpty(),
          weeklyEmpty('6층 (617~638호), 7층 (701~713호)'),
          floorCare('6층 (617~638호), 7층 (701~713호) / 스튜디오 케어'),
        ],
      },
      {
        key: 'fri',
        label: '금',
        areas: [
          extraEmpty(),
          weeklyEmpty('7층 (714~743호)'),
          floorCare('7층 (714~743호)'),
          dining('다이닝룸 바닥 청소'),
          {
            label: '냉장고 케어',
            floors: '매주 금요일 새벽 케어',
            items: [
              `노란색 스티커 ${fridge.friday} → 스티커 부착 X / 사진 공유만`,
              `흰색 스티커 ~${fridge.white} → 노란색 스티커에 ${fridge.next} 부착`,
              `아무것도 안 붙어있으면 → 흰색 스티커 ${fridge.friday} 부착`,
            ],
          },
        ],
      },
    ],
  };
}

/**
 * 청소공정 매뉴얼 — 첨부 작업표 원본 그대로.
 *  - time / timeNote : 청소 가능 시간
 *  - days[]          : 요일별 작업표 (주 7일 동일한 현장은 하루짜리 '매일')
 *  - days[].areas[]  : 구역(사무실·화장실·계단·주방·홀·다이닝룸·냉장고)과 작업 항목
 * 팀장 · 부장의 현장 보고 화면이 이 값으로 체크리스트를 그립니다.
 */
export const CLEANING_MANUALS = {
  site_cheongnyangni_dongbang: {
    time: '20:00 ~ 07:00',
    timeNote: '오후 8시 이후 ~ 익일 오전 7시 이전',
    days: [
      {
        key: 'mon',
        label: '월',
        areas: [
          { label: '사무실 청소', floors: '2~5층', items: ['쓰레기 비우기', '바닥 청소', '세절기 비우기 (2·4층)'] },
          { label: '화장실 청소', floors: '2~5층', items: ['쓰레기 비우기', '바닥 청소', '세면대 청소', '소변기 · 양변기 청소'] },
          { label: '계단 청소', floors: '1~5층 · 지하층 계단 제외', items: ['계단 청소'] },
        ],
      },
      {
        key: 'wed',
        label: '수',
        areas: [
          { label: '사무실 청소', floors: '2·4층', items: ['쓰레기 비우기', '바닥 청소', '세절기 비우기'] },
          { label: '화장실 청소', floors: '2·4층', items: ['쓰레기 비우기', '바닥 청소', '세면대 청소', '소변기 · 양변기 청소'] },
          { label: '계단 청소', floors: '1~2층 · 지하층 계단 제외', items: ['계단 청소'] },
        ],
      },
      {
        key: 'fri',
        label: '금',
        areas: [
          { label: '사무실 청소', floors: '2·4층', items: ['쓰레기 비우기', '바닥 청소', '세절기 비우기'] },
          { label: '화장실 청소', floors: '2·4층', items: ['쓰레기 비우기', '바닥 청소', '세면대 청소', '소변기 · 양변기 청소'] },
          { label: '계단 청소', floors: '1~2층 · 지하층 계단 제외', items: ['계단 청소'] },
        ],
      },
    ],
  },
  site_cheongnyangni_marugame: {
    time: '22:30 ~ 05:30',
    timeNote: '오후 10시 30분 이후 ~ 익일 오전 5시 30분 이전',
    days: [
      {
        key: 'daily',
        label: '매일',
        areas: [
          { label: '주방 청소', floors: '', items: ['쓰레기통 비우기', '직원실 바닥 청소', '주방 바닥 청소', '집수정 청소'] },
          { label: '홀 청소', floors: '', items: ['바닥 건식 청소', '바닥 습식 청소'] },
        ],
      },
    ],
  },
  /** 패스트파이브 강남3호점 — 월·수·금 다이닝룸 분리 + 금요일 냉장고 케어 (buildFastfiveManual). */
  site_fastfive_gangnam3: buildFastfiveManual(),
};

export const DEFAULT_CHECKLISTS = {
  office: [
    '책상 · 모니터 주변 먼지 제거',
    '회의실 · 교육장 정리 및 바닥',
    '탕비실 · 정수기 주변',
    '공용 화장실 세정 · 소독',
    '바닥 · 카펫 흡입',
    '계단 · 출입구 유리',
  ],
  clinic: [
    '진료실 · 시술실 바닥 소독',
    '대기 라운지 정리',
    '파우더룸 · 화장실 세정',
    '손잡이 · 스위치 · 문고리 소독',
    '의료 폐기물 수거 · 교체',
    '현관 유리 · 출입문',
  ],
  retail: [
    '홀 · 바닥 청소',
    '유리 · 거울 물때 제거',
    '주방 트렌치 · 그리스트랩',
    '테이블 · 의자 정리',
    '화장실 세정',
    '입구 매트 · 외곽',
  ],
  fitness: [
    '운동기구 존 · 매트 소독',
    '거울 물때 제거',
    '샤워실 · 배수구',
    '탈의실 · 사물함',
    '화장실 세정',
    '계단 · 엘리베이터',
  ],
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function toISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysAgo(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return toISO(date);
}

function daysAgoISO(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

/** 'YYYY-MM-DD' + 개월 (말일은 해당 월 말일로 맞춥니다). */
export function addMonthsISO(iso, months) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const target = new Date(y, (m || 1) - 1 + (Number(months) || 0), 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, lastDay));
  return toISO(target);
}

/** 'YYYY-MM-DD' + 일수. */
export function addDaysISO(iso, days) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const date = new Date(y, m - 1, d + (Number(days) || 0));
  return toISO(date);
}

/** '주 2회 (화 · 금)' → 3 (방문 간격 일수). 알 수 없으면 7. */
export function intervalFromFrequency(text) {
  const match = String(text || '').match(/주\s*([1-7])\s*회/);
  if (!match) return 7;
  return Math.max(1, Math.round(7 / Number(match[1])));
}

const PHOTO_BOX = {
  'photo-1-office': [863, 1000],
  'photo-2-meeting': [863, 1000],
  'photo-3-clinic': [815, 1000],
  'photo-4-clinic-lounge': [815, 1000],
  'photo-5-gym': [815, 1000],
  'photo-6-lounge': [815, 1000],
  'photo-7-lounge': [863, 1000],
  'photo-lock': [750, 1000],
  'photo-issue': [750, 1000],
};

/** A seeded photo points at the bundled sample image instead of a data URL. */
function photo(name, caption) {
  const [width, height] = PHOTO_BOX[name] || [900, 1000];
  return {
    asset: `assets/samples/${name}.jpg`,
    thumbAsset: `assets/samples/thumbs/${name}.jpg`,
    caption,
    width,
    height,
  };
}

const P = {
  lock: (caption = '출입문 잠금장치 · 손잡이 확인') => photo('photo-lock', caption),
  issue: (caption) => photo('photo-issue', caption),
  office: () => photo('photo-1-office', '사무실 · 책상과 바닥'),
  meeting: () => photo('photo-2-meeting', '회의실 · 테이블과 바닥'),
  lounge6: () => photo('photo-6-lounge', '라운지 · 좌석과 바닥'),
  lounge7: () => photo('photo-7-lounge', '공용 라운지 · 홀 바닥'),
  clinic: () => photo('photo-3-clinic', '진료실 · 시술 베드'),
  clinicLounge: () => photo('photo-4-clinic-lounge', '대기 라운지'),
  gym: () => photo('photo-5-gym', '운동기구 존 · 바닥'),
  dirtyOffice: (caption = '첫 견적 · 바닥 오염 상태') => photo('photo-quote-office', caption),
  dirtyClinic: (caption = '첫 견적 · 대기실 오염 상태') => photo('photo-quote-clinic', caption),
  dirtyGym: (caption = '첫 견적 · 기구 · 바닥 오염 상태') => photo('photo-quote-fitness', caption),
};

/* ------------------------------------------------------------------ */
/* sites                                                               */
/* ------------------------------------------------------------------ */

/** 첫 상태 기록: ① 견적 시점(오염) → ② 대청소 직후. */
function baselineStage(date, note, photos) {
  return { date: date || '', note, photos: photos || [] };
}

export function buildSites() {
  return [
    {
      id: 'site_hangwoon_tower',
      code: 'EC-1042',
      name: '행운타워 5층 사무실',
      clientName: '행운물산(주)',
      category: 'office',
      address: '서울 양천구 남부순환로36길 30, 행운타워 5층',
      area: '약 95㎡ (29평)',
      frequency: '주 2회 (월 · 목)',
      intervalDays: 3,
      startDate: '2024-03-11',
      manager: '김미영',
      managerRole: '팀장',
      accessNote: '출근 전 07:00~08:30 · 관리실에서 출입카드 수령',
      contactName: '정하윤 총무',
      // 관리자 전용 계약 정보 (고객·팀장 화면에는 노출되지 않습니다)
      contract: {
        contractAmount: 2200000,
        subcontractAmount: 1430000,
        feeAmount: 110000,
        contractDate: '2024-03-04',
        billingDay: '매월 10일',
        note: '월 단위 청구 · 부가세 별도 · 주 2회(월·목)',
      },
      // 팀장(현장) 전용 운영 정보 (도급금액만 팀장에게 공개)
      ops: {
        process: '책상·모니터 먼지 → 회의실·교육장 → 탕비실·정수기 → 화장실 세정·소독 → 카펫 흡입 → 계단·출입구 유리',
        accessMethod: '출근 전 07:00~08:30 · 관리사무소에서 출입카드 수령 후 5층',
        trashLocation: '5층 화장실 옆 분리수거함 (일반 · 재활용)',
        parkingMethod: '지하 1층 방문 주차 30분 무료 · 관리사무소에 차량 번호 등록',
      },
      checklist: DEFAULT_CHECKLISTS.office,
      locked: true,
      baseline: {
        quote: baselineStage('2024-03-04', '첫 견적 방문 · 바닥 먼지와 사무용품 잡동사니가 쌓여 있었습니다.', [
          P.dirtyOffice('첫 견적 · 바닥 오염과 적치물'),
        ]),
        deepClean: baselineStage('2024-03-11', '첫 청소(대청소) 완료 · 책상·의자·바닥까지 정리했습니다.', [
          P.office(),
          P.meeting(),
        ]),
      },
    },
    {
      id: 'site_haneul_clinic',
      code: 'EC-2071',
      name: '하늘치과 신월점',
      clientName: '하늘치과의원',
      category: 'clinic',
      address: '서울 양천구 신월로 118, 3층',
      area: '약 120㎡ (36평)',
      frequency: '주 2회 (화 · 금)',
      intervalDays: 3,
      startDate: '2023-09-04',
      manager: '이정숙',
      managerRole: '팀장',
      accessNote: '진료 시작 전 07:30~09:00 · 데스크에서 열쇠 수령',
      contactName: '김소연 실장',
      contract: {
        contractAmount: 2700000,
        subcontractAmount: 1750000,
        feeAmount: 130000,
        contractDate: '2023-08-28',
        billingDay: '매월 5일',
        note: '월 단위 청구 · 부가세 별도 · 주 2회(화·금)',
      },
      ops: {
        process: '진료실·시술실 바닥 소독 → 대기 라운지 → 파우더룸·화장실 → 손잡이·스위치 소독 → 의료 폐기물 교체 → 현관 유리',
        accessMethod: '진료 시작 전 07:30~09:00 · 3층 데스크에서 열쇠 수령',
        trashLocation: '3층 계단 옆 의료 폐기물 보관함 · 일반 쓰레기는 건물 뒤 수거장',
        parkingMethod: '건물 뒤편 주차장 2시간 무료 · 데스크에 차량 번호 확인',
      },
      checklist: DEFAULT_CHECKLISTS.clinic,
      locked: true,
      baseline: {
        quote: baselineStage('2023-08-28', '첫 견적 · 대기실 바닥 얼룩과 먼지가 많았습니다.', [
          P.dirtyClinic('첫 견적 · 대기실 바닥 오염'),
        ]),
        deepClean: baselineStage('2023-09-04', '첫 청소(대청소) 완료 · 진료실·대기실 바닥 소독까지 마쳤습니다.', [
          P.clinic(),
          P.clinicLounge(),
        ]),
      },
    },
    {
      id: 'site_bodycamp',
      code: 'EC-3310',
      name: '바디캠프 피트니스',
      clientName: '바디캠프',
      category: 'fitness',
      address: '서울 강서구 공항대로 402, 지하 1층',
      area: '약 260㎡ (79평)',
      frequency: '주 3회 (월 · 수 · 금)',
      intervalDays: 2,
      startDate: '2025-01-06',
      manager: '채종병',
      managerRole: '대표',
      accessNote: '이용객이 적은 10:00~12:00 · 정문 비밀번호 출입',
      contactName: '박준호 관장',
      contract: {
        contractAmount: 4300000,
        subcontractAmount: 2900000,
        feeAmount: 210000,
        contractDate: '2024-12-30',
        billingDay: '매월 15일',
        note: '월 단위 청구 · 부가세 별도 · 주 3회(월·수·금)',
      },
      ops: {
        process: '운동기구 존·매트 소독 → 거울 물때 → 샤워실·배수구 → 탈의실·사물함 → 화장실 세정 → 계단·엘리베이터',
        accessMethod: '이용객이 적은 10:00~12:00 · 정문 비밀번호 출입 (비밀번호는 관장님 확인)',
        trashLocation: '지하 1층 엘리베이터 옆 방출구 · 재활용 분리 배출',
        parkingMethod: '건물 지하 2층 · 사장님 차량 등록 (10:00 이전 진입)',
      },
      checklist: DEFAULT_CHECKLISTS.fitness,
      locked: true,
      baseline: {
        quote: baselineStage('2024-12-30', '첫 견적 · 매트 먼지와 기구 주변 때가 누적되어 있었습니다.', [
          P.dirtyGym('첫 견적 · 기구 주변 오염'),
        ]),
        deepClean: baselineStage('2025-01-06', '첫 청소(대청소) 완료 · 매트·기구·배수구까지 정리했습니다.', [P.gym()]),
      },
    },
    {
      // 실제 고객사 — 사업자등록증(195-81-00480) 기준으로 등록한 현장.
      id: 'site_lighthouse',
      code: 'EC-4108',
      name: '(주) 라이트하우스코스메틱',
      clientName: '(주) 라이트하우스코스메틱',
      category: 'office',
      address: '서울특별시 마포구 양화로 108, 7층(서교동, 비금빌딩)',
      area: '',
      frequency: '주 1회 (일정 협의)',
      intervalDays: 7,
      startDate: daysAgo(0),
      manager: '박희승',
      managerRole: '본부장',
      accessNote: '첫 방문 일정 협의 중 · 7층 사무실',
      contactName: '신성민 대표',
      bizNumber: '195-81-00480',
      ceoName: '신성민, 윤한수',
      taxEmail: 'skltm0518@gmail.com',
      // 실제 계약 금액은 대표가 확인 후 입력합니다 (데모 값은 0원).
      contract: {
        contractAmount: 0,
        subcontractAmount: 0,
        feeAmount: 0,
        contractDate: '',
        billingDay: '협의 중',
        note: '실제 계약 금액 · 계약일은 대표 확인 후 입력',
      },
      ops: {
        process: '사무실 정기청소 (주 1회 · 일정 협의) — 책상 먼지 → 회의실 → 탕비실 → 화장실 → 바닥 → 유리',
        accessMethod: '서교동 비금빌딩 7층 · 출입 방식 확인 중 (첫 방문 시 담당자 안내)',
        trashLocation: '건물 지정 수거 위치 확인 중',
        parkingMethod: '건물 주차 안내 확인 중 (첫 방문 시 확인)',
      },
      checklist: DEFAULT_CHECKLISTS.office,
      locked: true,
      baseline: {
        quote: baselineStage('', '현장 방문 후 첫 견적 사진(오염 상태)을 등록해 주세요.', []),
        deepClean: baselineStage('', '첫 대청소 후 사진을 등록해 주세요.', []),
      },
    },
    {
      // 청량리 동방노보펌빌딩 — 도급 현장(이용구 부장 담당). 청소공정은 첨부 작업표 기준.
      id: 'site_cheongnyangni_dongbang',
      code: 'EC-5824',
      name: '청량리 동방노보펌빌딩 (사무실)',
      clientName: '동방노보펌빌딩',
      category: 'office',
      address: '',
      area: '',
      frequency: '주 3회 (월 · 수 · 금)',
      intervalDays: 2,
      startDate: daysAgo(0),
      manager: '이용구',
      managerRole: '부장',
      accessNote: '',
      contactName: '',
      bizNumber: '',
      ceoName: '',
      taxEmail: '',
      contract: {
        contractAmount: 0,
        subcontractAmount: 350000,
        feeAmount: 0,
        contractDate: daysAgo(0),
        billingDay: '익월 15일',
        note: '도급 현장 · 월 350,000원(부가세 별도) · 주 3회(월·수·금)',
      },
      ops: {
        process:
          '청소 가능 20:00~07:00 · 월: 사무실·화장실 2~5층 + 계단 1~5층 / 수·금: 사무실·화장실 2·4층 + 계단 1~2층 (지하층 계단 제외)',
        accessMethod: '',
        trashLocation: '',
        parkingMethod: '',
      },
      manual: CLEANING_MANUALS.site_cheongnyangni_dongbang,
      checklist: DEFAULT_CHECKLISTS.office,
      locked: true,
      annexHours: '30분',
      baseline: {
        quote: baselineStage('', '', []),
        deepClean: baselineStage('', '', []),
      },
    },
    {
      // 청량리 롯데몰 마루가메우동 — 도급 현장(이용구 부장 담당). 주 7일, 매일 같은 작업.
      id: 'site_cheongnyangni_marugame',
      code: 'EC-7149',
      name: '청량리 롯데몰 마루가메우동 (식당)',
      clientName: '마루가메우동',
      category: 'retail',
      address: '',
      area: '',
      frequency: '주 7회 (월 ~ 일)',
      intervalDays: 1,
      startDate: daysAgo(0),
      manager: '이용구',
      managerRole: '부장',
      accessNote: '',
      contactName: '',
      bizNumber: '',
      ceoName: '',
      taxEmail: '',
      contract: {
        contractAmount: 0,
        subcontractAmount: 1600000,
        feeAmount: 0,
        contractDate: daysAgo(0),
        billingDay: '익월 15일',
        note: '도급 현장 · 월 1,600,000원(부가세 별도) · 주 7회(월~일)',
      },
      ops: {
        process:
          '청소 가능 22:30~05:30 · 매일: 주방(쓰레기통·직원실·주방 바닥·집수정) + 홀(바닥 건식·습식)',
        accessMethod: '',
        trashLocation: '',
        parkingMethod: '',
      },
      manual: CLEANING_MANUALS.site_cheongnyangni_marugame,
      checklist: DEFAULT_CHECKLISTS.retail,
      locked: true,
      annexHours: '1시간 (2인 기준)',
      baseline: {
        quote: baselineStage('', '', []),
        deepClean: baselineStage('', '', []),
      },
    },
    {
      // 패스트파이브 강남3호점 — 도급 현장(이아름 팀장 담당). 주 5회(월~금), 요일별 층별 작업.
      id: 'site_fastfive_gangnam3',
      code: 'EC-8362',
      name: '패스트파이브 강남3호점',
      clientName: '패스트파이브',
      category: 'office',
      address: '',
      area: '',
      frequency: '주 5회 (월 ~ 금)',
      intervalDays: 1,
      startDate: daysAgo(0),
      manager: '이아름',
      managerRole: '팀장',
      accessNote: '',
      contactName: '',
      bizNumber: '',
      ceoName: '',
      taxEmail: '',
      contract: {
        contractAmount: 0,
        subcontractAmount: 1200000,
        feeAmount: 0,
        contractDate: daysAgo(0),
        billingDay: '익월 15일',
        note: '도급 현장 · 월 1,200,000원(부가세 별도) · 주 5회(월~금)',
      },
      ops: {
        process:
          '주 5회(월~금) · 월: 4층(401~435호) / 화: 5층(501~535호) / 수: 5층(536~553호)·6층(601~616호) / 목: 6층(617~638호)·7층(701~713호) / 금: 7층(714~743호) + 냉장고 케어(매주 금요일 새벽) · 추가 비움 발생 시 호실 별도 사진 공유',
        accessMethod: '',
        trashLocation: '',
        parkingMethod: '',
      },
      manual: CLEANING_MANUALS.site_fastfive_gangnam3,
      checklist: DEFAULT_CHECKLISTS.office,
      locked: true,
      baseline: {
        quote: baselineStage('', '', []),
        deepClean: baselineStage('', '', []),
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/* accounts                                                            */
/* ------------------------------------------------------------------ */

export const DEMO_ACCOUNTS = [
  {
    id: 'acc_customer_hangwoon',
    role: 'customer',
    name: '정하윤',
    title: '총무',
    phone: '01022001042',
    phonePretty: '010-2200-1042',
    password: 'ecoclean',
    siteId: 'site_hangwoon_tower',
    active: true,
  },
  {
    id: 'acc_customer_haneul',
    role: 'customer',
    name: '김소연',
    title: '실장',
    phone: '01022002071',
    phonePretty: '010-2200-2071',
    password: 'ecoclean',
    siteId: 'site_haneul_clinic',
    active: true,
  },
  {
    id: 'acc_customer_bodycamp',
    role: 'customer',
    name: '박준호',
    title: '관장',
    phone: '01022003310',
    phonePretty: '010-2200-3310',
    password: 'ecoclean',
    siteId: 'site_bodycamp',
    active: true,
  },
  {
    id: 'acc_leader_kim',
    role: 'leader',
    name: '김미영',
    title: '팀장',
    phone: '01033001042',
    phonePretty: '010-3300-1042',
    password: 'team1234',
    leaderCode: 'TL-4821',
    assignedSiteIds: ['site_hangwoon_tower'],
    active: true,
  },
  {
    id: 'acc_leader_lee',
    role: 'leader',
    name: '이정숙',
    title: '팀장',
    phone: '01033002071',
    phonePretty: '010-3300-2071',
    password: 'team1234',
    leaderCode: 'TL-7365',
    assignedSiteIds: ['site_haneul_clinic'],
    active: true,
  },
  {
    id: 'acc_leader_park',
    role: 'leader',
    name: '박희승',
    title: '본부장',
    phone: '01049941638',
    phonePretty: '010-4994-1638',
    password: 'team1234',
    leaderCode: 'TL-1638',
    assignedSiteIds: ['site_hangwoon_tower', 'site_haneul_clinic', 'site_bodycamp', 'site_lighthouse'],
    canManageStaff: true,
    active: true,
  },
  {
    // 청량리 동방노보펌빌딩 · 롯데몰 마루가메우동 담당 부장 (도급).
    id: 'acc_leader_younggu',
    role: 'leader',
    name: '이용구',
    title: '부장',
    phone: '01057883683',
    phonePretty: '010-5788-3683',
    password: 'team3683',
    leaderCode: 'TL-3941',
    assignedSiteIds: ['site_cheongnyangni_dongbang', 'site_cheongnyangni_marugame'],
    staffAccess: true,
    employmentType: 'contract',
    // 실제 직원 계정 — 공개 로그인 화면의 ‘데모 계정 보기’에는 올리지 않습니다.
    demoHidden: true,
    active: true,
  },
  {
    // 패스트파이브 강남3호점 담당 팀장 (도급). 비밀번호·고유코드는 대표 지시(2026-11-27)로
    // 전화번호와 무관한 값으로 만들었습니다.
    id: 'acc_leader_areum',
    role: 'leader',
    name: '이아름',
    title: '팀장',
    phone: '01099708492',
    phonePretty: '010-9970-8492',
    password: 'clean5827',
    leaderCode: 'TL-5163',
    assignedSiteIds: ['site_fastfive_gangnam3'],
    staffAccess: true,
    employmentType: 'contract',
    demoHidden: true,
    active: true,
  },
  {
    id: 'acc_admin_ceo',
    role: 'admin',
    name: '채종병',
    title: '대표',
    phone: '01099008369',
    phonePretty: '010-9900-8369',
    password: 'ceo2016',
    leaderCode: 'TL-2016',
    assignedSiteIds: ['site_hangwoon_tower', 'site_haneul_clinic', 'site_bodycamp', 'site_lighthouse'],
    active: true,
  },
];

export function buildAccounts() {
  return DEMO_ACCOUNTS.map((account) => ({
    ...account,
    assignedSiteIds: account.assignedSiteIds ? account.assignedSiteIds.slice() : [],
    createdAt: daysAgoISO(120),
  }));
}

/**
 * Demo customer accounts already hold their room access, so an existing client
 * only needs to type the phone number that was registered for the site.
 */
export function buildGrants() {
  return DEMO_ACCOUNTS.filter((account) => account.role === 'customer' && account.siteId).map((account) => ({
    id: `${account.id}::${account.siteId}`,
    accountId: account.id,
    siteId: account.siteId,
    codeId: '',
    createdAt: daysAgoISO(120),
    source: 'seed',
  }));
}

/* ------------------------------------------------------------------ */
/* one-time cleaning codes                                             */
/* ------------------------------------------------------------------ */

export function buildRoomCodes() {
  return [
    {
      id: 'rc_hangwoon_unused',
      siteId: 'site_hangwoon_tower',
      code: 'C-7F3K9Q',
      issuedAt: daysAgoISO(4),
      usedAt: null,
      usedBy: null,
      note: '데모용 미사용 코드',
    },
    {
      id: 'rc_hangwoon_used',
      siteId: 'site_hangwoon_tower',
      code: 'C-3H8N6Z',
      issuedAt: daysAgoISO(18),
      usedAt: daysAgoISO(16),
      usedBy: 'acc_customer_hangwoon',
      note: '이미 사용된 코드 예시',
    },
    {
      id: 'rc_haneul_unused',
      siteId: 'site_haneul_clinic',
      code: 'C-2M8P4R',
      issuedAt: daysAgoISO(6),
      usedAt: null,
      usedBy: null,
      note: '데모용 미사용 코드',
    },
    {
      id: 'rc_bodycamp_unused',
      siteId: 'site_bodycamp',
      code: 'C-9T5W1B',
      issuedAt: daysAgoISO(2),
      usedAt: null,
      usedBy: null,
      note: '데모용 미사용 코드',
    },
    {
      id: 'rc_lighthouse_unused',
      siteId: 'site_lighthouse',
      code: 'C-9K4M2P',
      issuedAt: daysAgoISO(0),
      usedAt: null,
      usedBy: null,
      note: '라이트하우스코스메틱 첫 입장 코드',
    },
  ];
}

/* ------------------------------------------------------------------ */
/* reports                                                             */
/* ------------------------------------------------------------------ */

function report(id, site, dayOffset, time, leader, role, checks, note, media, durationMin) {
  return {
    id,
    siteId: site.id,
    siteCode: site.code,
    siteName: site.name,
    date: daysAgo(dayOffset),
    time,
    leader,
    leaderRole: role,
    durationMin,
    checklist: site.checklist.map((label, index) => ({
      label,
      done: checks === 'all' ? true : !checks.includes(index),
    })),
    note,
    issueNote: media.issueNote || '',
    photos: {
      security: media.security || [],
      cleaning: media.cleaning || [],
      issue: media.issue || [],
    },
    createdAt: new Date().toISOString(),
    source: 'seed',
  };
}

export function buildReports(sites) {
  const [office, clinic, gym] = sites;
  return [
    report(
      'rep_seed_office_1', office, 1, '07:20', '김미영', '팀장', 'all',
      '회의실 카펫 얼룩 제거 완료. 탕비실 정수기 주변 물때까지 마무리했습니다.',
      {
        security: [P.lock('출입문 잠금 · 카드키 정상')],
        cleaning: [P.meeting(), P.office()],
      },
      85,
    ),
    report(
      'rep_seed_office_2', office, 4, '07:15', '김미영', '팀장', 'all',
      '5층 화장실 배수구 냄새 제거, 핸드타월 2박스 보충해 두었습니다.',
      {
        security: [P.lock('시건장치 이상 없음')],
        cleaning: [P.office(), P.lounge6()],
      },
      78,
    ),
    report(
      'rep_seed_office_3', office, 8, '07:25', '김미영', '팀장', [5],
      '오전 비로 외부 유리창 작업은 다음 방문으로 미뤘습니다. 실내 항목은 모두 완료.',
      {
        security: [P.lock('출입문 잠금 확인')],
        cleaning: [P.meeting()],
        issue: [P.issue('천장 얼룩 · 누수 의심')],
        issueNote: '회의실 천장 모서리에 물얼룩이 새로 생겼습니다. 관리사무소에 전달 부탁드립니다.',
      },
      70,
    ),
    report(
      'rep_seed_office_4', office, 11, '07:10', '김미영', '팀장', 'all',
      '회의실 의자 다리 먼지까지 정리했습니다. 특이사항 없음.',
      {
        security: [P.lock()],
        cleaning: [P.office(), P.meeting(), P.lounge7()],
      },
      88,
    ),

    report(
      'rep_seed_clinic_1', clinic, 2, '08:05', '이정숙', '팀장', 'all',
      '진료실 3개실 순차 소독 완료. 파우더룸 배수구 냄새 제거했습니다.',
      {
        security: [P.lock('출입문 · 진료실 잠금 확인')],
        cleaning: [P.clinic(), P.clinicLounge()],
      },
      95,
    ),
    report(
      'rep_seed_clinic_2', clinic, 5, '08:00', '이정숙', '팀장', 'all',
      '대기 라운지 소파 커버 먼지 제거, 손잡이·스위치 소독 2회 진행했습니다.',
      {
        security: [P.lock('시건장치 정상')],
        cleaning: [P.clinicLounge(), P.clinic()],
      },
      92,
    ),
    report(
      'rep_seed_clinic_3', clinic, 9, '08:10', '이정숙', '팀장', [4],
      '의료 폐기물 수거함은 위탁업체 처리 구역이라 손대지 않았습니다. 나머지 항목 완료.',
      {
        security: [P.lock()],
        cleaning: [P.clinic()],
      },
      90,
    ),

    report(
      'rep_seed_gym_1', gym, 1, '10:30', '채종병', '대표', 'all',
      '샤워실 배수구 물때 제거, 매트 소독 완료. 탈의실 환기까지 마쳤습니다.',
      {
        security: [P.lock('정문 비밀번호 잠금 확인')],
        cleaning: [P.gym(), P.lounge7()],
      },
      110,
    ),
    report(
      'rep_seed_gym_2', gym, 3, '10:20', '채종병', '대표', 'all',
      '운동기구 존 소독 후 사물함 내부 먼지 추가 정리했습니다.',
      {
        security: [P.lock()],
        cleaning: [P.gym()],
        issue: [P.issue('샤워실 배수구 물때 심화')],
        issueNote: '샤워실 3번 배수구 물때가 심해졌습니다. 다음 방문 시 약품 추가 투입 예정입니다.',
      },
      105,
    ),
    report(
      'rep_seed_gym_3', gym, 6, '10:40', '채종병', '대표', [3, 4],
      '이용객이 많아 탈의실·사물함은 부분만 진행했습니다. 다음 방문에 마무리합니다.',
      {
        security: [P.lock('출입문 잠금 확인')],
        cleaning: [P.gym(), P.lounge7()],
      },
      98,
    ),
  ];
}

/* ------------------------------------------------------------------ */
/* quotes — 견적 (대표 전용)                                            */
/* ------------------------------------------------------------------ */

/**
 * 데모 견적 1건. 사용자가 관리자 화면에서 바로 초대 문구를 복사해
 * 고객 방 → 견적서 → 계약서 → 현장 자동 등록까지 테스트할 수 있습니다.
 * 초대코드 `Q-G7K2M4`는 한 번만 사용할 수 있습니다.
 */
export function buildQuotes() {
  const startDate = daysAgo(-10);
  return [
    {
      id: 'quote_greenpeace',
      no: 'Q-2026-101',
      siteId: '',
      clientCompany: '그린피스 오피스 신정점',
      clientCategory: 'office',
      clientAddress: '서울 양천구 신정로 123, 그린피스빌딩 8층',
      clientContact: '서지훈 과장',
      clientPhone: '01024107788',
      clientBizNumber: '',
      clientTaxEmail: '',
      frequency: '주 2회 (화 · 금)',
      scope: '쓰레기 분리수거, 바닥 청소, 책상·모니터 주변 먼지 제거, 탕비실·정수기 주변, 공용 화장실 세정·소독',
      extraScope: '회의실 카펫 흡입, 출입구 유리',
      area: '약 110㎡ (33평)',
      amount: 1900000,
      vatIncluded: false,
      billingDay: '1',
      periodMonths: 12,
      startDate,
      endDate: addMonthsISO(startDate, 12),
      terms: '계약 첫 달은 대청소를 포함하여 진행합니다.',
      memo: '주차는 건물 방문 주차 1시간 지원 예정입니다.',
      validUntil: daysAgo(-(10 + QUOTE_VALID_DAYS)),
      status: 'sent',
      photos: [photo('photo-quote-office', '견적 방문 · 바닥 오염 상태')],
      inviteCode: 'Q-G7K2M4',
      inviteIssuedAt: daysAgoISO(1),
      inviteUsedAt: '',
      inviteUsedBy: '',
      invitedPhone: '',
      createdAt: daysAgoISO(2),
      updatedAt: daysAgoISO(1),
      sentAt: daysAgoISO(1),
      contractedAt: '',
      source: 'seed',
    },
  ];
}

/* ------------------------------------------------------------------ */
/* staff contracts — 직원 계약 (프리랜서 · 도급 · 일용직)               */
/* ------------------------------------------------------------------ */

export function buildStaffContracts() {
  return [
    {
      // 이아름 팀장 도급계약서 — 도급(하도급) 계약 1순위 서식. 계정과 연결되어 본인 계약서로 보입니다.
      id: 'staff_areum_subcontract',
      no: 'S-2026-006',
      accountId: 'acc_leader_areum',
      name: '이아름',
      phone: '01099708492',
      employmentType: 'contract',
      roleTitle: '팀장',
      companyName: '',
      ceoName: '이아름',
      residentId: '',
      birthDate: '',
      bizNumber: '',
      address: '',
      bankName: '',
      bankAccount: '',
      accountHolder: '이아름',
      siteIds: ['site_fastfive_gangnam3'],
      startDate: daysAgo(0),
      endDate: daysAgo(-364),
      monthlyAmount: 1200000,
      dailyAmount: 0,
      hourlyAmount: 0,
      feeRate: 0,
      settlementDay: '15',
      workDays: '주 5회 (월~금)',
      workHours: '',
      scope:
        '패스트파이브 강남3호점 사무실 정기청소 (요일별 층별 비움 · 사무실+공용부 바닥 청소 · 금요일 냉장고 케어)',
      process:
        '월: 4층(401~435호) / 화: 5층(501~535호) / 수: 5층(536~553호)·6층(601~616호) / 목: 6층(617~638호)·7층(701~713호) / 금: 7층(714~743호) + 냉장고 케어',
      safety: '약품 희석 농도 준수, 젖은 바닥 미끄럼 방지 표지판 설치',
      specialTerms: '',
      status: 'sent',
      annexAck: '',
      annexAckedAt: '',
      inviteCode: 'S-F5G309',
      inviteIssuedAt: daysAgoISO(0),
      inviteUsedAt: '',
      inviteUsedBy: '',
      signature: '',
      signedDate: '',
      signedByName: '',
      signedAt: '',
      createdAt: daysAgoISO(0),
      updatedAt: daysAgoISO(0),
      source: 'seed',
      demoHidden: true,
    },
    {
      // 이용구 부장 도급계약서 — 계정과 연결되어 본인 계약서로 보입니다.
      id: 'staff_lee_subcontract',
      no: 'S-2026-005',
      accountId: 'acc_leader_younggu',
      name: '이용구',
      phone: '01057883683',
      employmentType: 'contract',
      roleTitle: '부장',
      companyName: '블링블링크린',
      ceoName: '이용구',
      // 주민번호·사업자번호는 대표 요청으로 비워 둡니다(2026-11-27).
      residentId: '',
      birthDate: '1966-01-15',
      bizNumber: '',
      address: '',
      bankName: '우체국',
      bankAccount: '010751-02-039183',
      accountHolder: '이용구',
      siteIds: ['site_cheongnyangni_dongbang', 'site_cheongnyangni_marugame'],
      startDate: daysAgo(0),
      endDate: daysAgo(-364),
      monthlyAmount: 1950000,
      dailyAmount: 0,
      hourlyAmount: 0,
      feeRate: 0,
      settlementDay: '15',
      workDays: '주 3회 (월·수·금) · 주 7회 (월~일)',
      workHours: '',
      scope: '',
      process: '',
      safety: '',
      specialTerms: '',
      status: 'sent',
      annexAck: '',
      annexAckedAt: '',
      inviteCode: 'S-XME628',
      inviteIssuedAt: daysAgoISO(0),
      inviteUsedAt: '',
      inviteUsedBy: '',
      signature: '',
      signedDate: '',
      signedByName: '',
      signedAt: '',
      createdAt: daysAgoISO(0),
      updatedAt: daysAgoISO(0),
      source: 'seed',
    },
    {
      id: 'staff_kim_contract',
      no: 'S-2026-001',
      accountId: 'acc_leader_kim',
      name: '김미영',
      phone: '01033001042',
      employmentType: 'contract',
      roleTitle: '팀장',
      birthDate: '1979-05-17',
      bizNumber: '',
      bankName: '카카오뱅크',
      bankAccount: '3333-15-4406523',
      accountHolder: '김미영',
      siteIds: ['site_hangwoon_tower'],
      startDate: daysAgo(200),
      endDate: daysAgo(-165),
      monthlyAmount: 1430000,
      dailyAmount: 0,
      feeRate: 0,
      settlementDay: '15',
      workDays: '주 2회 (월 · 목)',
      workHours: '07:00 ~ 09:00',
      scope: '행운타워 5층 사무실 정기청소 (쓰레기 분리수거 · 바닥 · 화장실 · 카펫)',
      process: '책상·모니터 먼지 → 회의실·교육장 → 탕비실·정수기 → 화장실 세정 → 카펫 · 단 · 유리',
      safety: '약품 희석 농도 준수, 미끄럼 방지 표지판 설치',
      specialTerms: '',
      status: 'signed',
      inviteCode: 'S-K2M8Q4',
      inviteIssuedAt: daysAgoISO(200),
      inviteUsedAt: daysAgoISO(199),
      inviteUsedBy: 'acc_leader_kim',
      signature: '',
      signedDate: daysAgo(199),
      signedByName: '김미영',
      signedAt: daysAgoISO(199),
      createdAt: daysAgoISO(201),
      updatedAt: daysAgoISO(199),
      source: 'seed',
    },
    {
      id: 'staff_han_freelance',
      no: 'S-2026-002',
      accountId: '',
      name: '한지우',
      phone: '01077124490',
      employmentType: 'freelancer',
      roleTitle: '팀장',
      birthDate: '1992-11-03',
      bizNumber: '',
      bankName: '국민은행',
      bankAccount: '123456-01-987654',
      accountHolder: '한지우',
      siteIds: ['site_bodycamp', 'site_haneul_clinic'],
      startDate: daysAgo(-3),
      endDate: daysAgo(-368),
      monthlyAmount: 900000,
      dailyAmount: 0,
      feeRate: 3.3,
      settlementDay: '15',
      workDays: '주 3회 (월 · 수 · 금)',
      workHours: '10:00 ~ 12:00',
      scope: '바디캠프 피트니스 · 하늘치과 신월점 정기청소',
      process: '운동기구 존 · 매트 소독 → 거울 → 샤워실 · 배수구 → 탈의실 → 화장실',
      safety: '락스·세정제 혼합 금지, 장갑·마스크 착용',
      specialTerms: '3.3% 원천징수 후 계좌 입금',
      status: 'sent',
      inviteCode: 'S-H3K9P2',
      inviteIssuedAt: daysAgoISO(1),
      inviteUsedAt: '',
      inviteUsedBy: '',
      signature: '',
      signedDate: '',
      signedByName: '',
      signedAt: '',
      createdAt: daysAgoISO(1),
      updatedAt: daysAgoISO(1),
      source: 'seed',
    },
    {
      id: 'staff_yoon_daily',
      no: 'S-2026-003',
      accountId: '',
      name: '윤다혜',
      phone: '01055413308',
      employmentType: 'daily',
      roleTitle: '일용직',
      birthDate: '1988-02-21',
      bankName: '신한은행',
      bankAccount: '110-234-567890',
      accountHolder: '윤다혜',
      siteIds: ['site_lighthouse'],
      startDate: daysAgo(0),
      endDate: daysAgo(0),
      monthlyAmount: 0,
      dailyAmount: 120000,
      feeRate: 0,
      settlementDay: '당일',
      workDays: '2026-11-26 (수)',
      workHours: '09:00 ~ 13:00 (4시간)',
      scope: '(주) 라이트하우스코스메틱 첫 대청소 보조',
      process: '바닥 · 유리 · 화장실 · 폐기물 정리',
      safety: '사다리 작업 2인 1조, 안전화 착용',
      specialTerms: '작업 완료 후 당일 계좌 입금',
      status: 'draft',
      inviteCode: 'S-Y5D1N8',
      inviteIssuedAt: daysAgoISO(0),
      inviteUsedAt: '',
      inviteUsedBy: '',
      signature: '',
      signedDate: '',
      signedByName: '',
      signedAt: '',
      createdAt: daysAgoISO(0),
      updatedAt: daysAgoISO(0),
      source: 'seed',
    },
    {
      id: 'staff_jung_parttime',
      no: 'S-2026-004',
      accountId: '',
      name: '정민서',
      phone: '01066204417',
      employmentType: 'parttime',
      roleTitle: '알바',
      birthDate: '2001-07-09',
      bankName: '카카오뱅크',
      bankAccount: '3333-04-1122334',
      accountHolder: '정민서',
      siteIds: ['site_haneul_clinic'],
      startDate: daysAgo(-2),
      endDate: daysAgo(-90),
      monthlyAmount: 0,
      dailyAmount: 0,
      hourlyAmount: 12000,
      feeRate: 0,
      settlementDay: '10',
      workDays: '주 3회 (월 · 수 · 금) 오전',
      workHours: '07:30 ~ 10:30 (3시간)',
      scope: '하늘치과 신월점 오전 청소 보조',
      process: '대기실 → 진료실 바닥 → 화장실 → 유리',
      safety: '의료 폐기물 직접 취급 금지, 장갑 착용',
      specialTerms: '주휴수당은 근로기준법에 따라 지급',
      status: 'sent',
      inviteCode: 'S-A7B2C9',
      inviteIssuedAt: daysAgoISO(1),
      inviteUsedAt: '',
      inviteUsedBy: '',
      signature: '',
      signedDate: '',
      signedByName: '',
      signedAt: '',
      createdAt: daysAgoISO(1),
      updatedAt: daysAgoISO(1),
      source: 'seed',
    },
  ];
}

/** 근무태도 체크 — 본부장이 매긴 A~F 등급과 메모. */
export function buildStaffChecks() {
  return [
    {
      id: 'check_kim_1',
      staffContractId: 'staff_kim_contract',
      accountId: 'acc_leader_kim',
      name: '김미영',
      siteId: 'site_hangwoon_tower',
      date: daysAgo(6),
      grade: 'A',
      memo: '시건장치·맞춤 청소 사진 모두 빠짐없이 올림. 현장 상태 최상.',
      reviewerId: 'acc_leader_park',
      reviewerName: '박희승',
      createdAt: daysAgoISO(6),
      source: 'seed',
    },
    {
      id: 'check_kim_2',
      staffContractId: 'staff_kim_contract',
      accountId: 'acc_leader_kim',
      name: '김미영',
      siteId: 'site_hangwoon_tower',
      date: daysAgo(2),
      grade: 'B',
      memo: '보고는 정시에 했지만 회의실 카펫 사진이 빠져 있었습니다.',
      reviewerId: 'acc_leader_park',
      reviewerName: '박희승',
      createdAt: daysAgoISO(2),
      source: 'seed',
    },
  ];
}

export function buildSeedData() {
  const sites = buildSites();
  return {
    sites,
    reports: buildReports(sites),
    accounts: buildAccounts(),
    roomCodes: buildRoomCodes(),
    grants: buildGrants(),
    quotes: buildQuotes(),
    contracts: [],
    staffContracts: buildStaffContracts(),
    staffChecks: buildStaffChecks(),
    supplyCatalog: buildSupplyCatalog(),
    supplyOrders: buildSupplyOrders(),
  };
}

/* ------------------------------------------------------------------ */
/* 청소장비 · 배접봉투 구입 (대표 · 구입 당사자 직원)                  */
/* ------------------------------------------------------------------ */

/**
 * 품목 · 단가 마스터.
 * 청소장비 6종은 첨부 사진의 단가·설명 그대로이고, 배접봉투 8종은
 * 단가를 아직 정하지 않아 0원으로 두었습니다(대표가 관리 화면에서 입력).
 */
export function buildSupplyCatalog() {
  return [
    { id: 'sup_pole2', group: 'equipment', name: '2단 폴대 (마포대홀더)', price: 12000, unit: '개', note: '', sort: 1, active: true },
    { id: 'sup_mapo_mop', group: 'equipment', name: '마포걸레', price: 3500, unit: '개', note: '', sort: 2, active: true },
    { id: 'sup_risking_mop', group: 'equipment', name: '리스킹 걸레', price: 8000, unit: '개', note: '', sort: 3, active: true },
    { id: 'sup_risking_head', group: 'equipment', name: '리스킹 헤드', price: 5000, unit: '개', note: '', sort: 4, active: true },
    { id: 'sup_bucket', group: 'equipment', name: '짤통이', price: 44000, unit: '개', note: '', sort: 5, active: true },
    {
      id: 'sup_vacuum',
      group: 'equipment',
      name: '레칸 무선청소기 풀세트 (5Ah)',
      price: 440000,
      unit: '세트',
      note: '본체+5Ah 배터리 2개+듀얼충전기',
      sort: 6,
      active: true,
    },
    { id: 'sup_bag_xl_black', group: 'bag', name: '배접봉투 특대 (검정색 · 10장 1묶음)', price: 0, unit: '1묶음', note: '', sort: 11, active: true },
    { id: 'sup_bag_xl_white', group: 'bag', name: '배접봉투 특대 (백색 · 10장 1묶음)', price: 0, unit: '1묶음', note: '', sort: 12, active: true },
    { id: 'sup_bag_l_black', group: 'bag', name: '배접봉투 대 (검정색 · 10장 1묶음)', price: 0, unit: '1묶음', note: '', sort: 13, active: true },
    { id: 'sup_bag_l_white', group: 'bag', name: '배접봉투 대 (백색 · 10장 1묶음)', price: 0, unit: '1묶음', note: '', sort: 14, active: true },
    { id: 'sup_bag_m_black', group: 'bag', name: '배접봉투 중 (검정색 · 10장 1묶음)', price: 0, unit: '1묶음', note: '', sort: 15, active: true },
    { id: 'sup_bag_m_white', group: 'bag', name: '배접봉투 중 (백색 · 10장 1묶음)', price: 0, unit: '1묶음', note: '', sort: 16, active: true },
    { id: 'sup_bag_s_black', group: 'bag', name: '배접봉투 소 (검정색 · 10장 1묶음)', price: 0, unit: '1묶음', note: '', sort: 17, active: true },
    { id: 'sup_bag_s_white', group: 'bag', name: '배접봉투 소 (백색 · 10장 1묶음)', price: 0, unit: '1묶음', note: '', sort: 18, active: true },
  ];
}

/**
 * 데모 영수증 1건(김미영 팀장 · 첨부 사진과 같은 6개 품목 612,000원)과
 * 발행을 기다리는 신청 1건(이정숙 팀장 · 배접봉투 · 마포걸레)을 넣어
 * 설치 직후에 영수증 시트와 발행 흐름을 바로 눌러볼 수 있게 합니다.
 */
export function buildSupplyOrders() {
  const catalog = new Map(buildSupplyCatalog().map((item) => [item.id, item]));
  const line = (id, qty) => {
    const item = catalog.get(id);
    return {
      catalogId: id,
      name: item ? item.name : id,
      note: item ? item.note : '',
      unit: item ? item.unit : '',
      price: item ? item.price : 0,
      qty,
      amount: (item ? item.price : 0) * qty,
    };
  };
  const year = new Date().getFullYear();
  const issuedDate = daysAgo(1);
  const issuedStamp = daysAgoISO(1);
  const requestedDate = daysAgo(0);
  const requestedStamp = daysAgoISO(0);
  const issued = [
    line('sup_pole2', 3),
    line('sup_mapo_mop', 2),
    line('sup_risking_mop', 10),
    line('sup_risking_head', 1),
    line('sup_bucket', 1),
    line('sup_vacuum', 1),
  ];
  const requested = [line('sup_bag_xl_black', 2), line('sup_mapo_mop', 2)];

  return [
    {
      id: 'supply_order_kim',
      no: `R-${year}-001`,
      status: 'issued',
      requesterAccountId: 'acc_leader_kim',
      requesterName: '김미영',
      toAccountId: 'acc_leader_kim',
      toName: '김미영',
      date: issuedDate,
      requestedAt: issuedDate,
      issuedAt: issuedStamp,
      items: issued,
      total: issued.reduce((sum, row) => sum + row.amount, 0),
      note: '',
      createdAt: issuedStamp,
      updatedAt: issuedStamp,
      source: 'seed',
    },
    {
      id: 'supply_request_lee',
      no: `R-${year}-002`,
      status: 'requested',
      requesterAccountId: 'acc_leader_lee',
      requesterName: '이정숙',
      toAccountId: 'acc_leader_lee',
      toName: '이정숙',
      date: '',
      requestedAt: requestedDate,
      issuedAt: '',
      items: requested,
      total: requested.reduce((sum, row) => sum + row.amount, 0),
      note: '하늘치과 현장 봉투 소진',
      createdAt: requestedStamp,
      updatedAt: requestedStamp,
      source: 'seed',
    },
  ];
}
