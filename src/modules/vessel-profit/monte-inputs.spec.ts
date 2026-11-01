import 'reflect-metadata';
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
import { MonteInputsController } from './monte-inputs.controller';
import { MONTE_INGEST_HEADER } from './monte-ingest.guard';
import { inputContext, validateInput } from './monte-inputs';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';

/**
 * مدخلات فريق مونتي — الفحص الخالص ثمّ المسارات عبر HTTP بتركيب الوحدة كاملةً
 * (أخطاء الحقن لا تظهر إلّا عند الإقلاع). القاعدة مستودعٌ في الذاكرة.
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
    save: async (x: any) => { const r = { ...x, updated_at: new Date('2026-11-01T08:00:00Z') }; rows.set(x.vessel, r); return r; },
  };
}

const CTX = { months: ['2026-04', '2026-09', '2026-10'] };
const PKG = { schema: 'monte-pms/1', generated_at: '2026-10-31T16:46:01', monthly: CTX.months.map((month) => ({ month })) };

describe('مدخلات فريق مونتي', () => {
  it('الأشهر من حزمة الكارت المحفوظة', () => {
    expect(inputContext(PKG).months).toEqual(CTX.months);
    expect(inputContext(undefined).months).toEqual([]);
  });

  it('مصاريف السفينة: شهرٌ من الكارت ومبلغٌ غير صفر وعملةٌ معروفة ومستند', () => {
    const ok = validateInput('ship_cost', { month: '2026-10', label: ' زيوت ', amount: 1200, currency: 'sar', note: 'فاتورة 12', extra: 'x' }, CTX);
    expect(ok).toMatchObject({ ok: true, data: { month: '2026-10', label: 'زيوت', amount: 1200, currency: 'SAR', note: 'فاتورة 12' } });
    expect(ok.data).not.toHaveProperty('extra');
    expect(validateInput('ship_cost', { month: '2026-11', label: 'زيوت', amount: 1, note: 'x' }, CTX).errors.join()).toContain('ليس من أشهر الكارت');
    expect(validateInput('ship_cost', { month: '2026-10', label: 'زيوت', amount: 0, note: 'x' }, CTX).errors.join()).toContain('غير صفر');
    expect(validateInput('ship_cost', { month: '2026-10', label: 'زيوت', amount: '5', note: 'x' }, CTX).ok).toBe(false);
    expect(validateInput('ship_cost', { month: '2026-10', label: 'زيوت', amount: 5, currency: 'GBP', note: 'x' }, CTX).errors.join()).toContain('العملة');
    expect(validateInput('ship_cost', { month: '2026-10', label: 'زيوت', amount: 5 }, CTX).errors.join()).toContain('المستند');
    expect(validateInput('ship_cost', { month: '2026-10', label: 'استرداد', amount: -50, note: 'إشعار دائن' }, CTX).ok).toBe(true);
  });

  it('المرتّبات: دولارٌ أو يوروٌ أو كلاهما، موجبان', () => {
    expect(validateInput('salary', { month: '2026-10', usd: 95000, note: 'CFM' }, CTX)).toMatchObject({ ok: true, data: { usd: 95000, eur: null } });
    expect(validateInput('salary', { month: '2026-10', note: 'CFM' }, CTX).errors.join()).toContain('أو كليهما');
    expect(validateInput('salary', { month: '2026-10', usd: -1, note: 'CFM' }, CTX).ok).toBe(false);
  });

  it('أرقام وكيل سواكن: رحلةٌ برقمين وأعدادٌ صحيحة', () => {
    expect(validateInput('agent_return', { voyage: '07', pax: 300, tickets: 290, no_head: 9, note: 'إحصائيّة كنزي' }, CTX))
      .toMatchObject({ ok: true, data: { voyage: '07', pax: 300, tickets: 290, no_head: 9, cars: null } });
    expect(validateInput('agent_return', { voyage: '7', pax: 1, note: 'x' }, CTX).errors.join()).toContain('رقمان');
    expect(validateInput('agent_return', { voyage: '07', pax: 2.5, note: 'x' }, CTX).ok).toBe(false);
    expect(validateInput('agent_return', { voyage: '07', note: 'x' }, CTX).errors.join()).toContain('واحداً على الأقلّ');
  });

  it('الأسعار: اليورو الشهريّ والجنيه وفاتورة البنكر في حدودٍ معقولة', () => {
    expect(validateInput('eur_rate', { month: '2026-10', rate: 1.1612, note: 'ECB' }, CTX).ok).toBe(true);
    expect(validateInput('eur_rate', { month: '2026-10', rate: 11.6, note: 'ECB' }, CTX).ok).toBe(false);
    expect(validateInput('egp_rate', { rate: 48.6, note: 'البنك المركزيّ' }, CTX)).toMatchObject({ ok: true, data: { date: '2026-10-04' } });
    expect(validateInput('egp_rate', { rate: 0.02, note: 'x' }, CTX).ok).toBe(false);
    expect(validateInput('fuel_invoice', { date: '2026-10-26', amount: 180000, invoice: '26174545' }, CTX))
      .toMatchObject({ ok: true, data: { currency: 'SAR', tons: null, rob_before: null } });
    expect(validateInput('fuel_invoice', { date: '2026-10-26', amount: 1 }, CTX).errors.join()).toContain('رقم الفاتورة');
    expect(validateInput('fuel_invoice', { date: '2026-12-01', amount: 1, invoice: 'x' }, CTX).errors.join()).toContain('خارج أشهر الكارت');
    expect(validateInput('price_list', {}, CTX).errors[0]).toContain('غير معروف');
  });

  it('موجّهٌ بحارسَي JWT وشاشة التقارير', () => {
    expect(Reflect.getMetadata('path', MonteInputsController)).toBe('api/vessel-profit-inputs');
    expect(Reflect.getMetadata(GUARDS_METADATA, MonteInputsController)).toEqual([JwtAuthGuard, ScreenGuard]);
  });

  describe('عبر HTTP', () => {
    let app: INestApplication;
    const repo = memoryRepo();
    const KEY = randomBytes(32).toString('hex');
    const saved = process.env.MONTE_INGEST_KEY;
    const user = { id: 'u1', full_name: 'أحمد', email: 'a@x' };
    const add = (kind: string, data: object) => request(app.getHttpServer()).post('/api/vessel-profit-inputs/monte').send({ kind, data });
    const inputsOf = () => repo.rows.get('MonteJS')?.manual?.inputs || [];

    beforeAll(async () => {
      process.env.MONTE_INGEST_KEY = KEY;
      const moduleRef = await Test.createTestingModule({ imports: [StubDataSourceModule, VesselProfitModule] })
        .overrideProvider(getRepositoryToken(VesselProfitData)).useValue(repo)
        .overrideGuard(JwtAuthGuard).useValue({ canActivate: (c: any) => { c.switchToHttp().getRequest().user = user; return true; } })
        .overrideGuard(ScreenGuard).useValue({ canActivate: () => true })
        .compile();
      app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
      (app as NestExpressApplication).useBodyParser('json', { limit: '5mb' });
      await app.init();
    });
    afterAll(async () => {
      if (saved === undefined) delete process.env.MONTE_INGEST_KEY; else process.env.MONTE_INGEST_KEY = saved;
      await app?.close();
    });

    it('بلا حزمة يُرفض المُدخَل — لا أشهر يُقاس عليها', async () => {
      const r = await add('salary', { month: '2026-10', usd: 1, note: 'x' }).expect(400);
      expect(r.body.message).toContain('لا حزمة');
    });

    it('يُضيف باسم صاحبه ووقته ويُبقي الحزمة وبقيّة المفاتيح، والمرفوض لا يُكتب', async () => {
      repo.rows.set('MonteJS', { vessel: 'MonteJS', manual: { package: PKG, settings: { note: 'keep' } } });
      const r = await add('ship_cost', { month: '2026-10', label: 'زيوت', amount: 1200, currency: 'SAR', note: 'فاتورة 12' }).expect(201);
      expect(r.body.input).toMatchObject({ kind: 'ship_cost', by: { id: 'u1', name: 'أحمد' }, data: { label: 'زيوت' } });
      expect(r.body.input.id).toMatch(/^[0-9a-f-]{36}$/);
      const bad = await add('ship_cost', { month: '2026-11', label: 'زيوت', amount: 1, note: 'x' }).expect(400);
      expect(bad.body.errors.join()).toContain('ليس من أشهر الكارت');
      const m = repo.rows.get('MonteJS').manual;
      expect(m).toMatchObject({ package: PKG, settings: { note: 'keep' } });
      expect(inputsOf()).toHaveLength(1);
    });

    it('الإلغاء سجلٌّ جديد بسببه، ولا يُلغى المُلغى مرّتين', async () => {
      const id = inputsOf()[0].id;
      await request(app.getHttpServer()).post(`/api/vessel-profit-inputs/monte/${id}/void`).send({}).expect(400);
      const r = await request(app.getHttpServer()).post(`/api/vessel-profit-inputs/monte/${id}/void`).send({ reason: 'أُدخل مرّتين' }).expect(201);
      expect(r.body.input).toMatchObject({ kind: 'void', data: { target: id, reason: 'أُدخل مرّتين' } });
      await request(app.getHttpServer()).post(`/api/vessel-profit-inputs/monte/${id}/void`).send({ reason: 'ثانية' }).expect(400);
      await request(app.getHttpServer()).post('/api/vessel-profit-inputs/monte/00000000-0000-4000-8000-000000000000/void').send({ reason: 'x' }).expect(404);
      expect(inputsOf()).toHaveLength(2);
    });

    it('الحفظ من الكارت والدفع الآليّ لا يمحوان المدخلات', async () => {
      const before = inputsOf();
      await request(app.getHttpServer()).put('/api/vessel-profit/MonteJS').send({ manual: { package: PKG, inputs: [] } }).expect(200);
      expect(inputsOf()).toEqual(before);
      // الدفع يُرفض هنا لأنّ الحزمة المصغَّرة لا تطابق نفسها — المهمّ أنّه لا يمسّ المدخلات
      await request(app.getHttpServer()).post('/api/vessel-profit-ingest/monte').set(MONTE_INGEST_HEADER, KEY).send({ package: PKG });
      expect(inputsOf()).toEqual(before);
    });

    it('السكربت يسحبها بالمفتاح وحده', async () => {
      await request(app.getHttpServer()).get('/api/vessel-profit-ingest/monte/inputs').expect(401);
      const r = await request(app.getHttpServer()).get('/api/vessel-profit-ingest/monte/inputs').set(MONTE_INGEST_HEADER, KEY).expect(200);
      expect(r.body.inputs.map((x: any) => x.kind)).toEqual(['ship_cost', 'void']);
    });
  });
});
