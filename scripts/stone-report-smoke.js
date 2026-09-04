/*
 * فحص دخانٍ لتقرير الإدارة — يركّب رسم التبعيات كاملاً (كما يفعل الإقلاع)
 * ويولّد التقرير بلغةٍ واحدةٍ أو لغتين عبر الخدمة نفسها، بلا HTTP ولا رمز.
 *
 *   node -r dotenv/config scripts/stone-report-smoke.js ar
 *   node -r dotenv/config scripts/stone-report-smoke.js en
 *
 * يطبع الأرقام والسرد ونتيجة الحارس. لا يكتب شيئاً في القاعدة.
 */
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { InvestmentsService } = require('../dist/modules/investments/investments.service');
const { StoneReportService } = require('../dist/modules/investments/stone-report.service');

(async () => {
  const lang = process.argv[2] === 'en' ? 'en' : 'ar';
  const t0 = Date.now();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  console.log(`⏱ السياق أقلع في ${Date.now() - t0} ms`);
  const inv = app.get(InvestmentsService);
  const rep = app.get(StoneReportService);
  const card = await inv.card();
  console.log('summary:', JSON.stringify(card.summary));
  for (const r of card.rounds) {
    console.log(`round ${r.round_no}: contributed ${r.contributed} · at_stone ${r.capital_at_stone} · realized ${r.realized_gain} · share ${r.bee_share_pct}% · book ${r.book_result_share} · report ${r.fund_report ? r.fund_report.as_of : '-'}`);
  }
  const t1 = Date.now();
  const out = await rep.generate(card, lang, 'smoke');
  console.log(`⏱ التوليد ${Date.now() - t1} ms · model ${out.model} · guard ${JSON.stringify(out.guard)}`);
  const n = out.narrative;
  console.log('\n=== ' + n.title + '\n' + n.headline + '\n\n[overview]\n' + n.overview + '\n\n[round7]\n' + n.round7 + '\n\n[round8]\n' + n.round8 + '\n\n[returns]\n' + n.returns + '\n\n[risks]\n- ' + n.risks.join('\n- ') + '\n\n[next]\n- ' + n.next_steps.join('\n- '));
  await app.close();
})().catch((e) => { console.error('ERR', e && e.message ? e.message : e); process.exit(1); });
