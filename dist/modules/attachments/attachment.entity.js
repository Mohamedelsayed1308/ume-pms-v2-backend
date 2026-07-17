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
exports.Attachment = void 0;
const typeorm_1 = require("typeorm");
const invoice_entity_1 = require("../invoices/invoice.entity");
let Attachment = class Attachment {
    id;
    invoice_id;
    original_name;
    filename;
    mimetype;
    size;
    created_at;
    invoice;
};
exports.Attachment = Attachment;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], Attachment.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], Attachment.prototype, "invoice_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 255 }),
    __metadata("design:type", String)
], Attachment.prototype, "original_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 255 }),
    __metadata("design:type", String)
], Attachment.prototype, "filename", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 50 }),
    __metadata("design:type", String)
], Attachment.prototype, "mimetype", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], Attachment.prototype, "size", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], Attachment.prototype, "created_at", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => invoice_entity_1.Invoice),
    (0, typeorm_1.JoinColumn)({ name: 'invoice_id' }),
    __metadata("design:type", invoice_entity_1.Invoice)
], Attachment.prototype, "invoice", void 0);
exports.Attachment = Attachment = __decorate([
    (0, typeorm_1.Entity)('attachments')
], Attachment);
//# sourceMappingURL=attachment.entity.js.map