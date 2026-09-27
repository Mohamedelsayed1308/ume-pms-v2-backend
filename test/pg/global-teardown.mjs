import { spawnSync } from 'node:child_process';

export default async function teardown() {
  const pg = globalThis.__CREW_PG__;
  if (pg) { try { await pg.stop(); } catch { /* يُكمل التنظيف */ } }
  // على ويندوز قد يبقى عاملُ إدخالٍ يتيم بعد الإيقاف. نُنهي ما يخصّ عنقود الاختبار وحده:
  // العمليّة التي في سطرها مجلّده، أو العامل الفرعيّ الذي مات أبوه — ولا نمسّ عنقوداً آخر يعمل.
  if (process.platform === 'win32') {
    const dir = (process.env.CREW_PG_DIR || 'ume-crew-pg-cluster').replace(/'/g, "''");
    const script = [
      "$all = Get-CimInstance Win32_Process -Filter \"Name='postgres.exe'\" | Where-Object { $_.CommandLine -like '*embedded-postgres*' }",
      "$ids = @($all | ForEach-Object { $_.ProcessId })",
      `$all | Where-Object { $_.CommandLine -like '*${dir}*' -or ($_.CommandLine -like '*--forkchild*' -and -not ($ids -contains $_.ParentProcessId) -and -not (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue)) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    ].join('; ');
    spawnSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore', timeout: 30000 });
  }
}
