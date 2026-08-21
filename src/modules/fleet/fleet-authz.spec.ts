import 'reflect-metadata';

/*
 * `fleet.controller.ts` يُنشئ عميل Anthropic عند تحميل الوحدة، وهو يبحث عن
 * بيانات اعتمادٍ بشكلٍ غير متزامن — فيُكمل بحثه بعد أن يهدم Jest بيئته ويطبع
 * `require after teardown`. ضجيجٌ لا فشل، ويُسكته تزييفُ الحزمة: الاختبار
 * يخصّ التفويض ولا يمسّ المساعد.
 */
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: class { messages = { create: jest.fn() }; },
}));

import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { FleetController } from './fleet.controller';
import { ScreenGuard } from '../../common/screen.guard';
import { ScreenAuthzService } from '../../common/screen-authz.service';
import { REQUIRE_SCREEN } from '../../common/require-screen.decorator';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * P1.1 · لوحة الأسطول لا تُقرأ بلا صلاحية شاشة
 *
 * كانت `GET /api/fleet/dashboard` تكتفي بـ`JwtAuthGuard`، فأيّ مستخدمٍ مسجَّل
 * يسحب دفتر الأسطول كلَّه — إيراداً ومصاريفَ وصافياً وسيولةً لكلّ مركبٍ وسنة —
 * ولو كانت صلاحيته شاشةً واحدة لا تمتّ للأسطول بصلة.
 *
 * والاختبار يقيس السلوك لا الشكل: يُشغّل `ScreenGuard` الحقيقي فوق
 * `ScreenAuthzService` الحقيقي، ولا يزيّف إلا مستودع المستخدمين.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const SCREENS = ['/dashboard/vessels', '/dashboard/reports'];

/** مستودع مستخدمين مزيَّف — يردّ المستخدم المطلوب أو `null`. */
function repoOf(users: Record<string, any>) {
  return { findOne: async ({ where }: any) => users[where.id] ?? null } as any;
}

/** سياق تنفيذٍ يشير إلى موجّهٍ بعينه من `FleetController`. */
function ctxFor(handler: string, user: any): any {
  return {
    getHandler: () => (FleetController.prototype as any)[handler],
    getClass: () => FleetController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  };
}

describe('P1.1 · تفويض لوحة الأسطول', () => {
  const proto = FleetController.prototype as any;
  const screensOf = (name: string): string[] | undefined =>
    Reflect.getMetadata(REQUIRE_SCREEN, proto[name]);

  // ── الشكل: الحارسان مُعلَنان، والشاشتان مُصرَّح بهما ──

  it('1. الموجّه يشترط شاشتَي السفن والتقارير صراحةً', () => {
    expect(screensOf('dashboard')).toEqual(SCREENS);
  });

  it('2. المتحكّم يُعلن JwtAuthGuard و ScreenGuard — فالمجهول يُردّ 401 قبل الشاشة', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, FleetController) || [];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(ScreenGuard);
  });

  it('3. المساعد يبقى على تفويضه الخادمي — لا @RequireScreen عليه', () => {
    // لو حُرس بالبيانات الوصفية لصار التفويض في موضعين، وتغييرُ أحدهما يترك الآخر.
    expect(screensOf('assistant')).toBeUndefined();
  });

  // ── السلوك: من يمرّ ومن يُردّ ──

  describe('السلوك عبر ScreenGuard الحقيقي', () => {
    const guard = (users: Record<string, any>) =>
      new ScreenGuard(new Reflector(), new ScreenAuthzService(repoOf(users)));

    it('4. مستخدمٌ بلا الصلاحية → 403', async () => {
      const g = guard({ u1: { id: 'u1', role: 'user', is_active: true, allowed_screens: ['/dashboard/tasks'] } });
      await expect(g.canActivate(ctxFor('dashboard', { id: 'u1' })))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('5. مستخدمٌ بشاشة السفن → يمرّ', async () => {
      const g = guard({ u2: { id: 'u2', role: 'user', is_active: true, allowed_screens: ['/dashboard/vessels'] } });
      await expect(g.canActivate(ctxFor('dashboard', { id: 'u2' }))).resolves.toBe(true);
    });

    it('6. مستخدمٌ بشاشة التقارير وحدها → يمرّ (أيٌّ من الشاشتين يكفي)', async () => {
      const g = guard({ u3: { id: 'u3', role: 'user', is_active: true, allowed_screens: ['/dashboard/reports'] } });
      await expect(g.canActivate(ctxFor('dashboard', { id: 'u3' }))).resolves.toBe(true);
    });

    it('7. الأدمن يمرّ — وفق سياسة النظام القائمة', async () => {
      const g = guard({ a1: { id: 'a1', role: 'admin', is_active: true, allowed_screens: null } });
      await expect(g.canActivate(ctxFor('dashboard', { id: 'a1' }))).resolves.toBe(true);
    });

    it('8. مستخدمٌ معطَّل → 403 ولو كانت الشاشة في قائمته', async () => {
      const g = guard({ u4: { id: 'u4', role: 'user', is_active: false, allowed_screens: SCREENS } });
      await expect(g.canActivate(ctxFor('dashboard', { id: 'u4' })))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('9. طلبٌ بلا مستخدم → 403 (والمجهول لا يصل هنا أصلاً — يردّه JwtAuthGuard بـ401)', async () => {
      const g = guard({});
      await expect(g.canActivate(ctxFor('dashboard', undefined)))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('10. ‏`?refresh=1` لا يفتح باباً — القيد على الموجّه لا على المُعامل', async () => {
      // الحارس يسبق الموجّه، فلا يبلغ `refresh` الخدمة أصلاً لمن رُدَّ.
      const g = guard({ u5: { id: 'u5', role: 'user', is_active: true, allowed_screens: ['/dashboard/tasks'] } });
      await expect(g.canActivate(ctxFor('dashboard', { id: 'u5' })))
        .rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
