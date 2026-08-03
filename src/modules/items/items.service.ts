import { Injectable, OnModuleInit, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Item } from './item.entity';

const DEFAULTS = ['Bunker', 'Vessel Supplies', 'Salaries', 'Provision'];

@Injectable()
export class ItemsService implements OnModuleInit {
  constructor(@InjectRepository(Item) private repo: Repository<Item>) {}

  // بذر الفئات الافتراضية أول مرة فقط
  async onModuleInit() {
    const count = await this.repo.count();
    if (count === 0) await this.repo.save(DEFAULTS.map((name) => ({ name })));
  }

  findAll() { return this.repo.find({ order: { name: 'ASC' } }); }

  async create(data: Partial<Item>) {
    if (data.name) {
      const exists = await this.repo.findOne({ where: { name: data.name.trim() } });
      if (exists) throw new ConflictException('بند بنفس الاسم موجود بالفعل');
    }
    return this.repo.save({ ...data, name: data.name?.trim() });
  }

  async update(id: string, data: Partial<Item>) {
    if (data.name) {
      const exists = await this.repo.findOne({ where: { name: data.name.trim() } });
      if (exists && exists.id !== id) throw new ConflictException('بند بنفس الاسم موجود بالفعل');
    }
    await this.repo.update(id, { ...data, ...(data.name ? { name: data.name.trim() } : {}) });
    return this.repo.findOneBy({ id });
  }

  async remove(id: string) {
    try {
      await this.repo.delete(id);
      return { deleted: true };
    } catch (err: any) {
      if (err?.code === '23503') throw new ConflictException('لا يمكن حذف البند — مستخدم في فواتير. أوقفه بدلاً من الحذف.');
      throw err;
    }
  }
}
