-- ═══ P1.1A · فحص تكميلي قبل الهجرة · قراءة فقط ═══
--
-- سببه: في فحص ما قبل الهجرة ظهرت قيود جدول invoices كنصّ واحد مجمَّع، فقطعته
-- واجهة Supabase عند حدّ عرض الخانة ولم تظهر قيود R3A الأربعة. القيد الذي لا أراه
-- لا أستطيع أن أشهد بوجوده — وحادثة R3A.1 كانت بالضبط اختفاء قيود بلا إشعار.
--
-- الاستعلام واحد لا اثنان: محرّر Supabase يعرض نتيجة آخر تعليمة فقط، فالجزآن
-- مدموجان بـUNION ALL ليعودا في جدول واحد. ولذلك يعيد كل جزء عمودين نصّيين:
-- شرط UNION هو تطابق عدد الأعمدة وتوافق أنواعها، فجُمعت أرقام الجزء الثاني في نصّ.
--
-- المتوقَّع: 4 صفوف تبدأ بـR3A (نقص أيٍّ منها ⇒ STOP) + صفوف NEW للفواتير الحديثة.

-- الجزء أ · قيود R3A الحيّة على invoices
SELECT 'R3A · '||conname AS check, 'موجود' AS value
  FROM pg_constraint con
  JOIN pg_class cl ON cl.oid = con.conrelid
 WHERE cl.relname = 'invoices'
   AND conname IN ('chk_inv_data_origin','chk_inv_settlement_basis',
                   'chk_inv_presystem_requires_batch','fk_invoices_import_batch')

UNION ALL

-- الجزء ب · الفواتير المُنشأة حديثاً — لتفسير أي فرق عن خط الأساس
SELECT 'NEW · '||to_char(created_at,'YYYY-MM-DD'),
       currency||' · '||count(*)||' inv · '||to_char(sum(total_amount),'FM999999990.00')
              ||' · origin='||data_origin
  FROM invoices
 WHERE created_at >= now() - interval '14 days'
 GROUP BY to_char(created_at,'YYYY-MM-DD'), currency, data_origin

 ORDER BY 1;
