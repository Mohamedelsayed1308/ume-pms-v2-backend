# FINAL SECURITY HARDENING — S1 · الحالة الفعلية

**اكتشاف فقط. صفر تغيير · صفر نشر · صفر مساس بالمسار المحاسبي.**

قُرئت من **الكود الحالي والإنتاج**، لا من الوثائق السابقة — وحيث اختلفا، الكود هو
المرجع.

---

## الخلاصة قبل التفصيل

**أكثر ما ورد في التكليف مُغلَق بالفعل** في إصدارات سابقة وفي إغلاق Data API اليوم.
ثلاثة بنود فقط تحتاج عملاً، وواحد منها لا إصلاح متاحاً له.

```
مُغلَق بالفعل ومُتحقَّق منه من الكود    10 / 13
يحتاج عملاً                            2
لا إصلاح متاح — يحتاج قراراً            1
```

---

## 1–4 · اتصال قاعدة البيانات والاعتمادات

```ts
const url = (config.get<string>('DATABASE_URL') || '').trim();
if (!url) throw new Error('DATABASE_URL is not set. …no database credentials are embedded in source.');
if (!/^postgres(ql)?:\/\/.+/.test(url)) throw new Error('…Expected format: postgresql://USER:PASSWORD@HOST:PORT/DATABASE');
```

| البند | الحالة |
|---|---|
| متغيّر البيئة المستخدم | `DATABASE_URL` — **لا تُعرض قيمته** |
| اعتماد مضمّن في المصدر | **صفر** — بحث شامل عن سلاسل الاتصال وكلمات المرور: لا نتيجة |
| اعتماد احتياطي (fallback) | **صفر** |
| السلوك عند غياب السرّ | **توقّف فوري عند الإقلاع** برسالة تصف الشكل ولا تطبع القيمة |
| `.env` في المستودع | **مُتجاهَل في `.gitignore` وغير متتبَّع في git** ✔ |

**S2 · تدوير اعتماد قاعدة البيانات — مُغلَق بالفعل.** نُفِّذ في إصدار التحصين السابق:
`DATABASE_URL` مُدوَّر عبر آلية Reset في Supabase، والقديم مُبطَل، والمصدر نظيف.

⚠️ **رسالة الخطأ تذكر الشكل `postgresql://USER:PASSWORD@…`** — وهي وصف قالب لا قيمة،
لكنها تظهر في سجلّ الإقلاع. **مخاطرة منخفضة، تُذكر للاكتمال.**

## 5 · `synchronize` — مُغلَق

```ts
export function isProduction(nodeEnv) { return !(env === 'development' || env === 'test' || env === 'dev'); }
export function shouldSynchronize(nodeEnv) { return !isProduction(nodeEnv); }
export function assertNoAutoDdlInProduction(nodeEnv, synchronize) { if (isProduction && synchronize) throw … }
```

**fail-closed**: البيئة غير المعلَنة تُعامَل إنتاجاً. و`assertNoAutoDdlInProduction`
حاجز يمنع أي تسرّب مستقبلي. و`migrationsRun: false` — لا هجرة عند الإقلاع.

نُفِّذ في R3A.1 بعد **حادثة فقدان بيانات فعلية**: نشرٌ لنسخة لا تعرف أعمدة R3A جعل
`synchronize` يُسقطها.

## 6 · بنية الهجرات — ⚠️ **يحتاج عملاً**

```
src/migrations/  ← ملفات TypeScript تُولّد SQL يُنفَّذ يدوياً
                   r3a-legacy-2026-08.ts · p11a-accounting-foundation.ts · r3a-runner.*
```

**لا توجد بنية هجرات TypeORM حقيقية:** لا `migrationsTableName` · لا `DataSource`
مخصّص للهجرات · لا سجلّ تاريخ · لا `migration:run` / `migration:revert`.

**النمط الحالي:** ملف TS يُصدِّر مصفوفة SQL → يُولَّد ملف `.sql` ببصمة SHA-256 →
يُراجَع → يُنفَّذ يدوياً في محرّر Supabase → يُتحقَّق منه باستعلام.

**تقييم صريح:** هذا النمط **أثبت انضباطاً عالياً عملياً** — بصمة معتمَدة، مراجعة
قبل التنفيذ، إثبات على PostgreSQL حقيقي (87 فحصاً لـP1.1A، 20 لإغلاق Data API).
لكنه **يفتقر إلى سجلّ تاريخ آلي** يمنع إعادة تنفيذ هجرة أو يكشف هجرة فائتة.

**هذا هو البند الحقيقي الوحيد في S3.**

## 7 · CORS — مُغلَق

```ts
app.enableCors({ origin: (origin, cb) => { … allowed.some(a => a instanceof RegExp ? a.test(origin) : a === origin) … } });
```

قائمة سماح صريحة تُضبط من البيئة + الإنتاج المعروف. **ليس `origin: true`.**
الطلبات بلا `Origin` (خادم-لخادم · curl) مسموحة — وهذا صحيح: CORS حماية متصفّح
ولا يُغني عن المصادقة، والمصادقة قائمة.

## 8 · JWT — مُغلَق مع دَيْن معروف

```
السرّ        JWT_SECRET من البيئة — لا قيمة مضمّنة
الصلاحية     8h
التحقق       passport-jwt · JwtAuthGuard
```

`JWT_SECRET` مُدوَّر سابقاً — والرموز القديمة أُبطلت بتغيير التوقيع.

**دَيْن معروف:** التخزين في `localStorage` · لا refresh token · لا HttpOnly cookie.
تحويلها إعادة تصميم واسعة — تُوثَّق ولا تُنفَّذ الآن.

## 9–11 · التفويض — مُغلَق · **وتصحيح مهم**

الفحص السطحي بحثاً عن `@RequireScreen` أعطى صورة مضلِّلة: تسعة متحكّمات بدت بلا
تفويض. **الحقيقة أن الأسلوب مختلف لا غائب.**

| المتحكّم | المصادقة | التفويض | الآلية |
|---|---|---|---|
| **19 متحكّماً** (invoices · payments · suppliers · vessels · POs · tasks · customers · items · attachments · accounting …) | JWT | ✔ | `@RequireScreen` + `ScreenGuard` |
| `ask-ume` | JWT | ✔ | تصفية **الأدوات** حسب `allowed_screens` داخل الخدمة |
| `fleet` (يشمل المساعد) | JWT | ✔ | `authz.assertAny(['/dashboard/vessels','/dashboard/reports'])` |
| `tasks-assistant` | JWT | ✔ | `authz.assert('/dashboard/tasks')` |
| `invoices-assistant` | JWT | ✔ | `authz.assert('/dashboard/invoices')` |
| `invoice-extract` (OCR) | JWT | ✔ | `authz.assert('/dashboard/invoices')` |
| `audit` | JWT | ✔ | `ensureAdmin(req)` — أدمن فقط |
| `auth` | JWT | ✔ | `ensureAdmin` على مسارات الإدارة · تسجيل الدخول عام بالتصميم |
| `r3a-runner` | JWT | بوابتان | متغيّر بيئة + 404 قبل 403 · **معطَّل في الإنتاج** |

**الخمسة الذين استهدفهم S6 محميّون بالفعل** — مصادقةً وتفويضاً على مستوى الوحدة،
**قبل** جلب البيانات وإرسالها إلى Anthropic.

⚠️ **ملاحظة معمارية:** أسلوبان للتفويض (مُعلِن بالديكوريتر · أمري بالاستدعاء).
كلاهما صحيح، لكن الاختلاف يجعل التدقيق البصري السريع يخطئ — كما أخطأ فحصي الأول.
**دَيْن قابلية تدقيق لا ثغرة.**

## 12 · اللوجات والأسرار — مُغلَق

```
استدعاءات console في src   9
طباعة أسرار                صفر
```

المثال الوحيد الذي يقترب: `console.error('Ask UME error:', err?.message, err?.status)`
— ومعه تعليق صريح: **لا محتوى الطلبات ولا أسرار**.

## 13 · الاعتماديات — ⚠️ **يحتاج قراراً**

```
الباك  (إنتاج)   حرِج 0 · مرتفع 3
   @nestjs/swagger   مرتفع   إصلاح متاح
   js-yaml           مرتفع   إصلاح متاح
   xlsx              مرتفع   ❌ لا إصلاح

الفرونت (إنتاج)  حرِج 0 · مرتفع 5 · متوسط 1
   dompurify · nanoid · next · postcss · sharp · xlsx
```

### `xlsx` (SheetJS) — البند الوحيد بلا حلّ ترقيعي

```
Prototype Pollution                     GHSA-4r6h-8v6p-xvw6
Regular Expression Denial of Service    GHSA-5pgg-2g8v-p4x9
No fix available
```

**وهو مستخدم في شيفرة تشغيل حقيقية** — `src/modules/fleet/fleet.service.ts` يحمّل
جدول Google ويحلّله بـ`XLSX`. والفرونت يستخدمه في تقارير أرباح المراكب.

**سطح الهجوم:** المُدخَل ملف من **Google Sheets** يملكه المستخدم — لا رفع عام ولا
مصدر مجهول. **الاستغلال يتطلب التحكّم في مصدر الملف.**

**الخيارات:** الترقية إلى نسخة CDN الرسمية من SheetJS (خارج npm) · أو الاستبدال
بـ`exceljs` · أو قبول المخاطرة موثَّقة. **قرار لا إصلاح تلقائي.**

---

## ما تبقّى فعلاً

| # | البند | الحالة | الجهد |
|---|---|---|---|
| **S3** | بنية هجرات TypeORM + سجلّ تاريخ | **مفتوح** | متوسط — يحتاج baseline بلا مساس بالبيانات |
| **S13** | `@nestjs/swagger` و `js-yaml` | **مفتوح** | صغير — إصلاح متاح |
| **S13** | `xlsx` بلا إصلاح | **قرار** | يحتاج اختياراً بين ثلاثة مسارات |
| S14 | دَيْن `approval_status='paid'` | توثيق فقط | وثيقة |
| S5 | `localStorage` + لا refresh token | دَيْن مقبول | وثيقة |
| — | ازدواج أسلوب التفويض | دَيْن قابلية تدقيق | لا يمسّ الأمان |

**S2 · S4 · S5(الأساس) · S6 · S8 · S9 · S10 · S11 · S12 — مُغلَقة ومُتحقَّق منها من الكود.**

---

## المسار المحاسبي — مُجمَّد كما هو

```
OJ-2026-00001   POSTED · LOCKED · IMMUTABLE · لم يُمسّ
P1.7            HOLD — WAITING FOR EVIDENCE
P1.8            لم تبدأ
```

**لم يُنفَّذ تغيير واحد في S1.** اكتشاف خالص.
