/**
 * store-remote.example.js — Supabase 어댑터 예시 (앱에 포함되지 않음, 참고용)
 *
 * 지금 앱은 js/store.js 의 IndexedDbAdapter(기기 저장)로 동작합니다.
 * 여러 기기에서 같은 보고를 보려면 이 파일처럼 어댑터를 하나 만들어
 * `new Store(adapter)` 에 넘기면 됩니다. 화면 코드는 그대로 둡니다.
 *
 *   1) supabase.com 에서 프로젝트 생성 (무료 플랜)
 *   2) supabase-schema.sql 을 SQL Editor 에 실행
 *   3) index.html 에 supabase-js 를 추가
 *        <script type="module">
 *          import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
 *          window.__supabase = createClient('https://xxxx.supabase.co', 'anon-key');
 *        </script>
 *   4) js/app.js 에서 store 교체
 *        import { Store } from './store.js';
 *        import { createSupabaseAdapter } from './store-remote.example.js';
 *        export const store = new Store(createSupabaseAdapter(window.__supabase));
 *
 * 주의
 *  - anon key 는 공개되어도 되는 키지만 RLS 를 반드시 설정해야 합니다.
 *  - 상담 신청(inquiries)은 insert 만 허용하고 select 는 막으세요.
 *  - 비밀번호 검증은 절대 브라우저에서 하지 말고 Supabase Auth 로 옮기세요.
 */

const PHOTO_BUCKET = 'report-photos';

const siteFromRow = (row) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  clientName: row.client_name,
  category: row.category,
  address: row.address,
  area: row.area,
  frequency: row.frequency,
  intervalDays: row.interval_days,
  startDate: row.start_date,
  manager: row.manager,
  managerRole: row.manager_role,
  accessNote: row.access_note,
  contactName: row.contact_name,
  checklist: row.checklist || [],
});

const accountFromRow = (row) => ({
  id: row.id,
  role: row.role,
  name: row.name,
  title: row.title,
  phone: row.phone,
  phonePretty: row.phone,
  leaderCode: row.leader_code,
  siteId: row.site_id,
  assignedSiteIds: row.assigned_site_ids || [],
  active: row.active,
  createdAt: row.created_at,
});

const reportFromRow = (row) => {
  const photos = { security: [], cleaning: [], issue: [] };
  for (const photo of row.report_photos || []) {
    const ref = {
      id: photo.id,
      thumb: photo.thumb_url || photo.public_url,
      asset: photo.public_url,
      width: photo.width,
      height: photo.height,
      caption: photo.caption,
    };
    (photos[photo.photo_group] || photos.cleaning).push(ref);
  }
  return {
    id: row.id,
    siteId: row.site_id,
    siteCode: row.sites?.code,
    siteName: row.sites?.name,
    date: row.visited_on,
    time: (row.completed_at || '').slice(0, 5),
    leader: row.leader,
    leaderRole: row.leader_role,
    durationMin: row.duration_min,
    checklist: row.checklist || [],
    note: row.note,
    issueNote: row.issue_note || '',
    photos,
    createdAt: row.created_at,
    source: 'remote',
  };
};

export function createSupabaseAdapter(supabase) {
  return {
    async init() {
      const { error } = await supabase.from('sites').select('id').limit(1);
      if (error) throw new Error(`Supabase 연결 실패: ${error.message}`);
      return this;
    },

    async getAll(table) {
      if (table === 'sites') {
        const { data, error } = await supabase.from('sites').select('*').order('code');
        if (error) throw error;
        return data.map(siteFromRow);
      }

      if (table === 'reports') {
        const { data, error } = await supabase
          .from('reports')
          .select('*, sites(code,name), report_photos(*)')
          .order('visited_on', { ascending: false });
        if (error) throw error;
        return data.map(reportFromRow);
      }

      if (table === 'accounts') {
        const { data, error } = await supabase.from('accounts').select('*');
        if (error) throw error;
        return data.map(accountFromRow);
      }

      if (table === 'roomCodes') {
        const { data, error } = await supabase.from('room_codes').select('*').order('issued_at', { ascending: false });
        if (error) throw error;
        return data.map((row) => ({
          id: row.id,
          siteId: row.site_id,
          code: row.code,
          note: row.note,
          issuedAt: row.issued_at,
          usedAt: row.used_at,
          usedBy: row.used_by,
        }));
      }

      if (table === 'grants') {
        const { data, error } = await supabase.from('grants').select('*');
        if (error) throw error;
        return data.map((row) => ({
          id: row.id,
          accountId: row.account_id,
          siteId: row.site_id,
          codeId: row.code_id,
          createdAt: row.created_at,
        }));
      }

      if (table === 'inquiries') {
        const { data, error } = await supabase.from('inquiries').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return data.map((row) => ({ ...row, spaceType: row.space_type, timeWindow: row.time_window }));
      }

      const { data, error } = await supabase.from('app_meta').select('*');
      if (error) throw error;
      return data;
    },

    async get(table, key) {
      const rows = await this.getAll(table);
      return rows.find((row) => row.id === key || row.key === key);
    },

    async put(table, value) {
      if (table === 'photos') {
        // Storage 업로드 → report_photos 행 추가 (base64 대신 URL 저장)
        const path = `${value.reportId || 'unassigned'}/${value.id}.jpg`;
        const blob = await (await fetch(value.dataUrl)).blob();
        const { error: uploadError } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
        if (uploadError) throw uploadError;

        const { data: publicUrl } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
        const { error } = await supabase.from('report_photos').insert({
          id: value.id,
          report_id: value.reportId,
          photo_group: value.group || 'cleaning',
          storage_path: path,
          public_url: publicUrl.publicUrl,
          thumb_url: value.thumbUrl || publicUrl.publicUrl,
          caption: value.caption,
          width: value.width,
          height: value.height,
        });
        if (error) throw error;
        return value;
      }

      if (table === 'roomCodes') {
        const { error } = await supabase.from('room_codes').insert({
          site_id: value.siteId,
          code: value.code,
          note: value.note,
          issued_at: value.issuedAt,
          used_at: value.usedAt,
          used_by: value.usedBy,
        });
        if (error) throw error;
        return value;
      }

      if (table === 'grants') {
        const { error } = await supabase.from('grants').upsert({
          id: value.id,
          account_id: value.accountId,
          site_id: value.siteId,
          code_id: value.codeId,
        });
        if (error) throw error;
        return value;
      }

      if (table === 'inquiries') {
        const { error } = await supabase.from('inquiries').insert({
          space_type: value.spaceType,
          district: value.district,
          size: value.size,
          frequency: value.frequency,
          time_window: value.timeWindow,
          phone: value.phone,
          memo: value.memo,
          message: value.message,
        });
        if (error) throw error;
        return value;
      }

      if (table === 'meta') {
        const { error } = await supabase.from('app_meta').upsert({ key: value.key, value: value.value });
        if (error) throw error;
        return value;
      }

      const { error } = await supabase.from('accounts').upsert(value);
      if (error) throw error;
      return value;
    },

    async remove(table, key) {
      const map = { reports: 'reports', photos: 'report_photos', roomCodes: 'room_codes', grants: 'grants' };
      if (table === 'photos') {
        await supabase.storage.from(PHOTO_BUCKET).remove([`${key}.jpg`]);
      }
      const name = map[table];
      if (!name) return;
      const { error } = await supabase.from(name).delete().eq('id', key);
      if (error) throw error;
    },

    async clear() {
      // 서버 데이터는 지우지 않습니다. 데모 초기화는 로컬에서만.
    },

    close() {},
  };
}
