import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { JwtStrategy } from '../auth/jwt.strategy';
import { NotificationsService, describeDevice } from './notifications.service';
import * as bcrypt from 'bcrypt';

/**
 * سيناريو المالك: دخولٌ من جهازٍ ١ ثمّ من جهازٍ ٢ بالحساب نفسه.
 *
 * المتوقَّع: جهاز ٢ يعمل · جهاز ١ يخرج · حادثةٌ واحدة · إشعارٌ واحدٌ لكلّ أدمن ·
 * وإعادةُ الطلب من الجهاز القديم لا تُنشئ شيئاً.
 */

const PW = 'Str0ngPass!';

// ── مستودعاتٌ وهميّةٌ في الذاكرة ──
function makeWorld(admins = ['adm1', 'adm2']) {
  const hash = bcrypt.hashSync(PW, 4);
  const user: any = {
    id: 'u1', email: 'a@b.c', full_name: 'أحمد', role: 'user',
    is_active: true, password: hash, session_id: null, session_started_at: null,
  };
  const events: any[] = [];
  const notifs: any[] = [];

  const userRepo: any = {
    findOne: async ({ where }: any) => {
      if (where.id && where.id !== user.id) return null;
      if (where.email && where.email !== user.email) return null;
      if (where.is_active === true && !user.is_active) return null;
      return { ...user };
    },
    find: async () => admins.map((id) => ({ id })),
    update: async (_id: string, patch: any) => { Object.assign(user, patch); return { affected: 1 }; },
  };
  const eventRepo: any = {
    save: async (e: any) => { const row = { ...e, id: `ev${events.length + 1}`, occurred_at: new Date() }; events.push(row); return row; },
  };
  const notifRepo: any = {
    insert: async (n: any) => {
      // محاكاة الفهرس الفريد (user_id, event_id)
      if (notifs.some((x) => x.user_id === n.user_id && x.event_id === n.event_id)) {
        throw new Error('duplicate key value violates unique constraint');
      }
      notifs.push({ ...n, id: `nf${notifs.length + 1}`, is_read: false });
    },
    find: async () => notifs,
    update: async () => ({ affected: 1 }),
  };

  const notifSvc = new NotificationsService(notifRepo, eventRepo, userRepo);
  const jwt: any = { sign: (p: any) => JSON.stringify(p) };
  const auth = new AuthService(userRepo, jwt, notifSvc);
  const strategy = new JwtStrategy({ get: () => 'secret' } as any, userRepo);
  return { user, events, notifs, auth, notifSvc, strategy };
}

const CTX = { ip: '1.2.3.4', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537' };

describe('جلسةٌ واحدة — دخولٌ من جهازين', () => {
  it('أوّل دخولٍ لا يُنشئ حادثةً ولا إشعاراً', async () => {
    const w = makeWorld();
    await w.auth.login('a@b.c', PW, CTX);
    expect(w.events).toHaveLength(0);
    expect(w.notifs).toHaveLength(0);
    expect(w.user.session_id).toBeTruthy();
  });

  it('الدخول الثاني: حادثةٌ واحدة وإشعارٌ واحدٌ لكلّ أدمن، ورقم جلسةٍ جديد', async () => {
    const w = makeWorld(['adm1', 'adm2']);
    const first: any = await w.auth.login('a@b.c', PW, CTX);
    const sid1 = JSON.parse(first.access_token).sid;

    const second: any = await w.auth.login('a@b.c', PW, CTX);
    const sid2 = JSON.parse(second.access_token).sid;

    expect(sid2).not.toBe(sid1);
    expect(w.events).toHaveLength(1);
    expect(w.events[0].event_type).toBe('SESSION_REVOKED_NEW_LOGIN');
    expect(w.notifs).toHaveLength(2);                        // أدمنان ⇒ إشعاران
    expect(new Set(w.notifs.map((n) => n.user_id))).toEqual(new Set(['adm1', 'adm2']));
    expect(new Set(w.notifs.map((n) => n.event_id)).size).toBe(1); // حادثةٌ واحدة
    expect(w.notifs[0].kind).toBe('SECURITY');
    expect(w.notifs[0].title).toBe('تسجيل دخول من جهاز آخر');
    expect(w.notifs[0].body).toContain('أحمد');
    expect(w.notifs[0].data.ip).toBe('1.2.3.4');
    expect(w.notifs[0].data.device).toBe('Chrome · Windows');
  });

  it('الجهاز القديم يُرَدّ بـ SESSION_REVOKED، وتكرار الطلب لا يُنشئ إشعاراً جديداً', async () => {
    const w = makeWorld();
    const first: any = await w.auth.login('a@b.c', PW, CTX);
    const old = JSON.parse(first.access_token);
    await w.auth.login('a@b.c', PW, CTX);

    for (let i = 0; i < 3; i++) {
      await expect(w.strategy.validate(old)).rejects.toBeInstanceOf(UnauthorizedException);
    }
    expect(w.events).toHaveLength(1);
    expect(w.notifs).toHaveLength(2);
  });

  it('الجهاز الجديد يعمل طبيعيّاً', async () => {
    const w = makeWorld();
    await w.auth.login('a@b.c', PW, CTX);
    const second: any = await w.auth.login('a@b.c', PW, CTX);
    const fresh = JSON.parse(second.access_token);
    await expect(w.strategy.validate(fresh)).resolves.toMatchObject({ id: 'u1', email: 'a@b.c' });
  });

  it('الحساب بلا جلسةٍ مثبّتة يقبل الرمز القائم — فلا يخرج أحدٌ بسبب الهجرة', async () => {
    const w = makeWorld();
    w.user.session_id = null;
    await expect(w.strategy.validate({ sub: 'u1' })).resolves.toMatchObject({ id: 'u1' });
  });

  it('تكرار تسجيل الحادثة نفسها لا يضاعف الإشعارات', async () => {
    const w = makeWorld(['adm1']);
    const payload = { user: { id: 'u1', email: 'a@b.c', full_name: 'أحمد' }, ...CTX };
    await w.notifSvc.recordSessionRevoked({ ...payload, prevSessionStartedAt: new Date() } as any);
    expect(w.notifs).toHaveLength(1);
    // حادثةٌ ثانيةٌ ⇒ إشعارٌ ثانٍ (مفتاحٌ مختلف) — والتكرار على المفتاح نفسه يُبتلع
    await w.notifSvc.recordSessionRevoked({ ...payload, prevSessionStartedAt: new Date() } as any);
    expect(w.notifs).toHaveLength(2);
    expect(new Set(w.notifs.map((n) => n.event_id)).size).toBe(2);
  });
});

describe('describeDevice — وصفٌ مبسَّط', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537', 'Chrome · Windows'],
    ['Mozilla/5.0 (Macintosh) AppleWebKit Safari/605', 'Safari · macOS'],
    ['Mozilla/5.0 (Windows NT 10.0) Edg/120', 'Edge · Windows'],
    ['Mozilla/5.0 (Android 14) Firefox/121', 'Firefox · Android'],
  ])('%s', (ua, want) => expect(describeDevice(ua)).toBe(want));

  it('بلا ترويسة ⇒ غير معروف', () => expect(describeDevice(undefined)).toBe('غير معروف'));
});
