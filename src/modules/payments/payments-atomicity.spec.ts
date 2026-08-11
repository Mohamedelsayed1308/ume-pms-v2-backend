import { PaymentsService } from './payments.service';
import { InvoicesService } from '../invoices/invoices.service';
import { Invoice, InvoiceStatus } from '../invoices/invoice.entity';
import { Payment } from './payment.entity';

/**
 * قاعدة بيانات صورية في الذاكرة تُحاكي EntityManager داخل معاملة.
 * الهدف إثبات السلوك: الذرّية · الحرّاس · إعادة الحساب من السجلات · حماية R3A.
 * لا اتصال بأي قاعدة بيانات ولا كتابة على الإنتاج إطلاقاً.
 */
function makeDb(invoice: any, payments: any[] = []) {
  const state = { invoice: { ...invoice }, payments: [...payments], committed: false, rolledBack: false };
  let seq = 0;
  const m: any = {
    findOne: async (E: any, o: any) => {
      if (E === Invoice) return o.where.id === state.invoice.id ? { ...state.invoice } : null;
      return state.payments.find((p) => p.id === o.where.id) ?? null;
    },
    find: async (_E: any, o: any) => state.payments.filter((p) => p.invoice_id === o.where.invoice_id).map((p) => ({ ...p })),
    create: (_E: any, d: any) => ({ ...d }),
    save: async (_E: any, d: any) => { const row = { id: `p${++seq}`, ...d }; state.payments.push(row); return row; },
    delete: async (_E: any, id: string) => { state.payments = state.payments.filter((p) => p.id !== id); },
    update: async (_E: any, id: string, patch: any) => { if (id === state.invoice.id) Object.assign(state.invoice, patch); },
  };
  const ds: any = {
    transaction: async (fn: any) => {
      const snapshot = { invoice: { ...state.invoice }, payments: state.payments.map((p) => ({ ...p })) };
      try { const r = await fn(m); state.committed = true; return r; }
      catch (e) { state.invoice = snapshot.invoice; state.payments = snapshot.payments; state.rolledBack = true; throw e; }
    },
  };
  return { state, ds };
}

const INV = { id: 'i1', currency: 'USD', total_amount: 1000, paid_amount: 0, status: InvoiceStatus.UNPAID, settlement_basis: 'none' };
const svc = (ds: any) => new PaymentsService({} as any, ds);

describe('R3B · ذرّية إنشاء السداد', () => {
  it('12. الإنشاء وتحديث الفاتورة داخل معاملة واحدة', async () => {
    const { state, ds } = makeDb(INV);
    await svc(ds).create({ invoice_id: 'i1', amount: 400, currency: 'USD' } as any);
    expect(state.committed).toBe(true);
    expect(state.payments.length).toBe(1);
    expect(state.invoice.paid_amount).toBe(400);
    expect(state.invoice.status).toBe(InvoiceStatus.PARTIAL);
  });

  it('13. فشل أي حارس ⇒ تراجع كامل: لا سداد ولا تغيير على الفاتورة', async () => {
    const { state, ds } = makeDb(INV);
    await expect(svc(ds).create({ invoice_id: 'i1', amount: 5000, currency: 'USD' } as any)).rejects.toThrow();
    expect(state.rolledBack).toBe(true);
    expect(state.payments.length).toBe(0);
    expect(state.invoice.paid_amount).toBe(0);
    expect(state.invoice.status).toBe(InvoiceStatus.UNPAID);
  });

  it('13b. العملة المخالفة تُرفض قبل أي كتابة', async () => {
    const { state, ds } = makeDb(INV);
    await expect(svc(ds).create({ invoice_id: 'i1', amount: 100, currency: 'EUR' } as any)).rejects.toThrow(/عملة/);
    expect(state.payments.length).toBe(0);
  });

  it('13c. المبلغ الصفري أو السالب يُرفض قبل أي كتابة', async () => {
    for (const amount of [0, -50]) {
      const { state, ds } = makeDb(INV);
      await expect(svc(ds).create({ invoice_id: 'i1', amount, currency: 'USD' } as any)).rejects.toThrow();
      expect(state.payments.length).toBe(0);
    }
  });

  it('13d. التجاوز يُقاس على المجموع الفعلي من القاعدة لا على paid_amount المخزَّن', async () => {
    // المخزَّن فاسد (0) بينما السدادات الحقيقية 900 ⇒ 200 إضافية تتجاوز
    const { state, ds } = makeDb({ ...INV, paid_amount: 0 }, [{ id: 'p0', invoice_id: 'i1', amount: 900, currency: 'USD' }]);
    await expect(svc(ds).create({ invoice_id: 'i1', amount: 200, currency: 'USD' } as any)).rejects.toThrow(/يتجاوز/);
    expect(state.payments.length).toBe(1);
  });

  it('13e. الفاتورة غير الموجودة تُرفض', async () => {
    const { ds } = makeDb(INV);
    await expect(svc(ds).create({ invoice_id: 'nope', amount: 10, currency: 'USD' } as any)).rejects.toThrow();
  });

  it('13f. السداد يرث عملة الفاتورة فلا يُخزَّن بعملة أخرى', async () => {
    const { state, ds } = makeDb({ ...INV, currency: 'EUR', total_amount: 500 });
    await svc(ds).create({ invoice_id: 'i1', amount: 100 } as any);
    expect(state.payments[0].currency).toBe('EUR');
  });

  it('13g. سداد مكمِّل ⇒ paid', async () => {
    const { state, ds } = makeDb(INV, [{ id: 'p0', invoice_id: 'i1', amount: 600, currency: 'USD' }]);
    await svc(ds).create({ invoice_id: 'i1', amount: 400, currency: 'USD' } as any);
    expect(state.invoice.status).toBe(InvoiceStatus.PAID);
    expect(state.invoice.paid_amount).toBe(1000);
  });
});

describe('R3B · حذف السداد', () => {
  it('14. الحذف يعيد الحساب من المتبقي', async () => {
    const { state, ds } = makeDb({ ...INV, paid_amount: 1000, status: InvoiceStatus.PAID }, [
      { id: 'p1', invoice_id: 'i1', amount: 600, currency: 'USD' },
      { id: 'p2', invoice_id: 'i1', amount: 400, currency: 'USD' },
    ]);
    await svc(ds).remove('p2');
    expect(state.invoice.paid_amount).toBe(600);
    expect(state.invoice.status).toBe(InvoiceStatus.PARTIAL);
  });

  it('15. حذف آخر سداد ⇒ unpaid', async () => {
    const { state, ds } = makeDb({ ...INV, paid_amount: 400, status: InvoiceStatus.PARTIAL }, [
      { id: 'p1', invoice_id: 'i1', amount: 400, currency: 'USD' },
    ]);
    await svc(ds).remove('p1');
    expect(state.invoice.paid_amount).toBe(0);
    expect(state.invoice.status).toBe(InvoiceStatus.UNPAID);
  });

  it('15b. حذف سداد غير موجود لا يغيّر شيئاً', async () => {
    const { state, ds } = makeDb({ ...INV, paid_amount: 400 }, [{ id: 'p1', invoice_id: 'i1', amount: 400, currency: 'USD' }]);
    await expect(svc(ds).remove('ghost')).resolves.toEqual({ deleted: false });
    expect(state.invoice.paid_amount).toBe(400);
  });
});

describe('R3B · التسويات التاريخية محميّة (R3A)', () => {
  it('21b. الفاتورة التاريخية لا تُعاد كتابتها عند أي إعادة حساب', async () => {
    const legacy = { ...INV, id: 'L1', paid_amount: 1000, status: InvoiceStatus.PAID, settlement_basis: 'pre_system_settled' };
    const { state, ds } = makeDb(legacy, [{ id: 'p9', invoice_id: 'L1', amount: 0.01, currency: 'USD' }]);
    await svc(ds).remove('p9');
    expect(state.invoice.paid_amount).toBe(1000);          // لم تتغيّر
    expect(state.invoice.status).toBe(InvoiceStatus.PAID); // لم تصر unpaid
  });

  it('22b. الإشعار الدائن التاريخي محميّ أيضاً', async () => {
    const cn = { ...INV, id: 'C1', total_amount: -1775, paid_amount: -1775, status: InvoiceStatus.PAID, settlement_basis: 'credit_note' };
    const { state, ds } = makeDb(cn, [{ id: 'p8', invoice_id: 'C1', amount: 1, currency: 'USD' }]);
    await svc(ds).remove('p8');
    expect(state.invoice.paid_amount).toBe(-1775);
  });
});

// ── فكّ الاقتران في خدمة الفواتير ──
function makeInvoiceSvc(initial: any) {
  const store: any = { ...initial };
  const repo: any = {
    save: async (d: any) => { Object.assign(store, d); return { ...store }; },
    update: async (_id: string, patch: any) => { Object.assign(store, patch); },
    findOne: async () => ({ ...store }),
  };
  return { svc: new InvoicesService(repo, { delete: async () => {} } as any), store };
}

describe('R3B · فكّ اقتران الموافقة عن السداد', () => {
  const base = { id: 'i1', currency: 'USD', total_amount: 1000, paid_amount: 0, status: InvoiceStatus.UNPAID, payments: [] };

  it('1. الإنشاء بموافقة paid لا يجعل paid_amount = الإجمالي', async () => {
    const { svc, store } = makeInvoiceSvc(base);
    await svc.create({ ...base, approval_status: 'paid' } as any);
    expect(store.paid_amount).toBe(0);
  });

  it('2. الإنشاء بموافقة paid لا يجعل الحالة paid', async () => {
    const { svc, store } = makeInvoiceSvc(base);
    await svc.create({ ...base, approval_status: 'paid' } as any);
    expect(store.status).toBe(InvoiceStatus.UNPAID);
  });

  it('3. تحديث الموافقة إلى paid لا يمسّ paid_amount', async () => {
    const { svc, store } = makeInvoiceSvc(base);
    await svc.update('i1', { approval_status: 'paid' } as any);
    expect(store.paid_amount).toBe(0);
    expect(store.approval_status).toBe('paid');   // سير العمل الإداري يتغيّر
  });

  it('4. تحديث الموافقة إلى paid لا يمسّ حالة السداد', async () => {
    const { svc, store } = makeInvoiceSvc({ ...base, paid_amount: 400, status: InvoiceStatus.PARTIAL });
    await svc.update('i1', { approval_status: 'paid' } as any);
    expect(store.status).toBe(InvoiceStatus.PARTIAL);
    expect(store.paid_amount).toBe(400);
  });

  it('4b. الفاتورة المسدَّدة فعلاً لا تتأثر بتغيير الموافقة إلى حالة أخرى', async () => {
    const { svc, store } = makeInvoiceSvc({ ...base, paid_amount: 1000, status: InvoiceStatus.PAID });
    await svc.update('i1', { approval_status: 'hold' } as any);
    expect(store.status).toBe(InvoiceStatus.PAID);
    expect(store.paid_amount).toBe(1000);
  });

  it('17-19b. paid_amount/status المُرسَلان يدوياً يُجرَّدان في الخدمة', async () => {
    const { svc, store } = makeInvoiceSvc(base);
    await svc.update('i1', { paid_amount: 9999, status: InvoiceStatus.PAID, notes: 'x' } as any);
    expect(store.paid_amount).toBe(0);
    expect(store.status).toBe(InvoiceStatus.UNPAID);
    expect(store.notes).toBe('x');
  });

  it('21c. updatePaidAmount لا يلمس التسوية التاريخية', async () => {
    const { svc, store } = makeInvoiceSvc({ ...base, paid_amount: 1000, status: InvoiceStatus.PAID, settlement_basis: 'pre_system_settled', payments: [] });
    await svc.updatePaidAmount('i1');
    expect(store.paid_amount).toBe(1000);
    expect(store.status).toBe(InvoiceStatus.PAID);
  });

  it('21d. updatePaidAmount يشتقّ بشكل صحيح للفاتورة التشغيلية', async () => {
    const { svc, store } = makeInvoiceSvc({ ...base, paid_amount: 9999, status: InvoiceStatus.PAID, payments: [{ amount: 250, currency: 'USD' }] });
    await svc.updatePaidAmount('i1');
    expect(store.paid_amount).toBe(250);
    expect(store.status).toBe(InvoiceStatus.PARTIAL);
  });
});
