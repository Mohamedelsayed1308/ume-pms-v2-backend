import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProfitPeriod } from './profit-period.entity';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { calculateDistribution, calculateProposed, daysBetween } from './profit-model';

/**
 * تفصيل رحلةٍ واحدة كما يحمله دفتر المركب.
 *
 * يُخزَّن مع الفترة لا يُجلَب عند العرض — **لأنّ الدفتر يتغيّر**. رأينا ذلك:
 * تحصيل صفاجا لأمل في ١٨–٣١ يوليو صُحِّح بعد إصدار المستند بـ ١٢٬٨٩٨.٩٠.
 * فجلبُ التفصيل لاحقاً يعرض أرقاماً لا تجمع إلى التوزيع المحفوظ — وذلك أسوأ
 * من ألّا يُعرض شيء. والمخزَّن دليلٌ على ما حُسب، لا صورةٌ متحرّكة.
 *
 * وعمودا `Dianna` و`Mafis` في المستند لا وجود لهما في الدفتر: فيه عمود
 * `TRUCK` واحد، ومن يُعدّ المستند هو من يقسمه. فتُعرض الشاحنات مجموعةً.
 */
export interface VoyageRow {
  ref: number | null;
  dateExp: string; dateImp: string;
  nTruckE: number; nTruckI: number; truck: number;
  nVehE: number; nVehI: number; veh: number;
  nPaxE: number; nPaxI: number; pax: number;
  income: number; comm: number; man: number; net: number;
  cashDuba: number; cashSafaga: number; overPax: number;
  /**
   * رسوم ميناء مصر — `EGY - PORT EXP.` في الدفتر (الحقل `pg`).
   *
   * **وهو البند التقديريّ.** يُكتب ١١٬٥٠٠ في كلّ رحلة حتّى تصل الفاتورة، ثمّ
   * يُستبدل بالفعليّ. فيُلتقط مع اللقطة ليُعرف — حين يتغيّر التوزيع بعد
   * المصادقة — أفي بندٍ تقديريٍّ كان الفرق أم في بندٍ نهائيّ.
   *
   * ورسوم ميناء السعوديّة `pk` تختلف من رحلةٍ لأخرى لأنّها واقعة، فلا تُلتقط.
   */
  egyPort: number;

  /*
   * ── حارسا النزاهة ──
   *
   * `balanceGap` = BALANCE − (الإيراد − العمولة − المصاريف)
   *   رصيدٌ لا يساوي بنوده. ثمانٍ وثلاثون رحلة في الدفاتر تحمله اليوم، وأكبرها
   *   بوسيدون ٧٨ بفارق ٣٤٠٬٧٦٠.٠٧ — خليّتا ميناءٍ فيها ٩٩٬٠٠٠ و٢٥٣٬٠٠٠ بينما
   *   الرحلة التي تسبقها بيومين فيها ٤٬٥٠٠ و١١٬٥٠٠.
   *
   * `treasuryGap` = (نقد ضبا + تحصيل صفاجا) − (BALANCE + البنكر)
   *   يكشف صيغةً دِيست بقيمةٍ مكتوبة. والدفتر يحرّره موظّفون مختلفون يومياً،
   *   فلا يُوثَق بعمود `CHECK` فيه: من يلصق رقماً فوق صيغةٍ يُسكتها بلا أثر.
   *   ولهذا يُعاد الفحص هنا لا يُقرأ من هناك.
   *
   * ويُخزَّنان مع اللقطة، فيبقى الكشف المحفوظ شاهداً على حال الدفتر يومئذٍ.
   */
  balanceGap: number;
  treasuryGap: number;
}

/** ما دون هذا تدويرٌ. وأصغر مخالفةٍ حقيقيّة في الدفاتر ٤٥٧.٥٤ — فلا ضجيج بينهما. */
export const INTEGRITY_TOLERANCE = 0.02;

/**
 * التوزيع شراكةُ خطّ ضبا/سفاجا وحده.
 *
 * دليلة تُبحر على جدّة/سواكن منذ يناير ٢٠٢٦، ولهذا تظهر صفراً في مستندات
 * التوزيع رغم نشاطها. والقيد بالخطّ هو ما يجعل الكشف يُطابق الورقة.
 */
export const DISTRIBUTION_LINE = 'ضبا/سفاجا';

@Injectable()
export class ProfitPeriodsService {
  constructor(
    @InjectRepository(ProfitPeriod) private repo: Repository<ProfitPeriod>,
  ) {}

  findAll() {
    return this.repo.find({ order: { date_from: 'DESC' } });
  }

  findOne(id: string) {
    return this.repo.findOne({ where: { id } });
  }

  async create(data: any) {
    const period = this.repo.create(data);
    return this.repo.save(period);
  }

  /**
   * التعديل — ويمتنع على فترةٍ مُصادَقٍ عليها.
   *
   * المصادقة تُجمّد الرقم الذي يُحوَّل إلى البنك. فالكتابة فوقها تُغيّر رقماً
   * صدر وتُلغي معنى التجميد، ولا يظهر ذلك في أيّ مكان. والطريق إلى التعديل
   * فكُّ المصادقة بسببٍ مكتوب — فيبقى الأثر.
   *
   * ويُستثنى حقلا اللقطة الحديثة: يكتبهما النظام لا المستخدم، ولا يمسّان
   * المُجمَّد بل يستقرّان بجواره ليُقارَن.
   */
  async update(id: string, data: any) {
    const cur = await this.findOne(id);
    if (cur?.ratified_at) {
      const allowed = new Set(['latest_snapshot', 'latest_fetched_at']);
      const touched = Object.keys(data || {}).filter((k) => !allowed.has(k));
      if (touched.length) {
        throw new BadRequestException(
          'الفترة مُصادَقٌ عليها ومُقفلة — فُكَّ المصادقة بسببٍ مكتوب قبل التعديل',
        );
      }
    }
    await this.repo.update(id, data);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.repo.delete(id);
    return { deleted: true };
  }

  /**
   * جلب الفترة من الشيت الموحّد.
   *
   * المسار الآخر يمرّ عبر Apps Script يقرأ إكسل درايف — وهو المصدر القديم نفسه
   * الذي صار الشيت يسحبه ثلاث مرّات يومياً. فالقراءة من الشيت مباشرةً تُلغي
   * وسيطاً وتُصيب النسخة التي عليها بقيّة النظام.
   *
   * ── لماذا يُنتقى برقم الرحلة لا بالتاريخ ──
   * رحلات المراكب **لا تتزامن**. بوسيدون 60→64 يقع بين 21 يونيو و3 يوليو، ومدىً
   * تقويميّ يغطّيه يلتقط من أمل رحلاتٍ أخرى تماماً. فالفترة تُحدَّد برقم الرحلة
   * لكل مركب على حدة، والتاريخ يبقى بديلاً لمن لا مدى له.
   *
   * والرقم **يتكرّر كل سنة**، فالسنة تُشتقّ من `dateFrom` وتدخل الانتقاء — وإلا
   * جُمعت رحلةُ 2025 مع رحلة 2026 تحملان الرقم نفسه.
   *
   * ── ولماذا يُقيَّد بالخطّ ──
   * دليلة تعمل على خطّين: ٤١ رحلة على ضبا/سفاجا حتّى سبتمبر ٢٠٢٥، ثمّ ١٢٠ رحلة
   * على جدّة/سواكن من يناير ٢٠٢٦. و**أرقام الرحلات تبدأ من ١ في كلّ خطّ**، فمدىً
   * بالرقم وحده يخلط سلسلتين لا تجمعهما فترة.
   *
   * والتوزيع شراكةُ خطّ ضبا/سفاجا وحده — ولهذا تظهر دليلة صفراً في المستندات
   * الثلاثة رغم أنّها كانت تُبحر. فبلا هذا القيد تتسرّب رحلاتها من الخطّ الآخر
   * فتنقلب القسمة من شريكين إلى ثلاثة، ويتغيّر كلّ رقمٍ في الكشف.
   *
   * ── ما لا يأتي منه ──
   * `cash_safaga` **دفعاتٌ مصروفة** لا إيراد، ولا وجود لها في دفتر المركب. تُترك
   * كما هي ولا تُصفَّر: تصفيرُها يرفع نتيجة النشاط بمقدارها بلا أن يُنبّه أحد.
   */
  async fetchFromUnifiedSheet(
    dateFrom: string, dateTo: string,
    ranges?: Record<string, { from?: number; to?: number } | undefined>,
    line?: string,
  ) {
    const SHEET_ID = process.env.FLEET_SHEET_ID || '1G7VU_z7WDZK6kq-7Sk_iLztJzmP-HlXe4ke6UtFn4fM';
    let rows: any[][];
    try {
      const res = await axios.get(
        `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`,
        { responseType: 'arraybuffer', timeout: 60000 },
      );
      const wb = XLSX.read(Buffer.from(res.data), { type: 'buffer' });
      const ws = wb.Sheets['DATA'];
      if (!ws) throw new Error('ورقة DATA غير موجودة في الشيت');
      rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    } catch (err: any) {
      throw new Error('تعذّر قراءة الشيت الموحّد: ' + (err?.message || 'خطأ'));
    }

    const KEYS: Record<string, string> = { POSEIDON: 'poseidon', AMAL: 'amal', DALEELA: 'daleela' };
    const year = Number(String(dateFrom).slice(0, 4)) || null;
    const blank = () => ({ revenue: 0, voyages: 0, commission: 0, bunker: 0,
      sdBase: 0, liquidity: 0, overPax: 0,
      // الخزينة — يحسبها دفتر المركب منذ أغسطس ٢٠٢٦، ولا تُدخَل يداً
      cashDuba: 0, cashSafaga: 0, offHire: 0, treasuryRows: 0,
      // تفصيل كلّ رحلة — يُخزَّن مع الفترة دليلاً على ما حُسب منه
      voyageRows: [] as VoyageRow[],
      // رحلاتٌ لا يتّسق فيها الدفتر مع نفسه — تُعدّ وتُسمّى، ولا تُبتلع
      balanceMismatch: [] as { ref: number | null; date: string; gap: number }[],
      treasuryMismatch: [] as { ref: number | null; date: string; gap: number }[],
      refs: [] as number[], firstDate: null as string | null, lastDate: null as string | null,
      by: 'date' as 'date' | 'ref' });
    const out: any = { poseidon: blank(), amal: blank(), daleela: blank() };

    const rangeOf = (key: string) => {
      const r = ranges && ranges[key];
      if (!r) return null;
      const from = Number(r.from), to = Number(r.to);
      if (!isFinite(from) || !isFinite(to) || from <= 0 || to <= 0) return null;
      return { from: Math.min(from, to), to: Math.max(from, to) };
    };
    for (const k of Object.keys(out)) if (rangeOf(k)) out[k].by = 'ref';

    const dates: Record<string, string[]> = { poseidon: [], amal: [], daleela: [] };

    // الخطّ يُكتب بالشدّة وبدونها ويحمل مسافاتٍ زائدة — تُسوّى قبل المقارنة،
    // وإلّا رُفض صفٌّ صحيح لفرقٍ في تشكيلٍ لا يراه القارئ.
    const normLine = (s: unknown) =>
      String(s || '').replace(/[ً-ْـ]/g, '').replace(/\s+/g, '').trim();
    // التسوية **قبل** الرجوع إلى الافتراضيّ: خطٌّ من مسافاتٍ وحدها يجتاز
    // `||` لأنّه غير فارغ، ثمّ يُسوّى إلى فراغ فيُعطّل الحارس صامتاً.
    const effectiveLine = normLine(line) ? String(line) : DISTRIBUTION_LINE;
    const wantLine = normLine(effectiveLine);
    let offLine = 0;

    for (const row of rows) {
      const raw = row && row[10];
      if (!raw) continue;
      let p: any;
      try { p = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { continue; }
      const key = KEYS[String(p?.vessel || '').toUpperCase()];
      if (!key) continue;

      // خطٌّ آخر: يُعدّ ويُبلَّغ به، ولا يُجمع. الصمت هنا يُغيّر القسمة كلّها.
      if (wantLine && p.line && normLine(p.line) !== wantLine) { offLine++; continue; }

      // التاريخ من المغادرة، وعند غيابه من الوصول — كما تفعل بقيّة الشاشات
      const d = String(p.dateExp || p.dateImp || '').slice(0, 10);
      const rng = rangeOf(key);
      if (rng) {
        const ref = Number(p.ref);
        if (!isFinite(ref) || ref < rng.from || ref > rng.to) continue;
        if (year && Number(p.year) && Number(p.year) !== year) continue;
        out[key].refs.push(ref);
      } else {
        if (!d || d < dateFrom || d > dateTo) continue;
      }

      out[key].revenue += Number(p.income) || 0;
      out[key].commission += Number(p.comm) || 0;
      out[key].bunker += Number(p.bnk) || 0;
      // أساس عمولة المستند ليس الإيراد بل شاحنات رحلة الذهاب وحدها. طوبق
      // `trE` على ستّ حالاتٍ في المستندات فأصاب خمساً بصفر فرق، والسادسة
      // زادت بمقدار تحصيل صفاجا — تسويةٌ بشريّة مكانها حقل التعديل لا هنا.
      out[key].sdBase += Number(p.trE) || 0;
      // سيولة الدفتر — بقيت للمراجعة وحدها بعد أن صار نقد ضبا محسوباً في الدفتر
      out[key].liquidity += Number(p.liq) || 0;

      /*
       * الخزينة من الدفتر مباشرةً.
       *
       * `cashSafaga` صافي رِجل الصادر — طوبق بالسنت على مستند ١٨–٣١ يوليو.
       * و`cashDuba` صافي رِجل الوارد مردوداً إليه بنكرها، لأنّ المستند يخصم
       * حصّة الوقود المشتركة لاحقاً فبقاؤه مخصوماً يطرحه مرّتين.
       *
       * و`treasuryRows` تعدّ الرحلات التي وصلت خزينتها فعلاً: دفترٌ لم تُملأ
       * أعمدته يُنتج أصفاراً تبدو أرقاماً، والعدّ يكشفها قبل أن تُصدَّق.
       */
      const cd = Number(p.cashDuba) || 0;
      const cs = Number(p.cashSafaga) || 0;
      out[key].cashDuba += cd;
      out[key].cashSafaga += cs;
      out[key].overPax += Number(p.overPax) || 0;
      out[key].offHire += Number(p.offHire) || 0;
      if (cd || cs) out[key].treasuryRows += 1;

      const r2 = (x: any) => Math.round((Number(x) || 0) * 100) / 100;
      const i0 = (x: any) => Math.round(Number(x) || 0);
      const vIncome = r2(p.income), vComm = r2(p.comm), vMan = r2(p.man), vNet = r2(p.net);
      const vBnk = r2(p.bnk);
      const balanceGap = r2(vNet - (vIncome - vComm - vMan));
      const treasuryGap = r2(cd + cs - (vNet + vBnk));
      if (Math.abs(balanceGap) > INTEGRITY_TOLERANCE) {
        out[key].balanceMismatch.push({ ref: Number(p.ref) || null, date: d, gap: balanceGap });
      }
      if ((cd || cs) && Math.abs(treasuryGap) > INTEGRITY_TOLERANCE) {
        out[key].treasuryMismatch.push({ ref: Number(p.ref) || null, date: d, gap: treasuryGap });
      }
      out[key].voyageRows.push({
        ref: isFinite(Number(p.ref)) ? Number(p.ref) : null,
        dateExp: String(p.dateExp || '').slice(0, 10),
        dateImp: String(p.dateImp || '').slice(0, 10),
        nTruckE: i0(p.nTruck_E), nTruckI: i0(p.nTruck_I),
        truck: r2((Number(p.trE) || 0) + (Number(p.trI) || 0)),
        nVehE: i0(p.nVeh_E), nVehI: i0(p.nVeh_I),
        veh: r2((Number(p.vhE) || 0) + (Number(p.vhI) || 0)),
        nPaxE: i0(p.nPax_E), nPaxI: i0(p.nPax_I),
        pax: r2((Number(p.pxE) || 0) + (Number(p.pxI) || 0)),
        income: vIncome, comm: vComm, man: vMan, net: vNet,
        cashDuba: r2(cd), cashSafaga: r2(cs), overPax: r2(p.overPax),
        egyPort: r2(Number(p.pg) || 0),
        balanceGap, treasuryGap,
      });

      out[key].voyages += 1;
      if (d) dates[key].push(d);
    }

    let matched = 0;
    for (const k of Object.keys(out)) {
      out[k].revenue = Math.round(out[k].revenue * 100) / 100;
      out[k].commission = Math.round(out[k].commission * 100) / 100;
      out[k].bunker = Math.round(out[k].bunker * 100) / 100;
      out[k].sdBase = Math.round(out[k].sdBase * 100) / 100;
      out[k].liquidity = Math.round(out[k].liquidity * 100) / 100;
      for (const f of ['cashDuba', 'cashSafaga', 'overPax', 'offHire'] as const) {
        out[k][f] = Math.round(out[k][f] * 100) / 100;
      }
      // رحلاتٌ لها نشاط ولا خزينة: عمودٌ لم يُملأ في الدفتر، يُبلَّغ ولا يُبتلع
      if (out[k].voyages > 0 && out[k].treasuryRows < out[k].voyages) {
        out[k].treasuryMissing = out[k].voyages - out[k].treasuryRows;
      }
      out[k].refs.sort((a: number, b: number) => a - b);
      // الترتيب برقم الرحلة ثمّ بالتاريخ — كما يسردها المستند
      out[k].voyageRows.sort((a: VoyageRow, b: VoyageRow) =>
        (a.ref ?? 0) - (b.ref ?? 0) || a.dateExp.localeCompare(b.dateExp));
      dates[k].sort();
      out[k].firstDate = dates[k][0] || null;
      out[k].lastDate = dates[k][dates[k].length - 1] || null;
      matched += out[k].voyages;
      // مدىً طُلب ولم يكتمل: نقصٌ يجب أن يُرى لا أن يُجمع بصمت
      const rng = rangeOf(k);
      if (rng) {
        const want = rng.to - rng.from + 1;
        out[k].expected = want;
        out[k].missing = [];
        for (let i = rng.from; i <= rng.to; i++) if (out[k].refs.indexOf(i) < 0) out[k].missing.push(i);
      }
    }
    out.source = {
      kind: 'unified-sheet',
      fetchedAt: new Date().toISOString(),
      matched,
      year,
      line: effectiveLine,
      offLine,
      note: 'الخزينة تأتي من دفتر المركب — لا إدخال يدويّ',
      manualInputs: [],
    };
    return out;
  }

  private readonly APPS_SCRIPT_URL =
    'https://script.google.com/macros/s/AKfycbxmnoBIXKK94r_fJWYd2u-Jo2u8izhx1HH8be7OQR9gzF506bXKrKOnFy3VBRaTMcJI4A/exec';

  // ── جلب البيانات من Google Apps Script Web App ───────────────────────────
  async fetchFromGoogleDrive(
    fileId: string, dateFrom: string, dateTo: string,
    voyFrom?: number, voyTo?: number,
  ) {
    const params: any = { date_from: dateFrom, date_to: dateTo };
    if (voyFrom != null && voyTo != null) {
      params.voy_from = voyFrom;
      params.voy_to   = voyTo;
    }
    const res = await axios.get(this.APPS_SCRIPT_URL, {
      params,
      timeout: 60000,
      maxRedirects: 10,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    console.log('[apps-script] response:', JSON.stringify(res.data));
    return res.data;
  }

  // ── جلب تواريخ نطاق رحلات Poseidon ──────────────────────────────────────
  async fetchVoyageDates(voyageFrom: number, voyageTo: number) {
    const res = await axios.get(this.APPS_SCRIPT_URL, {
      params: { voyage_from: voyageFrom, voyage_to: voyageTo },
      timeout: 30000,
      maxRedirects: 10,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    return res.data;
  }

  /**
   * حساب التوزيع على معادلة المستند المعتمد.
   *
   * المعادلة نفسها في `profit-model.ts` — دالّةٌ خالصة تحرسها اختباراتٌ تُعيد
   * إنتاج مستندَي يوليو ٢٠٢٦ رقماً رقماً. هنا مجرّد ترجمةٍ من صفوف الجدول
   * إلى مدخلات المحرّك.
   *
   * ويُعاد معها ناتج المعادلة السابقة تحت `legacy` — لا لأنّها صحيحة، بل
   * لأنّ فتراتٍ حُسبت بها وعُرضت على الشركاء، ومحوُ الرقم القديم يُخفي الفرق
   * بدل أن يُظهره. الفرق بينهما هو نفسه معلومةٌ تستحقّ العرض.
   *
   * و`proposed` هي **الطريقة المقترحة** — تبدأ من صافي الإيراد لا من النقد،
   * ولا عمولة توكيل فيها. تُحسب بجوار المعتمدة ولا تحلّ محلّها، والغرض
   * المقارنة. مدخلاتها هي مدخلات المعتمدة نفسها، فلا يفترقان في رقمٍ مقروء.
   */
  /**
   * صافي إيراد مركبٍ في الفترة — مجموع عمود «الصافي» في تفصيل الرحلات الملتقَط.
   *
   * ليس عموداً محفوظاً في الجدول، فلا هجرة له. واللقطة `voyage_detail` مخزَّنةٌ
   * مع الفترة أصلاً وتحمل `net` لكلّ رحلة، فتُجمع منها. و`undefined` إن لم توجد
   * لقطةٌ للمركب — والمحرّك يُعلن الطريقة «غير متاحة» ولا يحسبها بأصفار.
   */
  private netRevenueOf(p: ProfitPeriod, key: string): number | undefined {
    const detail = p.voyage_detail as Record<string, unknown> | null | undefined;
    const rows = detail && (detail as any)[key];
    if (!Array.isArray(rows) || !rows.length) return undefined;
    const sum = rows.reduce((a: number, r: any) => a + (Number(r?.net) || 0), 0);
    return Math.round(sum * 100) / 100;
  }

  calculate(p: ProfitPeriod) {
    const n = (v: any) => Number(v) || 0;
    const days = daysBetween(p.date_from, p.date_to);

    const input = {
      days,
      commissionRate: n(p.commission_rate) || 6.5,
      // الرسم الثابت ٥٠٠ للرحلة في المستندات الثلاثة. وصفرُ المخزَّن يعني
      // «لم يُملأ» لا «لا رسم» — فترةٌ قديمة حُفظت قبل أن يُستعمل الحقل.
      perVoyageFee: n(p.per_voyage_fee) || 500,
      vessels: [
        {
          key: 'poseidon', name: 'بوسيدون',
          voyages: n(p.poseidon_voyages),
          sdBase: n(p.poseidon_sd_base), sdAdjust: n(p.poseidon_sd_adjust),
          fuel: n(p.poseidon_fuel), fuelAdjust: n(p.poseidon_fuel_adjust),
          cashDuba: n(p.poseidon_cash_duba),
          netCollected: n(p.poseidon_net_collected),
          dailyRate: n(p.poseidon_daily_rate) || 14000,
          revenue: n(p.poseidon_revenue),
          overPax: n(p.poseidon_over_pax),
          overPaxSafaga: n(p.poseidon_over_pax_safaga),
          fuelSupply: n(p.poseidon_fuel_supply),
          offHireSettlement: n(p.poseidon_off_hire),
          liquidity: n(p.poseidon_liquidity) || undefined,
          netRevenue: this.netRevenueOf(p, 'poseidon'),
        },
        {
          key: 'amal', name: 'أمل',
          voyages: n(p.amal_voyages),
          sdBase: n(p.amal_sd_base), sdAdjust: n(p.amal_sd_adjust),
          fuel: n(p.amal_fuel), fuelAdjust: n(p.amal_fuel_adjust),
          cashDuba: n(p.amal_cash_duba),
          netCollected: n(p.amal_net_collected),
          dailyRate: n(p.amal_daily_rate) || 13000,
          revenue: n(p.amal_revenue),
          overPax: n(p.amal_over_pax),
          overPaxSafaga: n(p.amal_over_pax_safaga),
          fuelSupply: n(p.amal_fuel_supply),
          offHireSettlement: n(p.amal_off_hire),
          liquidity: n(p.amal_liquidity) || undefined,
          netRevenue: this.netRevenueOf(p, 'amal'),
        },
        {
          key: 'daleela', name: 'دليلة',
          voyages: n(p.daleela_voyages),
          sdBase: n(p.daleela_sd_base), sdAdjust: n(p.daleela_sd_adjust),
          fuel: n(p.daleela_fuel), fuelAdjust: n(p.daleela_fuel_adjust),
          cashDuba: n(p.daleela_cash_duba),
          netCollected: n(p.daleela_net_collected),
          dailyRate: n(p.daleela_daily_rate) || 12000,
          revenue: n(p.daleela_revenue),
          overPax: n(p.daleela_over_pax),
          overPaxSafaga: n(p.daleela_over_pax_safaga),
          fuelSupply: n(p.daleela_fuel_supply),
          offHireSettlement: n(p.daleela_off_hire),
          liquidity: n(p.daleela_liquidity) || undefined,
          netRevenue: this.netRevenueOf(p, 'daleela'),
        },
      ],
    };

    const model = calculateDistribution(input);

    // تعديلٌ يدويّ بلا سببٍ مكتوب: يُحسَب ويُعلَن، ولا يمرّ صامتاً.
    const hasAdjust =
      n(p.poseidon_sd_adjust) || n(p.poseidon_fuel_adjust) ||
      n(p.amal_sd_adjust) || n(p.amal_fuel_adjust) ||
      n(p.daleela_sd_adjust) || n(p.daleela_fuel_adjust);
    if (hasAdjust && !String(p.adjust_reason || '').trim()) {
      model.warnings.push('تعديلٌ يدويّ بلا سببٍ مكتوب — سجّل السبب في «سبب التعديل»');
    }

    return { ...model, proposed: calculateProposed(input), legacy: this.calculateLegacy(p) };
  }

  /**
   * المعادلة السابقة — محفوظةٌ للمقارنة وحدها.
   *
   * تبدأ من الإيراد لا من النقد، ولا تطرح الوقود ولا العمولة، وتُضيف الوقود
   * حيث يطرحه المستند. أثرها في الفترات الثلاث المقارَنة: مبالغةٌ في نصيب
   * كلّ شريك بين ٤٢٨ ألفاً و٦٨٣ ألف دولار.
   */
  private calculateLegacy(p: ProfitPeriod) {
    const n = (v: any) => Number(v) || 0;

    const DAILY_RATES = { poseidon: 14000, amal: 13000, daleela: 12000 };
    const days = Math.max(0, Math.round(
      (new Date(p.date_to).getTime() - new Date(p.date_from).getTime()) / (1000 * 60 * 60 * 24)
    ) + 1);
    const poseidonRent = days * DAILY_RATES.poseidon;
    const amalRent     = days * DAILY_RATES.amal;
    const daleelaRent  = n(p.daleela_revenue) > 0 ? days * DAILY_RATES.daleela : 0;

    // الإيراد الإجمالي (Over Pax داخل إيراد العبارة من الشيت)
    const totalRevenue = n(p.poseidon_revenue) + n(p.amal_revenue) + n(p.daleela_revenue);
    const totalRent    = poseidonRent + amalRent + daleelaRent;
    const totalCommission = n(p.commission_amount);

    // الأساس الموزَّع = إيراد - إيجار
    const netForDistribution = totalRevenue - totalRent;
    const distributionBadawi  = netForDistribution * (n(p.ratio_badawi)  / 100);
    const distributionIttihad = netForDistribution * (n(p.ratio_ittihad) / 100);

    // توزيع Over Pax حسب معادلة Excel
    const overPaxBadawi  = n(p.poseidon_over_pax) * (2/3) + n(p.daleela_over_pax) * (1/3);
    const overPaxIttihad = n(p.poseidon_over_pax) * (1/3) + n(p.amal_over_pax) + n(p.daleela_over_pax) * (2/3);

    // نتيجة نشاط = توزيع - كاش + overPax_share + إيجار العبارة + بنكر
    const activityBadawi  = distributionBadawi  - n(p.cash_safaga_badawi)  + overPaxBadawi  + poseidonRent + n(p.bunker_badawi);
    const activityIttihad = distributionIttihad - n(p.cash_safaga_ittihad) + overPaxIttihad + amalRent + daleelaRent + n(p.bunker_ittihad);

    const balanceBadawi  = n(p.balance_prev_badawi)  + activityBadawi  - n(p.transfers_badawi);
    const balanceIttihad = n(p.balance_prev_ittihad) + activityIttihad - n(p.transfers_ittihad);

    return {
      totalRevenue, totalRent, totalCommission,
      netForDistribution,
      distributionBadawi, distributionIttihad,
      overPaxBadawi, overPaxIttihad,
      activityBadawi, activityIttihad,
      balanceBadawi, balanceIttihad,
      days, poseidonRent, amalRent, daleelaRent,
    };
  }
}
