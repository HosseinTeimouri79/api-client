import { dq, kq, flatten, join, ctOf, withoutCT } from "./util.js";

const CS_METHOD = { GET: "Get", POST: "Post", PUT: "Put", PATCH: "Patch", DELETE: "Delete", HEAD: "Head", OPTIONS: "Options" };

export function csharpHttpClient(m) {
  const b = m.body, ct = ctOf(m);
  const content = !b ? [] : b.kind === "raw" ? [`var content = new StringContent(${dq(b.text)}, null${ct ? `, ${dq(ct.split(";")[0].trim())}` : ""});`]
    : b.kind === "urlencoded" ? ["var collection = new List<KeyValuePair<string, string>>();", ...b.fields.map(([k, v]) => `collection.Add(new(${dq(k)}, ${dq(v)}));`), "var content = new FormUrlEncodedContent(collection);"]
    : ["var content = new MultipartFormDataContent();", ...b.fields.map(([k, v]) => `content.Add(new StringContent(${dq(v)}), ${dq(k)});`)];
  const hs = b ? withoutCT(m) : m.headers;
  return join(
    "var client = new HttpClient();",
    `var request = new HttpRequestMessage(HttpMethod.${CS_METHOD[m.method]}, ${dq(m.url)});`,
    ...hs.map(([k, v]) => `request.Headers.Add(${dq(k)}, ${dq(v)});`),
    ...content,
    b && "request.Content = content;",
    "var response = await client.SendAsync(request);",
    "response.EnsureSuccessStatusCode();",
    "Console.WriteLine(await response.Content.ReadAsStringAsync());",
  );
}

export function csharpRestSharp(m) {
  const b = m.body, ct = ctOf(m);
  const hs = b?.kind === "raw" ? withoutCT(m) : m.headers;
  return join(
    `var options = new RestClientOptions(${dq(m.url)})`,
    "{",
    "  MaxTimeout = -1,",
    "};",
    "var client = new RestClient(options);",
    `var request = new RestRequest("", Method.${CS_METHOD[m.method]});`,
    ...hs.map(([k, v]) => `request.AddHeader(${dq(k)}, ${dq(v)});`),
    b?.kind === "raw" && `request.AddStringBody(${dq(b.text)}, ${dq(ct ? ct.split(";")[0].trim() : "text/plain")});`,
    b?.kind === "multipart" && "request.AlwaysMultipartFormData = true;",
    b && b.kind !== "raw" && b.fields.map(([k, v]) => `request.AddParameter(${dq(k)}, ${dq(v)});`),
    "RestResponse response = await client.ExecuteAsync(request);",
    "Console.WriteLine(response.Content);",
  );
}

const needsBody = (method) => ["POST", "PUT", "PATCH"].includes(method);

export function javaOkHttp(m) {
  const b = m.body, ct = ctOf(m);
  const body = !b ? (needsBody(m.method) ? ["RequestBody body = RequestBody.create(new byte[0], null);"] : [])
    : b.kind === "raw" ? [`MediaType mediaType = MediaType.parse(${dq(ct ?? "text/plain")});`, `RequestBody body = RequestBody.create(${dq(b.text)}, mediaType);`]
    : b.kind === "urlencoded" ? ["RequestBody body = new FormBody.Builder()", ...b.fields.map(([k, v]) => `  .add(${dq(k)}, ${dq(v)})`), "  .build();"]
    : ["RequestBody body = new MultipartBody.Builder().setType(MultipartBody.FORM)", ...b.fields.map(([k, v]) => `  .addFormDataPart(${dq(k)}, ${dq(v)})`), "  .build();"];
  const hs = b ? withoutCT(m) : m.headers;
  return join(
    "OkHttpClient client = new OkHttpClient().newBuilder()",
    "  .build();",
    ...body,
    "Request request = new Request.Builder()",
    `  .url(${dq(m.url)})`,
    `  .method(${dq(m.method)}, ${b || needsBody(m.method) ? "body" : "null"})`,
    ...hs.map(([k, v]) => `  .addHeader(${dq(k)}, ${dq(v)})`),
    "  .build();",
    "Response response = client.newCall(request).execute();",
  );
}

export function javaUnirest(m) {
  const b = m.body;
  const hs = b?.kind === "multipart" ? withoutCT(m) : m.headers;
  return join(
    "Unirest.setTimeouts(0, 0);",
    `HttpResponse<String> response = Unirest.${m.method.toLowerCase()}(${dq(m.url)})`,
    ...hs.map(([k, v]) => `  .header(${dq(k)}, ${dq(v)})`),
    b?.kind === "multipart" && "  .multiPartContent()",
    b?.kind === "raw" && `  .body(${dq(b.text)})`,
    b && b.kind !== "raw" && b.fields.map(([k, v]) => `  .field(${dq(k)}, ${dq(v)})`),
    "  .asString();",
  );
}

export function kotlinOkHttp(m) {
  const b = m.body, ct = ctOf(m);
  const body = !b ? (needsBody(m.method) ? ['val body = "".toRequestBody(null)'] : [])
    : b.kind === "raw" ? [`val mediaType = ${kq(ct ?? "text/plain")}.toMediaType()`, `val body = ${kq(b.text)}.toRequestBody(mediaType)`]
    : b.kind === "urlencoded" ? ["val body = FormBody.Builder()", ...b.fields.map(([k, v]) => `  .add(${kq(k)}, ${kq(v)})`), "  .build()"]
    : ["val body = MultipartBody.Builder().setType(MultipartBody.FORM)", ...b.fields.map(([k, v]) => `  .addFormDataPart(${kq(k)}, ${kq(v)})`), "  .build()"];
  const hs = b ? withoutCT(m) : m.headers;
  return join(
    "val client = OkHttpClient()",
    ...body,
    "val request = Request.Builder()",
    `  .url(${kq(m.url)})`,
    `  .method(${kq(m.method)}, ${b || needsBody(m.method) ? "body" : "null"})`,
    ...hs.map(([k, v]) => `  .addHeader(${kq(k)}, ${kq(v)})`),
    "  .build()",
    "val response = client.newCall(request).execute()",
  );
}
