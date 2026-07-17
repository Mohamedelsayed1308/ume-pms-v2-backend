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
exports.Payment = exports.PaymentMethod = exports.PaymentType = void 0;
const typeorm_1 = require("typeorm");
const invoice_entity_1 = require("../invoices/invoice.entity");
var PaymentType;
(function (PaymentType) {
    PaymentType["ADVANCE"] = "advance";
    PaymentType["INSTALLMENT"] = "installment";
    PaymentType["FULL"] = "full";
})(PaymentType || (exports.PaymentType = PaymentType = {}));
var PaymentMethod;
(function (PaymentMethod) {
    PaymentMethod["BANK_TRANSFER"] = "bank_transfer";
    PaymentMethod["CHEQUE"] = "cheque";
    PaymentMethod["CASH"] = "cash";
})(PaymentMethod || (exports.PaymentMethod = PaymentMethod = {}));
let Payment = class Payment {
    id;
    invoice_id;
    payment_type;
    payment_method;
    currency;
    amount;
    payment_date;
    reference;
    notes;
    created_at;
    invoice;
};
exports.Payment = Payment;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], Payment.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], Payment.prototype, "invoice_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: PaymentType, default: PaymentType.INSTALLMENT }),
    __metadata("design:type", String)
], Payment.prototype, "payment_type", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: PaymentMethod, default: PaymentMethod.BANK_TRANSFER }),
    __metadata("design:type", String)
], Payment.prototype, "payment_method", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 10, default: 'USD' }),
    __metadata("design:type", String)
], Payment.prototype, "currency", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'decimal', precision: 15, scale: 2 }),
    __metadata("design:type", Number)
], Payment.prototype, "amount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date' }),
    __metadata("design:type", Date)
], Payment.prototype, "payment_date", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 200, nullable: true }),
    __metadata("design:type", String)
], Payment.prototype, "reference", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 500, nullable: true }),
    __metadata("design:type", String)
], Payment.prototype, "notes", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], Payment.prototype, "created_at", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => invoice_entity_1.Invoice, (inv) => inv.payments),
    (0, typeorm_1.JoinColumn)({ name: 'invoice_id' }),
    __metadata("design:type", invoice_entity_1.Invoice)
], Payment.prototype, "invoice", void 0);
exports.Payment = Payment = __decorate([
    (0, typeorm_1.Entity)('payments')
], Payment);
//# sourceMappingURL=payment.entity.js.map