/*
 * مُشغّل هجرة — يقرأ الملفّ ويُنفّذه ويطبع رسائل البوّابات.
 *
 * ولا يطبع بيانات الاتّصال ولا جزءاً منها. والملفّ نفسه يحمل `BEGIN/COMMIT`
 * وبوّاباتٍ ترمي `RAISE EXCEPTION` فتتراجع المعاملة كلّها — فالتشغيل من هنا
 * لا يُضعف الحماية التي في الملفّ.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

const file = process.argv[2];
if (!file) { console.error('حدّد ملفّ الهجرة'); process.exit(1); }
const sql = fs.readFileSync(file, 'utf8');

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    // يقتل الاتّصال بدل أن يتعلّق إن كان المنفذ محجوباً
    connectionTimeoutMillis: 20000,
    statement_timeout: 60000,
  });

  client.on('notice', (n) => console.log('NOTICE:', n.message));

  try {
    await client.connect();
    console.log('اتّصل ✔');
    await client.query(sql);
    console.log('نُفّذت الهجرة ✔  —', path.basename(file));
  } catch (e) {
    console.error('فشل:', e.message);
    process.exitCode = 1;
  } finally {
    try { await client.end(); } catch {}
  }
})();
