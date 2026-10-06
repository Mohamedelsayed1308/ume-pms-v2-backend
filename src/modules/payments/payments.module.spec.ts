import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PaymentsModule } from './payments.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';

/**
 * ── اختبار تركيب الوحدتين ──
 * تطبيق الإشعارات الدائنة أضاف مستودعاً تحقنه المدفوعات والتدقيق. وخطأ الحقن لا يظهر
 * في `tsc` ولا في البناء — يظهر عند الإقلاع فتسقط الخدمة كلُّها.
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

describe('تركيب PaymentsModule وAuditModule', () => {
  it('يُركَّب رسم التبعيات كاملاً', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [StubDataSourceModule, PaymentsModule, AuditModule] }).compile();
    expect(moduleRef.get(PaymentsService, { strict: false })).toBeDefined();
    expect(moduleRef.get(AuditService, { strict: false })).toBeDefined();
    await moduleRef.close();
  });

  it('مسارا «allocations» مُعرَّفان قبل «:id» فلا تُقرأ الكلمة معرّفَ سداد', () => {
    const names = Object.getOwnPropertyNames(PaymentsController.prototype);
    const at = (n: string) => names.indexOf(n);
    expect(Reflect.getMetadata('path', PaymentsController.prototype.allocations)).toBe('allocations');
    expect(Reflect.getMetadata('path', PaymentsController.prototype.batch)).toBe('batch');
    expect(at('allocations')).toBeLessThan(at('findOne'));
    expect(at('removeAllocation')).toBeLessThan(at('remove'));
  });

  it('الدفعة تمرّر اسم المستخدم إلى الخدمة', () => {
    const svc = { createBatch: jest.fn() } as unknown as PaymentsService;
    new PaymentsController(svc).batch({ x: 1 }, { user: { id: 'u1', full_name: 'M.Elsayed' } });
    expect(svc.createBatch).toHaveBeenCalledWith({ x: 1 }, 'M.Elsayed');
  });
});
