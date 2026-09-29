import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CostItemCode } from './cost-item-code.entity';

/** الرموز التي يُحفظ لها ربط: مجموعات سطر «مصروفات الوكلاء» وحدها */
export const ASSIGNABLE_CODES = ['A', 'D', 'F'] as const;

/**
 * سطور قائمة الدخل الثابتة — B البنكر، C المشتريات، E المرتّبات. لا تُربط بغير
 * رمزها، وإلّا افترق مجموع الهيكل عن مجموع قائمة الدخل (قرار ١٧ سبتمبر).
 */
export const LOCKED_KEYS = ['fuel', 'purchases', 'salaries'] as const;

const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;

@Injectable()
export class CostStructureService {
  constructor(@InjectRepository(CostItemCode) private readonly repo: Repository<CostItemCode>) {}

  list() {
    return this.repo.find({ order: { item_key: 'ASC' } });
  }

  private checkKey(key: string) {
    if (!KEY_RE.test(key || '')) throw new BadRequestException('مفتاح البند غير صالح');
    if ((LOCKED_KEYS as readonly string[]).includes(key)) {
      throw new BadRequestException('البنكر والمشتريات والمرتّبات سطورٌ ثابتة من قائمة الدخل — لا يتغيّر رمزها');
    }
  }

  async set(key: string, code: string, userId: string) {
    this.checkKey(key);
    const c = String(code || '').toUpperCase();
    if (!(ASSIGNABLE_CODES as readonly string[]).includes(c)) {
      throw new BadRequestException(`الرمز يكون ${ASSIGNABLE_CODES.join(' أو ')}`);
    }
    await this.repo.upsert({ item_key: key, code: c, updated_by: userId || '', updated_at: new Date() }, ['item_key']);
    return this.repo.findOneByOrFail({ item_key: key });
  }

  /** رجوع البند إلى تصنيفه الافتراضيّ */
  async clear(key: string) {
    this.checkKey(key);
    await this.repo.delete({ item_key: key });
    return { item_key: key, cleared: true };
  }
}
