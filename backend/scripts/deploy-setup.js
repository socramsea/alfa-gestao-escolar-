import { spawn } from 'node:child_process';
import { once } from 'node:events';
for (const file of ['scripts/migrate.js','scripts/provision-passwords.js','scripts/bootstrap-school.js']) {
  const child = spawn(process.execPath,[file],{env:process.env,stdio:'inherit'});
  const [code] = await once(child,'exit');
  if (code !== 0) { process.exitCode = 1; break; }
}
