/**
 * store-remote.example.js — (참고용) 원격 저장소 어댑터를 직접 만들 때의 안내.
 *
 * v2.5.0 부터는 이 파일 대신 js/supabase-client.js 가 실제로 쓰입니다.
 *  · SupabaseClient : public.ecoclean_items 테이블 + ecoclean-files 버킷 REST/Storage 클라이언트
 *  · SupabaseSync   : 기기 저장소(IndexedDB)를 그대로 두고 그 위에 덮는 동기화 계층
 *
 * 쓰는 법 (js/store.js 에서 이미 이렇게 연결합니다)
 *   import { attachSupabaseSync } from './supabase-client.js';
 *   const instance = new Store(adapter);
 *   attachSupabaseSync(instance);   // 이후 store.init() 이 hydrate → seed → 주기 동기화까지 처리
 *
 * 서버 컬렉션 이름 (앱 내부 이름 → collection)
 *   sites · reports · inquiries · accounts · quotes · contracts · staffContracts
 *   · supplyCatalog · supplyOrders · meta
 *   roomCodes → inviteCodes, grants → leaderCodes, staffChecks → attitudeLogs
 *
 * 로그인 세션(meta/session)은 기기 전용이라 서버로 올리지 않습니다(DEVICE_LOCAL_KEYS).
 * 스키마는 supabase-schema.sql 을 그대로 실행하면 됩니다.
 */
export const STORE_REMOTE_REFERENCE = 'js/supabase-client.js';
