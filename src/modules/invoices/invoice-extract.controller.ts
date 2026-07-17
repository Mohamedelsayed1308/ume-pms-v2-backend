import { Controller, Post, UseInterceptors, UploadedFile, UseGuards, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

@Controller('api/invoices')
export class InvoiceExtractController {
  @Post('extract')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  async extract(@UploadedFile() file: Express.Multer.File) {
    console.log('Extract called, file:', file?.originalname, file?.size, file?.mimetype);
    if (!file) throw new BadRequestException('No file received');
    if (!process.env.ANTHROPIC_API_KEY) throw new InternalServerErrorException('ANTHROPIC_API_KEY not set');
    const base64 = file.buffer.toString('base64');
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

    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content }],
        ...(isPdf ? { betas: ['pdfs-2024-09-25'] } as any : {}),
      });

      const text = (response.content[0] as any).text.trim();
      console.log('Claude response:', text.substring(0, 200));
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      return JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch (err: any) {
      console.error('Anthropic error:', err?.message, err?.status, JSON.stringify(err?.error));
      throw new InternalServerErrorException(err?.message || 'Anthropic API failed');
    }
  }
}
