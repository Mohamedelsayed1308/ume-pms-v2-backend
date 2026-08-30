import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { BrokersModule } from './modules/brokers/brokers.module';
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
import { AccountingModule } from './modules/accounting/accounting.module';
import { ReceiptsModule } from './modules/receipts/receipts.module';
import { EmailRewriteModule } from './modules/email-rewrite/email-rewrite.module';
import { InvestmentsModule } from './modules/investments/investments.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { R3aRunnerModule } from './migrations/r3a-runner.module';
import {
  shouldSynchronize,
  assertNoAutoDdlInProduction,
} from './common/schema-policy';
import { EMAIL_REWRITE_THROTTLE, LOGIN_THROTTLE } from './common/rate-limit';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    /*
     * المُحدِّدان مُسجَّلان ولا يحرسان شيئاً بأنفسهما — `ThrottlerGuard` يُوضع
     * على موجّه تسجيل الدخول وعلى موجّه إعادة صياغة الإيميلات وحدهما. فلا حدَّ
     * على بقيّة النظام في هذه المرحلة.
     *
     * ودلوان منفصلان بالاسم: من استنفد صياغاته لا يُمنع من تسجيل الدخول.
     */
    ThrottlerModule.forRoot([LOGIN_THROTTLE, EMAIL_REWRITE_THROTTLE]),
    /*
     * ── حُذف `ServeStaticModule` على `/uploads` ──
     *
     * كان يخدم مجلّد `uploads/` علناً بلا مصادقة، وهو بقيّةٌ من مرحلةٍ سبقت
     * انتقال المرفقات إلى Supabase Storage في 2026-07-17.
     *
     * ولم يكن يخدم شيئاً: المجلّد مُتجاهَلٌ في `.gitignore` فلا يُشحن مع البناء،
     * وقرص الحاوية على Railway يزول مع كلّ نشرة. فحتى الملفّ القديم الوحيد
     * الذي بحوزتنا يردّ `404` على الإنتاج.
     *
     * فالمسار كان باباً مفتوحاً لا يقف خلفه شيء — وأيّ ملفٍّ يصل ذلك المجلّد
     * مستقبلاً كان سيصير عامّاً بلا قصد.
     *
     * والمرفقات اليوم تُخزَّن وتُقرأ عبر `AttachmentsModule` من Supabase.
     */
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // مصدر الاتصال الوحيد = DATABASE_URL من البيئة. لا تُضمَّن أي بيانات اعتماد في الكود.
        // غياب المتغيّر أو عدم صلاحيته ⇒ توقّف فوري (fail-fast) بدل الرجوع لقيم مضمّنة.
        const url = (config.get<string>('DATABASE_URL') || '').trim();
        if (!url) {
          throw new Error(
            'DATABASE_URL is not set. The application will not start without it; no database credentials are embedded in source.',
          );
        }
        if (!/^postgres(ql)?:\/\/.+/.test(url)) {
          // لا تُطبع القيمة إطلاقاً — الرسالة تصف الشكل المتوقّع فقط
          throw new Error(
            'DATABASE_URL is not a valid PostgreSQL connection string. Expected format: postgresql://USER:PASSWORD@HOST:PORT/DATABASE',
          );
        }
        // ── R3A.1 · سلامة المخطط ────────────────────────────────────────────
        // الإنتاج لا يعدّل مخططه تلقائياً. القرار صريح من NODE_ENV، وfail-closed:
        // البيئة غير المعلَنة تُعامَل إنتاجاً. حدث فقدان بيانات فعلي بالسلوك القديم.
        const nodeEnv = config.get<string>('NODE_ENV');
        const synchronize = shouldSynchronize(nodeEnv);
        assertNoAutoDdlInProduction(nodeEnv, synchronize); // حاجز — يمنع أي تسرّب مستقبلي

        return {
          type: 'postgres' as const,
          url, // Session Pooler · المنفذ يأتي من الرابط (5432)
          ssl: { rejectUnauthorized: false }, // كما هو — دون تغيير
          autoLoadEntities: true,
          synchronize, // إنتاج ⇒ false · تطوير/اختبار ⇒ true
          migrationsRun: false, // لا تُشغَّل هجرات عند الإقلاع — تنفيذ صريح فقط
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
    BrokersModule,
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
    EmailRewriteModule,
    InvestmentsModule,
    AccountingModule,
    ReceiptsModule,
    R3aRunnerModule,
  ],
})
export class AppModule {}
