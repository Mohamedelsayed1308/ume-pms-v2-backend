-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY REMEDIATION · SUPABASE DATA API LOCKDOWN · DOWN (تراجع)
--
-- يعيد **بالضبط** ما غيّره UP ولا شيء غيره:
--   1. منح الصلاحيات المسحوبة على الجداول الـ28 لـanon و authenticated
--   2. إعادة الصلاحيات الافتراضية للجداول المستقبلية
--   3. تعطيل RLS على الجداول الـ28
--
-- ⚠️ تشغيل هذا السكربت **يُعيد فتح الـData API على كل بيانات الإنتاج**.
--    لا يُنفَّذ إلا لاستعادة الخدمة عند انكسار مستهلك شرعي لم نكتشفه.
--
-- خط الأساس المُستعاد هو المرصود قبل التنفيذ: `arwdDxtm` لكلا الدورين على
-- الجداول الـ28، و RLS معطّل، والافتراضيات تمنح الدورين صلاحيات كاملة.
--
-- لا يمسّ بيانات · لا يمسّ مخططاً · لا يمسّ service_role · لا يمسّ المصادقة.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1 · إعادة صلاحيات الجداول ──────────────────────────────────────────────
DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agency_history','attachments','currencies','customers','exchange_rates',
    'hire_invoice_items','hire_invoices','hire_payments','import_batches',
    'invoices','items','management_invoices','management_payments',
    'market_import_logs','market_records','market_reports','payments',
    'permissions','profit_periods','purchase_orders','role_permissions',
    'shipping_companies','suppliers','task_comments','tasks','users',
    'vessel_profit_data','vessels'] LOOP

    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname='public' AND c.relname = t AND c.relkind='r') THEN
      FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
          EXECUTE format('GRANT ALL ON public.%I TO %I', t, r);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- ── 2 · إعادة الصلاحيات الافتراضية ─────────────────────────────────────────
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO authenticated;

-- ── 3 · تعطيل RLS ──────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agency_history','attachments','currencies','customers','exchange_rates',
    'hire_invoice_items','hire_invoices','hire_payments','import_batches',
    'invoices','items','management_invoices','management_payments',
    'market_import_logs','market_records','market_reports','payments',
    'permissions','profit_periods','purchase_orders','role_permissions',
    'shipping_companies','suppliers','task_comments','tasks','users',
    'vessel_profit_data','vessels'] LOOP

    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname='public' AND c.relname = t AND c.relkind='r'
                  AND c.relrowsecurity) THEN
      EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

COMMIT;
