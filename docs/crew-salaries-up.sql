-- ============================================================================
--  هجرة: مرتّبات أطقم السفن (Fleet Crew Salaries) — عشرة جداول جديدة
--  بطلب المالك ٢٧ سبتمبر ٢٠٢٦
--
--  لماذا
--  -----
--  رسالة المرتّبات الشهريّة لكلّ مركب تُستورد كما هي، ويُستخرج منها ومن تصديرات
--  CFM ما يلزم لحسابٍ مستقلّ، ثمّ مراجعةٌ واعتمادٌ بإصداراتٍ لا تُمحى، ثمّ تصدير.
--
--  • crew_salary_cycles           دورةٌ لكلّ مركبٍ وشهر
--  • crew_salary_files            الملفّات الأصليّة (الرسالة ومرفقاتها وتصديرات CFM) — خاصّة داخل القاعدة
--  • crew_salary_decisions        قرارات المراجعة والتصحيحات والبنود اليدويّة — تُستبدل ولا تُمحى
--  • crew_salary_links            ربط اسمٍ برقم بحّار بعد تأكيد إنسان — يُعاد استعماله
--  • crew_salary_bank_accounts    حسابات الصرف — المستورَد لا يُعتمد تلقائيّاً
--  • crew_salary_authorizations   تفويضات المستفيد غير البحّار
--  • crew_salary_versions         إصدارات الاعتماد بلقطةٍ كاملة (البنود والسعر والحسابات)
--  • crew_salary_entitlements     الاستحقاقات المعتمدة — فهرسٌ فريد يمنع ازدواجها
--  • crew_salary_exports          سجلّ التصدير (والتصدير ليس سداداً)
--  • crew_salary_audit            سجلّ التدقيق — إلحاقٌ فقط: مشغّلٌ يرفض التعديل والحذف
--
--  وأسعار الصرف من جدول `exchange_rates` القائم (لا جدول موازٍ)، وتُحفظ لقطتها في الإصدار.
--
--  الأمان
--  ------
--  إنشاءٌ محض: جداول جديدة لا وجود لها، ولا صفّ يُكتب، ولا جدولٌ قائمٌ يُمسّ.
--  متكرّرة الأمان: `IF NOT EXISTS` في كلّ جدولٍ وفهرس، والمشغّل يُستبدل.
--  لا مفاتيح أجنبيّة إلى `users`: المعرّف ولقطة الاسم تُحفظ عند الحدث (كـ security_events).
--
--  التشغيل:  node scripts/run-migration.js docs/crew-salaries-up.sql
--  التراجع:  docs/crew-salaries-down.sql
-- ============================================================================

BEGIN;

DO $$
BEGIN
  RAISE NOTICE 'قبل الهجرة: crew_salary_cycles %',
    CASE WHEN to_regclass('public.crew_salary_cycles') IS NOT NULL
         THEN 'موجودٌ سلفاً — لا يُعاد إنشاؤه' ELSE 'غير موجود — يُنشأ' END;
END $$;

CREATE TABLE IF NOT EXISTS crew_salary_cycles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel               varchar(120)  NOT NULL,
  month                varchar(7)    NOT NULL,
  status               varchar(20)   NOT NULL DEFAULT 'draft',
  current_version      integer       NOT NULL DEFAULT 0,
  approved_version_id  uuid,
  created_by           uuid,
  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_crew_salary_cycles_vessel_month" ON crew_salary_cycles (vessel, month);

CREATE TABLE IF NOT EXISTS crew_salary_files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id       uuid REFERENCES crew_salary_cycles(id) ON DELETE RESTRICT,
  parent_id      uuid REFERENCES crew_salary_files(id) ON DELETE RESTRICT,
  position       integer,
  kind           varchar(30)   NOT NULL,
  name           varchar(255)  NOT NULL,
  ext            varchar(12)   NOT NULL DEFAULT '',
  mime           varchar(100),
  size           integer       NOT NULL DEFAULT 0,
  sha256         varchar(64)   NOT NULL,
  content        bytea,
  class          varchar(30)   NOT NULL DEFAULT 'unsupported',
  status         varchar(20)   NOT NULL DEFAULT 'stored',
  flags          jsonb         NOT NULL DEFAULT '[]'::jsonb,
  meta           jsonb         NOT NULL DEFAULT '{}'::jsonb,
  parsed         jsonb,
  supersedes_id  uuid REFERENCES crew_salary_files(id) ON DELETE RESTRICT,
  uploaded_by    uuid,
  uploaded_at    timestamptz   NOT NULL DEFAULT now()
);
-- الملفّ المرفوع نفسه لا يُخزَّن مرّتين (المرفق داخل رسالةٍ يتبع رسالته)
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_crew_salary_files_top_sha" ON crew_salary_files (sha256) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_crew_salary_files_parent_pos" ON crew_salary_files (parent_id, position) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS "IDX_crew_salary_files_cycle" ON crew_salary_files (cycle_id);

CREATE TABLE IF NOT EXISTS crew_salary_decisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id        uuid         NOT NULL REFERENCES crew_salary_cycles(id) ON DELETE RESTRICT,
  kind            varchar(30)  NOT NULL,
  target_key      varchar(300) NOT NULL,
  value           jsonb        NOT NULL DEFAULT '{}'::jsonb,
  reason          text         NOT NULL DEFAULT '',
  decided_by      uuid,
  decided_by_name varchar(150) NOT NULL DEFAULT '',
  decided_at      timestamptz  NOT NULL DEFAULT now(),
  superseded_at   timestamptz
);
-- قرارٌ ساري واحد لكلّ هدف — والسابق يبقى تاريخاً
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_crew_salary_decisions_live" ON crew_salary_decisions (cycle_id, kind, target_key) WHERE superseded_at IS NULL;

CREATE TABLE IF NOT EXISTS crew_salary_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key      varchar(300) NOT NULL,
  crew_id         varchar(40)  NOT NULL,
  confirmed_by    uuid,
  confirmed_by_name varchar(150) NOT NULL DEFAULT '',
  confirmed_at    timestamptz  NOT NULL DEFAULT now(),
  revoked_at      timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_crew_salary_links_live" ON crew_salary_links (source_key) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS crew_salary_authorizations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id          varchar(40)  NOT NULL,
  beneficiary      varchar(200) NOT NULL,
  relation         varchar(120) NOT NULL DEFAULT '',
  document_file_id uuid REFERENCES crew_salary_files(id) ON DELETE RESTRICT,
  valid_from       date,
  valid_to         date,
  status           varchar(20)  NOT NULL DEFAULT 'pending',
  note             text         NOT NULL DEFAULT '',
  created_by       uuid,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  reviewed_by      uuid,
  reviewed_by_name varchar(150) NOT NULL DEFAULT '',
  reviewed_at      timestamptz,
  review_reason    text         NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS "IDX_crew_salary_authorizations_crew" ON crew_salary_authorizations (crew_id);

CREATE TABLE IF NOT EXISTS crew_salary_bank_accounts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id                varchar(40)  NOT NULL,
  beneficiary            varchar(200) NOT NULL DEFAULT '',
  beneficiary_is_seafarer boolean,
  bank                   varchar(200) NOT NULL DEFAULT '',
  branch                 varchar(200) NOT NULL DEFAULT '',
  country                varchar(80)  NOT NULL DEFAULT '',
  iban                   varchar(64)  NOT NULL DEFAULT '',
  account_number         varchar(64)  NOT NULL DEFAULT '',
  swift                  varchar(20)  NOT NULL DEFAULT '',
  bank_code              varchar(40)  NOT NULL DEFAULT '',
  account_currency       varchar(3),
  source                 varchar(30)  NOT NULL DEFAULT 'manual',
  source_file_id         uuid REFERENCES crew_salary_files(id) ON DELETE RESTRICT,
  provenance             jsonb        NOT NULL DEFAULT '{}'::jsonb,
  fingerprint            varchar(64)  NOT NULL,
  status                 varchar(20)  NOT NULL DEFAULT 'imported',
  authorization_id       uuid REFERENCES crew_salary_authorizations(id) ON DELETE RESTRICT,
  reviewed_by            uuid,
  reviewed_by_name       varchar(150) NOT NULL DEFAULT '',
  reviewed_at            timestamptz,
  review_reason          text         NOT NULL DEFAULT '',
  created_by             uuid,
  created_at             timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_crew_salary_bank_accounts_fp" ON crew_salary_bank_accounts (crew_id, fingerprint);
-- حسابٌ معتمدٌ واحدٌ ساري لكلّ بحّار
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_crew_salary_bank_accounts_approved" ON crew_salary_bank_accounts (crew_id) WHERE status = 'approved';

CREATE TABLE IF NOT EXISTS crew_salary_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id          uuid          NOT NULL REFERENCES crew_salary_cycles(id) ON DELETE RESTRICT,
  version_no        integer       NOT NULL,
  status            varchar(20)   NOT NULL DEFAULT 'submitted',
  snapshot          jsonb         NOT NULL,
  totals            jsonb         NOT NULL DEFAULT '{}'::jsonb,
  fx_snapshot       jsonb,
  content_hash      varchar(64)   NOT NULL,
  submitted_by      uuid,
  submitted_by_name varchar(150)  NOT NULL DEFAULT '',
  submitted_at      timestamptz   NOT NULL DEFAULT now(),
  submit_reason     text          NOT NULL DEFAULT '',
  decided_by        uuid,
  decided_by_name   varchar(150)  NOT NULL DEFAULT '',
  decided_at        timestamptz,
  decision_reason   text          NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_crew_salary_versions_no" ON crew_salary_versions (cycle_id, version_no);

CREATE TABLE IF NOT EXISTS crew_salary_entitlements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id       uuid          NOT NULL REFERENCES crew_salary_versions(id) ON DELETE RESTRICT,
  cycle_id         uuid          NOT NULL REFERENCES crew_salary_cycles(id) ON DELETE RESTRICT,
  crew_id          varchar(40)   NOT NULL,
  currency         varchar(3)    NOT NULL,
  kind             varchar(30)   NOT NULL,
  period_start     date,
  period_end       date,
  amount           numeric(14,2) NOT NULL,
  entry_key        varchar(80)   NOT NULL,
  entitlement_key  varchar(300)  NOT NULL,
  active           boolean       NOT NULL DEFAULT true,
  created_at       timestamptz   NOT NULL DEFAULT now()
);
-- الاستحقاق الواحد لا يُعتمد مرّتين (في دورتين أو إصدارين ساريين)
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_crew_salary_entitlements_active" ON crew_salary_entitlements (entitlement_key) WHERE active;
CREATE INDEX IF NOT EXISTS "IDX_crew_salary_entitlements_crew" ON crew_salary_entitlements (crew_id);
CREATE INDEX IF NOT EXISTS "IDX_crew_salary_entitlements_entry" ON crew_salary_entitlements (cycle_id, entry_key) WHERE active;

CREATE TABLE IF NOT EXISTS crew_salary_exports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id         uuid          NOT NULL REFERENCES crew_salary_cycles(id) ON DELETE RESTRICT,
  version_id       uuid REFERENCES crew_salary_versions(id) ON DELETE RESTRICT,
  kind             varchar(30)   NOT NULL,
  batch_no         varchar(40)   NOT NULL,
  currency         varchar(3),
  file_sha256      varchar(64)   NOT NULL,
  row_count        integer       NOT NULL DEFAULT 0,
  is_redownload    boolean       NOT NULL DEFAULT false,
  content          bytea,
  exported_by      uuid,
  exported_by_name varchar(150)  NOT NULL DEFAULT '',
  exported_at      timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IDX_crew_salary_exports_cycle" ON crew_salary_exports (cycle_id);

CREATE TABLE IF NOT EXISTS crew_salary_audit (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id     uuid,
  entity       varchar(40)   NOT NULL,
  entity_id    varchar(80)   NOT NULL DEFAULT '',
  action       varchar(40)   NOT NULL,
  user_id      uuid,
  user_email   varchar(255)  NOT NULL DEFAULT '',
  user_name    varchar(150)  NOT NULL DEFAULT '',
  reason       text          NOT NULL DEFAULT '',
  details      jsonb         NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IDX_crew_salary_audit_cycle" ON crew_salary_audit (cycle_id, occurred_at);

-- سجلّ التدقيق وإصدارات الاعتماد الحاسمة: إلحاقٌ فقط
CREATE OR REPLACE FUNCTION crew_salary_audit_append_only() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION 'crew_salary_audit إلحاقٌ فقط — لا تعديل ولا حذف';
END
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS crew_salary_audit_no_change ON crew_salary_audit;
CREATE TRIGGER crew_salary_audit_no_change BEFORE UPDATE OR DELETE ON crew_salary_audit
  FOR EACH ROW EXECUTE FUNCTION crew_salary_audit_append_only();

-- والتفريغ الكامل أيضاً: TRUNCATE لا يمرّ بمشغّلات الصفوف
DROP TRIGGER IF EXISTS crew_salary_audit_no_truncate ON crew_salary_audit;
CREATE TRIGGER crew_salary_audit_no_truncate BEFORE TRUNCATE ON crew_salary_audit
  FOR EACH STATEMENT EXECUTE FUNCTION crew_salary_audit_append_only();
DROP TRIGGER IF EXISTS crew_salary_versions_no_truncate ON crew_salary_versions;
CREATE TRIGGER crew_salary_versions_no_truncate BEFORE TRUNCATE ON crew_salary_versions
  FOR EACH STATEMENT EXECUTE FUNCTION crew_salary_audit_append_only();

-- لقطة الإصدار لا تتغيّر بعد إنشائه (الحالة وحدها تتقدّم)
CREATE OR REPLACE FUNCTION crew_salary_version_frozen() RETURNS trigger AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'إصدار الاعتماد لا يُحذف';
  END IF;
  IF NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.totals IS DISTINCT FROM OLD.totals OR NEW.fx_snapshot IS DISTINCT FROM OLD.fx_snapshot
     OR NEW.version_no IS DISTINCT FROM OLD.version_no OR NEW.cycle_id IS DISTINCT FROM OLD.cycle_id THEN
    RAISE EXCEPTION 'لقطة إصدار الاعتماد لا تُعدَّل — أنشئ إصداراً جديداً';
  END IF;
  RETURN NEW;
END
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS crew_salary_versions_frozen ON crew_salary_versions;
CREATE TRIGGER crew_salary_versions_frozen BEFORE UPDATE OR DELETE ON crew_salary_versions
  FOR EACH ROW EXECUTE FUNCTION crew_salary_version_frozen();


-- ── منع الوصول المباشر (Supabase Data API والأدوار الافتراضيّة) ──
-- الباك يتّصل بدور مالك الجداول عبر DATABASE_URL، والمالك لا تُطبَّق عليه RLS (بلا FORCE)،
-- فيعمل كما هو. أمّا anon وauthenticated فتمنعهما RLS بلا سياسات، وسحب الصلاحيات يمنع
-- الثلاثة — ومنهم service_role الذي يتجاوز RLS، ومفتاحه في الباك للتخزين وحده.
-- نمطٌ قائم في المشروع: docs/migrations/gubal-foundation-up.sql
DO $rls$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crew_salary_cycles','crew_salary_files','crew_salary_decisions','crew_salary_links',
    'crew_salary_authorizations','crew_salary_bank_accounts','crew_salary_versions','crew_salary_entitlements',
    'crew_salary_exports','crew_salary_audit'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON %I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
  REVOKE ALL ON FUNCTION crew_salary_audit_append_only() FROM PUBLIC;
  REVOKE ALL ON FUNCTION crew_salary_version_frozen() FROM PUBLIC;
END $rls$;

DO $$
DECLARE t text; missing text := '';
BEGIN
  FOREACH t IN ARRAY ARRAY['crew_salary_cycles','crew_salary_files','crew_salary_decisions','crew_salary_links',
    'crew_salary_authorizations','crew_salary_bank_accounts','crew_salary_versions','crew_salary_entitlements',
    'crew_salary_exports','crew_salary_audit'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN missing := missing || ' ' || t; END IF;
  END LOOP;
  IF missing <> '' THEN RAISE EXCEPTION 'VERIFY FAILED: لم يُنشأ:%', missing; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname LIKE 'crew\_salary\_%' AND c.relkind = 'r' AND NOT c.relrowsecurity) THEN
    RAISE EXCEPTION 'VERIFY FAILED: جدول مرتّباتٍ بلا RLS';
  END IF;
  RAISE NOTICE 'بعد الهجرة: الجداول العشرة موجودة، وRLS مفعّلة، والوصول المباشر مسحوب';
END $$;

COMMIT;
