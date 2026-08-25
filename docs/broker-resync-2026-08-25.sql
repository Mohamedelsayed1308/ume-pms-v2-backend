-- ============================================================================
--  مزامنةٌ دفعةً واحدة: استحقاقات البروكر على الفواتير القائمة
--  ٢٥ أغسطس ٢٠٢٦ · بأمر المالك «ولّدها»
--
--  لماذا
--  ------
--  القاعدة تسري على ما يُصدَر أو يُعدَّل، فالفواتير القائمة بلا استحقاق. وثلاثةٌ
--  منها وُلدت بالحساب القديم (على إجمالي الفاتورة لا على بنود الـ Hire).
--
--  فتُزامن الإحدى عشرة دفعةً واحدة بدل فتح كلٍّ وحفظها.
--
--  ── والمنطق هنا صورةٌ من `BrokersService.syncInvoice` ──
--  وهذا خطرُه: نسختان تنحرفان. ولذلك **البوّابة تُثبّت الناتج بالرقم**:
--  ٣٨٬٨٠٩.٣٨ لكلّ بروكر، محسوبةً خارج هذا الملفّ من بنود الفواتير. فإن
--  اختلف المنطق عن الخدمة ظهر الفرق فوراً وتراجعت المعاملة.
--
--  والصواب أن تُستدعى الخدمة نفسها (`POST api/brokers/sync/:id`) — وهذا
--  الملفّ لمرّةٍ واحدة، ولا يُبنى عليه بعدها.
--
--  الأساس
--  ------
--      مجموع بنود `item_kind = 'hire'`
--      وإن لم يكن للفاتورة بنودٌ إطلاقاً: إجماليها — والبيان يقول ذلك
--
--  الأمان
--  ------
--  قيدٌ واحدٌ لكلّ (فاتورة · بروكر) يحرسه فهرسٌ فريد — فالإعادة تُحدّث ولا
--  تُضاعف. والسدادات لا تُمسّ (لا سدادَ بعد، والبوّابة تتحقّق).
--
--  التشغيل:  node scripts/run-migration.js docs/broker-resync-2026-08-25.sql
-- ============================================================================

BEGIN;

-- ── بوابة ١: لا سدادَ قائم — فالمزامنة لا تمسّ مالاً خرج ────────────────
DO $$
DECLARE pays int;
BEGIN
  SELECT count(*) INTO pays FROM broker_ledger WHERE kind = 'payment';
  IF pays <> 0 THEN
    RAISE EXCEPTION
      'GATE 1 FAILED: % سداداً مقيَّداً — راجع أثر المزامنة على الأرصدة قبل تشغيلها', pays;
  END IF;
END $$;

-- ── بصمةٌ قبليّة ─────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT b.name, count(*) n, COALESCE(SUM(l.amount), 0) s
             FROM brokers b LEFT JOIN broker_ledger l
               ON l.broker_id = b.id AND l.kind = 'due'
            GROUP BY b.name ORDER BY b.name
  LOOP
    RAISE NOTICE 'قبل: % · % استحقاقاً · %', r.name, r.n, r.s;
  END LOOP;
END $$;

-- ── المزامنة ─────────────────────────────────────────────────────────────
WITH inv AS (
  SELECT i.id, i.invoice_number, i.invoice_date, i.currency,
         i.customer_id, i.vessel_id,
         (SELECT count(*) FROM hire_invoice_items it WHERE it.hire_invoice_id = i.id) AS n_items,
         COALESCE((SELECT SUM(it.amount) FROM hire_invoice_items it
                    WHERE it.hire_invoice_id = i.id AND it.item_kind = 'hire'), 0) AS hire_sum,
         COALESCE((SELECT count(*) FROM hire_invoice_items it
                    WHERE it.hire_invoice_id = i.id AND it.item_kind <> 'hire'), 0) AS n_skipped,
         COALESCE((SELECT count(*) FROM hire_invoice_items it
                    WHERE it.hire_invoice_id = i.id AND it.item_kind = 'hire'), 0) AS n_hire,
         i.total_amount
    FROM hire_invoices i
   WHERE i.doc_type = 'invoice'
),
calc AS (
  SELECT inv.*, r.broker_id, r.rate, r.currency AS rule_currency,
         CASE WHEN inv.n_items = 0 THEN inv.total_amount ELSE inv.hire_sum END AS base
    FROM inv
    JOIN broker_rules r
      ON r.customer_id = inv.customer_id
     AND r.active
     AND (r.vessel_id IS NULL OR r.vessel_id = inv.vessel_id)
)
INSERT INTO broker_ledger
  (broker_id, hire_invoice_id, occurred_at, kind, amount, currency, base_amount, rate, reference, note, created_by)
SELECT
  c.broker_id, c.id, COALESCE(c.invoice_date::timestamptz, now()), 'due',
  ROUND(c.base * c.rate / 100, 2),
  COALESCE(NULLIF(c.currency, ''), c.rule_currency),
  ROUND(c.base, 2), c.rate, c.invoice_number,
  'عمولة عن فاتورة ' || c.invoice_number
    || CASE WHEN c.n_items = 0 THEN ' — على إجمالي الفاتورة، فلا بنودَ فيها'
            WHEN c.n_skipped > 0 THEN ' — على ' || c.n_hire || ' بند Hire، واستُبعد ' || c.n_skipped
            ELSE '' END,
  'مزامنةٌ دفعةً واحدة · ٢٥ أغسطس ٢٠٢٦'
FROM calc c
WHERE ABS(ROUND(c.base * c.rate / 100, 2)) > 0.01
ON CONFLICT (hire_invoice_id, broker_id) WHERE kind = 'due' AND hire_invoice_id IS NOT NULL
DO UPDATE SET
  amount      = EXCLUDED.amount,
  base_amount = EXCLUDED.base_amount,
  rate        = EXCLUDED.rate,
  currency    = EXCLUDED.currency,
  reference   = EXCLUDED.reference,
  note        = EXCLUDED.note;

-- ── بوابة ٢: الناتج يُثبَّت بالرقم — مُحتسَبٌ خارج هذا الملفّ ───────────
DO $$
DECLARE r record; expected numeric := 38809.38;
BEGIN
  FOR r IN SELECT b.name, count(*) n, COALESCE(SUM(l.amount), 0) s
             FROM brokers b LEFT JOIN broker_ledger l
               ON l.broker_id = b.id AND l.kind = 'due'
            GROUP BY b.name ORDER BY b.name
  LOOP
    RAISE NOTICE 'بعد: % · % استحقاقاً · %', r.name, r.n, r.s;
    IF r.n <> 11 THEN
      RAISE EXCEPTION 'GATE 2 FAILED: % · المتوقّع ١١ استحقاقاً ووُجد %', r.name, r.n;
    END IF;
    IF ABS(r.s - expected) > 0.02 THEN
      RAISE EXCEPTION 'GATE 2 FAILED: % · المتوقّع % ووُجد %', r.name, expected, r.s;
    END IF;
  END LOOP;
END $$;

COMMIT;
