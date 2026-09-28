/* eslint-disable @typescript-eslint/no-require-imports */
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
const { listWindows, selectOwned, postmasterPid } = require('../../../test/pg/owned-processes.cjs');

/*
 * محاكاةٌ حيّة على ويندوز: عاملٌ يتيم «من عنقودٍ آخر» — عمليّةٌ باسم postgres.exe، في سطرها
 * embedded-postgres و--forkchild، وأبوها ميّت. هذا بالضبط ما كان التنظيف السابق ينهيه.
 * التنظيف الحاليّ يختار الـ postmaster المسجَّل لعنقودنا ولا يختار هذا العامل.
 */
const win = process.platform === 'win32' ? describe : describe.skip;

win('تنظيف عنقود الاختبار لا يمسّ عاملاً من عنقودٍ آخر', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-foreign-pg-'));
  const exe = path.join(dir, 'postgres.exe');
  let orphan = 0;

  beforeAll(() => {
    try { fs.linkSync(process.execPath, exe); } catch { fs.copyFileSync(process.execPath, exe); }
  });
  afterAll(() => {
    if (orphan) { try { process.kill(orphan); } catch { /* انتهى */ } }
    for (let i = 0; i < 20; i++) { try { fs.rmSync(dir, { recursive: true, force: true }); break; } catch { spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},150)']); } }
  });

  it('العامل اليتيم الغريب لا يُختار، والـ postmaster المسجَّل يُختار', async () => {
    // أبٌ يُطلق عاملاً منفصلاً ثمّ يموت — فيبقى العامل يتيماً. كلاهما «postgres.exe»
    const worker = "['-e', 'setTimeout(() => {}, 120000)', '--', '--forkchild', 'embedded-postgres-foreign']";
    const code = `const c = require('child_process').spawn(process.execPath, ${worker}, { detached: true, stdio: 'ignore' }); c.unref(); console.log(c.pid);`;
    const parent = spawn(exe, ['-e', code], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    parent.stdout!.on('data', (d) => { out += d; });
    await new Promise((r) => parent.on('exit', r));
    orphan = Number(out.trim());
    expect(orphan).toBeGreaterThan(0);

    const procs = listWindows();
    const o = procs.find((p: any) => p.pid === orphan);
    expect(o).toBeTruthy();                                        // حيّ، واسمه postgres.exe
    expect(procs.some((p: any) => p.pid === o.ppid)).toBe(false);  // وأبوه ميّت: يتيم

    const clusterDir = process.env.CREW_PG_DIR || path.join(os.tmpdir(), 'ume-crew-pg-cluster');
    const pid = postmasterPid(clusterDir);
    const me = procs.find((p: any) => p.pid === pid);
    expect(me).toBeTruthy();
    const chosen = selectOwned(procs, { pid, created: me.created });
    expect(chosen).toContain(pid);
    expect(chosen).not.toContain(orphan);
  });
});
