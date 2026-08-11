import { AuthService, normalizeRole, isValidScreens } from './auth.service';

const INV = '/dashboard/invoices';
const PAY = '/dashboard/payments';

// مستودع وهمي يسجّل عمليات التحديث — لا حاجة لأي بيانات إنتاج
function makeSvc(user: any) {
  const updates: any[] = [];
  const repo: any = {
    findOne: async () => (user ? { ...user } : null),
    update: async (_id: string, patch: any) => { updates.push(patch); Object.assign(user, patch); return { affected: 1 }; },
    save: async (u: any) => ({ id: 'new-id', ...u }),
  };
  return { svc: new AuthService(repo, {} as any), updates, repo };
}

describe('normalizeRole — قائمة سماح صريحة', () => {
  it('يقبل admin', () => expect(normalizeRole('admin')).toBe('admin'));
  it('يقبل user', () => expect(normalizeRole('user')).toBe('user'));

  // لا شيء من هذه يجب أن يؤدي إلى admin
  it.each([
    ['undefined', undefined], ['null', null], ['نص فارغ', ''], ['مسافات', '   '],
    ['قيمة غير معروفة', 'superadmin'], ['حالة أحرف مختلفة', 'ADMIN'], ['رقم', 1],
    ['كائن', { role: 'admin' }], ['مصفوفة', ['admin']], ['منطقي', true],
  ])('%s ⇒ user (لا تصعيد صلاحيات)', (_label, input) => {
    expect(normalizeRole(input as any)).toBe('user');
  });

  it('لا تُنتج أي مدخلات عشوائية دور admin', () => {
    const samples = ['', ' admin', 'admin ', 'Admin', 'aDmIn', 'root', 'owner', '0', 'false'];
    expect(samples.every((s) => normalizeRole(s) !== 'admin')).toBe(true);
  });
});

describe('isValidScreens — تحقق قائمة الشاشات', () => {
  it('مصفوفة مسارات صالحة ⇒ true', () => expect(isValidScreens([INV, PAY])).toBe(true));
  it('مصفوفة فارغة ⇒ false', () => expect(isValidScreens([])).toBe(false));
  it('null ⇒ false', () => expect(isValidScreens(null)).toBe(false));
  it('نص ⇒ false', () => expect(isValidScreens(INV)).toBe(false));
  it('مسار غير صالح ⇒ false', () => expect(isValidScreens(['invoices'])).toBe(false));
  it('عنصر غير نصي ⇒ false', () => expect(isValidScreens([INV, 5])).toBe(false));
});

describe('createUser — الدور الافتراضي الآمن', () => {
  it('بلا دور ⇒ user', async () => {
    const { svc } = makeSvc(null);
    const u = await svc.createUser({ email: 'a@b.c', password: 'x', full_name: 'A' } as any);
    expect(u.role).toBe('user');
  });

  it('دور غير معروف ⇒ user', async () => {
    const { svc } = makeSvc(null);
    const u = await svc.createUser({ email: 'a@b.c', password: 'x', full_name: 'A', role: 'superadmin' } as any);
    expect(u.role).toBe('user');
  });

  it('admin صريح ⇒ admin', async () => {
    const { svc } = makeSvc(null);
    const u = await svc.createUser({ email: 'a@b.c', password: 'x', full_name: 'A', role: 'admin' } as any);
    expect(u.role).toBe('admin');
  });
});

describe('setRole — حارس التحويل admin → user', () => {
  it('يرفض تحويل أدمن على null بلا قائمة صريحة (400)', async () => {
    const { svc, updates } = makeSvc({ id: 'u1', role: 'admin', allowed_screens: null });
    await expect(svc.setRole('u1', 'user')).rejects.toThrow(/allowed_screens/);
    expect(updates.length).toBe(0);            // لم يُحفظ أي تغيير
  });

  it('يرفض قائمة فارغة', async () => {
    const { svc, updates } = makeSvc({ id: 'u2', role: 'admin', allowed_screens: null });
    await expect(svc.setRole('u2', 'user', [])).rejects.toThrow();
    expect(updates.length).toBe(0);
  });

  it('يرفض قائمة بمسارات غير صالحة', async () => {
    const { svc } = makeSvc({ id: 'u3', role: 'admin', allowed_screens: null });
    await expect(svc.setRole('u3', 'user', ['invoices'])).rejects.toThrow();
  });

  it('يسمح عند تمرير قائمة صريحة صالحة — ويحفظها قبل الدور', async () => {
    const { svc, updates } = makeSvc({ id: 'u4', role: 'admin', allowed_screens: null });
    await svc.setRole('u4', 'user', [INV, PAY]);
    expect(updates[0]).toEqual({ allowed_screens: [INV, PAY] });   // الصلاحيات أولاً
    expect(updates[1]).toEqual({ role: 'user' });                   // ثم الدور
  });

  it('يسمح إذا كان الأدمن يملك قائمة صريحة مسبقاً', async () => {
    const { svc, updates } = makeSvc({ id: 'u5', role: 'admin', allowed_screens: [INV] });
    await svc.setRole('u5', 'user');
    expect(updates).toEqual([{ role: 'user' }]);
  });

  it('لا يمنح قائمة افتراضية تلقائياً عند الرفض', async () => {
    const user = { id: 'u6', role: 'admin', allowed_screens: null };
    const { svc } = makeSvc(user);
    await expect(svc.setRole('u6', 'user')).rejects.toThrow();
    expect(user.allowed_screens).toBeNull();
  });

  it('user → admin لا يخضع للحارس', async () => {
    const { svc, updates } = makeSvc({ id: 'u7', role: 'user', allowed_screens: [INV] });
    await svc.setRole('u7', 'admin');
    expect(updates).toEqual([{ role: 'admin' }]);
  });

  it('user → user لا يخضع للحارس', async () => {
    const { svc, updates } = makeSvc({ id: 'u8', role: 'user', allowed_screens: null });
    await svc.setRole('u8', 'user');
    expect(updates).toEqual([{ role: 'user' }]);
  });

  it('دور غير معروف يؤول إلى user ويخضع للحارس', async () => {
    const { svc } = makeSvc({ id: 'u9', role: 'admin', allowed_screens: null });
    await expect(svc.setRole('u9', 'superadmin')).rejects.toThrow();  // لأنه يؤول إلى user
  });

  it('مستخدم غير موجود ⇒ يرمي', async () => {
    const { svc } = makeSvc(null);
    await expect(svc.setRole('missing', 'user')).rejects.toThrow();
  });
});
