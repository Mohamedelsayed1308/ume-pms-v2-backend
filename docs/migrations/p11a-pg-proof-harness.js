/**
 * P1.1A — حزمة الإثبات على PostgreSQL حقيقي · 87 فحصاً
 *
 * مرجع محفوظ لإعادة الإثبات عند أي تعديل على الهجرة. **ليس جزءاً من بناء المشروع
 * ولا من مجموعة اختباراته** (jest نطاقه src/ فقط) ولا يضيف أي اعتمادية.
 *
 * التشغيل — في مجلد مؤقّت خارج المستودع:
 *   npm init -y && npm install embedded-postgres pg
 *   node p11a-pg-proof-harness.js
 *
 * ينفّذ ملفَّي SQL أنفسهما من docs/migrations — لا يعيد بناءهما.
 * آخر نتيجة: PASS 87 · FAIL 0 على PostgreSQL 18.4.
 */
const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const REPO = 'C:/Users/mohamed.elsayed/Downloads/My Project/ume-pms-v2';
const UP = fs.readFileSync(path.join(REPO, 'docs/migrations/p11a-accounting-foundation-up.sql'), 'utf8');
const DOWN = fs.readFileSync(path.join(REPO, 'docs/migrations/p11a-accounting-foundation-down.sql'), 'utf8');

let pass = 0, fail = 0;
const results = [];
function ok(id, msg) { pass++; results.push(['PASS', id, msg]); }
function bad(id, msg, extra) { fail++; results.push(['FAIL', id, msg + (extra ? ' :: ' + extra : '')]); }

async function expectErr(c, id, sql, re, msg) {
  try {
    await c.query('BEGIN');
    await c.query(sql);
    await c.query('COMMIT');
    bad(id, msg, 'لم يُرفض — العملية نجحت');
    await c.query('ROLLBACK').catch(() => {});
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    if (re && !re.test(e.message)) bad(id, msg, 'رُفض برسالة أخرى: ' + e.message.slice(0, 120));
    else ok(id, msg);
  }
}
async function expectOk(c, id, sql, msg) {
  try {
    await c.query('BEGIN'); await c.query(sql); await c.query('COMMIT');
    ok(id, msg);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    bad(id, msg, e.message.slice(0, 160));
  }
}

const U = (n) => `'00000000-0000-4000-8000-${String(n).padStart(12, '0')}'::uuid`;
const LE = U(1), JR = U(2), FY = U(3), P3 = U(4), P4 = U(5), P5 = U(6), P6 = U(7);
const A1 = U(11), A2 = U(12), A3 = U(13), FX1 = U(21), CC1 = U(31), LE2 = U(41);

(async () => {
  const pg = new EmbeddedPostgres({
    databaseDir: './pgdata2', user: 'p11a', password: 'p11a', port: 55433, persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });
  await pg.initialise(); await pg.start();
  const c = new Client({ host: '127.0.0.1', port: 55433, user: 'p11a', password: 'p11a', database: 'postgres' });
  await c.connect();
  const _q=c.query.bind(c); let LAST=''; c.query=(a,b)=>{ if(typeof a==='string') LAST=a.trim().slice(0,90); return _q(a,b); }; global.__last=()=>LAST;

  // ── محاكاة جداول الأعمال القائمة قبل الهجرة ───────────────────────────────
  await c.query(`
    CREATE TABLE invoices (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), total NUMERIC(18,2), data_origin VARCHAR(20) DEFAULT 'operational');
    CREATE TABLE payments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), amount NUMERIC(18,2));
    CREATE TABLE suppliers (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT);
    CREATE TABLE vessels (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT);
    CREATE TABLE users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), role TEXT, allowed_screens JSONB);
    INSERT INTO invoices (total) SELECT 100 FROM generate_series(1,230);
    INSERT INTO payments (amount) SELECT 50 FROM generate_series(1,18);
    INSERT INTO suppliers (name) SELECT 's' FROM generate_series(1,74);
    INSERT INTO vessels (name) SELECT 'v' FROM generate_series(1,7);
    INSERT INTO users (role) SELECT 'user' FROM generate_series(1,5);
  `);

  const snap = async () => ({
    tables: (await c.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1`)).rows.map(r => r.tablename),
    cols: (await c.query(`SELECT table_name||'.'||column_name||':'||data_type AS c FROM information_schema.columns WHERE table_schema='public' ORDER BY 1`)).rows.map(r => r.c),
    counts: (await c.query(`SELECT (SELECT count(*) FROM invoices) i,(SELECT count(*) FROM payments) p,(SELECT count(*) FROM suppliers) s,(SELECT count(*) FROM vessels) v,(SELECT count(*) FROM users) u`)).rows[0],
  });
  const before = await snap();

  // ═══ 1 · SCOPE ══════════════════════════════════════════════════════════
  await c.query(UP);
  const after = await snap();
  const added = after.tables.filter(t => !before.tables.includes(t));
  const removed = before.tables.filter(t => !after.tables.includes(t));
  const EXPECT9 = ['accounting_accounts','accounting_fx_rates','cost_centers','fiscal_periods','fiscal_years','journal_entries','journal_lines','journals','legal_entities'];
  added.sort();
  JSON.stringify(added) === JSON.stringify(EXPECT9)
    ? ok('S1', 'UP أنشأ 9 جداول بالضبط، هي المتوقَّعة') : bad('S1', 'الجداول المُنشأة', JSON.stringify(added));
  removed.length === 0 ? ok('S2', 'لم يُحذف أي جدول قائم') : bad('S2', 'حُذف', JSON.stringify(removed));

  const bizCols = (s) => s.cols.filter(x => /^(invoices|payments|suppliers|vessels|users)\./.test(x));
  JSON.stringify(bizCols(before)) === JSON.stringify(bizCols(after))
    ? ok('S3', 'أعمدة جداول الأعمال لم تتغيّر إطلاقاً') : bad('S3', 'تغيّرت أعمدة جداول الأعمال');
  JSON.stringify(before.counts) === JSON.stringify(after.counts)
    ? ok('S4', 'عدد صفوف جداول الأعمال لم يتغيّر (لا UPDATE ولا DELETE ولا backfill)') : bad('S4', 'تغيّرت الأعداد');

  const bizConstraints = await c.query(`SELECT count(*)::int n FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid WHERE cl.relname IN ('invoices','payments','suppliers','vessels','users')`);
  const jeRows = await c.query(`SELECT (SELECT count(*)::int FROM journal_entries) e,(SELECT count(*)::int FROM journal_lines) l,(SELECT count(*)::int FROM accounting_accounts) a`);
  (jeRows.rows[0].e === 0 && jeRows.rows[0].l === 0 && jeRows.rows[0].a === 0)
    ? ok('S5', 'الجداول المحاسبية فارغة تماماً بعد UP — صفر بيانات مالية') : bad('S5', 'ليست فارغة');

  // ── تعليمة UP مرتين: متكرّرة الأمان ──
  try { await c.query(UP); ok('S6', 'إعادة تنفيذ UP لا تفشل ولا تُغيّر شيئاً (idempotent)'); }
  catch (e) { bad('S6', 'إعادة التنفيذ فشلت', e.message.slice(0, 120)); }

  // ═══ 2 · FK DELETE BEHAVIOR ═════════════════════════════════════════════
  const fks = await c.query(`
    SELECT con.conname, cl.relname AS src, rf.relname AS tgt, con.confdeltype
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid=con.conrelid
    JOIN pg_class rf ON rf.oid=con.confrelid
    WHERE con.contype='f' AND cl.relname = ANY($1) ORDER BY 1`, [EXPECT9]);
  const cascades = fks.rows.filter(r => r.confdeltype === 'c').map(r => r.conname);
  const restricts = fks.rows.filter(r => r.confdeltype === 'r').map(r => r.conname);
  fks.rows.length === 18 ? ok('F0', `18 مفتاحاً خارجياً كما هو مُصمَّم`) : bad('F0', 'عدد المفاتيح', String(fks.rows.length));
  (cascades.length === 1 && cascades[0] === 'fk_jl_entry')
    ? ok('F1', 'CASCADE واحد فقط: fk_jl_entry — والباقي RESTRICT') : bad('F1', 'CASCADE غير متوقع', JSON.stringify(cascades));
  restricts.length === 17 ? ok('F2', '17 مفتاحاً بـRESTRICT — لا حذف تاريخ محاسبي بالتتالي') : bad('F2', 'عدد RESTRICT', String(restricts.length));

  // ── تجهيز البيانات ──
  await c.query(`
    INSERT INTO legal_entities (id,code,name,functional_currency,accounting_start_date) VALUES (${LE},'SIV','Sivamar','EUR','2026-01-01'),(${LE2},'X2','Other','EUR','2026-01-01');
    INSERT INTO journals (id,legal_entity_id,code,name,entry_prefix) VALUES (${JR},${LE},'GJ','General','GJ');
    INSERT INTO fiscal_years (id,legal_entity_id,year,start_date,end_date) VALUES (${FY},${LE},2026,'2026-01-01','2026-12-31');
    INSERT INTO fiscal_periods (id,legal_entity_id,fiscal_year_id,period_no,name,start_date,end_date,status) VALUES
      (${P3},${LE},${FY},3,'2026-03','2026-03-01','2026-03-31','open'),
      (${P4},${LE},${FY},4,'2026-04','2026-04-01','2026-04-30','open'),
      (${P5},${LE},${FY},5,'2026-05','2026-05-01','2026-05-31','soft_closed'),
      (${P6},${LE},${FY},6,'2026-06','2026-06-01','2026-06-30','hard_closed');
    INSERT INTO accounting_accounts (id,legal_entity_id,code,name,account_type,normal_balance) VALUES
      (${A1},${LE},'5000','Expense','expense','debit'),(${A2},${LE},'2000','AP','liability','credit'),(${A3},${LE},'1000','Bank','asset','debit');
    INSERT INTO accounting_fx_rates (id,legal_entity_id,currency_from,currency_to,rate,rate_date,source) VALUES (${FX1},${LE},'USD','EUR',0.9,'2026-03-10','ECB');
    INSERT INTO cost_centers (id,legal_entity_id,code,name) VALUES (${CC1},${LE},'CC1','Ops');
  `);

  let seq = 0;
  const mkEntry = async (opts = {}) => {
    const id = U(1000 + (++seq));
    const p = opts.period || P3, d = opts.date || '2026-03-15', evt = opts.evt || 'manual';
    const src = opts.src ? `'invoice',${opts.src}` : `NULL,NULL`;
    const amt = opts.amt ?? 100;
    await c.query(`INSERT INTO journal_entries (id,legal_entity_id,journal_id,fiscal_year_id,fiscal_period_id,status,accounting_event_type,source_document_date,accounting_date,description,source_type,source_id,total_debit_eur,total_credit_eur)
      VALUES (${id},${LE},${JR},${FY},${p},'draft','${evt}','${d}','${d}','t',${src},${amt},${amt})`);
    await c.query(`INSERT INTO journal_lines (entry_id,line_no,account_id,debit,credit,transaction_currency,fx_rate,fx_date,fx_source,debit_eur,credit_eur) VALUES
      (${id},1,${A1},${amt},0,'EUR',1,'${d}','FUNCTIONAL',${amt},0),
      (${id},2,${A2},0,${amt},'EUR',1,'${d}','FUNCTIONAL',0,${amt})`);
    if (opts.post !== false) await c.query(`UPDATE journal_entries SET status='posted', entry_no='GJ-2026-${String(seq).padStart(5,'0')}' WHERE id=${id}`);
    return id;
  };

  const E1 = await mkEntry();          // posted في فترة مفتوحة
  const D1 = await mkEntry({ post: false }); // مسوّدة

  await expectErr(c, 'F3', `DELETE FROM legal_entities WHERE id=${LE}`, /violates foreign key|RESTRICT/i, 'حذف الكيان القانوني وله تاريخ محاسبي → مرفوض');
  await expectErr(c, 'F4', `DELETE FROM journals WHERE id=${JR}`, /foreign key/i, 'حذف الدفتر → مرفوض');
  await expectErr(c, 'F5', `DELETE FROM fiscal_periods WHERE id=${P3}`, /foreign key/i, 'حذف الفترة → مرفوض');
  await expectErr(c, 'F6', `DELETE FROM fiscal_years WHERE id=${FY}`, /foreign key/i, 'حذف السنة المالية → مرفوض');
  await expectErr(c, 'F7', `DELETE FROM accounting_accounts WHERE id=${A1}`, /foreign key/i, 'حذف حساب مستخدَم في سطر → مرفوض');
  await expectOk (c, 'F8', `DELETE FROM cost_centers WHERE id=${CC1}`, 'حذف مركز تكلفة غير مستخدَم → مسموح (RESTRICT لا يمنع بلا مرجع)');
  await c.query(`INSERT INTO cost_centers (id,legal_entity_id,code,name) VALUES (${CC1},${LE},'CC1','Ops')`);

  // حذف المسوّدة يتتالى على أسطرها
  const before_l = (await c.query(`SELECT count(*)::int n FROM journal_lines WHERE entry_id=${D1}`)).rows[0].n;
  await expectOk(c, 'F9', `DELETE FROM journal_entries WHERE id=${D1}`, 'حذف مسوّدة → مسموح، وأسطرها تُحذف بالتتالي');
  const after_l = (await c.query(`SELECT count(*)::int n FROM journal_lines WHERE entry_id=${D1}`)).rows[0].n;
  (before_l === 2 && after_l === 0) ? ok('F10', 'CASCADE على أسطر المسوّدة يعمل — ولا أسطر يتيمة') : bad('F10', 'التتالي', `${before_l}→${after_l}`);

  // ═══ 3 · IMMUTABILITY ═══════════════════════════════════════════════════
  await expectErr(c, 'I1', `UPDATE journal_entries SET description='x' WHERE id=${E1}`, /لا يقبل أي تعديل/, 'تعديل وصف قيد مُرحَّل → مرفوض');
  await expectErr(c, 'I2', `UPDATE journal_entries SET journal_id=${JR} , reference='r' WHERE id=${E1}`, /لا يقبل أي تعديل/, 'تعديل journal_id → مرفوض');
  await expectErr(c, 'I3', `UPDATE journal_entries SET accounting_date='2026-03-20' WHERE id=${E1}`, /لا يقبل أي تعديل/, 'تعديل accounting_date → مرفوض');
  await expectErr(c, 'I4', `UPDATE journal_entries SET legal_entity_id=${LE2} WHERE id=${E1}`, /لا يقبل أي تعديل/, 'تعديل legal_entity_id → مرفوض');
  await expectErr(c, 'I5', `UPDATE journal_entries SET entry_no='HACK' WHERE id=${E1}`, /لا يقبل أي تعديل/, 'تعديل الرقم الرسمي → مرفوض');
  await expectErr(c, 'I6', `UPDATE journal_entries SET status='draft' WHERE id=${E1}`, /لا يقبل أي تعديل/, 'posted → draft → مرفوض');
  await expectErr(c, 'I7', `UPDATE journal_entries SET status='void' WHERE id=${E1}`, /لا يقبل أي تعديل/, 'posted → void → مرفوض');
  await expectErr(c, 'I8', `UPDATE journal_entries SET total_debit_eur=1, total_credit_eur=1 WHERE id=${E1}`, /لا يقبل أي تعديل/, 'تعديل الإجماليات → مرفوض');
  await expectErr(c, 'I9', `DELETE FROM journal_entries WHERE id=${E1}`, /لا يجوز حذف قيد مُرحَّل/, 'حذف قيد مُرحَّل → مرفوض');
  await expectErr(c, 'I10', `INSERT INTO journal_lines (entry_id,line_no,account_id,debit,credit,transaction_currency,fx_rate,fx_date,fx_source,debit_eur,credit_eur) VALUES (${E1},9,${A3},5,0,'EUR',1,'2026-03-15','FUNCTIONAL',5,0)`, /أسطر قيد مُرحَّل/, 'إدراج سطر في قيد مُرحَّل → مرفوض');
  await expectErr(c, 'I11', `UPDATE journal_lines SET debit=999, debit_eur=999 WHERE entry_id=${E1} AND line_no=1`, /أسطر قيد مُرحَّل/, 'تعديل سطر قيد مُرحَّل → مرفوض');
  await expectErr(c, 'I12', `DELETE FROM journal_lines WHERE entry_id=${E1}`, /أسطر قيد مُرحَّل/, 'حذف سطر قيد مُرحَّل → مرفوض');

  // العكس: قيد جديد + توسيم الأصل
  const R1 = U(2001);
  await expectOk(c, 'I13', `
    INSERT INTO journal_entries (id,legal_entity_id,journal_id,fiscal_year_id,fiscal_period_id,status,accounting_event_type,source_document_date,accounting_date,description,reversal_of_entry_id,total_debit_eur,total_credit_eur)
      VALUES (${R1},${LE},${JR},${FY},${P3},'draft','reversal','2026-03-15','2026-03-16','rev',${E1},100,100);
    INSERT INTO journal_lines (entry_id,line_no,account_id,debit,credit,transaction_currency,fx_rate,fx_date,fx_source,debit_eur,credit_eur) VALUES
      (${R1},1,${A1},0,100,'EUR',1,'2026-03-15','FUNCTIONAL',0,100),
      (${R1},2,${A2},100,0,'EUR',1,'2026-03-15','FUNCTIONAL',100,0);
    UPDATE journal_entries SET status='posted', entry_no='GJ-2026-09001' WHERE id=${R1};
    UPDATE journal_entries SET status='reversed', reversed_by_entry_id=${R1} WHERE id=${E1};
  `, 'العكس: قيد جديد يُرحَّل + توسيم الأصل reversed → مسموح (الاستثناء الوحيد)');

  const orig = (await c.query(`SELECT status, entry_no, total_debit_eur, accounting_date FROM journal_entries WHERE id=${E1}`)).rows[0];
  (orig.status === 'reversed' && orig.entry_no === 'GJ-2026-00001' && Number(orig.total_debit_eur) === 100)
    ? ok('I14', 'العكس لم يعدّل بيانات القيد الأصلي — غيّر حالته فقط') : bad('I14', 'تغيّر الأصل', JSON.stringify(orig));

  await expectErr(c, 'I15', `UPDATE journal_entries SET description='y' WHERE id=${E1}`, /لا يقبل أي تعديل/, 'تعديل قيد معكوس (reversed) → مرفوض');
  await expectErr(c, 'I16', `DELETE FROM journal_entries WHERE id=${E1}`, /لا يجوز حذف قيد مُرحَّل/, 'حذف قيد معكوس → مرفوض');
  await expectErr(c, 'I17', `UPDATE journal_entries SET status='reversed', reversed_by_entry_id=${R1}, description='sneak' WHERE id=${R1}`, /لا يقبل أي تعديل/, 'محاولة تهريب تعديل مع توسيم العكس → مرفوضة');

  const D2 = await mkEntry({ post: false });
  await expectOk(c, 'I18', `UPDATE journal_entries SET description='edited' WHERE id=${D2}`, 'تعديل مسوّدة → مسموح');
  await expectOk(c, 'I19', `UPDATE journal_lines SET description='x' WHERE entry_id=${D2}`, 'تعديل سطر مسوّدة → مسموح');

  // ═══ 4 · BALANCE ════════════════════════════════════════════════════════
  const B1 = U(3001);
  await expectErr(c, 'B1', `
    INSERT INTO journal_entries (id,legal_entity_id,journal_id,fiscal_year_id,fiscal_period_id,status,source_document_date,accounting_date,description,total_debit_eur,total_credit_eur)
      VALUES (${B1},${LE},${JR},${FY},${P3},'draft','2026-03-15','2026-03-15','t',40,40);
    INSERT INTO journal_lines (entry_id,line_no,account_id,debit,credit,transaction_currency,fx_rate,fx_date,fx_source,debit_eur,credit_eur) VALUES
      (${B1},1,${A1},30,0,'EUR',1,'2026-03-15','FUNCTIONAL',30,0),
      (${B1},2,${A2},0,40,'EUR',1,'2026-03-15','FUNCTIONAL',0,40);
    UPDATE journal_entries SET status='posted', entry_no='GJ-2026-08001' WHERE id=${B1};
  `, /غير متوازن|لا تطابق/, 'رأس متوازن فوق أسطر غير متوازنة → يُرفض عند COMMIT (المشغّل المؤجَّل)');

  const B2 = U(3002);
  await expectErr(c, 'B2', `
    INSERT INTO journal_entries (id,legal_entity_id,journal_id,fiscal_year_id,fiscal_period_id,status,source_document_date,accounting_date,description,total_debit_eur,total_credit_eur)
      VALUES (${B2},${LE},${JR},${FY},${P3},'draft','2026-03-15','2026-03-15','t',50,50);
    INSERT INTO journal_lines (entry_id,line_no,account_id,debit,credit,transaction_currency,fx_rate,fx_date,fx_source,debit_eur,credit_eur) VALUES
      (${B2},1,${A1},40,0,'EUR',1,'2026-03-15','FUNCTIONAL',40,0),
      (${B2},2,${A2},0,40,'EUR',1,'2026-03-15','FUNCTIONAL',0,40);
    UPDATE journal_entries SET status='posted', entry_no='GJ-2026-08002' WHERE id=${B2};
  `, /لا تطابق مجموع أسطره/, 'إجماليات الرأس ≠ مجموع الأسطر → يُرفض عند COMMIT');

  const B3 = U(3003);
  await expectErr(c, 'B3', `
    INSERT INTO journal_entries (id,legal_entity_id,journal_id,fiscal_year_id,fiscal_period_id,status,source_document_date,accounting_date,description,total_debit_eur,total_credit_eur)
      VALUES (${B3},${LE},${JR},${FY},${P3},'draft','2026-03-15','2026-03-15','t',10,10);
    INSERT INTO journal_lines (entry_id,line_no,account_id,debit,credit,transaction_currency,fx_rate,fx_date,fx_source,debit_eur,credit_eur) VALUES
      (${B3},1,${A1},10,0,'EUR',1,'2026-03-15','FUNCTIONAL',10,0);
    UPDATE journal_entries SET status='posted', entry_no='GJ-2026-08003' WHERE id=${B3};
  `, /بأقل من سطرين/, 'قيد مُرحَّل بسطر واحد → يُرفض عند COMMIT');

  const B4 = U(3004);
  await expectErr(c, 'B4', `INSERT INTO journal_entries (id,legal_entity_id,journal_id,fiscal_year_id,fiscal_period_id,status,entry_no,source_document_date,accounting_date,description,total_debit_eur,total_credit_eur)
      VALUES (${B4},${LE},${JR},${FY},${P3},'posted','GJ-X','2026-03-15','2026-03-15','t',10,20)`,
    /chk_je_posted_balanced/, 'رأس غير متوازن → يُرفض فوراً بقيد CHECK (قبل COMMIT)');

  await expectErr(c, 'B5', `INSERT INTO journal_entries (id,legal_entity_id,journal_id,fiscal_year_id,fiscal_period_id,status,source_document_date,accounting_date,description,total_debit_eur,total_credit_eur)
      VALUES (${U(3005)},${LE},${JR},${FY},${P3},'posted','2026-03-15','2026-03-15','t',10,10)`,
    /chk_je_posted_has_no/, 'قيد مُرحَّل بلا رقم رسمي → مرفوض');

  const B6 = await mkEntry({ amt: 123.45 });
  const bal = (await c.query(`SELECT total_debit_eur d, total_credit_eur cr FROM journal_entries WHERE id=${B6}`)).rows[0];
  (Number(bal.d) === 123.45 && Number(bal.cr) === 123.45) ? ok('B6', 'القيد المتوازن يمرّ ويُلتزَم سليماً') : bad('B6', 'قيمة غير متوقعة');

  // ═══ 5 · NUMBERING · تزامن حقيقي ════════════════════════════════════════
  const cA = new Client({ host: '127.0.0.1', port: 55433, user: 'p11a', password: 'p11a', database: 'postgres' });
  const cB = new Client({ host: '127.0.0.1', port: 55433, user: 'p11a', password: 'p11a', database: 'postgres' });
  await cA.connect(); await cB.connect();
  await c.query(`UPDATE fiscal_years SET next_entry_no=1 WHERE id=${FY}`);

  const takeNo = async (cl, tag, holdMs) => {
    await cl.query('BEGIN');
    const r = await cl.query(`SELECT next_entry_no FROM fiscal_years WHERE id=${FY} FOR UPDATE`);
    const n = Number(r.rows[0].next_entry_no);
    await new Promise(res => setTimeout(res, holdMs));
    await cl.query(`UPDATE fiscal_years SET next_entry_no = next_entry_no + 1 WHERE id=${FY}`);
    await cl.query('COMMIT');
    return n;
  };
  const [nA, nB] = await Promise.all([takeNo(cA, 'A', 250), (async () => { await new Promise(r => setTimeout(r, 40)); return takeNo(cB, 'B', 0); })()]);
  (nA !== nB && new Set([nA, nB]).size === 2 && Math.abs(nA - nB) === 1)
    ? ok('N1', `ترحيلان متزامنان → رقمان مختلفان متتاليان (${nA} · ${nB}) — القفل يُسلسلهما`)
    : bad('N1', 'تزامن الترقيم', `${nA} · ${nB}`);
  const finalNo = Number((await c.query(`SELECT next_entry_no FROM fiscal_years WHERE id=${FY}`)).rows[0].next_entry_no);
  finalNo === 3 ? ok('N2', 'العدّاد تقدّم مرة واحدة لكل ترحيل — بلا قفزة ولا تكرار') : bad('N2', 'العدّاد', String(finalNo));

  // التراجع لا يستهلك رقماً ⇒ لا فجوة
  await cA.query('BEGIN');
  await cA.query(`SELECT next_entry_no FROM fiscal_years WHERE id=${FY} FOR UPDATE`);
  await cA.query(`UPDATE fiscal_years SET next_entry_no = next_entry_no + 1 WHERE id=${FY}`);
  await cA.query('ROLLBACK');
  const afterRb = Number((await c.query(`SELECT next_entry_no FROM fiscal_years WHERE id=${FY}`)).rows[0].next_entry_no);
  afterRb === 3 ? ok('N3', 'تراجع الترحيل يُعيد العدّاد — لا فجوة في الترقيم') : bad('N3', 'العدّاد بعد التراجع', String(afterRb));

  await expectErr(c, 'N4', `INSERT INTO journal_entries (id,legal_entity_id,journal_id,fiscal_year_id,fiscal_period_id,status,entry_no,source_document_date,accounting_date,description,total_debit_eur,total_credit_eur)
    VALUES (${U(4001)},${LE},${JR},${FY},${P3},'draft','GJ-2026-00001','2026-03-15','2026-03-15','t',0,0)`,
    /uq_je_entity_fy_entry_no/, 'رقم رسمي مكرر داخل السنة → مرفوض بفهرس فريد');

  await expectOk(c, 'N5', `INSERT INTO journal_entries (id,legal_entity_id,journal_id,fiscal_year_id,fiscal_period_id,status,source_document_date,accounting_date,description,total_debit_eur,total_credit_eur)
    VALUES (${U(4002)},${LE},${JR},${FY},${P3},'draft','2026-03-15','2026-03-15','t',0,0),(${U(4003)},${LE},${JR},${FY},${P3},'draft','2026-03-15','2026-03-15','t',0,0)`,
    'مسوّدات متعددة بلا رقم → مسموح (الفهرس جزئي على entry_no IS NOT NULL)');

  // ═══ 6 · DUPLICATE ACCOUNTING EVENT ═════════════════════════════════════
  const SRC = U(5000);
  await mkEntry({ src: SRC, evt: 'invoice_accrual' });
  await expectErr(c, 'E1', `INSERT INTO journal_entries (id,legal_entity_id,journal_id,fiscal_year_id,fiscal_period_id,status,accounting_event_type,source_document_date,accounting_date,description,source_type,source_id,total_debit_eur,total_credit_eur)
    VALUES (${U(5001)},${LE},${JR},${FY},${P3},'draft','invoice_accrual','2026-03-15','2026-03-15','dup','invoice',${SRC},0,0)`,
    /uq_je_accounting_event/, 'نفس الفاتورة + invoice_accrual مرتين → مرفوض');
  await expectOk(c, 'E2', `INSERT INTO journal_entries (id,legal_entity_id,journal_id,fiscal_year_id,fiscal_period_id,status,accounting_event_type,source_document_date,accounting_date,description,source_type,source_id,total_debit_eur,total_credit_eur)
    VALUES (${U(5002)},${LE},${JR},${FY},${P3},'draft','payment_settlement','2026-03-15','2026-03-15','pay','invoice',${SRC},0,0)`,
    'نفس الفاتورة + payment_settlement → مسموح');
  await expectOk(c, 'E3', `INSERT INTO journal_entries (id,legal_entity_id,journal_id,fiscal_year_id,fiscal_period_id,status,accounting_event_type,source_document_date,accounting_date,description,source_type,source_id,total_debit_eur,total_credit_eur)
    VALUES (${U(5003)},${LE},${JR},${FY},${P3},'draft','reversal','2026-03-15','2026-03-15','rev','invoice',${SRC},0,0)`,
    'نفس الفاتورة + reversal → مسموح');
  await expectOk(c, 'E4', `INSERT INTO journal_entries (id,legal_entity_id,journal_id,fiscal_year_id,fiscal_period_id,status,accounting_event_type,source_document_date,accounting_date,description,source_type,source_id,total_debit_eur,total_credit_eur)
    VALUES (${U(5004)},${LE},${JR},${FY},${P3},'draft','adjustment','2026-03-15','2026-03-15','adj','invoice',${SRC},0,0)`,
    'نفس الفاتورة + adjustment → مسموح (تسوية واحدة لكل مستند)');
  await expectErr(c, 'E5', `INSERT INTO journal_entries (id,legal_entity_id,journal_id,fiscal_year_id,fiscal_period_id,status,accounting_event_type,source_document_date,accounting_date,description,source_type,source_id,total_debit_eur,total_credit_eur)
    VALUES (${U(5005)},${LE},${JR},${FY},${P3},'draft','payment_settlement','2026-03-15','2026-03-15','dup2','invoice',${SRC},0,0)`,
    /uq_je_accounting_event/, 'نفس سجل السداد + payment_settlement مرتين → مرفوض');
  await c.query(`UPDATE journal_entries SET status='void' WHERE id=${U(5002)}`);
  await expectOk(c, 'E6', `INSERT INTO journal_entries (id,legal_entity_id,journal_id,fiscal_year_id,fiscal_period_id,status,accounting_event_type,source_document_date,accounting_date,description,source_type,source_id,total_debit_eur,total_credit_eur)
    VALUES (${U(5006)},${LE},${JR},${FY},${P3},'draft','payment_settlement','2026-03-15','2026-03-15','again','invoice',${SRC},0,0)`,
    'بعد إلغاء المسوّدة (void) يُسمح بحدث بديل — الفهرس يستثني الملغى');
  await expectOk(c, 'E7', `INSERT INTO journal_entries (id,legal_entity_id,journal_id,fiscal_year_id,fiscal_period_id,status,accounting_event_type,source_document_date,accounting_date,description,total_debit_eur,total_credit_eur)
    VALUES (${U(5007)},${LE},${JR},${FY},${P3},'draft','manual','2026-03-15','2026-03-15','m1',0,0),(${U(5008)},${LE},${JR},${FY},${P3},'draft','manual','2026-03-15','2026-03-15','m2',0,0)`,
    'قيود يدوية بلا مصدر → لا يقيّدها الفهرس إطلاقاً');

  // ═══ 7 · FX ═════════════════════════════════════════════════════════════
  const fxLine = (id, ccy, rate, src, de, ce) => `
    INSERT INTO journal_entries (id,legal_entity_id,journal_id,fiscal_year_id,fiscal_period_id,status,source_document_date,accounting_date,description,total_debit_eur,total_credit_eur)
      VALUES (${id},${LE},${JR},${FY},${P3},'draft','2026-03-15','2026-03-15','fx',0,0);
    INSERT INTO journal_lines (entry_id,line_no,account_id,debit,credit,transaction_currency,fx_rate,fx_date,fx_source,debit_eur,credit_eur)
      VALUES (${id},1,${A1},100,0,'${ccy}',${rate},'2026-03-10','${src}',${de},${ce})`;
  await expectOk (c, 'X1', fxLine(U(6001), 'EUR', 1, 'FUNCTIONAL', 100, 0), 'سطر باليورو: سعر 1 · مصدر FUNCTIONAL → مقبول بلا دليل صرف');
  await expectErr(c, 'X2', fxLine(U(6002), 'EUR', 0.9, 'FUNCTIONAL', 90, 0), /chk_jl_eur_rate_is_one/, 'سطر باليورو بسعر ≠ 1 → مرفوض');
  await expectErr(c, 'X3', fxLine(U(6003), 'EUR', 1, 'ECB', 100, 0), /chk_jl_foreign_needs_fx/, 'سطر باليورو يدّعي مصدراً خارجياً → مرفوض');
  await expectErr(c, 'X4', fxLine(U(6004), 'USD', 0.9, 'FUNCTIONAL', 90, 0), /chk_jl_foreign_needs_fx/, 'سطر بالدولار بمصدر FUNCTIONAL → مرفوض');
  await expectOk (c, 'X5', fxLine(U(6005), 'USD', 0.9, 'ECB', 90, 0), 'سطر بالدولار بمصدر ECB → مقبول');
  await expectOk (c, 'X6', fxLine(U(6006), 'SAR', 0.24, 'BANK', 24, 0), 'سطر بالريال بمصدر BANK → مقبول');
  await expectOk (c, 'X7', fxLine(U(6007), 'CHF', 1.05, 'OTHER_APPROVED', 105, 0), 'سطر بالفرنك بمصدر معتمَد → مقبول');
  await expectErr(c, 'X8', fxLine(U(6008), 'USD', 0, 'ECB', 0, 0), /chk_jl_fx_positive|chk_jl_eur_side/, 'سعر صرف صفر → مرفوض');
  await expectErr(c, 'X9', fxLine(U(6009), 'USD', -1, 'ECB', 90, 0), /chk_jl_fx_positive/, 'سعر صرف سالب → مرفوض');
  await expectErr(c, 'X10', fxLine(U(6010), 'USD', 0.9, 'INVENTED', 90, 0), /chk_jl_fx_source/, 'مصدر سعر غير معتمد → مرفوض');
  await expectErr(c, 'X11', `INSERT INTO journal_entries (id,legal_entity_id,journal_id,fiscal_year_id,fiscal_period_id,status,source_document_date,accounting_date,description,total_debit_eur,total_credit_eur)
      VALUES (${U(6011)},${LE},${JR},${FY},${P3},'draft','2026-03-15','2026-03-15','fx',0,0);
    INSERT INTO journal_lines (entry_id,line_no,account_id,debit,credit,transaction_currency,fx_rate,fx_source,debit_eur,credit_eur)
      VALUES (${U(6011)},1,${A1},100,0,'USD',0.9,'ECB',90,0)`, /fx_date/, 'سطر بلا fx_date → مرفوض (NOT NULL)');
  await expectErr(c, 'X12', fxLine(U(6012), 'USD', 0.9, 'ECB', 0, 90), /chk_jl_eur_side/, 'جانب اليورو مخالف لجانب المعاملة → مرفوض');
  await expectErr(c, 'X13', `INSERT INTO accounting_fx_rates (legal_entity_id,currency_from,currency_to,rate,rate_date,source) VALUES (${LE},'USD','EUR',0.91,'2026-03-11','MANUAL_APPROVED')`,
    /chk_fx_manual_approved/, 'سعر يدوي بلا معتمِد → مرفوض');
  await expectErr(c, 'X14', `INSERT INTO accounting_fx_rates (legal_entity_id,currency_from,currency_to,rate,rate_date,source) VALUES (${LE},'USD','EUR',0.9,'2026-03-10','ECB')`,
    /uq_fx_rate_lookup/, 'سعران متضاربان لنفس العملة والتاريخ والمصدر → مرفوض');
  await expectErr(c, 'X15', `INSERT INTO journal_lines (entry_id,line_no,account_id,debit,credit,transaction_currency,fx_rate,fx_date,fx_source,debit_eur,credit_eur) VALUES (${U(6005)},1,${A1},5,0,'USD',0.9,'2026-03-10','ECB',4.5,0)`,
    /uq_jl_entry_line/, 'رقم سطر مكرر داخل القيد → مرفوض');

  // سياسة الحساب: القاعدة لا تُعيد حساب المبلغ — تُقارَن نتيجة الخدمة بنتيجة Postgres
  const arith = await c.query(`SELECT ROUND(100::numeric*0.9,2) a, ROUND(1234.56::numeric*0.87654321,2) b, ROUND(0.01::numeric*0.9,2) d`);
  const jsR2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const agree = Number(arith.rows[0].a) === jsR2(100 * 0.9)
    && Number(arith.rows[0].b) === jsR2(1234.56 * 0.87654321)
    && Number(arith.rows[0].d) === jsR2(0.01 * 0.9);
  agree ? ok('X16', 'حساب الخدمة وحساب Postgres متطابقان على عيّنات — والقاعدة لا تُعيد الحساب أصلاً (سياسة: حاسِب واحد)')
        : bad('X16', 'اختلاف حسابي', JSON.stringify(arith.rows[0]));

  // ═══ 8 · PERIOD CONTROL ═════════════════════════════════════════════════
  const per = async (id, p, evt, no) => `
    INSERT INTO journal_entries (id,legal_entity_id,journal_id,fiscal_year_id,fiscal_period_id,status,accounting_event_type,source_document_date,accounting_date,description,total_debit_eur,total_credit_eur)
      VALUES (${id},${LE},${JR},${FY},${p},'draft','${evt}','2026-03-15','2026-03-15','p',100,100);
    INSERT INTO journal_lines (entry_id,line_no,account_id,debit,credit,transaction_currency,fx_rate,fx_date,fx_source,debit_eur,credit_eur) VALUES
      (${id},1,${A1},100,0,'EUR',1,'2026-03-15','FUNCTIONAL',100,0),(${id},2,${A2},0,100,'EUR',1,'2026-03-15','FUNCTIONAL',0,100);
    UPDATE journal_entries SET status='posted', entry_no='${no}' WHERE id=${id}`;
  await expectOk (c, 'P1', await per(U(7001), P4, 'manual', 'GJ-2026-07001'), 'فترة OPEN → الترحيل مسموح');
  await expectErr(c, 'P2', await per(U(7002), P5, 'manual', 'GJ-2026-07002'), /مُقفلة مبدئياً/, 'فترة SOFT_CLOSED + حركة عادية → مرفوض');
  await expectOk (c, 'P3', await per(U(7003), P5, 'adjustment', 'GJ-2026-07003'), 'فترة SOFT_CLOSED + قيد تسوية → مسموح (المسار المرتفع)');
  await expectOk (c, 'P4', await per(U(7004), P5, 'reversal', 'GJ-2026-07004'), 'فترة SOFT_CLOSED + قيد عكس → مسموح');
  await expectErr(c, 'P5', await per(U(7005), P6, 'manual', 'GJ-2026-07005'), /مُقفلة نهائياً/, 'فترة HARD_CLOSED + حركة عادية → مرفوض');
  await expectErr(c, 'P6', await per(U(7006), P6, 'adjustment', 'GJ-2026-07006'), /مُقفلة نهائياً/, 'فترة HARD_CLOSED + تسوية → مرفوض');
  await expectErr(c, 'P7', await per(U(7007), P6, 'reversal', 'GJ-2026-07007'), /مُقفلة نهائياً/, 'فترة HARD_CLOSED + عكس → مرفوض');
  await expectErr(c, 'P8', `INSERT INTO fiscal_periods (legal_entity_id,fiscal_year_id,period_no,name,start_date,end_date,status) VALUES (${LE},${FY},7,'x','2026-07-01','2026-07-31','frozen')`,
    /chk_period_status/, 'حالة فترة غير معروفة → مرفوضة');
  await expectErr(c, 'P9', `INSERT INTO fiscal_periods (legal_entity_id,fiscal_year_id,period_no,name,start_date,end_date) VALUES (${LE},${FY},13,'x','2026-07-01','2026-07-31')`,
    /chk_period_no/, 'رقم فترة خارج 0..12 → مرفوض');
  await expectErr(c, 'P10', `INSERT INTO fiscal_periods (legal_entity_id,fiscal_year_id,period_no,name,start_date,end_date) VALUES (${LE},${FY},8,'x','2026-08-31','2026-08-01')`,
    /chk_period_dates/, 'نهاية فترة قبل بدايتها → مرفوضة');

  // ═══ 9 · DOWN ═══════════════════════════════════════════════════════════
  // مرجع خارجي يمنع الإسقاط الصامت
  await c.query(`CREATE TABLE ext_ref (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), le UUID REFERENCES legal_entities(id))`);
  let downBlocked = false;
  try { await c.query(DOWN); } catch (e) { downBlocked = /depend|foreign key/i.test(e.message); }
  // فشل داخل ملف يبدأ بـBEGIN يترك الجلسة في معاملة مُجهَضة بلا COMMIT — وهذا
  // بالضبط ضمان الذرّية: لا شيء طُبِّق. لكن الجلسة تحتاج ROLLBACK صريحاً للمتابعة.
  await c.query('ROLLBACK').catch(() => {});
  downBlocked ? ok('R1', 'DOWN بلا CASCADE: وجود مرجع خارجي يوقفه بدل إسقاط كائنات خارج النطاق') : bad('R1', 'DOWN لم يتوقف عند مرجع خارجي');

  const stillAll = (await c.query(`SELECT count(*)::int n FROM pg_tables WHERE schemaname='public' AND tablename = ANY($1)`, [EXPECT9])).rows[0].n;
  stillAll === 9 ? ok('R1b', 'بعد فشل DOWN: الجداول التسعة سليمة — لا إسقاط جزئي (الذرّية مُثبَتة)') : bad('R1b', 'إسقاط جزئي', String(stillAll));
  await c.query('DROP TABLE ext_ref');

  const beforeDown = await snap();
  await c.query(DOWN);
  const afterDown = await snap();
  const stillThere = EXPECT9.filter(t => afterDown.tables.includes(t));
  stillThere.length === 0 ? ok('R2', 'DOWN أسقط الجداول التسعة كلها') : bad('R2', 'بقي', JSON.stringify(stillThere));
  const lost = beforeDown.tables.filter(t => !afterDown.tables.includes(t) && !EXPECT9.includes(t));
  lost.length === 0 ? ok('R3', 'DOWN لم يُسقط أي جدول خارج نطاق المحاسبة') : bad('R3', 'أُسقط', JSON.stringify(lost));
  JSON.stringify(afterDown.counts) === JSON.stringify(before.counts)
    ? ok('R4', 'بيانات جداول الأعمال سليمة بعد UP ثم DOWN') : bad('R4', 'تغيّرت البيانات');
  const fnLeft = await c.query(`SELECT proname FROM pg_proc WHERE proname LIKE 'accounting~_%' ESCAPE '~'`);
  fnLeft.rows.length === 0 ? ok('R5', 'DOWN أزال الدوال المحاسبية الثلاث') : bad('R5', 'دوال باقية', JSON.stringify(fnLeft.rows));
  try { await c.query(DOWN); ok('R6', 'إعادة تنفيذ DOWN لا تفشل (idempotent)'); } catch (e) { bad('R6', 'DOWN غير متكرر الأمان', e.message.slice(0, 100)); }

  await cA.end(); await cB.end(); await c.end(); await pg.stop();

  console.log('\n════════ P1.1A · نتائج الإثبات على PostgreSQL حقيقي ════════');
  for (const [s, id, m] of results) console.log(`${s === 'PASS' ? '✔' : '✘'} ${id.padEnd(4)} ${m}`);
  console.log(`\nPASS ${pass} · FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e.message, '\n', e.stack); process.exit(2); });
