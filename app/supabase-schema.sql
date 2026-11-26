-- ============================================================
-- 코리아 에코크린 PWA — Supabase 실시간 다중 기기 동기화 스키마 (v2.5.0)
--
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 RUN 하세요.
-- 이 파일은 실제로 실행한 SQL과 같습니다(2026-11-26 실행 · Success 확인).
--
-- 프로젝트
--   Project URL : https://magwvjtnxlewumojlpwz.supabase.co
--   키          : publishable(sb_publishable_…) — 앱 js/supabase-client.js 에 설정
--
-- 앱 저장소는 한 테이블(public.ecoclean_items)에 모읍니다.
--   collection  ← 앱의 저장 컬렉션 이름
--   id          ← 그 컬렉션의 레코드 id (meta 는 key)
--   data        ← 레코드 원본 JSON
--   updated_at  ← 기기 간 증분 동기화 기준(서버 시각)
--
-- collection 이름 ↔ 앱 내부 테이블
--   sites          현장(고객사)
--   reports        청소 보고
--   inviteCodes    roomCodes — 1회용 청소 · 초대코드
--   leaderCodes    grants    — 방 입장 권한(계정×현장)
--   accounts       계정(고객 · 팀장 · 대표)
--   quotes         견적서
--   contracts      도급 계약서(갑 · 고객)
--   staffContracts 직원 계약서(을 · 도급처 · 프리랜서 · 일용직)
--   attitudeLogs   staffChecks — 근무태도 A~F 체크
--   supplyCatalog  청소장비 · 배접봉투 품목 단가
--   supplyOrders   구입 신청 · 영수증
--   meta           앱 설정값(로그인 세션 등)
--   inquiries      홈 상담 신청
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1) 공유 저장 테이블
-- ------------------------------------------------------------
create table if not exists public.ecoclean_items (
  collection text not null check (collection in (
    'sites',
    'reports',
    'inviteCodes',
    'leaderCodes',
    'accounts',
    'quotes',
    'contracts',
    'staffContracts',
    'attitudeLogs',
    'supplyCatalog',
    'supplyOrders',
    'meta',
    'inquiries'
  )),
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

create index if not exists ecoclean_items_updated_idx
  on public.ecoclean_items (updated_at desc);

create index if not exists ecoclean_items_collection_idx
  on public.ecoclean_items (collection);

-- updated_at 은 항상 서버 시각으로 갱신합니다(기기 시계 차이와 무관하게 증분 동기화).
create or replace function public.ecoclean_items_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists ecoclean_items_touch on public.ecoclean_items;
create trigger ecoclean_items_touch
  before update on public.ecoclean_items
  for each row execute function public.ecoclean_items_touch();

-- ------------------------------------------------------------
-- 2) 테이블 권한 — 앱(anon · publishable 키)이 읽고 쓸 수 있게
--    (SQL Editor 로 만든 테이블은 anon 역할 권한이 자동으로 붙지 않습니다.)
-- ------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.ecoclean_items to anon, authenticated;
grant execute on function public.ecoclean_items_touch() to anon, authenticated;

-- ------------------------------------------------------------
-- 3) RLS — 앱 자체 인증(전화번호 · 1회용 초대코드) 구조
--    앱은 Supabase Auth 세션을 쓰지 않고 publishable(anon) 키로만 통신합니다.
--    따라서 anon · authenticated 역할에 읽기/쓰기/삭제를 허용합니다.
--    ⚠️ 운영 확장 시: 계정 로그인을 Supabase Auth 로 옮기고,
--       collection 별 정책(예: 고객은 자기 현장 것만)으로 좁히세요.
-- ------------------------------------------------------------
alter table public.ecoclean_items enable row level security;

drop policy if exists "ecoclean items read" on public.ecoclean_items;
create policy "ecoclean items read"
  on public.ecoclean_items for select
  to anon, authenticated
  using (true);

drop policy if exists "ecoclean items insert" on public.ecoclean_items;
create policy "ecoclean items insert"
  on public.ecoclean_items for insert
  to anon, authenticated
  with check (true);

drop policy if exists "ecoclean items update" on public.ecoclean_items;
create policy "ecoclean items update"
  on public.ecoclean_items for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "ecoclean items delete" on public.ecoclean_items;
create policy "ecoclean items delete"
  on public.ecoclean_items for delete
  to anon, authenticated
  using (true);

-- ------------------------------------------------------------
-- 4) Realtime — 다른 기기의 변경을 즉시 받을 수 있게 발행에 추가
--    (앱은 5초 폴링을 기본으로 쓰고, Realtime 은 확장용으로 열어 둡니다.)
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ecoclean_items'
  ) then
    alter publication supabase_realtime add table public.ecoclean_items;
  end if;
end $$;

-- ------------------------------------------------------------
-- 5) Storage — 청소 사진 · 사업자등록증 · 서명 PNG
--    버킷 ecoclean-files (public = true), 앱은 anon 키로 업로드합니다.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('ecoclean-files', 'ecoclean-files', true)
on conflict (id) do update set public = true;

drop policy if exists "ecoclean files public read" on storage.objects;
-- 공개(public) 버킷의 파일은 정책 없이도 공개 URL 로 바로 열립니다.
-- SELECT 정책을 두면 누구나 버킷 안의 전체 파일 목록을 볼 수 있어(대시보드 경고)
-- 일부로 두지 않습니다. 앱도 목록을 읽지 않고, 레코드에 저장한 공개 주소만 엽니다.

drop policy if exists "ecoclean files upload" on storage.objects;
create policy "ecoclean files upload"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'ecoclean-files');

drop policy if exists "ecoclean files update" on storage.objects;
create policy "ecoclean files update"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'ecoclean-files')
  with check (bucket_id = 'ecoclean-files');

-- ------------------------------------------------------------
-- 6) 확인용 (선택)
-- ------------------------------------------------------------
-- select collection, count(*) from public.ecoclean_items group by collection order by collection;
-- select id, name, public from storage.buckets where id = 'ecoclean-files';
