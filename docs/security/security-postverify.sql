-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY REMEDIATION · SUPABASE DATA API LOCKDOWN · تحقّق ما بعد التنفيذ
--
-- كله SELECT. قارن كل صف بالمتوقَّع المكتوب بجانبه، وبنتيجة security-precheck.
-- ═══════════════════════════════════════════════════════════════════════════

WITH app_tables(t) AS (VALUES
  ('agency_history'),('attachments'),('currencies'),('customers'),('exchange_rates'),
  ('hire_invoice_items'),('hire_invoices'),('hire_payments'),('import_batches'),
  ('invoices'),('items'),('management_invoices'),('management_payments'),
  ('market_import_logs'),('market_records'),('market_reports'),('payments'),
  ('permissions'),('profit_periods'),('purchase_orders'),('role_permissions'),
  ('shipping_companies'),('suppliers'),('task_comments'),('tasks'),('users'),
  ('vessel_profit_data'),('vessels')),
priv AS (
  SELECT g.table_name, g.grantee,
         string_agg(g.privilege_type, ',' ORDER BY g.privilege_type) AS p
    FROM information_schema.role_table_grants g
   WHERE g.table_schema='public' AND g.grantee IN ('anon','authenticated','service_role')
   GROUP BY g.table_name, g.grantee),
rows_out AS (

  -- ══ الحكم الحاسم — يجب أن يكون صفراً ═══════════════════════════════════
  SELECT 10 ord,'A · VERDICT' sec,'tables still reachable by anon' item,
         COALESCE((SELECT string_agg(table_name,', ' ORDER BY table_name) FROM priv
                    WHERE grantee='anon' AND table_name IN (SELECT t FROM app_tables)),
                  'NONE — OK') val
  UNION ALL
  SELECT 11,'A · VERDICT','tables still reachable by authenticated',
         COALESCE((SELECT string_agg(table_name,', ' ORDER BY table_name) FROM priv
                    WHERE grantee='authenticated' AND table_name IN (SELECT t FROM app_tables)),
                  'NONE — OK')
  UNION ALL
  SELECT 12,'A · VERDICT','app tables with RLS enabled (expected 28/28)',
         (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
             AND c.relname IN (SELECT t FROM app_tables))::text||' / 28'
  UNION ALL
  SELECT 13,'A · VERDICT','permissive policies created (expected 0)',
         (SELECT count(*) FROM pg_policies
           WHERE schemaname='public' AND tablename IN (SELECT t FROM app_tables))::text
  UNION ALL
  SELECT 14,'A · VERDICT','FORCE RLS used (expected 0)',
         (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relforcerowsecurity
             AND c.relname IN (SELECT t FROM app_tables))::text

  -- ══ عدم الانحدار — service_role ودور الباك ═════════════════════════════
  UNION ALL
  SELECT 20,'B · NO REGRESSION','service_role table access (expected 28)',
         (SELECT count(DISTINCT table_name) FROM priv
           WHERE grantee='service_role' AND table_name IN (SELECT t FROM app_tables))::text
  UNION ALL
  SELECT 21,'B · NO REGRESSION','postgres (Railway) on invoices',
         concat_ws(',',
           CASE WHEN has_table_privilege('postgres','public.invoices','SELECT') THEN 'SELECT' END,
           CASE WHEN has_table_privilege('postgres','public.invoices','INSERT') THEN 'INSERT' END,
           CASE WHEN has_table_privilege('postgres','public.invoices','UPDATE') THEN 'UPDATE' END,
           CASE WHEN has_table_privilege('postgres','public.invoices','DELETE') THEN 'DELETE' END)
  UNION ALL
  SELECT 22,'B · NO REGRESSION','postgres (Railway) on payments',
         concat_ws(',',
           CASE WHEN has_table_privilege('postgres','public.payments','SELECT') THEN 'SELECT' END,
           CASE WHEN has_table_privilege('postgres','public.payments','INSERT') THEN 'INSERT' END,
           CASE WHEN has_table_privilege('postgres','public.payments','UPDATE') THEN 'UPDATE' END,
           CASE WHEN has_table_privilege('postgres','public.payments','DELETE') THEN 'DELETE' END)

  -- ══ الصلاحيات الافتراضية بعد الإصلاح ═══════════════════════════════════
  UNION ALL
  SELECT 30,'C · DEFAULT ACL',
         'grantor='||pg_get_userbyid(d.defaclrole)
         ||' | schema='||COALESCE(d.defaclnamespace::regnamespace::text,'(all)')
         ||' | objtype='||CASE d.defaclobjtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES'
                                               WHEN 'f' THEN 'FUNCTIONS' WHEN 'T' THEN 'TYPES'
                                               WHEN 'n' THEN 'SCHEMAS' ELSE d.defaclobjtype::text END,
         d.defaclacl::text
    FROM pg_default_acl d
   WHERE d.defaclobjtype = 'r'

  -- ══ عدم الانحدار المالي — قارن حرفياً بنتيجة precheck ══════════════════
  UNION ALL
  SELECT 40,'D · FINANCIAL','entities',
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
  SELECT 50 + row_number() OVER (ORDER BY currency),'E · INVOICES BY CCY', currency,
         count(*)||' inv | total '||to_char(sum(total_amount),'FM999999999990.00')
                 ||' | paid '||to_char(sum(paid_amount),'FM999999999990.00')
    FROM invoices GROUP BY currency
  UNION ALL
  SELECT 60 + row_number() OVER (ORDER BY currency),'F · PAYMENTS BY CCY', currency,
         count(*)||' pay | total '||to_char(sum(amount),'FM999999999990.00')
    FROM payments GROUP BY currency
  UNION ALL
  -- ⚠️ `status` من نوع enum لا نصّ — التحويل إلى text قبل COALESCE إلزامي.
  SELECT 70 + row_number() OVER (ORDER BY status::text),'G · INVOICE STATUS',
         COALESCE(status::text,'(null)'), count(*)::text
    FROM invoices GROUP BY status
  UNION ALL
  SELECT 80 + row_number() OVER (ORDER BY data_origin, settlement_basis),'H · R3A LEGACY',
         data_origin||' / '||settlement_basis, count(*)::text
    FROM invoices GROUP BY data_origin, settlement_basis
  UNION ALL
  SELECT 90,'I · R3A CONSTRAINTS','invoices',
         COALESCE((SELECT string_agg(conname,', ' ORDER BY conname)
                     FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid
                    WHERE cl.relname='invoices'
                      AND conname IN ('chk_inv_data_origin','chk_inv_settlement_basis',
                                      'chk_inv_presystem_requires_batch','fk_invoices_import_batch')),
                  'MISSING — STOP')
  UNION ALL
  SELECT 91,'J · FINGERPRINT','business_schema_md5',
         (SELECT md5(string_agg(table_name||'.'||column_name||':'||data_type, ',' ORDER BY table_name, column_name))
            FROM information_schema.columns
           WHERE table_schema='public' AND table_name IN (SELECT t FROM app_tables))
)
SELECT sec AS section, item, val AS value FROM rows_out ORDER BY ord, item;
