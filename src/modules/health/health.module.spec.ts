import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { HealthModule } from './health.module';
import { HealthController, probeDb, readVersion } from './health.controller';

/**
 * ── تركيب الوحدة ──
 * على نمط `receipts.module.spec.ts`: خطأ الحقن لا يراه `tsc` ولا البناء، ويراه
 * الإقلاع وحده. ونقطةُ صحّةٍ تُسقط الخدمة عند الإقلاع نكتةٌ لا نريد روايتها.
 */
@Global()
@Module({
  providers: [{
    provide: getDataSourceToken(),
    useValue: {
      entityMetadatas: [],
      options: { type: 'postgres' },
      getRepository: () => ({}),
      query: async () => [{ '?column?': 1 }],
    } as unknown as DataSource,
  }],
  exports: [getDataSourceToken()],
})
class StubDataSourceModule {}

/** ردٌّ وهميّ يلتقط رمز الحالة والترويسات. */
function fakeRes() {
  const r: any = { code: 0, headers: {} as Record<string, string> };
  r.status = (c: number) => { r.code = c; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  return r;
}

describe('تركيب HealthModule', () => {
  it('يُركَّب ويجد DataSource العامّ', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [StubDataSourceModule, HealthModule],
    }).compile();
    expect(moduleRef.get(HealthController, { strict: false })).toBeDefined();
    await moduleRef.close();
  });

  it('الموجّه على `api/health`', () => {
    expect(Reflect.getMetadata('path', HealthController)).toBe('api/health');
  });

  /*
   * بلا حارسٍ عمداً: أداة المراقبة لا تحمل رمزاً. وإن أضاف أحدٌ حارساً يوماً
   * صارت النقطة تردّ `401` فتبدو الخدمة ساقطةً وهي حيّة.
   */
  it('بلا حارس — أداة المراقبة لا تحمل رمزاً', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, HealthController) || [];
    expect(guards).toHaveLength(0);
  });
});

describe('probeDb', () => {
  it('قاعدةٌ تردّ ⇒ ok', async () => {
    const r = await probeDb({ query: async () => [1] } as any);
    expect(r.db).toBe('ok');
    expect(r.db_ms).toBeGreaterThanOrEqual(0);
  });

  it('قاعدةٌ ترمي ⇒ fail — ولا يُرمى شيء', async () => {
    const r = await probeDb({ query: async () => { throw new Error('ECONNREFUSED'); } } as any);
    expect(r.db).toBe('fail');
  });

  it('قاعدةٌ صامتة ⇒ timeout بعد المهلة', async () => {
    const never = { query: () => new Promise(() => {}) } as any;
    const r = await probeDb(never, 30);
    expect(r.db).toBe('timeout');
    expect(r.db_ms).toBeGreaterThanOrEqual(30);
  });
});

describe('HealthController.check', () => {
  const make = (query: () => Promise<unknown>) => new HealthController({ query } as any);

  it('200 و ok حين تردّ القاعدة', async () => {
    const res = fakeRes();
    const body = await make(async () => [1]).check(res);
    expect(res.code).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('503 و degraded حين تسقط القاعدة', async () => {
    const res = fakeRes();
    const body = await make(async () => { throw new Error('down'); }).check(res);
    expect(res.code).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.db).toBe('fail');
  });

  /*
   * النقطة عامّة، فجسمها يجب أن يصلح للعلن: لا نصّ خطأٍ ولا رابطَ ولا مضيف.
   * يُعدّ الحقول عدّاً كي لا يتسرّب حقلٌ جديدٌ بلا مراجعة.
   */
  it('لا يكشف إلا الحقول المتّفق عليها', async () => {
    const body = await make(async () => { throw new Error('postgresql://user:pw@host/db'); }).check(fakeRes());
    expect(Object.keys(body).sort()).toEqual(
      ['checked_at', 'db', 'db_ms', 'started_at', 'status', 'uptime_s', 'version'].sort(),
    );
    expect(JSON.stringify(body)).not.toMatch(/postgres|pw@host/);
  });
});

describe('readVersion', () => {
  it('ثمانية أحرفٍ من SHA النشرة', () => {
    expect(readVersion({ RAILWAY_GIT_COMMIT_SHA: '836f302dabcdef1234567890' })).toBe('836f302d');
  });
  it('unknown حين لا بيئة', () => {
    expect(readVersion({})).toBe('unknown');
  });
});
