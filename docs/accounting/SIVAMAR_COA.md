# SIVAMAR — CHART OF ACCOUNTS

**مُحمَّل على الإنتاج · 2026-08-12 · 45 حساباً · صفر رصيد · صفر قيد.**

الكيان `SIV` · العملة الوظيفية `EUR` · بداية المحاسبة `2026-01-01`.

---

## ⚠️ تصحيح عدد الحسابات

وثيقة P1.2 ذكرت **«41 حساباً منها 3 تجميعية»**. العدد الصحيح من الجداول نفسها
هو **45 حساباً منها 2 تجميعية**. خطأ جمع في سطر ملخّص، **لا تغيير في التصميم**:
قائمة الحسابات المُحمَّلة مطابقة حرفياً لما رُوجع في P1.2 صفاً بصف.

```
الأصول 14 · الخصوم 6 · حقوق الملكية 3 · الإيرادات 1
تشغيل المراكب 10 · إدارية 4 · تمويل وفروق عملة 7   =  45
```

---

## سياسة الترقيم

```
1xxx  الأصول                    5xxx  مصروفات تشغيل المراكب
2xxx  الخصوم                    6xxx  مصروفات إدارية
3xxx  حقوق الملكية              7xxx  تمويل وفروق عملة
4xxx  الإيرادات
```

**لا اسم مركب في أي رقم حساب.** المركب بُعد على السطر (`journal_lines.vessel_id`)
لا حساب في الدليل — فإضافة مركب ثانٍ لا تمسّ الدليل إطلاقاً.

الفجوات مقصودة للتوسّع: `1060–1090` نقدية · `1400` أصول أخرى · `2300–2500` خصوم ·
`4020+` إيرادات · `5110+` تشغيل · `7040–7100` تمويل.

**حسابان تجميعيان فقط** — حيث يجب أن يُقرأ ما تحتهما كوحدة:
`1000` جذر الأصول، و`1500` المركب وتكلفته ومجمّع إهلاكه.
لا رأس لكل تصنيف: `account_type` و`account_group` يكفيان للتجميع، والرؤوس الزائدة
حسابات لا تُستعمل.

---

## الدليل

`P` = قابل للترحيل · `M` = نقدي · `S` = يتطلب دفتراً مساعداً · `R` = طرف مرتبط

### الأصول

| الرمز | الاسم | الأب | المجموعة | الدور | P | M | S | R |
|---|---|---|---|---|---|---|---|---|
| 1000 | Assets — الأصول | — | ASSETS | — | **✗** | | | |
| 1010 | Bank — EUR | 1000 | BANK | `BANK_DEFAULT` | ✓ | ✓ | | |
| 1020 | Bank — SEK ‹مقيَّد SEK› | 1000 | BANK | — | ✓ | ✓ | | |
| 1030 | Cash on Hand | 1000 | CASH | — | ✓ | ✓ | | |
| 1040 | Vessel Cash | 1000 | CASH | `VESSEL_CASH` | ✓ | ✓ | | |
| 1050 | Funds in Transit | 1000 | CASH | — | ✓ | ✓ | | |
| 1100 | Accounts Receivable — Trade | 1000 | RECEIVABLES | `AR_CONTROL` | ✓ | ✓ | **✓** | |
| 1200 | Prepayments | 1000 | PREPAYMENTS | — | ✓ | | | |
| 1210 | Deferred Expenses | 1000 | PREPAYMENTS | — | ✓ | | | |
| 1300 | Dry Dock — Deferred Cost | 1000 | DRY_DOCK | — | ✓ | | | |
| 1500 | Fixed Assets — Vessels | 1000 | FIXED_ASSETS | — | **✗** | | | |
| 1510 | Vessels — Cost | 1500 | FIXED_ASSETS | — | ✓ | | | |
| 1520 | Accumulated Depreciation — Vessels ‹دائن› | 1500 | FIXED_ASSETS | `ACCUMULATED_DEPRECIATION` | ✓ | | | |
| 1600 | Related Party Receivable | 1000 | RELATED_PARTY | `RELATED_PARTY_RECEIVABLE` | ✓ | ✓ | ✓ | **✓** |

### الخصوم

| الرمز | الاسم | المجموعة | الدور | P | M | S | R |
|---|---|---|---|---|---|---|---|
| 2010 | Accounts Payable — Trade | PAYABLES | `AP_CONTROL` | ✓ | ✓ | **✓** | |
| 2100 | Accrued Expenses | ACCRUALS | — | ✓ | | | |
| 2110 | Accrued Audit Fees | ACCRUALS | — | ✓ | | | |
| 2200 | Tax & Levy Payable | TAX | — | ✓ | | | |
| 2210 | Defence Contribution Payable | TAX | — | ✓ | | | |
| 2600 | Related Party Payable | RELATED_PARTY | `RELATED_PARTY_PAYABLE` | ✓ | ✓ | ✓ | **✓** |

### حقوق الملكية · الإيرادات

| الرمز | الاسم | المجموعة | الدور |
|---|---|---|---|
| 3010 | Share Capital | EQUITY | — |
| 3100 | Retained Earnings | EQUITY | `RETAINED_EARNINGS` |
| 3900 | Opening Suspense | EQUITY | `OPENING_SUSPENSE` |
| 4010 | Vessel / Charter Revenue | REVENUE | — |

### مصروفات تشغيل المراكب · إدارية · تمويل

| الرمز | الاسم | المجموعة | الدور |
|---|---|---|---|
| 5010 | Bunkers & Lubricants | VESSEL_OPEX | — |
| 5020 | Port & Agency | VESSEL_OPEX | — |
| 5030 | Crew Costs | VESSEL_OPEX | — |
| 5040 | Repairs & Maintenance | VESSEL_OPEX | — |
| 5050 | Insurance — H&M | VESSEL_OPEX | — |
| 5060 | Insurance — P&I | VESSEL_OPEX | — |
| 5070 | War Risk | VESSEL_OPEX | — |
| 5080 | Tonnage Tax | VESSEL_OPEX | — |
| 5090 | Dry Dock Amortization | VESSEL_OPEX | — |
| 5100 | Depreciation — Vessels | VESSEL_OPEX | `DEPRECIATION_EXPENSE` |
| 6010 | Audit Fees | ADMIN | — |
| 6020 | Legal Fees | ADMIN | — |
| 6030 | Professional Fees | ADMIN | — |
| 6040 | Professional Taxes & Levies | ADMIN | — |
| 7010 | Bank Charges | FINANCE | — |
| 7020 | Interest Income | FINANCE | — |
| 7030 | Interest Expense | FINANCE | — |
| 7110 | Realized FX Gain | FINANCE | `REALIZED_FX_GAIN` |
| 7120 | Realized FX Loss | FINANCE | `REALIZED_FX_LOSS` |
| 7130 | Unrealized FX Gain | FINANCE | `UNREALIZED_FX_GAIN` |
| 7140 | Unrealized FX Loss | FINANCE | `UNREALIZED_FX_LOSS` |

---

## مصفوفة الأدوار النظامية — 14 دوراً

| الدور | الحساب | ما يحتاجه المنطق |
|---|---|---|
| `BANK_DEFAULT` | 1010 | وجهة السداد النقدي الافتراضية |
| `VESSEL_CASH` | 1040 | فصل عُهد المراكب |
| `AR_CONTROL` | 1100 | ترحيل فواتير العملاء + مطابقة الدفتر المساعد |
| `AP_CONTROL` | 2010 | ترحيل فواتير الموردين + مطابقة الدفتر المساعد |
| `RELATED_PARTY_RECEIVABLE` | 1600 | فصل الأطراف المرتبطة بنيوياً |
| `RELATED_PARTY_PAYABLE` | 2600 | كما سبق |
| `RETAINED_EARNINGS` | 3100 | وجهة إقفال نتيجة السنة |
| `OPENING_SUSPENSE` | 3900 | موازنة تحضيرية — صفر عند القبول |
| `ACCUMULATED_DEPRECIATION` | 1520 | آلية الإهلاك |
| `DEPRECIATION_EXPENSE` | 5100 | آلية الإهلاك |
| `REALIZED_FX_GAIN` / `_LOSS` | 7110 / 7120 | تسوية فروق العملة عند السداد |
| `UNREALIZED_FX_GAIN` / `_LOSS` | 7130 / 7140 | إعادة تقييم البنود النقدية |

**ولا دور واحد على حساب مصروف عادي.** التفرّد لكل كيان مفروض بـ
`uq_acct_entity_system_role` (فهرس فريد جزئي).

**لا سطر كود واحد يقرأ `code`.** المنطق يطلب `system_role` — فإعادة ترقيم الدليل
لا تكسر شيئاً.

---

## مطابقة QuickBooks 2025 → الدليل الجديد

| # | حساب المصدر | الرصيد | الحساب الجديد | الاسم | المعالجة الافتتاحية |
|---|---|---|---|---|---|
| 1 | `1 · Sweden Bank:10 · Banks Eur` | 88,218.66 Dr | **1010** | Bank — EUR | CARRY_FORWARD |
| 2 | `1 · Sweden Bank:12 · Bank SEK` | 0.00 | **1020** | Bank — SEK | ZERO_BALANCE |
| 3 | `19 · Transit` | 0.00 | **1050** | Funds in Transit | ZERO_BALANCE |
| 4 | `11000 · Accounts Receivable` | 925,973.06 Dr | **1100** | AR — Trade | CARRY_FORWARD · يلزم كشف |
| 5 | `12000 · Undeposited Funds` | 0.00 | **1050** | Funds in Transit | ZERO_BALANCE |
| 6 | `13 · Prepayment` | 0.00 | **1200** | Prepayments | ZERO_BALANCE |
| 7 | `14 · Deferred Expenses` | 35,717.61 Dr | **1210** | Deferred Expenses | CONDITIONAL |
| 8 | `16 · Dry Dock overhaul2023` | 0.00 | **1300** | Dry Dock — Deferred | ZERO_BALANCE |
| 9 | `1601 · Dry Dock overhaul2026` | 767,982.79 Dr | **1300** | Dry Dock — Deferred | **BLOCKED** |
| 10 | `15001 · MV Gubal Trader` | 1,653,446.00 Dr | **1510** | Vessels — Cost | CARRY_FORWARD |
| 11 | `15002 · Accumulated Depreciation` | 661,378.56 Cr | **1520** | Accum. Dep. — Vessels | CARRY_FORWARD |
| 12 | `20000 · Accounts Payable` | 450.00 Cr | **2010** | AP — Trade | CARRY_FORWARD · يلزم كشف |
| 13 | `24700 · Defence contribution` | 125.63 Cr | **2210** | Defence Contribution Payable | CARRY_FORWARD |
| 14 | `24800 · Accrual Audit fees` | 0.00 | **2110** | Accrued Audit Fees | ZERO_BALANCE |
| 15 | `24801 · Accrued levy` | 350.00 Cr | **2200** | Tax & Levy Payable | CARRY_FORWARD |
| 16 | `30100 · Capital` | 1,000.00 Cr | **3010** | Share Capital | CARRY_FORWARD |
| 17 | `32000 · Accumulated Gain/Loss` | 1,452,777.63 Cr | **3100** | Retained Earnings | CARRY_FORWARD |
| 18 | `330101 · UME Holding · current` | 2,272,376.19 Cr | **2600** | Related Party Payable | **RECLASSIFY** من حقوق الملكية |
| 19 | `330102 · UME Holding · Payment` | 951,898.84 Dr | **1600** | Related Party Receivable | **RECLASSIFY** من حقوق الملكية |
| 20 | `4 · Sales:40 · MV Gubal Trader` | 918,500.00 Cr | **4010** | Vessel / Charter Revenue | CLOSE_TO_EQUITY |
| 21 | `5001 · Depreciation Expense` | 165,344.64 Dr | **5100** | Depreciation — Vessels | CLOSE_TO_EQUITY |
| 22 | `5002 · Insurance H&M` | 50,409.38 Dr | **5050** | Insurance — H&M | CLOSE_TO_EQUITY |
| 23 | `5003 · Tonnage Tax` | 763.43 Dr | **5080** | Tonnage Tax | CLOSE_TO_EQUITY |
| 24 | `5004 · Insurance P&I` | 74,123.60 Dr | **5060** | Insurance — P&I | CLOSE_TO_EQUITY |
| 25 | `5005 · War Risk` | 444.03 Dr | **5070** | War Risk | CLOSE_TO_EQUITY |
| 26 | `5006 · Amortization Dry dock` | 586,594.96 Dr | **5090** | Dry Dock Amortization | CLOSE_TO_EQUITY |
| 27 | `60000 · Audit Fees` | 1,576.75 Dr | **6010** | Audit Fees | CLOSE_TO_EQUITY |
| 28 | `60400 · Bank Service Charges` | 270.45 Dr | **7010** | Bank Charges | CLOSE_TO_EQUITY |
| 29 | `64900 · professional Tax` | 165.00 Dr | **6040** | Professional Taxes & Levies | CLOSE_TO_EQUITY |
| 30 | `68200 · Legal Fees` | 6,514.32 Dr | **6020** | Legal Fees | CLOSE_TO_EQUITY |
| 31 | `70301 · Interest` | 2,485.51 Cr | **7020** | Interest Income | **CONDITIONAL** |

**31 / 31 مربوطة · صفر غير مربوط.** لم يُمسّ أي رصيد مصدر.

---

## تصنيفات مؤقتة

| الحساب | لماذا مؤقت | ما يحسمه |
|---|---|---|
| **1300** Dry Dock — Deferred Cost | التصنيف النهائي معلَّق على قرار الإدارة/المدقق (أ/ب/ج/د) | فواتير الحوض وشهادة الإنجاز وتاريخ المسح التالي |
| **7020** Interest Income | رصيد 2025 دائن وطبيعته غير محسومة | كشف بنكي يبيّن مصدر الـ2,485.51 |
| **1210** Deferred Expenses | طبيعة الـ35,717.61 مجهولة | جدول تفصيلي بأساس الإطفاء |

الحساب `1300` **موضع قابل للتشكيل**: خيارات أ/ب/ج كلها تُستوعَب بتغيير الوصف
والتصنيف فقط — **بلا أي تغيير مخطط**. ولم يُحمَّل رصيد 2025 فيه ولا في غيره.

---

## حساب الافتتاح المعلّق — 3900

أداة تحضير فقط. **لا ترحيل تشغيلي عليه.** رصيده في القيد الافتتاحي النهائي يجب أن
يكون صفراً، ولا يظهر كمركز مالي دائم بعد التشغيل. **لم يُحمَّل فيه رصيد.**

---

## الحواجز الافتتاحية — ما زالت مفتوحة

الدُّراي دوك 767,982.79 · كشف الذمم المدينة 925,973.06 · مصادقة الأطراف المرتبطة ·
القوائم المالية 2025 المعتمدة · قيد إقفال 2025 النهائي.

التفاصيل: [`P12_COA_AND_OPENING_PREPARATION.md`](P12_COA_AND_OPENING_PREPARATION.md)

---

## ملاحظة على `display_order`

طلب P1.3 الحقل ضمن أعمدة التحميل. **`accounting_accounts` لا يحتوي عموداً بهذا
الاسم، ولم أُضِفه.**

السبب: الترقيم الرقمي **هو** ترتيب العرض (1000 → 7140)، والترتيب بـ`code` يعطي
التسلسل الهرمي المقصود بالضبط. إضافة عمود موازٍ تُنشئ مصدرَي حقيقة للترتيب قابلين
للتباعد، مقابل صفر فائدة.

لو أردته حقلاً صريحاً فهو **تغيير مخطط منفصل** يُعرَض ويُعتمد قبل تنفيذه.
