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
exports.PaymentsService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const payment_entity_1 = require("./payment.entity");
const invoices_service_1 = require("../invoices/invoices.service");
let PaymentsService = class PaymentsService {
    repo;
    invoicesService;
    constructor(repo, invoicesService) {
        this.repo = repo;
        this.invoicesService = invoicesService;
    }
    findAll() {
        return this.repo.find({
            relations: { invoice: { supplier: true, vessel: true } },
            order: { created_at: 'DESC' },
        });
    }
    findOne(id) {
        return this.repo.findOne({ where: { id }, relations: { invoice: true } });
    }
    findByInvoice(invoiceId) {
        return this.repo.find({
            where: { invoice_id: invoiceId },
            order: { payment_date: 'ASC' },
        });
    }
    async create(data) {
        const payment = await this.repo.save(data);
        await this.invoicesService.updatePaidAmount(payment.invoice_id);
        return payment;
    }
    async remove(id) {
        const payment = await this.repo.findOneBy({ id });
        await this.repo.delete(id);
        if (payment)
            await this.invoicesService.updatePaidAmount(payment.invoice_id);
        return { deleted: true };
    }
};
exports.PaymentsService = PaymentsService;
exports.PaymentsService = PaymentsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(payment_entity_1.Payment)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        invoices_service_1.InvoicesService])
], PaymentsService);
//# sourceMappingURL=payments.service.js.map