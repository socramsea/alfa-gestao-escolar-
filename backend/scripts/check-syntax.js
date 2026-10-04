import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for (const root of ['src', 'scripts', 'tests', 'migrations']) {
  for (const name of await readdir(root, { recursive: true })) {
    if (!name.endsWith('.js')) continue;
    const result = spawnSync(process.execPath, ['--check', `${root}/${name}`], { stdio: 'inherit' });
    if (result.status !== 0) process.exitCode = 1;
  }
}
