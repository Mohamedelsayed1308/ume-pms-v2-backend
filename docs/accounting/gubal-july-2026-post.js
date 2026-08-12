/* ══════════════════════════════════════════════════════════════════════════
   تجربة Gubal — يوليو 2026 · سكربت الترحيل

   يُلصق في Console المتصفّح **وأنت داخل نظام UME**. يقرأ الرمز من الجلسة
   القائمة ولا يطلب كلمة مرور ولا يطبع الرمز.

   ثلاث خطوات منفصلة عمداً:
       GUBAL.draft()   يُنشئ 16 مسوّدة ويطبع جدولها — لا يُرحّل شيئاً
       GUBAL.post()    يُرحّل ما أُنشئ — **بعد هذه الخطوة لا تعديل ولا حذف**
       GUBAL.undo()    يُلغي المسوّدات إن أردت التراجع قبل الترحيل

   والفصل مقصود: المسوّدة تُلغى، والمُرحَّل يُعكس بقيد جديد ويبقى أثره أبداً.
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
const B = 'https://ume-pms-v2-backend-production.up.railway.app';
const E = '563a4bc2-5d11-460c-a9db-79629c431a78';           // Sivamar
const NAVTOR_PAYMENT = '8b498226-b17c-44fc-8f2e-b3711e46cc1c';
const H = () => ({ Authorization: 'Bearer ' + localStorage.getItem('token'), 'Content-Type': 'application/json' });
const G = async (p) => (await (await fetch(B + p, { headers: H() })).json());
const money = (n) => Number(n).toFixed(2).padStart(12);

let CTX = null;

async function context() {
  if (CTX) return CTX;
  const acc = await G('/api/accounting/accounts?legal_entity_id=' + E);
  const jr  = await G('/api/accounting/journals?legal_entity_id=' + E);
  const fx  = await G('/api/accounting/fx-rates?legal_entity_id=' + E);
  const inv = await G('/api/invoices');
  const L   = Array.isArray(inv) ? inv : (inv.data || []);
  const hire = (await G('/api/hire-invoices')).filter(
    (x) => /gubal/i.test(x.vessel?.name || '') && (x.invoice_date || '').startsWith('2026-07'));

  const need = ['26031','260926','260933','260942','26032','2602615/SKV','W/27011',
                'INV-2026-65659','500-106503','8200616799','2288952'];
  CTX = {
    A: Object.fromEntries(acc.map((a) => [a.code, a.id])),
    J: Object.fromEntries(jr.map((j) => [j.code, j.id])),
    FX: Object.fromEntries(fx.map((r) => [r.rate_date, { id: r.id, rate: r.rate, approved: !!r.approved_by }])),
    I: Object.fromEntries(L.filter((i) => need.includes(i.invoice_number))
        .map((i) => [i.invoice_number, { id: i.id, sup: i.supplier_id, vessel: i.vessel_id }])),
    H: Object.fromEntries(hire.map((x) => [x.invoice_number,
        { id: x.id, date: x.invoice_date, cust: x.customer_id, vessel: x.vessel_id }])),
  };

  // لا يُبنى قيد على سعر غير معتمَد — الاعتماد شرط الترحيل في المحرّك أصلاً.
  const bad = Object.entries(CTX.FX).filter(([, v]) => !v.approved).map(([d]) => d);
  if (bad.length) throw new Error('أسعار صرف غير معتمَدة: ' + bad.join(' · '));
  return CTX;
}

/** يبني وصف قيدٍ واحد. لا يرسل شيئاً. */
function entry(c, { journal, date, desc, ref, event, srcType, srcId, lines }) {
  return {
    legal_entity_id: E, journal_id: c.J[journal],
    accounting_date: date, source_document_date: date,
    description: desc, reference: ref || null,
    accounting_event_type: event,
    source_type: srcType || null, source_id: srcId || null, source_reference: ref || null,
    lines,
  };
}

/** كل قيود التجربة — تُبنى محلياً ثم تُراجَع قبل أن تُرسل. */
async function plan() {
  const c = await context();
  const L = (acct, side, amt, ccy, fxDate, extra) => ({
    account_id: c.A[acct],
    [side]: amt,
    transaction_currency: ccy,
    fx_rate_id: fxDate ? c.FX[fxDate].id : null,
    ...extra,
  });
  const out = [];

  // ── 1 · استحقاق فواتير موردي يوليو ──────────────────────────────────────
  // السبعة الأولى سلع أُقرّ استلامها إدارياً · الثلاثة الباقية خدمات بفترة منقضية.
  const SUP = [
    ['26031',        '2026-07-16', '5110', 1854.50,  'EUR', null],
    ['260926',       '2026-07-20', '5110',  127.28,  'EUR', null],
    ['260933',       '2026-07-22', '5110',  162.14,  'EUR', null],
    ['260942',       '2026-07-23', '5110',  247.50,  'EUR', null],
    ['26032',        '2026-07-27', '5040', 1210.00,  'EUR', null],
    ['2602615/SKV',  '2026-07-27', '5040', 12230.80, 'EUR', null],
    ['W/27011',      '2026-07-27', '5040',  148.10,  'EUR', null],
    ['INV-2026-65659','2026-07-31','6050', 2081.25,  'EUR', null],
    ['500-106503',   '2026-07-17', '6030',  560.00,  'USD', '2026-07-17'],
    ['8200616799',   '2026-07-31', '5120',  264.00,  'USD', '2026-07-31'],
  ];
  for (const [no, date, acct, amt, ccy, fxd] of SUP) {
    const i = c.I[no];
    const dim = { vessel_id: i.vessel, supplier_id: i.sup };
    out.push({ tag: 'مصروف ' + no, body: entry(c, {
      journal: 'PJ', date, event: 'invoice_accrual', srcType: 'invoice', srcId: i.id, ref: no,
      desc: `استحقاق فاتورة مورد ${no} — Gubal Trader`,
      lines: [
        L(acct,   'debit',  amt, ccy, fxd, { ...dim, description: `مصروف تشغيل مركب — ${no}` }),
        L('2010', 'credit', amt, ccy, fxd, { ...dim, description: `دائنون — ${no}` }),
      ],
    })});
  }

  // ── 2 · Navtor · اشتراك اثني عشر شهراً ⇒ مصروف مقدَّم لا مصروف ─────────────
  {
    const i = c.I['2288952'];
    const dim = { vessel_id: i.vessel, supplier_id: i.sup };
    out.push({ tag: 'Navtor مايو — مقدَّم', body: entry(c, {
      journal: 'PJ', date: '2026-05-31', event: 'invoice_accrual',
      srcType: 'invoice', srcId: i.id, ref: '2288952',
      desc: 'استحقاق فاتورة Navtor 2288952 — اشتراك مايو 2026 إلى مايو 2027 · مصروف مقدَّم',
      lines: [
        L('1200', 'debit',  1880.00, 'USD', '2026-05-31', { ...dim, description: 'مصروف مقدَّم — Navtor' }),
        L('2010', 'credit', 1880.00, 'USD', '2026-05-31', { ...dim, description: 'دائنون — Navtor' }),
      ],
    })});

    // السداد: الالتزام يُزال بسعره الأصلي (0.90) والبنك يُقيَّد بسعر يوم السداد
    // (0.87) — والفرق مكسب محقَّق. لا يُصطنع فرق ولا يُهمَل.
    out.push({ tag: 'Navtor يوليو — سداد', body: entry(c, {
      journal: 'BJ', date: '2026-07-27', event: 'payment_settlement',
      srcType: 'payment', srcId: NAVTOR_PAYMENT, ref: '2288952',
      desc: 'سداد فاتورة Navtor 2288952 من الحساب الدولاري — مع فرق صرف محقَّق',
      lines: [
        L('2010', 'debit',  1880.00, 'USD', '2026-05-31', { ...dim, description: 'إقفال الدائن بسعره الدفتري 0.90' }),
        L('1015', 'credit', 1880.00, 'USD', '2026-07-27', { ...dim, description: 'بنك — دولار · سعر يوم السداد 0.87' }),
        L('7110', 'credit',   56.40, 'EUR', null,         { ...dim, description: 'مكسب صرف محقَّق' }),
      ],
    })});
  }

  // ── 3 · إيراد الإيجار كلّه إلى المقدَّم — النموذج (ب) ──────────────────────
  // لا يُعترف بإيراد عند الفاتورة. الاعتراف يكون بالإفراج المؤرَّخ وحده.
  for (const no of ['SV-26-07-01', 'SV-26-07-02', 'SV-26-07-03']) {
    const x = c.H[no];
    const dim = { vessel_id: x.vessel, customer_id: x.cust };
    out.push({ tag: 'إيجار ' + no, body: entry(c, {
      journal: 'GJ', date: x.date, event: 'invoice_accrual',
      srcType: 'hire_invoice', srcId: x.id, ref: no,
      desc: `فاتورة إيجار ${no} — UME SHIPPING AB · طرف مرتبط · إلى الإيراد المقدَّم`,
      lines: [
        L('1600', 'debit',  75000.00, 'EUR', null, { ...dim, description: `ذمم طرف مرتبط — ${no}` }),
        L('2300', 'credit', 75000.00, 'EUR', null, { ...dim, description: `إيراد إيجار غير مكتسَب — ${no}` }),
      ],
    })});
  }

  // ── 4 · الإفراج عن المكتسَب في يوليو ────────────────────────────────────
  // 75,000 + 75,000 + (75,000 ÷ 15 يوماً × يوم واحد) = 155,000
  // والباقي 70,000 يبقى في 2300 حتى أغسطس.
  out.push({ tag: 'إفراج يوليو', body: entry(c, {
    journal: 'GJ', date: '2026-07-31', event: 'adjustment', ref: 'REL-2026-07',
    desc: 'الاعتراف بإيراد الإيجار المكتسَب في يوليو 2026 — SV-26-07-01 و 02 كاملتان و 03 بيوم واحد من خمسة عشر',
    lines: [
      L('2300', 'debit',  155000.00, 'EUR', null, { description: 'إفراج عن الإيراد المقدَّم' }),
      L('4010', 'credit', 155000.00, 'EUR', null, { description: 'إيراد إيجار مكتسَب — يوليو 2026' }),
    ],
  })});

  return out;
}

const created = [];

async function draft() {
  const p = await plan();
  console.log(`\n⏳ إنشاء ${p.length} مسوّدة — لا ترحيل في هذه الخطوة\n`);
  const rows = [];
  for (const { tag, body } of p) {
    const r = await fetch(B + '/api/accounting/entries', { method: 'POST', headers: H(), body: JSON.stringify(body) });
    const b = await r.json().catch(() => null);
    if (r.ok) { created.push(b.id); rows.push({ البند: tag, الحالة: b.status, 'مدين EUR': money(b.total_debit_eur), 'دائن EUR': money(b.total_credit_eur) }); }
    else rows.push({ البند: tag, الحالة: '✘ ' + r.status, 'مدين EUR': '', 'دائن EUR': (b?.message || '').slice(0, 70) });
  }
  console.table(rows);
  const okRows = rows.filter((x) => x.الحالة === 'draft');
  const sum = okRows.reduce((a, x) => a + Number(x['مدين EUR']), 0);
  console.log(`\n✔ ${okRows.length} مسوّدة · مجموع المدين ${sum.toFixed(2)} EUR`);
  if (okRows.length !== p.length) console.warn('⚠ ليست كلها نجحت — راجع الصفوف المعلَّمة ✘ قبل الترحيل');
  console.log('راجع الجدول. ثم:  GUBAL.post()   أو للتراجع:  GUBAL.undo()\n');
  return created.length;
}

async function post() {
  if (!created.length) { console.warn('لا مسوّدات في هذه الجلسة — شغّل GUBAL.draft() أولاً'); return; }
  console.log(`\n⚠️ ترحيل ${created.length} قيداً. بعد هذا لا تعديل ولا حذف — العكس وحده ممكن.\n`);
  const rows = [];
  for (const id of created) {
    const r = await fetch(`${B}/api/accounting/entries/${id}/post`, { method: 'POST', headers: H() });
    const b = await r.json().catch(() => null);
    rows.push({ 'رقم القيد': b?.entry_no || '—', الحالة: r.ok ? b.status : '✘ ' + r.status,
                'مدين EUR': r.ok ? money(b.total_debit_eur) : (b?.message || '').slice(0, 70) });
  }
  console.table(rows);
  console.log('\nتحقّق:  GUBAL.check()\n');
}

async function undo() {
  for (const id of created) {
    await fetch(`${B}/api/accounting/entries/${id}/void`, { method: 'POST', headers: H(),
      body: JSON.stringify({ reason: 'إلغاء مسوّدات تجربة Gubal يوليو قبل الترحيل' }) });
  }
  console.log(`أُلغيت ${created.length} مسوّدة. المُرحَّل — إن وُجد — لا يُلغى بهذا.`);
  created.length = 0;
}

async function check() {
  const tb = await G('/api/accounting/trial-balance?legal_entity_id=' + E);
  const ent = await G('/api/accounting/entries');
  console.table(tb.accounts.map((a) => ({ الحساب: a.code + ' ' + a.name, 'مدين': money(a.debit_eur), 'دائن': money(a.credit_eur) })));
  console.log(`\nالقيود ${ent.length} · مدين ${tb.total_debit_eur} · دائن ${tb.total_credit_eur} · متوازن ${tb.is_balanced}`);
}

window.GUBAL = { draft, post, undo, check, plan };
console.log('%cجاهز. ابدأ بـ  GUBAL.draft()', 'font-weight:bold;font-size:14px');
})();
