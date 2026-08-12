-- ═══ P1.1A · فحص ما قبل الهجرة · استعلام واحد · قراءة فقط ═══
--
-- نسخة «طلقة واحدة» من p11a-00-pre-migration-check.sql.
-- السبب: محرّر Supabase يعرض نتيجة **آخر تعليمة فقط**، فتشغيل الملف متعدّد
-- التعليمات كان يُخفي ستة أقسام من سبعة — ومنها بوابة التوقّف نفسها.
-- هنا كل الفحوص تعود في جدول واحد بصفوف (section · item · value).
--
-- ⚠️ الصف الأول يجب أن يقول NONE — OK. أي اسم جدول محاسبي ظاهر ⇒ STOP.
WITH acct_tables(t) AS (VALUES
  ('legal_entities'),('cost_centers'),('accounting_accounts'),('journals'),
  ('fiscal_years'),('fiscal_periods'),('accounting_fx_rates'),
  ('journal_entries'),('journal_lines')),
acct_fns(f) AS (VALUES
  ('accounting_je_immutable'),('accounting_jl_immutable'),
  ('accounting_je_assert_balanced'),('accounting_je_period_guard')),
rows_out AS (
  SELECT 10 ord, '1 · GATE' sec, 'accounting tables already present' item,
         COALESCE((SELECT string_agg(tablename,', ' ORDER BY tablename) FROM pg_tables
                    WHERE schemaname='public' AND tablename IN (SELECT t FROM acct_tables)),
                  'NONE — OK') val
  UNION ALL SELECT 11,'1 · GATE','accounting functions already present',
         COALESCE((SELECT string_agg(proname,', ' ORDER BY proname) FROM pg_proc
                    WHERE proname IN (SELECT f FROM acct_fns)), 'NONE — OK')
  UNION ALL SELECT 20,'2 · COUNTS','invoices',            (SELECT count(*)::text FROM invoices)
  UNION ALL SELECT 21,'2 · COUNTS','payments',            (SELECT count(*)::text FROM payments)
  UNION ALL SELECT 22,'2 · COUNTS','suppliers',           (SELECT count(*)::text FROM suppliers)
  UNION ALL SELECT 23,'2 · COUNTS','vessels',             (SELECT count(*)::text FROM vessels)
  UNION ALL SELECT 24,'2 · COUNTS','purchase_orders',     (SELECT count(*)::text FROM purchase_orders)
  UNION ALL SELECT 25,'2 · COUNTS','customers',           (SELECT count(*)::text FROM customers)
  UNION ALL SELECT 26,'2 · COUNTS','hire_invoices',       (SELECT count(*)::text FROM hire_invoices)
  UNION ALL SELECT 27,'2 · COUNTS','management_invoices', (SELECT count(*)::text FROM management_invoices)
  UNION ALL SELECT 28,'2 · COUNTS','users',               (SELECT count(*)::text FROM users)
  UNION ALL SELECT 30 + row_number() OVER (ORDER BY data_origin, settlement_basis),
         '3 · LEGACY', data_origin||' / '||settlement_basis, count(*)::text
    FROM invoices GROUP BY data_origin, settlement_basis
  UNION ALL SELECT 50 + row_number() OVER (ORDER BY currency),
         '4 · INVOICES BY CCY', currency,
         count(*)||' inv · total '||to_char(sum(total_amount),'FM999999999990.00')
                 ||' · paid '||to_char(sum(paid_amount),'FM999999999990.00')
    FROM invoices GROUP BY currency
  UNION ALL SELECT 70 + row_number() OVER (ORDER BY currency),
         '5 · PAYMENTS BY CCY', currency,
         count(*)||' pay · total '||to_char(sum(amount),'FM999999999990.00')
    FROM payments GROUP BY currency
  UNION ALL SELECT 90,'6 · R3A CONSTRAINTS','invoices constraints',
         (SELECT string_agg(conname,', ' ORDER BY conname) FROM pg_constraint con
            JOIN pg_class cl ON cl.oid=con.conrelid WHERE cl.relname='invoices')
  UNION ALL SELECT 91,'7 · FINGERPRINT','business_schema_md5',
         (SELECT md5(string_agg(table_name||'.'||column_name||':'||data_type, ',' ORDER BY table_name, column_name))
            FROM information_schema.columns WHERE table_schema='public'
             AND table_name IN ('invoices','payments','suppliers','vessels','purchase_orders',
                                'customers','hire_invoices','management_invoices','users'))
  UNION ALL SELECT 92,'8 · SCHEMA OBJECTS','tables / triggers / functions',
         (SELECT count(*) FROM pg_tables WHERE schemaname='public')::text ||' / '||
         (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal)::text ||' / '||
         (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')::text
)
SELECT sec AS section, item, val AS value FROM rows_out ORDER BY ord;
