import { spawnSync } from 'node:child_process';

export default async function teardown() {
  const pg = globalThis.__CREW_PG__;
  if (pg) { try { await pg.stop(); } catch { /* يُكمل التنظيف */ } }
  // على ويندوز قد يبقى عاملُ إدخالٍ يتيم بعد الإيقاف — نُنهي ما ينتمي لحزمتنا وحدها
  if (process.platform === 'win32') {
    const script = "Get-CimInstance Win32_Process -Filter \"Name='postgres.exe'\" | "
      + "Where-Object { $_.CommandLine -like '*embedded-postgres*' } | "
      + 'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';
    spawnSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore', timeout: 30000 });
  }
}
