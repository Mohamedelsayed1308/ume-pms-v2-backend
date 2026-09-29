-- ============================================================================
--  فحص مرتّبات الأطقم — للقراءة فقط (لا يكتب ولا يغيّر شيئاً)
--
--  يُشغَّل قبل الهجرة وبعدها وعلى أيّ بيئة. المعاملة READ ONLY وتُختم بـ ROLLBACK.
--  كلّ بندٍ يطبع «OK …»، وأيّ بندٍ يفشل يرمي «CHECK FAILED: …».
--
--  قبل الهجرة: يتحقّق من القيد الفريد على exchange_rates.month ويطبع أنّ الجداول لم تُنشأ بعد.
--  بعد الهجرة: الجداول الأحد عشر، وRLS، وخلوّ الأدوار العامّة من أيّ صلاحيّة، وأنّ دور الاتّصال
--  (دور الباك) مالكٌ لها، والمشغّلات، وسحب التنفيذ العامّ للدوالّ.
--
--  التشغيل:  node scripts/run-migration.js docs/crew-salaries-verify.sql
--  (المشغّل يطبع «نُفّذت الهجرة» عند النجاح — الملفّ نفسه لا يكتب شيئاً)
-- ============================================================================

BEGIN READ ONLY;

DO $$
DECLARE
  tbls text[] := ARRAY['crew_salary_cycles','crew_salary_files','crew_salary_decisions','crew_salary_links',
    'crew_salary_authorizations','crew_salary_bank_accounts','crew_salary_versions','crew_salary_entitlements',
    'crew_salary_exports','crew_salary_export_rows','crew_salary_audit'];
  t text; r text; p text; n int; present int := 0; owner_role text;
BEGIN
  RAISE NOTICE 'دور الاتّصال: %', current_user;

  -- ١) القيد الفريد على exchange_rates.month (كتابة السعر تستعمل ON CONFLICT (month))
  IF to_regclass('public.exchange_rates') IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED: جدول exchange_rates غير موجود';
  END IF;
  SELECT count(*) INTO n FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
   WHERE i.indrelid = 'public.exchange_rates'::regclass AND i.indisunique AND i.indnatts = 1 AND a.attname = 'month';
  IF n = 0 THEN RAISE EXCEPTION 'CHECK FAILED: لا قيد فريد على exchange_rates.month — الكتابة الذرّيّة للسعر تفشل'; END IF;
  RAISE NOTICE 'OK 1: exchange_rates.month فريد';

  -- ٢) الجداول
  FOREACH t IN ARRAY tbls LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN present := present + 1; END IF;
  END LOOP;
  IF present = 0 THEN
    RAISE NOTICE 'OK 2: الهجرة لم تُطبَّق بعد — لا جدول مرتّبات (فحص ما قبل الهجرة انتهى)';
    RETURN;
  END IF;
  IF present <> array_length(tbls, 1) THEN
    RAISE EXCEPTION 'CHECK FAILED: موجود % من % جداول — هجرةٌ ناقصة', present, array_length(tbls, 1);
  END IF;
  RAISE NOTICE 'OK 2: الجداول الأحد عشر موجودة';

  -- ٣) RLS مفعّلة على كلّها، وبلا سياسات (فلا يمرّ دورٌ خاضعٌ لها)، وبلا FORCE (فيعمل المالك)
  FOREACH t IN ARRAY tbls LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'CHECK FAILED: RLS غير مفعّلة على %', t;
    END IF;
    IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'CHECK FAILED: FORCE RLS على % — دور الباك المالك سيُمنع', t;
    END IF;
    SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND tablename = t;
    IF n > 0 THEN RAISE EXCEPTION 'CHECK FAILED: على % سياساتٌ (%) — المقصود لا سياسات', t, n; END IF;
  END LOOP;
  RAISE NOTICE 'OK 3: RLS مفعّلة بلا سياسات وبلا FORCE على الأحد عشر';

  -- ٤) لا صلاحيّة لـ PUBLIC ولا anon ولا authenticated ولا service_role (service_role يتجاوز RLS)
  FOREACH t IN ARRAY tbls LOOP
    FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
          IF has_table_privilege(r, 'public.' || t, p) THEN
            RAISE EXCEPTION 'CHECK FAILED: الدور % يملك % على %', r, p, t;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
    SELECT count(*) INTO n FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = t AND grantee = 'PUBLIC';
    IF n > 0 THEN RAISE EXCEPTION 'CHECK FAILED: صلاحيّاتٌ لـ PUBLIC على %', t; END IF;
  END LOOP;
  RAISE NOTICE 'OK 4: لا صلاحيّة للأدوار العامّة (anon · authenticated · service_role · PUBLIC) على أيّ جدول';

  -- ٥) دور الاتّصال (دور الباك) يملك الجداول — فيعمل رغم RLS
  FOREACH t IN ARRAY tbls LOOP
    SELECT pg_get_userbyid(relowner) INTO owner_role FROM pg_class WHERE oid = ('public.' || t)::regclass;
    IF NOT pg_has_role(current_user, owner_role, 'USAGE') THEN
      RAISE EXCEPTION 'CHECK FAILED: دور الاتّصال % ليس مالك % (المالك %) — شغّل الفحص بدور الباك', current_user, t, owner_role;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK 5: دور الاتّصال % مالكٌ للجداول (أو عضوٌ في دور المالك)', current_user;

  -- ٦) مشغّلات الحماية
  FOREACH t IN ARRAY ARRAY['crew_salary_audit_no_change','crew_salary_audit_no_truncate','crew_salary_versions_no_truncate',
    'crew_salary_versions_frozen','crew_salary_export_rows_guard','crew_salary_export_rows_no_truncate'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t AND NOT tgisinternal AND tgenabled <> 'D') THEN
      RAISE EXCEPTION 'CHECK FAILED: المشغّل % غائبٌ أو معطَّل', t;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK 6: مشغّلات الإلحاق فقط وتجميد الإصدار وحماية صفوف الدفعات مفعّلة';

  -- ٧) الدوالّ الحارسة لا يستدعيها PUBLIC
  FOREACH t IN ARRAY ARRAY['crew_salary_audit_append_only','crew_salary_version_frozen','crew_salary_export_row_guard'] LOOP
    IF has_function_privilege('public', (t || '()')::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'CHECK FAILED: PUBLIC يملك تنفيذ %', t;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK 7: تنفيذ الدوالّ الحارسة مسحوبٌ من PUBLIC';

  -- ٨) صورة البيانات (أعدادٌ فقط — لا محتوى)
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
    RAISE NOTICE '   % : % صفّاً', t, n;
  END LOOP;
  RAISE NOTICE 'OK: كلّ الفحوص نجحت';
END $$;

ROLLBACK;
