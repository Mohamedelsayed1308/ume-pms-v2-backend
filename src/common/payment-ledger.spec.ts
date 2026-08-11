import { NotFoundException, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { deriveStatus, sumInInvoiceCurrency, addPaymentAtomic, removePaymentAtomic, LedgerConfig } from './payment-ledger';
import { HIRE_LEDGER } from '../modules/hire-invoices/hire-payments.service';
import { MANAGEMENT_LEDGER } from '../modules/management-invoices/management-payments.service';

/**
 * قاعدة بيانات صورية في الذاكرة تُحاكي EntityManager داخل معاملة.
 * لا اتصال بأي قاعدة بيانات ولا كتابة على الإنتاج إطلاقاً.
 */
function makeDb(cfg: LedgerConfig, invoice: any, payments: any[] = [], opts: { failOnUpdate?: boolean } = {}) {
  const state = { invoice: { ...invoice }, payments: [...payments], committed: false, rolledBack: false };
  let seq = 0;
  const m: any = {
    findOne: async (E: any, o: any) =>
      E === cfg.invoiceEntity
        ? (o.where.id === state.invoice.id ? { ...state.invoice } : null)
        : (state.payments.find((p) => p.id === o.where.id) ?? null),
    find: async (_E: any, o: any) =>
      state.payments.filter((p) => p[cfg.fk] === o.where[cfg.fk]).map((p) => ({ ...p })),
    create: (_E: any, d: any) => ({ ...d }),
    save: async (_E: any, d: any) => { const row = { id: `p${++seq}`, ...d }; state.payments.push(row); return row; },
    delete: async (_E: any, id: string) => { state.payments = state.payments.filter((p) => p.id !== id); },
    update: async (_E: any, id: string, patch: any) => {
      if (opts.failOnUpdate) throw new Error('DB write failed');
      if (id === state.invoice.id) Object.assign(state.invoice, patch);
    },
  };
  const ds: any = {
    transaction: async (fn: any) => {
      const snap = { invoice: { ...state.invoice }, payments: state.payments.map((p) => ({ ...p })) };
      try { const r = await fn(m); state.committed = true; return r; }
      catch (e) { state.invoice = snap.invoice; state.payments = snap.payments; state.rolledBack = true; throw e; }
    },
  };
  return { state, ds };
}

const hireInv = (over: any = {}) => ({ id: 'h1', currency: 'EUR', total_amount: 1000, paid_amount: 0, status: 'unpaid', doc_type: 'invoice', ...over });
const mgmtInv = (over: any = {}) => ({ id: 'm1', currency: 'USD', amount: 800, paid_amount: 0, status: 'unpaid', ...over });

// كل حالة تُشغَّل على الدفترين لإثبات اتساق السلوك (بند 21)
const LEDGERS: [string, LedgerConfig, (over?: any) => any, string][] = [
  ['Hire', HIRE_LEDGER, hireInv, 'total_amount'],
  ['Management', MANAGEMENT_LEDGER, mgmtInv, 'amount'],
];

describe('R3C · اشتقاق الحالة', () => {
  it('1. صفر سداد ⇒ unpaid', () => expect(deriveStatus(0, 1000)).toBe('unpaid'));
  it('2. سداد جزئي ⇒ partial', () => expect(deriveStatus(400, 1000)).toBe('partial'));
  it('3. سداد مطابق ⇒ paid', () => expect(deriveStatus(1000, 1000)).toBe('paid'));
  it('23. حدود الدقّة العشرية', () => {
    expect(deriveStatus(999.999, 1000)).toBe('paid');
    expect(deriveStatus(999.99, 1000)).toBe('partial');
    expect(deriveStatus(0.004, 1000)).toBe('unpaid');
  });
  it('19. السداد بعملة أخرى لا يُحتسب — ولا يُحوَّل', () => {
    expect(sumInInvoiceCurrency('EUR', [{ amount: 500, currency: 'USD' }])).toBe(0);
    expect(sumInInvoiceCurrency('EUR', [{ amount: 500, currency: 'eur' }])).toBe(500);
  });
});

describe.each(LEDGERS)('R3C · %s — الحرّاس والذرّية', (name, cfg, mkInv, totalCol) => {
  const total = () => mkInv()[totalCol];

  it('4. مبلغ صفري أو سالب ⇒ رفض قبل أي كتابة', async () => {
    for (const amount of [0, -100]) {
      const { state, ds } = makeDb(cfg, mkInv());
      await expect(addPaymentAtomic(ds, cfg, mkInv().id, { amount })).rejects.toThrow(BadRequestException);
      expect(state.payments.length).toBe(0);
      expect(state.invoice.paid_amount).toBe(0);
    }
  });

  it('5. عملة مخالفة ⇒ رفض قبل أي كتابة', async () => {
    const { state, ds } = makeDb(cfg, mkInv());
    await expect(addPaymentAtomic(ds, cfg, mkInv().id, { amount: 100, currency: 'CHF' }))
      .rejects.toThrow(UnprocessableEntityException);
    expect(state.payments.length).toBe(0);
  });

  it('6. التجاوز ⇒ رفض', async () => {
    const { state, ds } = makeDb(cfg, mkInv());
    await expect(addPaymentAtomic(ds, cfg, mkInv().id, { amount: total() + 1 }))
      .rejects.toThrow(UnprocessableEntityException);
    expect(state.payments.length).toBe(0);
  });

  it('7. السداد المكمِّل بالضبط ⇒ مقبول والحالة paid', async () => {
    const { state, ds } = makeDb(cfg, mkInv());
    await addPaymentAtomic(ds, cfg, mkInv().id, { amount: total() });
    expect(state.invoice.status).toBe('paid');
    expect(state.invoice.paid_amount).toBe(total());
  });

  it('8. الإنشاء يعيد الحساب من سجلات القاعدة', async () => {
    const { state, ds } = makeDb(cfg, mkInv(), [{ id: 'p0', [cfg.fk]: mkInv().id, amount: 200, currency: mkInv().currency }]);
    await addPaymentAtomic(ds, cfg, mkInv().id, { amount: 300 });
    expect(state.invoice.paid_amount).toBe(500);
    expect(state.invoice.status).toBe('partial');
  });

  it('9+16. حذف آخر سداد ⇒ unpaid', async () => {
    const { state, ds } = makeDb(cfg, mkInv({ paid_amount: 400, status: 'partial' }),
      [{ id: 'p1', [cfg.fk]: mkInv().id, amount: 400, currency: mkInv().currency }]);
    await removePaymentAtomic(ds, cfg, mkInv().id, 'p1');
    expect(state.invoice.paid_amount).toBe(0);
    expect(state.invoice.status).toBe('unpaid');
  });

  it('17. حذف واحد من عدة سدادات ⇒ الحالة الصحيحة', async () => {
    const t = total();
    const { state, ds } = makeDb(cfg, mkInv({ paid_amount: t, status: 'paid' }), [
      { id: 'p1', [cfg.fk]: mkInv().id, amount: t - 100, currency: mkInv().currency },
      { id: 'p2', [cfg.fk]: mkInv().id, amount: 100, currency: mkInv().currency },
    ]);
    await removePaymentAtomic(ds, cfg, mkInv().id, 'p2');
    expect(state.invoice.paid_amount).toBe(t - 100);
    expect(state.invoice.status).toBe('partial');
  });

  it('10+11+24. فشل تحديث الفاتورة ⇒ تراجع كامل ولا يبقى سداد يتيم', async () => {
    const { state, ds } = makeDb(cfg, mkInv(), [], { failOnUpdate: true });
    await expect(addPaymentAtomic(ds, cfg, mkInv().id, { amount: 100 })).rejects.toThrow();
    expect(state.rolledBack).toBe(true);
    expect(state.payments.length).toBe(0);
    expect(state.invoice.paid_amount).toBe(0);
  });

  it('12+25. التجاوز يُقاس تحت قفل الصف من مجموع القاعدة لا من الـcache', async () => {
    // الـcache يقول صفر بينما السدادات الحقيقية تملأ الفاتورة ⇒ أي مبلغ إضافي يُرفض
    const t = total();
    const { state, ds } = makeDb(cfg, mkInv({ paid_amount: 0 }),
      [{ id: 'p0', [cfg.fk]: mkInv().id, amount: t, currency: mkInv().currency }]);
    await expect(addPaymentAtomic(ds, cfg, mkInv().id, { amount: 1 })).rejects.toThrow(/يتجاوز/);
    expect(state.payments.length).toBe(1);
  });

  it('13+14. المبلغ المُرسَل من العميل لا يُصدَّق — يُعاد الحساب دائماً', async () => {
    const { state, ds } = makeDb(cfg, mkInv({ paid_amount: 99999, status: 'paid' }));
    await addPaymentAtomic(ds, cfg, mkInv().id, { amount: 250, paid_amount: 99999, status: 'paid' });
    expect(state.invoice.paid_amount).toBe(250);
    expect(state.invoice.status).toBe('partial');
  });

  it('15. فاتورة غير موجودة ⇒ 404', async () => {
    const { ds } = makeDb(cfg, mkInv());
    await expect(addPaymentAtomic(ds, cfg, 'ghost', { amount: 10 })).rejects.toThrow(NotFoundException);
  });

  it('18. السداد يرث عملة الفاتورة قطعياً', async () => {
    const { state, ds } = makeDb(cfg, mkInv());
    await addPaymentAtomic(ds, cfg, mkInv().id, { amount: 100 });
    expect(state.payments[0].currency).toBe(mkInv().currency);
  });

  it('22. حذف سداد غير موجود لا يغيّر شيئاً', async () => {
    const { state, ds } = makeDb(cfg, mkInv({ paid_amount: 400 }),
      [{ id: 'p1', [cfg.fk]: mkInv().id, amount: 400, currency: mkInv().currency }]);
    await expect(removePaymentAtomic(ds, cfg, mkInv().id, 'ghost')).resolves.toEqual({ success: false });
    expect(state.invoice.paid_amount).toBe(400);
  });
});

describe('R3C · نموذج المستندات في فواتير الإيجار (لا نسخ أعمى من R3B)', () => {
  it('الإشعار الدائن/المدين خارج دورة السداد — لا يقبل سداداً', async () => {
    for (const doc_type of ['credit_note', 'debit_note']) {
      const { state, ds } = makeDb(HIRE_LEDGER, hireInv({ doc_type, status: 'issued' }));
      await expect(addPaymentAtomic(ds, HIRE_LEDGER, 'h1', { amount: 100 }))
        .rejects.toThrow(/إشعار/);
      expect(state.payments.length).toBe(0);
    }
  });

  it('🔴 حالة «صادر» لا تُمسح إلى unpaid عند أي إعادة حساب', async () => {
    // نسخ اشتقاق R3B أعمى كان سيفعل ذلك بالضبط ويهدم تصميماً متعمَّداً
    const { state, ds } = makeDb(HIRE_LEDGER, hireInv({ doc_type: 'credit_note', status: 'issued', paid_amount: 0 }),
      [{ id: 'p9', hire_invoice_id: 'h1', amount: 50, currency: 'EUR' }]);
    await removePaymentAtomic(ds, HIRE_LEDGER, 'h1', 'p9');
    expect(state.invoice.status).toBe('issued');
  });

  it('الفاتورة العادية تخضع لدورة السداد كاملةً', async () => {
    const { state, ds } = makeDb(HIRE_LEDGER, hireInv({ doc_type: 'invoice' }));
    await addPaymentAtomic(ds, HIRE_LEDGER, 'h1', { amount: 400 });
    expect(state.invoice.status).toBe('partial');
  });

  it('الفواتير الإدارية بلا doc_type — كل مستنداتها تخضع للسداد', () => {
    expect(MANAGEMENT_LEDGER.isOutsidePaymentCycle).toBeUndefined();
    expect(MANAGEMENT_LEDGER.totalColumn).toBe('amount');
    expect(HIRE_LEDGER.totalColumn).toBe('total_amount');
  });
});
