import * as fs from 'fs';
import * as path from 'path';
import { parseMsg } from './parsers/msg.parser';
import { parseEmailBody } from './parsers/email-body.parser';
import { parseCfm } from './parsers/cfm.parser';
import { parseAttachmentWorkbook, type BankBlock, type CrewListRow, type PayoutRow } from './parsers/attachments.parser';
import { parsePdf, parsePdfs } from './parsers/pdf.parser';
import { assemble } from './crew-salary.assemble';
import { totalsByCurrency } from './crew-salary.calc';

/*
 * عيّنة أغسطس ٢٠٢٦ الحقيقيّة — **تُقرأ من مسارٍ محلّيّ ولا تدخل Git أبداً**.
 * تُشغَّل بتحديد المجلّد:  CREW_SAMPLE_DIR=<dir> npx jest crew-salary.sample
 * وفيه: aug.msg · cfm_usd.xlsx · cfm_eur.xlsx. وبدونه يُتخطّى الاختبار كلّه.
 * ولا يطبع أسماءً ولا أرقام حسابات.
 */
const DIR = process.env.CREW_SAMPLE_DIR || '';
const ready = !!DIR && ['aug.msg', 'cfm_usd.xlsx', 'cfm_eur.xlsx'].every((f) => fs.existsSync(path.join(DIR, f)));
const d = ready ? describe : describe.skip;

d('عيّنة أغسطس ٢٠٢٦ — جوبال تريدر', () => {
  const msg = ready ? parseMsg(fs.readFileSync(path.join(DIR, 'aug.msg'))) : null!;
  const usd = ready ? parseCfm(fs.readFileSync(path.join(DIR, 'cfm_usd.xlsx')), 'cfm_usd.xlsx') : null!;
  const eur = ready ? parseCfm(fs.readFileSync(path.join(DIR, 'cfm_eur.xlsx')), 'cfm_eur.xlsx') : null!;
  const body = ready ? parseEmailBody(msg.body) : null!;
  let payout: PayoutRow[] = [], blocks: BankBlock[] = [], crew: CrewListRow[] = [];
  if (ready) {
    for (const a of msg.attachments.filter((x) => x.class === 'spreadsheet')) {
      const s = parseAttachmentWorkbook(a.content, a.name);
      if (s.kind === 'payout') payout = s.rows;
      if (s.kind === 'bank_blocks') blocks = s.rows;
      if (s.kind === 'crew_list') crew = s.rows;
    }
  }

  it('الرسالة: الموضوع والمرسل والتاريخ و١٨ مرفقاً مصنّفة', () => {
    expect(msg.subject).toBe('GT-CRW | Salary of Aug. 2026');
    expect(msg.from).toBe('crew@umegypt.com');
    expect(msg.sent_at!.slice(0, 10)).toBe('2026-08-24');
    const count = (c: string) => msg.attachments.filter((a) => a.class === c).length;
    expect(msg.attachments).toHaveLength(18);
    expect([count('spreadsheet'), count('pdf'), count('image'), count('inline_image'), count('spreadsheet_macro')]).toEqual([4, 12, 1, 1, 0]);
  });

  it('نصّ الرسالة: جدولان (١٢ صفّاً بالدولار و٨ بلا عملة) وملاحظةٌ واحدة بمبلغ', () => {
    expect(body.tables.map((t) => [t.currency, t.rows.length])).toEqual([['USD', 12], [null, 8]]);
    const r379 = body.tables[0].rows.find((r) => r.crew_id === '379')!;
    expect(r379.items).toEqual([{ kind: 'lashing', column: 'Lashing Bonus', amount: '418.76' }]);
    const r268 = body.tables[0].rows.find((r) => r.crew_id === '268')!;
    expect(r268.items).toEqual([{ kind: 'salary_difference', column: 'Difference in salary', amount: '350' }]);
    expect(r268.statement).toMatch(/fitter welder/);
    const t2 = body.tables[1].rows;
    expect(t2.find((r) => r.crew_id === '1074')!.items).toEqual([{ kind: 'sign_on_settlement', column: 'Salary of 1 day to sign on', amount: '333.33' }]);
    expect(t2.find((r) => r.crew_id === '527')!.items).toEqual([{ kind: 'sign_off_day', column: 'Salary of 1 day to sign off', amount: '93.33' }]);
    expect(body.notes.map((n) => [n.amount, n.currency])).toEqual([['47.73', 'EUR']]);
    expect(body.issues).toEqual([]);
  });

  it('PDF: توزيع اللاشينج يُقرأ، ووثائق الهويّة لا يُستخرج نصّها، والممسوح يدويّ', async () => {
    const pdfs = msg.attachments.filter((x) => x.class === 'pdf');
    const kinds = (await parsePdfs(pdfs.map((x) => ({ buf: x.content, name: x.name })))).map((r) => r.kind);
    const count = (k: string) => kinds.filter((x) => x === k).length;
    expect([count('lashing_distribution'), count('identity'), count('scanned'), count('unrecognized')]).toEqual([1, 7, 4, 0]); // صفحة الحساب من العقد تُعامَل وثيقةَ هويّة: لا يُستخرج نصّها
    const lb = msg.attachments.find((x) => /LB/.test(x.name))!;
    const r = await parsePdf(lb.content, lb.name);
    expect(r.rate).toBe('1.17');
    expect(r.rows!.length).toBe(17);
    const sum = r.rows!.reduce((a, x) => a + Math.round(Number(x.eur) * 100), 0) / 100;
    expect(sum).toBe(9308);
  }, 120_000);

  it('CFM: الشهر والمركب، ومجموع الأرصدة = الإجماليّ العامّ (41,485.21$ و43,417.61€)', () => {
    for (const [x, total, n] of [[usd, '41485.21', 20], [eur, '43417.61', 12]] as const) {
      expect(x.month).toBe('2026-08');
      expect(x.vessel).toBe('Gubal Trader');
      expect(x.rows).toHaveLength(n);
      expect(x.seafarers).toHaveLength(n);
      expect(x.grand_total_balance).toBe(total);
      const sum = x.rows.reduce((a, r) => a + Math.round(Number(r.balance) * 100), 0);
      expect((sum / 100).toFixed(2)).toBe(total);
    }
    const s527 = eur.seafarers.find((s) => s.crew_id === '527')!;
    expect(s527.rates).toEqual({ basic: '1697', fixed_ot: '679', leave: '424' });
    expect(eur.rows.find((r) => r.crew_id === '527')).toMatchObject({ section: 'final', pay_start: '2026-08-01', pay_end: '2026-08-20', payroll_days: 20 });
    // تسع أوراقٍ بلا قسم حساب بنكيّ
    expect(usd.seafarers.filter((s) => !s.bank).length + eur.seafarers.filter((s) => !s.bank).length).toBe(9);
  });

  it('المرفقات: كشف الصرف وكشف البنوك وقائمة الطاقم', () => {
    expect(payout.length).toBeGreaterThan(20);
    expect(payout.every((p) => /^\d*$/.test(p.account_number.replace(/\D/g, '')) || p.account_number === '')).toBe(true);
    expect(blocks.length).toBeGreaterThan(5);
    expect(crew.length).toBeGreaterThan(25);
  });

  it('التجميع بلا سعر صرف: البنود المعلّقة والفروق الثلاثة المعروفة', async () => {
    const lb = msg.attachments.find((x) => /LB/.test(x.name))!;
    const lash = await parsePdf(lb.content, lb.name);
    const a = assemble({ month: '2026-08', vessel: 'Gubal Trader', cfm: [usd, eur], email: body, payout, bank_blocks: blocks, crew_list: crew, lashing_pdf: { file: lb.name, rows: lash.rows! } }, null);
    expect(a.entries).toHaveLength(32);
    // التعارض الوحيد بين الرسالة وPDF التوزيع: 379 (418.76 مقابل 418.86) — يظهر ولا يُستبدل
    expect(a.entries.filter((e) => e.source_conflicts.length).map((e) => [e.crew_id, e.source_conflicts[0].email, e.source_conflicts[0].other])).toEqual([['379', '418.76', '418.86']]);
    expect(a.unmatched.lashing_pdf.map((u) => u.row.eur)).toEqual(['47.73']);
    const e = (id: string) => a.entries.find((x) => x.crew_id === id)!;
    expect(e('527').differences.find((x) => x.kind === 'sign_off_day')).toEqual({ kind: 'sign_off_day', calculated: '79.20', reported: '93.33', diff: '-14.13' });
    expect(e('607').differences.find((x) => x.kind === 'sign_off_day')).toEqual({ kind: 'sign_off_day', calculated: '282.83', reported: '333.33', diff: '-50.50' });
    const on = e('1074').result.items.find((i) => i.kind === 'sign_on_settlement')!;
    expect(on).toMatchObject({ amount: '333.33', review: 'pending', counted: false });
    expect(e('1074').result.days).toBe(26);
    // الروابط بالاسم: التطابق التامّ الوحيد يُربط، والجزئيّ اقتراحٌ لا يُعتمد
    expect(a.unmatched.payout.every((u) => u.match.status !== 'exact' && u.match.status !== 'confirmed')).toBe(true);
    expect(a.unmatched.payout.some((u) => u.match.status === 'suggested' && u.match.candidates.length > 1)).toBe(true);
    // السلفة بعملتها الأصليّة بلا سعر ⇒ موقوفة
    expect(e('965').result.issues.map((i) => i.code)).toContain('fx_missing');
    expect(a.notes.map((n) => n.amount)).toEqual(['47.73']);
    expect(a.unresolved.map((u) => u.kind)).toEqual(['note']);
  }, 120_000);

  it('التجميع بسعرٍ وقبول كلّ البنود: الإجماليّات لكلّ عملة', () => {
    const base = assemble({ month: '2026-08', vessel: 'Gubal Trader', cfm: [usd, eur], email: body, payout, bank_blocks: blocks, crew_list: crew }, null);
    const reviews: Record<string, 'accepted'> = {};
    for (const e of base.entries) for (const x of e.input.extras) reviews[x.key] = 'accepted';
    const fx = { month: '2026-08', perUsd: { EUR: String(1 / 1.15) } };
    const a = assemble({ month: '2026-08', vessel: 'Gubal Trader', cfm: [usd, eur], email: body, payout, bank_blocks: blocks, crew_list: crew, reviews }, fx);
    const t = totalsByCurrency(a.entries.map((e) => e.result));
    expect(a.entries.every((e) => e.result.complete)).toBe(true);
    expect(Object.keys(t).sort()).toEqual(['EUR', 'USD']);
    // بسعرٍ واحد 1 EUR = 1.15 USD وقبول كلّ البنود — الفرق عن CFM مفسَّرٌ بنداً بنداً أدناه
    expect(t.USD.balance).toBe('41806.10');   // CFM: 41,485.21
    expect(t.EUR.balance).toBe('43429.35');   // CFM: 43,417.61
    const diffs = Object.fromEntries(a.entries.filter((e) => e.differences.length)
      .map((e) => [e.crew_id, e.differences.filter((f) => f.kind !== 'balance').map((f) => `${f.kind}:${f.diff}`).join(' ')]));
    expect(diffs).toEqual({
      // يوم النزول بالقاعدة — ولم يصرفه CFM لطاقم الدولار ولا لـ 499
      '971': 'sign_off_day:124.47 cash_advance:-0.55', '75': 'sign_off_day:34.23', '1090': 'sign_off_day:26.47', '547': 'sign_off_day:124.47',
      '499': 'sign_off_day:76.37',
      // صرفه CFM شاملاً بدل الإجازة
      '607': 'sign_off_day:-50.50', '527': 'sign_off_day:-14.13',
      // لاشينج الرسالة 418.76 مقابل 418.86
      '379': 'bonus:-0.10',
      // السلف: CFM حوّلها بسعرين (1.15 و≈1.1535) — والقاعدة سعرٌ واحدٌ للشهر
      '965': 'cash_advance:-1.73', '453': 'cash_advance:-1.73', '127': 'cash_advance:-1.04', '410': 'cash_advance:-0.86',
      '184': 'cash_advance:-1.04', '437': 'cash_advance:-1.56', '268': 'cash_advance:-0.69', '819': 'cash_advance:-0.69',
      '380': 'cash_advance:-0.25', '377': 'cash_advance:-1.21',
    });
  });
});
