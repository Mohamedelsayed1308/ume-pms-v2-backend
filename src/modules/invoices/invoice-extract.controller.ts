import { Controller, Post, Request, UseInterceptors, UploadedFile, UseGuards, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenAuthzService } from '../../common/screen-authz.service';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

@Controller('api/invoices')
export class InvoiceExtractController {
  constructor(private authz: ScreenAuthzService) {}

  @Post('extract')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  async extract(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    await this.authz.assert(req.user?.id, '/dashboard/invoices'); // تفويض خادمي
    if (!file || !file.buffer) throw new BadRequestException('No file received');
    if (!process.env.ANTHROPIC_API_KEY) throw new InternalServerErrorException('ANTHROPIC_API_KEY not configured');

    const base64 = file.buffer.toString('base64');
    const isPdf = file.mimetype === 'application/pdf';

    const content: any[] = [
      {
        type: 'text',
        text: `أنت مساعد متخصص في قراءة الفواتير. استخرج البيانات التالية من الفاتورة وأرجعها كـ JSON فقط بدون أي نص إضافي:
{
  "invoice_number": "رقم الفاتورة",
  "total_amount": 0,
  "currency": "USD أو EUR أو EGP أو SAR أو GBP أو CHF أو AED",
  "invoice_date": "YYYY-MM-DD أو null",
  "due_date": "YYYY-MM-DD أو null",
  "supplier_name": "اسم المورد أو الشركة المُصدِرة للفاتورة",
  "vessel_name": "اسم السفينة أو الباخرة إن وجد أو null",
  "po_number": "رقم أمر الشراء أو Your Reference أو Our Reference أو PO Number إن وجد أو null",
  "description": "وصف مختصر للفاتورة",
  "line_items": [ { "name": "اسم البند/السطر", "amount": 0 } ]
}
قواعد line_items: استخرج الأسطر التفصيلية للفاتورة كل سطر باسمه ومبلغه. اجمع الأسطر المتشابهة تحت اسم فئة واحد (مثال: كل أسطر "Port General Expenses Voy No" اجمعها في سطر واحد اسمه "Port General Expenses" بمجموع مبالغها؛ و"Amounts Paid On Your Behalf X" سمِّ السطر بالفئة X فقط مثل Supplies أو Medical أو Provision أو Cash To Master أو Car Hire). لا تُدرج سطر الإجمالي. لو الفاتورة صنف/بند واحد فقط اترك line_items = []. مجموع مبالغ line_items يجب أن يساوي total_amount.
إذا لم تجد قيمة اتركها null. أرجع JSON فقط.`,
      },
    ];

    if (isPdf) {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
    } else {
      content.push({ type: 'image', source: { type: 'base64', media_type: file.mimetype as any, data: base64 } });
    }

    try {
      const response = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 2048,
        messages: [{ role: 'user', content }],
      });

      const text = (response.content[0] as any).text.trim();
      // (تدقيق اللوجات: أُزيل تسجيل محتوى الاستخراج المالي)
      // Extract the full JSON object (greedy: first { to last } — يشمل مصفوفة البنود)
      const jsonStr = text.match(/\{[\s\S]*\}/)?.[0] || text;
      try {
        return JSON.parse(jsonStr);
      } catch {
        // Try to find JSON between code fences
        const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (fenceMatch) return JSON.parse(fenceMatch[1]);
        throw new Error('Could not parse JSON from Claude response: ' + text.substring(0, 100));
      }
    } catch (err: any) {
      console.error('Claude error:', err?.message, err?.status);
      throw new InternalServerErrorException(err?.message || 'Claude API failed');
    }
  }
}
