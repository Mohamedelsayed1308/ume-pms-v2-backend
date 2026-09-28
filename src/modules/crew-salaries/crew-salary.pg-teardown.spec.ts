/* eslint-disable @typescript-eslint/no-require-imports */
const { selectOwned } = require('../../../test/pg/owned-processes.cjs');

/*
 * تنظيف عنقود الاختبار: لا يُنهى إلّا الـ postmaster المسجَّل وأبناؤه — لا بمطابقة نصّ.
 */
describe('ملكيّة عمليّات عنقود الاختبار', () => {
  const T = 1_700_000_000_000;
  const owner = { pid: 100, created: T };
  const p = (pid: number, ppid: number, created: number, name = 'postgres.exe') => ({ pid, ppid, name, created });

  it('الـ postmaster المسجَّل وأبناؤه — ومنهم العامل اليتيم بعد الإيقاف', () => {
    const procs = [p(100, 1, T), p(101, 100, T + 500), p(102, 100, T + 60_000)];
    expect(selectOwned(procs, owner)).toEqual([100, 101, 102]);
    // بعد الإيقاف: الأب مات، والعامل ما زال يحمل معرّفه أباً
    expect(selectOwned([p(102, 100, T + 60_000)], owner)).toEqual([102]);
  });

  it('عاملٌ يتيم من عنقودٍ آخر (أبوه ميّت) لا يُمسّ', () => {
    const foreignOrphan = p(300, 250, T + 1000); // أبوه 250 مات — عنقودٌ آخر
    const foreignAlive = [p(400, 1, T - 5000), p(401, 400, T - 4000)];
    expect(selectOwned([foreignOrphan, ...foreignAlive, p(100, 1, T)], owner)).toEqual([100]);
  });

  it('معرّفٌ أُعيد استعماله لا يُحسب لنا', () => {
    // عمليّةٌ بمعرّف الـ postmaster نفسه لكن بوقت نشوءٍ آخر، وابنٌ قديم لصاحب المعرّف السابق
    expect(selectOwned([p(100, 1, T + 3_600_000), p(500, 100, T - 3_600_000)], owner)).toEqual([]);
    // ولا أبناء الصاحب الجديد للمعرّف — ولو نشأوا بعد عنقودنا
    expect(selectOwned([p(100, 1, T + 3_600_000), p(501, 100, T + 3_600_500)], owner)).toEqual([]);
  });

  it('غير postgres لا يُمسّ، وبلا مالكٍ مسجَّل لا يُنهى شيء', () => {
    expect(selectOwned([p(600, 100, T + 10, 'node.exe')], owner)).toEqual([]);
    expect(selectOwned([p(100, 1, T), p(101, 100, T + 1)], null)).toEqual([]);
  });
});
