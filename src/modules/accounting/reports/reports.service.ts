import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { buildIncomeStatement, buildBalanceSheet, AccountBalance } from './financial-statements';

/**
 * القوائم المالية.
 *
 * قائمة الدخل تخصّ **فترة** فتُقيَّد بتاريخين. والمركز المالي **لحظة** فيُقرأ
 * تراكمياً حتى تاريخه — الخلط بينهما يُنتج ميزانية لشهر، وهي لا معنى لها.
 */
@Injectable()
export class AccountingReportsService {
  constructor(@InjectDataSource() private ds: DataSource) {}

  private async balances(entityId: string, from: string | null, to: string): Promise<AccountBalance[]> {
    const rows = await this.ds.query(
      `SELECT a.code, a.name, a.account_type, a.account_group,
              COALESCE(SUM(l.debit_eur), 0)  AS debit_eur,
              COALESCE(SUM(l.credit_eur), 0) AS credit_eur
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounting_accounts a ON a.id = l.account_id
        WHERE e.legal_entity_id = $1
          AND e.status IN ('posted','reversed')
          AND ($2::date IS NULL OR e.accounting_date >= $2::date)
          AND e.accounting_date <= $3::date
        GROUP BY a.code, a.name, a.account_type, a.account_group
        ORDER BY a.code`,
      [entityId, from, to]);
    return rows.map((r: any) => ({
      code: r.code, name: r.name, account_type: r.account_type, account_group: r.account_group,
      debit_eur: Number(r.debit_eur), credit_eur: Number(r.credit_eur),
    }));
  }

  async statements(q: any) {
    const entityId = String(q?.legal_entity_id || '');
    if (!entityId) throw new BadRequestException('legal_entity_id مطلوب');
    const from = String(q?.period_start || '');
    const to = String(q?.period_end || '');
    for (const [v, n] of [[from, 'period_start'], [to, 'period_end']] as const) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BadRequestException(`${n} بصيغة YYYY-MM-DD مطلوب`);
    }
    if (from > to) throw new BadRequestException('بداية الفترة بعد نهايتها');

    const [entity] = await this.ds.query('SELECT * FROM legal_entities WHERE id = $1', [entityId]);

    // الدخل للفترة · المركز حتى تاريخها تراكمياً.
    const periodRows = await this.balances(entityId, from, to);
    const cumulativeRows = await this.balances(entityId, null, to);

    const income = buildIncomeStatement(periodRows);
    // النتيجة في المركز تراكمية منذ بدء الدفتر لا نتيجة الفترة وحدها.
    const cumulativeIncome = buildIncomeStatement(cumulativeRows);
    const balance = buildBalanceSheet(cumulativeRows, cumulativeIncome.net_result);

    return {
      entity: entity ? { code: entity.code, name: entity.name, currency: entity.functional_currency } : null,
      period: { from, to },
      disclosure: 'MANAGEMENT ACCOUNTS — OPENING BALANCES UNAUDITED',
      income_statement: income,
      balance_sheet: balance,
      cumulative_net_result: cumulativeIncome.net_result,
    };
  }
}
