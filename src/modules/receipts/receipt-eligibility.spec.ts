import { evaluateAccrualEligibility, ReceiptRecord } from './receipt-eligibility';

const rc = (over: Partial<ReceiptRecord> = {}): ReceiptRecord => ({
  receipt_type: 'GOODS_RECEIVED', received_date: '2026-07-20', ...over,
});

describe('أهلية الاستحقاق من زاوية الاستلام', () => {
  it('1. سلعة بلا واقعة استلام غير مؤهَّلة', () => {
    const v = evaluateAccrualEligibility({ category: 'GOODS', approval_status: 'booking_waiting_payment' });
    expect(v.eligible).toBe(false);
    expect(v.basis).toBe('NONE');
    expect(v.reason).toMatch(/تُثبت المطالبة لا الاستلام/);
  });

  it('2. سلعة بواقعة استلام مسجَّلة مؤهَّلة', () => {
    const v = evaluateAccrualEligibility({ category: 'GOODS', receipts: [rc()] });
    expect(v.eligible).toBe(true);
    expect(v.basis).toBe('RECEIPT_RECORD');
  });

  it('3. الإقرار الإداري يقوم مقام إذن الاستلام', () => {
    const v = evaluateAccrualEligibility({
      category: 'GOODS', receipts: [rc({ receipt_type: 'MANAGEMENT_RECEIPT_CONFIRMATION' })],
    });
    expect(v.eligible).toBe(true);
    expect(v.basis).toBe('RECEIPT_RECORD');
  });

  it('4. delivery_missing تحجب ولو كان التصنيف خدمة بفترة منقضية', () => {
    const v = evaluateAccrualEligibility({
      category: 'PERIOD_SERVICE', approval_status: 'delivery_missing',
      service_period_end: '2026-07-23', as_of: '2026-08-12',
    });
    expect(v.eligible).toBe(false);
    expect(v.reason).toMatch(/يصرّح بغياب التسليم/);
  });

  it('5. واقعة استلام صريحة تنقض delivery_missing', () => {
    const v = evaluateAccrualEligibility({
      category: 'GOODS', approval_status: 'delivery_missing', receipts: [rc()],
    });
    expect(v.eligible).toBe(true);
  });

  it('6. خدمة بفترة انقضت مؤهَّلة بلا إذن استلام', () => {
    const v = evaluateAccrualEligibility({
      category: 'PERIOD_SERVICE', service_period_end: '2026-07-31', as_of: '2026-08-12',
    });
    expect(v.eligible).toBe(true);
    expect(v.basis).toBe('SERVICE_PERIOD_ELAPSED');
  });

  it('7. خدمة لم تنقضِ فترتها بعد غير مؤهَّلة', () => {
    const v = evaluateAccrualEligibility({
      category: 'PERIOD_SERVICE', service_period_end: '2027-05-31', as_of: '2026-07-31',
    });
    expect(v.eligible).toBe(false);
    expect(v.reason).toMatch(/لم تنقضِ بعد/);
  });

  it('8. خدمة بلا فترة مُثبَتة غير مؤهَّلة — الفترة دليلها فلا تُفترض', () => {
    const v = evaluateAccrualEligibility({ category: 'PERIOD_SERVICE' });
    expect(v.eligible).toBe(false);
    expect(v.reason).toMatch(/بلا نهاية فترة مُثبَتة/);
  });

  it('9. حالات سير العمل ليست قواعد محاسبية — hold و waiting_approval لا تحجبان بذاتهما', () => {
    for (const s of ['hold', 'waiting_approval', 'booking_waiting_payment', 'waiting_po']) {
      const v = evaluateAccrualEligibility({
        category: 'PERIOD_SERVICE', approval_status: s,
        service_period_end: '2026-07-31', as_of: '2026-08-12',
      });
      expect(v.eligible).toBe(true);
    }
  });

  it('10. الحالات نفسها لا تُنجي سلعة بلا استلام', () => {
    for (const s of ['hold', 'waiting_approval', 'booking_waiting_payment', 'waiting_po']) {
      expect(evaluateAccrualEligibility({ category: 'GOODS', approval_status: s }).eligible).toBe(false);
    }
  });

  it('11. حالة يوليو الفعلية — 7 سلع محجوبة وخدمة واحدة مؤهَّلة', () => {
    const goods = ['26031', '260926', '260933', '260942', '26032', '2602615/SKV', 'W/27011'];
    const blocked = goods.filter((_) => !evaluateAccrualEligibility({ category: 'GOODS' }).eligible);
    expect(blocked).toHaveLength(7);

    // INV-2026-65659 — اشتراك برمجيات عن فترة انقضت
    expect(evaluateAccrualEligibility({
      category: 'PERIOD_SERVICE', approval_status: 'waiting_approval',
      service_period_end: '2026-07-31', as_of: '2026-08-12',
    }).eligible).toBe(true);

    // A 2600143 — النظام يصرّح بغياب التسليم
    expect(evaluateAccrualEligibility({
      category: 'PERIOD_SERVICE', approval_status: 'delivery_missing',
      service_period_end: '2026-07-23', as_of: '2026-08-12',
    }).eligible).toBe(false);
  });

  it('12. Navtor — اشتراك مايو 2026 إلى مايو 2027 لم تنقضِ فترته', () => {
    const v = evaluateAccrualEligibility({
      category: 'PERIOD_SERVICE', approval_status: 'waiting_po',
      service_period_end: '2027-05-31', as_of: '2026-07-27',
    });
    expect(v.eligible).toBe(false);
    // وهو ما يسند معالجته كمصروف مقدَّم لا مصروف كامل عند الفاتورة.
  });
});
