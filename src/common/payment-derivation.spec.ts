import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { InvoiceStatus } from '../modules/invoices/invoice.entity';
import {
  derivePaymentState, actualPaid, isLegacySettled,
  assertPositiveAmount, assertCurrencyMatch, assertNoOverpayment,
} from './payment-derivation';
import {
  SYSTEM_CONTROLLED_FIELDS, rejectSystemControlledFields, stripSystemControlledFields,
} from './financial-control-fields';

// بيانات صناعية بالكامل — لا قراءة ولا كتابة على الإنتاج
const inv = (total: number, currency = 'USD', settlement_basis?: string) => ({ total_amount: total, currency, settlement_basis });
const pay = (amount: number, currency = 'USD') => ({ amount, currency });

describe('R3B · اشتقاق حالة السداد من سجلات الدفع وحدها', () => {
  it('5. صفر سداد فعلي ⇒ unpaid — مهما قالت الموافقة', () => {
    const s = derivePaymentState(inv(1000), []);
    expect(s.status).toBe(InvoiceStatus.UNPAID);
    expect(s.paidAmount).toBe(0);
  });

  it('6. سداد جزئي ⇒ partial', () => {
    const s = derivePaymentState(inv(1000), [pay(400)]);
    expect(s.status).toBe(InvoiceStatus.PARTIAL);
    expect(s.paidAmount).toBe(400);
  });

  it('7. سداد كامل ⇒ paid', () => {
    const s = derivePaymentState(inv(1000), [pay(600), pay(400)]);
    expect(s.status).toBe(InvoiceStatus.PAID);
    expect(s.paidAmount).toBe(1000);
  });

  it('7b. الاشتقاق لا يقرأ approval_status إطلاقاً', () => {
    const withApproval: any = { ...inv(1000), approval_status: 'paid', status: 'paid', paid_amount: 1000 };
    expect(derivePaymentState(withApproval, []).status).toBe(InvoiceStatus.UNPAID);
    expect(derivePaymentState(withApproval, []).paidAmount).toBe(0);
  });

  it('7c. سداد بعملة مخالفة لا يُحتسب في المجموع', () => {
    expect(actualPaid(inv(1000, 'USD'), [pay(1000, 'EUR')])).toBe(0);
    expect(derivePaymentState(inv(1000, 'USD'), [pay(1000, 'EUR')]).status).toBe(InvoiceStatus.UNPAID);
  });

  it('7d. تفاوت نقدي: فرق أقل من نصف قرش يُعتبر سداداً كاملاً', () => {
    expect(derivePaymentState(inv(1000), [pay(999.999)]).status).toBe(InvoiceStatus.PAID);
    expect(derivePaymentState(inv(1000), [pay(999.5)]).status).toBe(InvoiceStatus.PARTIAL);
  });

  it('7e. الإشعار الدائن السالب لا يُصنَّف مدفوعاً خطأً', () => {
    expect(derivePaymentState(inv(-1775, 'EUR'), []).status).toBe(InvoiceStatus.UNPAID);
  });
});

describe('R3B · استثناء التسويات التاريخية (R3A محفوظة)', () => {
  it('21. التسوية التاريخية معروفة للنظام', () => {
    expect(isLegacySettled({ settlement_basis: 'pre_system_settled' })).toBe(true);
    expect(isLegacySettled({ settlement_basis: 'credit_note' })).toBe(true);
    expect(isLegacySettled({ settlement_basis: 'none' })).toBe(false);
    expect(isLegacySettled({})).toBe(false);
  });

  it('22. بلا هذا الاستثناء لكانت إعادة الاشتقاق تمسح توسيم R3A', () => {
    // 123 فاتورة تاريخية بصفر سداد: الاشتقاق الأعمى يعيدها unpaid ويهدم R3A
    const legacy = inv(1000, 'USD', 'pre_system_settled');
    expect(derivePaymentState(legacy, []).status).toBe(InvoiceStatus.UNPAID);   // لو استُدعي
    expect(isLegacySettled(legacy)).toBe(true);                                  // ⇒ لا يُستدعى
  });
});

describe('R3B · حارس العملة', () => {
  it('8. عملة مخالفة ⇒ رفض', () => {
    expect(() => assertCurrencyMatch('USD', 'EUR')).toThrow(UnprocessableEntityException);
    expect(() => assertCurrencyMatch('USD', 'EUR')).toThrow(/تحويل عملات/);
  });
  it('8b. التطابق يقبل اختلاف الحالة والمسافات', () => {
    expect(() => assertCurrencyMatch('USD', ' usd ')).not.toThrow();
    expect(() => assertCurrencyMatch(null, 'USD')).not.toThrow();   // الافتراضي USD
  });
  it('8c. لا تحويل عملات ضمني — الرسالة تنفيه صراحةً', () => {
    let m = ''; try { assertCurrencyMatch('EUR', 'USD'); } catch (e: any) { m = e.message; }
    expect(m).toContain('EUR'); expect(m).toContain('USD');
  });
});

describe('R3B · حارس تجاوز السداد', () => {
  it('9. التجاوز ⇒ رفض', () => {
    expect(() => assertNoOverpayment(600, 500, 1000)).toThrow(UnprocessableEntityException);
  });
  it('9b. السداد المكمِّل بالضبط مقبول', () => {
    expect(() => assertNoOverpayment(600, 400, 1000)).not.toThrow();
  });
  it('9c. أول سداد كامل مقبول', () => {
    expect(() => assertNoOverpayment(0, 1000, 1000)).not.toThrow();
  });
  it('9d. الفرق لا يُخفى — الرسالة تذكر الأرقام الثلاثة', () => {
    let m = ''; try { assertNoOverpayment(600, 500, 1000); } catch (e: any) { m = e.message; }
    expect(m).toContain('1100'); expect(m).toContain('1000');
  });
});

describe('R3B · حارس المبلغ الصفري والسالب', () => {
  it('10. صفر ⇒ رفض', () => expect(() => assertPositiveAmount(0)).toThrow(BadRequestException));
  it('11. سالب ⇒ رفض', () => expect(() => assertPositiveAmount(-100)).toThrow(BadRequestException));
  it('11b. غير رقمي ⇒ رفض', () => {
    for (const v of [null, undefined, '', 'abc', NaN]) expect(() => assertPositiveAmount(v)).toThrow();
  });
  it('11c. الموجب مقبول', () => {
    expect(() => assertPositiveAmount(0.01)).not.toThrow();
    expect(() => assertPositiveAmount('250.75')).not.toThrow();
  });
  it('11d. الرسالة توجّه للتصميم الصحيح بدل الالتفاف', () => {
    let m = ''; try { assertPositiveAmount(-5); } catch (e: any) { m = e.message; }
    expect(m).toMatch(/إشعار|مرتجع|تسوي/);
  });
});

describe('R3B · حماية الحقول التي يتحكّم بها النظام', () => {
  it('17-19. paid_amount و status مرفوضان في POST/PUT', () => {
    expect([...SYSTEM_CONTROLLED_FIELDS].sort()).toEqual(['paid_amount', 'status']);
    expect(() => rejectSystemControlledFields({ paid_amount: 999 })).toThrow(/يتحكّم بها النظام/);
    expect(() => rejectSystemControlledFields({ status: 'paid' })).toThrow();
    expect(() => rejectSystemControlledFields({ paid_amount: 1, status: 'paid' })).toThrow();
  });

  it('17b. حقول تحكّم R3A ما زالت مرفوضة (لا انحدار)', () => {
    expect(() => rejectSystemControlledFields({ settlement_basis: 'pre_system_settled' })).toThrow();
    expect(() => rejectSystemControlledFields({ data_origin: 'migrated' })).toThrow();
    expect(() => rejectSystemControlledFields({ import_batch_id: 'x' })).toThrow();
  });

  it('19b. approval_status يبقى مسموحاً — سير عمل إداري لا حقل مالي', () => {
    expect(() => rejectSystemControlledFields({ approval_status: 'paid' })).not.toThrow();
    expect(() => rejectSystemControlledFields({ total_amount: 500, notes: 'ok' })).not.toThrow();
  });

  it('19c. الرفض يسمّي كل الحقول المخالفة', () => {
    let m = ''; try { rejectSystemControlledFields({ paid_amount: 1, status: 'paid', data_origin: 'migrated' }); } catch (e: any) { m = e.message; }
    for (const f of ['paid_amount', 'status', 'data_origin']) expect(m).toContain(f);
  });

  it('19d. التجريد يحمي أي مسار ينسى الرفض، ولا يمسّ الأصل', () => {
    const body: any = { total_amount: 100, paid_amount: 999, status: 'paid', settlement_basis: 'pre_system_settled' };
    expect(stripSystemControlledFields(body)).toEqual({ total_amount: 100 });
    expect(body.paid_amount).toBe(999);
  });
});

// ── محاكاة إعادة الحساب بعد الحذف (نفس منطق recompute) ──
const recompute = (invoice: any, remaining: any[]) =>
  isLegacySettled(invoice) ? null : derivePaymentState(invoice, remaining);

describe('R3B · إعادة الحساب عند الحذف — من السجلات المتبقية لا بالطرح', () => {
  it('14-15. حذف السداد الأخير ⇒ unpaid', () => {
    expect(recompute(inv(1000), [])!.status).toBe(InvoiceStatus.UNPAID);
    expect(recompute(inv(1000), [])!.paidAmount).toBe(0);
  });

  it('16. حذف واحد من عدة سدادات ⇒ الحالة الصحيحة من المتبقي', () => {
    const after = recompute(inv(1000), [pay(400)])!;
    expect(after.status).toBe(InvoiceStatus.PARTIAL);
    expect(after.paidAmount).toBe(400);
  });

  it('14b. الطرح التفاضلي كان سيخطئ لو كان المخزَّن فاسداً — إعادة الحساب تصحّح', () => {
    // المخزَّن الفاسد 9999 لا يدخل الحساب إطلاقاً
    const corrupted: any = { ...inv(1000), paid_amount: 9999 };
    expect(recompute(corrupted, [pay(300)])!.paidAmount).toBe(300);
  });

  it('14c. الحذف لا يلمس تسوية تاريخية', () => {
    expect(recompute(inv(1000, 'USD', 'pre_system_settled'), [])).toBeNull();
  });
});
