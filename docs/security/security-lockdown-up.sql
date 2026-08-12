-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY REMEDIATION · SUPABASE DATA API LOCKDOWN · UP
--
-- الغرض: جعل جداول UME PMS الـ28 في `public` غير قابلة للوصول مباشرةً عبر
-- Supabase Data API لدورَي `anon` و`authenticated` — مع بقاء NestJS/Railway
-- المسار الطبيعي الوحيد للتطبيق.
--
-- ما لا يفعله هذا السكربت — ولا سطر واحد منه:
--   لا INSERT · لا UPDATE · لا DELETE · لا TRUNCATE · لا تعديل بيانات أعمال
--   لا تغيير مخطط (جدول/عمود/قيد/فهرس/مشغّل) · لا مساس بالمصادقة
--   لا مساس بنموذج صلاحيات التطبيق · لا مساس بـservice_role
--   لا مساس بمخططات Supabase المُدارة (auth · storage · realtime · graphql…)
--
-- كله داخل معاملة واحدة: نجاح كامل أو تراجع كامل.
-- متكرّر الأمان: التشغيل الثاني لا يغيّر شيئاً.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1 · سحب صلاحيات الجداول من anon و authenticated ────────────────────────
--
-- `REVOKE ALL` يغطّي القائمة كاملة: SELECT · INSERT · UPDATE · DELETE ·
-- TRUNCATE · REFERENCES · TRIGGER · MAINTAIN.
--
-- ⚠️ السحب هو الحماية الحقيقية لا RLS: **RLS لا يحكم TRUNCATE إطلاقاً**،
--    و TRUNCATE لا يُشغّل مشغّلات الصفوف — فبدون السحب يُمحى جدول كامل بأمر واحد.
--
-- الجداول مُعدَّدة صراحةً (لا `ALL TABLES IN SCHEMA`) حتى يكون النطاق مقروءاً
-- ومراجَعاً، ولا يمتدّ بالمصادفة إلى أي جدول تُنشئه Supabase لاحقاً في `public`.
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
          EXECUTE format('REVOKE ALL ON public.%I FROM %I', t, r);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- ── 2 · الصلاحيات الافتراضية للجداول المستقبلية ────────────────────────────
--
-- خط الأساس المرصود:
--   grantor=postgres · schema=public · objtype=TABLES
--   {postgres=arwdDxtm/postgres, anon=arwdDxtm/postgres,
--    authenticated=arwdDxtm/postgres, service_role=arwdDxtm/postgres}
--
-- أي جدول جديد يُنشئه دور `postgres` في `public` كان يرث تلقائياً صلاحيات
-- كاملة لـ`anon` و`authenticated` — **بلا أن يطلبها أحد وبلا أن ينبّه أحد**.
-- هذا هو الجذر: بدون إصلاحه يعود التعرُّض مع أول جدول قادم.
--
-- النطاق دقيق ومقصود:
--   • المانح  `postgres` وحده — وهو منشئ كل جداول التطبيق (المالك المرصود).
--     صفوف `supabase_admin` الافتراضية **لا تُمسّ**: مُدارة من المنصّة، ولا
--     تُنشأ جداول التطبيق بها.
--   • المخطط `public` وحده — لا `storage` ولا `auth` ولا `realtime` ولا غيرها.
--   • نوع الكائن `TABLES` وحده — الدوال والتسلسلات خارج نطاق هذا الإصدار
--     (لا يعرضها الـData API كجداول). مسجَّلة كدَيْن أمني متبقٍّ.
--   • `service_role` **لا يُمسّ** — مفتاح خادمي لا يُشحن للعملاء.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM authenticated;

-- ── 3 · RLS · دفاع في العمق ────────────────────────────────────────────────
--
-- ليس بديلاً عن السحب بل طبقة ثانية تحسّباً لأي منح عريض مستقبلي
-- (`GRANT ... ON ALL TABLES`) يُعيد فتح الباب بلا انتباه.
--
-- مالك الجدول (`postgres` — وهو دور اتصال Railway) **يتجاوز RLS** بحكم Postgres،
-- فلا أثر على عمل الباك. مُثبَت عملياً قبل هذا الإصدار.
-- ولا سياسة واحدة تُنشأ: تفعيل RLS بلا سياسات = منع كامل لغير المالك.
--
-- `FORCE ROW LEVEL SECURITY` **غير مستخدم** عمداً — كان سيُخضِع المالك نفسه
-- لـRLS ويُعطّل الباك، ولم يُثبَت أمانه في هذا السياق.
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
                  AND NOT c.relrowsecurity) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

COMMIT;
