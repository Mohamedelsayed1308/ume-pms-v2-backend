import 'reflect-metadata';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  THROTTLER_LIMIT,
  THROTTLER_TTL,
} from '@nestjs/throttler/dist/throttler.constants';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  LOGIN_THROTTLER,
  LOGIN_LIMIT,
  LOGIN_TTL_MS,
} from '../../common/rate-limit';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * P1.2 · الحدّ على تسجيل الدخول وحده
 *
 * حدٌّ شديدٌ على النظام كلّه يكسر الاستعمال العادي، وحدٌّ غائبٌ عن الدخول يترك
 * التخمين بلا مقاومة. فالاختبار يحرس الطرفين معاً: الحارس على `login`، ولا
 * أثر له على بقيّة الموجّهات.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('P1.2 · نطاق تحديد المعدّل', () => {
  const proto = AuthController.prototype as any;
  const guardsOf = (h: string) =>
    (Reflect.getMetadata(GUARDS_METADATA, proto[h]) || []) as any[];

  it('1. ThrottlerGuard على تسجيل الدخول', () => {
    expect(guardsOf('login')).toContain(ThrottlerGuard);
  });

  it('2. السياسة مُعلَنة على الموجّه بالاسم والحدّ والمدّة', () => {
    /*
     * ‏`@Throttle` يكتب بياناته بمفتاحٍ = الثابت + اسم المُحدِّد.
     * والثوابت تُستورَد من المكتبة لا تُكتب نصّاً — فلو غيّرتها ترقيةٌ يوماً
     * سقط الاختبار عند الترقية، لا في الإنتاج.
     */
    expect(
      Reflect.getMetadata(THROTTLER_LIMIT + LOGIN_THROTTLER, proto['login']),
    ).toBe(LOGIN_LIMIT);
    expect(
      Reflect.getMetadata(THROTTLER_TTL + LOGIN_THROTTLER, proto['login']),
    ).toBe(LOGIN_TTL_MS);
  });

  it('3. لا حدّ على المتحكّم كلّه — الحارس على الموجّه لا على الصنف', () => {
    const onClass = (Reflect.getMetadata(GUARDS_METADATA, AuthController) ||
      []) as any[];
    expect(onClass).not.toContain(ThrottlerGuard);
  });

  it('4. لا حدّ على بقيّة موجّهات المصادقة', () => {
    for (const h of [
      'createUser',
      'listUsers',
      'setPermissions',
      'setActive',
      'setRole',
      'seed',
    ]) {
      expect(guardsOf(h)).not.toContain(ThrottlerGuard);
    }
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * وسلوك الدخول نفسه لم يتغيّر — الحدّ يقع قبل الخدمة ولا يمسّها.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('P1.2 · سلوك الدخول محفوظ', () => {
  const svc = { login: jest.fn() } as unknown as AuthService;
  const c = new AuthController(svc);

  beforeEach(() => (svc.login as jest.Mock).mockReset());

  it('5. الدخول الناجح يمرّ كما كان', async () => {
    (svc.login as jest.Mock).mockResolvedValue({
      access_token: 't',
      user: { id: 'u1' },
    });
    await expect(c.login({ email: 'a@b.c', password: 'p' })).resolves.toEqual({
      access_token: 't',
      user: { id: 'u1' },
    });
    expect(svc.login).toHaveBeenCalledWith('a@b.c', 'p');
  });

  it('6. بيانات خاطئة تحتفظ بسلوكها — ولا تُفرّق بين بريدٍ مجهول وكلمةٍ خاطئة', async () => {
    (svc.login as jest.Mock).mockRejectedValue(
      new Error('Invalid credentials'),
    );
    await expect(c.login({ email: 'x@y.z', password: 'bad' })).rejects.toThrow(
      'Invalid credentials',
    );
  });
});
