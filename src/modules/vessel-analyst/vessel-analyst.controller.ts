import {
  Controller, Post, Body, Request, UseGuards, Inject,
  BadRequestException, InternalServerErrorException, HttpException, HttpStatus,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';
import { RequireScreen } from '../../common/require-screen.decorator';
import { parseAnalystRequest, buildAnalystSystem } from './vessel-analyst.prompt';

export const ANALYST_CLIENT = 'VESSEL_ANALYST_CLIENT';
export const ANALYST_MODEL = 'claude-opus-4-8';
const MAX_OUTPUT = 1800;

// حدٌّ لكلّ مستخدم: كلّ سؤالٍ استدعاءٌ مدفوع
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 40;
const hits = new Map<string, number[]>();
export function underLimit(userId: string, now = Date.now()): boolean {
  const recent = (hits.get(userId) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) { hits.set(userId, recent); return false; }
  recent.push(now); hits.set(userId, recent);
  return true;
}

@Controller('api/vessel-analyst')
@UseGuards(JwtAuthGuard, ScreenGuard)
@RequireScreen('/dashboard/reports')
export class VesselAnalystController {
  constructor(@Inject(ANALYST_CLIENT) private client: Pick<Anthropic, 'messages'> | null) {}

  @Post('ask')
  async ask(@Request() req: any, @Body() body: any) {
    const r = parseAnalystRequest(body);
    if ('error' in r) throw new BadRequestException(r.error);
    if (!this.client) throw new InternalServerErrorException('AI is not configured');
    if (!underLimit(String(req.user?.id ?? 'anon'))) {
      throw new HttpException('تجاوزت حدّ الأسئلة لهذه الساعة — حاول بعد قليل', HttpStatus.TOO_MANY_REQUESTS);
    }

    const today = new Date().toISOString().slice(0, 10);
    try {
      const res = await this.client.messages.create({
        model: ANALYST_MODEL,
        max_tokens: MAX_OUTPUT,
        system: buildAnalystSystem(r, today),
        messages: [...r.history, { role: 'user', content: r.question }],
      });
      const answer = (res.content as { type: string; text?: string }[])
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('\n')
        .trim();
      return { answer: answer || 'لا جواب.', truncated: res.stop_reason === 'max_tokens' };
    } catch (err: any) {
      // لا يُعاد نصّ خطأ المزوّد كما هو — قد يحمل تفاصيل الطلب
      console.error('Vessel analyst error:', err?.status, err?.message);
      throw new InternalServerErrorException('تعذّر الوصول إلى المساعد الآن');
    }
  }
}
