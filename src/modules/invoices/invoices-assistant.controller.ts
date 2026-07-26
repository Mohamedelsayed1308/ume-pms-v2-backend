import {
  Controller,
  Post,
  Body,
  UseGuards,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { InvoicesService } from './invoices.service';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Workflow (approval) states — the only status field the assistant may set.
const APPROVAL: Record<string, string> = {
  booking_waiting_payment: 'Booking - Waiting Payment',
  waiting_approval: 'Waiting Approval',
  waiting_po: 'Waiting PO',
  send_to_pay: 'Send to Pay',
  hold: 'Hold',
  delivery_missing: 'Delivery Missing',
  paid: 'Paid',
};

// Only non-financial, non-destructive fields may reach the DB from a tool call.
const EDITABLE = ['approval_status', 'comment', 'notes', 'due_date'];

function pick(src: any, keys: string[]) {
  const out: any = {};
  for (const k of keys) if (src?.[k] !== undefined && src[k] !== null && src[k] !== '') out[k] = src[k];
  return out;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'update_invoice',
    description:
      'تعديل حقول سير العمل لفاتورة موجودة: حالة الموافقة (approval_status)، التعليق، الملاحظات، أو تاريخ الاستحقاق. ' +
      'ممنوع تعديل المبالغ أو تسجيل دفعات أو إنشاء/حذف فواتير — دي بتتعمل يدوياً. لازم id الفاتورة من القائمة المعطاة.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'معرّف الفاتورة (id) من القائمة الحالية' },
        approval_status: {
          type: 'string',
          enum: Object.keys(APPROVAL),
          description: 'حالة الموافقة الجديدة (بيتسجّل تاريخها تلقائياً باليوم)',
        },
        comment: { type: 'string', description: 'تعليق على الفاتورة' },
        notes: { type: 'string', description: 'ملاحظات' },
        due_date: { type: 'string', description: 'تاريخ الاستحقاق بصيغة YYYY-MM-DD' },
      },
      required: ['id'],
    },
  },
];

@Controller('api/invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesAssistantController {
  constructor(private svc: InvoicesService) {}

  @Post('assistant')
  async assistant(
    @Body() body: { message?: string; history?: { role: 'user' | 'assistant'; content: string }[] },
  ) {
    const message = (body?.message || '').trim();
    if (!message) throw new BadRequestException('message is required');
    if (!process.env.ANTHROPIC_API_KEY)
      throw new InternalServerErrorException('ANTHROPIC_API_KEY not configured');

    const invoices = await this.svc.findAll();
    const today = new Date().toISOString().slice(0, 10);

    const CAP = 400;
    const list: any[] = invoices as any[];
    const snapshot = list.slice(0, CAP).map((inv) => {
      const total = Number(inv.total_amount) || 0;
      const paid = Number(inv.paid_amount) || 0;
      return {
        id: inv.id,
        invoice_number: inv.invoice_number,
        supplier: inv.supplier?.name ?? null,
        vessel: inv.vessel?.name ?? null,
        po_number: inv.purchase_order?.po_number ?? null,
        type: inv.type,
        currency: inv.currency,
        total_amount: total,
        paid_amount: paid,
        remaining: +(total - paid).toFixed(2),
        status: inv.status,
        approval_status: inv.approval_status,
        invoice_date: inv.invoice_date,
        due_date: inv.due_date,
        comment: inv.comment,
        created_by_name: inv.created_by_name,
      };
    });

    const system =
      `أنت مساعد مالي ذكي داخل نظام UME Holding PMS، في شاشة "الفواتير". بتساعد المدير المالي على تحليل الفواتير وتنظيم حالتها.\n` +
      `تاريخ اليوم: ${today}.\n` +
      `حالات الموافقة (approval_status) وترجمتها: ` +
      Object.entries(APPROVAL).map(([k, v]) => `${k}=${v}`).join(' | ') + `.\n` +
      `حالات السداد (status): unpaid=غير مدفوعة, partial=مدفوعة جزئياً, paid=مدفوعة, cancelled=ملغاة.\n` +
      `قواعد مهمة:\n` +
      `- للتحليل والأسئلة (كام فاتورة، إجمالي المتبقي، المتأخرات، مين مدينين له، إلخ): احسب من الـ JSON المرفق وردّ بالأرقام.\n` +
      `- **ما تجمعش مبالغ من عملات مختلفة** — جمّع وأظهر كل عملة على حدة (USD/EUR/CHF...).\n` +
      `- الفاتورة "متأخرة" لو due_date قبل تاريخ اليوم وحالتها مش paid.\n` +
      `- لتغيير حالة الموافقة أو التعليق أو الملاحظات أو تاريخ الاستحقاق: استخدم أداة update_invoice بالـ id الصح. لو مش متأكد أي فاتورة، اسأل للتوضيح.\n` +
      `- **ممنوع** تعديل المبالغ (total/paid) أو تسجيل دفعات أو إنشاء أو حذف فواتير — لو اتطلب، قول للمستخدم يعملها يدوياً من الشاشة.\n` +
      `- التواريخ بصيغة YYYY-MM-DD. ردّ باللغة اللي بيكلمك بيها المستخدم (عربي غالباً)، باختصار ووضوح، ولخّص أي إجراء نفّذته.\n` +
      (list.length > CAP ? `\n(ملاحظة: معروض أول ${CAP} فاتورة من إجمالي ${list.length}.)\n` : '') +
      `\nالفواتير (JSON):\n${JSON.stringify(snapshot)}`;

    const messages: Anthropic.MessageParam[] = [
      ...((body.history || [])
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content })) as Anthropic.MessageParam[]),
      { role: 'user', content: message },
    ];

    const actions: { tool: string; ok: boolean; detail: string }[] = [];
    let reply = '';

    try {
      for (let step = 0; step < 6; step++) {
        const res = await client.messages.create({
          model: 'claude-opus-4-8',
          max_tokens: 2048,
          system,
          tools: TOOLS,
          messages,
        });

        const text = res.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n')
          .trim();
        if (text) reply = text;

        if (res.stop_reason !== 'tool_use') break;

        messages.push({ role: 'assistant', content: res.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of res.content as any[]) {
          if (block.type !== 'tool_use') continue;
          let resultText = '';
          try {
            if (block.name === 'update_invoice') {
              const id = block.input?.id;
              if (!id) throw new Error('id مطلوب');
              const data = pick(block.input, EDITABLE);
              if (Object.keys(data).length === 0) throw new Error('مفيش حقول للتعديل');
              // Stamp the workflow date like the UI does whenever the state changes.
              if (data.approval_status) data.approval_status_date = today;
              const updated: any = await this.svc.update(id, data);
              if (!updated) throw new Error('لا توجد فاتورة بهذا الـ id');
              const label = data.approval_status ? APPROVAL[data.approval_status] : 'الحقول';
              actions.push({ tool: 'update_invoice', ok: true, detail: `${updated?.invoice_number} → ${label}` });
              resultText = `تم تحديث الفاتورة "${updated?.invoice_number}".`;
            } else {
              resultText = `أداة غير معروفة: ${block.name}`;
            }
          } catch (e: any) {
            actions.push({ tool: block.name, ok: false, detail: e?.message || 'فشل' });
            resultText = `خطأ: ${e?.message || 'فشل تنفيذ الأداة'}`;
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: resultText,
            is_error: resultText.startsWith('خطأ'),
          });
        }
        messages.push({ role: 'user', content: toolResults });
      }
    } catch (err: any) {
      console.error('Invoice assistant error:', err?.message, err?.status);
      throw new InternalServerErrorException(err?.message || 'Claude API failed');
    }

    const changed = actions.some((a) => a.ok);
    return { reply: reply || 'تمام.', actions, changed };
  }
}
