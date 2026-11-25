-- ============================================================
-- 코리아 에코크린 PWA — Supabase 스키마 (무료 플랜 기준)
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 RUN 하세요.
-- ============================================================

-- 확장
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1) 현장(고객사)
-- ------------------------------------------------------------
create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                 -- EC-1042
  name text not null,
  client_name text,
  category text check (category in ('office', 'clinic', 'retail', 'fitness')),
  address text,
  area text,
  frequency text,
  interval_days int default 7,
  start_date date,
  manager text,
  manager_role text,
  access_note text,
  contact_name text,
  checklist jsonb default '[]'::jsonb,        -- ["책상 · 모니터 주변 먼지 제거", ...]
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 2) 계정 (데모: 앱에서 로컬 검증 / 운영: Supabase Auth 사용)
--    운영에서는 auth.users + profiles 로 옮기고 password 컬럼은 지웁니다.
-- ------------------------------------------------------------
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('customer', 'leader', 'admin')),
  name text not null,
  title text,
  phone text unique not null,                -- 숫자만 저장
  password text,                             -- ⚠️ 데모 전용. 운영에서는 사용 금지
  leader_code text,                          -- 팀장 고유코드 (TL-4821)
  site_id uuid references public.sites(id),  -- 고객 계정의 현장
  assigned_site_ids uuid[] default '{}',     -- 팀장 담당 현장
  active boolean default true,
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 3) 1회용 청소코드 (현장별, 1회 사용)
-- ------------------------------------------------------------
create table if not exists public.room_codes (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  code text unique not null,                 -- C-7F3K9Q
  note text,
  issued_at timestamptz default now(),
  used_at timestamptz,
  used_by uuid references public.accounts(id)
);

create index if not exists room_codes_site_idx on public.room_codes (site_id);

-- ------------------------------------------------------------
-- 4) 방 입장 권한 (코드 1회 인증 후 계정에 부여)
-- ------------------------------------------------------------
create table if not exists public.grants (
  id text primary key,                       -- "<account_id>::<site_id>"
  account_id uuid not null references public.accounts(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  code_id uuid references public.room_codes(id),
  created_at timestamptz default now(),
  unique (account_id, site_id)
);

-- ------------------------------------------------------------
-- 5) 청소 보고 (사진 3분류 + 점검 항목 + 메모)
-- ------------------------------------------------------------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  visited_on date not null,
  completed_at time,
  leader text not null,
  leader_role text,
  duration_min int,
  checklist jsonb default '[]'::jsonb,       -- [{label, done}]
  note text,                                 -- 고객 전달 메모
  issue_note text,                           -- 특이사항 메모
  created_by uuid references public.accounts(id),
  created_at timestamptz default now()
);

create index if not exists reports_site_date_idx on public.reports (site_id, visited_on desc);

-- ------------------------------------------------------------
-- 6) 보고 사진 — group: security | cleaning | issue
-- ------------------------------------------------------------
create table if not exists public.report_photos (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  photo_group text not null check (photo_group in ('security', 'cleaning', 'issue')),
  storage_path text not null,
  public_url text,
  thumb_url text,
  caption text,
  width int,
  height int,
  created_at timestamptz default now()
);

create index if not exists report_photos_report_idx on public.report_photos (report_id);

-- ------------------------------------------------------------
-- 7) 상담 신청 (홈 · 상담 탭)
-- ------------------------------------------------------------
create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  space_type text,
  district text,
  size text,
  frequency text,
  time_window text,
  phone text,
  memo text,
  message text,
  channel text default 'sms',
  status text default 'new',
  created_at timestamptz default now()
);

-- ------------------------------------------------------------
-- 8) 앱 설정값
-- ------------------------------------------------------------
create table if not exists public.app_meta (
  key text primary key,
  value jsonb
);

-- ============================================================
-- 사진 저장소 (Supabase Storage, 무료 1GB)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('report-photos', 'report-photos', true)
on conflict (id) do nothing;

-- ============================================================
-- RLS (Row Level Security) — 무료 플랜에서도 반드시 켜세요
-- ============================================================
alter table public.sites        enable row level security;
alter table public.accounts     enable row level security;
alter table public.room_codes   enable row level security;
alter table public.grants       enable row level security;
alter table public.reports      enable row level security;
alter table public.report_photos enable row level security;
alter table public.inquiries    enable row level security;
alter table public.app_meta     enable row level security;

-- 데모/초기 운영용 최소 정책.
-- ⚠️ 고객은 자기 방의 보고만 봐야 합니다. 아래는 "로그인한 사용자" 기준 예시이며,
--    실제 서비스에서는 JWT의 site_id 클레임으로 좁히세요(주석 참고).

-- 누구나 현장 코드 조회는 못 하게, 로그인 사용자만
create policy "sites readable by authenticated"
  on public.sites for select to authenticated using (true);

-- 고객: 자기 site_id 의 보고만
create policy "reports readable by room member"
  on public.reports for select to authenticated
  using (
    site_id in (
      select site_id from public.grants where account_id = auth.uid()
    )
    or exists (
      select 1 from public.accounts a
      where a.id = auth.uid() and a.role in ('leader', 'admin')
    )
  );

-- 팀장·대표만 보고 작성
create policy "reports writable by staff"
  on public.reports for insert to authenticated
  with check (
    exists (select 1 from public.accounts a where a.id = auth.uid() and a.role in ('leader', 'admin'))
  );

create policy "photos readable by room member"
  on public.report_photos for select to authenticated using (true);

create policy "photos writable by staff"
  on public.report_photos for insert to authenticated
  with check (
    exists (select 1 from public.accounts a where a.id = auth.uid() and a.role in ('leader', 'admin'))
  );

-- 상담 신청: 누구나 insert, 조회는 막음(개인정보)
create policy "inquiries insert by anyone"
  on public.inquiries for insert to anon, authenticated with check (true);

-- 1회용 코드/계정/권한은 서버(service_role) 또는 관리자만
create policy "room codes readable by admin"
  on public.room_codes for select to authenticated
  using (exists (select 1 from public.accounts a where a.id = auth.uid() and a.role = 'admin'));

create policy "room codes writable by admin"
  on public.room_codes for all to authenticated
  using (exists (select 1 from public.accounts a where a.id = auth.uid() and a.role = 'admin'))
  with check (exists (select 1 from public.accounts a where a.id = auth.uid() and a.role = 'admin'));

create policy "grants readable by owner or admin"
  on public.grants for select to authenticated
  using (
    account_id = auth.uid()
    or exists (select 1 from public.accounts a where a.id = auth.uid() and a.role = 'admin')
  );

-- 스토리지 정책: 누구나 읽기, 직원만 업로드
create policy "report photos public read"
  on storage.objects for select using (bucket_id = 'report-photos');

create policy "report photos staff upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'report-photos');

-- ============================================================
-- 샘플 데이터 (선택) — 필요하면 주석을 풀고 실행
-- ============================================================
-- insert into public.sites (code, name, client_name, category, address, area, frequency, interval_days, manager, manager_role, access_note, contact_name, checklist)
-- values ('EC-1042', '행운타워 5층 사무실', '행운물산(주)', 'office',
--         '서울 양천구 남부순환로36길 30, 행운타워 5층', '약 95㎡ (29평)', '주 2회 (월 · 목)', 3,
--         '김미영', '팀장', '출근 전 07:00~08:30', '정하윤 총무',
--         '["책상 · 모니터 주변 먼지 제거","회의실 · 교육장 정리 및 바닥","탕비실 · 정수기 주변","공용 화장실 세정 · 소독","바닥 · 카펫 흡입","계단 · 출입구 유리"]'::jsonb);
