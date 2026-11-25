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

export const SEED_VERSION = 4;

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
};

/* ------------------------------------------------------------------ */
/* sites                                                               */
/* ------------------------------------------------------------------ */

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
      checklist: DEFAULT_CHECKLISTS.office,
      locked: true,
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
      checklist: DEFAULT_CHECKLISTS.clinic,
      locked: true,
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
      checklist: DEFAULT_CHECKLISTS.fitness,
      locked: true,
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
    assignedSiteIds: ['site_hangwoon_tower', 'site_haneul_clinic', 'site_bodycamp'],
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
    assignedSiteIds: ['site_hangwoon_tower', 'site_haneul_clinic', 'site_bodycamp'],
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

export function buildSeedData() {
  const sites = buildSites();
  return {
    sites,
    reports: buildReports(sites),
    accounts: buildAccounts(),
    roomCodes: buildRoomCodes(),
    grants: buildGrants(),
  };
}
