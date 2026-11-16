import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const raw=await fs.readFile(new URL('../.env.generated',import.meta.url),'utf8');
const secrets=Object.fromEntries(raw.trim().split(/\r?\n/).map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));
const allowed=['API_KEY','VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','SHEETS_WEBHOOK_SECRET'];
if (!allowed.every(key=>typeof secrets[key]==='string' && secrets[key].length>=32) || Object.keys(secrets).length!==allowed.length) throw new Error('Unexpected generated secrets');
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','bulk'],{
  cwd:new URL('..',import.meta.url),input:JSON.stringify(secrets),encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'},
});
process.stdout.write(result.stdout || '');process.stderr.write(result.stderr || '');
process.exitCode=result.status ?? 1;
