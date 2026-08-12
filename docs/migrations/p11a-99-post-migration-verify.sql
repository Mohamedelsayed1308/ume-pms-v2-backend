-- ═══ P1.1A · تحقّق ما بعد الهجرة · قراءة فقط ═══
-- كله SELECT. شغّله بعد نجاح UP وقارن كل نتيجة بالمتوقَّع المكتوب بجانبها.

-- ── 1 · الجداول التسعة ─── متوقَّع: 9 صفوف ──────────────────────────────────
SELECT tablename FROM pg_tables
 WHERE schemaname='public'
   AND tablename IN ('legal_entities','cost_centers','accounting_accounts','journals',
                     'fiscal_years','fiscal_periods','accounting_fx_rates',
                     'journal_entries','journal_lines')
 ORDER BY tablename;

-- ── 2 · قيود CHECK ─── متوقَّع: 20 ──────────────────────────────────────────
SELECT cl.relname AS table_name, con.conname
  FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid
 WHERE con.contype='c' AND con.conname LIKE 'chk_%'
   AND cl.relname IN ('accounting_accounts','fiscal_periods','journal_entries',
                      'journal_lines','accounting_fx_rates')
 ORDER BY 1,2;

SELECT count(*) AS check_constraints_expected_20
  FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid
 WHERE con.contype='c' AND con.conname LIKE 'chk_%'
   AND cl.relname IN ('accounting_accounts','fiscal_periods','journal_entries',
                      'journal_lines','accounting_fx_rates');

-- ── 3 · المفاتيح الخارجية وسلوك الحذف ─── متوقَّع: 18 · CASCADE واحد فقط ────
SELECT con.conname,
       cl.relname AS from_table,
       rf.relname AS to_table,
       CASE con.confdeltype WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE'
                            WHEN 'a' THEN 'NO ACTION' WHEN 'n' THEN 'SET NULL'
                            ELSE con.confdeltype::text END AS on_delete
  FROM pg_constraint con
  JOIN pg_class cl ON cl.oid=con.conrelid
  JOIN pg_class rf ON rf.oid=con.confrelid
 WHERE con.contype='f'
   AND cl.relname IN ('legal_entities','cost_centers','accounting_accounts','journals',
                      'fiscal_years','fiscal_periods','accounting_fx_rates',
                      'journal_entries','journal_lines')
 ORDER BY con.conname;

-- ⚠️ متوقَّع بالضبط: CASCADE = 1 (fk_jl_entry فقط) · RESTRICT = 17
SELECT count(*) FILTER (WHERE con.confdeltype='c') AS cascade_expected_1,
       count(*) FILTER (WHERE con.confdeltype='r') AS restrict_expected_17
  FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid
 WHERE con.contype='f'
   AND cl.relname IN ('legal_entities','cost_centers','accounting_accounts','journals',
                      'fiscal_years','fiscal_periods','accounting_fx_rates',
                      'journal_entries','journal_lines');

-- ── 4 · الفهارس ─── متوقَّع: 18 ─────────────────────────────────────────────
SELECT tablename, indexname FROM pg_indexes
 WHERE schemaname='public'
   AND (indexname LIKE 'uq~_%' ESCAPE '~' OR indexname LIKE 'idx~_%' ESCAPE '~')
   AND tablename IN ('legal_entities','cost_centers','accounting_accounts','journals',
                     'fiscal_years','fiscal_periods','accounting_fx_rates',
                     'journal_entries','journal_lines')
 ORDER BY 1,2;

-- ── 5 · المشغّلات الأربعة ───────────────────────────────────────────────────
-- متوقَّع: trg_je_immutable · trg_jl_immutable · trg_je_balanced_deferred · trg_je_period_guard
SELECT c.relname AS table_name, t.tgname,
       t.tgdeferrable AS is_deferrable, t.tginitdeferred AS initially_deferred
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 WHERE NOT t.tgisinternal AND c.relname IN ('journal_entries','journal_lines')
 ORDER BY 1,2;

-- ── 6 · الدوال الأربع ───────────────────────────────────────────────────────
SELECT proname FROM pg_proc
 WHERE proname IN ('accounting_je_immutable','accounting_jl_immutable',
                   'accounting_je_assert_balanced','accounting_je_period_guard')
 ORDER BY 1;

-- ── 7 · صفر بيانات محاسبية ─── كل الأعمدة يجب أن تكون 0 ────────────────────
SELECT
  (SELECT count(*) FROM journal_entries)     AS journal_entries,
  (SELECT count(*) FROM journal_lines)       AS journal_lines,
  (SELECT count(*) FROM accounting_accounts) AS accounts,
  (SELECT count(*) FROM legal_entities)      AS legal_entities,
  (SELECT count(*) FROM fiscal_years)        AS fiscal_years,
  (SELECT count(*) FROM fiscal_periods)      AS fiscal_periods,
  (SELECT count(*) FROM journals)            AS journals,
  (SELECT count(*) FROM accounting_fx_rates) AS fx_rates,
  (SELECT count(*) FROM cost_centers)        AS cost_centers;

-- ── 8 · جداول الأعمال لم تتغيّر ─── قارن حرفياً بنتائج ما قبل الهجرة ───────
SELECT
  (SELECT count(*) FROM invoices)             AS invoices,
  (SELECT count(*) FROM payments)             AS payments,
  (SELECT count(*) FROM suppliers)            AS suppliers,
  (SELECT count(*) FROM vessels)              AS vessels,
  (SELECT count(*) FROM purchase_orders)      AS purchase_orders,
  (SELECT count(*) FROM customers)            AS customers,
  (SELECT count(*) FROM hire_invoices)        AS hire_invoices,
  (SELECT count(*) FROM management_invoices)  AS management_invoices,
  (SELECT count(*) FROM users)                AS users;

SELECT currency, count(*) AS invoices, sum(total_amount) AS total, sum(paid_amount) AS paid
  FROM invoices GROUP BY currency ORDER BY currency;

SELECT data_origin, settlement_basis, count(*) AS n
  FROM invoices GROUP BY 1,2 ORDER BY 1,2;

-- بصمة بنية جداول الأعمال — يجب أن تطابق ما قبل الهجرة **حرفاً بحرف**
SELECT md5(string_agg(table_name||'.'||column_name||':'||data_type, ',' ORDER BY table_name, column_name))
       AS business_schema_md5
  FROM information_schema.columns
 WHERE table_schema='public'
   AND table_name IN ('invoices','payments','suppliers','vessels','purchase_orders',
                      'customers','hire_invoices','management_invoices','users');

-- قيود R3A الحيّة — يجب أن تبقى كما هي
SELECT conname FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid
 WHERE cl.relname='invoices' ORDER BY conname;
