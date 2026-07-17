import { Controller, Post, UseInterceptors, UploadedFile, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

@Controller('api/invoices')
export class InvoiceExtractController {
  @Post('extract')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', { dest: './uploads/tmp' }))
  async extract(@UploadedFile() file: Express.Multer.File) {
    const buffer = fs.readFileSync(file.path);
    const base64 = buffer.toString('base64');
    const isPdf = file.mimetype === 'application/pdf';

    const content: any[] = [
      {
        type: 'text',
        text: `أنت مساعد متخصص في قراءة الفواتير. استخرج البيانات التالية من الفاتورة وأرجعها كـ JSON فقط بدون أي نص إضافي:
{
  "invoice_number": "رقم الفاتورة",
  "total_amount": 0,
  "currency": "USD أو EUR أو EGP",
  "invoice_date": "YYYY-MM-DD أو null",
  "due_date": "YYYY-MM-DD أو null",
  "supplier_name": "اسم المورد أو الشركة المُصدِرة للفاتورة",
  "vessel_name": "اسم السفينة أو الباخرة إن وجد أو null",
  "description": "وصف مختصر للفاتورة"
}
إذا لم تجد قيمة اتركها null. أرجع JSON فقط.`,
      },
    ];

    if (isPdf) {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
    } else {
      content.push({ type: 'image', source: { type: 'base64', media_type: file.mimetype as any, data: base64 } });
    }

    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
    });

    fs.unlinkSync(file.path);

    const text = (response.content[0] as any).text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : text);
  }
}
