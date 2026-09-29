import * as XLSX from 'xlsx';

/**
 * تصدير CFM **اصطناعيّ** للاختبارات — بنية الملفّ الحقيقيّ بلا أيّ بيانات بحّارةٍ حقيقيّة.
 */
export interface FakeCrew {
  id: string; name: string; rank: string; section: 'monthly' | 'final';
  start: number; end: number; rates: [number, number, number];
  others?: { label: string; description: string; amount: number }[];
  advance?: number;
}

const serial = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function fakeCfm(vessel: string, currency: string, crew: FakeCrew[], month = { y: 2026, m: 8, name: 'August 2026' }): Buffer {
  const wb = XLSX.utils.book_new();
  const head = ['No.', 'ID', 'Name', 'Rank', 'Nationality', 'Pay Start', 'Pay End', 'Travel', 'Payroll Days', 'Basic wage', 'Fixed overtime', 'Leave pay', 'Bonus', 'Other', 'Total Earnings', 'Cash advance', 'Total Deductions', 'Balance'];
  const rows: any[][] = [[`Month: ${month.name}`, null, null, null, `Vessel: 04. ${vessel}`], [`Monthly Wages Account ${currency}`], [], head];
  let grand = 0;
  const calc = (c: FakeCrew) => {
    const days = c.start === 1 && c.end === 31 ? 30 : c.end - c.start + 1;
    const amt = c.rates.map((r) => r2(r / 30 * days));
    const other = (c.others || []).reduce((a, o) => a + o.amount, 0);
    const earn = r2(amt[0] + amt[1] + amt[2] + other);
    const bal = r2(earn - (c.advance || 0));
    return { days, amt, other, earn, bal };
  };
  const line = (c: FakeCrew, i: number) => {
    const x = calc(c); grand += x.bal;
    return [i + 1, Number(c.id), c.name, c.rank, 'Testland', serial(month.y, month.m, c.start), serial(month.y, month.m, c.end), 0, x.days, ...x.amt, null, x.other || null, x.earn, c.advance || null, c.advance || null, x.bal];
  };
  crew.filter((c) => c.section === 'monthly').forEach((c, i) => rows.push(line(c, i)));
  rows.push([], [`Final Wages Account ${currency}`], ['Signed off This Month'], head);
  crew.filter((c) => c.section === 'final').forEach((c, i) => rows.push(line(c, 100 + i)));
  rows.push([], ['Grand Total', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, r2(grand)]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), `Summary ${currency}`);

  for (const c of crew) {
    const x = calc(c);
    const s: any[][] = [
      [], ['UME Shipping AB', null, null, null, null, null, `Monthly Wages Account ${currency}`], [],
      ['Month: ', null, month.name, null, null, null, 'Vessel: ', null, vessel], [],
      ['Seafarer ID:', null, Number(c.id), null, null, null, 'Contract Start: ', null, serial(month.y, month.m, c.start)],
      [null, null, null, null, null, null, 'Embarkation: ', null, serial(month.y, month.m, c.start)],
      ['Rank:', null, c.rank], ['Full Name:', null, c.name], ['Nationality:', null, 'Testland'],
      [], [], [], [], [], [],
      ['EARNINGS', null, null, 'FROM', 'TO', 'DAYS', 'WAGES', null, 'AMOUNT', null, currency],
      ['Basic wage', null, null, c.start, c.end, x.days, c.rates[0], null, x.amt[0], null, '€'],
      ['Fixed overtime', null, null, c.start, c.end, x.days, c.rates[1], null, x.amt[1], null, '€'],
      ['Leave pay', null, null, c.start, c.end, x.days, c.rates[2], null, x.amt[2], null, '€'],
      ...(c.others || []).map((o) => [o.label, null, null, o.description, null, null, null, null, o.amount, null, '€']),
      ['Total Earnings', null, null, null, null, null, null, null, x.earn, null, '€'], [],
      ['DEDUCTIONS', null, null, 'REMARKS'],
      ...(c.advance ? [['Cash advance', null, null, '', null, null, null, null, c.advance, null, '€']] : []),
      ['Total Deductions', null, null, null, null, null, null, null, c.advance || 0, null, '€'], [],
      ['BALANCE', null, null, 'REMARKS'], ['Total Current Month', null, null, '', null, null, null, null, x.bal, null, '€'],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s), `Wage ${c.name}`.slice(0, 31));
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
