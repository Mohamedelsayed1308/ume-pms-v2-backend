import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { freshDb } from '../../../test/pg/db';
import { Invoice } from '../invoices/invoice.entity';
import { ImportBatch } from '../invoices/import-batch.entity';
import { Supplier } from '../suppliers/supplier.entity';
import { Vessel } from '../vessels/vessel.entity';
import { ShippingCompany } from '../shipping-companies/shipping-company.entity';
import { PurchaseOrder } from '../purchase-orders/purchase-order.entity';
import { Item } from '../items/item.entity';
import { Payment } from './payment.entity';
import { CreditAllocation } from './credit-allocation.entity';
import { PaymentsService } from './payments.service';
import { InvoicesService } from '../invoices/invoices.service';
import { VesselsService } from '../vessels/vessels.service';
import { AuditService } from '../audit/audit.service';

/*
 * تطبيق الإشعار الدائن على فواتير المورّد — على PostgreSQL حقيقيّة (مؤقّتة، محلّيّة) لا الإنتاج.
 * السيناريو هو حالة المالك ٦ أكتوبر ٢٠٢٦: إشعارٌ دائن 401.67- يورو وأربع فواتير، والتحويل 3,992.73.
 * يُشغَّل:  npx jest -c test/jest-pg.json credit-allocation
 */
const UP = fs.readFileSync(path.join(__dirname, '../../../docs/credit-note-allocations-up.sql'), 'utf8');
const DOWN = fs.readFileSync(path.join(__dirname, '../../../docs/credit-note-allocations-down.sql'), 'utf8');
const ENTITIES = [Invoice, ImportBatch, Supplier, Vessel, ShippingCompany, PurchaseOrder, Item, Payment, CreditAllocation];

describe('تطبيق الإشعارات الدائنة على PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof freshDb>>;
  let c: Client;
  let ds: DataSource;
  let svc: PaymentsService;
  const id: Record<string, string> = {};

  const inv = async (key: string, number: string, total: number, supplier = id.sup, currency = 'EUR') => {
    const r = await c.query(
      `INSERT INTO invoices (invoice_number, supplier_id, vessel_id, total_amount, currency) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [number, supplier, id.vessel, total, currency]);
    id[key] = r.rows[0].id;
  };
  const state = async (key: string) => (await c.query(`SELECT paid_amount::float AS paid, status FROM invoices WHERE id=$1`, [id[key]])).rows[0];
  const counts = async () => (await c.query(
    `SELECT (SELECT count(*)::int FROM payments) AS p, (SELECT count(*)::int FROM credit_note_allocations) AS a`)).rows[0];

  beforeAll(async () => {
    db = await freshDb('credit_alloc');
    c = new Client({ connectionString: db.url });
    await c.connect();
    // محاكاة Supabase: أدوار الوصول المباشر، وصلاحيّاتٌ افتراضيّة تمنحها كلّ جدولٍ جديد
    await c.query(`DO $r$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
    END $r$`);
    await c.query('GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role');
    await c.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role');

    // الجداول القائمة كما يبنيها الكود، ثمّ الجدول الجديد من الهجرة وحدها
    const boot = new DataSource({ type: 'postgres', url: db.url, entities: ENTITIES.filter((e) => e !== CreditAllocation), synchronize: true });
    await boot.initialize();
    await boot.destroy();
    await c.query(UP);

    ds = new DataSource({ type: 'postgres', url: db.url, entities: ENTITIES, synchronize: false });
    await ds.initialize();
    svc = new PaymentsService(ds.getRepository(Payment), ds);

    id.sup = (await c.query(`INSERT INTO suppliers (name) VALUES ('UNIMARS LAS PALMAS') RETURNING id`)).rows[0].id;
    id.sup2 = (await c.query(`INSERT INTO suppliers (name) VALUES ('Other Supplier') RETURNING id`)).rows[0].id;
    id.vessel = (await c.query(`INSERT INTO vessels (name) VALUES ('Gubal Trader') RETURNING id`)).rows[0].id;
    await inv('cn', 'ALG/26-00448', -401.67);
    await inv('a', 'ALG/26-01292', 3526.07);
    await inv('b', 'ALG/26-01293', 400);
    await inv('c', 'ALG/26-01294', 268.33);
    await inv('d', 'ALG/26-01295', 200);
    await inv('usd', 'ALG/26-USD', 100, id.sup, 'USD');
    await inv('other', 'OTH-1', 500, id.sup2);
    await inv('otherCn', 'OTH-CN', -50, id.sup2);
  });
  afterAll(async () => { await ds?.destroy(); await c?.end(); await db?.drop(); });

  it('الهجرة متكرّرة الأمان، والكيان يطابق الجدول فلا يقترح synchronize أيّ تعديل', async () => {
    await expect(c.query(UP)).resolves.toBeDefined();
    const cons = (await c.query(`SELECT conname FROM pg_constraint WHERE conrelid = 'credit_note_allocations'::regclass AND contype IN ('c','f') ORDER BY 1`)).rows.map((r) => r.conname);
    expect(cons).toEqual(['credit_note_allocations_amount_chk', 'credit_note_allocations_credit_note_fk', 'credit_note_allocations_distinct_chk', 'credit_note_allocations_invoice_fk']);
    const pending = (await ds.driver.createSchemaBuilder().log()).upQueries.map((q) => q.query).filter((q) => /credit_note_allocations/.test(q));
    expect(pending).toEqual([]);
  });

  it('RLS مفعّلة بلا FORCE، ولا صلاحيّة لأدوار الوصول المباشر', async () => {
    const r = (await c.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'credit_note_allocations'::regclass`)).rows[0];
    expect(r).toEqual({ relrowsecurity: true, relforcerowsecurity: false });
    const grants = (await c.query(`SELECT grantee FROM information_schema.role_table_grants WHERE table_name = 'credit_note_allocations' AND grantee IN ('anon','authenticated','service_role','PUBLIC')`)).rows;
    expect(grants).toEqual([]);
  });

  it('حالة المالك: الإشعار يُخصم من التحويل، فتُغلق الفواتير الأربع ويُستنفد الإشعار', async () => {
    const res = await svc.createBatch({
      supplier_id: id.sup, payment_date: '2026-10-06', reference: 'TRF-1',
      lines: [
        { invoice_id: id.a, amount: 3124.40 }, { invoice_id: id.b, amount: 400 },
        { invoice_id: id.c, amount: 268.33 }, { invoice_id: id.d, amount: 200 },
      ],
      credits: [{ credit_note_id: id.cn, invoice_id: id.a, amount: 401.67 }],
    }, 'tester');
    expect(res.transfer).toEqual({ EUR: 3992.73 });
    for (const k of ['a', 'b', 'c', 'd']) expect(await state(k)).toMatchObject({ status: 'paid' });
    expect(await state('a')).toEqual({ paid: 3526.07, status: 'paid' });
    expect(await state('cn')).toEqual({ paid: -401.67, status: 'paid' });
    // البنك يرى ما حُوّل وحده — السدادات النقديّة مجموعها مبلغ التحويل
    const cash = (await c.query(`SELECT SUM(amount)::float AS s, count(*)::int AS n FROM payments`)).rows[0];
    expect(cash).toEqual({ s: 3992.73, n: 4 });
    const al = (await c.query(`SELECT amount::float, currency, batch_ref, created_by FROM credit_note_allocations`)).rows;
    expect(al).toEqual([{ amount: 401.67, currency: 'EUR', batch_ref: res.batch_ref, created_by: 'tester' }]);
  });

  it('الإشعار المستنفَد لا يُطبَّق ثانيةً، والفاتورة المغلقة بالإشعار لا تقبل سداداً زائداً', async () => {
    await c.query(`UPDATE invoices SET total_amount = 4000 WHERE id = $1`, [id.b]);   // فاتورةٌ فيها متبقٍّ ليُختبر الإشعار وحده
    const before = await counts();
    await expect(svc.createBatch({
      supplier_id: id.sup, payment_date: '2026-10-07',
      lines: [{ invoice_id: id.b, amount: 0 }],
      credits: [{ credit_note_id: id.cn, invoice_id: id.b, amount: 1 }],
    })).rejects.toThrow(/أكبر من رصيده المتبقّي \(0\)/);
    await expect(svc.create({ invoice_id: id.a, amount: 1, currency: 'EUR', payment_date: '2026-10-07' } as any)).rejects.toThrow();
    expect(await counts()).toEqual(before);
    await c.query(`UPDATE invoices SET total_amount = 400 WHERE id = $1`, [id.b]);
  });

  it('الدفعة ذرّيّة: سطرٌ واحدٌ مخالف يُسقطها كلّها فلا سداد ولا تطبيق يُكتب', async () => {
    await inv('e', 'ALG/26-01296', 1000);
    await inv('cn2', 'ALG/26-00500', -100);
    const before = await counts();
    await expect(svc.createBatch({
      supplier_id: id.sup, payment_date: '2026-10-07',
      lines: [{ invoice_id: id.e, amount: 500 }, { invoice_id: id.d, amount: 1 }],   // d مسدَّدةٌ كاملةً
      credits: [{ credit_note_id: id.cn2, invoice_id: id.e, amount: 100 }],
    })).rejects.toThrow(/ALG\/26-01295.*يتجاوز إجماليّها/);
    expect(await counts()).toEqual(before);
    expect(await state('e')).toEqual({ paid: 0, status: 'unpaid' });
    expect(await state('cn2')).toEqual({ paid: 0, status: 'unpaid' });
  });

  it('يُرفض: مورّدٌ آخر، عملةٌ مخالفة، إشعارٌ يُسدَّد نقداً، إشعارٌ على فاتورةٍ خارج الدفعة', async () => {
    const base = { supplier_id: id.sup, payment_date: '2026-10-07' };
    await expect(svc.createBatch({ ...base, lines: [{ invoice_id: id.other, amount: 10 }] })).rejects.toThrow(/لمورّدٍ آخر/);
    await expect(svc.createBatch({ ...base, lines: [{ invoice_id: id.e, amount: 0 }], credits: [{ credit_note_id: id.otherCn, invoice_id: id.e, amount: 10 }] })).rejects.toThrow(/لمورّدٍ آخر/);
    await expect(svc.createBatch({ ...base, lines: [{ invoice_id: id.usd, amount: 0 }], credits: [{ credit_note_id: id.cn2, invoice_id: id.usd, amount: 10 }] })).rejects.toThrow(/لا تحويل عملات/);
    await expect(svc.createBatch({ ...base, lines: [{ invoice_id: id.cn2, amount: 10 }] })).rejects.toThrow(/إشعارٌ دائن — يُطبَّق على فاتورة/);
    await expect(svc.createBatch({ ...base, lines: [{ invoice_id: id.e, amount: 10 }], credits: [{ credit_note_id: id.cn2, invoice_id: id.usd, amount: 10 }] })).rejects.toThrow(/ليست في الدفعة/);
    await expect(svc.createBatch({ ...base, payment_date: '06/10/2026', lines: [{ invoice_id: id.e, amount: 10 }] })).rejects.toThrow(/YYYY-MM-DD/);
  });

  it('تطبيقٌ جزئيّ: الإشعار يُستعمل على دفعتين، والإشعار الجزئيّ «جزئيّ»', async () => {
    await svc.createBatch({ supplier_id: id.sup, payment_date: '2026-10-08', lines: [{ invoice_id: id.e, amount: 0 }], credits: [{ credit_note_id: id.cn2, invoice_id: id.e, amount: 60 }] });
    expect(await state('cn2')).toEqual({ paid: -60, status: 'partial' });
    expect(await state('e')).toEqual({ paid: 60, status: 'partial' });
    const r = await svc.createBatch({ supplier_id: id.sup, payment_date: '2026-10-09', lines: [{ invoice_id: id.e, amount: 900 }], credits: [{ credit_note_id: id.cn2, invoice_id: id.e, amount: 40 }] });
    expect(r.transfer).toEqual({ EUR: 900 });
    expect(await state('cn2')).toEqual({ paid: -100, status: 'paid' });
    expect(await state('e')).toEqual({ paid: 1000, status: 'paid' });
  });

  it('إجماليّات المركب والتدقيق يريان التطبيق سداداً بلا بقايا ولا إنذارٍ كاذب', async () => {
    const vs = new VesselsService(ds.getRepository(Vessel), ds.getRepository(Invoice));
    const eur = (await vs.getStats(id.vessel))!.totalsByCurrency.find((t: any) => t.currency === 'EUR')!;
    expect(eur.unevidencedResidual).toBe(0);
    expect(eur.creditApplied).toBe(0);   // ما طُبّق على الفواتير = ما طُبّق من الإشعارات، والمركب واحد
    const audit = await new AuditService(ds.getRepository(Invoice), ds.getRepository(Payment), ds.getRepository(CreditAllocation)).run();
    const ours = new Set([id.a, id.b, id.c, id.d, id.e, id.cn, id.cn2]);
    const noisy = audit.findings.filter((f: any) => ours.has(f.invoiceId) && f.ruleKey !== 'no_attachment' && f.severity !== 'informational' && f.severity !== 'low');
    expect(noisy.map((f: any) => `${f.invoiceNumber}:${f.ruleKey}`)).toEqual([]);
  });

  it('إعادة اشتقاق الفاتورة من خدمة الفواتير تحسب التطبيق، وحذفها محميّ برسالةٍ مفهومة', async () => {
    const isvc = new InvoicesService(ds.getRepository(Invoice), { delete: async () => undefined } as any);
    await c.query(`UPDATE invoices SET paid_amount = 0, status = 'unpaid' WHERE id = ANY($1)`, [[id.a, id.cn]]);
    await isvc.updatePaidAmount(id.a);
    await isvc.updatePaidAmount(id.cn);
    expect(await state('a')).toEqual({ paid: 3526.07, status: 'paid' });
    expect(await state('cn')).toEqual({ paid: -401.67, status: 'paid' });
    await expect(isvc.remove(id.cn)).rejects.toThrow(/ألغِ التطبيق/);
    await expect(c.query(`DELETE FROM invoices WHERE id = $1`, [id.cn])).rejects.toThrow(/credit_note_allocations_credit_note_fk/);
  });

  it('إلغاء التطبيق يعيد رصيد الإشعار ويعيد الفاتورة جزئيّة — والقاعدة ترفض المبلغ غير الموجب', async () => {
    const [a] = (await c.query(`SELECT id FROM credit_note_allocations WHERE credit_note_id = $1`, [id.cn])).rows;
    expect(await svc.removeAllocation(a.id)).toEqual({ deleted: true });
    expect(await state('a')).toEqual({ paid: 3124.40, status: 'partial' });
    expect(await state('cn')).toEqual({ paid: 0, status: 'unpaid' });
    expect(await svc.removeAllocation(a.id)).toEqual({ deleted: false });
    await expect(c.query(`INSERT INTO credit_note_allocations (credit_note_id, invoice_id, amount, currency, allocation_date) VALUES ($1,$2,0,'EUR','2026-10-06')`, [id.cn, id.a])).rejects.toThrow(/amount_chk/);
    await expect(c.query(`INSERT INTO credit_note_allocations (credit_note_id, invoice_id, amount, currency, allocation_date) VALUES ($1,$1,5,'EUR','2026-10-06')`, [id.cn])).rejects.toThrow(/distinct_chk/);
    const listed = await svc.listAllocations();
    expect(listed.every((x) => x.credit_note?.invoice_number && x.invoice?.supplier?.name)).toBe(true);
  });

  it('التراجع يرفض حذف جدولٍ فيه تطبيقات إلّا بإقرارٍ صريح، ثمّ يحذفه', async () => {
    await expect(c.query(DOWN)).rejects.toThrow(/GATE FAILED: credit_note_allocations فيه 2 صفّاً/);
    await c.query('ROLLBACK').catch(() => undefined);
    await c.query(`BEGIN; SET LOCAL credit_alloc.force_drop = 'yes'; ${DOWN.replace(/^BEGIN;$/m, '')}`);
    expect((await c.query(`SELECT to_regclass('public.credit_note_allocations') AS t`)).rows[0].t).toBeNull();
  });
});
