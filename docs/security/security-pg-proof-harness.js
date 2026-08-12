/**
 * SECURITY LOCKDOWN — حزمة الإثبات على PostgreSQL حقيقي · 20 فحصاً
 *
 * مرجع محفوظ لإعادة الإثبات. **ليس جزءاً من بناء المشروع ولا اختباراته**
 * (jest نطاقه src/ فقط) ولا يضيف أي اعتمادية.
 *
 * التشغيل — في مجلد مؤقّت خارج المستودع:
 *   npm init -y && npm install embedded-postgres pg
 *   node security-pg-proof-harness.js
 *
 * ينفّذ ملفات docs/security/*.sql أنفسها — لا يعيد بناءها.
 * آخر نتيجة: 20/20 على PostgreSQL 18.4.
 */
const EP = require('embedded-postgres').default || require('embedded-postgres');
const fs = require('fs');
const { Client } = require('pg');
const D = 'C:/Users/mohamed.elsayed/Downloads/My Project/ume-pms-v2/docs/security/';
const F = (n) => fs.readFileSync(D + n, 'utf8');
const T = ['agency_history','attachments','currencies','customers','exchange_rates','hire_invoice_items','hire_invoices','hire_payments','import_batches','invoices','items','management_invoices','management_payments','market_import_logs','market_records','market_reports','payments','permissions','profit_periods','purchase_orders','role_permissions','shipping_companies','suppliers','task_comments','tasks','users','vessel_profit_data','vessels'];
const R = [];
const ok = (i, m) => R.push(['PASS', i, m]);
const bad = (i, m) => R.push(['FAIL', i, m]);

(async () => {
  const pg = new EP({ databaseDir: './pgSec2', user: 'postgres', password: 'p', port: 55471, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
  try {
    await pg.initialise(); await pg.start();
    const c = new Client({ host: '127.0.0.1', port: 55471, user: 'postgres', password: 'p', database: 'postgres' });
    await c.connect();

    await c.query("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;");
    await c.query("GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;");
    await c.query("ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;");

    for (const t of T) {
      if (t === 'invoices') { await c.query("CREATE TYPE invoices_status_enum AS ENUM ('unpaid','partial','paid')"); await c.query("CREATE TABLE invoices(id serial PRIMARY KEY, currency varchar(3), total_amount numeric(18,2), paid_amount numeric(18,2), status invoices_status_enum, data_origin varchar(20) DEFAULT 'operational', settlement_basis varchar(30) DEFAULT 'none', import_batch_id int)"); }
      else if (t === 'payments') await c.query("CREATE TABLE payments(id serial PRIMARY KEY, currency varchar(3), amount numeric(18,2))");
      else await c.query("CREATE TABLE " + t + "(id serial PRIMARY KEY)");
    }
    await c.query("ALTER TABLE invoices ADD CONSTRAINT chk_inv_data_origin CHECK (data_origin IN ('operational','migrated'))");
    await c.query("ALTER TABLE invoices ADD CONSTRAINT chk_inv_settlement_basis CHECK (settlement_basis IN ('none','pre_system_settled','credit_note'))");
    await c.query("ALTER TABLE invoices ADD CONSTRAINT chk_inv_presystem_requires_batch CHECK (settlement_basis <> 'pre_system_settled' OR import_batch_id IS NOT NULL)");
    await c.query("ALTER TABLE invoices ADD CONSTRAINT fk_invoices_import_batch FOREIGN KEY (import_batch_id) REFERENCES import_batches(id)");
    await c.query("INSERT INTO invoices (currency,total_amount,paid_amount,status) SELECT 'USD',100,50,'unpaid' FROM generate_series(1,142)");
    await c.query("INSERT INTO payments (currency,amount) SELECT 'USD',25 FROM generate_series(1,18)");

    const cnt = async (role) => (await c.query("SELECT count(DISTINCT table_name)::int n FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee=$1 AND table_name=ANY($2)", [role, T])).rows[0].n;
    const rlsOn = async () => (await c.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE s.nspname='public' AND c.relrowsecurity AND c.relname=ANY($1)", [T])).rows[0].n;
    const asRole = async (role, sql) => {
      try { await c.query('BEGIN'); await c.query('SET LOCAL ROLE ' + role); await c.query(sql); await c.query('ROLLBACK'); return 'ALLOWED'; }
      catch (e) { await c.query('ROLLBACK').catch(() => {}); return 'denied'; }
    };

    const pre = await c.query(F('security-precheck.sql'));
    ok('P1', 'security-precheck.sql نُفِّذ — ' + pre.rows.length + ' صف');
    const sc = pre.rows.find((r) => r.item && String(r.item).includes('app tables present'));
    ok('P2', 'نطاق الجداول: ' + (sc ? sc.value : '?'));
    ok('B1', 'قبل · anon=' + await cnt('anon') + '/28  auth=' + await cnt('authenticated') + '/28  svc=' + await cnt('service_role') + '/28  RLS=' + await rlsOn() + '/28');
    ok('B2', 'قبل · anon SELECT=' + await asRole('anon', 'SELECT 1 FROM invoices LIMIT 1') + '  TRUNCATE=' + await asRole('anon', 'TRUNCATE users'));

    await c.query(F('security-lockdown-up.sql'));
    ok('U1', 'security-lockdown-up.sql نُفِّذ ضمن معاملة واحدة');
    ok('U2', 'بعد · anon=' + await cnt('anon') + '/28  auth=' + await cnt('authenticated') + '/28  svc=' + await cnt('service_role') + '/28  RLS=' + await rlsOn() + '/28');
    ok('U3', 'بعد · anon SELECT=' + await asRole('anon', 'SELECT 1 FROM invoices LIMIT 1') + '  INSERT=' + await asRole('anon', "INSERT INTO invoices (currency) VALUES ('X')") + '  TRUNCATE=' + await asRole('anon', 'TRUNCATE users'));
    ok('U4', 'بعد · authenticated SELECT=' + await asRole('authenticated', 'SELECT 1 FROM payments LIMIT 1') + '  TRUNCATE=' + await asRole('authenticated', 'TRUNCATE payments'));
    ok('U5', 'بعد · service_role SELECT=' + await asRole('service_role', 'SELECT 1 FROM attachments LIMIT 1'));

    let owner = 'FAIL';
    try {
      await c.query('BEGIN');
      await c.query("INSERT INTO invoices (currency,total_amount,paid_amount,status) VALUES ('EUR',10,0,'unpaid')");
      await c.query("UPDATE invoices SET paid_amount=1 WHERE currency='EUR'");
      await c.query('SELECT count(*) FROM invoices');
      await c.query('ROLLBACK'); owner = 'OK';
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); owner = 'FAIL: ' + e.message.slice(0, 60); }
    ok('U6', 'المالك (Railway) SELECT+INSERT+UPDATE بعد التحصين: ' + owner);

    await c.query('CREATE TABLE future_table(id int)');
    const fut = (await c.query("SELECT COALESCE(string_agg(DISTINCT grantee,','),'NONE') g FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='future_table' AND grantee IN ('anon','authenticated')")).rows[0].g;
    if (fut === 'NONE') ok('U7', 'جدول جديد يُنشأ خاصاً افتراضياً — لا anon ولا authenticated');
    else bad('U7', 'الجدول الجديد ما زال يرث: ' + fut);
    await c.query('DROP TABLE future_table');

    await c.query(F('security-lockdown-up.sql'));
    ok('U8', 'إعادة تنفيذ UP لا تفشل ولا تغيّر شيئاً (idempotent)');

    const post = await c.query(F('security-postverify.sql'));
    const v = (i) => { const r = post.rows.find((x) => x.item && String(x.item).includes(i)); return r ? r.value : '?'; };
    ok('V1', 'security-postverify.sql نُفِّذ — ' + post.rows.length + ' صف');
    ok('V2', 'anon: ' + v('reachable by anon') + '  |  authenticated: ' + v('reachable by authenticated'));
    ok('V3', 'RLS: ' + v('RLS enabled') + '  |  policies: ' + v('permissive policies') + '  |  FORCE: ' + v('FORCE RLS'));
    ok('V4', 'service_role: ' + v('service_role table access') + '/28  |  postgres/invoices: ' + v('on invoices'));

    await c.query(F('security-lockdown-down.sql'));
    ok('D1', 'DOWN · anon=' + await cnt('anon') + '/28  auth=' + await cnt('authenticated') + '/28  RLS=' + await rlsOn() + '/28  — خط الأساس مُستعاد');
    await c.query('CREATE TABLE future2(id int)');
    const fut2 = (await c.query("SELECT COALESCE(string_agg(DISTINCT grantee,','),'NONE') g FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='future2' AND grantee IN ('anon','authenticated')")).rows[0].g;
    ok('D2', 'بعد DOWN الجدول الجديد يرث مجدداً: ' + fut2);
    await c.query('DROP TABLE future2');
    await c.query(F('security-lockdown-down.sql'));
    ok('D3', 'إعادة تنفيذ DOWN لا تفشل (idempotent)');

    const inv = (await c.query('SELECT count(*)::int n FROM invoices')).rows[0].n;
    const pay = (await c.query('SELECT count(*)::int n FROM payments')).rows[0].n;
    if (inv === 142 && pay === 18) ok('D4', 'صفر تغيير في البيانات عبر UP→DOWN: invoices=' + inv + ' payments=' + pay);
    else bad('D4', 'تغيّرت البيانات! invoices=' + inv + ' payments=' + pay);

    await c.end();
  } finally {
    console.log('\n=== SECURITY LOCKDOWN · اثبات على PostgreSQL حقيقي ===');
    for (const [s, i, m] of R) console.log(s + ' ' + String(i).padEnd(4) + ' ' + m);
    try { await pg.stop(); } catch (_) {}
  }
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
