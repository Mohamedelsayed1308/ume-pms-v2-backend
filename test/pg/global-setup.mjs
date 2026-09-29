/*
 * PostgreSQL مؤقّتة لاختبارات الهجرة والتكامل — **لا صلة لها بقاعدة الإنتاج**.
 *
 * عنقودٌ واحد خارج الريبو (مجلّد النظام المؤقّت)، يُهيَّأ أوّل مرّة فقط (~٩٠ ثانية)
 * ثمّ يُعاد استعماله (إقلاعٌ في ثوانٍ). وكلّ ملفّ اختبار ينشئ قاعدته الخاصّة ويحذفها.
 * ولا يُقرأ `.env` ولا `DATABASE_URL` هنا إطلاقاً.
 */
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const { recordOwner } = createRequire(import.meta.url)('./owned-processes.cjs');

const PORT = Number(process.env.CREW_PG_PORT || 54329);
const DIR = process.env.CREW_PG_DIR || path.join(os.tmpdir(), 'ume-crew-pg-cluster');

export default async function setup() {
  const pg = new EmbeddedPostgres({
    databaseDir: DIR, port: PORT, user: 'postgres', password: 'test-only', persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {}, onError: () => {},
  });
  if (!fs.existsSync(path.join(DIR, 'PG_VERSION'))) await pg.initialise();
  await pg.start();
  globalThis.__CREW_PG__ = pg;
  // مالك العنقود: معرّف الـ postmaster ووقت نشوئه — التنظيف لا يمسّ إلّا هو وأبناءه
  globalThis.__CREW_PG_OWNER__ = recordOwner(DIR);
  // الموجّه لا يحمل إلّا عنوان المحلّيّ — ويُمنع أيّ عنوانٍ آخر في الاختبارات نفسها
  process.env.CREW_PG_URL = `postgresql://postgres:test-only@127.0.0.1:${PORT}/postgres`;
}
