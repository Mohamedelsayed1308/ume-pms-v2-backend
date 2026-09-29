import { Client } from 'pg';

/**
 * قاعدةٌ جديدة لكلّ ملفّ اختبار على العنقود المؤقّت — وتُرفض أيّ وجهةٍ غير المحلّيّ.
 */
export function pgUrl(db = 'postgres'): string {
  const base = process.env.CREW_PG_URL || '';
  const u = new URL(base);
  if (!['127.0.0.1', 'localhost', '::1'].includes(u.hostname)) throw new Error('اختبارات القاعدة على المحلّيّ وحده');
  u.pathname = `/${db}`;
  return u.toString();
}

export async function freshDb(prefix: string): Promise<{ name: string; url: string; drop: () => Promise<void> }> {
  const name = `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new Client({ connectionString: pgUrl() });
  await admin.connect();
  // UTF8 صراحةً — العنقود على ويندوز يرث ترميز النظام (WIN1256) فيرفض النصّ العربيّ
  await admin.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
  await admin.end();
  return {
    name, url: pgUrl(name),
    drop: async () => {
      const c = new Client({ connectionString: pgUrl() });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await c.end();
    },
  };
}
