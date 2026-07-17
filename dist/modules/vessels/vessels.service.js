"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VesselsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const vessel_entity_1 = require("./vessel.entity");
let VesselsService = class VesselsService {
    repo;
    constructor(repo) {
        this.repo = repo;
    }
    findAll() { return this.repo.find({ order: { name: 'ASC' } }); }
    findOne(id) { return this.repo.findOneBy({ id }); }
    create(data) { return this.repo.save(data); }
    async update(id, data) {
        await this.repo.update(id, data);
        return this.findOne(id);
    }
    async remove(id) { await this.repo.delete(id); return { deleted: true }; }
    async getStats(vesselId) {
        const result = await this.repo
            .createQueryBuilder('v')
            .leftJoin('v.purchase_orders', 'po')
            .leftJoin('po.invoices', 'inv')
            .select('v.id', 'id')
            .addSelect('v.name', 'name')
            .addSelect('COUNT(DISTINCT po.supplier_id)', 'total_suppliers')
            .addSelect('COUNT(DISTINCT inv.id)', 'total_invoices')
            .addSelect('SUM(inv.total_amount)', 'total_invoiced')
            .addSelect('SUM(inv.paid_amount)', 'total_paid')
            .where('v.id = :id', { id: vesselId })
            .getRawOne();
        return result;
    }
    async getSuppliersByVessel(vesselId) {
        return this.repo
            .createQueryBuilder('v')
            .leftJoin('v.purchase_orders', 'po')
            .leftJoin('po.supplier', 's')
            .leftJoin('po.invoices', 'inv')
            .select('s.id', 'supplier_id')
            .addSelect('s.name', 'supplier_name')
            .addSelect('COUNT(DISTINCT inv.id)', 'total_invoices')
            .addSelect('SUM(inv.total_amount)', 'total_amount')
            .addSelect('SUM(inv.paid_amount)', 'paid_amount')
            .where('v.id = :id', { id: vesselId })
            .groupBy('s.id, s.name')
            .orderBy('total_amount', 'DESC')
            .getRawMany();
    }
};
exports.VesselsService = VesselsService;
exports.VesselsService = VesselsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(vessel_entity_1.Vessel)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], VesselsService);
//# sourceMappingURL=vessels.service.js.map