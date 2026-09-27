/**
 * صاحب صلاحية اعتماد المرتّبات — **معرّف مستخدمٍ ثابت واحد**، لا دور.
 *
 * يُقرأ من متغيّر البيئة `CREW_SALARY_APPROVER_USER_ID`. وغيابه أو فساده يعني
 * **لا معتمد**: كلّ اعتمادٍ مرفوضٌ افتراضيّاً. ولا يُمنح لكلّ أدمن، ولا يُعدَّل من
 * الواجهة — فلا يستطيع مستخدمٌ أن يمنح نفسه الصلاحية.
 *
 * ويشمل الاعتمادُ: إصدارات المرتّبات، وحسابات الصرف، وتفويضات المستفيد.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function approverId(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = (env.CREW_SALARY_APPROVER_USER_ID || '').trim();
  return UUID.test(v) ? v.toLowerCase() : null;
}

export function isApprover(userId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const a = approverId(env);
  return !!a && !!userId && String(userId).toLowerCase() === a;
}
