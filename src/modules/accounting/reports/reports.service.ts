import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { buildIncomeStatement, buildBalanceSheet, AccountBalance } from './financial-statements';
import {
  buildSplitMap, buildPartyBalanceDetail, buildPartyBalanceSummary, buildGeneralLedger,
  type LedgerLine,
} from './subledger-reports';

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

  // ══════════════════════ تقارير الأطراف ودفتر الأستاذ ══════════════════════

  private entity(q: any): string {
    const id = String(q?.legal_entity_id || '');
    if (!id) throw new BadRequestException('legal_entity_id مطلوب');
    return id;
  }

  private date(v: any, name: string, required = true): string | null {
    const s = String(v || '');
    if (!s) {
      if (required) throw new BadRequestException(`${name} بصيغة YYYY-MM-DD مطلوب`);
      return null;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BadRequestException(`${name} بصيغة YYYY-MM-DD مطلوب`);
    return s;
  }

  private async entityHeader(entityId: string) {
    const [e] = await this.ds.query('SELECT code, name, functional_currency FROM legal_entities WHERE id = $1', [entityId]);
    return e ? { code: e.code, name: e.name, currency: e.functional_currency } : null;
  }

  /**
   * سطور حسابٍ محدَّد ببُعد الطرف.
   *
   * `party` تُمرَّر كاسم عمود لا كقيمة — وهي من ثابتين في الكود لا من الطلب،
   * فلا مدخل للمستخدم في نصّ الاستعلام.
   */
  private async partyLines(entityId: string, codes: string[], asOf: string, party: 'supplier_id' | 'customer_id'): Promise<LedgerLine[]> {
    const nameTable = party === 'supplier_id' ? 'suppliers' : 'customers';
    const rows = await this.ds.query(
      `SELECT e.id AS entry_id, e.entry_no, e.accounting_date AS entry_date, e.status AS entry_status,
              e.accounting_event_type AS event_type, e.reference, l.description,
              a.id AS account_id, a.code AS account_code, a.name AS account_name,
              a.account_type, a.parent_id,
              l.debit_eur, l.credit_eur,
              l.${party} AS party_id, p.name AS party_name
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounting_accounts a ON a.id = l.account_id
    LEFT JOIN ${nameTable} p ON p.id = l.${party}
        WHERE e.legal_entity_id = $1
          AND e.status IN ('posted','reversed')
          AND a.code = ANY($2::text[])
          AND e.accounting_date <= $3::date
        ORDER BY e.accounting_date, e.entry_no, l.line_no`,
      [entityId, codes, asOf]);
    return rows.map(mapLine);
  }

  private async accountCodes(entityId: string, role: string, fallback: string[]): Promise<string[]> {
    /*
     * الدور لا الرمز.
     *
     * الأرقام تتغيّر مع أي إعادة ترقيم للدليل، و`system_role` هو ما يقرأه منطق
     * النظام كلّه. والرمز يبقى شبكة أمانٍ لدليلٍ لم يُسنَد دوره بعد.
     */
    const rows = await this.ds.query(
      'SELECT code FROM accounting_accounts WHERE legal_entity_id = $1 AND system_role = $2 AND is_active',
      [entityId, role]);
    return rows.length ? rows.map((r: any) => r.code) : fallback;
  }

  private async splitsFor(entityId: string, entryIds: string[]): Promise<Map<string, string>> {
    if (!entryIds.length) return new Map();
    const rows = await this.ds.query(
      `SELECT l.entry_id, l.account_id, a.code AS account_code, a.name AS account_name
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounting_accounts a ON a.id = l.account_id
        WHERE e.legal_entity_id = $1 AND l.entry_id = ANY($2::uuid[])`,
      [entityId, entryIds]);
    return buildSplitMap(rows);
  }

  private async partyReport(q: any, party: 'supplier_id' | 'customer_id') {
    const entityId = this.entity(q);
    const asOf = this.date(q?.as_of, 'as_of')!;
    const isVendor = party === 'supplier_id';
    const codes = await this.accountCodes(entityId, isVendor ? 'ACCOUNTS_PAYABLE' : 'ACCOUNTS_RECEIVABLE', isVendor ? ['2010'] : ['1100']);

    const lines = await this.partyLines(entityId, codes, asOf, party);
    const detail = buildPartyBalanceDetail(lines, {
      as_of: asOf, account_codes: codes,
      normal: isVendor ? 'credit' : 'debit',
    });

    return {
      entity: await this.entityHeader(entityId),
      title: isVendor ? 'Vendor Balance Detail' : 'Customer Balance Detail',
      disclosure: 'MANAGEMENT ACCOUNTS — OPENING BALANCES UNAUDITED',
      detail,
      summary: buildPartyBalanceSummary(detail),
    };
  }

  vendorBalance(q: any) { return this.partyReport(q, 'supplier_id'); }
  customerBalance(q: any) { return this.partyReport(q, 'customer_id'); }

  async generalLedger(q: any) {
    const entityId = this.entity(q);
    const from = this.date(q?.period_start, 'period_start', false);
    const to = this.date(q?.period_end, 'period_end')!;
    if (from && from > to) throw new BadRequestException('بداية الفترة بعد نهايتها');

    /*
     * الرصيد الافتتاحي حاصل ما قبل الفترة — يُقرأ باستعلام مستقلّ.
     *
     * اشتقاقه من سطور الفترة يجعل الرصيد الأول مساوياً للحركة الأولى، وهو خطأ
     * لا يظهر إلا عند مطابقة الدفتر بميزان المراجعة.
     */
    const openings = new Map<string, number>();
    if (from) {
      const rows = await this.ds.query(
        `SELECT l.account_id, COALESCE(SUM(l.debit_eur - l.credit_eur), 0) AS net
           FROM journal_lines l
           JOIN journal_entries e ON e.id = l.entry_id
          WHERE e.legal_entity_id = $1 AND e.status IN ('posted','reversed')
            AND e.accounting_date < $2::date
          GROUP BY l.account_id`,
        [entityId, from]);
      for (const r of rows) openings.set(r.account_id, Number(r.net));
    }

    const rows = await this.ds.query(
      `SELECT e.id AS entry_id, e.entry_no, e.accounting_date AS entry_date, e.status AS entry_status,
              e.accounting_event_type AS event_type, e.reference, l.description,
              a.id AS account_id, a.code AS account_code, a.name AS account_name,
              a.account_type, a.parent_id,
              l.debit_eur, l.credit_eur,
              NULL AS party_id,
              COALESCE(s.name, c.name) AS party_name
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounting_accounts a ON a.id = l.account_id
    LEFT JOIN suppliers s ON s.id = l.supplier_id
    LEFT JOIN customers c ON c.id = l.customer_id
        WHERE e.legal_entity_id = $1
          AND e.status IN ('posted','reversed')
          AND ($2::date IS NULL OR e.accounting_date >= $2::date)
          AND e.accounting_date <= $3::date
        ORDER BY a.code, e.accounting_date, e.entry_no, l.line_no`,
      [entityId, from, to]);

    const lines = rows.map(mapLine);
    const splits = await this.splitsFor(entityId, [...new Set<string>(lines.map((l: LedgerLine) => l.entry_id))]);

    return {
      entity: await this.entityHeader(entityId),
      title: 'General Ledger',
      disclosure: 'MANAGEMENT ACCOUNTS — OPENING BALANCES UNAUDITED',
      report: buildGeneralLedger(lines, { from, to, openings, splits }),
    };
  }
}

/** الأرقام تعود من `pg` نصوصاً — تحويلها في موضع واحد يمنع تسرّب النصّ إلى الحساب. */
function mapLine(r: any): LedgerLine {
  return {
    entry_id: r.entry_id, entry_no: r.entry_no, entry_date: String(r.entry_date).slice(0, 10),
    entry_status: r.entry_status, event_type: r.event_type, reference: r.reference, description: r.description,
    account_id: r.account_id, account_code: r.account_code, account_name: r.account_name,
    account_type: r.account_type, parent_id: r.parent_id,
    debit_eur: Number(r.debit_eur), credit_eur: Number(r.credit_eur),
    party_id: r.party_id, party_name: r.party_name,
  };
}
