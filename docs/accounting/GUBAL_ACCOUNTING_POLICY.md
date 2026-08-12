# سياسة محاسبة Gubal / Sivamar

**معتمَدة بتكليف `GUBAL ACCOUNTING PILOT — POLICY DECISION & PILOT AUTHORIZATION`.**
هذه الوثيقة **سياسة لا تنفيذ**. لم يُرحَّل قيد واحد.

---

## 1 · العملة الوظيفية — مُثبَتة لا مفترَضة

الإثبات من ثلاثة مواضع مستقلة:

```
1 · المخطّط        legal_entities.functional_currency VARCHAR(3) NOT NULL
2 · الإنتاج        Sivamar (SIV) → functional_currency = "EUR"
                   fiscal_year_start_month = 1 · accounting_start_date = 2026-01-01
3 · المحرّك        if (ctx.functional_currency !== 'EUR') throw
                   «العملة الوظيفية المدعومة في P1.1A هي EUR فقط»
```

**العملة الوظيفية = EUR.** مثبَّتة. ولا يقبل المحرّك غيرها أصلاً.

## 2 · الاعتراف بالاستحقاق — فواتير الموردين

الاعتراف **لا يرتبط بالدفع**، ولا يُستخدم `approval_status = paid` شرطاً له.

يُثبَت الالتزام عند تحقّق الأربعة معاً:

```
1 · المعاملة تخصّ Sivamar / Gubal
2 · السلعة أو الخدمة استُلمت أو أصبحت مستحقة اقتصادياً
3 · المبلغ قابل للقياس بشكل موثوق
4 · مستند كافٍ يحدّد المورد والمبلغ والتاريخ وطبيعة المصروف/الأصل
```

```
Dr  مصروف / أصل / مقدَّم
Cr  2010 Accounts Payable — Trade
```

### فصل الحالات — لا يُستنتج أحدها من الآخر

```
Operational / Document Status      حالة المستند في سير العمل
Approval Status                    اعتماد الصرف
Accounting Recognition Status      هل أُثبت في الدفتر
Payment Status                     هل سُدِّد
Actual Payment Transaction         واقعة الدفع نفسها
```

⚠️ **الحالات القائمة ليست قواعد محاسبية.** `booking_waiting_payment` ·
`waiting_approval` · `delivery_missing` · `hold` · `waiting_po` — لغة سير عمل،
وبعضها لغة **دفع** لا استحقاق. لكل فاتورة يُطبَّق `ACCRUAL_ELIGIBILITY_TEST`
منفرداً.

**الاستثناء الوحيد الحاسم:** `delivery_missing` تصريح صريح من النظام بغياب دليل
الاستلام ⇒ **يسقط الشرط 2 مباشرة**.

## 3 · العملات الأجنبية

### الاعتراف الأولي

كل معاملة بعملة غير EUR تُحوَّل بسعر **الفوري في تاريخ القيد المحاسبي**.

المحرّك يفرض ذلك بالفعل:

```
سطر غير EUR بلا fx_rate_id                  → مرفوض
السعر يُنسَخ من الصف المعتمَد لا من الطلب       → لا يمكن اختلاق سعر في الطلب
fx.rate_date > accounting_date               → مرفوض
```

الشرط الأخير يمنع التقييم بمعلومة لم تكن متاحة وقت العملية.

### السداد

يُستخدم سعر تاريخ السداد. الفرق بين القيمة الدفترية للالتزام وقيمته عند السداد:

```
7110  Realized FX Gain
7120  Realized FX Loss
```

**ولا يُعدَّل سعر الفاتورة الأصلي بعد الترحيل** — القيد المُرحَّل غير قابل للتعديل
بحكم المحرّك، لا بالانضباط وحده.

### التمييز بين سعر البنك والسعر المحاسبي

```
accounting FX rate       يُحفظ في journal_lines.fx_rate + fx_rate_id
bank settlement rate     يُحفظ منفصلاً — لا يستبدل السعر المحاسبي
actual bank amount       المبلغ الفعلي المخصوم
FX difference            → 7110 / 7120
```

⚠️ **فجوة:** لا حقل مخصّص اليوم لسعر البنك الفعلي ولا للمبلغ البنكي المخصوم.
`journal_lines` تحمل السعر المحاسبي وحده. **يلزم قرار: حقل جديد أم توثيق في
`description`؟** لم يُنفَّذ شيء.

### مصدر السعر — ECB

```
FX_SOURCES المقبولة في المحرّك    FUNCTIONAL · ECB · BANK · MANUAL_APPROVED · OTHER_APPROVED
```

**`ECB` مقبول أصلاً** — لا يحتاج تغيير كود.

⚠️ **تنبيه فنّي جوهري — الاتجاه معكوس.** ECB ينشر أسعاره بأساس اليورو
(`1 EUR = X USD`)، بينما الجدول يخزّن:

```
currency_from = USD   currency_to = EUR   rate = USD → EUR
```

فالسعر المُدخَل يجب أن يكون **مقلوب سعر ECB**، بدقّة 8 خانات
(`numeric(18,8)`). إدخال سعر ECB كما هو **يقلب القيمة رأساً على عقب** ويضخّم كل
مبلغ بالدولار نحو 15 ضعفاً. هذا أخطر خطأ محتمل في التجربة كلها.

### سجلّ السعر

| المطلوب | متاح؟ | الحقل |
|---|---|---|
| base currency | ✔ | `currency_from` |
| quote currency | ✔ | `currency_to` (مُلزَم بـEUR) |
| rate date | ✔ | `rate_date` |
| rate | ✔ | `rate` — `numeric(18,8)`، موجب بقيد CHECK |
| source | ✔ | `source` — مقيَّد بقائمة CHECK |
| source reference | ✔ | `source_reference` |
| entered date | ✔ | `created_at` + `created_by` |
| approval status | جزئي | `approved_by` + `approved_at` |
| approved by | ✔ | `approved_by` |
| immutable after use | **✘** | لا يوجد |

**تفرُّد مضمون:** فهرس فريد على
`(legal_entity_id, currency_from, currency_to, rate_date, source)`
فلا يتكرّر سعر لنفس اليوم من نفس المصدر.

### الاعتماد — فجوة سياسة حقيقية

التكليف: **«السعر لا يصبح صالحاً للترحيل إلا بعد APPROVED»**.

الواقع في المحرّك:

```
if (fx.source === 'MANUAL_APPROVED' && !fx.approved_by) → مرفوض
```

**الاشتراط قائم على `MANUAL_APPROVED` وحده.** سعر بمصدر `ECB` **يصلح للترحيل
فور إنشائه بلا اعتماد**. و`createFxRate` لا يضع `approved_by` إلا للسعر اليدوي.

⚠️ **فجوة بين السياسة المعتمَدة والتنفيذ القائم.** إنفاذها يحتاج تعديل كود —
**لم يُنفَّذ ويحتاج تصريحاً مستقلاً.**

**الدور المخوَّل:** الفصل بين الواجبات قائم على **حبيبة الشاشة** لا على دور جديد:
`accounting/journals` للمُعِدّ · `accounting/posting` للمُرحِّل. **لا اسم شخص
يُخترع** — يُسجَّل معرّف المستخدم المنفِّذ آلياً في `approved_by`.

### إعادة التقييم في نهاية الفترة

مدعومة تصميمياً ولم تُفعَّل:

```
7130  Unrealized FX Gain
7140  Unrealized FX Loss
حدث   fx_revaluation  ← مقبول في ACCOUNTING_EVENT_TYPES
البنود النقدية موسومة  accounting_accounts.is_monetary
```

**لا تُنفَّذ إعادة تقييم آلية الآن.** مرحلة مخصّصة لاحقة.

## 4 · الأطراف المرتبطة

قاعدة الحسابات تحمل التمييز أصلاً:

```
1600  Related Party Receivable   is_related_party=true · RELATED_PARTY_RECEIVABLE · subledger مطلوب
2600  Related Party Payable      is_related_party=true · RELATED_PARTY_PAYABLE   · subledger مطلوب
1100  Accounts Receivable — Trade                        AR_CONTROL              · subledger مطلوب
```

**لا حاجة لاختلاق حساب.** الفحص أُجري على قاعدة الحسابات الفعلية (45 حساباً).

قرار P1.4A القائم: الطرف المرتبط يُعرَض **إجمالاً في 1600/2600، بلا مقاصّة، وليس
حقوق ملكية**. يسري هنا كما هو.

## 5 · ضابط منع التكرار

مضمون على مستوى قاعدة البيانات لا الواجهة:

```sql
CREATE UNIQUE INDEX uq_je_event ON journal_entries
  (legal_entity_id, accounting_event_type, source_type, source_id)
  WHERE source_id IS NOT NULL AND status <> 'void';
```

فكل معاملة مصدر تُرحَّل **مرة واحدة** لكل نوع حدث. والمحاولة الثانية تُرفض من
Postgres نفسه.

أنواع الأحداث المتاحة:

```
manual · opening_balance · invoice_accrual · payment_settlement
reversal · adjustment · depreciation · fx_revaluation
```

`invoice_accrual` و `payment_settlement` **موجودان بالفعل** — لا يحتاجان بناءً.

## 6 · حدود ثابتة

```
OJ-2026-00001      لا يُعدَّل      ·  Period 0 لا يُمسّ
P1.7               HOLD — WAITING FOR EVIDENCE
الـ128 فاتورة التاريخية Paid بلا Payment Record   خارج النطاق
الإفصاح المُلزِم    MANAGEMENT ACCOUNTS — OPENING BALANCES UNAUDITED
```
