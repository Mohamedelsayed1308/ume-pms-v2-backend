import 'reflect-metadata';
import { existsSync, readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { Global, INestApplication, Module } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { VesselProfitModule } from './vessel-profit.module';
import { VesselProfitData } from './vessel-profit.entity';
import { MonteIngestController } from './monte-ingest.controller';
import { MONTE_INGEST_HEADER, MonteIngestGuard } from './monte-ingest.guard';
import { validateMontePackage } from './monte-package';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';

/**
 * الدفع الآليّ لحزمة مونتي — تركيب الوحدة (أخطاء الحقن لا تظهر إلّا عند الإقلاع)
 * ثمّ المسار عبر HTTP بحارسه الحقيقيّ. القاعدة مستبدَلة بمستودعٍ في الذاكرة.
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

function memoryRepo() {
  const rows = new Map<string, any>();
  return {
    rows,
    findOne: async ({ where: { vessel } }: any) => (rows.has(vessel) ? JSON.parse(JSON.stringify(rows.get(vessel))) : null),
    create: (x: any) => ({ ...x }),
    save: async (x: any) => { const r = { ...x, updated_at: new Date('2026-10-30T20:00:00Z') }; rows.set(x.vessel, r); return r; },
  };
}

const REAL = 'F:/OneDrive/OneDrive - United Marine Egypt/Basel-Mohamed/مونتي جده-سواكن/_تقارير/_PMS/monte_pms.json';
const ZERO = Object.fromEntries([
  'rev_pax_out', 'rev_pax_ret', 'rev_cargo_out', 'rev_cargo_ret', 'rev_do', 'rev_other',
  'cost_fuel', 'cost_water', 'cost_port_jed', 'cost_comm_jed', 'cost_port_suk',
  'cost_comm_suk30', 'cost_comm_suk', 'cost_agent_adj', 'cost_gifts', 'cost_catering',
].map((k) => [k, 0]));

/** حزمةٌ صغيرة متّسقة: رحلةٌ واحدة في أبريل، إيرادها 1000 ووقودها 300، وتأمينٌ 100. */
function pkg(over: { generated_at?: string; net?: number } = {}) {
  return {
    schema: 'monte-pms/1', generated_at: over.generated_at ?? '2026-10-30T15:40:13',
    vessel: { name: 'Monte Express', cap_cars: 167 },
    voyages: [{
      ...ZERO, voyage: '01', dep: '2026-04-10', rev_pax_out: 1000, cost_fuel: 300, hire_in_file: 0,
      items: [
        { kind: 'rev', side: 'jeddah', label: 'ركّاب', usd: 1000, excluded: false },
        { kind: 'cost', side: 'jeddah', label: 'وقود', usd: -300, excluded: false },
      ],
    }],
    monthly: [{ month: '2026-04', vnet: 700, pos: 0, ins: -100, sal_usd: 0, sal_eur: 0, crew_misc: 0, ctm: 0, fixed: -100, net: over.net ?? 600, trips: 1 }],
    legs: [], fuel_stock: [], agent_voyages: [], agent_summary: [], line_compare: [], rules: [], pending: [],
  };
}

describe('الدفع الآليّ لحزمة مونتي', () => {
  it('موجّهٌ منفصل بحارس المفتاح وحده — لا JWT ولا شاشة', () => {
    expect(Reflect.getMetadata('path', MonteIngestController)).toBe('api/vessel-profit-ingest');
    const guards = (Reflect.getMetadata(GUARDS_METADATA, MonteIngestController) || []) as any[];
    expect(guards).toEqual([MonteIngestGuard]);
  });

  it('المحقِّق يقبل الحزمة الحقيقيّة إن وُجدت ويرفض صافياً لا يطابق مكوّناته', () => {
    if (existsSync(REAL)) {
      const c = validateMontePackage(JSON.parse(readFileSync(REAL, 'utf8')));
      expect(c.errors).toEqual([]);
      expect(c.ok).toBe(true);
      expect(c.voyages).toBeGreaterThan(0);
    }
    expect(validateMontePackage(pkg()).ok).toBe(true);
    const bad = validateMontePackage(pkg({ net: 999 }));
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toContain('شهر 2026-04');
    expect(validateMontePackage([]).ok).toBe(false);
    expect(validateMontePackage({ ...pkg(), schema: 'x' }).errors[0]).toContain('غير مدعوم');
  });

  it('بنود السفينة في fixed_items تدخل في الثابتة بلا تعديل كود', () => {
    const withItems = (items: unknown, fixed: number, net: number) => {
      const p = pkg();
      Object.assign(p.monthly[0], { fixed_items: items, fixed, net });
      return validateMontePackage(p);
    };
    const items = [{ key: 'prov', label: 'مؤن', usd: -40 }, { key: 'outfit', label: 'تجهيز', usd: -60 }];
    expect(withItems(items, -200, 500).errors).toEqual([]);
    // البند غائبٌ عن مجموع الثابتة ← الشهر لا يطابق مكوّناته
    expect(withItems(items, -100, 600).errors[0]).toContain('الثابتة');
    expect(withItems([items[0], items[0]], -180, 520).errors.join()).toContain('مكرّر');
    expect(withItems([{ key: 'x', usd: -1 }], -101, 599).errors.join()).toContain('بلا مفتاحٍ أو اسم');
    expect(withItems('x', -100, 600).errors[0]).toContain('ليس قائمة');
    expect(withItems([{ key: 'r', label: 'استرداد', usd: 10 }], -90, 610).warnings.join()).toContain('موجب');
  });

  describe('عبر HTTP', () => {
    let app: INestApplication;
    const repo = memoryRepo();
    const KEY = randomBytes(32).toString('hex');
    const saved = process.env.MONTE_INGEST_KEY;
    const post = (body: unknown, key?: string) => {
      const r = request(app.getHttpServer()).post('/api/vessel-profit-ingest/monte');
      return (key === undefined ? r : r.set(MONTE_INGEST_HEADER, key)).send(body as object);
    };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [StubDataSourceModule, VesselProfitModule] })
        .overrideProvider(getRepositoryToken(VesselProfitData)).useValue(repo)
        .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
        .overrideGuard(ScreenGuard).useValue({ canActivate: () => true })
        .compile();
      app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
      (app as NestExpressApplication).useBodyParser('json', { limit: '5mb' }); // كما في main.ts
      await app.init();
    });
    afterAll(async () => {
      if (saved === undefined) delete process.env.MONTE_INGEST_KEY; else process.env.MONTE_INGEST_KEY = saved;
      await app?.close();
    });

    it('معطَّلٌ (503) بلا مفتاحٍ على الخادم أو بمفتاحٍ قصير', async () => {
      delete process.env.MONTE_INGEST_KEY;
      await post({ package: pkg() }, KEY).expect(503);
      process.env.MONTE_INGEST_KEY = 'short';
      await post({ package: pkg() }, 'short').expect(503);
      expect(repo.rows.size).toBe(0);
    });

    it('يرفض (401) بلا مفتاح أو بمفتاحٍ خاطئ', async () => {
      process.env.MONTE_INGEST_KEY = KEY;
      await post({ package: pkg() }).expect(401);
      await post({ package: pkg() }, KEY.slice(0, -1) + (KEY.endsWith('0') ? '1' : '0')).expect(401);
      await post({ package: pkg() }, `${KEY}x`).expect(401);
      expect(repo.rows.size).toBe(0);
    });

    it('يحفظ في manual.package ويُبقي بقيّة المفاتيح، ولا يعيد كتابة الحزمة نفسها', async () => {
      process.env.MONTE_INGEST_KEY = KEY;
      repo.rows.set('MonteJS', { vessel: 'MonteJS', manual: { settings: { note: 'keep' }, packageFile: 'old.json' } });
      const r = await post({ package: pkg(), file: 'C:\\x\\_PMS\\monte_pms.json' }, KEY).expect(200);
      expect(r.body).toMatchObject({ saved: true, voyages: 1, hidden: [], generatedAt: '2026-10-30T15:40:13' });
      const m = repo.rows.get('MonteJS').manual;
      expect(m.settings).toEqual({ note: 'keep' });
      expect(m.package).toEqual(pkg());
      expect(m).toMatchObject({ packageFile: 'monte_pms.json', packageSource: 'monte-session', packageSavedAt: r.body.savedAt });

      const again = await post({ package: pkg() }, KEY).expect(200);
      expect(again.body).toMatchObject({ saved: false, unchanged: true, savedAt: r.body.savedAt });
    });

    it('حزمةٌ لا تطابق نفسها (400) أو أقدم من المحفوظة (409) لا تمسّ المحفوظ', async () => {
      process.env.MONTE_INGEST_KEY = KEY;
      const before = JSON.stringify(repo.rows.get('MonteJS'));
      const bad = await post({ package: pkg({ generated_at: '2026-10-31T09:00:00', net: 999 }) }, KEY).expect(400);
      expect(bad.body.errors[0]).toContain('شهر 2026-04');
      const old = await post({ package: pkg({ generated_at: '2026-10-29T10:00:00' }) }, KEY).expect(409);
      expect(old.body.message).toContain('أحدث');
      await post({}, KEY).expect(400);
      expect(JSON.stringify(repo.rows.get('MonteJS'))).toBe(before);

      const newer = await post({ package: pkg({ generated_at: '2026-10-31T09:00:00' }) }, KEY).expect(200);
      expect(newer.body.saved).toBe(true);
    });
  });
});
