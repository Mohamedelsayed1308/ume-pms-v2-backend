import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { P11A_UP, P11A_DOWN, renderSql } from '../../migrations/p11a-accounting-foundation';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * بصمة الهجرة — الملف الذي يُراجَع هو الملف الذي يُنفَّذ
 *
 * السكربت يُنفَّذ يدوياً في محرّر SQL، فهو ينفصل عن الشيفرة لحظة توليده. أي تعديل
 * لاحق على مصدر الهجرة دون إعادة توليد الملف يجعل المُوافَق عليه شيئاً والمُنفَّذ
 * شيئاً آخر — بلا أن ينبّه أحد.
 *
 * هذا الاختبار يربط الاثنين: الملف **يُعاد توليده** ويُقارَن بايت-ببايت.
 * والبصمة مثبَّتة هنا لتُقارَن بما يُنفَّذ فعلاً على الخادم.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('P1.1A · بصمة سكربت الهجرة', () => {
  const DIR = path.join(__dirname, '..', '..', '..', 'docs', 'migrations');
  const UP_FILE = path.join(DIR, 'p11a-accounting-foundation-up.sql');
  const DOWN_FILE = path.join(DIR, 'p11a-accounting-foundation-down.sql');

  // ⚠️ عند أي تغيير مقصود في الهجرة: أعِد توليد الملفين، حدِّث البصمتين هنا،
  //    وأعِد عرضهما على المالك. البصمة القديمة تعني موافقة على سكربت آخر.
  const UP_SHA = '635c9143abaf8e6e1651b4755ce01df97a7f80776ed718a2219bcdf77abdd102';
  const DOWN_SHA = 'bd7dee6f345dd34d4ef87e4de968c2ff8563aa85fac7f72c8e4358a8522b65f3';

  const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');

  it('1. ملف UP مطابق تماماً لما يولّده مصدر الهجرة', () => {
    const onDisk = fs.readFileSync(UP_FILE, 'utf8');
    expect(onDisk).toBe(renderSql(P11A_UP, 'P1.1A · ACCOUNTING FOUNDATION · UP'));
  });

  it('2. ملف DOWN مطابق تماماً لما يولّده مصدر الهجرة', () => {
    const onDisk = fs.readFileSync(DOWN_FILE, 'utf8');
    expect(onDisk).toBe(renderSql(P11A_DOWN, 'P1.1A · ACCOUNTING FOUNDATION · DOWN (تراجع)'));
  });

  it('3. بصمة UP هي المعتمدة', () => {
    expect(sha(fs.readFileSync(UP_FILE))).toBe(UP_SHA);
  });

  it('4. بصمة DOWN هي المعتمدة', () => {
    expect(sha(fs.readFileSync(DOWN_FILE))).toBe(DOWN_SHA);
  });

  it('5. الملفان بنهايات أسطر LF فقط — البصمة تنكسر بأي تحويل CRLF', () => {
    for (const f of [UP_FILE, DOWN_FILE]) {
      expect(fs.readFileSync(f, 'utf8')).not.toMatch(/\r\n/);
    }
  });

  it('6. لا أسرار ولا بيانات اعتماد في السكربت', () => {
    const up = fs.readFileSync(UP_FILE, 'utf8');
    expect(up).not.toMatch(/postgres(ql)?:\/\//i);
    expect(up).not.toMatch(/PASSWORD|SECRET|API[_-]?KEY|Bearer /i);
    expect(up).not.toMatch(/supabase|railway/i);
  });
});
