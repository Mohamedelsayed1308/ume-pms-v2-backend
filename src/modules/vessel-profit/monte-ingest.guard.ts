import { CanActivate, ExecutionContext, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';

export const MONTE_INGEST_HEADER = 'x-ume-ingest-key';
const MIN_KEY_LENGTH = 32;

/**
 * حارس الدفع الآليّ لحزمة مونتي — بمفتاحٍ خاصّ بهذا الغرض وحده، لا بحساب مستخدم.
 *
 * لماذا لا JWT: الجلسة واحدةٌ لكلّ مستخدم، فدخول السكربت بحساب المالك كان سيُخرجه من
 * المتصفّح. والمفتاح لا يفتح غير هذا المسار، فتسريبه لا يمسّ بقيّة المنظومة.
 *
 * `MONTE_INGEST_KEY` على Railway. إن غاب أو قصر عن ٣٢ حرفاً فالمسار معطَّلٌ (503)
 * لا مفتوح. والمقارنة على بصمتَي SHA-256 بزمنٍ ثابت فلا يتسرّب الطول ولا المحتوى.
 */
@Injectable()
export class MonteIngestGuard implements CanActivate {
  private readonly log = new Logger('MonteIngest');

  canActivate(ctx: ExecutionContext): boolean {
    const expected = process.env.MONTE_INGEST_KEY || '';
    if (expected.length < MIN_KEY_LENGTH) throw new ServiceUnavailableException('الدفع الآليّ غير مفعَّل');
    const req = ctx.switchToHttp().getRequest();
    const given = req.headers?.[MONTE_INGEST_HEADER];
    const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();
    if (typeof given !== 'string' || !timingSafeEqual(digest(given), digest(expected))) {
      this.log.warn(`مفتاح دفعٍ مرفوض من ${req.ip || '?'}`);
      throw new UnauthorizedException('مفتاح الدفع غير صحيح');
    }
    return true;
  }
}
