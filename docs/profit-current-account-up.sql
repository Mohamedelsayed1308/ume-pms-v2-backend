-- ============================================================================
--  هجرة بيانات: دفتر الفروق يصير كشف حسابٍ جارٍ
--  الجدول: profit_settlements  ·  لا تغيير في البنية — تغييرٌ في القيود
--
--  لماذا
--  ------
--  كان النموذج: المصادقة تُقفل الرصيد المعلّق بقيدٍ `applied` فيعود صفراً،
--  ويُحسب «المُحوَّل» رقماً في اللقطة.
--
--  وقرّر المالك أنّ **التحويل يُدخَل يداً** — لأنّ المستحقّ لا يُحوَّل كلّه دائماً.
--  فصار النموذج حساباً جارياً:
--
--      الافتتاحيّ            عليه أو له
--      + المستحقّ عن فترة    تكتبه المصادقة  (`due`)
--      − المُحوَّل فعلاً       يكتبه المستخدم  (`payment`)
--      ± فروقُ ما بعدها      (`delta`)
--      = الرصيد
--
--  فالرصيد يقول: كم بقي مستحقّاً لم يُدفع. والقديم كان يقول صفراً دائماً.
--
--  ما يجري هنا
--  -----------
--  قيود `applied` **ليست وقائع** — هي أثرُ تصميمٍ سابق: أُنشئت لتُصفّر الرصيد
--  عند المصادقة، ثمّ عُكست بفكّها، ثمّ أُعيدت. ولا تُقابلها حركةُ مالٍ واحدة.
--
--  فتُحذف، ويحلّ محلّها قيدُ `due` واحدٌ لكلّ شريكٍ عن كلّ فترةٍ مُصادَقة —
--  مقروءاً من `ratified_snapshot->computedTransfer`، أي من اللقطة نفسها.
--
--  والنتيجة **لا تُغيّر رقماً**: الرصيد بعدها = الافتتاحيّ + المستحقّ، وهو
--  بعينه ما كانت اللقطة تسمّيه `transferPaid`. تغيّر الاسمُ والمعنى لا المبلغ.
--
--  الأمان
--  ------
--  بوّابةٌ تمنع التشغيل مرّتين (وجودُ `due` يوقفها)، وبوّابةٌ تتحقّق أنّ الرصيد
--  بعدها يساوي المتوقّع لكلّ شريك — وإلّا تراجعت المعاملة كلّها.
--
--  التشغيل:  node scripts/run-migration.js docs/profit-current-account-up.sql
--            أو لصقه في محرّر SQL بـ Supabase
--  ولا تراجعَ لها: القيود المحذوفة أثرُ تصميم، وإعادتها تُفسد الحساب الجاري.
-- ============================================================================

BEGIN;

-- ── بوابة ١: لا تُشغَّل مرّتين ───────────────────────────────────────────
DO $$
DECLARE dues int;
BEGIN
  SELECT count(*) INTO dues FROM profit_settlements WHERE kind = 'due';
  IF dues > 0 THEN
    RAISE EXCEPTION 'GATE 1 FAILED: يوجد % قيد استحقاق — الهجرة نُفّذت سلفاً', dues;
  END IF;
END $$;

-- ── بصمةٌ قبليّة ─────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT partner, COALESCE(SUM(amount), 0) AS bal, count(*) AS n
             FROM profit_settlements GROUP BY partner ORDER BY partner
  LOOP
    RAISE NOTICE 'قبل: % · رصيد % · % قيداً', r.partner, r.bal, r.n;
  END LOOP;
END $$;

-- ── ١ · تُحذف قيود التصفير — أثرُ تصميمٍ لا وقائع ───────────────────────
DELETE FROM profit_settlements WHERE kind = 'applied';

-- ── ٢ · ويحلّ محلّها الاستحقاق، مقروءاً من لقطة المصادقة ────────────────
INSERT INTO profit_settlements
  (period_id, occurred_at, partner, amount, kind, note, created_by)
SELECT
  p.id,
  p.ratified_at,
  k.partner,
  ROUND((p.ratified_snapshot->'computedTransfer'->>k.partner)::numeric, 4),
  'due',
  'المستحقّ عن «' || trim(p.period_name) || '» — بالمصادقة',
  COALESCE(p.ratified_by, '')
FROM profit_periods p
CROSS JOIN (VALUES ('badawi'), ('ittihad')) AS k(partner)
WHERE p.ratified_at IS NOT NULL
  AND p.ratified_snapshot->'computedTransfer'->>k.partner IS NOT NULL;

-- ── بوابة ٢: الرصيد بعدها = الافتتاحيّ + المستحقّ، ولا قيدَ يتيم ────────
DO $$
DECLARE r record; applied_left int; dues int;
BEGIN
  SELECT count(*) INTO applied_left FROM profit_settlements WHERE kind = 'applied';
  IF applied_left <> 0 THEN
    RAISE EXCEPTION 'GATE 2 FAILED: بقي % قيد تصفير', applied_left;
  END IF;

  SELECT count(*) INTO dues FROM profit_settlements WHERE kind = 'due';
  IF dues = 0 THEN
    RAISE EXCEPTION 'GATE 2 FAILED: لم يُكتب قيدُ استحقاقٍ واحد — هل من فترةٍ مُصادَقة؟';
  END IF;

  FOR r IN
    SELECT s.partner,
           COALESCE(SUM(s.amount), 0) AS bal,
           COALESCE(SUM(s.amount) FILTER (WHERE s.kind = 'opening'), 0) AS opening,
           COALESCE(SUM(s.amount) FILTER (WHERE s.kind = 'due'), 0) AS due,
           count(*) AS n
      FROM profit_settlements s GROUP BY s.partner ORDER BY s.partner
  LOOP
    IF abs(r.bal - (r.opening + r.due)) > 0.02 THEN
      RAISE EXCEPTION
        'GATE 2 FAILED: % · الرصيد % لا يساوي الافتتاحيّ % + المستحقّ %',
        r.partner, r.bal, r.opening, r.due;
    END IF;
    RAISE NOTICE 'بعد: % · رصيد % (افتتاحيّ % + مستحقّ %) · % قيداً',
      r.partner, r.bal, r.opening, r.due, r.n;
  END LOOP;
END $$;

COMMIT;
