-- ============================================================
-- 코리아 에코크린 PWA — Supabase 스키마 v2.16.2 (보안 잠금 · 재검증)
--
--  Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 RUN 하세요.
--  이 파일은 2026-11-29 에 실제로 실행한 SQL 과 같습니다(Success 확인). v2.16.2 는 재검증만 했습니다.
--  여러 번 실행해도 안전합니다(정책 · 함수 · 트리거를 지우고 다시 만듭니다).
--
-- 프로젝트
--   Project URL : https://magwvjtnxlewumojlpwz.supabase.co
--   키          : publishable(sb_publishable_…) — 앱 js/supabase-client.js 에 설정
--                 ※ service_role 키는 앱 · 저장소 어디에도 넣지 않습니다.
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
--   attitudeLogs   staffChecks — 근무태도 A~F 체크/100점 평가
--   supplyCatalog  청소장비 · 배접봉투 품목 단가
--   supplyOrders   구입 신청 · 영수증
--   meta           앱 설정값(로그인 세션 등 — session 은 기기 전용이라 동기화하지 않음)
--   inquiries      홈 상담 신청
--
-- v2.16.2 (2026-11-29) — 스키마 변경 없음.
--   고객 · 관리팀장(부관리자 포함)이 '지정 업체 외 타 업체 정보'를 한 행도 받지 않는지
--   실제 JWT(고객 박준호 · 팀장 이용구/이아름 · 본부장 박희승)로 재검증했습니다.
--   아래 6) 역할별 열람 범위(kec_can_see) + 8) 마스킹 뷰가 그대로 그 답입니다.
--     · sites 는 지정/배정된 site_id 만 · reports · quotes · contracts 도 같은 범위만
--     · accounts 는 본인 1건 · attitudeLogs · 다른 직원 계약서 · 견적 · 고객 계약은 0행
--   앱 쪽(기기 저장소 · 화면) 차단은 js/store.js 의 열람 범위 어댑터가 맡습니다.
--
-- v2.16.0 에서 달라진 점
--   · anon(비로그인)은 이 테이블을 읽지도 쓰지도 못합니다(권한 회수 + RLS).
--   · 직원 · 대표는 전화번호 + 비밀번호 → Supabase Auth(JWT)로 들어옵니다.
--     로그인 이메일 규칙 : 01012345678 → 01012345678@members.koreaecoclean.app
--   · 계정(accounts) 레코드에 비밀번호가 있으면 accounts 변경 트리거가
--     auth.users 에 사용자를 만들고, 저장되는 레코드에서는 평문을 지웁니다.
--   · 고객 · 초대 입장은 security definer 함수(kec_room_entry 등)가
--     1회용 코드만 검증해 그 1건만 돌려줍니다(테이블 전체 열람 없음).
--   · 읽기는 public.ecoclean_items_read 마스킹 뷰를 씁니다 — 역할별로
--     금액 · 비밀번호가 화면에 내려가기 전에 지워집니다.
--   · 쓰기는 RLS(읽기 범위 = 쓰기 범위) + kec_guard_item 트리거가 지킵니다.
--
-- 필수 Auth 설정 (대시보드 → Authentication → Sign In / Providers)
--   · Email provider : 켜짐
--   · Confirm email  : 꺼짐   (직원은 대표가 정한 비밀번호로 바로 로그인)
--   · Allow anonymous sign-ins : 켜짐   (고객 방 · 1회용 코드 입장용)
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1) 공유 저장 테이블 (v2.5.0 과 동일)
-- ------------------------------------------------------------
create table if not exists public.ecoclean_items (
  collection text not null check (collection in (
    'sites','reports','inviteCodes','leaderCodes','accounts','quotes','contracts',
    'staffContracts','attitudeLogs','supplyCatalog','supplyOrders','meta','inquiries'
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

create or replace function public.ecoclean_items_touch()
returns trigger language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end $fn$;

drop trigger if exists ecoclean_items_touch on public.ecoclean_items;
create trigger ecoclean_items_touch
  before update on public.ecoclean_items
  for each row execute function public.ecoclean_items_touch();

-- ------------------------------------------------------------
-- 2) 구성원 표 — auth 사용자 ↔ 앱 계정(역할 · 담당 업장)
--    RLS 켜고 정책 없음 = definer 함수만 접근합니다.
-- ------------------------------------------------------------
create table if not exists public.kec_members (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  account_id text not null,
  role       text not null default 'leader' check (role in ('admin','manager','leader','customer')),
  active     boolean not null default true,
  site_ids   text[] not null default '{}'::text[],
  phone      text default '',
  name       text default '',
  quote_id   text default '',
  updated_at timestamptz not null default now()
);
create index if not exists kec_members_account_idx on public.kec_members (account_id);
alter table public.kec_members enable row level security;
revoke all on public.kec_members from anon, authenticated;

-- ------------------------------------------------------------
-- 3) 도우미 함수 (요청한 사람의 역할 · 계정 · 담당 업장)
--    모두 security definer + 고정 search_path — RLS 재귀를 피합니다.
-- ------------------------------------------------------------
create or replace function public.kec_role()
returns text language sql stable security definer
set search_path = public, extensions, pg_temp as $fn$
  select coalesce((select m.role from public.kec_members m
                    where m.user_id = auth.uid() and m.active), '');
$fn$;

create or replace function public.kec_account_id()
returns text language sql stable security definer
set search_path = public, extensions, pg_temp as $fn$
  select coalesce((select m.account_id from public.kec_members m
                    where m.user_id = auth.uid() and m.active), '');
$fn$;

create or replace function public.kec_site_ids()
returns text[] language sql stable security definer
set search_path = public, extensions, pg_temp as $fn$
  select coalesce((select m.site_ids from public.kec_members m
                    where m.user_id = auth.uid() and m.active), '{}'::text[]);
$fn$;

create or replace function public.kec_me_name()
returns text language sql stable security definer
set search_path = public, extensions, pg_temp as $fn$
  select coalesce((select m.name from public.kec_members m
                    where m.user_id = auth.uid() and m.active), '');
$fn$;

create or replace function public.kec_quote_id()
returns text language sql stable security definer
set search_path = public, extensions, pg_temp as $fn$
  select coalesce((select m.quote_id from public.kec_members m
                    where m.user_id = auth.uid() and m.active), '');
$fn$;

-- 전화번호 정규화 (숫자만) · 로그인 이메일 만들기
create or replace function public.kec_digits(p text)
returns text language sql immutable as $fn$
  select regexp_replace(coalesce(p, ''), '\D', '', 'g');
$fn$;

create or replace function public.kec_email_for_phone(p_phone text)
returns text language sql immutable as $fn$
  select case when public.kec_digits(p_phone) = '' then ''
              else public.kec_digits(p_phone) || '@members.koreaecoclean.app' end;
$fn$;

-- ------------------------------------------------------------
-- 4) 계정 → Supabase Auth 사용자 생성 · 비밀번호 동기화
--    비밀번호가 있는 계정만 Auth 사용자를 만듭니다(없으면 기존 구성원 범위만 갱신).
-- ------------------------------------------------------------
create or replace function public.kec_provision_account(
  p_account_id text,
  p_phone      text,
  p_password   text,
  p_name       text,
  p_role       text,
  p_site_ids   text[] default '{}'::text[],
  p_active     boolean default true,
  p_quote_id   text default ''
) returns uuid
language plpgsql security definer
set search_path = public, extensions, pg_temp as $fn$
declare
  v_phone text := public.kec_digits(p_phone);
  v_email text;
  v_uid   uuid;
  v_role  text := case when p_role in ('admin','manager','leader','customer') then p_role else 'leader' end;
begin
  if coalesce(p_account_id, '') = '' then return null; end if;
  v_email := public.kec_email_for_phone(v_phone);

  -- 비밀번호가 없으면(고객 · 초대 입장) Auth 사용자를 만들지 않고 범위만 맞춥니다.
  if v_email = '' or coalesce(btrim(p_password), '') = '' then
    update public.kec_members
       set role = v_role, active = coalesce(p_active, true),
           site_ids = coalesce(p_site_ids, '{}'::text[]),
           name = coalesce(p_name, ''), phone = v_phone,
           quote_id = coalesce(p_quote_id, ''), updated_at = now()
     where account_id = p_account_id;
    return null;
  end if;

  select u.id into v_uid from auth.users u where lower(u.email) = lower(v_email) limit 1;

  if v_uid is null then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
      is_sso_user, is_anonymous, confirmation_token, recovery_token,
      email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
      v_email, extensions.crypt(btrim(p_password), extensions.gen_salt('bf')), now(),
      now(), now(), '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', coalesce(p_name, ''), 'phone', v_phone),
      false, false, '', '', '', ''
    ) returning id into v_uid;

    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid, v_uid::text, 'email',
            jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
            now(), now(), now())
    on conflict do nothing;
  else
    update auth.users
       set encrypted_password = extensions.crypt(btrim(p_password), extensions.gen_salt('bf')),
           updated_at = now()
     where id = v_uid;
  end if;

  insert into public.kec_members (user_id, account_id, role, active, site_ids, phone, name, quote_id, updated_at)
  values (v_uid, p_account_id, v_role, coalesce(p_active, true), coalesce(p_site_ids, '{}'::text[]),
          v_phone, coalesce(p_name, ''), coalesce(p_quote_id, ''), now())
  on conflict (user_id) do update
     set account_id = excluded.account_id, role = excluded.role, active = excluded.active,
         site_ids = excluded.site_ids, phone = excluded.phone, name = excluded.name,
         quote_id = excluded.quote_id, updated_at = now();

  return v_uid;
end $fn$;

revoke all on function public.kec_provision_account(text, text, text, text, text, text[], boolean, text) from anon, authenticated;

-- ------------------------------------------------------------
-- 5) accounts 레코드가 바뀌면 Auth 사용자 · 구성원 표를 자동으로 맞춥니다.
--    저장되는 레코드에서는 평문 비밀번호를 지웁니다(다른 사람이 읽을 수 없게).
-- ------------------------------------------------------------
create or replace function public.kec_sync_member()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $fn$
declare
  d jsonb := coalesce(new.data, '{}'::jsonb);
  v_role text;
  v_sites text[] := '{}'::text[];
  v_phone text;
  v_pw text;
begin
  if new.collection <> 'accounts' then return new; end if;

  v_role := case
    when d->>'role' = 'admin' then 'admin'
    when d->>'role' = 'customer' then 'customer'
    when coalesce((d->>'canManageStaff')::boolean, false) then 'manager'
    else 'leader' end;

  if v_role = 'customer' then
    v_sites := case when coalesce(d->>'siteId', '') = '' then '{}'::text[] else array[d->>'siteId'] end;
  else
    v_sites := coalesce((select array_agg(x.value)
                           from jsonb_array_elements_text(coalesce(d->'assignedSiteIds', '[]'::jsonb)) x), '{}'::text[]);
  end if;

  v_phone := public.kec_digits(d->>'phone');
  v_pw := nullif(btrim(coalesce(d->>'password', '')), '');

  perform public.kec_provision_account(
    new.id, v_phone, v_pw, d->>'name', v_role, v_sites,
    coalesce((d->>'active')::boolean, true), coalesce(d->>'quoteId', '')
  );

  if d ? 'password' then
    new.data := d - 'password';
  end if;
  return new;
end $fn$;

drop trigger if exists kec_sync_member_ins on public.ecoclean_items;
create trigger kec_sync_member_ins
  before insert on public.ecoclean_items
  for each row execute function public.kec_sync_member();

drop trigger if exists kec_sync_member_upd on public.ecoclean_items;
create trigger kec_sync_member_upd
  before update on public.ecoclean_items
  for each row execute function public.kec_sync_member();

-- 계정 삭제 → 구성원 비활성(로그인은 남지만 권한 0)
create or replace function public.kec_account_deleted()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $fn$
begin
  if old.collection = 'accounts' then
    update public.kec_members set active = false, updated_at = now() where account_id = old.id;
  end if;
  return old;
end $fn$;

drop trigger if exists kec_account_deleted on public.ecoclean_items;
create trigger kec_account_deleted
  after delete on public.ecoclean_items
  for each row execute function public.kec_account_deleted();

-- ------------------------------------------------------------
-- 6) 역할별 열람 범위
-- ------------------------------------------------------------
create or replace function public.kec_can_see(p_collection text, p_id text, p_data jsonb)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $fn$
  select case public.kec_role()
    when 'admin' then true
    when 'manager' then case p_collection
      when 'sites'         then p_id = any(public.kec_site_ids())
      when 'reports'       then (p_data->>'siteId') = any(public.kec_site_ids())
      when 'inviteCodes'   then (p_data->>'siteId') = any(public.kec_site_ids())
      when 'leaderCodes'   then (p_data->>'siteId') = any(public.kec_site_ids())
                           or (p_data->>'accountId') = public.kec_account_id()
      when 'supplyCatalog' then true
      when 'supplyOrders'  then (p_data->>'requesterAccountId') = public.kec_account_id()
                           or (p_data->>'toAccountId') = public.kec_account_id()
      when 'meta'          then p_id <> 'session'
      when 'accounts'      then p_id = public.kec_account_id()
      else false end
    when 'leader' then case p_collection
      when 'sites'         then p_id = any(public.kec_site_ids())
      when 'reports'       then (p_data->>'leaderId') = public.kec_account_id()
                            and (p_data->>'siteId') = any(public.kec_site_ids())
      when 'staffContracts' then (p_data->>'accountId') = public.kec_account_id()
                            or public.kec_digits(p_data->>'phone') = (select m.phone from public.kec_members m where m.user_id = auth.uid() and m.active)
      when 'leaderCodes'   then (p_data->>'accountId') = public.kec_account_id()
      when 'supplyCatalog' then true
      when 'supplyOrders'  then (p_data->>'requesterAccountId') = public.kec_account_id()
                           or (p_data->>'toAccountId') = public.kec_account_id()
      when 'meta'          then p_id <> 'session'
      when 'accounts'      then p_id = public.kec_account_id()
      else false end
    when 'customer' then case p_collection
      when 'sites'         then p_id = any(public.kec_site_ids())
      when 'reports'       then (p_data->>'siteId') = any(public.kec_site_ids())
      when 'quotes'        then (p_data->>'siteId') = any(public.kec_site_ids())
                           or p_id = public.kec_quote_id()
      when 'contracts'     then (p_data->>'siteId') = any(public.kec_site_ids())
                           or (p_data->>'quoteId') = public.kec_quote_id()
      when 'leaderCodes'   then (p_data->>'accountId') = public.kec_account_id()
      when 'meta'          then p_id <> 'session'
      when 'accounts'      then p_id = public.kec_account_id()
      else false end
    else false end;
$fn$;

-- 쓰기 범위 = 읽기 범위 (단, 아래 컬렉션은 대표만)
create or replace function public.kec_can_write(p_collection text, p_id text, p_data jsonb)
returns boolean language sql stable security definer
set search_path = public, extensions, pg_temp as $fn$
  select case public.kec_role()
    when 'admin' then true
    when '' then false
    else public.kec_can_see(p_collection, p_id, p_data)
      and p_collection in ('sites','reports','quotes','contracts','staffContracts','supplyOrders')
  end;
$fn$;

-- ------------------------------------------------------------
-- 7) 보호 필드 — 서버가 값 자체를 지켜 줍니다 (금액 · 출입 정보 · 내부 평가)
--    role 이 admin 이 아니면 되돌립니다.
-- ------------------------------------------------------------
create or replace function public.kec_guard_item()
returns trigger language plpgsql security definer
set search_path = public, extensions, pg_temp as $fn$
declare
  v_role text := public.kec_role();
  d jsonb;
begin
  -- 역할이 없는 실행(운영 · 서버 함수)은 그대로 둡니다. RLS 가 이미 앱 사용자만 통과시킵니다.
  if new.collection <> 'sites' or v_role in ('admin', '') then return new; end if;

  d := new.data;

  if v_role = 'customer' then
    -- 고객은 자기 업장에서 '불편사항 · 요청'과 이력만 남길 수 있습니다.
    new.data := old.data
      || case when d ? 'complaints' then jsonb_build_object('complaints', d->'complaints') else '{}'::jsonb end
      || case when d ? 'history'    then jsonb_build_object('history', d->'history')       else '{}'::jsonb end
      || case when d ? 'updatedAt'  then jsonb_build_object('updatedAt', d->'updatedAt')   else '{}'::jsonb end;
    return new;
  end if;

  -- 계약 금액 · 청구 · 정산은 대표만 고칩니다 (마스킹된 값을 되돌려도 원본이 살아남습니다).
  if old.data ? 'invoices' then d := jsonb_set(d, '{invoices}', old.data->'invoices', true); else d := d - 'invoices'; end if;
  if old.data ? 'payouts'  then d := jsonb_set(d, '{payouts}',  old.data->'payouts',  true); else d := d - 'payouts';  end if;
  if old.data ? 'contract' then d := jsonb_set(d, '{contract}', old.data->'contract', true); else d := d - 'contract'; end if;

  new.data := d;
  return new;
end $fn$;

drop trigger if exists kec_guard_item on public.ecoclean_items;
create trigger kec_guard_item
  before update on public.ecoclean_items
  for each row execute function public.kec_guard_item();

-- ------------------------------------------------------------
-- 8) 읽기용 마스킹 뷰 — 화면에 내려가기 전에 금액을 지웁니다.
--    security_invoker 이므로 아래 RLS 가 그대로 적용됩니다.
-- ------------------------------------------------------------
create or replace function public.kec_mask(p_collection text, p_data jsonb)
returns jsonb language sql stable security definer
set search_path = public, extensions, pg_temp as $fn$
  select case public.kec_role()
    when 'admin' then p_data - 'password'
    when 'manager' then case when p_collection = 'sites'
      then p_data - 'password' - 'contract' - 'invoices' - 'payouts'
      else p_data - 'password' end
    when 'leader' then case when p_collection = 'sites'
      then jsonb_set(
             jsonb_set(
               p_data - 'password' - 'invoices',
               '{contract}',
               (coalesce(p_data->'contract', '{}'::jsonb) - 'feeAmount' - 'contractAmount'), false),
             '{payouts}',
             case when jsonb_typeof(p_data->'payouts') = 'array' then
               coalesce((select jsonb_agg(e) from jsonb_array_elements(p_data->'payouts') e
                          where coalesce(e->>'leaderId', '') = public.kec_account_id()
                             or coalesce(e->>'leaderName', '') = public.kec_me_name()), '[]'::jsonb)
             else '[]'::jsonb end, false)
      else p_data - 'password' end
    when 'customer' then case when p_collection = 'sites'
      then p_data - 'password' - 'secret' - 'contract' - 'payouts' - 'survey'
      else p_data - 'password' end
    else p_data - 'password' end;
$fn$;

create or replace view public.ecoclean_items_read
with (security_invoker = true) as
  select collection, id, public.kec_mask(collection, data) as data, updated_at
    from public.ecoclean_items;

-- ------------------------------------------------------------
-- 9) RLS — anon 은 전면 차단, authenticated 는 역할별 범위
-- ------------------------------------------------------------
alter table public.ecoclean_items enable row level security;

drop policy if exists "ecoclean items read"   on public.ecoclean_items;
drop policy if exists "ecoclean items insert" on public.ecoclean_items;
drop policy if exists "ecoclean items update" on public.ecoclean_items;
drop policy if exists "ecoclean items delete" on public.ecoclean_items;
drop policy if exists "kec items select" on public.ecoclean_items;
drop policy if exists "kec items insert" on public.ecoclean_items;
drop policy if exists "kec items update" on public.ecoclean_items;
drop policy if exists "kec items delete" on public.ecoclean_items;

revoke all on public.ecoclean_items      from anon;
revoke all on public.ecoclean_items      from authenticated;
revoke all on public.ecoclean_items_read from anon;
revoke all on public.ecoclean_items_read from authenticated;

grant select, insert, update, delete on public.ecoclean_items to authenticated;
grant select on public.ecoclean_items_read to authenticated;
grant execute on function public.ecoclean_items_touch() to authenticated;
grant execute on function public.kec_role() to authenticated;
grant execute on function public.kec_account_id() to authenticated;
grant execute on function public.kec_site_ids() to authenticated;
grant execute on function public.kec_can_see(text, text, jsonb) to authenticated;
grant execute on function public.kec_can_write(text, text, jsonb) to authenticated;

create policy "kec items select" on public.ecoclean_items
  for select to authenticated
  using (public.kec_can_see(collection, id, data));

create policy "kec items insert" on public.ecoclean_items
  for insert to authenticated
  with check (public.kec_can_write(collection, id, data));

create policy "kec items update" on public.ecoclean_items
  for update to authenticated
  using (public.kec_can_see(collection, id, data))
  with check (public.kec_can_write(collection, id, data));

create policy "kec items delete" on public.ecoclean_items
  for delete to authenticated
  using (public.kec_role() = 'admin');

-- ------------------------------------------------------------
-- 10) 1회용 코드 · 고객 방 입장 RPC (security definer)
--     anon 에게 테이블을 열지 않고, 검증된 1건만 돌려줍니다.
-- ------------------------------------------------------------
create or replace function public.kec_bind_member(
  p_uid uuid, p_account_id text, p_role text, p_site_ids text[],
  p_phone text, p_name text, p_quote_id text default ''
) returns void language plpgsql security definer
set search_path = public, extensions, pg_temp as $fn$
begin
  if p_uid is null or coalesce(p_account_id, '') = '' then return; end if;
  insert into public.kec_members (user_id, account_id, role, active, site_ids, phone, name, quote_id, updated_at)
  values (p_uid, p_account_id, p_role, true, coalesce(p_site_ids, '{}'::text[]),
          public.kec_digits(p_phone), coalesce(p_name, ''), coalesce(p_quote_id, ''), now())
  on conflict (user_id) do update
     set account_id = excluded.account_id, role = excluded.role, active = true,
         site_ids = excluded.site_ids, phone = excluded.phone, name = excluded.name,
         quote_id = excluded.quote_id, updated_at = now();
end $fn$;
revoke all on function public.kec_bind_member(uuid, text, text, text[], text, text, text) from anon, authenticated;

-- 고객 방·견적·직원 초대 입장을 한 곳에서 처리합니다.
create or replace function public.kec_room_entry(
  p_phone text, p_code text default '', p_name text default '', p_title text default '', p_email text default ''
) returns jsonb
language plpgsql security definer
set search_path = public, extensions, pg_temp as $fn$
declare
  v_uid uuid := auth.uid();
  v_phone text := public.kec_digits(p_phone);
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_row record;
  v_acc jsonb; v_acc_id text; v_site_id text; v_site jsonb;
  v_quote jsonb; v_contract jsonb; v_grant jsonb; v_kind text := '';
  v_role text; v_name text; v_title text; v_quote_id text := '';
  v_now timestamptz := now();
  v_iso text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if v_uid is null then
    raise exception '로그인 정보가 없습니다. 앱을 새로 열고 다시 시도해 주세요.' using errcode = 'P0001';
  end if;
  if v_phone = '' then
    raise exception '전화번호를 입력해 주세요.' using errcode = 'P0001';
  end if;

  -- ① 코드 없이: 이미 등록된 번호(고객 방 · 직원방)
  if v_code = '' then
    select data into v_acc from public.ecoclean_items
      where collection = 'accounts' and public.kec_digits(data->>'phone') = v_phone
        and coalesce((data->>'active')::boolean, true)
        and (data->>'role' = 'customer' or coalesce((data->>'staffAccess')::boolean, false))
      order by case when data->>'role' = 'customer' then 0 else 1 end
      limit 1;
    if v_acc is null then
      raise exception '아직 등록되지 않은 번호입니다. 대표가 보낸 1회용 코드를 함께 입력해 주세요.' using errcode = 'P0001';
    end if;
    v_acc_id := v_acc->>'id';
    v_role := case when v_acc->>'role' = 'customer' then 'customer' else 'leader' end;
    if v_role = 'customer' then
      v_site_id := coalesce(v_acc->>'siteId', '');
      v_quote_id := coalesce(v_acc->>'quoteId', '');
      if v_site_id <> '' then
        select data into v_site from public.ecoclean_items where collection = 'sites' and id = v_site_id;
        select data into v_grant from public.ecoclean_items
          where collection = 'leaderCodes' and id = v_acc_id || '::' || v_site_id;
      end if;
      if v_site_id = '' and v_quote_id = '' then
        raise exception '아직 방 입장 전인 번호입니다. 대표가 보낸 1회용 코드를 함께 입력해 주세요.' using errcode = 'P0001';
      end if;
      v_kind := 'customer';
    else
      v_kind := 'staff';
      v_site_id := '';
    end if;
    perform public.kec_bind_member(v_uid, v_acc_id, v_role,
      case when v_role = 'customer' then (case when v_site_id = '' then '{}'::text[] else array[v_site_id] end)
           else coalesce((select array_agg(x.value) from jsonb_array_elements_text(coalesce(v_acc->'assignedSiteIds', '[]'::jsonb)) x), '{}'::text[]) end,
      v_phone, v_acc->>'name', v_quote_id);
    if v_site is not null then v_site := public.kec_mask('sites', v_site); end if;
    return jsonb_build_object('kind', v_kind, 'account', v_acc, 'site', v_site,
                              'grant', v_grant, 'quote', null, 'contract', null);
  end if;

  -- ② 견적 초대코드
  select id, data into v_row from public.ecoclean_items
    where collection = 'quotes' and upper(coalesce(data->>'inviteCode', '')) = v_code limit 1;
  if v_row.id is not null then
    v_quote := v_row.data;
    if coalesce(v_quote->>'inviteUsedAt', '') <> '' then
      raise exception '이미 사용된 초대코드입니다. 대표에게 새 코드를 요청해 주세요.' using errcode = 'P0001';
    end if;
    if coalesce(v_quote->>'status', '') = 'draft' then
      raise exception '아직 발송 전인 견적입니다. 대표에게 확인해 주세요.' using errcode = 'P0001';
    end if;
    if coalesce(v_quote->>'status', '') = 'contracted' and coalesce(v_quote->>'siteId', '') <> '' then
      raise exception '이미 계약이 체결된 견적입니다. 등록된 번호로 입장해 주세요.' using errcode = 'P0001';
    end if;

    select data into v_acc from public.ecoclean_items
      where collection = 'accounts' and data->>'role' = 'customer'
        and public.kec_digits(data->>'phone') = v_phone limit 1;
    if v_acc is not null and coalesce(v_acc->>'siteId', '') <> '' then
      raise exception '이미 다른 현장에 등록된 번호입니다. 대표에게 문의해 주세요.' using errcode = 'P0001';
    end if;
    if v_acc is not null and coalesce((v_acc->>'active')::boolean, true) = false then
      raise exception '사용이 중지된 번호입니다. 대표에게 문의해 주세요.' using errcode = 'P0001';
    end if;

    if v_acc is null then
      v_acc_id := 'acc_customer_' || substr(md5(random()::text || v_phone), 1, 12);
      v_acc := jsonb_build_object(
        'id', v_acc_id, 'role', 'customer',
        'name', coalesce(nullif(btrim(coalesce(p_name, '')), ''), '고객 ' || right(v_phone, 4)),
        'title', coalesce(nullif(btrim(coalesce(p_title, '')), ''), '담당자'),
        'email', coalesce(p_email, ''), 'phone', v_phone,
        'phonePretty', substr(v_phone, 1, 3) || '-' || substr(v_phone, 4, 4) || '-' || substr(v_phone, 8, 4),
        'siteId', '', 'quoteId', v_row.id, 'active', true,
        'createdAt', v_iso, 'source', 'quote-invite');
      insert into public.ecoclean_items (collection, id, data) values ('accounts', v_acc_id, v_acc);
    else
      v_acc_id := v_acc->>'id';
      v_acc := v_acc || jsonb_build_object('quoteId', v_row.id, 'updatedAt', v_iso);
      update public.ecoclean_items set data = v_acc where collection = 'accounts' and id = v_acc_id;
    end if;

    v_quote := v_quote || jsonb_build_object('inviteUsedAt', v_iso, 'inviteUsedBy', v_acc_id,
                                             'invitedPhone', v_phone, 'updatedAt', v_iso);
    update public.ecoclean_items set data = v_quote where collection = 'quotes' and id = v_row.id;

    perform public.kec_bind_member(v_uid, v_acc_id, 'customer', '{}'::text[], v_phone, v_acc->>'name', v_row.id);
    return jsonb_build_object('kind', 'quote', 'account', v_acc, 'site', null,
                              'grant', null, 'quote', v_quote, 'contract', null);
  end if;

  -- ③ 직원 1회용 초대코드
  select id, data into v_row from public.ecoclean_items
    where collection = 'staffContracts' and upper(coalesce(data->>'inviteCode', '')) = v_code limit 1;
  if v_row.id is not null then
    v_contract := v_row.data;
    if coalesce(v_contract->>'inviteUsedAt', '') <> '' then
      raise exception '이미 사용된 초대코드입니다. 대표에게 새 코드를 요청해 주세요.' using errcode = 'P0001';
    end if;
    if coalesce(v_contract->>'status', '') = 'draft' then
      raise exception '아직 발송 전인 계약서입니다. 대표에게 확인해 주세요.' using errcode = 'P0001';
    end if;

    select data into v_acc from public.ecoclean_items
      where collection = 'accounts' and public.kec_digits(data->>'phone') = v_phone limit 1;
    if v_acc is not null and v_acc->>'role' = 'customer' then
      raise exception '고객 번호로는 직원관리방에 입장할 수 없습니다.' using errcode = 'P0001';
    end if;
    if v_acc is not null and coalesce(v_contract->>'accountId', '') <> '' and v_acc->>'id' <> (v_contract->>'accountId') then
      raise exception '다른 직원에게 발급된 초대코드입니다.' using errcode = 'P0001';
    end if;

    if v_acc is null then
      v_acc_id := 'acc_staff_' || substr(md5(random()::text || v_phone), 1, 12);
      v_acc := jsonb_build_object(
        'id', v_acc_id, 'role', 'leader',
        'name', coalesce(nullif(v_contract->>'name', ''), nullif(btrim(coalesce(p_name, '')), ''), '직원 ' || right(v_phone, 4)),
        'title', coalesce(nullif(v_contract->>'roleTitle', ''), '팀장'),
        'phone', v_phone,
        'phonePretty', substr(v_phone, 1, 3) || '-' || substr(v_phone, 4, 4) || '-' || substr(v_phone, 8, 4),
        'password', '',
        'leaderCode', 'TL-' || lpad((floor(random() * 10000))::int::text, 4, '0'),
        'assignedSiteIds', coalesce(v_contract->'siteIds', '[]'::jsonb),
        'staffAccess', true,
        'employmentType', coalesce(v_contract->>'employmentType', ''),
        'active', true, 'createdAt', v_iso, 'source', 'staff-invite');
    else
      v_acc_id := v_acc->>'id';
      v_acc := v_acc || jsonb_build_object(
        'staffAccess', true,
        'employmentType', coalesce(nullif(v_contract->>'employmentType', ''), v_acc->>'employmentType', ''),
        'assignedSiteIds', (
          select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from (
            select jsonb_array_elements_text(coalesce(v_acc->'assignedSiteIds', '[]'::jsonb)) as x
            union
            select jsonb_array_elements_text(coalesce(v_contract->'siteIds', '[]'::jsonb))
          ) s where x is not null),
        'updatedAt', v_iso);
    end if;
    insert into public.ecoclean_items (collection, id, data) values ('accounts', v_acc_id, v_acc)
      on conflict (collection, id) do update set data = excluded.data;

    v_contract := v_contract || jsonb_build_object('accountId', v_acc_id, 'inviteUsedAt', v_iso,
                                                   'inviteUsedBy', v_acc_id, 'updatedAt', v_iso);
    update public.ecoclean_items set data = v_contract where collection = 'staffContracts' and id = v_row.id;

    perform public.kec_bind_member(v_uid, v_acc_id, 'leader',
      coalesce((select array_agg(x.value) from jsonb_array_elements_text(coalesce(v_contract->'siteIds', '[]'::jsonb)) x), '{}'::text[]),
      v_phone, v_acc->>'name', '');
    return jsonb_build_object('kind', 'staff', 'account', v_acc, 'site', null,
                              'grant', null, 'quote', null, 'contract', v_contract);
  end if;

  -- ④ 청소 확인 1회용 코드
  select id, data into v_row from public.ecoclean_items
    where collection = 'inviteCodes' and upper(coalesce(data->>'code', '')) = v_code limit 1;
  if v_row.id is null then
    raise exception '등록되지 않은 초대코드입니다. 코드를 다시 확인해 주세요.' using errcode = 'P0001';
  end if;
  if coalesce(v_row.data->>'usedAt', '') <> '' then
    raise exception '이미 사용된 코드입니다. 추가 인원은 대표에게 새 1회용 코드를 발급받아 주세요.' using errcode = 'P0001';
  end if;

  v_site_id := coalesce(v_row.data->>'siteId', '');
  select data into v_site from public.ecoclean_items where collection = 'sites' and id = v_site_id;
  if v_site is null then
    raise exception '코드에 연결된 현장을 찾을 수 없습니다.' using errcode = 'P0001';
  end if;

  select data into v_acc from public.ecoclean_items
    where collection = 'accounts' and data->>'role' = 'customer'
      and public.kec_digits(data->>'phone') = v_phone limit 1;
  if v_acc is not null and coalesce((v_acc->>'active')::boolean, true) = false then
    raise exception '사용이 중지된 번호입니다. 대표에게 문의해 주세요.' using errcode = 'P0001';
  end if;
  if v_acc is not null and coalesce(v_acc->>'siteId', '') <> '' and v_acc->>'siteId' <> v_site_id then
    raise exception '이미 다른 현장에 등록된 번호입니다. 담당자에게 문의해 주세요.' using errcode = 'P0001';
  end if;

  if v_acc is null then
    v_name := btrim(coalesce(p_name, ''));
    v_title := btrim(coalesce(p_title, ''));
    if v_title = '' and position(' ' in v_name) > 0 then
      v_title := btrim(substr(v_name, position(' ' in v_name) + 1));
      v_name := btrim(split_part(v_name, ' ', 1));
    end if;
    v_acc_id := 'acc_customer_' || substr(md5(random()::text || v_phone), 1, 12);
    v_acc := jsonb_build_object(
      'id', v_acc_id, 'role', 'customer',
      'name', coalesce(nullif(v_name, ''), '고객 ' || right(v_phone, 4)),
      'title', coalesce(nullif(v_title, ''), '담당자'),
      'email', coalesce(p_email, ''), 'phone', v_phone,
      'phonePretty', substr(v_phone, 1, 3) || '-' || substr(v_phone, 4, 4) || '-' || substr(v_phone, 8, 4),
      'siteId', v_site_id, 'active', true, 'createdAt', v_iso, 'source', 'code');
    insert into public.ecoclean_items (collection, id, data) values ('accounts', v_acc_id, v_acc);
  else
    v_acc_id := v_acc->>'id';
    if coalesce(v_acc->>'siteId', '') = '' then
      v_acc := v_acc || jsonb_build_object('siteId', v_site_id, 'updatedAt', v_iso);
      update public.ecoclean_items set data = v_acc where collection = 'accounts' and id = v_acc_id;
    end if;
  end if;

  update public.ecoclean_items
     set data = data || jsonb_build_object('usedAt', v_iso, 'usedBy', v_acc_id)
   where collection = 'inviteCodes' and id = v_row.id;

  v_grant := jsonb_build_object('id', v_acc_id || '::' || v_site_id, 'accountId', v_acc_id,
                                'siteId', v_site_id, 'codeId', v_row.id, 'source', 'code',
                                'createdAt', v_iso);
  insert into public.ecoclean_items (collection, id, data)
  values ('leaderCodes', v_acc_id || '::' || v_site_id, v_grant)
  on conflict (collection, id) do update set data = excluded.data;

  perform public.kec_bind_member(v_uid, v_acc_id, 'customer', array[v_site_id], v_phone, v_acc->>'name', '');
  if v_site is not null then v_site := public.kec_mask('sites', v_site); end if;
  return jsonb_build_object('kind', 'customer', 'account', v_acc, 'site', v_site,
                            'grant', v_grant, 'quote', null, 'contract', null);
end $fn$;

revoke all on function public.kec_room_entry(text, text, text, text, text) from public;
grant execute on function public.kec_room_entry(text, text, text, text, text) to anon, authenticated;

-- 로그인한 고객이 새 1회용 코드를 등록할 때(추가 인원 · 재입장)
create or replace function public.kec_redeem_room_code(p_code text)
returns jsonb language plpgsql security definer
set search_path = public, extensions, pg_temp as $fn$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_acc_id text := public.kec_account_id();
  v_site_id text;
  v_row record; v_grant jsonb;
  v_iso text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if public.kec_role() <> 'customer' or v_acc_id = '' then
    raise exception '고객 로그인이 필요합니다.' using errcode = 'P0001';
  end if;
  select unnest(site_ids) into v_site_id from public.kec_members where user_id = auth.uid() and active limit 1;
  if v_code = '' then
    raise exception '청소코드를 입력해 주세요.' using errcode = 'P0001';
  end if;
  select id, data into v_row from public.ecoclean_items
    where collection = 'inviteCodes' and upper(coalesce(data->>'code', '')) = v_code limit 1;
  if v_row.id is null then
    raise exception '등록되지 않은 청소코드입니다. 코드를 다시 확인해 주세요.' using errcode = 'P0001';
  end if;
  if coalesce(v_row.data->>'siteId', '') <> coalesce(v_site_id, '') then
    raise exception '다른 현장에 발급된 코드입니다. 담당자에게 다시 요청해 주세요.' using errcode = 'P0001';
  end if;
  if coalesce(v_row.data->>'usedAt', '') <> '' then
    raise exception '이미 사용된 청소코드입니다. 새 코드를 발급받아 주세요.' using errcode = 'P0001';
  end if;

  update public.ecoclean_items
     set data = data || jsonb_build_object('usedAt', v_iso, 'usedBy', v_acc_id)
   where collection = 'inviteCodes' and id = v_row.id;

  v_grant := jsonb_build_object('id', v_acc_id || '::' || v_site_id, 'accountId', v_acc_id,
                                'siteId', v_site_id, 'codeId', v_row.id, 'source', 'code',
                                'createdAt', v_iso);
  insert into public.ecoclean_items (collection, id, data)
  values ('leaderCodes', v_acc_id || '::' || v_site_id, v_grant)
  on conflict (collection, id) do update set data = excluded.data;

  return jsonb_build_object('code', v_row.data || jsonb_build_object('usedAt', v_iso, 'usedBy', v_acc_id),
                            'grant', v_grant);
end $fn$;

revoke all on function public.kec_redeem_room_code(text) from public;
grant execute on function public.kec_redeem_room_code(text) to authenticated;

-- ------------------------------------------------------------
-- 11) 홈 상담 신청 — 비로그인 방문자도 접수만 가능 (읽기는 대표만)
-- ------------------------------------------------------------
create or replace function public.kec_submit_inquiry(p_data jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions, pg_temp as $fn$
declare
  v_id text := 'inq_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
  d jsonb := coalesce(p_data, '{}'::jsonb);
  v_iso text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_out jsonb;
begin
  v_out := jsonb_build_object(
    'id', v_id,
    'spaceType', left(coalesce(d->>'spaceType', ''), 60),
    'district',  left(coalesce(d->>'district', ''), 60),
    'size',      left(coalesce(d->>'size', ''), 60),
    'frequency', left(coalesce(d->>'frequency', ''), 60),
    'timeWindow', left(coalesce(d->>'timeWindow', ''), 60),
    'phone',     left(coalesce(d->>'phone', ''), 40),
    'memo',      left(coalesce(d->>'memo', ''), 600),
    'message',   left(coalesce(d->>'message', ''), 1200),
    'channel',   left(coalesce(d->>'channel', 'app'), 20),
    'status',    'received',
    'createdAt', v_iso,
    'source',    'public'
  );
  insert into public.ecoclean_items (collection, id, data) values ('inquiries', v_id, v_out);
  return jsonb_build_object('id', v_id, 'createdAt', v_iso);
end $fn$;

revoke all on function public.kec_submit_inquiry(jsonb) from public;
grant execute on function public.kec_submit_inquiry(jsonb) to anon, authenticated;

-- ------------------------------------------------------------
-- 12) Storage — 업로드는 로그인한 사용자만 (읽기는 공개 주소 그대로)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('ecoclean-files', 'ecoclean-files', true)
on conflict (id) do update set public = true;

drop policy if exists "ecoclean files upload" on storage.objects;
create policy "ecoclean files upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'ecoclean-files');

drop policy if exists "ecoclean files update" on storage.objects;
create policy "ecoclean files update"
  on storage.objects for update to authenticated
  using (bucket_id = 'ecoclean-files')
  with check (bucket_id = 'ecoclean-files');

drop policy if exists "ecoclean files delete" on storage.objects;
create policy "ecoclean files delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'ecoclean-files' and public.kec_role() = 'admin');

-- ------------------------------------------------------------
-- 13) Realtime — 변경 알림 발행 유지
-- ------------------------------------------------------------
do $fn$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ecoclean_items'
  ) then
    alter publication supabase_realtime add table public.ecoclean_items;
  end if;
end $fn$;

-- ------------------------------------------------------------
-- 14) 기존 계정 → Auth 사용자 · 구성원 표 채우기 (평문 비밀번호 정리 포함)
-- ------------------------------------------------------------
update public.ecoclean_items set data = data where collection = 'accounts';

-- ------------------------------------------------------------
-- 15) 확인용
-- ------------------------------------------------------------
-- select collection, count(*) from public.ecoclean_items group by collection order by collection;
-- select m.role, count(*) from public.kec_members m group by m.role;
-- select id, email from auth.users order by email;
