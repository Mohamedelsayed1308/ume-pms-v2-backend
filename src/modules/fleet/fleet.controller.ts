import { Controller, Get, Post, Body, Query, Request, UseGuards, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';
import { RequireScreen } from '../../common/require-screen.decorator';
import { ScreenAuthzService } from '../../common/screen-authz.service';
import Anthropic from '@anthropic-ai/sdk';
import { FleetService } from './fleet.service';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/*
 * `ScreenGuard` هنا لا يقيّد شيئاً بنفسه — يقرأ `@RequireScreen` من الموجّه.
 * فالمساعد أدناه يبقى على تفويضه الخادمي كما هو، والقيد يقع على اللوحة وحدها.
 */
@Controller('api/fleet')
@UseGuards(JwtAuthGuard, ScreenGuard)
export class FleetController {
  constructor(private svc: FleetService, private authz: ScreenAuthzService) {}

  /*
   * اللوحة تُرجع دفتر الأسطول كلَّه: إيراداً ومصاريفَ وصافياً وسيولةً، لكلّ
   * مركبٍ ولكلّ سنة. وكانت تكتفي بـ`JwtAuthGuard` — فأيّ مستخدمٍ مسجَّل يقرؤها
   * ولو كانت صلاحيته شاشةً واحدة لا تمتّ للأسطول بصلة.
   *
   * والشاشتان هما نفسهما اللتان يشترطهما المساعد أسفله — فمصدرُ البيانات واحد،
   * ولا معنى لأن يُحرَس السؤال عنها ولا تُحرَس هي.
   *
   * و`?refresh=1` يدخل تحت القيد نفسه: مَن لا يملك الشاشة لا يقرأ ولا يُجبر
   * الخادم على إعادة الجلب.
   */
  @Get('dashboard')
  @RequireScreen('/dashboard/vessels', '/dashboard/reports')
  dashboard(@Query('refresh') refresh?: string) {
    return this.svc.getDashboard(refresh === '1' || refresh === 'true');
  }

  @Post('assistant')
  async assistant(
    @Body() body: { message?: string; history?: { role: 'user' | 'assistant'; content: string }[]; filters?: any },
    @Request() req: any,
  ) {
    await this.authz.assertAny(req.user?.id, ['/dashboard/vessels', '/dashboard/reports']); // تفويض خادمي
    const message = (body?.message || '').trim();
    if (!message) throw new BadRequestException('message is required');
    if (!process.env.ANTHROPIC_API_KEY)
      throw new InternalServerErrorException('ANTHROPIC_API_KEY not configured');

    const data = await this.svc.getDashboard(false);
    const today = new Date().toISOString().slice(0, 10);

    // فلترة البيانات بنفس فلاتر الشاشة قبل إرسالها للنموذج — يحدّ من التوكنز مع كِبَر تاريخ الشيت
    const f = body?.filters || {};
    const fromM = typeof f.from === 'string' ? f.from : '';
    const toM = typeof f.to === 'string' ? f.to : '';
    const selVessels: string[] | null = Array.isArray(f.vessels) ? f.vessels.slice(0, 20) : null;
    const selLines: string[] | null = Array.isArray(f.lines) ? f.lines.slice(0, 10) : null;
    const monthly = data.monthly.filter(
      (r) =>
        (!fromM || r.month >= fromM) &&
        (!toM || r.month <= toM) &&
        (!selVessels || selVessels.includes(r.vessel)) &&
        (!selLines || selLines.includes(r.line)),
    );
    const scoped = monthly.length ? monthly : data.monthly; // fallback لو الفلاتر ما طابقتش شيء

    const system =
      `أنت محلل بيانات ملاحي ومساعد ذكي داخل نظام UME Holding PMS، في "لوحة الأسطول التنفيذية".\n` +
      `تاريخ اليوم: ${today}.\n` +
      `مهمتك مساعدة الإدارة على قراءة أداء الأسطول واتخاذ القرار: مقارنات بين المراكب، اتجاهات شهرية، كفاءة التشغيل (متوسط لكل رحلة)، والأعداد المنقولة (شاحنات/مركبات/ركاب).\n` +
      `قواعد:\n` +
      `- اعتمد فقط على البيانات المعطاة أدناه. لو رقم مش موجود، قول إنه غير متاح بدل ما تخمّن.\n` +
      `- رد بالعربي باختصار ووضوح، وبأرقام محددة. استخدم جداول أو نقاط عند المقارنة.\n` +
      `- الشهر بصيغة YYYY-MM. المبالغ بالدولار.\n` +
      `- لما تقارن، رتّب من الأعلى للأقل ووضّح الفرق والنسبة.\n` +
      `- الخطّ (line) بُعدٌ مستقل عن المركب: ضبا/سفاجا فيه تحصيل وسيولة، وجدّة/سواكن بلا تحصيل فسيولته صفر بنيوياً — فلا تقارن سيولة خطٍّ بخطّ، ولا تُفسّر الصفر نقصاً في البيانات.\n` +
      `- المركب الواحد قد يمشي خطّين، فاذكر الخطّ عند المقارنة إن اختلف.\n\n` +
      `المراكب: ${data.vessels.join(', ')} | الخطوط: ${(data.lines || []).join(', ') || '—'} | الشهور المتاحة: ${data.months.join(', ')}.\n` +
      (fromM || toM || selVessels || selLines ? `الفلاتر المطبّقة في الشاشة: ${JSON.stringify({ from: fromM || undefined, to: toM || undefined, vessels: selVessels || undefined, lines: selLines || undefined })}.\n` : '') +
      `بيانات الأداء الشهري لكل مركب ضمن الفلاتر (JSON):\n${JSON.stringify(scoped)}`;

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
