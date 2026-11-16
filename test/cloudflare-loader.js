import { registerHooks } from 'node:module';

// Node's test runner does not provide the Cloudflare runtime module.
// This stub is used only by npm test; Wrangler deploy uses the real module.
const stub='data:text/javascript,'+encodeURIComponent('export class DurableObject { constructor(ctx,env) { this.ctx=ctx; this.env=env; } }');
registerHooks({
  resolve(specifier,context,nextResolve) {
    if (specifier==='cloudflare:workers') return {url:stub,shortCircuit:true};
    return nextResolve(specifier,context);
  },
});
