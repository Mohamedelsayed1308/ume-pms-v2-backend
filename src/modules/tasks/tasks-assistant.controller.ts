import {
  Controller,
  Post,
  Body,
  Request,
  UseGuards,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenAuthzService } from '../../common/screen-authz.service';
import { TasksService } from './tasks.service';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Match the frontend's allowed values so Claude never produces an out-of-range option.
const OWNERS = ['M.Elsayed', 'Bassel', 'Tarek', 'Shimaa', 'Other'];
const TEAMS = ['UME', 'Badawi', 'Ittihad', 'Operations', 'Finance'];
const PRIORITY = ['low', 'medium', 'high', 'urgent'];
const STATUSES = ['pending', 'in_progress', 'done', 'cancelled'];
const RECURRENCE = ['none', 'daily', 'weekly', 'monthly'];

// Only these fields may reach the DB from a tool call — never trust the model with the whole row.
const TASK_FIELDS = [
  'title', 'reason', 'notes', 'team', 'owner', 'recommended_employee',
  'priority', 'status', 'due_date', 'recurrence',
];

function pick(src: any, keys: string[]) {
  const out: any = {};
  for (const k of keys) if (src?.[k] !== undefined && src[k] !== null && src[k] !== '') out[k] = src[k];
  return out;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'create_task',
    description: 'إنشاء مهمة جديدة في لوحة مهام الفريق. استخدمها عندما يطلب المستخدم إضافة/تسجيل مهمة أو تذكير أو عمل مطلوب.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'عنوان المهمة (مطلوب)' },
        owner: { type: 'string', enum: OWNERS, description: 'المسؤول عن المهمة' },
        recommended_employee: { type: 'string', description: 'اسم الموظف المقترح لتنفيذ المهمة' },
        team: { type: 'string', enum: TEAMS },
        priority: { type: 'string', enum: PRIORITY },
        status: { type: 'string', enum: STATUSES },
        due_date: { type: 'string', description: 'تاريخ الاستحقاق بصيغة YYYY-MM-DD' },
        recurrence: { type: 'string', enum: RECURRENCE },
        reason: { type: 'string', description: 'السبب أو المبرر' },
        notes: { type: 'string', description: 'ملاحظات إضافية' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: 'تعديل مهمة موجودة (تغيير الحالة، الأولوية، المسؤول، تاريخ الاستحقاق، إلخ). لازم id المهمة من القائمة المعطاة.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'معرّف المهمة (id) من القائمة الحالية' },
        title: { type: 'string' },
        owner: { type: 'string', enum: OWNERS },
        recommended_employee: { type: 'string' },
        team: { type: 'string', enum: TEAMS },
        priority: { type: 'string', enum: PRIORITY },
        status: { type: 'string', enum: STATUSES },
        due_date: { type: 'string', description: 'YYYY-MM-DD' },
        recurrence: { type: 'string', enum: RECURRENCE },
        reason: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'add_comment',
    description: 'إضافة تعليق على مهمة موجودة.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'معرّف المهمة' },
        body: { type: 'string', description: 'نص التعليق' },
      },
      required: ['task_id', 'body'],
    },
  },
];

@Controller('api/tasks')
@UseGuards(JwtAuthGuard)
export class TasksAssistantController {
  constructor(private svc: TasksService, private authz: ScreenAuthzService) {}

  @Post('assistant')
  async assistant(
    @Body() body: { message?: string; history?: { role: 'user' | 'assistant'; content: string }[] },
    @Request() req: any,
  ) {
    await this.authz.assert(req.user?.id, '/dashboard/tasks'); // تفويض خادمي
    const message = (body?.message || '').trim();
    if (!message) throw new BadRequestException('message is required');
    if (!process.env.ANTHROPIC_API_KEY)
      throw new InternalServerErrorException('ANTHROPIC_API_KEY not configured');

    const tasks = await this.svc.findAll();
    const today = new Date().toISOString().slice(0, 10);

    // Compact snapshot so Claude can reference tasks by id without burning tokens on full rows.
    const snapshot = (tasks as any[]).map((t) => ({
      id: t.id, title: t.title, owner: t.owner, status: t.status,
      priority: t.priority, due_date: t.due_date, recommended_employee: t.recommended_employee,
    }));

    const system =
      `أنت مساعد ذكي داخل نظام UME Holding PMS، في شاشة "مهام الفريق". مهمتك مساعدة المدير على تنظيم وتوزيع المهام.\n` +
      `تاريخ اليوم: ${today}.\n` +
      `أعضاء الفريق (المسؤولون): ${OWNERS.join(', ')}.\n` +
      `الفرق: ${TEAMS.join(', ')} | الأولويات: ${PRIORITY.join(', ')} | الحالات: ${STATUSES.join(', ')} | التكرار: ${RECURRENCE.join(', ')}.\n` +
      `قواعد:\n` +
      `- لما يطلب المستخدم إضافة/تعديل مهمة أو إضافة تعليق، استخدم الأدوات المتاحة فعلياً بدل ما توصف الخطوات.\n` +
      `- للتعديل لازم تستخدم id المهمة الصحيح من القائمة أدناه. لو مش متأكد أي مهمة يقصد، اسأله للتوضيح بدل التخمين.\n` +
      `- ما تحذفش أي مهمة (مفيش أداة حذف — لو طلب الحذف، قوله يحذفها يدوياً من الجدول).\n` +
      `- التواريخ بصيغة YYYY-MM-DD. حوّل التعبيرات مثل "بكرة" أو "الأسبوع الجاي" لتاريخ فعلي بناءً على تاريخ اليوم.\n` +
      `- رد باللغة اللي بيكلمك بيها المستخدم (عربي غالباً)، باختصار ووضوح، ولخّص أي إجراء نفّذته.\n\n` +
      `المهام الحالية (JSON):\n${JSON.stringify(snapshot)}`;

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
      // Manual agentic loop: let Claude call tools, execute them, feed results back.
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
            if (block.name === 'create_task') {
              const data = pick(block.input, TASK_FIELDS);
              if (!data.title) throw new Error('title مطلوب');
              const created: any = await this.svc.create(data);
              actions.push({ tool: 'create_task', ok: true, detail: created?.title || data.title });
              resultText = `تم إنشاء المهمة (id=${created?.id}).`;
            } else if (block.name === 'update_task') {
              const id = block.input?.id;
              if (!id) throw new Error('id مطلوب');
              const data = pick(block.input, TASK_FIELDS);
              const updated: any = await this.svc.update(id, data);
              if (!updated) throw new Error('لا توجد مهمة بهذا الـ id');
              actions.push({ tool: 'update_task', ok: true, detail: updated?.title || id });
              resultText = `تم تعديل المهمة "${updated?.title}".`;
            } else if (block.name === 'add_comment') {
              const { task_id, body: cbody } = block.input || {};
              if (!task_id || !cbody) throw new Error('task_id و body مطلوبان');
              await this.svc.addComment(task_id, cbody, 'AI Assistant');
              actions.push({ tool: 'add_comment', ok: true, detail: cbody });
              resultText = 'تم إضافة التعليق.';
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
      console.error('Assistant error:', err?.message, err?.status);
      throw new InternalServerErrorException(err?.message || 'Claude API failed');
    }

    const changed = actions.some((a) => a.ok);
    return { reply: reply || 'تمام.', actions, changed };
  }
}
