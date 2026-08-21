import 'reflect-metadata';
import { HttpStatus } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import {
  clientIp,
  LOGIN_THROTTLE,
  LOGIN_THROTTLER,
  LOGIN_LIMIT,
  LOGIN_TTL_MS,
  LOGIN_BLOCK_MS,
  ProxyAwareRequest,
} from './rate-limit';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * P1.2 · تحديد معدّل تسجيل الدخول
 *
 * أخطرُ ما في المُحدِّد ليس ضعفَه بل خطؤه في تمييز العميل: خلف بروكسي Railway
 * يُرجع `req.ip` عنوانَ البروكسي لكلّ الطلبات، فيقع المستخدمون جميعاً في دلوٍ
 * واحد وتُوقف خمسُ محاولاتٍ من أيٍّ كان الشركةَ كلَّها دقيقة.
 *
 * فمعظم ما يلي يخصّ `clientIp` — وهو موضع الخطر الحقيقي.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('P1.2 · سياسة تحديد المعدّل', () => {
  it('1. السياسة محافظة ومعلَنة: خمسٌ في الدقيقة، وحجبٌ دقيقة', () => {
    expect(LOGIN_LIMIT).toBe(5);
    expect(LOGIN_TTL_MS).toBe(60_000);
    expect(LOGIN_BLOCK_MS).toBe(60_000);
    expect(LOGIN_THROTTLE.name).toBe(LOGIN_THROTTLER);
  });

  it('2. التجاوز يردّ 429 — لا 401 ولا 403', () => {
    expect(new ThrottlerException().getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
  });

  it('3. رسالة التجاوز لا تكشف شيئاً عن الحساب', () => {
    const msg = new ThrottlerException().message;
    expect(msg).not.toMatch(/(?:email|user|account|password|بريد|حساب|كلمة)/i);
  });

  it('4. المُحدِّد يستعمل مُتعقِّباً مخصَّصاً — لا req.ip الافتراضي', () => {
    expect(typeof LOGIN_THROTTLE.getTracker).toBe('function');
  });
});

describe('P1.2 · تمييز العميل خلف بروكسي', () => {
  const req = (
    headers: Record<string, string | string[] | undefined>,
    ip?: string,
  ): ProxyAwareRequest => ({
    headers,
    ip,
    socket: { remoteAddress: undefined },
  });

  it('5. بلا ترويسة — يرجع إلى req.ip (تشغيلٌ محلّي)', () => {
    expect(clientIp(req({}, '127.0.0.1'))).toBe('127.0.0.1');
  });

  it('6. بروكسي واحد — يأخذ عنوان العميل', () => {
    expect(
      clientIp(req({ 'x-forwarded-for': '203.0.113.7' }, '10.0.0.1')),
    ).toBe('203.0.113.7');
  });

  it('7. ترويسة مزوَّرة من العميل — يأخذ آخر قيمة لا أولاها', () => {
    // العميل أرسل '1.2.3.4' كذباً، والحافّة ألحقت عنوانه الحقيقي في الآخر.
    const r = req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }, '10.0.0.1');
    expect(clientIp(r)).toBe('203.0.113.7');
    expect(clientIp(r)).not.toBe('1.2.3.4');
  });

  it('8. مستخدمان مختلفان خلف البروكسي نفسه لا يتقاسمان دلواً', () => {
    const a = clientIp(req({ 'x-forwarded-for': '203.0.113.7' }, '10.0.0.1'));
    const b = clientIp(req({ 'x-forwarded-for': '198.51.100.4' }, '10.0.0.1'));
    expect(a).not.toBe(b);
  });

  it('9. ترويسة مصفوفة (وسيطان) — تُدمج ويُؤخذ آخرها', () => {
    expect(
      clientIp(req({ 'x-forwarded-for': ['1.2.3.4', '203.0.113.7'] })),
    ).toBe('203.0.113.7');
  });

  it('10. ترويسة فارغة أو مسافات — لا تُنتج مفتاحاً فارغاً', () => {
    expect(clientIp(req({ 'x-forwarded-for': '  , ' }, '10.0.0.9'))).toBe(
      '10.0.0.9',
    );
    expect(clientIp(req({}))).toBe('unknown'); // لا ترويسة ولا ip ولا مقبس
  });
});
