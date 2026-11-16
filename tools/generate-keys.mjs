import { generateKeyPairSync, randomBytes } from 'node:crypto';
import {writeFile} from 'node:fs/promises';

const {privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const jwk=privateKey.export({format:'jwk'});
const publicKey=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('base64url');
const secrets={API_KEY:randomBytes(32).toString('base64url'),VAPID_PUBLIC_KEY:publicKey,
  VAPID_PRIVATE_KEY:jwk.d,SHEETS_WEBHOOK_SECRET:randomBytes(32).toString('base64url')};
const file=new URL('../.env.generated',import.meta.url);
await writeFile(file,Object.entries(secrets).map(([key,value])=>`${key}=${value}`).join('\n')+'\n',{flag:'wx',mode:0o600});
console.log('Ключи записаны в .env.generated (исключён из Git). Значения не выводятся.');
