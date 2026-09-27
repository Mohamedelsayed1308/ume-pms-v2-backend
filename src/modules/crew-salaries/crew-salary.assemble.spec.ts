import { assemble, noteKey, type Sources } from './crew-salary.assemble';
import { sourceKey } from './crew-salary.match';
import type { CfmExport } from './parsers/cfm.parser';
import type { EmailRow, ParsedEmailBody } from './parsers/email-body.parser';
import type { PayoutRow } from './parsers/attachments.parser';

/* بياناتٌ اصطناعيّة — لا بحّارة حقيقيّون. */
const P = { sheet: 'x', row: 1 };
function cfm(cur: string, crew: { id: string; name: string; section?: 'monthly' | 'final'; start?: string; end?: string; rates?: [string, string, string]; lashing?: string }[]): CfmExport {
  return {
    currency: cur, month: '2026-08', vessel: 'Test Vessel', grand_total_balance: null, warnings: [],
    rows: crew.map((c) => ({ crew_id: c.id, name: c.name, rank: 'AB', nationality: 'X', section: c.section || 'monthly', pay_start: c.start || '2026-08-01', pay_end: c.end || '2026-08-31', payroll_days: 30, columns: {}, balance: null, provenance: P })),
    seafarers: crew.map((c) => ({
      crew_id: c.id, sheet: `Wage ${c.name}`, full_name: c.name, rank: 'AB', nationality: 'X', contract_start: null, contract_end: null, embarkation: null, disembarkation: null,
      rates: { basic: (c.rates || ['1000', '400', '250'])[0], fixed_ot: (c.rates || ['1000', '400', '250'])[1], leave: (c.rates || ['1000', '400', '250'])[2] },
      items: c.lashing ? [{ kind: 'lashing', label: 'Bonus', description: 'lashing Bonus', amount: c.lashing, provenance: P }] : [], balance: null, bank: null,
    })),
  };
}
const row = (over: Partial<EmailRow>): EmailRow => ({ table: 1, row: 1, row_label: '1', crew_id: null, name: '', rank: 'AB', nationality: 'X', payroll_days: 30, statement: '', items: [], unknown: [], unreadable: [], ...over });
const email = (tables: { currency: string | null; rows: EmailRow[] }[], notes: ParsedEmailBody['notes'] = [], issues: ParsedEmailBody['issues'] = []): ParsedEmailBody => ({
  tables: tables.map((t, i) => ({ index: i + 1, title: t.currency ? `EARNING ${t.currency}` : 'EARNING', currency: t.currency, headers: [], rows: t.rows.map((r) => ({ ...r, table: i + 1 })) })),
  notes, issues,
});
const base = (over: Partial<Sources>): Sources => ({ month: '2026-08', vessel: 'Test Vessel', cfm: [cfm('USD', [{ id: '9001', name: 'Alpha, Test' }])], ...over });
const fx = { month: '2026-08', perUsd: { EUR: String(1 / 1.17) } };

describe('التجميع — لا بيانات ماليّة تسقط بصمت', () => {
  it('صفٌّ بلا رقم بحّار: قضيّةٌ معلّقة بمرشّحيها — ثمّ يُربط بالاسم المؤكَّد', () => {
    const r = row({ name: 'Test Alpha', items: [{ kind: 'lashing', column: 'Lashing Bonus', amount: '418.86' }] });
    const a = assemble(base({ email: email([{ currency: 'USD', rows: [r] }]) }), null);
    const u = a.unresolved.find((x) => x.kind === 'email_row_no_id')!;
    expect(u).toMatchObject({ key: 'email:t1:r1', resolution: null });
    expect(u.candidates![0].crew_id).toBe('9001');
    expect(a.entries[0].input.extras).toEqual([]);
    const linked = assemble(base({ email: email([{ currency: 'USD', rows: [r] }]), links: new Map([[sourceKey('Test Alpha'), '9001']]) }), null);
    expect(linked.unresolved.filter((x) => x.kind === 'email_row_no_id')).toEqual([]);
    expect(linked.entries[0].input.extras.map((x) => x.amount)).toEqual(['418.86']);
  });

  it('عمودٌ ماليّ مجهول: بندٌ «غير مصنَّف» يمنع الاكتمال — والتصنيف يدخله الحساب', () => {
    const r = row({ crew_id: '9001', unknown: [{ column: 'Special allowance', value: '75' }] });
    const a = assemble(base({ email: email([{ currency: 'USD', rows: [r] }]) }), null);
    const e = a.entries[0];
    expect(e.input.extras[0]).toMatchObject({ kind: 'unclassified', amount: '75', flags: ['unknown_column'] });
    expect(e.result.complete).toBe(false);
    const c = assemble(base({ email: email([{ currency: 'USD', rows: [r] }]), classify: { 'email:t1:r1:x:special_allowance': 'other_earning' } }), null);
    expect(c.entries[0].result.items.find((i) => i.key === 'email:t1:r1:x:special_allowance')).toMatchObject({ kind: 'other_earning', counted: true });
  });

  it('مبلغٌ غير مقروء يبقى ظاهراً مانعاً', () => {
    const r = row({ crew_id: '9001', unreadable: [{ kind: 'lashing', column: 'Lashing Bonus', value: '4I8.86' }] });
    const e = assemble(base({ email: email([{ currency: 'USD', rows: [r] }]) }), null).entries[0];
    expect(e.result.issues.map((i) => i.code)).toContain('amount_unreadable');
  });

  it('بحّارٌ خارج CFM في جدولين بعملتين: حالةٌ لكلّ عملة، ولا يُسجَّل اليورو دولاراً', () => {
    const a = assemble(base({ email: email([
      { currency: 'USD', rows: [row({ crew_id: '9500', name: 'Outside, One', items: [{ kind: 'lashing', column: 'Lashing', amount: '100' }] })] },
      { currency: 'EUR', rows: [row({ crew_id: '9500', name: 'Outside, One', items: [{ kind: 'bonus', column: 'Bonus', amount: '50' }] })] },
    ]) }), null);
    const sup = a.entries.filter((e) => e.crew_id === '9500');
    expect(sup.map((e) => [e.key, e.input.extras.map((x) => `${x.amount} ${x.currency}`).join()])).toEqual([['9500:USD', '100 USD'], ['9500:EUR', '50 EUR']]);
  });

  it('جدولٌ بلا عملة: لبحّارٍ في CFM عملةٌ «مستنتَجة» معلَّمة، ولغيره قضيّةٌ حتّى تُحدَّد', () => {
    const a = assemble(base({ email: email([{ currency: null, rows: [
      row({ crew_id: '9001', items: [{ kind: 'bonus', column: 'Bonus', amount: '358' }] }),
      row({ crew_id: '9600', row: 2, name: 'Outside, Two', items: [{ kind: 'bonus', column: 'Bonus', amount: '10' }] }),
    ] }]) }), null);
    expect(a.entries[0].input.extras[0].flags).toEqual(['currency_inferred']);
    expect(a.unresolved.map((u) => u.kind)).toContain('email_row_unknown_currency');
    const ok = assemble(base({ email: email([{ currency: null, rows: [row({ crew_id: '9001', items: [{ kind: 'bonus', column: 'Bonus', amount: '358' }] })] }]), item_currency: { 'email:t1:r1:bonus': 'USD' } }), null);
    expect(ok.entries[0].input.extras[0].flags).toBeUndefined();
  });

  it('المبلغ نفسه في الرسالة وكشف الصرف ⇒ مكرّرٌ محتمل مربوطٌ بأصله', () => {
    const payout: PayoutRow = { no: 1, name: 'Alpha, Test', name_ar: '', rank: 'AB', account_currency: 'USD', account_number: '1', branch: '', bank: 'B', beneficiary_ar: '', cash_advance_eur: null, cigarettes_usd: null, other_addition: null, bonus: '358', other_deduction: null, sign_off: null, sign_on: null, provenance: { sheet: 's', row: 9 } };
    const a = assemble(base({ payout: [payout], email: email([{ currency: 'USD', rows: [row({ crew_id: '9001', items: [{ kind: 'lashing', column: 'Lashing', amount: '358' }] })] }]) }), null);
    const dup = a.entries[0].input.extras.find((x) => x.source === 'attachment')!;
    expect(dup).toMatchObject({ duplicate_of: 'email:t1:r1:lashing' });
    expect(dup.flags).toContain('possible_duplicate');
  });

  it('ملاحظةٌ بمبلغ: معلّقة حتّى تُربط ببحّارٍ مؤكَّد — فيُنشأ له مستحقٌّ تكميليّ بلا مرتّب', () => {
    const note = { text: 'Kindly deposit 47.73€ (Lashing Bonus) in bank account of Master', amount: '47.73', currency: 'EUR', paragraph: 9 };
    const a = assemble(base({ email: email([], [note]) }), null);
    expect(a.unresolved.find((u) => u.kind === 'note')!.resolution).toBeNull();
    const b = assemble(base({ email: email([], [note]), supplementary: [{ source_key: noteKey(note), crew_id: '7777', name: 'Master, Test', currency: 'EUR', amount: '47.73', kind: 'lashing', reason: 'رقمه من سجلّ الطاقم' }] }), null);
    expect(b.unresolved.find((u) => u.kind === 'note')!.resolution!.action).toBe('resolved');
    const e = b.entries.find((x) => x.crew_id === '7777')!;
    expect(e).toMatchObject({ key: '7777:EUR', section: 'supplementary' });
    expect(e.input.rates).toBeNull();
    expect(e.input.extras[0]).toMatchObject({ key: 'supp:email:note:p9', amount: '47.73', review: 'pending', flags: ['manually_identified'] });
  });

  it('عملة دفعٍ استثنائيّة بقرار: الدفع بالدولار والمقارنة بعملة العقد', () => {
    const a = assemble(base({ cfm: [cfm('EUR', [{ id: '9100', name: 'Euro, Test' }])], payment_currency: { '9100:EUR': 'USD' } }), fx);
    const e = a.entries[0];
    expect(e).toMatchObject({ currency: 'EUR', payment_currency: 'USD', payment_currency_exception: true });
    expect(e.result.currency).toBe('USD');
    expect(e.result.items[0]).toMatchObject({ original_currency: 'EUR', contract_amount: '1000.00', amount: '1170.00' });
  });

  it('PDF توزيع اللاشينج مرجعٌ يُظهر التعارض ولا يستبدل الرسالة', () => {
    const a = assemble(base({
      email: email([{ currency: 'USD', rows: [row({ crew_id: '9001', items: [{ kind: 'lashing', column: 'Lashing Bonus', amount: '418.76' }] })] }]),
      lashing_pdf: { file: 'LB.pdf', rows: [{ line: 7, page: 1, days: 15, label: 'A.B 7 Test Alpha', name: 'Test Alpha', eur: '358', rate: '1.17', usd: '418.86', eur_pay: '0' }] },
    }), null);
    const e = a.entries[0];
    expect(e.source_conflicts).toEqual([expect.objectContaining({ kind: 'lashing', email: '418.76', other: '418.86', currency: 'USD' })]);
    expect(e.input.extras[0].amount).toBe('418.76');
  });

  it('انقطاع جدولٍ وملفٌّ لم يُقرأ قضايا معلّقة — ويحسمها قرارٌ مسبَّب', () => {
    const issues = [{ key: 'email:t1:tail', table: 1, kind: 'possible_unread_rows' as const, detail: 'x' }];
    const a = assemble(base({ email: email([], [], issues), file_issues: [{ key: 'file:1', name: 'x.xlsx', detail: 'لم يُقرأ' }] }), null);
    expect(a.unresolved.map((u) => [u.kind, !!u.resolution])).toEqual([['parse_issue', false], ['file', false]]);
    const b = assemble(base({ email: email([], [], issues), resolutions: { 'email:t1:tail': { action: 'excluded', reason: 'سطر توقيع' } } }), null);
    expect(b.unresolved[0].resolution).toEqual({ action: 'excluded', reason: 'سطر توقيع' });
  });

  it('النزول في آخر الشهر (قسم الحساب النهائيّ) بلا يومٍ إضافيّ', () => {
    const a = assemble(base({ cfm: [cfm('USD', [{ id: '9002', name: 'Late, Test', section: 'final', start: '2026-08-10', end: '2026-08-31' }])] }), null);
    expect(a.entries[0].result.items.some((i) => i.kind === 'sign_off_day')).toBe(false);
    const b = assemble(base({ cfm: [cfm('USD', [{ id: '9002', name: 'Early, Test', section: 'final', start: '2026-08-01', end: '2026-08-06' }])] }), null);
    expect(b.entries[0].result.items.some((i) => i.kind === 'sign_off_day')).toBe(true);
  });
});
