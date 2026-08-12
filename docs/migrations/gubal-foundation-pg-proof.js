/**
 * أساس Gubal — حزمة الإثبات على PostgreSQL حقيقي
 *
 * ينفّذ ملفَّي SQL أنفسهما من docs/migrations — لا يعيد بناءهما.
 * **ليس جزءاً من بناء المشروع ولا من مجموعة اختباراته** ولا يضيف اعتمادية.
 *
 * التشغيل — في مجلد مؤقّت خارج المستودع:
 *   npm init -y && npm install embedded-postgres pg
 *   node gubal-foundation-pg-proof.js
 */
const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const REPO = 'C:/Users/mohamed.elsayed/Downloads/My Project/ume-pms-v2';
const P11A_UP = fs.readFileSync(path.join(REPO, 'docs/migrations/p11a-accounting-foundation-up.sql'), 'utf8');
const UP = fs.readFileSync(path.join(REPO, 'docs/migrations/gubal-foundation-up.sql'), 'utf8');
const DOWN = fs.readFileSync(path.join(REPO, 'docs/migrations/gubal-foundation-down.sql'), 'utf8');

let pass = 0, fail = 0;
const results = [];
const ok = (id, m) => { pass++; results.push(['PASS', id, m]); };
const bad = (id, m, x) => { fail++; results.push(['FAIL', id, m + (x ? ' :: ' + x : '')]); };

async function expectErr(c, id, sql, re, msg) {
  try {
    await c.query('BEGIN'); await c.query(sql); await c.query('COMMIT');
    bad(id, msg, 'لم يُرفض');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    if (re && !re.test(e.message)) bad(id, msg, 'رُفض برسالة أخرى: ' + e.message.slice(0, 140));
    else ok(id, msg);
  }
}
async function expectOk(c, id, sql, msg) {
  try { await c.query(sql); ok(id, msg); }
  catch (e) { bad(id, msg, e.message.slice(0, 140)); }
}
async function one(c, sql) { return (await c.query(sql)).rows[0]; }

(async () => {
  const dir = path.join(process.cwd(), 'pgdata-gubal');
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'p', password: 'p', port: 55440, persistent: false });
  let c;
  try {
    await pg.initialise(); await pg.start();
    // العنقود يرث ترميز نظام التشغيل (WIN1256 على ويندوز العربي) ولا يقبل محارف
    // الرسم في تعليقات SQL. القاعدة تُنشأ بـUTF8 صراحةً كما هو حال الإنتاج.
    {
      const boot = new Client({ host: 'localhost', port: 55440, user: 'p', password: 'p', database: 'postgres' });
      await boot.connect();
      await boot.query(`CREATE DATABASE proof ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
      await boot.end();
    }
    c = new Client({ host: 'localhost', port: 55440, user: 'p', password: 'p', database: 'proof' });
    await c.connect();

    // الأساس المحاسبي أولاً — الهجرة الجديدة تبني فوقه.
    await c.query(P11A_UP);
    // جدول فواتير مُصغَّر: المفتاح الخارجي للاستلام يحتاج مرجعاً حقيقياً.
    await c.query(`CREATE TABLE invoices (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), invoice_number VARCHAR(100))`);

    await expectOk(c, 'M1', UP, 'هجرة UP تُنفَّذ كاملة');
    await expectOk(c, 'M2', UP, 'UP تُعاد بلا خطأ — idempotent');

    // ── بذور ──
    await c.query(`INSERT INTO legal_entities (id, code, name, functional_currency, accounting_start_date)
                   VALUES ('11111111-1111-1111-1111-111111111111','SIV','Sivamar','EUR','2026-01-01')`);
    await c.query(`INSERT INTO invoices (id, invoice_number) VALUES ('22222222-2222-2222-2222-222222222222','INV-1')`);
    const LE = "'11111111-1111-1111-1111-111111111111'";
    const INV = "'22222222-2222-2222-2222-222222222222'";
    const U1 = "'aaaaaaaa-0000-0000-0000-000000000001'";
    const U2 = "'aaaaaaaa-0000-0000-0000-000000000002'";

    // ── 1 · ضوابط الاعتماد ──
    await expectOk(c, 'F1',
      `INSERT INTO accounting_fx_rates (legal_entity_id,currency_from,currency_to,rate,rate_date,source,created_by)
       VALUES (${LE},'USD','EUR',0.87,'2026-07-17','ECB',${U1})`,
      'سعر ECB يُنشأ مسوّدة بلا اعتماد');

    await expectOk(c, 'F2',
      `INSERT INTO accounting_fx_rates (legal_entity_id,currency_from,currency_to,rate,rate_date,source,created_by)
       VALUES (${LE},'USD','EUR',0.88,'2026-07-18','MANUAL_APPROVED',${U1})`,
      'سعر يدوي يُنشأ مسوّدة — القيد القديم كان يمنعه');

    await expectErr(c, 'F3',
      `INSERT INTO accounting_fx_rates (legal_entity_id,currency_from,currency_to,rate,rate_date,source,created_by,approved_by)
       VALUES (${LE},'USD','EUR',0.89,'2026-07-19','ECB',${U1},${U2})`,
      /chk_fx_approval_pairing/, 'معتمِد بلا ختم زمني مرفوض');

    await expectErr(c, 'F4',
      `INSERT INTO accounting_fx_rates (legal_entity_id,currency_from,currency_to,rate,rate_date,source,created_by,approved_by,approved_at)
       VALUES (${LE},'USD','EUR',0.90,'2026-07-20','ECB',${U1},${U1},now())`,
      /chk_fx_no_self_approval/, 'اعتماد ذاتي مرفوض على مستوى قاعدة البيانات');

    await expectOk(c, 'F5',
      `UPDATE accounting_fx_rates SET approved_by=${U2}, approved_at=now() WHERE rate_date='2026-07-17'`,
      'اعتماد من شخص آخر مقبول');

    await expectErr(c, 'F6',
      `UPDATE accounting_fx_rates SET approved_by=${U1} WHERE rate_date='2026-07-17'`,
      /chk_fx_no_self_approval/, 'تحويل الاعتماد للمُنشئ لاحقاً مرفوض');

    // ── 2 · عدم التعديل بعد الاستخدام ──
    await expectOk(c, 'I1',
      `UPDATE accounting_fx_rates SET rate = 0.871 WHERE rate_date='2026-07-17'`,
      'تعديل سعر غير مستخدَم مسموح');

    // قيد مُرحَّل يستند إلى السعر
    await c.query(`INSERT INTO journals (id,legal_entity_id,code,name,entry_prefix) VALUES ('33333333-3333-3333-3333-333333333333',${LE},'GJ','General','GJ')`);
    await c.query(`INSERT INTO fiscal_years (id,legal_entity_id,year,start_date,end_date) VALUES ('44444444-4444-4444-4444-444444444444',${LE},2026,'2026-01-01','2026-12-31')`);
    await c.query(`INSERT INTO fiscal_periods (id,legal_entity_id,fiscal_year_id,period_no,name,start_date,end_date,status) VALUES ('55555555-5555-5555-5555-555555555555',${LE},'44444444-4444-4444-4444-444444444444',7,'July','2026-07-01','2026-07-31','open')`);
    await c.query(`INSERT INTO accounting_accounts (id,legal_entity_id,code,name,account_type,normal_balance) VALUES ('66666666-6666-6666-6666-666666666666',${LE},'5040','R&M','expense','debit')`);
    await c.query(`INSERT INTO accounting_accounts (id,legal_entity_id,code,name,account_type,normal_balance) VALUES ('77777777-7777-7777-7777-777777777777',${LE},'2010','AP','liability','credit')`);
    const fxId = (await one(c, `SELECT id FROM accounting_fx_rates WHERE rate_date='2026-07-17'`)).id;

    await c.query(`INSERT INTO journal_entries (id,legal_entity_id,journal_id,fiscal_year_id,fiscal_period_id,entry_no,status,accounting_event_type,source_document_date,accounting_date,description,total_debit_eur,total_credit_eur)
      VALUES ('88888888-8888-8888-8888-888888888888',${LE},'33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444','55555555-5555-5555-5555-555555555555','GJ-2026-00001','draft','invoice_accrual','2026-07-17','2026-07-17','proof',87.10,87.10)`);
    await c.query(`INSERT INTO journal_lines (entry_id,line_no,account_id,debit,credit,transaction_currency,fx_rate,fx_date,fx_source,fx_rate_id,debit_eur,credit_eur)
      VALUES ('88888888-8888-8888-8888-888888888888',1,'66666666-6666-6666-6666-666666666666',100,0,'USD',0.871,'2026-07-17','ECB','${fxId}',87.10,0)`);
    await c.query(`INSERT INTO journal_lines (entry_id,line_no,account_id,debit,credit,transaction_currency,fx_rate,fx_date,fx_source,fx_rate_id,debit_eur,credit_eur)
      VALUES ('88888888-8888-8888-8888-888888888888',2,'77777777-7777-7777-7777-777777777777',0,87.10,'EUR',1,'2026-07-17','FUNCTIONAL',NULL,0,87.10)`);
    await c.query(`UPDATE journal_entries SET status='posted' WHERE id='88888888-8888-8888-8888-888888888888'`);

    await expectErr(c, 'I2', `UPDATE accounting_fx_rates SET rate=0.99 WHERE id='${fxId}'`,
      /لا يقبل تعديل/, 'تعديل قيمة سعر مستخدَم في قيد مُرحَّل مرفوض');
    await expectErr(c, 'I3', `UPDATE accounting_fx_rates SET rate_date='2026-07-18' WHERE id='${fxId}'`,
      /لا يقبل تعديل/, 'تعديل تاريخ سعر مستخدَم مرفوض');
    await expectErr(c, 'I4', `UPDATE accounting_fx_rates SET source='BANK' WHERE id='${fxId}'`,
      /لا يقبل تعديل/, 'تعديل مصدر سعر مستخدَم مرفوض');
    await expectErr(c, 'I5', `UPDATE accounting_fx_rates SET currency_from='SEK' WHERE id='${fxId}'`,
      /لا يقبل تعديل/, 'تعديل زوج العملات لسعر مستخدَم مرفوض');
    await expectErr(c, 'I6', `DELETE FROM accounting_fx_rates WHERE id='${fxId}'`,
      /لا يُحذف/, 'حذف سعر مستخدَم مرفوض');
    await expectOk(c, 'I7', `UPDATE accounting_fx_rates SET source_reference='ECB 2026-07-17' WHERE id='${fxId}'`,
      'تعديل مرجع المصدر (بيانات وصفية) مسموح');

    // القيد يبقى مكتفياً بذاته
    const jl = await one(c, `SELECT fx_rate, debit_eur FROM journal_lines WHERE entry_id='88888888-8888-8888-8888-888888888888' AND line_no=1`);
    if (Number(jl.fx_rate) === 0.871 && Number(jl.debit_eur) === 87.10) ok('I8', 'سطر القيد يحتفظ بالسعر والقيمة منسوخين — مكتفٍ بذاته');
    else bad('I8', 'سطر القيد فقد اكتفاءه الذاتي', JSON.stringify(jl));

    // ── 3 · تقييد 1010 ──
    await expectOk(c, 'B1',
      `INSERT INTO accounting_accounts (legal_entity_id,code,name,account_type,normal_balance) VALUES (${LE},'1010','Bank — EUR','asset','debit')`,
      'إنشاء 1010 للاختبار');
    await expectOk(c, 'B2', UP, 'إعادة UP تضبط قيد العملة على 1010');
    const r1010 = await one(c, `SELECT currency_restriction FROM accounting_accounts WHERE code='1010'`);
    if (r1010.currency_restriction === 'EUR') ok('B3', 'currency_restriction = EUR على الحساب 1010');
    else bad('B3', 'لم يُضبط قيد العملة', String(r1010.currency_restriction));

    // ── 4 · جدول الاستلام ──
    await expectOk(c, 'R1',
      `INSERT INTO goods_service_receipts (invoice_id,receipt_type,received_date,received_by,reference) VALUES (${INV},'GOODS_RECEIVED','2026-07-20',${U1},'GRN-1')`,
      'تسجيل واقعة استلام سلع');
    await expectOk(c, 'R2',
      `INSERT INTO goods_service_receipts (invoice_id,receipt_type,received_date,is_partial) VALUES (${INV},'GOODS_RECEIVED','2026-07-25',true)`,
      'استلام جزئي ثانٍ لنفس الفاتورة — التعدّد مدعوم');
    await expectOk(c, 'R3',
      `INSERT INTO goods_service_receipts (invoice_id,receipt_type,received_date) VALUES (${INV},'SERVICE_CONFIRMED','2026-07-26')`,
      'تأكيد خدمة');
    await expectOk(c, 'R4',
      `INSERT INTO goods_service_receipts (invoice_id,receipt_type,received_date) VALUES (${INV},'MANAGEMENT_RECEIPT_CONFIRMATION','2026-07-27')`,
      'إقرار استلام إداري');
    await expectErr(c, 'R5',
      `INSERT INTO goods_service_receipts (invoice_id,receipt_type,received_date) VALUES (${INV},'WHATEVER','2026-07-28')`,
      /chk_receipt_type/, 'نوع استلام غير معروف مرفوض');
    await expectErr(c, 'R6',
      `INSERT INTO goods_service_receipts (invoice_id,receipt_type,received_date) VALUES ('99999999-9999-9999-9999-999999999999','GOODS_RECEIVED','2026-07-28')`,
      /fk_receipt_invoice/, 'استلام لفاتورة غير موجودة مرفوض');
    await expectErr(c, 'R7',
      `UPDATE goods_service_receipts SET received_date='2026-08-01' WHERE reference='GRN-1'`,
      /لا تُعدَّل/, 'تعديل تاريخ واقعة استلام مرفوض');
    await expectErr(c, 'R8',
      `DELETE FROM goods_service_receipts WHERE reference='GRN-1'`,
      /لا تُحذف/, 'حذف واقعة استلام مرفوض');
    await expectOk(c, 'R9',
      `UPDATE goods_service_receipts SET notes='مراجَع' WHERE reference='GRN-1'`,
      'تعديل الملاحظات وحدها مسموح');
    await expectErr(c, 'R10',
      `DELETE FROM invoices WHERE id=${INV}`,
      /fk_receipt_invoice/, 'حذف فاتورة لها وقائع استلام مرفوض (RESTRICT)');

    const rls = await one(c, `SELECT relrowsecurity FROM pg_class WHERE relname='goods_service_receipts'`);
    if (rls.relrowsecurity) ok('R11', 'RLS مفعَّل على جدول الاستلام');
    else bad('R11', 'RLS غير مفعَّل');

    const cnt = await one(c, `SELECT COUNT(*)::int n FROM goods_service_receipts WHERE invoice_id=${INV}`);
    if (cnt.n === 4) ok('R12', 'أربع وقائع لفاتورة واحدة — الاستلام المتعدّد والمتجزّئ يعمل');
    else bad('R12', 'عدد الوقائع غير متوقّع', String(cnt.n));

    // ── 5 · التراجع ──
    // القيد المُرحَّل يبقى مُرحَّلاً — محاولة فكّه تُرفض بحقّ، وليست جزءاً من التراجع.
    await expectErr(c, 'D0', `UPDATE journal_entries SET status='draft' WHERE id='88888888-8888-8888-8888-888888888888'`,
      /لا يقبل أي تعديل/, 'فكّ ترحيل قيد مرفوض — التراجع لا يمرّ من هنا');

    // التراجع يتوقّف ما دام سعر يدوي مسوّدة قائماً — لا يمحو ولا يُضعف القيد بصمت.
    await expectErr(c, 'D1', DOWN, /التراجع متوقّف/, 'DOWN يتوقّف بوضوح بوجود سعر يدوي مسوّدة');
    await expectOk(c, 'D2', `DELETE FROM accounting_fx_rates WHERE source='MANUAL_APPROVED' AND approved_by IS NULL`,
      'حذف السعر اليدوي المسوّدة (غير مستخدَم في أي قيد)');
    await expectOk(c, 'D2b', DOWN, 'هجرة DOWN تُنفَّذ كاملة بعد رفع المانع');
    const gone = await one(c, `SELECT COUNT(*)::int n FROM information_schema.tables WHERE table_name='goods_service_receipts'`);
    if (gone.n === 0) ok('D3', 'جدول الاستلام أُسقط');
    else bad('D3', 'الجدول باقٍ بعد التراجع');
    const back = await one(c, `SELECT COUNT(*)::int n FROM pg_constraint WHERE conname='chk_fx_manual_approved'`);
    if (back.n === 1) ok('D4', 'القيد الأصلي chk_fx_manual_approved أُعيد — التراجع يعيد الحالة');
    else bad('D4', 'القيد الأصلي لم يُعَد');
    const r2 = await one(c, `SELECT currency_restriction FROM accounting_accounts WHERE code='1010'`);
    if (r2.currency_restriction === null) ok('D5', 'قيد عملة 1010 أُزيل');
    else bad('D5', 'قيد العملة باقٍ', String(r2.currency_restriction));
    const trg = await one(c, `SELECT COUNT(*)::int n FROM pg_trigger WHERE tgname='trg_fx_immutable'`);
    if (trg.n === 0) ok('D6', 'مشغّل عدم التعديل أُسقط');
    else bad('D6', 'المشغّل باقٍ');
    const kept = await one(c, `SELECT COUNT(*)::int n FROM journal_lines`);
    if (kept.n === 2) ok('D7', 'أسطر القيد باقية — التراجع لا يمسّ بيانات محاسبية');
    else bad('D7', 'فُقدت أسطر', String(kept.n));
  } catch (e) {
    bad('X', 'انهيار الحزمة', e.message);
  } finally {
    // النتائج تُطبع قبل الإغلاق — وإلا ضاعت إن تعثّر الإيقاف.
    for (const [s, id, m] of results) console.log(`${s}  ${id.padEnd(4)} ${m}`);
    console.log(`\nPASS ${pass} · FAIL ${fail}`);
    if (c) await c.end().catch(() => {});
    await pg.stop().catch(() => {});
    process.exit(fail ? 1 : 0);
  }
})();
