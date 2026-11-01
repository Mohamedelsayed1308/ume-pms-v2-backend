/**
 * مدخلات فريق مونتي — بقرار المالك (٣١ أكتوبر و١ نوفمبر ٢٠٢٦).
 *
 * كلّ الفريق يُدخل (من يرى شاشة التقارير)، والمُدخَل يدخل الأرقام في التحديث الآليّ التالي
 * بلا اعتماد. لذلك يُفحص هنا بصرامة، وكلّ مُدخَلٍ سجلٌّ لا يُمحى باسم صاحبه ووقته في
 * `manual.inputs`. التصحيح مُدخَلٌ جديد (الأحدث للمفتاح نفسه يغلب)، والإلغاء سجلٌّ `void`.
 *
 * التطبيق على الأرقام في سكربت مونتي (`team_inputs.py`)، لا هنا: الإكسيل يبقى المرجع،
 * والحزمة تعود وفيها `inputs_applied` فيعرف الكارت ما أُدرج.
 */
export const INPUT_KINDS = ['ship_cost', 'salary', 'agent_return', 'eur_rate', 'egp_rate', 'fuel_invoice'] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

export interface MonteInput {
  id: string;
  kind: InputKind | 'void';
  data: Record<string, unknown>;
  by: { id: string | null; name: string };
  at: string;
}

/** ما يلزم من الحزمة المحفوظة لفحص المُدخَل: أشهر الكارت. */
export interface InputContext { months: string[] }

const MONTH = /^\d{4}-\d\d$/;
const DAY = /^\d{4}-\d\d-\d\d$/;
const VOYAGE = /^\d{2}$/;
const AGENT_FIELDS = ['pax', 'tickets', 'reefers', 'no_head', 'cars', 'tript', 'mafi', 'tidder', 'luggage'] as const;

const isNum = (x: unknown): x is number => typeof x === 'number' && isFinite(x);
const text = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
const optNum = (x: unknown) => (x === null || x === undefined || x === '' ? null : x);

export function inputContext(pkg: any): InputContext {
  const months = Array.isArray(pkg?.monthly) ? pkg.monthly.map((m: any) => String(m?.month || '')).filter((m: string) => MONTH.test(m)) : [];
  return { months };
}

/** يُرجع البيانات منظَّفةً بالحقول المعروفة وحدها، أو رسائل الرفض. */
export function validateInput(kind: unknown, raw: unknown, ctx: InputContext): { ok: boolean; data: Record<string, unknown>; errors: string[] } {
  const errors: string[] = [];
  const d = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const month = () => {
    const m = text(d.month, 7);
    if (!MONTH.test(m)) errors.push('الشهر مطلوب بصيغة YYYY-MM');
    else if (!ctx.months.includes(m)) errors.push(`الشهر ${m} ليس من أشهر الكارت (${ctx.months[0] || '—'} إلى ${ctx.months[ctx.months.length - 1] || '—'})`);
    out.month = m;
  };
  const note = (required = false) => {
    out.note = text(d.note, 300);
    if (required && !out.note) errors.push('المستند أو الملاحظة مطلوب');
  };

  switch (kind) {
    case 'ship_cost': {
      month();
      out.label = text(d.label, 80);
      if ((out.label as string).length < 2) errors.push('اسم البند مطلوب');
      if (!isNum(d.amount) || d.amount === 0 || Math.abs(d.amount) > 10_000_000) errors.push('المبلغ رقمٌ غير صفر (موجبٌ للمصروف وسالبٌ للاسترداد)');
      out.amount = d.amount;
      out.currency = text(d.currency, 3).toUpperCase() || 'USD';
      if (!['USD', 'SAR', 'EUR'].includes(out.currency as string)) errors.push('العملة USD أو SAR أو EUR');
      note(true);
      break;
    }
    case 'salary': {
      month();
      for (const k of ['usd', 'eur'] as const) {
        const v = optNum(d[k]);
        if (v !== null && (!isNum(v) || v < 0 || v > 5_000_000)) errors.push(`مرتّبات ${k === 'usd' ? 'الدولار' : 'اليورو'} رقمٌ موجب`);
        out[k] = v;
      }
      if (out.usd === null && out.eur === null) errors.push('أدخل مرتّبات الدولار أو اليورو أو كليهما');
      note(true);
      break;
    }
    case 'agent_return': {
      out.voyage = text(d.voyage, 2);
      if (!VOYAGE.test(out.voyage as string)) errors.push('رقم الرحلة رقمان (مثل 07)');
      let any = false;
      for (const k of AGENT_FIELDS) {
        const v = optNum(d[k]);
        if (v !== null) {
          any = true;
          if (!isNum(v) || !Number.isInteger(v) || v < 0 || v > 5000) errors.push(`${k}: عددٌ صحيح موجب`);
        }
        out[k] = v;
      }
      if (!any) errors.push('أدخل عدداً واحداً على الأقلّ');
      note(true);
      break;
    }
    case 'eur_rate': {
      month();
      if (!isNum(d.rate) || d.rate < 0.8 || d.rate > 1.6) errors.push('سعر اليورو بالدولار بين 0.8 و1.6');
      out.rate = d.rate;
      note(true);
      break;
    }
    case 'egp_rate': {
      if (!isNum(d.rate) || d.rate < 20 || d.rate > 150) errors.push('سعر الدولار بالجنيه المصريّ بين 20 و150');
      out.rate = d.rate;
      out.date = text(d.date, 10) || '2026-10-04';
      if (!DAY.test(out.date as string)) errors.push('التاريخ بصيغة YYYY-MM-DD');
      note(true);
      break;
    }
    case 'fuel_invoice': {
      out.date = text(d.date, 10);
      if (!DAY.test(out.date as string)) errors.push('تاريخ التموين بصيغة YYYY-MM-DD');
      else if (ctx.months.length && !ctx.months.includes((out.date as string).slice(0, 7))) errors.push('تاريخ التموين خارج أشهر الكارت');
      if (!isNum(d.amount) || d.amount <= 0 || d.amount > 20_000_000) errors.push('قيمة الفاتورة رقمٌ موجب');
      out.amount = d.amount;
      out.currency = text(d.currency, 3).toUpperCase() || 'SAR';
      if (!['SAR', 'USD'].includes(out.currency as string)) errors.push('العملة SAR أو USD');
      out.invoice = text(d.invoice, 60);
      if (!out.invoice) errors.push('رقم الفاتورة مطلوب');
      for (const k of ['tons', 'rob_before'] as const) {
        const v = optNum(d[k]);
        if (v !== null && (!isNum(v) || v < 0 || v > 5000)) errors.push(`${k === 'tons' ? 'الكميّة' : 'الرصيد قبل التموين'}: رقمٌ موجب بالطنّ`);
        out[k] = v;
      }
      note();
      break;
    }
    default:
      errors.push(`نوع المُدخَل غير معروف: ${String(kind)}`);
  }
  return { ok: errors.length === 0, data: out, errors };
}
