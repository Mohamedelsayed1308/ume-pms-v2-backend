import { lastCompletedMonth, monthsDue } from './depreciation-catchup.logic';

describe('الإهلاك — اللحاق بالأشهر', () => {
  it('1. الشهر الجاري لم ينتهِ فلا يُهلَك', () => {
    expect(lastCompletedMonth('2026-08-13')).toBe('2026-07');
    expect(lastCompletedMonth('2026-08-31')).toBe('2026-07');
  });
  it('2. يناير يرجع لديسمبر السنة السابقة', () => {
    expect(lastCompletedMonth('2026-01-05')).toBe('2025-12');
  });
  it('3. حالة Gubal اليوم — سبعة أشهر مستحقّة', () => {
    expect(monthsDue({ startMonth: '2026-01', endMonth: '2031-12', today: '2026-08-13' })).toHaveLength(7);
  });
  it('4. أول يوم في الشهر يُنتج الشهر المنتهي للتوّ', () => {
    const due = monthsDue({ startMonth: '2026-01', endMonth: '2031-12', today: '2026-09-01' });
    expect(due[due.length - 1]).toBe('2026-08');
    expect(due).toHaveLength(8);
  });
  it('5. نهاية الجدول تحدّ المدى — الأصل لا يُهلَك بعد عمره', () => {
    expect(monthsDue({ startMonth: '2026-01', endMonth: '2026-03', today: '2027-06-01' }))
      .toEqual(['2026-01', '2026-02', '2026-03']);
  });
  it('6. جدول لم يبدأ بعد لا يُنتج شيئاً', () => {
    expect(monthsDue({ startMonth: '2027-01', endMonth: '2030-12', today: '2026-08-13' })).toEqual([]);
  });
  it('7. جدول بدأ هذا الشهر لا يُنتج شيئاً حتى ينتهي', () => {
    expect(monthsDue({ startMonth: '2026-08', endMonth: '2030-12', today: '2026-08-31' })).toEqual([]);
    expect(monthsDue({ startMonth: '2026-08', endMonth: '2030-12', today: '2026-09-01' })).toEqual(['2026-08']);
  });
  it('8. السؤال نفسه مرّتين يعطي الجواب نفسه — لا أثر جانبي', () => {
    const a = { startMonth: '2026-01', endMonth: '2031-12', today: '2026-08-13' };
    expect(monthsDue(a)).toEqual(monthsDue(a));
  });
});
