-- ═══════════════════════════════════════════════════════════════════════════
-- P1.5 · تسمية محايدة لحساب الدُّراي دوك — تصحيح إعداد
--
-- الاسم الحالي «Dry Dock — Deferred Cost» يفترض معالجة لم تعتمدها الإدارة:
-- الرصيد 767,982.79 حالته UNVERIFIED_OPENING، ولم يُحسم إن كان تكلفة مؤجّلة أو
-- دفعة مقدمة أو مكوّن أصل أو تصحيحاً. **الاسم كان أقوى من الأدلة المتاحة.**
--
-- يُغيَّر الاسم وحده — عربيّه وإنجليزيّه.
-- لا يُمسّ: code · account_type · account_group · system_role · أي علم · أي رصيد.
-- صفر تغيير مخطط · صفر قيد · صفر سطر.
--
-- ⚠️ حارس: يرفض التنفيذ إن وُجد أي قيد محاسبي.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM journal_entries;
  IF n > 0 THEN
    RAISE EXCEPTION
      'يوجد % قيد محاسبي — تسمية الحسابات تُصحَّح قبل أول ترحيل. توقّف.', n;
  END IF;
END $$;

UPDATE accounting_accounts a
   SET name    = 'Dry Dock / Major Overhaul — Unverified Opening',
       name_ar = 'دُراي دوك / عمرة رئيسية — افتتاح غير مُتحقَّق منه',
       updated_at = now()
  FROM legal_entities le
 WHERE a.legal_entity_id = le.id
   AND le.code = 'SIV'
   AND a.code  = '1300'
   AND a.name  = 'Dry Dock — Deferred Cost';

COMMIT;

-- ── تحقّق ──────────────────────────────────────────────────────────────────
-- المتوقَّع: الاسم الجديد · account_type=asset · group=DRY_DOCK · role فارغ
-- postable=true · وباقي الأعلام كما هي · وصفر قيود.
SELECT a.code, a.name, a.name_ar, a.account_type, a.account_group,
       COALESCE(a.system_role,'(null)') AS system_role,
       a.is_postable, a.is_monetary, a.requires_subledger, a.is_related_party,
       (SELECT count(*) FROM journal_entries) AS journal_entries
  FROM accounting_accounts a
  JOIN legal_entities le ON le.id = a.legal_entity_id
 WHERE le.code = 'SIV' AND a.code = '1300';
