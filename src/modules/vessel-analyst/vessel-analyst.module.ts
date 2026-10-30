import { Module } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { CommonAuthzModule } from '../../common/common-authz.module';
import { VesselAnalystController, ANALYST_CLIENT } from './vessel-analyst.controller';

/**
 * مساعد تحليل بنود كارت المركب — قراءةٌ فقط، بلا جداول ولا هجرة.
 * `CommonAuthzModule` لأنّ المسار محروسٌ بشاشة التقارير عبر `ScreenGuard`.
 * والعميل مزوِّدٌ مستقلّ ليُستبدل في الاختبار فلا يُستدعى Claude.
 */
@Module({
  imports: [CommonAuthzModule],
  providers: [{
    provide: ANALYST_CLIENT,
    useFactory: () => (process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null),
  }],
  controllers: [VesselAnalystController],
})
export class VesselAnalystModule {}
