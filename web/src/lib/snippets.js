// Completions + ready-made snippets for the script editors. Descriptions and titles are i18n keys.
import { t } from "../i18n/index.js";
export const PM_COMPLETIONS = [
  ["pm.request.url", "pm.urlRead"],
  ["pm.request.method", "pm.methodRead"],
  ["pm.request.headers.add(", "pm.headerAdd"],
  ["pm.request.headers.upsert(", "pm.headerUpsert"],
  ["pm.request.headers.remove(", "pm.headerRemove"],
  ["pm.request.headers.get(", "pm.headerGet"],
  ["pm.request.params.add(", "pm.paramAdd"],
  ["pm.request.params.upsert(", "pm.paramUpsert"],
  ["pm.request.params.remove(", "pm.paramRemove"],
  ["pm.request.body.raw", "pm.bodyRaw"],
  ["pm.request.body.mode", "'raw' | 'urlencoded' | 'formdata' | 'none'"],
  ["pm.request.body.urlencoded.add(", "pm.formAdd"],
  ["pm.request.body.formdata.add(", "pm.multipartAdd"],
  ["pm.request.body.update(", "(string | {mode, raw, urlencoded, formdata})"],
  ["pm.variables.get(", "pm.varGet"],
  ["pm.variables.set(", "pm.varSet"],
  ["pm.variables.replaceIn(", "pm.varReplace"],
  ["pm.environment.get(", "pm.envGet"],
  ["pm.environment.set(", "pm.persistSet"],
  ["pm.environment.unset(", "(key)"],
  ["pm.globals.get(", "pm.globalGet"],
  ["pm.globals.set(", "pm.persistSet"],
  ["pm.collectionVariables.get(", "(key)"],
  ["pm.collectionVariables.set(", "(key, value)"],
  ["pm.response.json()", "pm.respJson"],
  ["pm.response.text()", "pm.respText"],
  ["pm.response.code", "pm.respCode"],
  ["pm.response.headers.get(", "pm.respHeaderGet"],
  ["pm.response.setBody(", "pm.respSetBody"],
  ["pm.response.setStatus(", "pm.respSetStatus"],
  ["pm.response.setHeader(", "pm.respSetHeader"],
  ["pm.response.removeHeader(", "(key)"],
  ["pm.response.to.have.status(", "pm.assertStatus"],
  ["pm.response.to.be.ok", "pm.assertOk"],
  ["pm.test(", "pm.testDef"],
  ["pm.expect(", "pm.expectDef"],
  ["postman.setGlobalVariable(", "pm.compat"],
  ["postman.setEnvironmentVariable(", "pm.compat"],
  ["CryptoJS.SHA1(", "pm.hash"],
  ["CryptoJS.SHA256(", ""],
  ["CryptoJS.MD5(", ""],
  ["CryptoJS.HmacSHA256(", "(message, key)"],
  ["CryptoJS.enc.Base64", "pm.encoder"],
  ["console.log(", "pm.consoleLog"],
  ["btoa(", ""],
  ["atob(", ""],
].map(([value, desc]) => ({ value, label: value, get description() { return desc ? t(desc) : ""; } })); // desc is an i18n key; resolved when shown

export const SNIPPETS = {
  pre: [
    {
      title: "snip.pre.header", // i18n key
      code: `pm.request.headers.upsert("X-Trace", Date.now());\n`,
    },
    {
      title: "snip.pre.param", // i18n key
      code: `pm.request.params.upsert("ts", new Date().toISOString());\n`,
    },
    {
      title: "snip.pre.body", // i18n key
      code: `const body = JSON.parse(pm.request.body.raw);\nbody.sentAt = new Date().toISOString();\npm.request.body.raw = body; // objects are stringified for you\n`,
    },
    {
      title: "snip.pre.sha1", // i18n key
      code: `const body = JSON.parse(pm.request.body.raw);\nconst checksum = CryptoJS.SHA1(JSON.stringify(body.params) + pm.variables.get("api_key"));\npostman.setGlobalVariable("checksum", checksum);\nbody.checksum = "{{checksum}}";\npm.request.body.raw = body;\n`,
    },
    {
      title: "snip.pre.hmac", // i18n key
      code: `const sig = CryptoJS.HmacSHA256(pm.request.body.raw, pm.variables.get("secret"));\npm.request.headers.upsert("X-Signature", sig.toString(CryptoJS.enc.Hex));\n`,
    },
    {
      title: "snip.pre.urlMethod", // i18n key
      code: `pm.request.url = pm.request.url + "/v2";\npm.request.method = "POST";\n`,
    },
  ],
  post: [
    {
      title: "snip.post.status", // i18n key
      code: `pm.test("Status is 200", () => pm.response.to.have.status(200));\n`,
    },
    {
      title: "snip.post.token", // i18n key
      code: `const data = pm.response.json();\nif (data.token) pm.environment.set("token", data.token);\n`,
    },
    {
      title: "snip.post.reshape", // i18n key
      code: `const data = pm.response.json();\npm.response.setBody({ count: data.items?.length ?? 0, items: data.items });\n`,
    },
    {
      title: "snip.post.statusHeader", // i18n key
      code: `pm.response.setStatus(200, "OK (normalised)");\npm.response.setHeader("X-Processed", "true");\n`,
    },
    {
      title: "snip.post.log", // i18n key
      code: `console.log("took", pm.response.responseTime, "ms");\n`,
    },
  ],
};
