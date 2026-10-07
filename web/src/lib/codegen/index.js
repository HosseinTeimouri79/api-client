import { buildModel } from "./model.js";
import { curl, httpie, wget, postmanCli, rawHttp } from "./shell.js";
import { fetchJs, jquery, xhr, axios, nodeNative, nodeRequest, nodeUnirest } from "./web.js";
import { csharpHttpClient, csharpRestSharp, javaOkHttp, javaUnirest, kotlinOkHttp } from "./jvm.js";
import { dartDio, dartHttp, swiftUrlSession, objcNsUrlSession } from "./mobile.js";
import { pythonHttpClient, pythonRequests, rubyNetHttp, phpCurl, phpGuzzle, phpHttpRequest2, phpPeclHttp, rHttr, rRcurl, powershell } from "./scripting.js";
import { goHttp, rustReqwest, cLibcurl, ocamlCohttp } from "./systems.js";

export { buildModel };
// Order and naming follow the Code snippet picker. `group` is the language, `name` the library.
export const TARGETS = [
  { id: "csharp-httpclient", group: "C#", name: "HttpClient", gen: csharpHttpClient },
  { id: "csharp-restsharp", group: "C#", name: "RestSharp", gen: csharpRestSharp },
  { id: "curl", group: "cURL", name: "cURL", gen: curl },
  { id: "dart-dio", group: "Dart", name: "Dio", gen: dartDio },
  { id: "dart-http", group: "Dart", name: "HTTP", gen: dartHttp },
  { id: "go-native", group: "Go", name: "http package", gen: goHttp },
  { id: "http-raw", group: "HTTP", name: "Raw HTTP request", gen: rawHttp },
  { id: "java-okhttp", group: "Java", name: "OkHttp", gen: javaOkHttp },
  { id: "java-unirest", group: "Java", name: "Unirest", gen: javaUnirest },
  { id: "javascript-fetch", group: "JavaScript", name: "Fetch", gen: fetchJs },
  { id: "javascript-jquery", group: "JavaScript", name: "jQuery", gen: jquery },
  { id: "javascript-xhr", group: "JavaScript", name: "XHR", gen: xhr },
  { id: "kotlin-okhttp", group: "Kotlin", name: "OkHttp", gen: kotlinOkHttp },
  { id: "c-libcurl", group: "C", name: "LibCurl", gen: cLibcurl },
  { id: "nodejs-axios", group: "Node.js", name: "Axios", gen: axios },
  { id: "nodejs-native", group: "Node.js", name: "Native", gen: nodeNative },
  { id: "nodejs-request", group: "Node.js", name: "Request", gen: nodeRequest },
  { id: "nodejs-unirest", group: "Node.js", name: "Unirest", gen: nodeUnirest },
  { id: "objc-nsurlsession", group: "Objective-C", name: "NSURLSession", gen: objcNsUrlSession },
  { id: "ocaml-cohttp", group: "OCaml", name: "Cohttp", gen: ocamlCohttp },
  { id: "php-curl", group: "PHP", name: "cURL", gen: phpCurl },
  { id: "php-guzzle", group: "PHP", name: "Guzzle", gen: phpGuzzle },
  { id: "php-httprequest2", group: "PHP", name: "Http_Request2", gen: phpHttpRequest2 },
  { id: "php-pecl-http", group: "PHP", name: "pecl_http", gen: phpPeclHttp },
  { id: "postman-cli", group: "Postman CLI", name: "Postman CLI", gen: postmanCli },
  { id: "powershell-restmethod", group: "PowerShell", name: "RestMethod", gen: powershell },
  { id: "python-httpclient", group: "Python", name: "http.client", gen: pythonHttpClient },
  { id: "python-requests", group: "Python", name: "Requests", gen: pythonRequests },
  { id: "r-httr", group: "R", name: "httr", gen: rHttr },
  { id: "r-rcurl", group: "R", name: "RCurl", gen: rRcurl },
  { id: "ruby-net-http", group: "Ruby", name: "Net::HTTP", gen: rubyNetHttp },
  { id: "rust-reqwest", group: "Rust", name: "reqwest", gen: rustReqwest },
  { id: "shell-httpie", group: "Shell", name: "HTTPie", gen: httpie },
  { id: "shell-wget", group: "Shell", name: "wget", gen: wget },
  { id: "swift-urlsession", group: "Swift", name: "URLSession", gen: swiftUrlSession },
];
export const DEFAULT_TARGET = "curl";
export const targetById = (id) => TARGETS.find((t) => t.id === id) ?? TARGETS.find((t) => t.id === DEFAULT_TARGET);
/** Generates code for one target from an editor request. */
export const generate = (id, req, opts) => targetById(id).gen(buildModel(req, opts));
