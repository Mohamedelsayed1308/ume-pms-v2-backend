import { round2 } from '../accounting-posting';

/**
 * ── القوائم المالية — منطق خالص ──
 *
 * الأرصدة تصل مجمَّعة من الاستعلام، والتصنيف والجمع يتمّان هنا حيث يمكن إثباتهما
 * باختبار. القاعدة الحاكمة: **القائمة لا تخترع رقماً ولا تخفيه** — كل حساب له
 * حركة يظهر، وما لا يندرج تحت مجموعة معروفة يُعرَض في بند «غير مصنَّف» بدل أن
 * يُبتلع في فرقٍ لا يفسّره أحد.
 */

export interface AccountBalance {
  code: string;
  name: string;
  account_type: string;
  account_group: string | null;
  debit_eur: number;
  credit_eur: number;
}

export interface StatementLine { code: string; name: string; amount: number; }
export interface StatementSection { key: string; label: string; lines: StatementLine[]; total: number; }

const sum = (l: StatementLine[]) => round2(l.reduce((a, x) => a + x.amount, 0));

const lineOf = (r: AccountBalance, natural: 'debit' | 'credit'): StatementLine => ({
  code: r.code,
  name: r.name,
  amount: round2(natural === 'credit' ? r.credit_eur - r.debit_eur : r.debit_eur - r.credit_eur),
});

/** الإيراد دائن بطبيعته والمصروف مدين — فيُعرض كلٌّ بإشارته الطبيعية موجباً. */
export function buildIncomeStatement(rows: AccountBalance[]) {
  const revenue = rows.filter((r) => r.account_type === 'revenue')
    .map((r) => lineOf(r, 'credit')).filter((x) => x.amount !== 0);
  const expense = rows.filter((r) => r.account_type === 'expense')
    .map((r) => lineOf(r, 'debit')).filter((x) => x.amount !== 0);

  const groupOf = new Map(rows.map((r) => [r.code, r.account_group ?? '']));
  const pick = (keys: string[]) => expense.filter((e) => keys.includes(groupOf.get(e.code) ?? ''));

  const vesselOpex = pick(['VESSEL_OPEX']);
  const admin = pick(['ADMIN']);
  const finance = pick(['FINANCE']);
  const claimed = new Set([...vesselOpex, ...admin, ...finance].map((x) => x.code));
  const other = expense.filter((e) => !claimed.has(e.code));

  const sections: StatementSection[] = [
    { key: 'revenue', label: 'الإيرادات', lines: revenue, total: sum(revenue) },
    { key: 'vessel_opex', label: 'مصروفات تشغيل المركب', lines: vesselOpex, total: sum(vesselOpex) },
    { key: 'admin', label: 'مصروفات إدارية', lines: admin, total: sum(admin) },
    { key: 'finance', label: 'بنود تمويلية', lines: finance, total: sum(finance) },
  ];
  // لا يظهر بند «غير مصنَّف» إلا إن وُجد فعلاً — ووجوده إشارة لا زينة.
  if (other.length) sections.push({ key: 'other', label: 'مصروفات غير مصنَّفة', lines: other, total: sum(other) });

  const total_revenue = sum(revenue);
  const total_expense = round2(sections.filter((s) => s.key !== 'revenue').reduce((a, s) => a + s.total, 0));

  return { sections, total_revenue, total_expense, net_result: round2(total_revenue - total_expense) };
}

/**
 * المركز المالي.
 *
 * ⚠️ نتيجة الفترة **لا تُدمج** في حقوق الملكية تلقائياً: الإقفال قيدٌ يُرحَّل لا
 * حسبةٌ تُعرض. فتظهر منفصلة بوصفها نتيجةً لم تُقفَل بعد، ويُعرَض الفرق صراحةً إن
 * وُجد بدل أن يُخفى بموازنة صورية.
 */
export function buildBalanceSheet(rows: AccountBalance[], netResult: number) {
  const assets = rows.filter((r) => r.account_type === 'asset')
    .map((r) => lineOf(r, 'debit')).filter((x) => x.amount !== 0);
  const liabilities = rows.filter((r) => r.account_type === 'liability')
    .map((r) => lineOf(r, 'credit')).filter((x) => x.amount !== 0);
  const equity = rows.filter((r) => r.account_type === 'equity')
    .map((r) => lineOf(r, 'credit')).filter((x) => x.amount !== 0);

  const total_assets = sum(assets);
  const total_liabilities = sum(liabilities);
  const total_equity = sum(equity);
  const total_equity_with_result = round2(total_equity + round2(netResult));
  const total_liabilities_and_equity = round2(total_liabilities + total_equity_with_result);
  const difference = round2(total_assets - total_liabilities_and_equity);

  return {
    assets: { label: 'الأصول', lines: assets, total: total_assets },
    liabilities: { label: 'الالتزامات', lines: liabilities, total: total_liabilities },
    equity: { label: 'حقوق الملكية', lines: equity, total: total_equity },
    net_result_unclosed: round2(netResult),
    total_equity_with_result,
    total_liabilities_and_equity,
    difference,
    is_balanced: Math.abs(difference) < 0.005,
  };
}
