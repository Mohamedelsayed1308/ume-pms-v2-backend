import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { VesselCogsModule } from './vessel-cogs.module';
import { VesselCogsController } from './vessel-cogs.controller';
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

describe('تركيب VesselCogsModule', () => {
  it('يُركَّب رسم التبعيات كاملاً', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [StubDataSourceModule, VesselCogsModule] }).compile();
    expect(moduleRef.get(VesselCogsController, { strict: false })).toBeDefined();
    await moduleRef.close();
  });

  it('الموجّه على `api/vessel-cogs` ومحروسٌ بالمصادقة وشاشة التقارير', () => {
    expect(Reflect.getMetadata('path', VesselCogsController)).toBe('api/vessel-cogs');
    const guards = (Reflect.getMetadata(GUARDS_METADATA, VesselCogsController) || []) as any[];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(ScreenGuard);
  });

  /** الكتابة كلّها للأدمن: الخطّة والترحيل وإعادة التصنيف والسطر اليدويّ والحذف. */
  it('خمسة موجّهات كتابةٍ بخمسة فحوص دور', () => {
    const src = VesselCogsController.toString();
    expect((src.match(/ensureAdmin\(req\)/g) || []).length).toBe(5);
  });
});
