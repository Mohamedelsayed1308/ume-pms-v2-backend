import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from './customer.entity';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';

@Controller('api/customers')
@UseGuards(JwtAuthGuard)
export class CustomersController {
  constructor(@InjectRepository(Customer) private repo: Repository<Customer>) {}

  @Get()
  findAll() { return this.repo.find({ order: { name: 'ASC' } }); }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.repo.findOne({ where: { id } }); }

  @Post()
  create(@Body() body: Partial<Customer>) { return this.repo.save(this.repo.create(body)); }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: Partial<Customer>) {
    await this.repo.update(id, body);
    return this.repo.findOne({ where: { id } });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.repo.delete(id);
    return { success: true };
  }
}
