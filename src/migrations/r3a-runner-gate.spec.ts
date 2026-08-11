import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { R3aRunnerController, isRunnerEnabled, R3A_RUNNER_ENV } from './r3a-runner.controller';

// خدمة صورية — لا اتصال بقاعدة بيانات ولا تنفيذ هجرة إطلاقاً
const svc: any = { run: jest.fn(async (d: boolean) => ({ reached: true, dryRun: d })), rollback: jest.fn(async () => ({ reached: true })) };
const admin = { user: { role: 'admin' } };
const user = { user: { role: 'user' } };

const withEnv = async (value: string | undefined, fn: () => Promise<void> | void) => {
  const prev = process.env[R3A_RUNNER_ENV];
  if (value === undefined) delete process.env[R3A_RUNNER_ENV];
  else process.env[R3A_RUNNER_ENV] = value;
  try { await fn(); } finally {
    if (prev === undefined) delete process.env[R3A_RUNNER_ENV];
    else process.env[R3A_RUNNER_ENV] = prev;
  }
};

describe('R3A.2 · بوابة البيئة', () => {
  it('1. القيمة الوحيدة المقبولة هي true صراحةً', () => {
    expect(isRunnerEnabled('true')).toBe(true);
    expect(isRunnerEnabled('TRUE')).toBe(true);
    expect(isRunnerEnabled(' true ')).toBe(true);
  });

  it('2. fail-closed: أي شيء آخر يعني معطَّل', () => {
    for (const v of [undefined, '', '   ', 'false', 'FALSE', '1', 'yes', 'on', 'enabled', 'True!', 'truthy'])
      expect(isRunnerEnabled(v as any)).toBe(false);
  });
});

describe('R3A.2 · سلوك المُشغِّل خلف البوابتين', () => {
  let c: R3aRunnerController;
  beforeEach(() => { c = new R3aRunnerController(svc); svc.run.mockClear(); svc.rollback.mockClear(); });

  it('3. معطَّل + أدمن ⇒ محجوب بـ404 (لا يُقرّ بوجود المسار)', () =>
    withEnv('false', () => {
      expect(() => c.run({}, admin)).toThrow(NotFoundException);
      expect(() => c.rollback(admin)).toThrow(NotFoundException);
      expect(svc.run).not.toHaveBeenCalled();
      expect(svc.rollback).not.toHaveBeenCalled();
    }));

  it('4. معطَّل + غير أدمن ⇒ محجوب — ونفس الرد تماماً فلا يتسرّب أي فارق', () =>
    withEnv('false', () => {
      expect(() => c.run({}, user)).toThrow(NotFoundException);
      expect(svc.run).not.toHaveBeenCalled();
    }));

  it('5. المتغيّر غائب ⇒ معطَّل', () =>
    withEnv(undefined, () => {
      expect(() => c.run({}, admin)).toThrow(NotFoundException);
      expect(svc.run).not.toHaveBeenCalled();
    }));

  it('6. مفعَّل + غير أدمن ⇒ 403', () =>
    withEnv('true', () => {
      expect(() => c.run({}, user)).toThrow(ForbiddenException);
      expect(() => c.rollback(user)).toThrow(ForbiddenException);
      expect(svc.run).not.toHaveBeenCalled();
    }));

  it('7. مفعَّل + أدمن ⇒ يصل إلى منطق المُشغِّل القائم', () =>
    withEnv('true', async () => {
      await expect(c.run({}, admin)).resolves.toMatchObject({ reached: true });
      expect(svc.run).toHaveBeenCalledTimes(1);
      await expect(c.rollback(admin)).resolves.toMatchObject({ reached: true });
    }));

  it('8. التشغيل التجريبي يبقى الافتراضي — لا كتابة إلا بطلب صريح', () =>
    withEnv('true', async () => {
      await c.run({}, admin);              expect(svc.run).toHaveBeenLastCalledWith(true);
      await c.run({ dryRun: true }, admin); expect(svc.run).toHaveBeenLastCalledWith(true);
      await c.run({}, admin);              expect(svc.run).toHaveBeenLastCalledWith(true);
      await c.run({ dryRun: false }, admin); expect(svc.run).toHaveBeenLastCalledWith(false);
    }));

  it('9. البوابة تسبق فحص الصلاحية — المعطَّل لا يكشف شيئاً عن الأدوار', () =>
    withEnv(undefined, () => {
      let a = '', b = '';
      try { c.run({}, admin); } catch (e: any) { a = e.constructor.name; }
      try { c.run({}, user); } catch (e: any) { b = e.constructor.name; }
      expect(a).toBe('NotFoundException');
      expect(b).toBe(a);
    }));

  it('10. لا تُطبع قيمة المتغيّر ولا أي سر في أي رد', () =>
    withEnv('true', () => {
      let msg = '';
      try { c.run({}, user); } catch (e: any) { msg = e.message; }
      expect(msg).not.toContain('R3A_RUNNER_ENABLED');
      expect(msg).not.toContain('true');
      expect(msg).not.toMatch(/postgres(ql)?:\/\/|password|sk-/i);
    }));
});
