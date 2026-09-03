import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * نقطة الصحّة التشغيليّة — «هل الخادم حيّ؟»
 *
 * ── لماذا ──
 * لم يكن في النظام ما يخبر أحداً بسقوط الباك إلا مستخدمٌ تفشل شاشته. وهذه
 * النقطة تُنادى من Railway كلّ فترة: إن سقط الردّ عُرف الأمر قبل أن يُكتشف
 * بالعين. وتُنادى بعد كلّ نشرةٍ لتُثبت أنّ الإصدار الجديد **أقلع واتّصل** —
 * لا أنّ الدفع تمّ فحسب.
 *
 * ── ما تفحصه ──
 * الحياة (وصول الردّ) والاتّصال بالقاعدة (`SELECT 1` بمهلة). ولا تفحص صحّة
 * الأرقام — تلك شاشةٌ أخرى (الخيار ب في سجلّ المعلَّقات).
 *
 * ── ما لا تكشفه ──
 * لا مصادقة عليها عمداً (أداة المراقبة لا تحمل رمزاً)، فلا يخرج منها إلا ما
 * يصلح للعلن: حالةٌ ومدّةٌ وإصدار. **لا رابط قاعدةٍ ولا نصّ خطأٍ ولا اسم مضيف** —
 * فشل القاعدة يُقال بكلمة `fail` لا برسالة المحرّك.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** أطول ما ننتظر القاعدة — أبطأ من هذا يعني أنّها في حكم الساقطة. */
export const DB_PROBE_TIMEOUT_MS = 3_000;

/** لحظة تحميل الوحدة ≈ لحظة إقلاع العمليّة. */
const STARTED_AT = new Date();

export interface HealthReport {
  status: 'ok' | 'degraded';
  db: 'ok' | 'fail' | 'timeout';
  /** زمن فحص القاعدة بالمللي ثانية — يرتفع قبل أن يسقط. */
  db_ms: number;
  uptime_s: number;
  /** أوّل ثمانية من SHA النشرة على Railway، أو `unknown` محلّياً. */
  version: string;
  started_at: string;
  checked_at: string;
}

/** يقرأ إصدار النشرة من بيئة Railway بلا أن يفترض وجوده. */
export function readVersion(env: NodeJS.ProcessEnv = process.env): string {
  const sha = (env.RAILWAY_GIT_COMMIT_SHA || env.GIT_SHA || '').trim();
  return sha ? sha.slice(0, 8) : 'unknown';
}

/**
 * يفحص القاعدة ويردّ الحالة والزمن — **ولا يرمي أبداً**.
 * الرمي هنا يحوّل نقطة الصحّة نفسها إلى `500`، فتصير المراقبةُ عمياء.
 */
export async function probeDb(
  ds: Pick<DataSource, 'query'>,
  timeoutMs = DB_PROBE_TIMEOUT_MS,
): Promise<{ db: HealthReport['db']; db_ms: number }> {
  const t0 = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const outcome = await Promise.race([
      ds.query('SELECT 1').then(() => 'ok' as const, () => 'fail' as const),
      timeout,
    ]);
    return { db: outcome, db_ms: Date.now() - t0 };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

@Controller('api/health')
export class HealthController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const { db, db_ms } = await probeDb(this.ds);
    const status: HealthReport['status'] = db === 'ok' ? 'ok' : 'degraded';

    /*
     * `503` عند تعطّل القاعدة — لا `200` بجسمٍ يقول «سيّئ». أدوات المراقبة تقرأ
     * رمز الحالة لا الجسم، وRailway يُبقي النشرة القديمة تخدم ما دام الجديد يردّ
     * بغير `200`.
     */
    res.status(status === 'ok' ? 200 : 503);
    res.setHeader('Cache-Control', 'no-store');

    return {
      status,
      db,
      db_ms,
      uptime_s: Math.round(process.uptime()),
      version: readVersion(),
      started_at: STARTED_AT.toISOString(),
      checked_at: new Date().toISOString(),
    };
  }
}
