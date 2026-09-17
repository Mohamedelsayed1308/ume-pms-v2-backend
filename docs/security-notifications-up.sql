-- ============================================================================
--  هجرة: جلسةٌ واحدةٌ لكلّ مستخدم + أحداثٌ أمنيّة + إشعاراتٌ محفوظة
--  عمودان على `users` وجدولان جديدان  ·  بأمر المالك في ١٧ سبتمبر ٢٠٢٦
--
--  لماذا
--  -----
--  الـ JWT مستقلٌّ بذاته، فلا يعرف الخادم كم جلسةً مفتوحةً لحسابٍ واحد ولا
--  يملك إبطال واحدةٍ منها. فيُربط كلّ رمزٍ برقم جلسةٍ محفوظٍ على صفّ المستخدم:
--  الدخول الجديد يكتب رقماً جديداً، فيسقط رمز الجهاز القديم عند أوّل طلب.
--
--  ولأنّ مركز التنبيهات يشتقّ ما يعرضه في المتصفّح من الفواتير والمهامّ، فلا
--  يصل الأدمن شيءٌ إن كان خارج المنظومة وقت الحادثة. فجدول `notifications`
--  يحفظ التنبيه حتّى يدخل ويقرأه — بحالة قراءةٍ على الخادم لا في المتصفّح.
--
--  ومنعُ التكرار بالبناء: فهرسٌ فريدٌ على (`user_id`, `event_id`). فمهما تكرّر
--  الإنشاء لحادثةٍ واحدة لا يُكتب للأدمن إلّا سطرٌ واحد.
--
--  الأمان
--  ------
--  إضافةٌ محضة: عمودان يقبلان `NULL` وجدولان جديدان. ولا صفَّ يُكتب هنا،
--  ولا عمودَ قائمٌ يُغيَّر أو يُحذف. متكرّرة الأمان بـ `IF NOT EXISTS`.
--
--  وأثرُها على القائم: كلّ المستخدمين بلا `session_id` بعد الهجرة — والحارس
--  يعامل `NULL` معاملةَ «لا جلسة مثبَّتة» فيقبل الرموز القائمة. فلا يخرج أحدٌ
--  بسبب الهجرة، ويبدأ التثبيت من أوّل دخولٍ لكلّ حساب.
--
--  التشغيل:  node scripts/run-migration.js docs/security-notifications-up.sql
--  التراجع:  docs/security-notifications-down.sql
-- ============================================================================

BEGIN;

-- ── ① ربط الجلسة على المستخدم ──────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_id         varchar(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_started_at timestamptz;

COMMENT ON COLUMN users.session_id IS
  'رقم الجلسة السارية. الرمز الذي لا يحمله يسقط. NULL = لا جلسة مثبّتة (تُقبل الرموز القائمة).';
COMMENT ON COLUMN users.session_started_at IS
  'بداية الجلسة السارية — يُعرض في تنبيه الدخول من جهازٍ آخر.';

-- ── ② الأحداث الأمنيّة ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS security_events (
  id                      uuid         PRIMARY KEY,
  event_type              varchar(64)  NOT NULL,
  user_id                 uuid         NOT NULL,
  -- لقطةٌ من بيانات الحساب وقت الحادثة: تبقى صحيحةً لو تغيّر الاسم أو البريد بعدها
  user_email              varchar(255),
  user_name               varchar(100),
  ip                      varchar(64),
  user_agent              text,
  device                  varchar(120),
  prev_session_started_at timestamptz,
  occurred_at             timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_user
  ON security_events (user_id, occurred_at DESC);

-- ── ③ الإشعارات المحفوظة ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          uuid         PRIMARY KEY,
  user_id     uuid         NOT NULL,          -- المستلِم
  event_id    uuid,                           -- مرجع الحادثة — به يُمنع التكرار
  kind        varchar(32)  NOT NULL,          -- SECURITY
  event_type  varchar(64)  NOT NULL,          -- SESSION_REVOKED_NEW_LOGIN
  severity    varchar(16)  NOT NULL DEFAULT 'critical',
  title       varchar(200) NOT NULL,
  body        text,
  data        jsonb,                          -- تفاصيل التنبيه كما تُعرض
  is_read     boolean      NOT NULL DEFAULT false,
  created_at  timestamptz  NOT NULL DEFAULT now()
);

-- سطرٌ واحدٌ لكلّ مستلِمٍ لكلّ حادثة — مهما تكرّر الإنشاء
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_user_event
  ON notifications (user_id, event_id) WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);

COMMIT;
