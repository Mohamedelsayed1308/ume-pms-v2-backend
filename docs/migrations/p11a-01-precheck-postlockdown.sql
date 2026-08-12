-- ═══════════════════════════════════════════════════════════════════════════
-- P1.1A · فحص ما قبل الهجرة — بعد إغلاق الـData API · قراءة فقط
--
-- نسخة محدَّثة من الفحص القبلي تضيف بُعداً لم يكن موجوداً وقت تصميمه: التأكد من
-- أن إغلاق الـData API (الالتزام 084fc298) ما زال قائماً قبل إضافة تسعة جداول.
--
-- استعلام واحد: محرّر Supabase يعرض نتيجة آخر تعليمة فقط.
-- كله SELECT · لا يكتب · لا يقفل · لا يطبع أي سرّ.
-- ═══════════════════════════════════════════════════════════════════════════

WITH acct_tables(t) AS (VALUES
  ('legal_entities'),('cost_centers'),('accounting_accounts'),('journals'),
  ('fiscal_years'),('fiscal_periods'),('accounting_fx_rates'),
  ('journal_entries'),('journal_lines')),
acct_fns(f) AS (VALUES
  ('accounting_je_immutable'),('accounting_jl_immutable'),
  ('accounting_je_assert_balanced'),('accounting_je_period_guard')),
app_tables(t) AS (VALUES
  ('agency_history'),('attachments'),('currencies'),('customers'),('exchange_rates'),
  ('hire_invoice_items'),('hire_invoices'),('hire_payments'),('import_batches'),
  ('invoices'),('items'),('management_invoices'),('management_payments'),
  ('market_import_logs'),('market_records'),('market_reports'),('payments'),
  ('permissions'),('profit_periods'),('purchase_orders'),('role_permissions'),
  ('shipping_companies'),('suppliers'),('task_comments'),('tasks'),('users'),
  ('vessel_profit_data'),('vessels')),
rows_out AS (

  -- ══ 1 · بوابة التصادم — أي صف غير "NONE" يعني STOP ═══════════════════════
  SELECT 10 ord,'1 · GATE' sec,'accounting tables already present' item,
         COALESCE((SELECT string_agg(tablename,', ' ORDER BY tablename) FROM pg_tables
                    WHERE schemaname='public' AND tablename IN (SELECT t FROM acct_tables)),
                  'NONE — OK') val
  UNION ALL
  SELECT 11,'1 · GATE','accounting functions already present',
         COALESCE((SELECT string_agg(proname,', ' ORDER BY proname) FROM pg_proc
                    WHERE proname IN (SELECT f FROM acct_fns)),'NONE — OK')
  UNION ALL
  SELECT 12,'1 · GATE','accounting triggers already present',
         COALESCE((SELECT string_agg(tgname,', ' ORDER BY tgname) FROM pg_trigger
                    WHERE NOT tgisinternal
                      AND tgname IN ('trg_je_immutable','trg_jl_immutable',
                                     'trg_je_balanced_deferred','trg_je_period_guard')),
                  'NONE — OK')
  UNION ALL
  SELECT 13,'1 · GATE','accounting indexes already present',
         COALESCE((SELECT string_agg(indexname,', ' ORDER BY indexname) FROM pg_indexes
                    WHERE schemaname='public'
                      AND (indexname LIKE 'uq~_je%' ESCAPE '~' OR indexname LIKE 'uq~_jl%' ESCAPE '~'
                        OR indexname LIKE 'uq~_acct%' ESCAPE '~' OR indexname LIKE 'idx~_je%' ESCAPE '~'
                        OR indexname LIKE 'idx~_jl%' ESCAPE '~' OR indexname LIKE 'idx~_fx%' ESCAPE '~')),
                  'NONE — OK')

  -- ══ 2 · إغلاق الـData API ما زال قائماً ═════════════════════════════════
  UNION ALL
  SELECT 20,'2 · SECURITY','app tables reachable by anon (expected NONE)',
         COALESCE((SELECT string_agg(DISTINCT table_name,', ') FROM information_schema.role_table_grants
                    WHERE table_schema='public' AND grantee='anon'
                      AND table_name IN (SELECT t FROM app_tables)),'NONE — OK')
  UNION ALL
  SELECT 21,'2 · SECURITY','app tables reachable by authenticated (expected NONE)',
         COALESCE((SELECT string_agg(DISTINCT table_name,', ') FROM information_schema.role_table_grants
                    WHERE table_schema='public' AND grantee='authenticated'
                      AND table_name IN (SELECT t FROM app_tables)),'NONE — OK')
  UNION ALL
  SELECT 22,'2 · SECURITY','app tables with RLS (expected 28/28)',
         (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
             AND c.relname IN (SELECT t FROM app_tables))::text||' / 28'
  UNION ALL
  SELECT 23,'2 · SECURITY','default ACL · postgres/public/TABLES',
         COALESCE((SELECT d.defaclacl::text FROM pg_default_acl d
                    WHERE pg_get_userbyid(d.defaclrole)='postgres'
                      AND d.defaclnamespace::regnamespace::text='public'
                      AND d.defaclobjtype='r'),'(none)')

  -- ══ 3 · خط الأساس الإنتاجي ══════════════════════════════════════════════
  UNION ALL
  SELECT 30,'3 · COUNTS','entities',
         'invoices='||(SELECT count(*) FROM invoices)
         ||' payments='||(SELECT count(*) FROM payments)
         ||' suppliers='||(SELECT count(*) FROM suppliers)
         ||' vessels='||(SELECT count(*) FROM vessels)
         ||' purchase_orders='||(SELECT count(*) FROM purchase_orders)
         ||' customers='||(SELECT count(*) FROM customers)
         ||' hire_invoices='||(SELECT count(*) FROM hire_invoices)
         ||' management_invoices='||(SELECT count(*) FROM management_invoices)
         ||' users='||(SELECT count(*) FROM users)
  UNION ALL
  SELECT 40 + row_number() OVER (ORDER BY currency),'4 · INVOICES BY CCY', currency,
         count(*)||' inv | total '||to_char(sum(total_amount),'FM999999999990.00')
                 ||' | paid '||to_char(sum(paid_amount),'FM999999999990.00')
    FROM invoices GROUP BY currency
  UNION ALL
  SELECT 50 + row_number() OVER (ORDER BY currency),'5 · PAYMENTS BY CCY', currency,
         count(*)||' pay | total '||to_char(sum(amount),'FM999999999990.00')
    FROM payments GROUP BY currency
  UNION ALL
  SELECT 60 + row_number() OVER (ORDER BY data_origin, settlement_basis),'6 · R3A LEGACY',
         data_origin||' / '||settlement_basis, count(*)::text
    FROM invoices GROUP BY data_origin, settlement_basis
  UNION ALL
  SELECT 70,'7 · R3A CONSTRAINTS','invoices',
         COALESCE((SELECT string_agg(conname,', ' ORDER BY conname)
                     FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid
                    WHERE cl.relname='invoices'
                      AND conname IN ('chk_inv_data_origin','chk_inv_settlement_basis',
                                      'chk_inv_presystem_requires_batch','fk_invoices_import_batch')),
                  'MISSING — STOP')
)
SELECT sec AS section, item, val AS value FROM rows_out ORDER BY ord, item;
