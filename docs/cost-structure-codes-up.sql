-- ============================================================================
--  هجرة: رموز هيكل التكاليف — ربط بنود «مصروفات الوكلاء» بمجموعاتها
--  جدولٌ واحدٌ جديد  ·  بأمر المالك في ٢٩ سبتمبر ٢٠٢٦
--
--  لماذا
--  -----
--  هيكل التكاليف في تقارير المركب ستّ مجموعات بحروف:
--    A عمولات الوكلاء · B البنكر · C المشتريات · D ميناء ومناولة
--    E تكاليف تشغيل ثابتة (المرتّبات) · F أخرى
--  وربط بنود دفتر المركب بمجموعاتها كان ثابتاً في الكود، وتغييره من الشاشة
--  يضيع بإغلاقها. فصار يُحفظ هنا، ويعدّله الأدمن من شاشة التقرير.
--
--  وما يُحفظ هو بنود سطر «مصروفات الوكلاء» وحدها (A / D / F). البنكر والمشتريات
--  والمرتّبات سطورٌ ثابتة من قائمة الدخل (B / C / E) فلا صفّ لها هنا — والقيد
--  يمنعها. والبند الغائب يأخذ تصنيفه الافتراضيّ من الواجهة.
--
--  الأمان
--  ------
--  إنشاءٌ محض: جدولٌ جديدٌ لا وجود له، ولا صفَّ يُكتب، ولا جدولَ قائمٌ يُمسّ.
--  متكرّرة الأمان: `IF NOT EXISTS`، والقيود بأسمائها تُفحص قبل الإضافة.
--  RLS بلا سياسات وسحب الصلاحيّات من أدوار Supabase المباشرة: الباك يتّصل بدور
--  مالك الجدول فلا تمسّه RLS (بلا FORCE)، ولا يقرأ الجدولَ أحدٌ بمفتاح anon.
--
--  التشغيل:  node scripts/run-migration.js docs/cost-structure-codes-up.sql
--  التراجع:  docs/cost-structure-codes-down.sql
-- ============================================================================

BEGIN;

DO $$
BEGIN
  RAISE NOTICE 'قبل الهجرة: cost_item_codes %',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
                      WHERE table_schema = 'public' AND table_name = 'cost_item_codes')
         THEN 'موجودٌ سلفاً — لا يُعاد إنشاؤه' ELSE 'غير موجود — يُنشأ' END;
END $$;

CREATE TABLE IF NOT EXISTS cost_item_codes (
  item_key    varchar(60)   PRIMARY KEY,
  code        char(1)       NOT NULL,
  updated_by  varchar(120)  NOT NULL DEFAULT '',
  updated_at  timestamptz   NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cost_item_codes_code_chk') THEN
    ALTER TABLE cost_item_codes ADD CONSTRAINT cost_item_codes_code_chk CHECK (code IN ('A', 'D', 'F'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cost_item_codes_locked_chk') THEN
    ALTER TABLE cost_item_codes ADD CONSTRAINT cost_item_codes_locked_chk
      CHECK (item_key NOT IN ('fuel', 'purchases', 'salaries'));
  END IF;
END $$;

DO $$
DECLARE r text;
BEGIN
  ALTER TABLE cost_item_codes ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON cost_item_codes FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON cost_item_codes FROM %I', r);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'cost_item_codes') THEN
    RAISE EXCEPTION 'VERIFY FAILED: cost_item_codes لم يُنشأ';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cost_item_codes'::regclass) THEN
    RAISE EXCEPTION 'VERIFY FAILED: RLS غير مفعّل على cost_item_codes';
  END IF;
  RAISE NOTICE 'بعد الهجرة: cost_item_codes موجود · صفوفه %', (SELECT count(*) FROM cost_item_codes);
END $$;

COMMIT;
