import { dq, goq, cq, mlq, rustq, flatten, join, withoutCT } from "./util.js";

export function goHttp(m) {
  const b = m.body;
  const hs = b?.kind === "multipart" ? withoutCT(m) : m.headers;
  const { text } = flatten(m);
  const imports = ['"fmt"', b?.kind === "multipart" && '"bytes"', b && b.kind !== "multipart" && '"strings"', b?.kind === "multipart" && '"mime/multipart"', '"net/http"', '"io"'].filter(Boolean).sort();
  const fail = ["if err != nil {", "\tfmt.Println(err)", "\treturn", "}"];
  const body = [
    `url := ${dq(m.url)}`,
    `method := ${dq(m.method)}`,
    "",
    ...(!b ? [] : b.kind === "multipart"
      ? ["payload := &bytes.Buffer{}", "writer := multipart.NewWriter(payload)", ...b.fields.map(([k, v]) => `_ = writer.WriteField(${dq(k)}, ${dq(v)})`), "err := writer.Close()", ...fail, ""]
      : [`payload := strings.NewReader(${goq(text)})`, ""]),
    "client := &http.Client{}",
    `req, err := http.NewRequest(method, url, ${b ? "payload" : "nil"})`,
    ...fail,
    ...hs.map(([k, v]) => `req.Header.Add(${dq(k)}, ${dq(v)})`),
    ...(b?.kind === "multipart" ? ['req.Header.Set("Content-Type", writer.FormDataContentType())'] : []),
    "",
    "res, err := client.Do(req)",
    ...fail,
    "defer res.Body.Close()",
    "",
    "body, err := io.ReadAll(res.Body)",
    ...fail,
    "fmt.Println(string(body))",
  ];
  return join("package main", "", "import (", ...imports.map((i) => "\t" + i), ")", "", "func main() {", body.map((l) => (l ? "\t" + l : l)).join("\n"), "}");
}

export function rustReqwest(m) {
  const b = m.body;
  const hs = b?.kind === "multipart" ? withoutCT(m) : m.headers;
  const { text } = flatten(m);
  const body = ["let client = reqwest::Client::builder().build()?;", ""];
  if (hs.length) body.push("let mut headers = reqwest::header::HeaderMap::new();", ...hs.map(([k, v]) => `headers.insert(${dq(k)}, ${dq(v)}.parse()?);`), "");
  if (b?.kind === "multipart") body.push("let form = reqwest::multipart::Form::new()", ...b.fields.map(([k, v], i, a) => `    .text(${dq(k)}, ${dq(v)})${i === a.length - 1 ? ";" : ""}`), "");
  else if (b) body.push(`let data = ${rustq(text)};`, "");
  const req = [`let request = client.request(reqwest::Method::${m.method}, ${dq(m.url)})`];
  if (hs.length) req.push("    .headers(headers)");
  if (b?.kind === "multipart") req.push("    .multipart(form)");
  else if (b) req.push("    .body(data)");
  req[req.length - 1] += ";";
  body.push(...req, "", "let response = request.send().await?;", "let body = response.text().await?;", "", 'println!("{}", body);', "", "Ok(())");
  return join("#[tokio::main]", "async fn main() -> Result<(), Box<dyn std::error::Error>> {", body.map((l) => (l ? "    " + l : l)).join("\n"), "}");
}

export function cLibcurl(m) {
  const b = m.body;
  const hs = b?.kind === "multipart" ? withoutCT(m) : m.headers;
  const { text } = flatten(m);
  const I = "  ";
  return join(
    "#include <stdio.h>",
    "#include <curl/curl.h>",
    "",
    "int main(void) {",
    `${I}CURL *curl = curl_easy_init();`,
    `${I}if (curl) {`,
    `${I}${I}CURLcode res;`,
    `${I}${I}curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, ${cq(m.method)});`,
    `${I}${I}curl_easy_setopt(curl, CURLOPT_URL, ${cq(m.url)});`,
    `${I}${I}curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);`,
    `${I}${I}curl_easy_setopt(curl, CURLOPT_DEFAULT_PROTOCOL, "${m.scheme}");`,
    `${I}${I}struct curl_slist *headers = NULL;`,
    ...hs.map(([k, v]) => `${I}${I}headers = curl_slist_append(headers, ${cq(`${k}: ${v}`)});`),
    `${I}${I}curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);`,
    b?.kind === "multipart" && [`${I}${I}curl_mime *mime = curl_mime_init(curl);`, `${I}${I}curl_mimepart *part;`, ...b.fields.flatMap(([k, v]) => [`${I}${I}part = curl_mime_addpart(mime);`, `${I}${I}curl_mime_name(part, ${cq(k)});`, `${I}${I}curl_mime_data(part, ${cq(v)}, CURL_ZERO_TERMINATED);`]), `${I}${I}curl_easy_setopt(curl, CURLOPT_MIMEPOST, mime);`],
    b && b.kind !== "multipart" && `${I}${I}curl_easy_setopt(curl, CURLOPT_POSTFIELDS, ${cq(text)});`,
    `${I}${I}res = curl_easy_perform(curl);`,
    `${I}${I}if (res != CURLE_OK) fprintf(stderr, "curl_easy_perform() failed: %s\\n", curl_easy_strerror(res));`,
    b?.kind === "multipart" && `${I}${I}curl_mime_free(mime);`,
    `${I}${I}curl_slist_free_all(headers);`,
    `${I}}`,
    `${I}curl_easy_cleanup(curl);`,
    `${I}return 0;`,
    "}",
  );
}

export function ocamlCohttp(m) {
  const { headers, text } = flatten(m);
  return join(
    "open Lwt",
    "open Cohttp",
    "open Cohttp_lwt_unix",
    "",
    text != null && [`let postData = ref ${mlq(text)};;`, ""],
    "let reqBody =",
    `  let uri = Uri.of_string ${mlq(m.url)} in`,
    headers.length ? ["  let headers = Header.init ()", ...headers.map(([k, v]) => `    |> fun h -> Header.add h ${mlq(k)} ${mlq(v)}`), "  in"] : "  let headers = Header.init () in",
    text != null && "  let body = Cohttp_lwt.Body.of_string !postData in",
    `  Client.call ~headers${text != null ? " ~body" : ""} \`${m.method} uri >>= fun (_resp, body) ->`,
    "  body |> Cohttp_lwt.Body.to_string >|= fun body -> body",
    "",
    "let () =",
    "  let respBody = Lwt_main.run reqBody in",
    "  print_endline respBody",
  );
}
