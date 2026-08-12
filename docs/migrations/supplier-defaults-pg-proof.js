const EmbeddedPostgres = require('embedded-postgres').default || require('embedded-postgres');
const fs=require('fs'), path=require('path'), { Client } = require('pg');
const REPO='C:/Users/mohamed.elsayed/Downloads/My Project/ume-pms-v2';
const R=f=>fs.readFileSync(path.join(REPO,'docs/migrations',f),'utf8');
let pass=0,fail=0;const res=[];
const ok=(i,m)=>{pass++;res.push(['PASS',i,m]);};
const bad=(i,m,x)=>{fail++;res.push(['FAIL',i,m+(x?' :: '+x:'')]);};
async function eErr(c,i,sql,re,m){try{await c.query('BEGIN');await c.query(sql);await c.query('COMMIT');bad(i,m,'لم يُرفض');}catch(e){await c.query('ROLLBACK').catch(()=>{});(re&&!re.test(e.message))?bad(i,m,e.message.slice(0,110)):ok(i,m);}}
async function eOk(c,i,sql,m){try{await c.query(sql);ok(i,m);}catch(e){bad(i,m,e.message.slice(0,110));}}
(async()=>{
  const pg=new EmbeddedPostgres({databaseDir:path.join(process.cwd(),'pgdata-sad'),user:'p',password:'p',port:55442,persistent:false});
  let c;
  try{
    await pg.initialise(); await pg.start();
    {const b=new Client({host:'localhost',port:55442,user:'p',password:'p',database:'postgres'});await b.connect();
     await b.query(`CREATE DATABASE proof ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);await b.end();}
    c=new Client({host:'localhost',port:55442,user:'p',password:'p',database:'proof'});await c.connect();
    await c.query(R('p11a-accounting-foundation-up.sql'));
    await c.query(`CREATE TABLE suppliers (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(200))`);
    await eOk(c,'M1',R('supplier-accounting-defaults-up.sql'),'هجرة UP تُنفَّذ');
    await eOk(c,'M2',R('supplier-accounting-defaults-up.sql'),'UP تُعاد بلا خطأ — idempotent');
    await c.query(`INSERT INTO legal_entities (id,code,name,functional_currency,accounting_start_date) VALUES ('11111111-1111-1111-1111-111111111111','SIV','S','EUR','2026-01-01')`);
    await c.query(`INSERT INTO suppliers (id,name) VALUES ('22222222-2222-2222-2222-222222222222','MARE NOSTRUM')`);
    await c.query(`INSERT INTO accounting_accounts (id,legal_entity_id,code,name,account_type,normal_balance) VALUES ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','5110','Stores','expense','debit')`);
    const ins=(cat)=>`INSERT INTO supplier_accounting_defaults (legal_entity_id,supplier_id,debit_account_id,accrual_category) VALUES ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','${cat}')`;
    await eOk (c,'D1',ins('GOODS'),'افتراضي سلع يُسجَّل');
    await eErr(c,'D2',ins('GOODS'),/uq_sad_entity_supplier/,'افتراضي ثانٍ لنفس المورّد مرفوض');
    await eErr(c,'D3',`INSERT INTO supplier_accounting_defaults (legal_entity_id,supplier_id,debit_account_id,accrual_category) VALUES ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','WHATEVER')`,/chk_sad_category/,'تصنيف غير معروف مرفوض');
    await eErr(c,'D4',`DELETE FROM accounting_accounts WHERE code='5110'`,/fk_sad_account/,'حذف حساب مستخدَم كافتراضي مرفوض (RESTRICT)');
    await eOk (c,'D5',`UPDATE supplier_accounting_defaults SET accrual_category='PERIOD_SERVICE'`,'تعديل الافتراضي مسموح — إعداد لا واقعة');
    await eOk (c,'D6',`DELETE FROM suppliers WHERE id='22222222-2222-2222-2222-222222222222'`,'حذف المورّد يُسقط افتراضيه (CASCADE)');
    const n=await c.query(`SELECT COUNT(*)::int n FROM supplier_accounting_defaults`);
    n.rows[0].n===0?ok('D7','الافتراضي زال مع مورّده'):bad('D7','بقي');
    const rls=await c.query(`SELECT relrowsecurity FROM pg_class WHERE relname='supplier_accounting_defaults'`);
    rls.rows[0].relrowsecurity?ok('D8','RLS مفعَّل'):bad('D8','غير مفعَّل');
    await eOk(c,'X1',R('supplier-accounting-defaults-down.sql'),'التراجع ينفَّذ');
  }catch(e){bad('X','انهيار',e.message);}
  finally{
    for(const [s,i,m] of res) console.log(`${s}  ${i.padEnd(3)} ${m}`);
    console.log(`\nPASS ${pass} · FAIL ${fail}`);
    if(c)await c.end().catch(()=>{}); await pg.stop().catch(()=>{}); process.exit(fail?1:0);
  }
})();
