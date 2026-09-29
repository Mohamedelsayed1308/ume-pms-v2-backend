import { createRequire } from 'node:module';

const { listWindows, selectOwned } = createRequire(import.meta.url)('./owned-processes.cjs');

export default async function teardown() {
  const pg = globalThis.__CREW_PG__;
  if (pg) { try { await pg.stop(); } catch { /* يُكمل التنظيف */ } }
  // على ويندوز قد يبقى عاملٌ يتيم بعد الإيقاف. يُنهى ما ثبتت ملكيّته وحده: الـ postmaster المسجَّل
  // عند الإقلاع وأبناؤه — لا مطابقة نصّ، فلا يُمسّ عنقودٌ آخر ولا عاملٌ يتيمٌ من عنقودٍ آخر.
  const owner = globalThis.__CREW_PG_OWNER__;
  if (process.platform === 'win32' && owner) {
    for (const pid of selectOwned(listWindows(), owner)) {
      try { process.kill(pid); } catch { /* انتهى بنفسه */ }
    }
  }
}
