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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({ rootPath: join(process.cwd(), 'uploads'), serveRoot: '/uploads' }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
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
    AuthModule,
    CurrenciesModule,
    SuppliersModule,
    VesselsModule,
    PurchaseOrdersModule,
    InvoicesModule,
    PaymentsModule,
    AttachmentsModule,
  ],
})
export class AppModule {}
