# S13-B — إزالة تبعية Swagger الميتة

**النطاق: إزالة تبعية فقط. صفر تغيير في `src/`. لم تبدأ S3. لم تُمسّ `xlsx`.**

---

## 1 · المسح النهائي للاستخدام

بحث في المستودع كله عدا `node_modules` و `dist` و `package-lock.json`:

```
@nestjs/swagger        صفر استخدام في الشيفرة
SwaggerModule          صفر
DocumentBuilder        صفر
ApiTags · ApiOperation · ApiResponse · ApiProperty · ApiBearerAuth   صفر
SwaggerCustomOptions · OpenAPIObject                                 صفر
```

| الموضع | النتيجة |
|---|---|
| `src/` | **صفر** |
| `test/` | **صفر** |
| `scripts/` | المجلد غير موجود |
| `src/main.ts` (الإقلاع) | **صفر** — لا `SwaggerModule.setup` ولا نقطة وثائق |
| `nest-cli.json` | **لا مصفوفة `plugins`** — فلا حقن ديكوريتر تلقائي عبر `@nestjs/swagger/plugin` |

كل النتائج النصّية كانت في وثائق أمنية سابقة وفي إعلان `package.json` نفسه.

**النتيجة: تبعية ميتة مؤكَّدة.**

## 2 · الحزم المُزالة

```
@nestjs/swagger        11.4.6   مُزالة
swagger-ui-express      5.0.1   مُزالة
swagger-ui-dist        5.32.8   سقطت تبعاً
```

⚠️ **إفصاح: أزلتُ حزمة لم يسمّها التكليف.**

`swagger-ui-express` تبعية **مباشرة** ثانية لم ترد في تصريحك. اكتُشفت أثناء تتبّع
مُطالِبي `swagger-ui-dist`:

```
@nestjs/swagger@11.4.6   `-- swagger-ui-dist@5.32.8
swagger-ui-express@5.0.1 `-- swagger-ui-dist@5.32.8 (deduped)
```

هدفك نصّ على **إزالة `swagger-ui-dist`**، وهي غير قابلة للإزالة ما دامت
`swagger-ui-express` قائمة. وفُحصت الأخيرة فوُجدت **ميتة كذلك**: صفر استيراد،
صفر `swaggerUi`، صفر استخدام في `src` أو `test`.

فإزالتها شرط لتحقيق الهدف المُصرَّح به، لا توسيعاً له. **إن رفضت، التراجع أدناه.**

## 3 · التجاوز — مُزال

تجاوز S13-A أصبح ميتاً بزوال الحزمة التي يستهدفها، فحُذف بالكامل:

```json
"overrides": { "@nestjs/swagger": { "js-yaml": "^5.2.3" } }    ← محذوف
```

`package.json` لم يعد يحوي مفتاح `overrides` إطلاقاً. **لا workaround متروك.**

`js-yaml` لم تُحذف مباشرة — تُرك أمر الشجرة لحلّ تبعيات npm كما طُلب.

## 4 · شجرة التبعيات — قبل / بعد

```
                        قبل        بعد
إجمالي عُقد الشجرة       810        803      −7
@nestjs/swagger        11.4.6     غائب ✔
swagger-ui-express      5.0.1     غائب ✔
swagger-ui-dist        5.32.8     غائب ✔
```

### مسار `js-yaml`

```
قبل   node_modules/@nestjs/swagger/node_modules/js-yaml   5.2.3   [إنتاج — بالتجاوز]
      node_modules/js-yaml                                4.3.0   [dev]
      node_modules/@istanbuljs/…/js-yaml                  3.15.0  [dev]

بعد   node_modules/js-yaml                                4.3.0   [dev]
      node_modules/@istanbuljs/…/js-yaml                  3.15.0  [dev]
```

**المسار الإنتاجي المصاب المرتبط بـSwagger زال تماماً** — لا بالترقيع بل بزوال سببه.

`js-yaml 4.3.0` المتبقّية **تطويرية فقط**، مصدرها:

```
@eslint/eslintrc   ←  eslint
@nestjs/cli
```

ولا تُشحن إلى الإنتاج.

### تبعيات peer

`npm ls --all` لا يُظهر أي `invalid` ولا `peer dep missing`. المُدرَج كله
`UNMET OPTIONAL DEPENDENCY` — اختياريات NestJS المعتادة
(`@nestjs/microservices` · `@nestjs/websockets` · `fastify` · `@swc/*` · `zod`)
وهي **قائمة قبل التغيير ولا صلة لها بـSwagger**.

## 5 · البناء

```
rm -rf node_modules && npm ci     PASS   تثبيت نظيف من الصفر
npx tsc --noEmit                  PASS   نظيف
npm run build (nest build)        PASS
jest                              PASS   364 / 364  ·  18 / 18 مجموعة
```

## 6 · الإقلاع

فحص محلي على `dist/main.js` لإثبات حلّ كل الوحدات:

```
تعطّل عند   attachments.service.js  →  SUPABASE_URL / SUPABASE_SERVICE_KEY مطلوبان
```

التعطّل **بعد** اجتياز سلسلة `require` كاملة — أي **صفر خطأ وحدة مفقودة**،
والسبب متغيّر بيئة لا تبعية. إثبات الإقلاع الحقيقي في القسم 9.

## 7 · انحدار مُصادَق عليه

⏸ **معلَّق — بانتظار تسجيل دخول.** انتهت صلاحية جلسة المتصفّح (الرمز 8 ساعات)،
وإدخال كلمات المرور محظور عليّ. يُستكمل فور توفّر جلسة.

**لا يُعتبر هذا القسم مُجتازاً.**

## 8 · انحدار غير مُصادَق عليه — PASS

18 مسار على الإنتاج بعد النشر:

```
GET   vessels · suppliers · invoices · payments · purchase-orders · tasks
      customers · items · accounting/entries · accounting/accounts
      fleet/dashboard · market/reports · currencies · attachments/invoice/1
                                                            كلها 401

POST  invoices · payments · accounting/entries · market/import
                                                            كلها 401
```

**صفر 502 · صفر 503 · صفر خطأ وحدة مفقودة.** كل وحدة أقلعت وحارسها فعّال قبل
أي قراءة أو كتابة.

## 9 · النشر على الإنتاج

```
الالتزام   e63c52bd   مدفوع إلى main  →  Railway ينشر أوتوماتيكياً
الفرونت    لم يُنشر — التغيير باك-إند بحت
```

مراقبة استقرار 6 دقائق (12 عيّنة كل 28ث): **401 ثابت · صفر انقطاع · زمن استجابة
`accounting` بين 0.46 و 4.07 ثانية**.

⚠️ **حدّ الإثبات:** لا تكشف الخدمة رقم الالتزام المُشغَّل في أي ترويسة، فلا يمكنني
إثبات أن `e63c52bd` هو العامل من الخارج. المتاح: الدفع نجح · Railway مضبوط على
النشر التلقائي من `main` · الخدمة سليمة طوال نافذة النشر.

## 10 · المحاسبة — بلا تغيير

```
OJ-2026-00001   POSTED · LOCKED · IMMUTABLE — لم يُمسّ
P1.7            HOLD — WAITING FOR EVIDENCE
P1.8            لم تبدأ
قيود جديدة       صفر
معاملات مالية اختبارية   صفر
```

## 11 · المخطّط — بلا تغيير

```
ملفات مُعدَّلة    package.json · package-lock.json · هذه الوثيقة
ملفات في src/    صفر
كيانات مُعدَّلة    صفر  →  لا مادة لـsynchronize أصلاً (وهو معطَّل في الإنتاج)
هجرات منفَّذة     صفر  ·  migrationsRun: false
```

## 12 · `xlsx` — لم تُمسّ · توثيق لـS13-C

```
النسخة   0.18.5   (الباك والفرونت معاً — معلَنة ^0.18.5)
```

⚠️ **تصحيح لوثيقة S1:** ذكرت أن الاستخدام في `fleet.service.ts` وحده. **غير دقيق.**
الاستخدام في **ثلاثة** ملفات باك-إند، **ويوجد مسار رفع خادمي يمرّر ملف المستخدم
مباشرة إلى `XLSX.read`** — وهو أخطر ما في الصورة ولم ترصده S1.

### الباك-إند

| الملف | يقرأ / يكتب | مصدر المُدخَل | المسار | الحماية |
|---|---|---|---|---|
| `market/market-import.service.ts` | **يقرأ** `XLSX.read(buffer)` | **ملف يرفعه المستخدم** ⚠️ | `POST api/market/import/preview`<br>`POST api/market/import` | `JwtAuthGuard` + `ScreenGuard` + `@RequireScreen('/dashboard/market')` |
| `fleet/fleet.service.ts` | **يقرأ** `XLSX.read(buf)` | تنزيل من Google Sheets بمعرّف **ثابت في الشيفرة** | `GET api/fleet/dashboard` | `JwtAuthGuard` (بلا `ScreenGuard`) |
| `profit-periods/profit-periods.service.ts` | **لا شيء** — `import` بلا أي استدعاء `XLSX.*` | — | — | `JwtAuthGuard` + `@RequireScreen('/dashboard/profit-distribution')` |

```
مسار رفع خادمي        نعم — api/market/import  و  api/market/import/preview
الحدّ الأقصى للحجم     10 MB   (FileInterceptor · memoryStorage)
المصادقة/التفويض      JWT + شاشة /dashboard/market  ·  ليس مفتوحاً للعموم
```

### الفرونت-إند

| الملف | يقرأ / يكتب |
|---|---|
| `app/dashboard/audit/page.tsx` | **يكتب** تصدير |
| `app/dashboard/invoices/SupplierReports.tsx` | **يكتب** تصدير |
| `app/dashboard/purchase-orders/page.tsx` | **يكتب** تصدير |
| `app/dashboard/reports/GubalProfitReport.tsx` | **يقرأ** `XLSX.read(file.arrayBuffer())` — ملف يختاره المستخدم، في المتصفّح فقط |
| `app/dashboard/market/import/page.tsx` | مُدخَل ملف يُرسَل للخادم — لا تحليل في العميل |

### تقييم التعرُّض

```
الثغرات        Prototype Pollution   GHSA-4r6h-8v6p-xvw6   high
               ReDoS                 GHSA-5pgg-2g8v-p4x9   high
الإصلاح        غير متاح
```

**سطح الهجوم الحقيقي:** مستخدم **مُصادَق عليه** يملك شاشة `/dashboard/market`
يرفع ملفاً خبيثاً بحجم ≤ 10 MB يُحلَّل على الخادم. ليس مجهولاً وليس عاماً —
لكنه **أوسع مما وصفته S1**.

**لم يُغيَّر شيء في `xlsx`.** توثيق فقط.

## 13 · تدقيق الإنتاج

```
حرِج 0 · مرتفع 1 · متوسط 0 · منخفض 0
   xlsx   high   لا إصلاح متاح
```

## 14 · تدقيق التطوير فقط

```
حرِج 0 · مرتفع 3 · متوسط 0 · منخفض 0
   brace-expansion   high   @jest/reporters · @typescript-eslint · glob · jest-config · jest-runtime
   fast-uri          high
   js-yaml  4.3.0    high   @eslint/eslintrc · @nestjs/cli
```

**لا تُشحن إلى الإنتاج ولا تُخلط بتعرُّضه.**

## 15 · P0 — حرِج

```
صفر
```

## 16 · P1 — مرتفع

```
xlsx   ثغرتان بلا إصلاح · مسار رفع خادمي مُصادَق عليه يُحلّل ملف المستخدم
       →  قرار S13-C
```

## 17 · P2 — متوسط

```
fleet.controller.ts   JwtAuthGuard بلا ScreenGuard — الوحيد بين مستهلكي xlsx
                      التفويض قائم داخل الخدمة (authz.assertAny) لا بالديكوريتر
                      دَيْن اتّساق لا ثغرة

xlsx تُحمَّل في الفرونت لتصدير محض في ثلاث شاشات
                      يمكن استبدالها بمكتبة كتابة فقط وإسقاط سطح القراءة كلياً
```

## 18 · P3 — منخفض

```
profit-periods.service.ts   يستورد XLSX بلا استخدام — استيراد ميت
تبعيات التطوير الثلاث        brace-expansion · fast-uri · js-yaml
```

## 19 · نقطة التراجع

```
الهدف   de32e131        (S13-A — مستقرّة ومنشورة)
الأمر   git checkout de32e131 -- package.json package-lock.json && npm ci
```

للتراجع عن إزالة `swagger-ui-express` وحدها:

```
npm install swagger-ui-express@^5.0.1
```
