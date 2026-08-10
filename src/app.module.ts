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
        // يفضّل DATABASE_URL من البيئة (Railway). الـfallback مؤقّت لضمان صفر توقّف
        // ويُزال بعد تأكيد المتغيّر على Railway وتدوير كلمة المرور في Supabase.
        const url = config.get<string>('DATABASE_URL');
        if (url && url.startsWith('postgres')) {
          return {
            type: 'postgres' as const,
            url,
            ssl: { rejectUnauthorized: false },
            autoLoadEntities: true,
            synchronize: true,
          };
        }
        return {
          type: 'postgres' as const,
          host: config.get<string>('DB_HOST') || 'aws-0-eu-west-1.pooler.supabase.com',
          port: Number(config.get('DB_PORT')) || 5432,
          username: config.get<string>('DB_USER') || 'postgres.euzikjnyoprzkweechky',
          password: config.get<string>('DB_PASSWORD') || 'mRfDwTNUWn2V1l36',
          database: config.get<string>('DB_NAME') || 'postgres',
          ssl: { rejectUnauthorized: false },
          autoLoadEntities: true,
          synchronize: true,
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
