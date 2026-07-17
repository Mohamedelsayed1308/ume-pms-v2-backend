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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Invoice = exports.InvoiceStatus = exports.InvoiceType = void 0;
const typeorm_1 = require("typeorm");
const supplier_entity_1 = require("../suppliers/supplier.entity");
const vessel_entity_1 = require("../vessels/vessel.entity");
const purchase_order_entity_1 = require("../purchase-orders/purchase-order.entity");
const payment_entity_1 = require("../payments/payment.entity");
var InvoiceType;
(function (InvoiceType) {
    InvoiceType["PRELIMINARY"] = "preliminary";
    InvoiceType["FINAL"] = "final";
})(InvoiceType || (exports.InvoiceType = InvoiceType = {}));
var InvoiceStatus;
(function (InvoiceStatus) {
    InvoiceStatus["UNPAID"] = "unpaid";
    InvoiceStatus["PARTIAL"] = "partial";
    InvoiceStatus["PAID"] = "paid";
    InvoiceStatus["CANCELLED"] = "cancelled";
})(InvoiceStatus || (exports.InvoiceStatus = InvoiceStatus = {}));
let Invoice = class Invoice {
    id;
    invoice_number;
    supplier_id;
    vessel_id;
    po_id;
    type;
    status;
    currency;
    total_amount;
    paid_amount;
    invoice_date;
    due_date;
    description;
    notes;
    created_at;
    updated_at;
    supplier;
    vessel;
    purchase_order;
    payments;
    get remaining_amount() {
        return +this.total_amount - +this.paid_amount;
    }
};
exports.Invoice = Invoice;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], Invoice.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 100, unique: true }),
    __metadata("design:type", String)
], Invoice.prototype, "invoice_number", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], Invoice.prototype, "supplier_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: true }),
    __metadata("design:type", String)
], Invoice.prototype, "vessel_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: true }),
    __metadata("design:type", String)
], Invoice.prototype, "po_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: InvoiceType, default: InvoiceType.PRELIMINARY }),
    __metadata("design:type", String)
], Invoice.prototype, "type", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: InvoiceStatus, default: InvoiceStatus.UNPAID }),
    __metadata("design:type", String)
], Invoice.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 10, default: 'USD' }),
    __metadata("design:type", String)
], Invoice.prototype, "currency", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 15, scale: 2 }),
    __metadata("design:type", Number)
], Invoice.prototype, "total_amount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 15, scale: 2, default: 0 }),
    __metadata("design:type", Number)
], Invoice.prototype, "paid_amount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date', nullable: true }),
    __metadata("design:type", Date)
], Invoice.prototype, "invoice_date", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date', nullable: true }),
    __metadata("design:type", Date)
], Invoice.prototype, "due_date", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 500, nullable: true }),
    __metadata("design:type", String)
], Invoice.prototype, "description", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 200, nullable: true }),
    __metadata("design:type", String)
], Invoice.prototype, "notes", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], Invoice.prototype, "created_at", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Date)
], Invoice.prototype, "updated_at", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => supplier_entity_1.Supplier),
    (0, typeorm_1.JoinColumn)({ name: 'supplier_id' }),
    __metadata("design:type", supplier_entity_1.Supplier)
], Invoice.prototype, "supplier", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => vessel_entity_1.Vessel),
    (0, typeorm_1.JoinColumn)({ name: 'vessel_id' }),
    __metadata("design:type", vessel_entity_1.Vessel)
], Invoice.prototype, "vessel", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => purchase_order_entity_1.PurchaseOrder, (po) => po.invoices),
    (0, typeorm_1.JoinColumn)({ name: 'po_id' }),
    __metadata("design:type", purchase_order_entity_1.PurchaseOrder)
], Invoice.prototype, "purchase_order", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => payment_entity_1.Payment, (p) => p.invoice),
    __metadata("design:type", Array)
], Invoice.prototype, "payments", void 0);
exports.Invoice = Invoice = __decorate([
    (0, typeorm_1.Entity)('invoices')
], Invoice);
//# sourceMappingURL=invoice.entity.js.map