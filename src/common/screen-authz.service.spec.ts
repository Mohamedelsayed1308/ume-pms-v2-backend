import { ScreenAuthzService } from './screen-authz.service';

// مستودع وهمي — لا حاجة لأي بيانات إنتاج
const repoOf = (user: any) => ({ findOne: async () => user }) as any;
const svc = (user: any) => new ScreenAuthzService(repoOf(user));

const INV = '/dashboard/invoices';
const PAY = '/dashboard/payments';
const REP = '/dashboard/reports';

describe('ScreenAuthzService.can — سياسة التفويض', () => {
  it('1. أدمن + allowed_screens = null ⇒ ALLOW', async () => {
    const s = svc({ id: 'u1', role: 'admin', is_active: true, allowed_screens: null });
    await expect(s.can('u1', INV)).resolves.toBe(true);
  });

  it('2. مستخدم + allowed_screens = null ⇒ DENY (deny-by-default)', async () => {
    const s = svc({ id: 'u2', role: 'user', is_active: true, allowed_screens: null });
    await expect(s.can('u2', INV)).resolves.toBe(false);
  });

  it('3. مستخدم + قائمة صريحة تحتوي الشاشة ⇒ ALLOW', async () => {
    const s = svc({ id: 'u3', role: 'user', is_active: true, allowed_screens: [INV, PAY] });
    await expect(s.can('u3', INV)).resolves.toBe(true);
  });

  it('4. مستخدم + قائمة صريحة لا تحتوي الشاشة ⇒ DENY', async () => {
    const s = svc({ id: 'u4', role: 'user', is_active: true, allowed_screens: [PAY] });
    await expect(s.can('u4', INV)).resolves.toBe(false);
  });

  // حالات حدّية
  it('مستخدم + قائمة فارغة ⇒ DENY', async () => {
    const s = svc({ id: 'u5', role: 'user', is_active: true, allowed_screens: [] });
    await expect(s.can('u5', INV)).resolves.toBe(false);
  });

  it('مستخدم + allowed_screens ليست مصفوفة (بيانات تالفة) ⇒ DENY', async () => {
    const s = svc({ id: 'u6', role: 'user', is_active: true, allowed_screens: 'invoices' as any });
    await expect(s.can('u6', INV)).resolves.toBe(false);
  });

  it('مستخدم معطّل ⇒ DENY حتى لو كان أدمن', async () => {
    const s = svc({ id: 'u7', role: 'admin', is_active: false, allowed_screens: null });
    await expect(s.can('u7', INV)).resolves.toBe(false);
  });

  it('مستخدم غير موجود ⇒ DENY', async () => {
    const s = svc(null);
    await expect(s.can('missing', INV)).resolves.toBe(false);
  });

  it('بلا معرّف مستخدم ⇒ DENY', async () => {
    const s = svc({ id: 'x', role: 'admin', is_active: true, allowed_screens: null });
    await expect(s.can('' as any, INV)).resolves.toBe(false);
  });
});

describe('ScreenAuthzService.canAny — منطق «أيّ منها»', () => {
  it('يملك واحدة من الشاشات المطلوبة ⇒ ALLOW', async () => {
    const s = svc({ id: 'a1', role: 'user', is_active: true, allowed_screens: [REP] });
    await expect(s.canAny('a1', [INV, REP])).resolves.toBe(true);
  });

  it('لا يملك أياً منها ⇒ DENY', async () => {
    const s = svc({ id: 'a2', role: 'user', is_active: true, allowed_screens: [PAY] });
    await expect(s.canAny('a2', [INV, REP])).resolves.toBe(false);
  });

  it('أدمن ⇒ ALLOW لأي مجموعة', async () => {
    const s = svc({ id: 'a3', role: 'admin', is_active: true, allowed_screens: null });
    await expect(s.canAny('a3', [INV, REP])).resolves.toBe(true);
  });

  it('مستخدم على null ⇒ DENY لأي مجموعة', async () => {
    const s = svc({ id: 'a4', role: 'user', is_active: true, allowed_screens: null });
    await expect(s.canAny('a4', [INV, REP])).resolves.toBe(false);
  });

  it('يملك كل الشاشات المطلوبة ⇒ ALLOW', async () => {
    const s = svc({ id: 'a5', role: 'user', is_active: true, allowed_screens: [INV, REP] });
    await expect(s.canAny('a5', [INV, REP])).resolves.toBe(true);
  });
});

describe('ScreenAuthzService.assert / assertAny — رمي 403', () => {
  it('assert يرمي عند المنع', async () => {
    const s = svc({ id: 'e1', role: 'user', is_active: true, allowed_screens: [PAY] });
    await expect(s.assert('e1', INV)).rejects.toThrow();
  });

  it('assert لا يرمي عند السماح', async () => {
    const s = svc({ id: 'e2', role: 'user', is_active: true, allowed_screens: [INV] });
    await expect(s.assert('e2', INV)).resolves.toBeUndefined();
  });

  it('assertAny يرمي عند عدم امتلاك أيٍّ منها', async () => {
    const s = svc({ id: 'e3', role: 'user', is_active: true, allowed_screens: [PAY] });
    await expect(s.assertAny('e3', [INV, REP])).rejects.toThrow();
  });
});
