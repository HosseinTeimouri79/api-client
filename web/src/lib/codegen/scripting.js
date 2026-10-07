import { dq, sq, psq, pyq, flatten, join, withoutCT, indent } from "./util.js";

const pyDict = (pairs, pad = "") => "{\n" + pairs.map(([k, v]) => `${pad}  ${dq(k)}: ${dq(v)}`).join(",\n") + `\n${pad}}`;
const pyPairs = (fields) => (new Set(fields.map(([k]) => k)).size === fields.length ? pyDict(fields) : "[\n" + fields.map(([k, v]) => `  (${dq(k)}, ${dq(v)})`).join(",\n") + "\n]");

export function pythonHttpClient(m) {
  const { headers, text } = flatten(m);
  const conn = m.scheme === "https" ? "HTTPSConnection" : "HTTPConnection";
  return join(
    "import http.client",
    "",
    `conn = http.client.${conn}(${dq(m.host)}${m.port ? `, ${m.port}` : ""})`,
    `payload = ${text != null ? pyq(text) + ".encode(\"utf-8\")" : '""'}`,
    `headers = ${headers.length ? pyDict(headers) : "{}"}`,
    `conn.request(${dq(m.method)}, ${dq(m.path)}, payload, headers)`,
    "res = conn.getresponse()",
    "data = res.read()",
    'print(data.decode("utf-8"))',
  );
}

export function pythonRequests(m) {
  const b = m.body;
  const hs = b?.kind === "multipart" ? withoutCT(m) : m.headers;
  const multipart = b?.kind === "multipart";
  const payload = !b ? '""' : b.kind === "raw" ? pyq(b.text) + '.encode("utf-8")' : multipart ? null : pyPairs(b.fields); // str bodies would be sent as latin-1
  return join(
    "import requests",
    "",
    `url = ${dq(m.url)}`,
    "",
    payload && `payload = ${payload}`,
    multipart && ["files = [", ...b.fields.map(([k, v]) => `  (${dq(k)}, (None, ${dq(v)})),`), "]"],
    `headers = ${hs.length ? pyDict(hs) : "{}"}`,
    "",
    `response = requests.request(${dq(m.method)}, url, headers=headers, ${multipart ? "files=files" : "data=payload"})`,
    "",
    "print(response.text)",
  );
}

const RB = { GET: "Get", POST: "Post", PUT: "Put", PATCH: "Patch", DELETE: "Delete", HEAD: "Head", OPTIONS: "Options" };
export function rubyNetHttp(m) {
  const b = m.body;
  const hs = b && b.kind !== "raw" ? withoutCT(m) : m.headers;
  const pairs = b && b.kind !== "raw" ? "[" + b.fields.map(([k, v]) => `[${sq(k)}, ${sq(v)}]`).join(", ") + "]" : null;
  return join(
    'require "uri"',
    'require "net/http"',
    "",
    `url = URI(${sq(m.url)})`,
    "",
    "http = Net::HTTP.new(url.host, url.port)",
    m.scheme === "https" && "http.use_ssl = true",
    `request = Net::HTTP::${RB[m.method]}.new(url)`,
    ...hs.map(([k, v]) => `request[${sq(k)}] = ${sq(v)}`),
    b?.kind === "raw" && `request.body = ${sq(b.text)}`,
    pairs && [`form_data = ${pairs}`, `request.set_form form_data, ${sq(b.kind === "multipart" ? "multipart/form-data" : "application/x-www-form-urlencoded")}`],
    "response = http.request(request)",
    "puts response.read_body",
  );
}

const phpArr = (pairs, pad = "  ") => "array(\n" + pairs.map(([k, v]) => `${pad}  ${sq(k)} => ${sq(v)}`).join(",\n") + `\n${pad})`;
export function phpCurl(m) {
  const b = m.body;
  const hs = b?.kind === "multipart" ? withoutCT(m) : m.headers;
  const fields = !b ? null : b.kind === "raw" ? sq(b.text) : b.kind === "multipart" ? phpArr(b.fields) : sq(flatten(m).text);
  return join(
    "<?php",
    "",
    "$curl = curl_init();",
    "",
    "curl_setopt_array($curl, array(",
    [`  CURLOPT_URL => ${sq(m.url)}`, "  CURLOPT_RETURNTRANSFER => true", "  CURLOPT_ENCODING => ''", "  CURLOPT_MAXREDIRS => 10", "  CURLOPT_TIMEOUT => 0", "  CURLOPT_FOLLOWLOCATION => true", "  CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1",
      `  CURLOPT_CUSTOMREQUEST => ${sq(m.method)}`, fields && `  CURLOPT_POSTFIELDS => ${fields}`,
      hs.length && `  CURLOPT_HTTPHEADER => array(\n${hs.map(([k, v]) => `    ${sq(`${k}: ${v}`)}`).join(",\n")}\n  )`].filter(Boolean).join(",\n"),
    "));",
    "",
    "$response = curl_exec($curl);",
    "",
    "curl_close($curl);",
    "echo $response;",
  );
}

export function phpGuzzle(m) {
  const b = m.body;
  const hs = b && b.kind !== "raw" ? withoutCT(m) : m.headers;
  const opts = b?.kind === "multipart" ? ["$options = [", "  'multipart' => [", ...b.fields.map(([k, v], i, a) => `    [ 'name' => ${sq(k)}, 'contents' => ${sq(v)} ]${i < a.length - 1 ? "," : ""}`), "  ]", "];"]
    : b?.kind === "urlencoded" ? ["$options = [", "  'form_params' => [", ...b.fields.map(([k, v], i, a) => `    ${sq(k)} => ${sq(v)}${i < a.length - 1 ? "," : ""}`), "  ]", "];"] : [];
  return join(
    "<?php",
    "",
    "use GuzzleHttp\\Client;",
    "use GuzzleHttp\\Psr7\\Request;",
    "",
    "$client = new Client();",
    hs.length ? ["$headers = [", hs.map(([k, v]) => `  ${sq(k)} => ${sq(v)}`).join(",\n"), "];"] : "$headers = [];",
    b?.kind === "raw" && `$body = ${sq(b.text)};`,
    ...opts,
    `$request = new Request(${sq(m.method)}, ${sq(m.url)}, $headers${b?.kind === "raw" ? ", $body" : ""});`,
    `$res = $client->sendAsync($request${opts.length ? ", $options" : ""})->wait();`,
    "echo $res->getBody();",
  );
}

export function phpHttpRequest2(m) {
  const b = m.body;
  const hs = b && b.kind !== "raw" ? withoutCT(m) : m.headers;
  return join(
    "<?php",
    "require_once 'HTTP/Request2.php';",
    "$request = new HTTP_Request2();",
    `$request->setUrl(${sq(m.url)});`,
    `$request->setMethod(HTTP_Request2::METHOD_${m.method});`,
    "$request->setConfig(array(",
    "  'follow_redirects' => TRUE",
    "));",
    hs.length && `$request->setHeader(${phpArr(hs, "")});`,
    b?.kind === "raw" && `$request->setBody(${sq(b.text)});`,
    b && b.kind !== "raw" && `$request->addPostParameter(${phpArr(b.fields, "")});`,
    "try {",
    "  $response = $request->send();",
    "  if ($response->getStatus() == 200) {",
    "    echo $response->getBody();",
    "  } else {",
    "    echo 'Unexpected HTTP status: ' . $response->getStatus() . ' ' . $response->getReasonPhrase();",
    "  }",
    "} catch (HTTP_Request2_Exception $e) {",
    "  echo 'Error: ' . $e->getMessage();",
    "}",
  );
}

export function phpPeclHttp(m) {
  const b = m.body;
  const hs = b && b.kind !== "raw" ? withoutCT(m) : m.headers;
  return join(
    "<?php",
    "$client = new http\\Client;",
    "$request = new http\\Client\\Request;",
    `$request->setRequestUrl(${sq(m.url)});`,
    `$request->setRequestMethod(${sq(m.method)});`,
    b && "$body = new http\\Message\\Body;",
    b?.kind === "raw" && `$body->append(${sq(b.text)});`,
    b && b.kind !== "raw" && `$body->addForm(${phpArr(b.fields, "")}, NULL);`,
    b && "$request->setBody($body);",
    "$request->setOptions(array());",
    hs.length && `$request->setHeaders(${phpArr(hs, "")});`,
    "$client->enqueue($request)->send();",
    "$response = $client->getResponse();",
    "echo $response->getBody();",
  );
}

export function rHttr(m) {
  const b = m.body;
  const hs = b?.kind === "multipart" ? withoutCT(m) : m.headers;
  const body = !b ? null : b.kind === "raw" ? sq(b.text) : "list(\n" + b.fields.map(([k, v]) => `  ${sq(k)} = ${sq(v)}`).join(",\n") + "\n)";
  const enc = b?.kind === "multipart" ? ', encode = "multipart"' : b?.kind === "urlencoded" ? ', encode = "form"' : b ? ', encode = "raw"' : "";
  return join(
    "library(httr)",
    "",
    hs.length && ["headers = c(", hs.map(([k, v]) => `  ${sq(k)} = ${sq(v)}`).join(",\n"), ")", ""],
    body && [`body = ${body}`, ""],
    `res <- VERB(${dq(m.method)}, url = ${dq(m.url)}${body ? ", body = body" : ""}${hs.length ? ", add_headers(headers)" : ""}${enc})`,
    "",
    "cat(content(res, 'text'))",
  );
}

export function rRcurl(m) {
  const b = m.body;
  const hs = b?.kind === "multipart" ? withoutCT(m) : m.headers;
  const hdr = hs.length ? `c(${hs.map(([k, v]) => `${sq(k)} = ${sq(v)}`).join(", ")})` : null;
  if (b?.kind === "multipart")
    return join("library(RCurl)", "", hdr && [`headers = ${hdr}`, ""], `res <- postForm(${dq(m.url)}, ${b.fields.map(([k, v]) => `${sq(k)} = ${sq(v)}`).join(", ")}, .opts = list(${hdr ? "httpheader = headers, " : ""}followlocation = TRUE), style = "httppost")`, "", "cat(res)");
  const { text } = flatten(m);
  return join(
    "library(RCurl)",
    "",
    hdr && [`headers = ${hdr}`, ""],
    text != null && [`params = ${sq(text)}`, ""],
    `res <- getURL(${dq(m.url)}, customrequest = ${dq(m.method)}${text != null ? ", postfields = params" : ""}${hdr ? ", httpheader = headers" : ""}, followlocation = TRUE)`,
    "",
    "cat(res)",
  );
}

export function powershell(m) {
  const b = m.body;
  const hs = b?.kind === "multipart" ? withoutCT(m) : m.headers;
  let body = [];
  if (b?.kind === "raw") body = b.text.includes("\n") && !/^"@|\r/m.test(b.text) ? ['$body = @"', b.text, '"@'] : [`$body = ${psq(b.text)}`];
  else if (b?.kind === "urlencoded") body = [`$body = ${psq(flatten(m).text)}`];
  else if (b?.kind === "multipart")
    body = ["$multipartContent = [System.Net.Http.MultipartFormDataContent]::new()", ...b.fields.flatMap(([k, v], i) => [`$stringContent${i} = [System.Net.Http.StringContent]::new(${psq(v)})`, `$multipartContent.Add($stringContent${i}, ${psq(k)})`]), "$body = $multipartContent"];
  return join(
    hs.length && ['$headers = New-Object "System.Collections.Generic.Dictionary[[String],[String]]"', ...hs.map(([k, v]) => `$headers.Add(${psq(k)}, ${psq(v)})`), ""],
    body.length && [...body, ""],
    `$response = Invoke-RestMethod ${psq(m.url)} -Method ${psq(m.method)}${hs.length ? " -Headers $headers" : ""}${b ? " -Body $body" : ""}`,
    "$response | ConvertTo-Json",
  );
}
