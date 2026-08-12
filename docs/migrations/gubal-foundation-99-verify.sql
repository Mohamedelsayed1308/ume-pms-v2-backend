-- ═══ أساس Gubal — التحقق بعد الهجرة ═══
-- قراءة فقط. VERDICT يجب أن يكون OK في كل صف.
SELECT check_name, expected, actual,
       CASE WHEN actual = expected THEN 'OK' ELSE 'FAIL' END AS verdict
FROM (
  -- ── 1..6 · جدول الاستلام ──
  SELECT '01 · goods_service_receipts موجود' AS check_name, '1' AS expected,
         (SELECT COUNT(*)::text FROM information_schema.tables WHERE table_name='goods_service_receipts') AS actual
  UNION ALL SELECT '02 · الأعمدة الاثنا عشر قائمة', '12',
         (SELECT COUNT(*)::text FROM information_schema.columns WHERE table_name='goods_service_receipts'
           AND column_name IN ('id','invoice_id','receipt_type','received_date','received_by',
                               'received_by_name','reference','notes','attachment_id','is_partial','created_at','created_by'))
  UNION ALL SELECT '03 · قيد نوع الاستلام', '1',
         (SELECT COUNT(*)::text FROM pg_constraint WHERE conname='chk_receipt_type')
  UNION ALL SELECT '04 · المفتاح الخارجي fk_receipt_invoice', '1',
         (SELECT COUNT(*)::text FROM pg_constraint WHERE conname='fk_receipt_invoice')
  UNION ALL SELECT '04b · سلوك الحذف RESTRICT', 'r',
         (SELECT confdeltype::text FROM pg_constraint WHERE conname='fk_receipt_invoice')
  UNION ALL SELECT '05 · RLS مفعَّل', 'true',
         (SELECT COALESCE(relrowsecurity::text,'(مفقود)') FROM pg_class WHERE relname='goods_service_receipts')
  UNION ALL SELECT '06 · صلاحيات anon/authenticated', '0',
         (SELECT COUNT(*)::text FROM information_schema.role_table_grants
           WHERE table_name='goods_service_receipts' AND grantee IN ('anon','authenticated'))
  UNION ALL SELECT '06b · مشغّل عدم تعديل الاستلام', '1',
         (SELECT COUNT(*)::text FROM pg_trigger WHERE tgname='trg_receipt_immutable')
  UNION ALL SELECT '06c · فهرسا الاستلام', '2',
         (SELECT COUNT(*)::text FROM pg_class WHERE relname IN ('ix_receipt_invoice','ix_receipt_date'))

  -- ── 7..9 · ضوابط أسعار الصرف ──
  UNION ALL SELECT '07 · قيد منع الاعتماد الذاتي', '1',
         (SELECT COUNT(*)::text FROM pg_constraint WHERE conname='chk_fx_no_self_approval')
  UNION ALL SELECT '07b · قيد اقتران الاعتماد', '1',
         (SELECT COUNT(*)::text FROM pg_constraint WHERE conname='chk_fx_approval_pairing')
  UNION ALL SELECT '07c · القيد القديم chk_fx_manual_approved أُسقط', '0',
         (SELECT COUNT(*)::text FROM pg_constraint WHERE conname='chk_fx_manual_approved')
  UNION ALL SELECT '08 · دالّة accounting_fx_immutable', '1',
         (SELECT COUNT(*)::text FROM pg_proc WHERE proname='accounting_fx_immutable')
  UNION ALL SELECT '09 · مشغّل trg_fx_immutable', '1',
         (SELECT COUNT(*)::text FROM pg_trigger WHERE tgname='trg_fx_immutable')

  -- ── 10..11 · البنك ومخطّط الصرف ──
  UNION ALL SELECT '10 · 1010 currency_restriction', 'EUR',
         (SELECT COALESCE(currency_restriction,'(فارغ)') FROM accounting_accounts WHERE code='1010')
  UNION ALL SELECT '10b · أسطر بغير اليورو على 1010', '0',
         (SELECT COUNT(*)::text FROM journal_lines jl JOIN accounting_accounts a ON a.id=jl.account_id
           WHERE a.code='1010' AND jl.transaction_currency <> 'EUR')
  UNION ALL SELECT '11 · أعمدة accounting_fx_rates بلا تغيير', '12',
         (SELECT COUNT(*)::text FROM information_schema.columns WHERE table_name='accounting_fx_rates')

  -- ── 12..17 · ما يجب ألّا يتحرّك ──
  UNION ALL SELECT '12 · عدد القيود', '2',
         (SELECT COUNT(*)::text FROM journal_entries)
  UNION ALL SELECT '13 · إجمالي أسطر القيود (13 مُرحَّل + 13 ملغاة)', '26',
         (SELECT COUNT(*)::text FROM journal_lines)
  UNION ALL SELECT '14 · OJ-2026-00001 مُرحَّل', 'posted',
         (SELECT COALESCE(status,'(مفقود)') FROM journal_entries WHERE entry_no='OJ-2026-00001')
  UNION ALL SELECT '14b · OJ غير معكوس', 'null',
         (SELECT COALESCE(reversed_by_entry_id::text,'null') FROM journal_entries WHERE entry_no='OJ-2026-00001')
  UNION ALL SELECT '15 · أسطر OJ', '13',
         (SELECT COUNT(*)::text FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id
           WHERE je.entry_no='OJ-2026-00001')
  UNION ALL SELECT '16 · مدين OJ', '4423236.96',
         (SELECT total_debit_eur::text FROM journal_entries WHERE entry_no='OJ-2026-00001')
  UNION ALL SELECT '17 · دائن OJ', '4423236.96',
         (SELECT total_credit_eur::text FROM journal_entries WHERE entry_no='OJ-2026-00001')

  -- ── 18..20 · صفر إنشاء ──
  UNION ALL SELECT '18 · قيود مالية جديدة', '0',
         (SELECT COUNT(*)::text FROM journal_entries WHERE entry_no IS DISTINCT FROM 'OJ-2026-00001' AND status <> 'void')
  UNION ALL SELECT '19 · أسعار صرف', '0',
         (SELECT COUNT(*)::text FROM accounting_fx_rates)
  UNION ALL SELECT '20 · وقائع استلام', '0',
         (SELECT COUNT(*)::text FROM goods_service_receipts)
  UNION ALL SELECT '20b · عدد الحسابات', '50',
         (SELECT COUNT(*)::text FROM accounting_accounts)
) t ORDER BY check_name;
