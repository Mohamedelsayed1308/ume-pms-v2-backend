# SUPABASE DATA API LOCKDOWN

**نُفِّذ على الإنتاج · 2026-08-12**

إصدار أمني ضيّق النطاق: جعل جداول التطبيق الـ28 في `public` غير قابلة للوصول
مباشرةً عبر Supabase Data API لدورَي `anon` و`authenticated`، مع بقاء NestJS/Railway
المسار الطبيعي الوحيد.

**صفر تغيير في البيانات · صفر تغيير في المخطط · صفر تغيير في المصادقة أو نموذج الصلاحيات.**

---

## 1 · الثغرة

| | قبل | بعد |
|---|---|---|
| جداول التطبيق | 28 | 28 |
| `anon` على كل جدول | `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE` | **NONE** |
| `authenticated` على كل جدول | نفس المجموعة | **NONE** |
| RLS | `OFF` × 28 · سياسات 0 | `ON` × 28 · سياسات 0 |
| افتراضيات `postgres/public/TABLES` | تمنح `anon` و`authenticated` كامل الصلاحيات | **أُزيلا** |
| `GET /rest/v1/invoices` بمفتاح منشور | **HTTP 200** | **HTTP 401** |

مفتاح `sb_publishable_…` نشط، ومَن يحمله كان يقرأ ويكتب في `invoices` و`payments`
و`users` و`permissions` و`role_permissions` مباشرةً — **متخطّياً `JwtAuthGuard`
و`ScreenGuard` ومنطق R3B/R3C ومشغّلات R3A بالكامل**. وصلاحية `TRUNCATE` تحديداً
كانت تتيح محو جدول كامل بأمر واحد.

---

## 2 · لماذا `REVOKE` لا `RLS` وحده

مُثبَت بالتجربة على PostgreSQL حقيقي قبل التصميم:

```
RLS مفعّل + الصلاحية قائمة  →  anon نجح في TRUNCATE
REVOKE + RLS                →  anon رُفض في SELECT و INSERT و TRUNCATE
```

**`RLS` لا يحكم `TRUNCATE` إطلاقاً**، و`TRUNCATE` **لا يُشغّل مشغّلات الصفوف**.
فالاعتماد على RLS وحده — وهو ما يفعله زرّ «Run and enable RLS» في لوحة Supabase —
كان سيترك الباب الأخطر مفتوحاً.

`RLS` هنا **طبقة ثانية** تحسّباً لأي منح عريض مستقبلي (`GRANT ... ON ALL TABLES`).

---

## 3 · النطاق

**ثلاث خطوات:** سحب الصلاحيات عن الـ28 · إصلاح الافتراضيات المستقبلية · تفعيل RLS.

| البُعد | القيمة |
|---|---|
| الجداول | 28، مُعدَّدة صراحةً |
| المانح في الافتراضيات | `postgres` وحده — منشئ كل جداول التطبيق |
| المخطط | `public` وحده |
| نوع الكائن | `TABLES` وحده |
| `service_role` | **لم يُمسّ** — مفتاح خادمي لا يُشحن للعملاء، وتستخدمه لوحة Supabase |
| مالك قاعدة البيانات (Railway) | **لم يُمسّ** — ويتجاوز RLS بحكم Postgres |
| `FORCE ROW LEVEL SECURITY` | **غير مستخدم** — كان سيُخضع المالك ويُعطّل الباك |

---

## 4 · بوابة الاعتمادية

بحث شامل في المستودعين قبل أي سحب:

| المستهلك | يعتمد على وصول `anon`/`authenticated` للجداول؟ |
|---|---|
| الفرونت (Vercel) | **لا** — صفر استخدام لـSupabase |
| الباك (Railway) | **لا** — يتصل بدور `postgres` مباشرة |
| المرفقات | **لا** — `service_role` + **Storage حصراً**، ولا `.from(table)` واحدة |
| Storage | **لا** — سياسات مخطط `storage` مستقلة |

---

## 5 · الملفات

```
security-precheck.sql        acefeee62c956a47aa593f3cc0d9ad874351a3a901932ea991898631770a95e9
security-lockdown-up.sql     f916cbd196fa7e0882ddae09232359de110489c3526ac7804259cf97ea57cdba
security-lockdown-down.sql   c8de9242e290e2ba89cfda2dd5ca77ed2c3b8151eaa8bdeadbe9c5dcd9e1fdf0
security-postverify.sql      1dd2c2be66ee7e3713c88d97c5ff89a762184c0ad43190b8f2bd25a6cea16130
```

`security-pg-proof-harness.js` — حزمة الإثبات (20 فحصاً) على PostgreSQL محلي.
مرجع فقط: خارج نطاق jest ولا يضيف اعتمادية.

⚠️ **`DOWN` يُعيد فتح التعرُّض على كل بيانات الإنتاج.** لا يُنفَّذ إلا عند انكسار
مستهلك شرعي مؤكَّد، وبموافقة صريحة.

---

## 6 · التحقق بعد التنفيذ

```
Data API   invoices · payments · users · permissions · role_permissions  →  401 × 5
قاعدة البيانات   anon=NONE · authenticated=NONE · RLS 28/28 · policies 0 · FORCE 0
                service_role كامل على الـ28 · postgres على invoices SELECT,INSERT,UPDATE,DELETE

المسار الشرعي عبر NestJS — كله HTTP 200
  invoices 232 · payments 18 · suppliers 74 · vessels 7 · purchase_orders 44
  tasks 3 · customers 4 · hire_invoices 13 · management_invoices 17 · items 21
  exchange_rates · users/permissions 5

البصمة المالية عبر التطبيق — مطابقة لنتيجة SQL بالقرش
  USD 142 · 5,077,303.61 · 3,782,184.94      EUR 85 · 329,982.61 · 210,259.91
  SAR   4 ·    24,679.59 ·    23,789.59      CHF  1 ·  25,384.94 ·  25,384.94
  الحالات paid 146 + unpaid 86 = 232
  Legacy migrated 128 = 123 + 5

التدقيق   حرِج 0 · مرتفع 0 · متوسط 0 · منخفض 9 · التعرُّض {}
المرفقات  ملف إنتاج حقيقي فُتح فعلياً → HTTP 200 (مسار service_role/Storage سليم)
الذكاء    ask-ume → 201 · أجاب ورفض اختراع رقم لا يملكه
```

**أقوى دليل على سلامة الباك:** `POST /api/auth/login` ببيانات وهمية ردّ **401 لا 500**
— يعني الخدمة اتصلت بقاعدة البيانات ونفّذت بحثاً فعلياً. لو كان السحب كسر صلاحيات
دور Railway لجاء الرد 500.

---

## 7 · دَيْن أمني متبقٍّ

| البند | الحالة |
|---|---|
| افتراضيات `postgres/public/SEQUENCES` و`FUNCTIONS` تمنح `anon` | خارج النطاق — لا يعرضها الـData API كجداول |
| افتراضيات `supabase_admin/public/TABLES` تمنح `anon` | جداولنا يُنشئها `postgres` فلا تتأثر |
| افتراضيات `postgres/storage/TABLES` تمنح `anon` | مخطط Storage له سياساته المستقلة |
| `service_role` له وصول كامل للجداول | مقبول — خادمي فقط |
| `graphql_public` معروض لـ`anon` | لم يُفحص |
| تدوير المفتاح المنشور بعد الإغلاق | قرار منفصل — لم يُطلب |
| أتمتة خارجية (Make · Apps Script · webhooks) | لم تُفحص — خارج المستودعين |
