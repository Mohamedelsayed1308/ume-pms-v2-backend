import { Controller, Get, Post, Body, Query, UseGuards, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import Anthropic from '@anthropic-ai/sdk';
import { FleetService } from './fleet.service';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

@Controller('api/fleet')
@UseGuards(JwtAuthGuard)
export class FleetController {
  constructor(private svc: FleetService) {}

  @Get('dashboard')
  dashboard(@Query('refresh') refresh?: string) {
    return this.svc.getDashboard(refresh === '1' || refresh === 'true');
  }

  @Post('assistant')
  async assistant(
    @Body() body: { message?: string; history?: { role: 'user' | 'assistant'; content: string }[]; filters?: any },
  ) {
    const message = (body?.message || '').trim();
    if (!message) throw new BadRequestException('message is required');
    if (!process.env.ANTHROPIC_API_KEY)
      throw new InternalServerErrorException('ANTHROPIC_API_KEY not configured');

    const data = await this.svc.getDashboard(false);
    const today = new Date().toISOString().slice(0, 10);

    const system =
      `أنت محلل بيانات ملاحي ومساعد ذكي داخل نظام UME Holding PMS، في "لوحة الأسطول التنفيذية".\n` +
      `تاريخ اليوم: ${today}.\n` +
      `مهمتك مساعدة الإدارة على قراءة أداء الأسطول واتخاذ القرار: مقارنات بين المراكب، اتجاهات شهرية، كفاءة التشغيل (متوسط لكل رحلة)، والأعداد المنقولة (شاحنات/مركبات/ركاب).\n` +
      `قواعد:\n` +
      `- اعتمد فقط على البيانات المعطاة أدناه. لو رقم مش موجود، قول إنه غير متاح بدل ما تخمّن.\n` +
      `- رد بالعربي باختصار ووضوح، وبأرقام محددة. استخدم جداول أو نقاط عند المقارنة.\n` +
      `- الشهر بصيغة YYYY-MM. المبالغ بالدولار.\n` +
      `- لما تقارن، رتّب من الأعلى للأقل ووضّح الفرق والنسبة.\n\n` +
      `المراكب: ${data.vessels.join(', ')} | الشهور المتاحة: ${data.months.join(', ')}.\n` +
      (body?.filters ? `الفلاتر الحالية المطبّقة في الشاشة: ${JSON.stringify({ from: body.filters.from, to: body.filters.to, vessels: Array.isArray(body.filters.vessels) ? body.filters.vessels.slice(0, 20) : undefined })}.\n` : '') +
      `بيانات الأداء الشهري لكل مركب (JSON):\n${JSON.stringify(data.monthly)}`;

    const messages: Anthropic.MessageParam[] = [
      ...((body.history || [])
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content })) as Anthropic.MessageParam[]),
      { role: 'user', content: message },
    ];

    try {
      const res = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 1500,
        system,
        messages,
      });
      const reply = (res.content as any[])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { reply: reply || 'تمام.' };
    } catch (err: any) {
      console.error('Fleet assistant error:', err?.message, err?.status);
      throw new InternalServerErrorException(err?.message || 'Claude API failed');
    }
  }
}
