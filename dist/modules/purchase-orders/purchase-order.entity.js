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
exports.PurchaseOrder = void 0;
const typeorm_1 = require("typeorm");
const supplier_entity_1 = require("../suppliers/supplier.entity");
const vessel_entity_1 = require("../vessels/vessel.entity");
const invoice_entity_1 = require("../invoices/invoice.entity");
let PurchaseOrder = class PurchaseOrder {
    id;
    po_number;
    supplier_id;
    vessel_id;
    description;
    order_date;
    is_active;
    created_at;
    updated_at;
    supplier;
    vessel;
    invoices;
};
exports.PurchaseOrder = PurchaseOrder;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], PurchaseOrder.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 100, unique: true }),
    __metadata("design:type", String)
], PurchaseOrder.prototype, "po_number", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], PurchaseOrder.prototype, "supplier_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: true }),
    __metadata("design:type", String)
], PurchaseOrder.prototype, "vessel_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 500, nullable: true }),
    __metadata("design:type", String)
], PurchaseOrder.prototype, "description", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date', nullable: true }),
    __metadata("design:type", Date)
], PurchaseOrder.prototype, "order_date", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: true }),
    __metadata("design:type", Boolean)
], PurchaseOrder.prototype, "is_active", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], PurchaseOrder.prototype, "created_at", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Date)
], PurchaseOrder.prototype, "updated_at", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => supplier_entity_1.Supplier, (s) => s.purchase_orders),
    (0, typeorm_1.JoinColumn)({ name: 'supplier_id' }),
    __metadata("design:type", supplier_entity_1.Supplier)
], PurchaseOrder.prototype, "supplier", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => vessel_entity_1.Vessel, (v) => v.purchase_orders),
    (0, typeorm_1.JoinColumn)({ name: 'vessel_id' }),
    __metadata("design:type", vessel_entity_1.Vessel)
], PurchaseOrder.prototype, "vessel", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => invoice_entity_1.Invoice, (inv) => inv.purchase_order),
    __metadata("design:type", Array)
], PurchaseOrder.prototype, "invoices", void 0);
exports.PurchaseOrder = PurchaseOrder = __decorate([
    (0, typeorm_1.Entity)('purchase_orders')
], PurchaseOrder);
//# sourceMappingURL=purchase-order.entity.js.map