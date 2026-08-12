-- ═══ P1.1A · فحص ما قبل الهجرة · قراءة فقط ═══
-- شغّل هذا أولاً. كله SELECT — لا يكتب شيئاً ولا يقفل شيئاً.
-- احتفظ بالنتائج: تُقارَن بها نتائج ما بعد التنفيذ.
-- لا يطبع أي بيانات حساسة: أعداد وأسماء كائنات مخطط فقط.

-- ── 1 · حاجز الأسماء: يجب أن تكون النتيجة صفر صفوف ──────────────────────────
-- ⚠️ أي صف هنا = STOP. الهجرة تستخدم CREATE TABLE IF NOT EXISTS، فوجود جدول
--    بنفس الاسم يجعلها تتخطّاه بصمت وتبني فوق بنية ليست بنيتها. ولو تراجعتَ
--    لاحقاً بـDOWN لأسقطتَ جدولاً لم تُنشئه الهجرة.
SELECT 'NAME COLLISION — STOP' AS verdict, tablename
  FROM pg_tables
 WHERE schemaname = 'public'
   AND tablename IN ('legal_entities','cost_centers','accounting_accounts','journals',
                     'fiscal_years','fiscal_periods','accounting_fx_rates',
                     'journal_entries','journal_lines');

-- كذلك للدوال والمشغّلات
SELECT 'FUNCTION COLLISION — STOP' AS verdict, proname
  FROM pg_proc
 WHERE proname IN ('accounting_je_immutable','accounting_jl_immutable',
                   'accounting_je_assert_balanced','accounting_je_period_guard');

-- ── 2 · أعداد الجداول الأساسية ─────────────────────────────────────────────
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

-- ── 3 · التصنيف التاريخي R3A ───────────────────────────────────────────────
SELECT data_origin, settlement_basis, count(*) AS n
  FROM invoices
 GROUP BY 1,2
 ORDER BY 1,2;

-- ── 4 · البصمة المالية · كل عملة دفتر مستقل — لا إجمالي جامع ───────────────
SELECT currency,
       count(*)          AS invoices,
       sum(total_amount) AS total,
       sum(paid_amount)  AS paid
  FROM invoices
 GROUP BY currency
 ORDER BY currency;

SELECT currency, count(*) AS payments, sum(amount) AS total
  FROM payments
 GROUP BY currency
 ORDER BY currency;

-- ── 5 · قيود R3A الحيّة — يجب أن تبقى كما هي بعد الهجرة ────────────────────
SELECT conname
  FROM pg_constraint con
  JOIN pg_class cl ON cl.oid = con.conrelid
 WHERE cl.relname = 'invoices'
 ORDER BY conname;

-- ── 6 · بصمة بنية جداول الأعمال — تُقارَن حرفياً بما بعد التنفيذ ───────────
SELECT md5(string_agg(table_name||'.'||column_name||':'||data_type, ',' ORDER BY table_name, column_name))
       AS business_schema_md5
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('invoices','payments','suppliers','vessels','purchase_orders',
                      'customers','hire_invoices','management_invoices','users');

-- ── 7 · عدد كائنات المخطط قبل التنفيذ ──────────────────────────────────────
SELECT
  (SELECT count(*) FROM pg_tables WHERE schemaname='public')                       AS tables,
  (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal)                         AS triggers,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public')                                                     AS functions;
