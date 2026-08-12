import 'reflect-metadata';
import { AccountingController } from './accounting.controller';
import { REQUIRE_SCREEN } from '../../common/require-screen.decorator';
import {
  SCREEN_ACCOUNTING, SCREEN_ACCOUNTING_JOURNALS, SCREEN_ACCOUNTING_POSTING,
  SCREEN_ACCOUNTING_PERIODS, SCREEN_ACCOUNTING_SETUP,
} from './accounting.constants';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * حارس التفويض — مسار بلا شاشة هو مسار مفتوح
 *
 * `ScreenGuard` يسمح بالمرور عندما **لا توجد** بيانات وصفية للشاشة (`return true`).
 * فنسيان `@RequireScreen` على موجّه واحد لا يُنتج خطأ ولا تحذيراً — يُنتج نقطة
 * نهاية محاسبية مكشوفة لأي مستخدم مسجَّل. هذا الاختبار يمنع ذلك النسيان.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('P1.1A · تفويض نقاط النهاية المحاسبية', () => {
  const KNOWN = [
    SCREEN_ACCOUNTING, SCREEN_ACCOUNTING_JOURNALS, SCREEN_ACCOUNTING_POSTING,
    SCREEN_ACCOUNTING_PERIODS, SCREEN_ACCOUNTING_SETUP,
  ];
  const proto = AccountingController.prototype as any;
  const handlers = Object.getOwnPropertyNames(proto)
    .filter((k) => k !== 'constructor' && k !== 'uid' && typeof proto[k] === 'function');
  const screensOf = (name: string): string[] | undefined =>
    Reflect.getMetadata(REQUIRE_SCREEN, proto[name]);

  it('1. عُثر على كل الموجّهات', () => {
    expect(handlers.length).toBeGreaterThanOrEqual(18);
  });

  it('2. كل موجّه محروس بشاشة صراحةً — لا موجّه مفتوح', () => {
    const open = handlers.filter((h) => !screensOf(h)?.length);
    expect(open).toEqual([]);
  });

  it('3. لا شاشة خارج الخمس المعرَّفة — لا مرجع لشاشة لا وجود لها', () => {
    for (const h of handlers) {
      for (const s of screensOf(h)!) expect(KNOWN).toContain(s);
    }
  });

  it('4. الترحيل والعكس على شاشة الترحيل وحدها — لا يكفيهما إعداد المسوّدات', () => {
    expect(screensOf('post')).toEqual([SCREEN_ACCOUNTING_POSTING]);
    expect(screensOf('reverse')).toEqual([SCREEN_ACCOUNTING_POSTING]);
  });

  it('5. إعداد المسوّدات لا يمنح صلاحية الترحيل — الفصل بين الواجبات', () => {
    for (const h of ['createDraft', 'updateDraft', 'voidDraft']) {
      expect(screensOf(h)).toEqual([SCREEN_ACCOUNTING_JOURNALS]);
      expect(screensOf(h)).not.toContain(SCREEN_ACCOUNTING_POSTING);
    }
  });

  it('6. الإعداد الهيكلي على شاشة الإعداد وحدها', () => {
    for (const h of ['createEntity', 'createJournal', 'createFiscalYear', 'createAccount', 'createFxRate']) {
      expect(screensOf(h)).toEqual([SCREEN_ACCOUNTING_SETUP]);
    }
  });

  it('7. إقفال الفترات وإعادة فتحها على شاشة الفترات وحدها', () => {
    expect(screensOf('closePeriod')).toEqual([SCREEN_ACCOUNTING_PERIODS]);
    expect(screensOf('reopenPeriod')).toEqual([SCREEN_ACCOUNTING_PERIODS]);
  });

  it('8. لا موجّه DELETE على القيود إطلاقاً — الإلغاء والعكس فقط', () => {
    expect(handlers).not.toContain('deleteEntry');
    expect(handlers).not.toContain('remove');
    expect(handlers).toContain('voidDraft');
    expect(handlers).toContain('reverse');
  });
});
