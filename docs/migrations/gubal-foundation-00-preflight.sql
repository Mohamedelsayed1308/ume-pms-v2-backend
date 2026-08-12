-- ═══ أساس Gubal — فحص ما قبل الهجرة ═══
-- قراءة فقط. لا يعدّل شيئاً. شغّله أولاً.
-- كل صف: VERDICT يجب أن يكون OK. أي BLOCK ⇒ لا تُنفّذ الهجرة.
SELECT check_name, expected, actual,
       CASE WHEN actual = expected THEN 'OK' ELSE 'BLOCK' END AS verdict
FROM (
  SELECT '01 · الحساب 1010 موجود' AS check_name, '1' AS expected,
         (SELECT COUNT(*)::text FROM accounting_accounts WHERE code='1010') AS actual
  UNION ALL SELECT '02 · أسطر بغير اليورو على 1010', '0',
         (SELECT COUNT(*)::text FROM journal_lines jl
            JOIN accounting_accounts a ON a.id = jl.account_id
           WHERE a.code='1010' AND jl.transaction_currency <> 'EUR')
  UNION ALL SELECT '03 · goods_service_receipts غير موجود', 'absent',
         (SELECT CASE WHEN to_regclass('public.goods_service_receipts') IS NULL THEN 'absent' ELSE 'EXISTS' END)
  UNION ALL SELECT '04 · chk_fx_approval_pairing غير موجود', '0',
         (SELECT COUNT(*)::text FROM pg_constraint WHERE conname='chk_fx_approval_pairing')
  UNION ALL SELECT '05 · chk_fx_no_self_approval غير موجود', '0',
         (SELECT COUNT(*)::text FROM pg_constraint WHERE conname='chk_fx_no_self_approval')
  UNION ALL SELECT '06 · trg_fx_immutable غير موجود', '0',
         (SELECT COUNT(*)::text FROM pg_trigger WHERE tgname='trg_fx_immutable')
  UNION ALL SELECT '07 · trg_receipt_immutable غير موجود', '0',
         (SELECT COUNT(*)::text FROM pg_trigger WHERE tgname='trg_receipt_immutable')
  UNION ALL SELECT '08 · دالّة accounting_fx_immutable غير موجودة', '0',
         (SELECT COUNT(*)::text FROM pg_proc WHERE proname='accounting_fx_immutable')
  UNION ALL SELECT '09 · دالّة goods_receipt_immutable غير موجودة', '0',
         (SELECT COUNT(*)::text FROM pg_proc WHERE proname='goods_receipt_immutable')
  UNION ALL SELECT '10 · لا تعارض في أسماء الفهارس', '0',
         (SELECT COUNT(*)::text FROM pg_class WHERE relname IN ('ix_receipt_invoice','ix_receipt_date'))
  UNION ALL SELECT '11 · القيد القديم chk_fx_manual_approved قائم', '1',
         (SELECT COUNT(*)::text FROM pg_constraint WHERE conname='chk_fx_manual_approved')
  UNION ALL SELECT '12 · جدول invoices موجود (هدف المفتاح الخارجي)', '1',
         (SELECT COUNT(*)::text FROM information_schema.tables WHERE table_name='invoices')
  UNION ALL SELECT '13 · invoices.id مفتاح أساسي', '1',
         (SELECT COUNT(*)::text FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
           WHERE t.relname='invoices' AND c.contype='p')
  UNION ALL SELECT '14 · gen_random_uuid قابلة للاستدعاء', 'yes',
         (SELECT CASE WHEN to_regprocedure('gen_random_uuid()') IS NULL THEN 'no' ELSE 'yes' END)
  UNION ALL SELECT '15 · جدول accounting_fx_rates موجود', '1',
         (SELECT COUNT(*)::text FROM information_schema.tables WHERE table_name='accounting_fx_rates')
  UNION ALL SELECT '16 · أعمدة الاعتماد قائمة (created_by/approved_by/approved_at)', '3',
         (SELECT COUNT(*)::text FROM information_schema.columns
           WHERE table_name='accounting_fx_rates' AND column_name IN ('created_by','approved_by','approved_at'))
  UNION ALL SELECT '17 · صفوف تخالف قيد الاقتران الجديد', '0',
         (SELECT COUNT(*)::text FROM accounting_fx_rates
           WHERE (approved_by IS NULL) <> (approved_at IS NULL))
  UNION ALL SELECT '18 · صفوف باعتماد ذاتي قائم', '0',
         (SELECT COUNT(*)::text FROM accounting_fx_rates
           WHERE approved_by IS NOT NULL AND created_by IS NOT NULL AND approved_by = created_by)
  UNION ALL SELECT '19 · OJ-2026-00001 مُرحَّل', 'posted',
         (SELECT COALESCE(status,'(مفقود)') FROM journal_entries WHERE entry_no='OJ-2026-00001')
  UNION ALL SELECT '20 · عدد القيود', '2',
         (SELECT COUNT(*)::text FROM journal_entries)
  UNION ALL SELECT '21 · أسطر القيود (13 مُرحَّل + 13 بقايا ملغاة)', '26',
         (SELECT COUNT(*)::text FROM journal_lines)
  UNION ALL SELECT '21b · أسطر OJ-2026-00001 وحده', '13',
         (SELECT COUNT(*)::text FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id
           WHERE je.entry_no='OJ-2026-00001')
  UNION ALL SELECT '22 · أسعار الصرف', '0',
         (SELECT COUNT(*)::text FROM accounting_fx_rates)
  UNION ALL SELECT '23 · عدد الحسابات', '50',
         (SELECT COUNT(*)::text FROM accounting_accounts)
) t ORDER BY check_name;
