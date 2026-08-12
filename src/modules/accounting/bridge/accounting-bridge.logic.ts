import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { round2, LineInput, EUR } from '../accounting-posting';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * جسر المستندات إلى القيود — منطق خالص
 *
 * كل ما هنا **دالّة خالصة**: لا قاعدة بيانات ولا ساعة ولا حالة. السبب نفسه
 * الذي حكم محرّك الترحيل — قاعدة محاسبية مدفونة في استعلام لا تُختبَر إلا
 * بقاعدة بيانات حيّة، فتبقى بلا إثبات.
 *
 * والجسر **لا يخترع تصنيفاً**. يستقبل الحساب ويبني القيد ويحسب فرق الصرف.
 * أي محاولة لتخمين حساب المصروف من نصّ الفاتورة تُنتج تصنيفاً لا يستطيع أحد
 * الدفاع عنه أمام مدقّق.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface BridgeDims {
  vessel_id?: string | null;
  supplier_id?: string | null;
  customer_id?: string | null;
}

/** طرفا قيد بسيط: حساب مقابل حساب بنفس المبلغ والعملة. */
export function buildTwoSidedLines(args: {
  debitAccountId: string;
  creditAccountId: string;
  amount: number;
  currency: string;
  fxRateId: string | null;
  dims?: BridgeDims;
  debitDescription?: string;
  creditDescription?: string;
}): LineInput[] {
  const amount = round2(args.amount);
  if (!(amount > 0)) throw new BadRequestException('مبلغ القيد يجب أن يكون موجباً');
  const ccy = args.currency.toUpperCase();
  if (ccy !== EUR && !args.fxRateId) {
    throw new UnprocessableEntityException(`عملة أجنبية (${ccy}) بلا سعر صرف معتمَد`);
  }
  if (ccy === EUR && args.fxRateId) {
    throw new BadRequestException('لا يُسنَد سعر صرف لمبلغ باليورو');
  }
  const base = { transaction_currency: ccy, fx_rate_id: args.fxRateId, ...(args.dims ?? {}) };
  return [
    { account_id: args.debitAccountId, debit: amount, ...base, description: args.debitDescription ?? null },
    { account_id: args.creditAccountId, credit: amount, ...base, description: args.creditDescription ?? null },
  ];
}

export interface SettlementInput {
  /** المبلغ المسدَّد بعملة الفاتورة — قد يكون جزءاً منها. */
  amount: number;
  currency: string;
  /** سعر الالتزام كما رُحِّل به أصلاً — لا سعر اليوم. */
  carrying: { fxRateId: string | null; rate: number };
  /** سعر يوم السداد. */
  settlement: { fxRateId: string | null; rate: number };
  accounts: {
    payableId: string;
    bankId: string;
    fxGainId: string;
    fxLossId: string;
  };
  dims?: BridgeDims;
}

export interface SettlementResult {
  lines: LineInput[];
  carrying_eur: number;
  settlement_eur: number;
  /** موجب = مكسب · سالب = خسارة · صفر = لا حركة على حسابي الصرف. */
  fx_difference_eur: number;
}

/**
 * سطور قيد السداد — وفيه الفكرة كلّها.
 *
 * الالتزام يُقفَل **بسعره الدفتري** لا بسعر اليوم، وإلا بقي في الحساب فتات لا
 * يخصّ أحداً. والبنك يُقيَّد بسعر يوم الخروج. والفرق بينهما واقعة اقتصادية
 * حقيقية تُسمّى مكسب صرف أو خسارته.
 *
 * ⚠️ ولا يُخلَق فرق ليتوازن القيد. إن تساوى السعران فالفرق صفر ولا يُمسّ
 * حسابا الصرف — الصفر نتيجة صحيحة لا حالة ناقصة.
 */
export function buildSettlementLines(input: SettlementInput): SettlementResult {
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new BadRequestException('مبلغ السداد يجب أن يكون موجباً');
  const ccy = input.currency.toUpperCase();

  if (ccy === EUR) {
    if (input.carrying.fxRateId || input.settlement.fxRateId) {
      throw new BadRequestException('لا يُسنَد سعر صرف لسداد باليورو');
    }
    return {
      lines: buildTwoSidedLines({
        debitAccountId: input.accounts.payableId,
        creditAccountId: input.accounts.bankId,
        amount, currency: EUR, fxRateId: null, dims: input.dims,
        debitDescription: 'إقفال الدائن', creditDescription: 'البنك',
      }),
      carrying_eur: amount, settlement_eur: amount, fx_difference_eur: 0,
    };
  }

  if (!input.carrying.fxRateId || !input.settlement.fxRateId) {
    throw new UnprocessableEntityException(
      `سداد بعملة ${ccy} يحتاج سعرين معتمَدين: سعر الالتزام الدفتري وسعر يوم السداد`,
    );
  }
  if (!(input.carrying.rate > 0) || !(input.settlement.rate > 0)) {
    throw new UnprocessableEntityException('سعر صرف غير صالح في السداد');
  }

  const carrying_eur = round2(amount * input.carrying.rate);
  const settlement_eur = round2(amount * input.settlement.rate);
  const diff = round2(carrying_eur - settlement_eur);

  const dims = input.dims ?? {};
  const lines: LineInput[] = [
    {
      account_id: input.accounts.payableId, debit: amount,
      transaction_currency: ccy, fx_rate_id: input.carrying.fxRateId, ...dims,
      description: 'إقفال الدائن بسعره الدفتري',
    },
    {
      account_id: input.accounts.bankId, credit: amount,
      transaction_currency: ccy, fx_rate_id: input.settlement.fxRateId, ...dims,
      description: 'البنك بسعر يوم السداد',
    },
  ];

  if (diff > 0) {
    lines.push({
      account_id: input.accounts.fxGainId, credit: diff,
      transaction_currency: EUR, fx_rate_id: null, ...dims,
      description: 'مكسب صرف محقَّق',
    });
  } else if (diff < 0) {
    lines.push({
      account_id: input.accounts.fxLossId, debit: round2(-diff),
      transaction_currency: EUR, fx_rate_id: null, ...dims,
      description: 'خسارة صرف محقَّقة',
    });
  }

  return { lines, carrying_eur, settlement_eur, fx_difference_eur: diff };
}

/** ما تبقّى قابلاً للسداد على فاتورة — يمنع سداداً يتجاوز الالتزام. */
export function assertSettleable(invoiceTotal: number, alreadySettled: number, now: number): void {
  const remaining = round2(invoiceTotal - alreadySettled);
  if (round2(now) > remaining + 0.005) {
    throw new UnprocessableEntityException(
      `السداد (${round2(now).toFixed(2)}) يتجاوز المتبقّي على الفاتورة (${remaining.toFixed(2)})`,
    );
  }
}
