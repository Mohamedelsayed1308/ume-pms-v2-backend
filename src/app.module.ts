import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AuthModule } from './modules/auth/auth.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { VesselsModule } from './modules/vessels/vessels.module';
import { PurchaseOrdersModule } from './modules/purchase-orders/purchase-orders.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { CurrenciesModule } from './modules/currencies/currencies.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ShippingCompaniesModule } from './modules/shipping-companies/shipping-companies.module';
import { HireInvoicesModule } from './modules/hire-invoices/hire-invoices.module';
import { ManagementInvoicesModule } from './modules/management-invoices/management-invoices.module';
import { ProfitPeriodsModule } from './modules/profit-periods/profit-periods.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { VesselProfitModule } from './modules/vessel-profit/vessel-profit.module';
import { ExchangeRatesModule } from './modules/exchange-rates/exchange-rates.module';
import { ItemsModule } from './modules/items/items.module';
import { FleetModule } from './modules/fleet/fleet.module';
import { MarketModule } from './modules/market/market.module';
import { AuditModule } from './modules/audit/audit.module';
import { AskUmeModule } from './modules/ask-ume/ask-ume.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({ rootPath: join(process.cwd(), 'uploads'), serveRoot: '/uploads' }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // مصدر الاتصال الوحيد = DATABASE_URL من البيئة. لا تُضمَّن أي بيانات اعتماد في الكود.
        // غياب المتغيّر أو عدم صلاحيته ⇒ توقّف فوري (fail-fast) بدل الرجوع لقيم مضمّنة.
        const url = (config.get<string>('DATABASE_URL') || '').trim();
        if (!url) {
          throw new Error('DATABASE_URL is not set. The application will not start without it; no database credentials are embedded in source.');
        }
        if (!/^postgres(ql)?:\/\/.+/.test(url)) {
          // لا تُطبع القيمة إطلاقاً — الرسالة تصف الشكل المتوقّع فقط
          throw new Error('DATABASE_URL is not a valid PostgreSQL connection string. Expected format: postgresql://USER:PASSWORD@HOST:PORT/DATABASE');
        }
        return {
          type: 'postgres' as const,
          url,                                 // Session Pooler · المنفذ يأتي من الرابط (5432)
          ssl: { rejectUnauthorized: false },  // كما هو — دون تغيير
          autoLoadEntities: true,
          synchronize: true,                   // كما هو — التحويل إلى هجرات خارج نطاق هذا الإصدار
        };
      },
    }),
    AuthModule,
    CurrenciesModule,
    SuppliersModule,
    VesselsModule,
    PurchaseOrdersModule,
    InvoicesModule,
    PaymentsModule,
    AttachmentsModule,
    CustomersModule,
    ShippingCompaniesModule,
    HireInvoicesModule,
    ManagementInvoicesModule,
    ProfitPeriodsModule,
    TasksModule,
    VesselProfitModule,
    ExchangeRatesModule,
    ItemsModule,
    FleetModule,
    MarketModule,
    AuditModule,
    AskUmeModule,
  ],
})
export class AppModule {}
