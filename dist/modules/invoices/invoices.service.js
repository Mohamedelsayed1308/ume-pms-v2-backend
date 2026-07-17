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
exports.InvoicesService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const invoice_entity_1 = require("./invoice.entity");
let InvoicesService = class InvoicesService {
    repo;
    constructor(repo) {
        this.repo = repo;
    }
    findAll() {
        return this.repo.find({
            relations: { supplier: true, vessel: true, purchase_order: true, payments: true },
            order: { created_at: 'DESC' },
        });
    }
    findOne(id) {
        return this.repo.findOne({
            where: { id },
            relations: { supplier: true, vessel: true, purchase_order: true, payments: true },
        });
    }
    create(data) { return this.repo.save(data); }
    async update(id, data) {
        await this.repo.update(id, data);
        return this.findOne(id);
    }
    async remove(id) { await this.repo.delete(id); return { deleted: true }; }
    async updatePaidAmount(invoiceId) {
        const invoice = await this.repo.findOne({
            where: { id: invoiceId },
            relations: { payments: true },
        });
        if (!invoice)
            return;
        const totalPaid = invoice.payments.reduce((sum, p) => sum + +p.amount, 0);
        const status = totalPaid <= 0 ? invoice_entity_1.InvoiceStatus.UNPAID
            : totalPaid >= +invoice.total_amount ? invoice_entity_1.InvoiceStatus.PAID
                : invoice_entity_1.InvoiceStatus.PARTIAL;
        await this.repo.update(invoiceId, { paid_amount: totalPaid, status });
    }
    findBySupplier(supplierId) {
        return this.repo.find({
            where: { supplier_id: supplierId },
            relations: { vessel: true, purchase_order: true, payments: true },
            order: { created_at: 'DESC' },
        });
    }
    findByVessel(vesselId) {
        return this.repo.find({
            where: { vessel_id: vesselId },
            relations: { supplier: true, purchase_order: true, payments: true },
            order: { created_at: 'DESC' },
        });
    }
    findUnpaidBySupplier(supplierId) {
        return this.repo.find({
            where: [
                { supplier_id: supplierId, status: invoice_entity_1.InvoiceStatus.UNPAID },
                { supplier_id: supplierId, status: invoice_entity_1.InvoiceStatus.PARTIAL },
            ],
            relations: { vessel: true, purchase_order: true, payments: true },
            order: { due_date: 'ASC' },
        });
    }
    findUnpaidByVessel(vesselId) {
        return this.repo.find({
            where: [
                { vessel_id: vesselId, status: invoice_entity_1.InvoiceStatus.UNPAID },
                { vessel_id: vesselId, status: invoice_entity_1.InvoiceStatus.PARTIAL },
            ],
            relations: { supplier: true, purchase_order: true, payments: true },
            order: { due_date: 'ASC' },
        });
    }
    async getSupplierStatement(supplierId) {
        const invoices = await this.repo.find({
            where: { supplier_id: supplierId },
            relations: { supplier: true, vessel: true, purchase_order: true, payments: true },
            order: { invoice_date: 'ASC' },
        });
        if (!invoices.length)
            return { supplier: null, transactions: [], summary: { total_debit: 0, total_credit: 0, balance: 0 } };
        const supplier = invoices[0].supplier;
        const transactions = [];
        let running_balance = 0;
        for (const inv of invoices) {
            running_balance += +inv.total_amount;
            transactions.push({
                date: inv.invoice_date,
                type: 'debit',
                type_ar: 'مدين',
                description: `فاتورة رقم ${inv.invoice_number}`,
                invoice_number: inv.invoice_number,
                invoice_type: inv.type,
                vessel: inv.vessel?.name ?? null,
                po_number: inv.purchase_order?.po_number ?? null,
                currency: inv.currency,
                debit: +inv.total_amount,
                credit: 0,
                running_balance,
                status: inv.status,
            });
            const payments = (inv.payments || []).sort((a, b) => new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime());
            for (const pay of payments) {
                running_balance -= +pay.amount;
                transactions.push({
                    date: pay.payment_date,
                    type: 'credit',
                    type_ar: 'دائن',
                    description: `سداد — ${inv.invoice_number}`,
                    invoice_number: inv.invoice_number,
                    payment_method: pay.payment_method,
                    reference: pay.reference ?? null,
                    currency: pay.currency,
                    debit: 0,
                    credit: +pay.amount,
                    running_balance,
                });
            }
        }
        transactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        const total_debit = transactions.reduce((s, t) => s + t.debit, 0);
        const total_credit = transactions.reduce((s, t) => s + t.credit, 0);
        return {
            supplier: { id: supplier.id, name: supplier.name },
            transactions,
            summary: {
                total_debit,
                total_credit,
                balance: total_debit - total_credit,
            },
        };
    }
    getDueAlerts(daysAhead = 30) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const futureDate = new Date(today);
        futureDate.setDate(futureDate.getDate() + daysAhead);
        return this.repo.find({
            where: {
                due_date: (0, typeorm_2.LessThanOrEqual)(futureDate),
                status: (0, typeorm_2.Not)(invoice_entity_1.InvoiceStatus.PAID),
            },
            relations: { supplier: true, vessel: true, purchase_order: true },
            order: { due_date: 'ASC' },
        }).then((invoices) => invoices.map((inv) => {
            const due = new Date(inv.due_date);
            const diffMs = due.getTime() - today.getTime();
            const days_until_due = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
            return {
                ...inv,
                days_until_due,
                is_overdue: days_until_due < 0,
            };
        }));
    }
};
exports.InvoicesService = InvoicesService;
exports.InvoicesService = InvoicesService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(invoice_entity_1.Invoice)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], InvoicesService);
//# sourceMappingURL=invoices.service.js.map