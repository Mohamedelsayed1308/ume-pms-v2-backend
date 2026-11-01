import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { VesselProfitData } from './vessel-profit.entity';
import { MONTE_KEY } from './monte-ingest.service';
import { MonteInput, inputContext, validateInput } from './monte-inputs';
import { withVesselRow } from './monte-row';

type User = { id?: string; full_name?: string; email?: string } | undefined;

const author = (u: User) => ({ id: u?.id ?? null, name: (u?.full_name || u?.email || 'غير معروف').slice(0, 80) });

/** مدخلات فريق مونتي — إضافةٌ لا استبدال، تحت قفل الصفّ (انظر monte-inputs.ts). */
@Injectable()
export class MonteInputsService {
  constructor(@InjectRepository(VesselProfitData) private repo: Repository<VesselProfitData>) {}

  async list() {
    const row = await this.repo.findOne({ where: { vessel: MONTE_KEY } });
    return { inputs: (row?.manual?.inputs as MonteInput[]) || [] };
  }

  async add(kind: unknown, data: unknown, user: User) {
    return withVesselRow(this.repo, MONTE_KEY, async (row, r) => {
      const manual = this.manualOf(row);
      if (!manual.package) throw new BadRequestException('لا حزمة لمونتي بعد — المدخلات تُقاس على أشهر الكارت');
      const check = validateInput(kind, data, inputContext(manual.package));
      if (!check.ok) throw new BadRequestException({ message: 'المُدخَل مرفوض', errors: check.errors });
      const input: MonteInput = { id: randomUUID(), kind: kind as MonteInput['kind'], data: check.data, by: author(user), at: new Date().toISOString() };
      row.manual = { ...manual, inputs: [...(manual.inputs || []), input] };
      await r.save(row);
      return { input };
    });
  }

  async void(target: string, reason: unknown, user: User) {
    return withVesselRow(this.repo, MONTE_KEY, async (row, r) => {
      const manual = this.manualOf(row);
      const inputs: MonteInput[] = manual.inputs || [];
      const t = inputs.find((x) => x.id === target && x.kind !== 'void');
      if (!t) throw new NotFoundException('المُدخَل غير موجود');
      if (inputs.some((x) => x.kind === 'void' && x.data?.target === target)) throw new BadRequestException('المُدخَل مُلغى من قبل');
      const why = typeof reason === 'string' ? reason.trim().slice(0, 300) : '';
      if (!why) throw new BadRequestException('سبب الإلغاء مطلوب');
      const input: MonteInput = { id: randomUUID(), kind: 'void', data: { target, reason: why }, by: author(user), at: new Date().toISOString() };
      row.manual = { ...manual, inputs: [...inputs, input] };
      await r.save(row);
      return { input };
    });
  }

  private manualOf(row: VesselProfitData): Record<string, any> {
    return row.manual && typeof row.manual === 'object' && !Array.isArray(row.manual) ? row.manual : {};
  }
}
