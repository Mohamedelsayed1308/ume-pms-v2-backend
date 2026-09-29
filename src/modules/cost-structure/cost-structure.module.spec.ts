import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CostStructureModule } from './cost-structure.module';
import { CostStructureController } from './cost-structure.controller';
import { CostStructureService } from './cost-structure.service';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';

/**
 * ── اختبار تركيب الوحدة ──
 * خطأُ حقن التبعيات لا يظهر في `tsc` ولا في البناء — يظهر عند الإقلاع فتسقط
 * الخدمة كلُّها. وقد سقط الإنتاج بذلك فعلاً.
 */
@Global()
@Module({
  providers: [{
    provide: getDataSourceToken(),
    useValue: { entityMetadatas: [], options: { type: 'postgres' }, getRepository: () => ({}) } as unknown as DataSource,
  }],
  exports: [getDataSourceToken()],
})
class StubDataSourceModule {}

describe('تركيب CostStructureModule', () => {
  it('يُركَّب رسم التبعيات كاملاً', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [StubDataSourceModule, CostStructureModule] }).compile();
    expect(moduleRef.get(CostStructureController, { strict: false })).toBeDefined();
    await moduleRef.close();
  });

  it('الموجّه على `api/cost-structure` ومحروسٌ بالمصادقة وشاشة التقارير', () => {
    expect(Reflect.getMetadata('path', CostStructureController)).toBe('api/cost-structure');
    const guards = (Reflect.getMetadata(GUARDS_METADATA, CostStructureController) || []) as any[];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(ScreenGuard);
  });

  it('موجّها الكتابة يرفضان غير الأدمن قبل أن يصلا إلى الخدمة', () => {
    const svc = { set: jest.fn(), clear: jest.fn(), list: jest.fn() } as unknown as CostStructureService;
    const ctl = new CostStructureController(svc);
    const user = { user: { id: 'u1', role: 'user' } };
    expect(() => ctl.set(user, 'broker', { code: 'D' })).toThrow('صلاحيات الأدمن مطلوبة');
    expect(() => ctl.clear(user, 'broker')).toThrow('صلاحيات الأدمن مطلوبة');
    expect(svc.set).not.toHaveBeenCalled();
    expect(svc.clear).not.toHaveBeenCalled();
    ctl.set({ user: { id: 'a1', role: 'admin' } }, 'broker', { code: 'D' });
    expect(svc.set).toHaveBeenCalledWith('broker', 'D', 'a1');
  });
});
