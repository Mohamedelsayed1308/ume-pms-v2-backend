import { BadRequestException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';

/*
 * الفاتورة تُصنَّف أو لا تُحفَظ.
 *
 * الاختبار يحرس بابين: منعُ خلق فاتورة بلا تصنيف، و**السماح** بتعديل الفواتير
 * الـ84 القائمة بلا تصنيف — فشرطٌ يمنع تصحيحها يمنع علاج المشكلة نفسها.
 */
describe('إلزام تصنيف الفاتورة', () => {
  const svc = new InvoicesService(null as any, null as any);
  const check = (data: any, existing?: any) => (svc as any).assertClassified(data, existing);

  it('يقبل فاتورةً ببند', () => {
    expect(() => check({ item_id: 'x', total_amount: 100 })).not.toThrow();
  });

  it('يقبل فاتورةً بسطور تفصيلية بلا بند', () => {
    expect(() => check({ line_items: [{ item_name: 'Supplies', amount: 50 }] })).not.toThrow();
  });

  it('يرفض فاتورةً بلا بند ولا سطور', () => {
    expect(() => check({ total_amount: 100 })).toThrow(BadRequestException);
    expect(() => check({ item_id: null, line_items: [] })).toThrow(BadRequestException);
  });

  it('يقبل تعديلاً لا يحمل البند ما دام القائم مُصنَّفاً', () => {
    expect(() => check({ total_amount: 999 }, { item_id: 'x' })).not.toThrow();
  });

  it('يقبل تصنيف فاتورةٍ قائمة بلا بند', () => {
    expect(() => check({ item_id: 'new' }, { item_id: null })).not.toThrow();
  });

  it('يرفض تعديلاً يُجرّد فاتورةً من بندها', () => {
    expect(() => check({ item_id: null }, { item_id: 'x' })).toThrow(BadRequestException);
  });

  it('يرفض تعديل فاتورةٍ قائمة بلا تصنيف إن بقيت بلا تصنيف', () => {
    // ‏84 فاتورة في هذه الحال — تعديلها يجب أن يحمل تصنيفها
    expect(() => check({ total_amount: 5 }, { item_id: null })).toThrow(BadRequestException);
  });
});
