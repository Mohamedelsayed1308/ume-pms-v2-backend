import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NOTIF_KIND } from './notification.entity';
import { SecurityEvent, SECURITY_EVENT } from './security-event.entity';
import { User } from '../auth/user.entity';

/** وصفٌ مبسَّطٌ للجهاز من ترويسة المتصفّح — للعرض لا للتعرّف. */
export function describeDevice(ua?: string): string {
  const s = String(ua || '');
  if (!s) return 'غير معروف';
  const browser =
    /Edg\//.test(s) ? 'Edge'
    : /OPR\/|Opera/.test(s) ? 'Opera'
    : /Chrome\//.test(s) && !/Chromium/.test(s) ? 'Chrome'
    : /Firefox\//.test(s) ? 'Firefox'
    : /Safari\//.test(s) ? 'Safari'
    : 'متصفّح آخر';
  const os =
    /Windows/.test(s) ? 'Windows'
    : /iPhone|iPad|iOS/.test(s) ? 'iOS'
    : /Android/.test(s) ? 'Android'
    : /Mac OS X|Macintosh/.test(s) ? 'macOS'
    : /Linux/.test(s) ? 'Linux'
    : 'نظام آخر';
  return `${browser} · ${os}`;
}

@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification) private notifRepo: Repository<Notification>,
    @InjectRepository(SecurityEvent) private eventRepo: Repository<SecurityEvent>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  // ── القراءة ──────────────────────────────────────────────────────────────
  listFor(userId: string) {
    return this.notifRepo.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
      take: 200,
    });
  }

  async markRead(userId: string, id: string) {
    await this.notifRepo.update({ id, user_id: userId }, { is_read: true });
    return { id, is_read: true };
  }

  async markAllRead(userId: string) {
    await this.notifRepo.update({ user_id: userId, is_read: false }, { is_read: true });
    return { ok: true };
  }

  // ── الكتابة ──────────────────────────────────────────────────────────────
  /**
   * تسجيل «دخولٍ من جهازٍ آخر» وإشعار كلّ الأدمن به.
   *
   * ── قواعدٌ ثلاثٌ في هذه الدالّة وحدها ──
   * ① تُستدعى **لحظةَ نجاح الدخول الجديد** لا عند كلّ طلبٍ لاحقٍ من الجهاز
   *   القديم — فالطلب اللاحق يُرَدّ بـ401 بلا كتابةٍ ولا إشعار.
   * ② لا تُستدعى أصلاً إن لم تكن ثمّة جلسةٌ سابقة (أوّل دخولٍ للحساب).
   * ③ سطرٌ واحدٌ لكلّ أدمن لكلّ حادثة — يضمنه الفهرس الفريد، ويُبتلع خطأ
   *   التكرار بصمتٍ حتّى لا يُعطَّل الدخول بسببه.
   *
   * ولا يُفشِل الدخول شيءٌ ممّا هنا: التسجيل خدمةٌ جانبيّة، وسقوطُها يُدوَّن
   * ولا يمنع صاحب الحساب من الدخول.
   */
  async recordSessionRevoked(input: {
    user: Pick<User, 'id' | 'email' | 'full_name'>;
    ip?: string;
    userAgent?: string;
    prevSessionStartedAt?: Date | null;
  }): Promise<SecurityEvent | null> {
    try {
      const device = describeDevice(input.userAgent);
      const event = await this.eventRepo.save({
        event_type: SECURITY_EVENT.SESSION_REVOKED_NEW_LOGIN,
        user_id: input.user.id,
        user_email: input.user.email,
        user_name: input.user.full_name,
        ip: (input.ip || '').slice(0, 64) || null,
        user_agent: input.userAgent || null,
        device,
        prev_session_started_at: input.prevSessionStartedAt || null,
      } as Partial<SecurityEvent>);

      const admins = await this.userRepo.find({
        where: { role: 'admin' },
        select: { id: true },
      });

      const title = 'تسجيل دخول من جهاز آخر';
      const body =
        `تم تسجيل الدخول إلى حساب ${input.user.full_name} من جهاز أو متصفح آخر، ` +
        'وتم إنهاء الجلسة السابقة تلقائياً.';
      const data: Record<string, any> = {
        user_name: input.user.full_name,
        user_email: input.user.email,
        logged_in_at: event.occurred_at,
        ip: event.ip,
        device,
        user_agent: input.userAgent || null,
        prev_session_started_at: input.prevSessionStartedAt || null,
        prev_session_ended_at: event.occurred_at,
      };

      for (const a of admins) {
        try {
          await this.notifRepo.insert({
            user_id: a.id,
            event_id: event.id,
            kind: NOTIF_KIND.SECURITY,
            event_type: SECURITY_EVENT.SESSION_REVOKED_NEW_LOGIN,
            severity: 'critical',
            title,
            body,
            data: data as any,
          });
        } catch {
          // فهرسٌ فريدٌ رفض التكرار — وهو المطلوب، فلا شيء يُفعَل
        }
      }
      return event;
    } catch (err: any) {
      this.log.error(`تعذّر تسجيل حادثة الجلسة: ${err?.message || err}`);
      return null;
    }
  }
}
