-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY REMEDIATION · SUPABASE DATA API LOCKDOWN
-- المرحلة 1 · تجميد خط الأساس · قراءة فقط
--
-- كله SELECT. لا يكتب · لا يقفل · لا يطبع أي سرّ.
-- استعلام واحد عمداً: محرّر Supabase يعرض نتيجة آخر تعليمة فقط.
--
-- احتفظ بالنتيجة كاملة — هي المرجع الوحيد الذي تُقارَن به حالة ما بعد التنفيذ.
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

  -- ── 1 · جرد الجداول · المالك · RLS · السياسات · الصلاحيات ────────────────
  SELECT 100 ord, '1 · TABLE' sec, c.relname item,
         'owner='||pg_get_userbyid(c.relowner)
         ||' | rls='||CASE WHEN c.relrowsecurity
                           THEN CASE WHEN c.relforcerowsecurity THEN 'ON+FORCED' ELSE 'ON' END
                           ELSE 'OFF' END
         ||' | pol='||(SELECT count(*) FROM pg_policies p
                        WHERE p.schemaname='public' AND p.tablename=c.relname)::text
         ||' | anon='||COALESCE((SELECT p FROM priv WHERE table_name=c.relname AND grantee='anon'),'NONE')
         ||' | auth='||COALESCE((SELECT p FROM priv WHERE table_name=c.relname AND grantee='authenticated'),'NONE')
         ||' | svc='||COALESCE((SELECT p FROM priv WHERE table_name=c.relname AND grantee='service_role'),'NONE') val
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind='r'

  -- ── 2 · صلاحيات دور الباك (Railway) — يجب ألا تتأثر ─────────────────────
  UNION ALL
  SELECT 200,'2 · OWNER ROLE','postgres on invoices',
         concat_ws(',',
           CASE WHEN has_table_privilege('postgres','public.invoices','SELECT') THEN 'SELECT' END,
           CASE WHEN has_table_privilege('postgres','public.invoices','INSERT') THEN 'INSERT' END,
           CASE WHEN has_table_privilege('postgres','public.invoices','UPDATE') THEN 'UPDATE' END,
           CASE WHEN has_table_privilege('postgres','public.invoices','DELETE') THEN 'DELETE' END)

  -- ── 3 · الصلاحيات الافتراضية · المانح والمخطط ونوع الكائن ───────────────
  UNION ALL
  SELECT 300,'3 · DEFAULT ACL',
         'grantor='||pg_get_userbyid(d.defaclrole)
         ||' | schema='||COALESCE(d.defaclnamespace::regnamespace::text,'(all)')
         ||' | objtype='||CASE d.defaclobjtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES'
                                               WHEN 'f' THEN 'FUNCTIONS' WHEN 'T' THEN 'TYPES'
                                               WHEN 'n' THEN 'SCHEMAS' ELSE d.defaclobjtype::text END,
         d.defaclacl::text
    FROM pg_default_acl d

  -- ── 4 · إعدادات أدوار الـData API ────────────────────────────────────────
  UNION ALL
  SELECT 400,'4 · ROLE CONFIG', rolname, COALESCE(array_to_string(rolconfig,'  |  '),'—')
    FROM pg_roles WHERE rolname IN ('authenticator','anon','authenticated','service_role')

  -- ── 5 · بصمة القبول الإنتاجي · أعداد الكيانات ───────────────────────────
  UNION ALL
  SELECT 500,'5 · COUNTS','entities',
         'invoices='||(SELECT count(*) FROM invoices)
         ||' payments='||(SELECT count(*) FROM payments)
         ||' suppliers='||(SELECT count(*) FROM suppliers)
         ||' vessels='||(SELECT count(*) FROM vessels)
         ||' purchase_orders='||(SELECT count(*) FROM purchase_orders)
         ||' customers='||(SELECT count(*) FROM customers)
         ||' hire_invoices='||(SELECT count(*) FROM hire_invoices)
         ||' management_invoices='||(SELECT count(*) FROM management_invoices)
         ||' users='||(SELECT count(*) FROM users)

  -- ── 6 · البصمة المالية · كل عملة دفتر مستقل · لا إجمالي جامع ────────────
  UNION ALL
  SELECT 600 + row_number() OVER (ORDER BY currency), '6 · INVOICES BY CCY', currency,
         count(*)||' inv | total '||to_char(sum(total_amount),'FM999999999990.00')
                 ||' | paid '||to_char(sum(paid_amount),'FM999999999990.00')
    FROM invoices GROUP BY currency
  UNION ALL
  SELECT 650 + row_number() OVER (ORDER BY currency), '7 · PAYMENTS BY CCY', currency,
         count(*)||' pay | total '||to_char(sum(amount),'FM999999999990.00')
    FROM payments GROUP BY currency

  -- ── 7 · حالات الفواتير — يجب ألا تتغيّر ─────────────────────────────────
  -- ⚠️ `status` من نوع enum (`invoices_status_enum`) لا نصّ: التحويل إلى text
  --    **قبل** COALESCE إلزامي، وإلا حاول Postgres تحويل '(null)' إلى قيمة enum
  --    غير موجودة فيفشل الاستعلام كله.
  UNION ALL
  SELECT 700 + row_number() OVER (ORDER BY status::text), '8 · INVOICE STATUS',
         COALESCE(status::text,'(null)'), count(*)::text
    FROM invoices GROUP BY status

  -- ── 8 · التصنيف التاريخي R3A · 128 = 123 + 5 ────────────────────────────
  UNION ALL
  SELECT 800 + row_number() OVER (ORDER BY data_origin, settlement_basis), '9 · R3A LEGACY',
         data_origin||' / '||settlement_basis, count(*)::text
    FROM invoices GROUP BY data_origin, settlement_basis

  -- ── 9 · قيود R3A الحيّة ─────────────────────────────────────────────────
  UNION ALL
  SELECT 900,'10 · R3A CONSTRAINTS','invoices',
         COALESCE((SELECT string_agg(conname,', ' ORDER BY conname)
                     FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid
                    WHERE cl.relname='invoices'
                      AND conname IN ('chk_inv_data_origin','chk_inv_settlement_basis',
                                      'chk_inv_presystem_requires_batch','fk_invoices_import_batch')),
                  'MISSING — STOP')

  -- ── 10 · بصمة بنية جداول الأعمال ────────────────────────────────────────
  UNION ALL
  SELECT 910,'11 · FINGERPRINT','business_schema_md5',
         (SELECT md5(string_agg(table_name||'.'||column_name||':'||data_type, ',' ORDER BY table_name, column_name))
            FROM information_schema.columns
           WHERE table_schema='public' AND table_name IN (SELECT t FROM app_tables))

  -- ── 11 · عدّ الجداول المستهدفة ──────────────────────────────────────────
  UNION ALL
  SELECT 920,'12 · SCOPE','app tables present / expected',
         (SELECT count(*) FROM pg_tables
           WHERE schemaname='public' AND tablename IN (SELECT t FROM app_tables))::text||' / 28'
)
SELECT sec AS section, item, val AS value FROM rows_out ORDER BY ord, item;
