// Sandboxed script engine: QuickJS compiled to WASM. No fs/net/process; CPU + memory limited.
// Scripts see only a JSON snapshot and return a JSON diff, so a malicious script cannot touch the host.
//
// Pre-request scripts may rewrite the outgoing request (url, method, headers, query params, body) through the
// Postman-compatible `pm.request` API. Post-request scripts may rewrite the response before it reaches the UI
// (`pm.response.setBody / setStatus / setHeader`). `CryptoJS` / `require("crypto-js")` is available on demand.
import fs from "node:fs";
import { createRequire } from "node:module";
import { getQuickJS } from "quickjs-emscripten";
import { config } from "../config.js";

let cryptoSrc;
const loadCryptoJs = () =>
  (cryptoSrc ??= fs.readFileSync(
    createRequire(import.meta.url).resolve("crypto-js/crypto-js.js"),
    "utf8",
  ));
const needsCrypto = (code) => /CryptoJS|crypto-js/.test(code);

const PRELUDE = `
(function(){
  const IN = JSON.parse(__input); const logs = [], tests = [];
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const str = (v) => v !== null && typeof v === 'object' && (Array.isArray(v) || v.toString === Object.prototype.toString) ? JSON.stringify(v) : String(v);
  const fmt = (a)=>a.map(x=>typeof x==='string'?x:(()=>{try{return JSON.stringify(x)}catch(e){return String(x)}})()).join(' ');
  const deepEq = (a,b) => JSON.stringify(a)===JSON.stringify(b);

  // ---- variable scopes -------------------------------------------------------------------------------------------
  const out = { variables:{...IN.variables}, environment:{...IN.environment}, collectionVariables:{...IN.collectionVariables}, globals:{...IN.globals} };
  const scope = IN.scope || {};
  const mk = (o, fallback) => ({
    get:(k)=> k in o ? o[k] : (fallback ? fallback[k] : undefined),
    set:(k,v)=>{o[k]=str(v)}, unset:(k)=>{delete o[k]}, has:(k)=> k in o || (!!fallback && k in fallback),
    clear:()=>{for(const k of Object.keys(o)) delete o[k]}, toObject:()=>({...(fallback||{}), ...o}),
    replaceIn:(s)=>{const all={...(fallback||{}), ...o}; let cur=String(s); for(let i=0;i<5;i++){const n=cur.replace(/\\{\\{\\s*([\\w.\\-]+)\\s*\\}\\}/g,(m,k)=>k in all?all[k]:m); if(n===cur)break; cur=n} return cur},
  });
  const vars = mk(out.variables, scope);

  // ---- request (pre-request scripts can change it) ---------------------------------------------------------------
  const rq = IN.request || {};
  const R0 = { url: rq.url ?? '', method: rq.method ?? 'GET', headers: copy(rq.headers||[]), params: copy(rq.params||[]), body: copy(rq.body||{mode:'none'}) };
  const mkList = (arr, ci, onChange) => {
    const same = (a,b) => ci ? String(a).toLowerCase()===String(b).toLowerCase() : a===b;
    const item = (a,b) => {
      if (a && typeof a==='object') return { key:String(a.key), value:str(a.value ?? ''), enabled: a.disabled ? false : a.enabled !== false };
      const s = String(a); if (b === undefined && s.includes(':')) { const i=s.indexOf(':'); return { key:s.slice(0,i).trim(), value:s.slice(i+1).trim(), enabled:true } }
      return { key:s, value:str(b ?? ''), enabled:true };
    };
    const find = (k) => arr.find(x => x.enabled!==false && same(x.key,k));
    const touch = () => onChange && onChange();
    return {
      add:(a,b)=>{arr.push(item(a,b)); touch()},
      upsert:(a,b)=>{const it=item(a,b); const e=arr.find(x=>same(x.key,it.key)); if(e){e.value=it.value;e.enabled=true}else arr.push(it); touch()},
      remove:(k)=>{for(let i=arr.length-1;i>=0;i--) if(same(arr[i].key,k)) arr.splice(i,1); touch()},
      get:(k)=>{const e=find(k); return e ? e.value : undefined}, has:(k)=>!!find(k),
      clear:()=>{arr.length=0; touch()}, count:()=>arr.filter(x=>x.enabled!==false).length,
      all:()=>arr.filter(x=>x.enabled!==false).map(x=>({key:x.key,value:x.value})),
      toObject:()=>Object.fromEntries(arr.filter(x=>x.enabled!==false).map(x=>[x.key,x.value])),
      each:(fn)=>arr.filter(x=>x.enabled!==false).forEach(x=>fn({key:x.key,value:x.value})),
    };
  };
  const RAWISH = ['json','text','raw'];
  const body = R0.body; body.fields = body.fields || [];
  const bodyApi = {
    get mode(){ return body.mode==='multipart' ? 'formdata' : RAWISH.includes(body.mode) ? 'raw' : body.mode },
    set mode(m){ m = String(m); if (m==='raw') { if(!RAWISH.includes(body.mode)) body.mode='raw' } else if (m==='formdata') body.mode='multipart'; else if (m==='urlencoded'||m==='none') body.mode=m; else throw new Error('Unsupported body mode: '+m) },
    get raw(){ return RAWISH.includes(body.mode) ? (body.content ?? '') : undefined },
    set raw(v){
      const s = typeof v === 'string' ? v : str(v);
      if (!RAWISH.includes(body.mode)) { let ok = false; try { JSON.parse(s); ok = true } catch(e) {} body.mode = ok ? 'json' : 'raw' }
      body.content = s;
    },
    urlencoded: mkList(body.fields, false, ()=>{ if(body.mode!=='urlencoded') body.mode='urlencoded' }),
    formdata: mkList(body.fields, false, ()=>{ if(body.mode!=='multipart') body.mode='multipart' }),
    update(v){
      if (typeof v === 'string' || (v && typeof v==='object' && v.raw === undefined && !v.urlencoded && !v.formdata && !v.mode)) { this.raw = v; return }
      if (v.mode) this.mode = v.mode;
      if (v.raw !== undefined) this.raw = v.raw;
      const fill = (src, mode) => { body.fields.length = 0; body.mode = mode; (Array.isArray(src)?src:Object.entries(src).map(([key,value])=>({key,value}))).forEach(f=>body.fields.push({key:String(f.key),value:str(f.value??''),enabled:f.disabled?false:f.enabled!==false})) };
      if (v.urlencoded) fill(v.urlencoded,'urlencoded'); if (v.formdata) fill(v.formdata,'multipart');
    },
    isEmpty:()=> body.mode==='none' || (RAWISH.includes(body.mode) ? !(body.content||'') : !body.fields.length),
    toString:()=> RAWISH.includes(body.mode) ? (body.content ?? '') : '',
  };
  const headersApi = mkList(R0.headers, true), paramsApi = mkList(R0.params, false);
  const requestApi = {
    get url(){ return R0.url }, set url(v){ R0.url = String(v) },
    get method(){ return R0.method }, set method(v){ R0.method = String(v).toUpperCase() },
    headers: headersApi, params: paramsApi, body: bodyApi,
    addHeader:(a,b)=>headersApi.upsert(a,b), removeHeader:(k)=>headersApi.remove(k),
  };

  // ---- response (post-request scripts can change it before it is sent to the UI) -------------------------------
  let respApi;
  const changed = new Set();
  const RS = IN.response ? { status: IN.response.status, statusText: IN.response.statusText, body: IN.response.body ?? '', headers: { ...(IN.response.headers||{}) } } : null;
  if (RS) {
    const hdrs = RS.headers;
    const find = (k) => Object.keys(hdrs).find(x => x.toLowerCase()===String(k).toLowerCase());
    Object.defineProperty(hdrs,'get',{value:(k)=>{const f=find(k); return f===undefined?undefined:hdrs[f]}, enumerable:false});
    Object.defineProperty(hdrs,'has',{value:(k)=>find(k)!==undefined, enumerable:false});
    const fail = (m) => { throw new Error(m) };
    const to = {
      have: {
        status:(v)=>{ const ok = typeof v==='number' ? RS.status===v : RS.statusText===v; if(!ok) fail('expected response to have status '+v+' but got '+RS.status+' '+RS.statusText) },
        header:(k,v)=>{ const f=find(k); if(f===undefined) fail('expected response to have header '+k); if(v!==undefined && hdrs[f]!==v) fail('expected header '+k+' to be '+v+' but got '+hdrs[f]) },
        body:(v)=>{ const ok = v instanceof RegExp ? v.test(RS.body) : RS.body===v; if(!ok) fail('expected response body to match') },
        jsonBody:(k,v)=>{ const j=JSON.parse(RS.body); if(k===undefined) return; if(!(k in Object(j))) fail('expected JSON body to have key '+k); if(v!==undefined && !deepEq(j[k],v)) fail('expected JSON body key '+k+' to equal '+fmt([v])) },
      },
      be: {},
    };
    const flag = (name, pred, msg) => Object.defineProperty(to.be, name, { get:()=>{ if(!pred(RS.status)) fail('expected response to be '+msg+' but got status '+RS.status); return true } });
    flag('ok', s=>s===200, 'OK (200)'); flag('success', s=>s>=200&&s<300, 'successful (2xx)'); flag('redirection', s=>s>=300&&s<400, 'a redirect (3xx)');
    flag('clientError', s=>s>=400&&s<500, 'a client error (4xx)'); flag('serverError', s=>s>=500&&s<600, 'a server error (5xx)'); flag('error', s=>s>=400, 'an error (4xx/5xx)');
    respApi = {
      code:RS.status, status:RS.status, statusText:RS.statusText, headers:hdrs, responseTime:IN.response.durationMs, to,
      text:()=>RS.body, json:()=>JSON.parse(RS.body),
      get body(){ return RS.body }, set body(v){ respApi.setBody(v) },
      setBody:(v)=>{ RS.body = typeof v==='string' ? v : str(v); changed.add('body');
        if (typeof v!=='string' && !(find('content-type') && /json/i.test(hdrs[find('content-type')]))) respApi.setHeader('Content-Type','application/json') },
      setStatus:(code,text)=>{ RS.status = respApi.code = respApi.status = Number(code); if(text!==undefined) RS.statusText = respApi.statusText = String(text); changed.add('status') },
      setHeader:(k,v)=>{ const f=find(k); if(f!==undefined) delete hdrs[f]; hdrs[String(k)] = str(v); changed.add('headers') },
      removeHeader:(k)=>{ const f=find(k); if(f!==undefined){ delete hdrs[f]; changed.add('headers') } },
    };
  }

  // ---- assertions (jest style + chai style) ----------------------------------------------------------------------
  const CHAIN = ['to','be','been','is','that','which','and','has','have','with','at','of','same','but','does','still','also'];
  const mkExpect = (v, o = {}) => {
    const neg = !!o.neg, eq = (a,b) => o.deep ? deepEq(a,b) : Object.is(a,b);
    const chk = (ok, msg) => { if (neg ? ok : !ok) throw new Error(msg); };
    const n = neg ? ' not' : '';
    const typeOf = (x) => x===null ? 'null' : Array.isArray(x) ? 'array' : typeof x;
    const incl = (e) => typeof v==='string' ? v.includes(e) : Array.isArray(v) ? (o.deep ? v.some(x=>deepEq(x,e)) : v.includes(e)) : v!=null && typeof v==='object' ? Object.entries(e).every(([k,x])=>deepEq(v[k],x)) : false;
    const api = {
      toBe:(e)=>chk(Object.is(v,e), 'expected '+fmt([v])+n+' to be '+fmt([e])),
      toEqual:(e)=>chk(deepEq(v,e), 'expected '+fmt([v])+n+' to equal '+fmt([e])),
      toBeTruthy:()=>chk(!!v,'expected value'+n+' to be truthy'), toBeFalsy:()=>chk(!v,'expected value'+n+' to be falsy'),
      toContain:(e)=>chk(v!=null && v.includes(e),'expected '+fmt([v])+n+' to contain '+fmt([e])),
      toBeGreaterThan:(e)=>chk(v>e,'expected '+v+n+' > '+e), toBeLessThan:(e)=>chk(v<e,'expected '+v+n+' < '+e),
      toHaveProperty:(k)=>chk(v!=null && k in Object(v),'expected object'+n+' to have property '+k),
      equal:(e)=>chk(eq(v,e),'expected '+fmt([v])+n+' to equal '+fmt([e])), eq:(e)=>api.equal(e), equals:(e)=>api.equal(e),
      eql:(e)=>chk(deepEq(v,e),'expected '+fmt([v])+n+' to deeply equal '+fmt([e])), eqls:(e)=>api.eql(e),
      include:(e)=>chk(incl(e),'expected '+fmt([v])+n+' to include '+fmt([e])), includes:(e)=>api.include(e), contain:(e)=>api.include(e), contains:(e)=>api.include(e),
      above:(e)=>chk(v>e,'expected '+v+n+' to be above '+e), gt:(e)=>api.above(e), greaterThan:(e)=>api.above(e),
      below:(e)=>chk(v<e,'expected '+v+n+' to be below '+e), lt:(e)=>api.below(e), lessThan:(e)=>api.below(e),
      least:(e)=>chk(v>=e,'expected '+v+n+' to be at least '+e), gte:(e)=>api.least(e), most:(e)=>chk(v<=e,'expected '+v+n+' to be at most '+e), lte:(e)=>api.most(e),
      property:(k,val)=>chk(v!=null && k in Object(v) && (val===undefined || eq(v[k],val)),'expected object'+n+' to have property '+k),
      lengthOf:(e)=>chk(v!=null && v.length===e,'expected length '+(v&&v.length)+n+' to be '+e), length:(e)=>api.lengthOf(e),
      match:(re)=>chk(re.test(String(v)),'expected '+fmt([v])+n+' to match '+re), string:(s)=>chk(String(v).includes(s),'expected '+fmt([v])+n+' to contain '+fmt([s])),
      oneOf:(list)=>chk(list.includes(v),'expected '+fmt([v])+n+' to be one of '+fmt([list])),
      keys:(...ks)=>{ const a=ks.flat(); chk(v!=null && a.every(k=>k in Object(v)),'expected object'+n+' to have keys '+a.join(', ')) },
    };
    const getters = {
      not:()=>mkExpect(v,{...o,neg:!neg}), deep:()=>mkExpect(v,{...o,deep:true}),
      true:()=>chk(v===true,'expected '+fmt([v])+n+' to be true'), false:()=>chk(v===false,'expected '+fmt([v])+n+' to be false'),
      null:()=>chk(v===null,'expected '+fmt([v])+n+' to be null'), undefined:()=>chk(v===undefined,'expected '+fmt([v])+n+' to be undefined'),
      ok:()=>chk(!!v,'expected '+fmt([v])+n+' to be truthy'), exist:()=>chk(v!=null,'expected value'+n+' to exist'),
      empty:()=>chk(v==null || (typeof v==='object' ? Object.keys(v).length===0 : String(v).length===0),'expected '+fmt([v])+n+' to be empty'), NaN:()=>chk(Number.isNaN(v),'expected '+fmt([v])+n+' to be NaN'),
    };
    for (const k of CHAIN) Object.defineProperty(api,k,{ get:()=>api, enumerable:false });
    for (const k of ['a','an']) api[k] = (t) => chk(typeOf(v)===String(t).toLowerCase(),'expected '+fmt([v])+n+' to be a '+t);
    for (const [k,f] of Object.entries(getters)) Object.defineProperty(api,k,{ get:()=>{ const r=f(); return r===undefined ? api : r }, enumerable:false });
    return api;
  };
  const test = (name, fn) => { try { fn(); tests.push({name, passed:true}); } catch(e) { tests.push({name, passed:false, error:String(e&&e.message||e)}); } };

  // ---- helpers commonly used by Postman scripts ------------------------------------------------------------------
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  globalThis.btoa = globalThis.btoa || ((s)=>{ s=String(s); let o=''; for(let i=0;i<s.length;i+=3){ const a=s.charCodeAt(i),b=s.charCodeAt(i+1),c=s.charCodeAt(i+2); if(a>255||b>255||c>255) throw new Error('btoa: invalid character'); const n=(a<<16)|((b||0)<<8)|(c||0); o+=B64[n>>18&63]+B64[n>>12&63]+(i+1<s.length?B64[n>>6&63]:'=')+(i+2<s.length?B64[n&63]:'=') } return o });
  globalThis.atob = globalThis.atob || ((s)=>{ s=String(s).replace(/=+$/,''); let o='',bits=0,acc=0; for(const ch of s){ const v=B64.indexOf(ch); if(v<0) throw new Error('atob: invalid character'); acc=(acc<<6)|v; bits+=6; if(bits>=8){ bits-=8; o+=String.fromCharCode((acc>>bits)&255) } } return o });
  globalThis.require = (name) => { if (name==='crypto-js' && globalThis.CryptoJS) return globalThis.CryptoJS; throw new Error("Module '"+name+"' is not available in the sandbox (supported: crypto-js)") };

  for (const l of ['log','info','warn','error','debug']) globalThis.console = Object.assign(globalThis.console||{}, {[l]:(...a)=>logs.push({level:l==='log'?'info':l,message:fmt(a)})});
  const envApi = mk(out.environment), globApi = mk(out.globals), collApi = mk(out.collectionVariables);
  globalThis.pm = { variables:vars, environment:envApi, globals:globApi, collectionVariables:collApi, request:requestApi, response:respApi, test, expect:(v)=>mkExpect(v),
    info:{ eventName: IN.info?.eventName ?? (RS ? 'test' : 'prerequest'), requestName: IN.info?.requestName ?? '' },
    sendRequest:()=>{ throw new Error('pm.sendRequest is not supported in this sandbox') } };
  globalThis.postman = {
    setEnvironmentVariable:envApi.set, getEnvironmentVariable:envApi.get, clearEnvironmentVariable:envApi.unset,
    setGlobalVariable:globApi.set, getGlobalVariable:globApi.get, clearGlobalVariable:globApi.unset,
    clearEnvironmentVariables:envApi.clear, clearGlobalVariables:globApi.clear,
  };
  globalThis.test = test; globalThis.expect = pm.expect; globalThis.response = respApi;
  globalThis.__result = () => JSON.stringify({
    variables:out.variables, environment:out.environment, collectionVariables:out.collectionVariables, globals:out.globals,
    request:R0,
    response: RS && changed.size ? { status:RS.status, statusText:RS.statusText, body:RS.body, headers:Object.entries(RS.headers).map(([key,value])=>({key,value})), changed:[...changed] } : null,
    logs, tests });
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
    globals: ctx.globals ?? {},
    request: ctx.request ?? null,
    response: null,
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
      if (needsCrypto(code)) run(loadCryptoJs());
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
