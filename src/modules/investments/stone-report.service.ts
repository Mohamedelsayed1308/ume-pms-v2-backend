import { Injectable, InternalServerErrorException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import {
  buildFigures, allowedNumbers, unmatchedNumbers, systemPrompt, userMessage,
  REPORT_TOOL, type ReportLang, type CardLike, type ReportFigures,
} from './stone-report';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * الموديل بقرار المالك (٤ سبتمبر ٢٠٢٦): Opus 5. ويُضبط من البيئة إن تغيّر.
 * وإن رفضه المفتاح يوماً يرتدّ إلى موديل Ask UME بدل أن يسقط التقرير.
 */
const MODEL = process.env.STONE_REPORT_MODEL || 'claude-opus-5';
const FALLBACK_MODEL = 'claude-opus-4-8';
/*
 * العربيّة أثقل في الرموز من الإنجليزيّة بنحو الضعف، وصفحة A4 عربيّة مع
 * الأداة قاربت 2,500 رمزاً فقُطعت «الخطوات التالية». فالسقف أعلى، والإيجاز
 * يفرضه الموجّه لا السقف.
 */
const MAX_TOKENS = 5000;

export interface Narrative {
  title: string; headline: string; overview: string; round7: string; round8: string;
  returns: string; risks: string[]; next_steps: string[];
}

export interface ManagementReport {
  generated_at: string;
  lang: ReportLang;
  model: string;
  figures: ReportFigures;
  narrative: Narrative;
  /** حارس الأرقام: ما ذكره السرد ولم يُعطَه. فارغٌ = نظيف. */
  guard: { ok: boolean; unmatched: string[]; retried: boolean };
}

/**
 * تقرير الإدارة — عند الطلب، بلا تخزين.
 *
 * الأرقام تُبنى من الكارت، والنموذج يكتب السرد، والحارس يفحصه. رقمٌ غير
 * مطابق ⇒ محاولةٌ ثانية بتصحيحٍ صريح؛ وإن بقي عُرض التقرير **مع** التحذير.
 */
@Injectable()
export class StoneReportService {
  async generate(card: CardLike, lang: ReportLang, user = ''): Promise<ManagementReport> {
    if (!process.env.ANTHROPIC_API_KEY) throw new InternalServerErrorException('AI is not configured');
    const figures = buildFigures(card);
    const allowed = allowedNumbers(figures);

    let model = MODEL;
    let narrative = await this.ask(model, figures, lang).catch(async (err: any) => {
      // موديلٌ غير متاحٍ للمفتاح — لا يُسقط التقرير
      if (err?.status === 404 || err?.status === 400) { model = FALLBACK_MODEL; return this.ask(model, figures, lang); }
      throw err;
    });

    let unmatched = this.check(narrative, allowed);
    let retried = false;
    if (unmatched.length) {
      retried = true;
      narrative = await this.ask(model, figures, lang,
        `These numbers are not in FIGURES and must be removed or replaced with figures given: ${unmatched.join(', ')}`);
      unmatched = this.check(narrative, allowed);
    }

    // سجلٌّ بلا محتوى — لا أرقام ولا نصّ
    console.log(`[stone-report] user=${user || '?'} lang=${lang} model=${model} guard=${unmatched.length ? 'unmatched:' + unmatched.length : 'ok'}${retried ? ' retried' : ''}`);

    return {
      generated_at: new Date().toISOString(),
      lang, model, figures, narrative,
      guard: { ok: unmatched.length === 0, unmatched, retried },
    };
  }

  private check(nar: Narrative, allowed: Set<string>): string[] {
    const text = [nar.title, nar.headline, nar.overview, nar.round7, nar.round8, nar.returns, ...nar.risks, ...nar.next_steps].join('\n');
    return unmatchedNumbers(text, allowed);
  }

  private async ask(model: string, figures: ReportFigures, lang: ReportLang, retryNote?: string): Promise<Narrative> {
    let res: Anthropic.Message;
    try {
      res = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system: systemPrompt(lang),
        tools: [REPORT_TOOL as any],
        tool_choice: { type: 'tool', name: REPORT_TOOL.name },
        messages: [{ role: 'user', content: userMessage(figures, lang, retryNote) }],
      });
    } catch (err: any) {
      console.error('stone-report error:', err?.status, err?.message);
      if (err?.status === 404 || err?.status === 400) throw err;
      throw new InternalServerErrorException('Report assistant is temporarily unavailable. Please try again.');
    }
    const block = (res.content as any[]).find((b) => b.type === 'tool_use' && b.name === REPORT_TOOL.name);
    if (!block) throw new InternalServerErrorException('Report assistant returned no report. Please try again.');
    // سقف الرموز إن بلغه المخرج قُطع في منتصف قسم — يُسجَّل ليُرى، ولا يُخفى
    if (res.stop_reason === 'max_tokens') console.warn(`[stone-report] output truncated at max_tokens (${MAX_TOKENS}) model=${model} lang=${lang}`);
    const o = (block.input || {}) as Partial<Narrative>;
    const s = (v: unknown) => String(v ?? '').trim();
    const arr = (v: unknown) => (Array.isArray(v) ? v.map(s).filter(Boolean).slice(0, 6) : []);
    return {
      title: s(o.title), headline: s(o.headline), overview: s(o.overview),
      round7: s(o.round7), round8: s(o.round8), returns: s(o.returns),
      risks: arr(o.risks), next_steps: arr(o.next_steps),
    };
  }
}
