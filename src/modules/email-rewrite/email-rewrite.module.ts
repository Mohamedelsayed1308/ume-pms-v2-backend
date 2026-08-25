import { Module } from '@nestjs/common';
import { EmailRewriteController } from './email-rewrite.controller';

/**
 * وحدةٌ بلا حالة وبلا مخزَن.
 *
 * لا `TypeOrmModule.forFeature` ولا مزوِّدين: الكنترولر يأخذ نصّاً ويردّ نصّاً.
 * وغيابُ المستودعات هنا **قرارٌ لا نقص**: الإصدار الأوّل ممنوعٌ عليه قراءة
 * قاعدة البيانات، فلا يُفتح له بابٌ إليها أصلاً.
 *
 * ولا `CommonAuthzModule` كذلك — فالشاشة `always` ولا `ScreenGuard` عليها،
 * فلا خدمةَ صلاحياتٍ تُحقن.
 */
@Module({
  controllers: [EmailRewriteController],
})
export class EmailRewriteModule {}
