/** إسقاط اشتراط الشخصين — إثبات على PostgreSQL حقيقي. خارج بناء المشروع. */
const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
const fs = require('fs'); const path = require('path'); const { Client } = require('pg');
const REPO = 'C:/Users/mohamed.elsayed/Downloads/My Project/ume-pms-v2';
const R = f => fs.readFileSync(path.join(REPO, 'docs/migrations', f), 'utf8');
const P11A = R('p11a-accounting-foundation-up.sql');
const FOUND = R('gubal-foundation-up.sql');
const UP = R('gubal-fx-selfapproval-up.sql');
const DOWN = R('gubal-fx-selfapproval-down.sql');
let pass = 0, fail = 0; const res = [];
const ok = (i,m)=>{pass++;res.push(['PASS',i,m]);};
const bad = (i,m,x)=>{fail++;res.push(['FAIL',i,m+(x?' :: '+x:'')]);};
async function eErr(c,i,sql,re,m){try{await c.query('BEGIN');await c.query(sql);await c.query('COMMIT');bad(i,m,'لم يُرفض');}catch(e){await c.query('ROLLBACK').catch(()=>{});(re&&!re.test(e.message))?bad(i,m,e.message.slice(0,120)):ok(i,m);}}
async function eOk(c,i,sql,m){try{await c.query(sql);ok(i,m);}catch(e){bad(i,m,e.message.slice(0,120));}}
(async () => {
  const pg = new EmbeddedPostgres({ databaseDir: path.join(process.cwd(),'pgdata-fx'), user:'p', password:'p', port:55441, persistent:false });
  let c;
  try {
    await pg.initialise(); await pg.start();
    { const b = new Client({host:'localhost',port:55441,user:'p',password:'p',database:'postgres'}); await b.connect();
      await b.query(`CREATE DATABASE proof ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`); await b.end(); }
    c = new Client({host:'localhost',port:55441,user:'p',password:'p',database:'proof'}); await c.connect();
    await c.query(P11A);
    await c.query(`CREATE TABLE invoices (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), invoice_number VARCHAR(100))`);
    await c.query(FOUND);
    await c.query(`INSERT INTO legal_entities (id,code,name,functional_currency,accounting_start_date)
                   VALUES ('11111111-1111-1111-1111-111111111111','SIV','Sivamar','EUR','2026-01-01')`);
    const LE = "'11111111-1111-1111-1111-111111111111'", U1 = "'aaaaaaaa-0000-0000-0000-000000000001'";
    const ins = (d,extra='') => `INSERT INTO accounting_fx_rates (legal_entity_id,currency_from,currency_to,rate,rate_date,source,created_by${extra?',approved_by,approved_at':''})
      VALUES (${LE},'USD','EUR',0.90,'${d}','OTHER_APPROVED',${U1}${extra})`;

    await eErr(c,'B1', ins('2026-05-31',`,${U1},now()`), /chk_fx_no_self_approval/, 'قبل الإسقاط: الاعتماد الذاتي مرفوض');
    await eOk (c,'M1', UP, 'هجرة UP تُنفَّذ');
    await eOk (c,'M2', UP, 'UP تُعاد بلا خطأ — idempotent');
    await eOk (c,'A1', ins('2026-05-31',`,${U1},now()`), 'بعد الإسقاط: المُنشئ يعتمد سعره');
    await eErr(c,'A2', ins('2026-07-17',`,${U1},NULL`), /chk_fx_approval_pairing/, 'معتمِد بلا وقت ما زال مرفوضاً');
    await eOk (c,'A3', ins('2026-07-27'), 'المسوّدة بلا اعتماد ما زالت تُنشأ');
    const g = await c.query(`SELECT COUNT(*)::int n FROM pg_constraint WHERE conname='chk_fx_no_self_approval'`);
    g.rows[0].n === 0 ? ok('A4','القيد أُسقط فعلاً') : bad('A4','القيد باقٍ');
    const p2 = await c.query(`SELECT COUNT(*)::int n FROM pg_constraint WHERE conname='chk_fx_approval_pairing'`);
    p2.rows[0].n === 1 ? ok('A5','قيد اقتران الاعتماد باقٍ — لم يُمسّ') : bad('A5','قيد الاقتران ضاع');
    await eErr(c,'D1', DOWN, /التراجع متوقّف/, 'التراجع يتوقّف بوضوح بوجود سعر اعتمده منشئه');
    await eOk (c,'D2', `DELETE FROM accounting_fx_rates WHERE approved_by = created_by`, 'حذف الصفوف المانعة');
    await eOk (c,'D3', DOWN, 'التراجع ينجح بعد رفعها');
    const g2 = await c.query(`SELECT COUNT(*)::int n FROM pg_constraint WHERE conname='chk_fx_no_self_approval'`);
    g2.rows[0].n === 1 ? ok('D4','القيد أُعيد — التراجع يعيد الحالة') : bad('D4','لم يُعَد');
  } catch (e) { bad('X','انهيار الحزمة', e.message); }
  finally {
    for (const [s,i,m] of res) console.log(`${s}  ${i.padEnd(3)} ${m}`);
    console.log(`\nPASS ${pass} · FAIL ${fail}`);
    if (c) await c.end().catch(()=>{}); await pg.stop().catch(()=>{});
    process.exit(fail?1:0);
  }
})();
