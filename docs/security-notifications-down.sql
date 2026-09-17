-- ============================================================================
--  تراجع: جلسةٌ واحدةٌ لكلّ مستخدم + أحداثٌ أمنيّة + إشعاراتٌ محفوظة
--  عكس  docs/security-notifications-up.sql
--
--  تحذير: إسقاط الجدولين يمحو سجلّ الأحداث الأمنيّة والإشعارات غير المقروءة.
--  فإن كان المقصود تعطيل الميزة لا محو أثرها، اكتفِ بالقسم ① وحده: تفريغ
--  `session_id` يوقف إبطال الجلسات فوراً ويُبقي السجلّ.
--
--  التشغيل:  node scripts/run-migration.js docs/security-notifications-down.sql
-- ============================================================================

BEGIN;

-- ① تعطيل ربط الجلسة (كافٍ وحده لإيقاف الميزة بلا فقدان سجلّ)
UPDATE users SET session_id = NULL, session_started_at = NULL;

-- ② إسقاط الأعمدة والجدولين — محوٌ كامل
ALTER TABLE users DROP COLUMN IF EXISTS session_started_at;
ALTER TABLE users DROP COLUMN IF EXISTS session_id;

DROP INDEX IF EXISTS idx_notifications_user_created;
DROP INDEX IF EXISTS uq_notifications_user_event;
DROP TABLE IF EXISTS notifications;

DROP INDEX IF EXISTS idx_security_events_user;
DROP TABLE IF EXISTS security_events;

COMMIT;
