import { dq, jsq, flatten, join, indent } from "./util.js";

const hdrObj = (headers, pad = 2) => (headers.length ? "{\n" + headers.map(([k, v]) => " ".repeat(pad + 2) + `${dq(k)}: ${dq(v)}`).join(",\n") + "\n" + " ".repeat(pad) + "}" : "{}");
const append = (name, fields, pad = "") => fields.map(([k, v]) => `${pad}${name}.append(${dq(k)}, ${dq(v)});`);

export function fetchJs(m) {
  const b = m.body;
  const body = !b ? [] : b.kind === "raw" ? [`const raw = ${jsq(b.text)};`]
    : b.kind === "urlencoded" ? ["const urlencoded = new URLSearchParams();", ...append("urlencoded", b.fields)]
    : ["const formdata = new FormData();", ...append("formdata", b.fields)];
  const bodyVar = !b ? null : b.kind === "raw" ? "raw" : b.kind === "urlencoded" ? "urlencoded" : "formdata";
  return join(
    m.headers.length && ["const myHeaders = new Headers();", ...m.headers.map(([k, v]) => `myHeaders.append(${dq(k)}, ${dq(v)});`), ""],
    body.length && [...body, ""],
    "const requestOptions = {",
    [`  method: ${dq(m.method)}`, m.headers.length && "  headers: myHeaders", bodyVar && `  body: ${bodyVar}`, '  redirect: "follow"'].filter(Boolean).join(",\n"),
    "};",
    "",
    `fetch(${dq(m.url)}, requestOptions)`,
    "  .then((response) => response.text())",
    "  .then((result) => console.log(result))",
    "  .catch((error) => console.error(error));",
  );
}

export function jquery(m) {
  const b = m.body;
  const fl = b ? flatten(m) : null;
  const form = b?.kind === "multipart" ? ["var form = new FormData();", ...append("form", b.fields), ""] : [];
  const props = [`  "url": ${dq(m.url)}`, `  "method": ${dq(m.method)}`, '  "timeout": 0'];
  if (m.headers.length) props.push(`  "headers": ${hdrObj(m.headers)}`);
  if (b?.kind === "multipart") props.push('  "processData": false', '  "mimeType": "multipart/form-data"', '  "contentType": false', '  "data": form');
  else if (b) props.push(`  "data": ${jsq(fl.text)}`);
  return join(...form, "var settings = {", props.join(",\n"), "};", "", "$.ajax(settings).done(function (response) {", "  console.log(response);", "});");
}

export function xhr(m) {
  const b = m.body;
  const data = !b ? [] : b.kind === "multipart" ? ["var data = new FormData();", ...append("data", b.fields)] : [`var data = ${jsq(flatten(m).text)};`];
  return join(
    data.length && [...data, ""],
    "var xhr = new XMLHttpRequest();",
    "",
    'xhr.addEventListener("readystatechange", function () {',
    "  if (this.readyState === 4) {",
    "    console.log(this.responseText);",
    "  }",
    "});",
    "",
    `xhr.open(${dq(m.method)}, ${dq(m.url)});`,
    ...m.headers.map(([k, v]) => `xhr.setRequestHeader(${dq(k)}, ${dq(v)});`),
    "",
    `xhr.send(${b ? "data" : ""});`,
  );
}

export function axios(m) {
  const b = m.body;
  const pre = !b ? [] : b.kind === "raw" ? [`let data = ${jsq(b.text)};`]
    : b.kind === "urlencoded" ? ["let data = new URLSearchParams();", ...append("data", b.fields)]
    : ['const FormData = require("form-data");', "let data = new FormData();", ...append("data", b.fields)];
  const hdrs = m.headers.map(([k, v]) => `    ${dq(k)}: ${dq(v)}`);
  if (b?.kind === "multipart") hdrs.push("    ...data.getHeaders()");
  const cfg = [`  method: ${dq(m.method.toLowerCase())}`, "  maxBodyLength: Infinity", `  url: ${dq(m.url)}`, hdrs.length && `  headers: {\n${hdrs.join(",\n")}\n  }`, b && "  data: data"].filter(Boolean).join(",\n");
  return join(
    'const axios = require("axios");',
    ...pre,
    pre.length ? "" : null,
    "let config = {",
    cfg,
    "};",
    "",
    "axios.request(config)",
    "  .then((response) => {",
    "    console.log(JSON.stringify(response.data));",
    "  })",
    "  .catch((error) => {",
    "    console.log(error);",
    "  });",
  );
}

export function nodeNative(m) {
  const { headers, text } = flatten(m);
  const lib = m.scheme === "https" ? "https" : "http";
  const hs = headers.filter(([k]) => k.toLowerCase() !== "content-length").map(([k, v]) => `    ${dq(k)}: ${dq(v)}`);
  if (text != null) hs.push('    "Content-Length": Buffer.byteLength(postData)');
  return join(
    `const ${lib} = require(${dq(lib)});`,
    "",
    text != null && [`const postData = ${jsq(text)};`, ""],
    "const options = {",
    [`  method: ${dq(m.method)}`, `  hostname: ${dq(m.host)}`, m.port && `  port: ${m.port}`, `  path: ${dq(m.path)}`, hs.length && `  headers: {\n${hs.join(",\n")}\n  }`].filter(Boolean).join(",\n"),
    "};",
    "",
    `const req = ${lib}.request(options, (res) => {`,
    "  const chunks = [];",
    '  res.on("data", (chunk) => chunks.push(chunk));',
    '  res.on("end", () => console.log(Buffer.concat(chunks).toString()));',
    '  res.on("error", (error) => console.error(error));',
    "});",
    'req.on("error", (error) => console.error(error));',
    "",
    text != null && "req.write(postData);",
    "req.end();",
  );
}

export function nodeRequest(m) {
  const b = m.body;
  const props = [`  method: ${dq(m.method)}`, `  url: ${dq(m.url)}`];
  if (m.headers.length) props.push(`  headers: ${hdrObj(m.headers)}`);
  const obj = (fields) => "{\n" + fields.map(([k, v]) => `    ${dq(k)}: ${dq(v)}`).join(",\n") + "\n  }";
  if (b?.kind === "raw") props.push(`  body: ${jsq(b.text)}`);
  else if (b?.kind === "urlencoded") props.push(`  form: ${obj(b.fields)}`);
  else if (b?.kind === "multipart") props.push(`  formData: ${obj(b.fields)}`);
  return join(
    'const request = require("request");',
    "const options = {",
    props.join(",\n"),
    "};",
    "request(options, (error, response) => {",
    "  if (error) throw new Error(error);",
    "  console.log(response.body);",
    "});",
  );
}

export function nodeUnirest(m) {
  const b = m.body;
  const hs = m.headers.filter(([k]) => !(b?.kind === "multipart" && k.toLowerCase() === "content-type"));
  return join(
    'const unirest = require("unirest");',
    `const req = unirest(${dq(m.method)}, ${dq(m.url)})`,
    hs.length && `  .headers(${hdrObj(hs)})`,
    b?.kind === "raw" && `  .send(${jsq(b.text)})`,
    b?.kind === "urlencoded" && `  .send(${jsq(flatten(m).text)})`,
    b?.kind === "multipart" && b.fields.map(([k, v]) => `  .field(${dq(k)}, ${dq(v)})`).join("\n"),
    "  .end((res) => {",
    "    if (res.error) throw new Error(res.error);",
    "    console.log(res.raw_body);",
    "  });",
  );
}
