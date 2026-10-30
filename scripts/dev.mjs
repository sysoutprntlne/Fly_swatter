import { spawn } from 'node:child_process';
const children = ['server', 'dashboard'].map(workspace => spawn('npm', ['run', 'dev', '--workspace', workspace], { stdio: 'inherit', detached: true }));
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already stopped */ } }
  }
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', () => stop(1));
  child.on('exit', code => stop(code ?? 0));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
