import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CrewSalariesModule } from './crew-salaries.module';
import { CrewSalariesController } from './crew-salaries.controller';
import { CrewSalariesService } from './crew-salaries.service';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { CrewSalariesAccessGuard } from './crew-salary.access';
import { approverId, isApprover } from './crew-salary.approver';

/**
 * ── اختبار تركيب الوحدة ──
 * خطأ حقن التبعيات لا يظهر في `tsc` ولا في البناء — يظهر عند الإقلاع فتسقط الخدمة كلّها.
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

describe('تركيب CrewSalariesModule', () => {
  it('يُركَّب رسم التبعيات كاملاً (ومعه خدمة أسعار الصرف المصدَّرة)', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [StubDataSourceModule, CrewSalariesModule] }).compile();
    expect(moduleRef.get(CrewSalariesController, { strict: false })).toBeDefined();
    expect(moduleRef.get(CrewSalariesService, { strict: false })).toBeDefined();
    await moduleRef.close();
  });

  it('الموجّه على `api/crew-salaries` ومحروسٌ بالمصادقة ومفتاح التفعيل', () => {
    expect(Reflect.getMetadata('path', CrewSalariesController)).toBe('api/crew-salaries');
    const guards = (Reflect.getMetadata(GUARDS_METADATA, CrewSalariesController) || []) as any[];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(CrewSalariesAccessGuard); // مفتاح التفعيل بدل حارس الشاشة العامّ (الذي يمرّر الأدمن)
  });
});

describe('صاحب صلاحية الاعتماد', () => {
  const ID = '8712bd6f-1880-4fd7-9a7d-8e9976e88eb1';
  it('غياب المتغيّر أو فساده ⇒ لا معتمد، والاعتماد مرفوض للجميع (والأدمن منهم)', () => {
    for (const v of [undefined, '', 'admin', 'not-a-uuid', ' ']) {
      const env = { CREW_SALARY_APPROVER_USER_ID: v } as NodeJS.ProcessEnv;
      expect(approverId(env)).toBeNull();
      expect(isApprover(ID, env)).toBe(false);
    }
  });
  it('المعرّف الثابت وحده — لا غيره', () => {
    const env = { CREW_SALARY_APPROVER_USER_ID: ID.toUpperCase() } as NodeJS.ProcessEnv;
    expect(isApprover(ID, env)).toBe(true);
    expect(isApprover('00000000-0000-4000-8000-000000000000', env)).toBe(false);
    expect(isApprover(undefined, env)).toBe(false);
  });
});
