-- التحقق بعد هجرة أساس Gubal — قراءة فقط · لا يعدّل شيئاً
SELECT 'جدول الاستلام' AS check_name,
       (SELECT COUNT(*)::text FROM information_schema.tables WHERE table_name='goods_service_receipts') AS actual,
       '1' AS expected
UNION ALL SELECT 'RLS على جدول الاستلام',
       (SELECT COALESCE(relrowsecurity::text,'-') FROM pg_class WHERE relname='goods_service_receipts'), 'true'
UNION ALL SELECT 'صلاحيات anon/authenticated على الاستلام',
       (SELECT COUNT(*)::text FROM information_schema.role_table_grants
         WHERE table_name='goods_service_receipts' AND grantee IN ('anon','authenticated')), '0'
UNION ALL SELECT 'قيد اقتران الاعتماد',
       (SELECT COUNT(*)::text FROM pg_constraint WHERE conname='chk_fx_approval_pairing'), '1'
UNION ALL SELECT 'قيد منع الاعتماد الذاتي',
       (SELECT COUNT(*)::text FROM pg_constraint WHERE conname='chk_fx_no_self_approval'), '1'
UNION ALL SELECT 'القيد القديم أُسقط',
       (SELECT COUNT(*)::text FROM pg_constraint WHERE conname='chk_fx_manual_approved'), '0'
UNION ALL SELECT 'مشغّل عدم تعديل الصرف',
       (SELECT COUNT(*)::text FROM pg_trigger WHERE tgname='trg_fx_immutable'), '1'
UNION ALL SELECT 'مشغّل عدم تعديل الاستلام',
       (SELECT COUNT(*)::text FROM pg_trigger WHERE tgname='trg_receipt_immutable'), '1'
UNION ALL SELECT 'نوع الاستلام مقيَّد',
       (SELECT COUNT(*)::text FROM pg_constraint WHERE conname='chk_receipt_type'), '1'
UNION ALL SELECT 'مفتاح الاستلام الخارجي',
       (SELECT COUNT(*)::text FROM pg_constraint WHERE conname='fk_receipt_invoice'), '1'
UNION ALL SELECT 'قيد عملة الحساب 1010',
       (SELECT COALESCE(currency_restriction,'(فارغ)') FROM accounting_accounts WHERE code='1010'), 'EUR'
UNION ALL SELECT 'أسطر بغير اليورو على 1010',
       (SELECT COUNT(*)::text FROM journal_lines jl JOIN accounting_accounts a ON a.id=jl.account_id
         WHERE a.code='1010' AND jl.transaction_currency <> 'EUR'), '0'
-- ── ما يجب ألّا يتغيّر ──
UNION ALL SELECT 'عدد القيود',            (SELECT COUNT(*)::text FROM journal_entries), '2'
UNION ALL SELECT 'أسعار الصرف',           (SELECT COUNT(*)::text FROM accounting_fx_rates), '0'
UNION ALL SELECT 'وقائع الاستلام',         (SELECT COUNT(*)::text FROM goods_service_receipts), '0'
UNION ALL SELECT 'حالة OJ-2026-00001',    (SELECT status FROM journal_entries WHERE entry_no='OJ-2026-00001'), 'posted'
UNION ALL SELECT 'أسطر OJ',               (SELECT COUNT(*)::text FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id WHERE je.entry_no='OJ-2026-00001'), '13'
UNION ALL SELECT 'مدين OJ',               (SELECT total_debit_eur::text FROM journal_entries WHERE entry_no='OJ-2026-00001'), '4423236.96'
UNION ALL SELECT 'دائن OJ',               (SELECT total_credit_eur::text FROM journal_entries WHERE entry_no='OJ-2026-00001'), '4423236.96'
UNION ALL SELECT 'الحسابات',              (SELECT COUNT(*)::text FROM accounting_accounts), '50';
