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
exports.Vessel = void 0;
const typeorm_1 = require("typeorm");
const purchase_order_entity_1 = require("../purchase-orders/purchase-order.entity");
let Vessel = class Vessel {
    id;
    name;
    imo_number;
    flag;
    vessel_type;
    is_active;
    created_at;
    updated_at;
    purchase_orders;
};
exports.Vessel = Vessel;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], Vessel.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 200 }),
    __metadata("design:type", String)
], Vessel.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 20, nullable: true, unique: true }),
    __metadata("design:type", String)
], Vessel.prototype, "imo_number", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 100, nullable: true }),
    __metadata("design:type", String)
], Vessel.prototype, "flag", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 100, nullable: true }),
    __metadata("design:type", String)
], Vessel.prototype, "vessel_type", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: true }),
    __metadata("design:type", Boolean)
], Vessel.prototype, "is_active", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Date)
], Vessel.prototype, "created_at", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Date)
], Vessel.prototype, "updated_at", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => purchase_order_entity_1.PurchaseOrder, (po) => po.vessel),
    __metadata("design:type", Array)
], Vessel.prototype, "purchase_orders", void 0);
exports.Vessel = Vessel = __decorate([
    (0, typeorm_1.Entity)('vessels')
], Vessel);
//# sourceMappingURL=vessel.entity.js.map