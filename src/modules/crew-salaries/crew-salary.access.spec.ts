import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ForbiddenException } from '@nestjs/common';
import { ScreenAuthzService } from '../../common/screen-authz.service';
import { CrewSalariesAccessGuard, crewAccessMode } from './crew-salary.access';
import { CrewSalariesController } from './crew-salaries.controller';
import { SCREEN } from './crew-salaries.service';

/*
 * مفتاح تفعيل مرتّبات الأطقم — على كلّ المسارات، ولا يكفي فيه دور الأدمن.
 */
const OWNER = '8712bd6f-1880-4fd7-9a7d-8e9976e88eb1';
const users: Record<string, any> = {
  owner: { id: OWNER, role: 'admin', is_active: true, allowed_screens: null },
  admin: { id: 'a1', role: 'admin', is_active: true, allowed_screens: null },
  adminListed: { id: 'a2', role: 'admin', is_active: true, allowed_screens: [SCREEN] },
  clerk: { id: 'c1', role: 'user', is_active: true, allowed_screens: [SCREEN] },
  other: { id: 'u1', role: 'user', is_active: true, allowed_screens: ['/dashboard/invoices'] },
  disabled: { id: 'c2', role: 'user', is_active: false, allowed_screens: [SCREEN] },
};
const byId = (id: string) => Object.values(users).find((u) => u.id === id) || null;
const authz = new ScreenAuthzService({ findOne: async ({ where }: any) => byId(where.id) } as any);
const guard = new CrewSalariesAccessGuard(authz);
const ctx = (id?: string) => ({ switchToHttp: () => ({ getRequest: () => ({ user: id ? { id } : undefined }) }) }) as any;
const can = async (id?: string) => {
  try { return await guard.canActivate(ctx(id)); } catch (e) { if (e instanceof ForbiddenException) return (e.getResponse() as any).message as string; throw e; }
};

describe('مفتاح تفعيل مرتّبات الأطقم', () => {
  const env = { ...process.env };
  beforeEach(() => { process.env.CREW_SALARY_APPROVER_USER_ID = OWNER; });
  afterEach(() => { process.env = { ...env }; });

  it('القيمة: غائبة أو أيّ شيءٍ غير listed ⇒ مغلق', () => {
    expect(crewAccessMode({})).toBe('closed');
    for (const v of ['', 'open', 'true', 'on', 'LISTED ']) expect(crewAccessMode({ CREW_SALARIES_ACCESS: v })).toBe(v.trim().toLowerCase() === 'listed' ? 'listed' : 'closed');
  });

  it('مغلق: صاحب صلاحية الاعتماد وحده — لا أدمن ولا من مُنح الشاشة', async () => {
    delete process.env.CREW_SALARIES_ACCESS;
    expect(await can(OWNER)).toBe(true);
    for (const u of ['admin', 'adminListed', 'clerk', 'other']) expect(await can(users[u].id)).toMatch(/مغلقةٌ بعد/);
  });

  it('مفتوحٌ للقائمة: المعتمد، ومن مُنح الشاشة صراحةً — والأدمن بلا منحٍ صريح مرفوض', async () => {
    process.env.CREW_SALARIES_ACCESS = 'listed';
    expect(await can(OWNER)).toBe(true);
    expect(await can(users.clerk.id)).toBe(true);
    expect(await can(users.adminListed.id)).toBe(true);
    expect(await can(users.admin.id)).toMatch(/لا يكفي دور الأدمن/);
    expect(await can(users.other.id)).toMatch(/لا يكفي دور الأدمن/);
  });

  it('الحساب المعطَّل والمجهول وبلا دخول: مرفوضون في الحالتين', async () => {
    for (const mode of [undefined, 'listed']) {
      if (mode) process.env.CREW_SALARIES_ACCESS = mode; else delete process.env.CREW_SALARIES_ACCESS;
      expect(await can(users.disabled.id)).toMatch(/لا تملك صلاحية/);
      expect(await can('nobody')).toMatch(/لا تملك صلاحية/);
      expect(await can(undefined)).toMatch(/لا تملك صلاحية/);
    }
  });

  it('المعتمد غير مضبوط (أو فاسد): مغلقٌ على الجميع', async () => {
    delete process.env.CREW_SALARY_APPROVER_USER_ID;
    delete process.env.CREW_SALARIES_ACCESS;
    expect(await can(OWNER)).toMatch(/مغلقةٌ بعد/);
  });

  it('كلّ مسارات المتحكّم خلف المفتاح — لا مسار يستبدل حرّاسه', () => {
    const cls = Reflect.getMetadata(GUARDS_METADATA, CrewSalariesController) as unknown[];
    expect(cls).toContain(CrewSalariesAccessGuard);
    const proto = CrewSalariesController.prototype as any;
    const routes = Object.getOwnPropertyNames(proto).filter((k) => k !== 'constructor' && Reflect.getMetadata(PATH_METADATA, proto[k]) !== undefined);
    expect(routes).toHaveLength(22); // كلّ مسارات الميزة: العرض والاستيراد والملفّات والحسابات والاعتماد والتصدير
    for (const k of routes) expect(Reflect.getMetadata(GUARDS_METADATA, proto[k])).toBeUndefined();
  });
});
