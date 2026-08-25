import {
  Controller,
  Post,
  Body,
  Request,
  UseGuards,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import Anthropic from '@anthropic-ai/sdk';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import {
  EMAIL_REWRITE_THROTTLER,
  EMAIL_REWRITE_LIMIT,
  EMAIL_REWRITE_TTL_MS,
} from '../../common/rate-limit';
import {
  SYSTEM_PROMPT,
  DRAFT_EMAIL_TOOL,
  buildUserMessage,
  RECIPIENTS,
  PURPOSES,
  TONES,
  LANGUAGES,
  ADJUSTMENTS,
  MAX_DRAFT,
  MAX_INCOMING,
  type RewriteInput,
  type Recipient,
  type Purpose,
  type Tone,
  type Language,
  type Adjust,
} from './email-rewrite.prompt';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * الموديل من البيئة مع ارتدادٍ إلى موديل Ask UME.
 *
 * فالمهمّة هنا صياغةٌ لا استدلال: لا أرقام تُحسب ولا أدوات تُنفَّذ. وضبط
 * `EMAIL_MODEL` على موديلٍ من فئة Sonnet يُنقص الكلفة كثيراً بلا أثرٍ محسوس.
 */
const MODEL = process.env.EMAIL_MODEL || 'claude-opus-4-8';
const MAX_TOKENS = 1500;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * إعادة صياغة الإيميلات
 *
 * ── لا قاعدة بيانات ──
 * لا `Repository` ولا `TypeOrmModule` في هذه الوحدة، عن قصد. فالإصدار الأوّل
 * نصٌّ يدخل ونصٌّ يخرج؛ ولا يُرسَل شيء ولا يُخزَّن شيء على الخادم. وسجلُّ
 * المستخدم يعيش في متصفّحه وحده.
 *
 * ── ولماذا `JwtAuthGuard` وحده ──
 * الشاشة `always: true` — متاحةٌ لكلّ مستخدم. و`ScreenGuard` يقرأ
 * `allowed_screens`، وغيرُ الأدمن ليس له فيها سطرٌ لهذه الشاشة، فيمنعه الحارس
 * بالخطأ ويطلب منحاً لا معنى له. فالمصادقة كافية، والحدُّ يحرس الكلفة.
 * ═══════════════════════════════════════════════════════════════════════════
 */
@Controller('api/email')
@UseGuards(JwtAuthGuard, ThrottlerGuard)
export class EmailRewriteController {
  @Post('rewrite')
  @Throttle({
    [EMAIL_REWRITE_THROTTLER]: {
      limit: EMAIL_REWRITE_LIMIT,
      ttl: EMAIL_REWRITE_TTL_MS,
    },
  })
  async rewrite(@Request() req: any, @Body() body: Partial<RewriteInput>) {
    const input = validate(body);
    if (!process.env.ANTHROPIC_API_KEY)
      throw new InternalServerErrorException('AI is not configured');

    let res: Anthropic.Message;
    try {
      res = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: [DRAFT_EMAIL_TOOL],
        // نداءٌ واحد: الأداة تضمن شكل المخرج، ولا شيء يُنفَّذ فلا حاجة لحلقة.
        tool_choice: { type: 'tool', name: DRAFT_EMAIL_TOOL.name },
        messages: [{ role: 'user', content: buildUserMessage(input) }],
      });
    } catch (err: any) {
      // لا متن ولا مخرج ولا أسرار — رمز الحالة والرسالة فقط.
      console.error('email-rewrite error:', err?.message, err?.status);
      throw new InternalServerErrorException(
        'Email assistant is temporarily unavailable. Please try again.',
      );
    }

    const block = (res.content as any[]).find(
      (b) => b.type === 'tool_use' && b.name === DRAFT_EMAIL_TOOL.name,
    );
    if (!block) {
      console.error('email-rewrite error: no tool_use block', res.stop_reason);
      throw new InternalServerErrorException(
        'Email assistant is temporarily unavailable. Please try again.',
      );
    }

    const out = (block.input || {}) as {
      subject?: string;
      body?: string;
      language?: Language;
      missing?: string[];
    };

    /*
     * سجلٌّ بلا محتوى.
     *
     * لا المسودّة ولا الوارد ولا المخرج ولا جزءٌ من أيٍّ منها. فما يُطبع هنا
     * يعيش في سجلّات Railway، ومراسلاتُ الشركة ليست مكانها هناك.
     */
    console.log(
      `[email-rewrite] user=${req.user?.id || '?'} to=${input.recipient} purpose=${input.purpose}` +
        ` lang=${input.language}${input.adjust ? ` adjust=${input.adjust}` : ''}` +
        ` tok=${res.usage?.input_tokens || 0}/${res.usage?.output_tokens || 0}`,
    );

    return {
      subject: String(out.subject || ''),
      body: String(out.body || ''),
      language: (LANGUAGES as readonly string[]).includes(
        out.language as string,
      )
        ? out.language
        : input.language,
      missing: Array.isArray(out.missing)
        ? out.missing.map(String).slice(0, 12)
        : [],
    };
  }
}

/**
 * التحقّق **قبل** أيّ نداءٍ خارجيّ.
 *
 * فقيمةٌ خارج القائمة تُرفض هنا بـ 400، لا تُمرَّر إلى النموذج لتصير جزءاً من
 * موجّهٍ لم نكتبه. والقوائم مغلقةٌ في ملفّ النصوص، فالحدّ واحدٌ للطرفين.
 */
function validate(body: Partial<RewriteInput>): RewriteInput {
  const draft = String(body?.draft ?? '').trim();
  if (!draft) throw new BadRequestException('draft is required');
  if (draft.length > MAX_DRAFT) throw new BadRequestException('draft too long');

  const incoming = String(body?.incoming ?? '');
  if (incoming.length > MAX_INCOMING)
    throw new BadRequestException('incoming email too long');

  const pick = <T extends string>(
    allowed: readonly T[],
    value: unknown,
    field: string,
  ): T => {
    if (!(allowed as readonly string[]).includes(String(value))) {
      throw new BadRequestException(`invalid ${field}`);
    }
    return String(value) as T;
  };

  const input: RewriteInput = {
    draft,
    incoming: incoming.trim() || undefined,
    recipient: pick<Recipient>(RECIPIENTS, body?.recipient, 'recipient'),
    purpose: pick<Purpose>(PURPOSES, body?.purpose, 'purpose'),
    tone: pick<Tone>(TONES, body?.tone, 'tone'),
    language: pick<Language>(LANGUAGES, body?.language, 'language'),
  };

  // `adjust` اختياريّ — وغيابُه ليس خطأً، لكنّ قيمةً غريبةً فيه خطأ.
  if (
    body?.adjust !== undefined &&
    body.adjust !== null &&
    body.adjust !== ('' as any)
  ) {
    input.adjust = pick<Adjust>(ADJUSTMENTS, body.adjust, 'adjust');
  }

  return input;
}
