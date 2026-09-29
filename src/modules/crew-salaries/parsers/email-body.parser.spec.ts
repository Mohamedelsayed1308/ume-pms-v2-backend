import { parseEmailBody } from './email-body.parser';

/*
 * نصّ رسالةٍ اصطناعيّ بصيغة Outlook: كلّ خليّةٍ فقرة، والفارغة مسافة.
 * لا بحّارة حقيقيّون.
 */
const para = (cells: string[]) => cells.map((c) => (c === '' ? ' ' : c)).join('\n\n');
const body = (title: string, headers: string[], rows: string[][], tail: string[] = []) =>
  para(['Dear Sir,', title, ...headers, ...rows.flat(), '', '', ...tail, 'Best regards']);
const H = ['No.', 'ID', 'Name', 'Rank', 'Nationality', 'Payroll Days', 'Statement', 'Lashing Bonus'];

describe('جداول نصّ الرسالة — لا شيء يسقط بصمت', () => {
  it('الحالة السليمة', () => {
    const p = parseEmailBody(body('EARNING USD', H, [['1', '9001', 'Alpha, A', 'AB', 'X', '30', '', '418.86'], ['2', '9002', 'Bravo, B', 'OS', 'X', '30', '', '1,256.58']]));
    expect(p.tables).toHaveLength(1);
    expect(p.tables[0].currency).toBe('USD');
    expect(p.tables[0].rows.map((r) => r.items[0].amount)).toEqual(['418.86', '1256.58']);
    expect(p.issues).toEqual([]);
  });

  it('رقم صفٍّ مفقود: يُقرأ الصفّ ويُسجَّل', () => {
    const p = parseEmailBody(body('EARNING USD', H, [['1', '9001', 'Alpha, A', 'AB', 'X', '30', '', '10'], ['', '9002', 'Bravo, B', 'OS', 'X', '30', '', '20'], ['3', '9003', 'Charlie, C', 'OS', 'X', '30', '', '30']]));
    expect(p.tables[0].rows.map((r) => r.crew_id)).toEqual(['9001', '9002', '9003']);
    expect(p.issues.map((i) => i.kind)).toEqual(['row_number_missing']);
  });

  it('قفزةٌ في التسلسل لا توقف الجدول', () => {
    const p = parseEmailBody(body('EARNING USD', H, [['1', '9001', 'Alpha, A', 'AB', 'X', '30', '', '10'], ['3', '9003', 'Charlie, C', 'OS', 'X', '30', '', '30'], ['4', '9004', 'Delta, D', 'OS', 'X', '30', '', '40']]));
    expect(p.tables[0].rows).toHaveLength(3);
    expect(p.issues.map((i) => i.kind)).toEqual(['row_number_gap']);
  });

  it('ترتيب الأعمدة وأسماؤها تتغيّر: يُقرأ بالعنوان لا بالموضع', () => {
    const h = ['No.', 'Name', 'ID', 'Rank', 'Nationality', 'Payroll Days', 'Extra baggage', 'Lashing bonus ', 'Statement'];
    const p = parseEmailBody(body('EARNING EUR', h, [['1', 'Alpha, A', '9001', 'AB', 'X', '30', '50', '358', '']]));
    const r = p.tables[0].rows[0];
    expect(r.crew_id).toBe('9001');
    expect(r.items).toEqual([{ kind: 'luggage', column: 'Extra baggage', amount: '50' }, { kind: 'lashing', column: 'Lashing bonus', amount: '358' }]);
  });

  it('مبلغٌ غير مقروء في عمودٍ معروف يُحفظ نصّاً ولا يُسقَط', () => {
    const p = parseEmailBody(body('EARNING USD', H, [['1', '9001', 'Alpha, A', 'AB', 'X', '30', '', '4I8.86']]));
    expect(p.tables[0].rows[0].items).toEqual([]);
    expect(p.tables[0].rows[0].unreadable).toEqual([{ kind: 'lashing', column: 'Lashing Bonus', value: '4I8.86' }]);
  });

  it('صفٌّ بلا رقم بحّار يبقى بصفّه واسمه', () => {
    const p = parseEmailBody(body('EARNING USD', H, [['1', '', 'Alpha, A', 'AB', 'X', '30', '', '10']]));
    expect(p.tables[0].rows[0]).toMatchObject({ crew_id: null, name: 'Alpha, A' });
  });

  it('عمودٌ ماليّ مجهول يُحفظ بقيمته', () => {
    const h = [...H, 'Special allowance'];
    const p = parseEmailBody(body('EARNING USD', h, [['1', '9001', 'Alpha, A', 'AB', 'X', '30', '', '10', '75']]));
    expect(p.tables[0].rows[0].unknown).toEqual([{ column: 'Special allowance', value: '75' }]);
  });

  it('فقراتٌ رقميّة بعد الجدول تُعلَّم «ربّما صفوفٌ لم تُقرأ»', () => {
    const p = parseEmailBody(body('EARNING USD', H, [['1', '9001', 'Alpha, A', 'AB', 'X', '30', '', '10']], ['x', '9005', '30', '418.86']));
    expect(p.issues.map((i) => i.kind)).toEqual(['possible_unread_rows']);
  });

  it('الملاحظة بمبلغٍ خارج الجداول اقتراحٌ لا بند', () => {
    const p = parseEmailBody(body('EARNING', H, [['1', '9001', 'Alpha, A', 'AB', 'X', '30', '', '10']], ['*\tKindly deposit an amount of 47.73€ ( Lashing Bonus) in bank account of Master/ Test Person.']));
    expect(p.tables[0].currency).toBeNull();
    expect(p.notes.map((n) => [n.amount, n.currency])).toEqual([['47.73', 'EUR']]);
  });
});
