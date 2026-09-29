/*
 * ملكيّة عمليّات عنقود الاختبار — لا يُنهى إلّا ما ثبت أنّه منّا.
 *
 * عند الإقلاع يُسجَّل معرّف عمليّة الـ postmaster (من postmaster.pid) ووقت نشوئها.
 * وعند التنظيف يُنهى:
 *   • الـ postmaster المسجَّل نفسه — إن بقي بالمعرّف نفسه ووقت النشوء نفسه (لا معرّفاً أُعيد استعماله)؛
 *   • وأبناؤه المباشرون — ومنهم العامل اليتيم الذي يبقى على ويندوز بعد الإيقاف ويظلّ أبوه المسجَّل
 *     معرّفَ الـ postmaster — بشرط أن ينشأ بعد نشوئه (فلا يُحسب ابنٌ لعمليّةٍ قديمة بالمعرّف نفسه).
 * ولا يُنهى شيءٌ بمطابقة نصّ: عاملٌ يتيم من عنقودٍ آخر (أبوه ميّت) لا يُمسّ أبداً.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

/** معرّف الـ postmaster من ملفّ العنقود — السطر الأوّل. */
function postmasterPid(dir) {
  try { return Number(fs.readFileSync(require('node:path').join(dir, 'postmaster.pid'), 'utf8').split(/\r?\n/)[0]) || null; } catch { return null; }
}

/**
 * العمليّات التي تخصّ العنقود المسجَّل وحده.
 * @param {{pid:number, ppid:number, name:string, created:number}[]} procs
 * @param {{pid:number, created:number}} owner  postmaster المسجَّل ووقت نشوئه (ms)
 */
function selectOwned(procs, owner) {
  if (!owner || !owner.pid || !owner.created) return [];
  const pg = (p) => /^postgres(\.exe)?$/i.test(p.name || '');
  // عمليّةٌ حيّة بالمعرّف نفسه ووقت نشوءٍ آخر = المعرّف أُعيد استعماله لغيرنا: أبناؤها ليسوا منّا، فلا يُنهى شيء
  if (procs.some((p) => p.pid === owner.pid && Math.abs(p.created - owner.created) >= 2000)) return [];
  const out = [];
  for (const p of procs) {
    if (!pg(p)) continue;
    const isPostmaster = p.pid === owner.pid && Math.abs(p.created - owner.created) < 2000;
    const isChild = p.ppid === owner.pid && p.created >= owner.created - 1000;
    if (isPostmaster || isChild) out.push(p.pid);
  }
  return out;
}

/** عمليّات postgres على ويندوز: المعرّف والأب والاسم ووقت النشوء. */
function listWindows() {
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='postgres.exe'\" | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; ppid = $_.ParentProcessId; name = $_.Name; created = [DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds() } } | ConvertTo-Json -Compress";
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 30000 });
  const txt = (r.stdout || '').trim();
  if (!txt) return [];
  const j = JSON.parse(txt);
  return Array.isArray(j) ? j : [j];
}

/** يسجّل مالك العنقود بعد الإقلاع. */
function recordOwner(dir) {
  const pid = postmasterPid(dir);
  if (!pid) return null;
  const me = process.platform === 'win32' ? listWindows().find((p) => p.pid === pid) : null;
  return { pid, created: me ? me.created : Date.now() };
}

module.exports = { postmasterPid, selectOwned, listWindows, recordOwner };
