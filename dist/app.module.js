"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const typeorm_1 = require("@nestjs/typeorm");
const serve_static_1 = require("@nestjs/serve-static");
const path_1 = require("path");
const auth_module_1 = require("./modules/auth/auth.module");
const suppliers_module_1 = require("./modules/suppliers/suppliers.module");
const vessels_module_1 = require("./modules/vessels/vessels.module");
const purchase_orders_module_1 = require("./modules/purchase-orders/purchase-orders.module");
const invoices_module_1 = require("./modules/invoices/invoices.module");
const payments_module_1 = require("./modules/payments/payments.module");
const currencies_module_1 = require("./modules/currencies/currencies.module");
const attachments_module_1 = require("./modules/attachments/attachments.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({ isGlobal: true }),
            serve_static_1.ServeStaticModule.forRoot({ rootPath: (0, path_1.join)(process.cwd(), 'uploads'), serveRoot: '/uploads' }),
            typeorm_1.TypeOrmModule.forRootAsync({
                inject: [config_1.ConfigService],
                useFactory: (config) => ({
                    type: 'postgres',
                    host: 'aws-0-eu-west-1.pooler.supabase.com',
                    port: 5432,
                    username: 'postgres.euzikjnyoprzkweechky',
                    password: 'mRfDwTNUWn2V1l36',
                    database: 'postgres',
                    ssl: { rejectUnauthorized: false },
                    autoLoadEntities: true,
                    synchronize: true,
                }),
            }),
            auth_module_1.AuthModule,
            currencies_module_1.CurrenciesModule,
            suppliers_module_1.SuppliersModule,
            vessels_module_1.VesselsModule,
            purchase_orders_module_1.PurchaseOrdersModule,
            invoices_module_1.InvoicesModule,
            payments_module_1.PaymentsModule,
            attachments_module_1.AttachmentsModule,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map