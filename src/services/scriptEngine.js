// Sandboxed script engine: QuickJS compiled to WASM. No fs/net/process/require; CPU + memory limited.
// Scripts see only a JSON snapshot and return a JSON diff, so a malicious script cannot touch the host.
import { getQuickJS } from "quickjs-emscripten";
import { config } from "../config.js";

const PRELUDE = `
(function(){
  const IN = JSON.parse(__input); const logs = [], tests = [];
  const mk = (o) => ({ get:(k)=>o[k], set:(k,v)=>{o[k]=String(v)}, unset:(k)=>{delete o[k]}, has:(k)=>k in o, toObject:()=>({...o}) });
  const out = { variables:{...IN.variables}, environment:{...IN.environment}, collectionVariables:{...IN.collectionVariables}, request:{...IN.request}};
  const fmt = (a)=>a.map(x=>typeof x==='string'?x:(()=>{try{return JSON.stringify(x)}catch(e){return String(x)}})()).join(' ');
  for (const l of ['log','info','warn','error','debug']) globalThis.console = Object.assign(globalThis.console||{}, {[l]:(...a)=>logs.push({level:l==='log'?'info':l,message:fmt(a)})});
  const R = IN.response ? { code:IN.response.status, status:IN.response.status, statusText:IN.response.statusText, headers:IN.response.headers, responseTime:IN.response.durationMs, text:()=>IN.response.body,
    json:()=>JSON.parse(IN.response.body) } : undefined;
  const mkExpect = (v, neg=false) => {
    const chk = (ok, msg) => { if (neg ? ok : !ok) throw new Error(msg); };
    const api = {
      toBe:(e)=>chk(Object.is(v,e), 'expected '+fmt([v])+(neg?' not':'')+' to be '+fmt([e])),
      toEqual:(e)=>chk(JSON.stringify(v)===JSON.stringify(e), 'expected '+fmt([v])+(neg?' not':'')+' to equal '+fmt([e])),
      toBeTruthy:()=>chk(!!v,'expected value to be truthy'), toBeFalsy:()=>chk(!v,'expected value to be falsy'),
      toContain:(e)=>chk(v!=null && v.includes(e),'expected '+fmt([v])+' to contain '+fmt([e])),
      toBeGreaterThan:(e)=>chk(v>e,'expected '+v+' > '+e), toBeLessThan:(e)=>chk(v<e,'expected '+v+' < '+e),
      toHaveProperty:(k)=>chk(v!=null && k in Object(v),'expected object to have property '+k),
    };
    Object.defineProperty(api,'not',{get:()=>mkExpect(v,!neg)});
    return api;
  };
  const test = (name, fn) => { try { fn(); tests.push({name, passed:true}); } catch(e) { tests.push({name, passed:false, error:String(e&&e.message||e)}); } };
  globalThis.pm = { variables:mk(out.variables), environment:mk(out.environment), collectionVariables:mk(out.collectionVariables),
    request:{ get url(){return out.request.url}, get method(){return out.request.method}, headers:{ add:(k,v)=>{out.request.headers=out.request.headers||{}; out.request.headers[k]=String(v)}, get:(k)=>(out.request.headers||{})[k] } },
    response:R, test, expect:(v)=>mkExpect(v) };
  globalThis.test = test; globalThis.expect = pm.expect; globalThis.response = R;
  globalThis.__result = () => JSON.stringify({ variables:out.variables, environment:out.environment, collectionVariables:out.collectionVariables, requestHeaders:out.request.headers||{}, logs, tests });
})();`;

let qjs;
export async function runScript(
  code,
  ctx,
  { timeoutMs = config.scriptTimeoutMs, memoryBytes = 32 * 1024 * 1024 } = {},
) {
  const result = {
    ok: true,
    variables: ctx.variables,
    environment: ctx.environment,
    collectionVariables: ctx.collectionVariables,
    requestHeaders: {},
    logs: [],
    tests: [],
    error: null,
  };
  if (!code?.trim()) return result;
  qjs ??= await getQuickJS();
  const rt = qjs.newRuntime();
  rt.setMemoryLimit(memoryBytes);
  rt.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + timeoutMs;
  rt.setInterruptHandler(() => Date.now() > deadline);
  const vm = rt.newContext();
  try {
    const input = vm.newString(JSON.stringify(ctx));
    vm.setProp(vm.global, "__input", input);
    input.dispose();
    const run = (src) => {
      const r = vm.evalCode(src);
      if (r.error) {
        const e = vm.dump(r.error);
        r.error.dispose();
        throw Object.assign(new Error(e?.message ?? String(e)), {
          stackTrace: e?.stack,
        });
      }
      r.value.dispose();
    };
    run(PRELUDE);
    try {
      run(code);
    } catch (e) {
      result.ok = false;
      result.error = {
        message: /interrupted/i.test(e.message)
          ? `Script timed out after ${timeoutMs}ms`
          : e.message,
        stack: e.stackTrace,
      };
    }
    const r = vm.evalCode("__result()");
    if (!r.error) {
      Object.assign(result, JSON.parse(vm.getString(r.value)));
      r.value.dispose();
    } else r.error.dispose();
  } catch (e) {
    result.ok = false;
    result.error = { message: e.message };
  } finally {
    vm.dispose();
    rt.dispose();
  }
  return result;
}
