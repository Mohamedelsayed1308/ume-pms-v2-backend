import { createHash } from 'crypto';
import {
  LEGACY_RECORDS, MANIFEST_RECORDS_SHA256, EXPECTED_COUNT, EXPECTED_PRE_SYSTEM_SETTLED,
  EXPECTED_CREDIT_NOTE, R1_SIGNATURE, BATCH_CODE, TAG_UPDATE, SCHEMA_UP,
  CHK_PRESYSTEM_REQUIRES_BATCH_EXPR, CHK_DATA_ORIGIN_EXPR, CHK_SETTLEMENT_BASIS_EXPR,
} from './r3a-legacy-2026-08';
import {
  FINANCIAL_CONTROL_FIELDS, rejectFinancialControlFields, stripFinancialControlFields,
} from '../common/financial-control-fields';
import { totalsByCurrency } from '../common/currency-totals';

const r2 = (n: number) => Math.round(n * 100) / 100;

// ── محاكاة تفسير التدقيق (نفس شروط audit.service) — بيانات صناعية بالكامل ──
type Inv = { status: string; approval_status?: string | null; total_amount: number; paid_amount: number;
             settlement_basis?: string; payments?: { amount: number; currency?: string }[] };
function classify(inv: Inv) {
  const pays = inv.payments || [];
  const actual = pays.reduce((s, p) => s + p.amount, 0);
  const basis = inv.settlement_basis;
  const legacySettled = basis === 'pre_system_settled';
  const legacyCredit = basis === 'credit_note';
  const isLegacy = legacySettled || legacyCredit;
  const out: { key: string; severity: string; exposure: number }[] = [];
  if (legacySettled) out.push({ key: 'legacy_settled', severity: 'informational', exposure: 0 });
  else if (legacyCredit) out.push({ key: 'legacy_credit_note', severity: 'informational', exposure: 0 });
  if (!isLegacy && inv.status === 'paid' && pays.length === 0)
    out.push({ key: 'paid_without_payments', severity: 'critical', exposure: Math.abs(inv.paid_amount) });
  if (!isLegacy && inv.approval_status === 'paid' && actual + 0.01 < inv.total_amount)
    out.push({ key: 'approval_paid_no_evidence', severity: 'critical', exposure: r2(inv.total_amount - actual) });
  if (!isLegacy && Math.abs(inv.paid_amount - actual) > 0.01)
    out.push({ key: 'paid_amount_mismatch', severity: 'high', exposure: r2(Math.abs(inv.paid_amount - actual)) });
  return out;
}
const keys = (i: Inv) => classify(i).map((f) => f.key);
const outstanding = (i: Inv) => r2(i.total_amount - i.paid_amount);

describe('R3A · نزاهة البيان المجمَّد', () => {
  it('1. البيان 128 سجلاً بلا تكرار معرّف أو رقم', () => {
    expect(LEGACY_RECORDS.length).toBe(EXPECTED_COUNT);
    expect(EXPECTED_COUNT).toBe(128);
    expect(new Set(LEGACY_RECORDS.map((r) => r.invoice_id)).size).toBe(128);
    expect(new Set(LEGACY_RECORDS.map((r) => r.invoice_number)).size).toBe(128);
  });

  it('2. التصنيف 123 / 5 بالضبط', () => {
    expect(LEGACY_RECORDS.filter((r) => r.settlement_basis === 'pre_system_settled').length).toBe(123);
    expect(LEGACY_RECORDS.filter((r) => r.settlement_basis === 'credit_note').length).toBe(5);
    expect(EXPECTED_PRE_SYSTEM_SETTLED + EXPECTED_CREDIT_NOTE).toBe(EXPECTED_COUNT);
  });

  it('3. بصمة السجلات تطابق القيمة المعتمدة (تمنع الانحراف بين الكود والبيان)', () => {
    const h = createHash('sha256').update(JSON.stringify(LEGACY_RECORDS.map((r) => ({
      invoice_id: r.invoice_id, invoice_number: r.invoice_number, supplier: r.supplier,
      currency: r.currency, amount: r.amount, settlement_basis: r.settlement_basis,
    }))), 'utf8').digest('hex');
    expect(h).toBe(MANIFEST_RECORDS_SHA256);
  });

  it('4. بصمة R1 المالية تُعاد إنتاجها من البيان — لكل عملة، بلا إجمالي موحّد', () => {
    const abs: Record<string, number> = {};
    for (const r of LEGACY_RECORDS) abs[r.currency] = r2((abs[r.currency] || 0) + Math.abs(r.amount));
    expect(abs).toEqual(R1_SIGNATURE);
    expect(abs.USD).toBe(3343933.27);
    expect(abs.EUR).toBe(190928.04);
    expect(abs.SAR).toBe(3919.89);
    // لا يوجد أي رقم يجمع العملات الثلاث
    expect(Object.values(abs)).not.toContain(r2(3343933.27 + 190928.04 + 3919.89));
  });

  it('5. الإشعارات الدائنة الخمسة هي بالضبط الفواتير السالبة', () => {
    const cn = LEGACY_RECORDS.filter((r) => r.settlement_basis === 'credit_note');
    expect(cn.map((r) => r.invoice_number).sort())
      .toEqual(['2024307', '2024314', '500C100471', 'CN-26-04-01', 'FZ-SVE-CN-00000157']);
    expect(cn.every((r) => r.amount < 0)).toBe(true);
    expect(LEGACY_RECORDS.filter((r) => r.amount < 0).length).toBe(5);
    // ولا واحدة منها مُصنَّفة تسوية سداد
    expect(cn.some((r) => (r.settlement_basis as string) === 'pre_system_settled')).toBe(false);
  });

  it('6. لا شرط ديناميكي في مسار التوسيم — العضوية من staging فقط', () => {
    expect(TAG_UPDATE).toContain('FROM r3a_staging s');
    expect(TAG_UPDATE).toContain('i.id = s.invoice_id');
    expect(TAG_UPDATE).not.toMatch(/status\s*=/);
    expect(TAG_UPDATE).not.toMatch(/approval_status/);
    expect(TAG_UPDATE).not.toMatch(/created_at|invoice_date/);
    // ولا يمسّ أي حقل مالي
    for (const f of ['paid_amount', 'total_amount', 'currency', 'supplier_id', 'invoice_number']) {
      expect(TAG_UPDATE.includes(`${f} =`)).toBe(false);
    }
  });

  it('7. التوسيم متكرّر الأمان: مقيَّد بالحالة غير الموسومة', () => {
    expect(TAG_UPDATE).toContain("i.data_origin = 'operational'");
  });

  it('8. المخطط كله متكرّر الأمان', () => {
    const sql = SCHEMA_UP.join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS import_batches');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS data_origin');
    expect((sql.match(/EXCEPTION WHEN duplicate_object/g) || []).length).toBe(4);
    expect(sql).toContain('ON DELETE RESTRICT');
  });

  it('9. القيود تمنع الحالات غير المنطقية', () => {
    expect(CHK_DATA_ORIGIN_EXPR).toContain("'operational'");
    expect(CHK_DATA_ORIGIN_EXPR).toContain("'migrated'");
    expect(CHK_SETTLEMENT_BASIS_EXPR).toContain("'pre_system_settled'");
    // التسوية السابقة للنظام تستلزم أصلاً مُرحَّلاً ودفعة موثَّقة
    expect(CHK_PRESYSTEM_REQUIRES_BATCH_EXPR).toContain("data_origin = 'migrated'");
    expect(CHK_PRESYSTEM_REQUIRES_BATCH_EXPR).toContain('import_batch_id IS NOT NULL');
  });

  it('10. كود الدفعة ثابت', () => expect(BATCH_CODE).toBe('LEGACY-2026-08'));
});

describe('R3A · تفسير التدقيق', () => {
  const opUnpaid: Inv = { status: 'unpaid', total_amount: 1000, paid_amount: 0 };
  const opPaidReal: Inv = { status: 'paid', approval_status: 'paid', total_amount: 1000, paid_amount: 1000,
                            payments: [{ amount: 1000, currency: 'USD' }] };
  const opPaidNoEvidence: Inv = { status: 'paid', approval_status: 'paid', total_amount: 1000, paid_amount: 1000 };
  const legacy: Inv = { status: 'paid', approval_status: 'paid', total_amount: 1000, paid_amount: 1000,
                        settlement_basis: 'pre_system_settled' };
  const legacyCn: Inv = { status: 'paid', approval_status: 'paid', total_amount: -1775, paid_amount: -1775,
                          settlement_basis: 'credit_note' };

  it('11. فاتورة تشغيلية غير مسددة — لا ملاحظات', () => expect(keys(opUnpaid)).toEqual([]));

  it('12. تشغيلية مسددة بسداد حقيقي — لا ملاحظات', () => expect(keys(opPaidReal)).toEqual([]));

  it('13. تشغيلية «مدفوعة» بلا سداد ⇒ حرِج (السبب الجذري لا يُخفى)', () => {
    const f = classify(opPaidNoEvidence);
    expect(f.map((x) => x.key)).toContain('paid_without_payments');
    expect(f.find((x) => x.key === 'paid_without_payments')!.severity).toBe('critical');
    expect(f.find((x) => x.key === 'paid_without_payments')!.exposure).toBe(1000);
  });

  it('14. مُرحَّلة مسوّاة قبل النظام ⇒ معلوماتية بتعرُّض صفر', () => {
    const f = classify(legacy);
    expect(f.map((x) => x.key)).toEqual(['legacy_settled']);
    expect(f[0].severity).toBe('informational');
    expect(f[0].exposure).toBe(0);
  });

  it('15. التصنيف التاريخي يُخرِج القواعد الثلاث كلها — لا حرِج ولا مرتفع', () => {
    expect(keys(legacy)).not.toContain('paid_without_payments');
    expect(keys(legacy)).not.toContain('approval_paid_no_evidence');
    expect(keys(legacy)).not.toContain('paid_amount_mismatch');
  });

  it('16. الإشعار الدائن يُصنَّف إشعاراً لا سداداً', () => {
    const f = classify(legacyCn);
    expect(f.map((x) => x.key)).toEqual(['legacy_credit_note']);
    expect(f[0].exposure).toBe(0);
  });

  it('17. مستحق السجل التاريخي = صفر', () => {
    expect(outstanding(legacy)).toBe(0);
    expect(outstanding(legacyCn)).toBe(0);
  });

  it('18. فاتورة جديدة لا تصير تاريخية تلقائياً', () => {
    const fresh: Inv = { status: 'paid', approval_status: 'paid', total_amount: 500, paid_amount: 500 };
    expect(fresh.settlement_basis).toBeUndefined();
    expect(keys(fresh)).toContain('paid_without_payments');
  });
});

describe('R3A · الدلالات المالية — فصل مصدر الإغلاق', () => {
  it('19. التسوية التاريخية لا تزيد مدفوعات PMS', () => {
    const t = totalsByCurrency([
      { currency: 'USD', total_amount: 1000, paid_amount: 1000, settlement_basis: 'pre_system_settled', payments: [] },
      { currency: 'USD', total_amount: 400, paid_amount: 400, settlement_basis: 'none', payments: [{ amount: 400, currency: 'USD' }] },
    ]);
    expect(t[0].paid).toBe(1400);              // المخزَّن كما هو — توافق رجعي
    expect(t[0].paidViaPms).toBe(400);         // ← «كم دفعنا داخل PMS؟»
    expect(t[0].settledPreSystem).toBe(1000);  // ← مفصولة تماماً
    expect(t[0].unevidencedResidual).toBe(0);
  });

  it('20. المستحق صفر للسجل التاريخي رغم غياب سجل الدفع', () => {
    const t = totalsByCurrency([{ currency: 'USD', total_amount: 1000, paid_amount: 1000, settlement_basis: 'pre_system_settled', payments: [] }]);
    expect(t[0].outstanding).toBe(0);
    expect(t[0].paidViaPms).toBe(0);
  });

  it('21. المتبقي بلا دليل يبقى ظاهراً ولا يُبتلع', () => {
    const t = totalsByCurrency([{ currency: 'USD', total_amount: 900, paid_amount: 900, settlement_basis: 'none', payments: [] }]);
    expect(t[0].unevidencedResidual).toBe(900);
    expect(t[0].settledPreSystem).toBe(0);
  });

  it('22. متطابقة التسوية صحيحة لكل عملة', () => {
    const t = totalsByCurrency([
      { currency: 'USD', total_amount: 1000, paid_amount: 1000, settlement_basis: 'pre_system_settled', payments: [] },
      { currency: 'USD', total_amount: 300, paid_amount: 300, settlement_basis: 'none', payments: [{ amount: 300, currency: 'USD' }] },
      { currency: 'USD', total_amount: 200, paid_amount: 200, settlement_basis: 'none', payments: [] },
      { currency: 'EUR', total_amount: -1775, paid_amount: -1775, settlement_basis: 'credit_note', payments: [] },
    ]);
    const usd = t.find((x) => x.currency === 'USD')!;
    expect(r2(usd.paidViaPms + usd.settledPreSystem + usd.creditNoteOffset + usd.unevidencedResidual)).toBe(usd.paid);
    const eur = t.find((x) => x.currency === 'EUR')!;
    expect(eur.creditNoteOffset).toBe(-1775);
    expect(eur.paidViaPms).toBe(0);
    // لا خلط عملات
    expect(t.length).toBe(2);
    expect(usd.paid).toBe(1500);
  });

  it('23. عملة سداد مخالفة لا تُحتسب ضمن مدفوعات PMS لتلك العملة', () => {
    const t = totalsByCurrency([{ currency: 'USD', total_amount: 1000, paid_amount: 1000, settlement_basis: 'none', payments: [{ amount: 1000, currency: 'EUR' }] }]);
    expect(t[0].paidViaPms).toBe(0);
    expect(t[0].unevidencedResidual).toBe(1000);
  });

  it('24. R2.x لم تنكسر: الدفاتر تبقى مفصولة بالعملة', () => {
    const t = totalsByCurrency([
      { currency: 'USD', total_amount: 10000, paid_amount: 0 },
      { currency: 'EUR', total_amount: 5000, paid_amount: 0 },
    ]);
    expect(t.map((x) => x.currency)).toEqual(['EUR', 'USD']);
    expect(t.some((x) => x.invoiced === 15000 || x.outstanding === 15000)).toBe(false);
  });
});

describe('R3A · حماية الكتابة', () => {
  it('25. الحقول الثلاثة معرَّفة كبيانات تحكّم مالي', () => {
    expect([...FINANCIAL_CONTROL_FIELDS].sort()).toEqual(['data_origin', 'import_batch_id', 'settlement_basis']);
  });

  it('26. الطبقة 1 ترفض data_origin بـ400', () => {
    expect(() => rejectFinancialControlFields({ data_origin: 'migrated' })).toThrow(/تحكّم مالي/);
  });

  it('27. الطبقة 1 ترفض settlement_basis — وهي الأخطر (تُخفي ملاحظة حرجة)', () => {
    expect(() => rejectFinancialControlFields({ settlement_basis: 'pre_system_settled' })).toThrow();
  });

  it('28. الطبقة 1 ترفض import_batch_id', () => {
    expect(() => rejectFinancialControlFields({ import_batch_id: 'x' })).toThrow();
  });

  it('29. الرفض يذكر كل الحقول المخالفة لا أوّلها فقط', () => {
    try {
      rejectFinancialControlFields({ data_origin: 'migrated', settlement_basis: 'credit_note', total_amount: 5 });
      throw new Error('كان يجب أن يرفض');
    } catch (e: any) {
      expect(e.message).toContain('data_origin');
      expect(e.message).toContain('settlement_basis');
    }
  });

  it('30. التعديل المشروع يمرّ بلا اعتراض', () => {
    expect(() => rejectFinancialControlFields({ total_amount: 100, notes: 'ok', approval_status: 'paid' })).not.toThrow();
    expect(() => rejectFinancialControlFields(undefined)).not.toThrow();
  });

  it('31. الطبقة 2 تجرّد الحقول ولا تُعدّل الكائن الأصلي', () => {
    const body: any = { total_amount: 100, data_origin: 'migrated', settlement_basis: 'pre_system_settled', import_batch_id: 'x', import_batch: {} };
    const clean: any = stripFinancialControlFields(body);
    expect(clean).toEqual({ total_amount: 100 });
    expect(body.data_origin).toBe('migrated');   // الأصل سليم
  });
});
