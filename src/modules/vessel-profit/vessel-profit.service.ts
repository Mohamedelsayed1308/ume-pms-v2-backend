import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VesselProfitData } from './vessel-profit.entity';

@Injectable()
export class VesselProfitService {
  constructor(@InjectRepository(VesselProfitData) private repo: Repository<VesselProfitData>) {}

  get(vessel: string) {
    return this.repo.findOne({ where: { vessel } });
  }

  async save(vessel: string, body: { voyages?: any; manual?: any }) {
    let row = await this.repo.findOne({ where: { vessel } });
    if (!row) row = this.repo.create({ vessel });
    if (body.voyages !== undefined) row.voyages = body.voyages;
    if (body.manual !== undefined) row.manual = body.manual;
    return this.repo.save(row);
  }
}
