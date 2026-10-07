import { dartq, swq, cq, flatten, join, withoutCT } from "./util.js";

const map = (fields, pad = "    ") => "{\n" + fields.map(([k, v]) => `${pad}${dartq(k)}: ${dartq(v)}`).join(",\n") + "\n" + pad.slice(2) + "}";

export function dartHttp(m) {
  const b = m.body;
  const hs = b?.kind === "multipart" ? withoutCT(m) : m.headers;
  const req = b?.kind === "multipart" ? `http.MultipartRequest(${dartq(m.method)}, Uri.parse(${dartq(m.url)}))` : `http.Request(${dartq(m.method)}, Uri.parse(${dartq(m.url)}))`;
  return join(
    "import 'package:http/http.dart' as http;",
    "",
    "void main() async {",
    hs.length && `  var headers = ${map(hs, "    ")};`,
    `  var request = ${req};`,
    b?.kind === "raw" && `  request.body = ${dartq(b.text)};`,
    b?.kind === "urlencoded" && `  request.bodyFields = ${map(b.fields, "    ")};`,
    b?.kind === "multipart" && `  request.fields.addAll(${map(b.fields, "    ")});`,
    hs.length && "  request.headers.addAll(headers);",
    "",
    "  http.StreamedResponse response = await request.send();",
    "",
    "  if (response.statusCode == 200) {",
    "    print(await response.stream.bytesToString());",
    "  } else {",
    "    print(response.reasonPhrase);",
    "  }",
    "}",
  );
}

export function dartDio(m) {
  const b = m.body;
  const hs = b?.kind === "multipart" ? withoutCT(m) : m.headers;
  const { text } = flatten(m);
  const data = !b ? null : b.kind === "multipart" ? `FormData.fromMap(${map(b.fields, "    ")})` : dartq(text);
  return join(
    "import 'dart:convert';",
    "import 'package:dio/dio.dart';",
    "",
    "void main() async {",
    hs.length && `  var headers = ${map(hs, "    ")};`,
    data && `  var data = ${data};`,
    "  var dio = Dio();",
    "  var response = await dio.request(",
    `    ${dartq(m.url)},`,
    "    options: Options(",
    `      method: ${dartq(m.method)},`,
    hs.length && "      headers: headers,",
    "    ),",
    data && "    data: data,",
    "  );",
    "",
    "  if (response.statusCode == 200) {",
    "    print(json.encode(response.data));",
    "  } else {",
    "    print(response.statusMessage);",
    "  }",
    "}",
  );
}

export function swiftUrlSession(m) {
  const { headers, text } = flatten(m);
  return join(
    "import Foundation",
    "#if canImport(FoundationNetworking)",
    "import FoundationNetworking",
    "#endif",
    "",
    "var semaphore = DispatchSemaphore(value: 0)",
    "",
    text != null && [`let parameters = ${swq(text)}`, "let postData = parameters.data(using: .utf8)", ""],
    `var request = URLRequest(url: URL(string: ${swq(m.url)})!, timeoutInterval: Double.infinity)`,
    ...headers.map(([k, v]) => `request.addValue(${swq(v)}, forHTTPHeaderField: ${swq(k)})`),
    "",
    `request.httpMethod = ${swq(m.method)}`,
    text != null && "request.httpBody = postData",
    "",
    "let task = URLSession.shared.dataTask(with: request) { data, response, error in",
    "  guard let data = data else {",
    "    print(String(describing: error))",
    "    semaphore.signal()",
    "    return",
    "  }",
    "  print(String(data: data, encoding: .utf8)!)",
    "  semaphore.signal()",
    "}",
    "",
    "task.resume()",
    "semaphore.wait()",
  );
}

export function objcNsUrlSession(m) {
  const { headers, text } = flatten(m);
  return join(
    "#import <Foundation/Foundation.h>",
    "",
    "dispatch_semaphore_t sema = dispatch_semaphore_create(0);",
    "",
    `NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:@${cq(m.url)}]`,
    "  cachePolicy:NSURLRequestUseProtocolCachePolicy",
    "  timeoutInterval:10.0];",
    headers.length && ["NSDictionary *headers = @{", headers.map(([k, v]) => `  @${cq(k)}: @${cq(v)}`).join(",\n"), "};", "", "[request setAllHTTPHeaderFields:headers];"],
    text != null && [`NSData *postData = [[NSData alloc] initWithData:[@${cq(text)} dataUsingEncoding:NSUTF8StringEncoding]];`, "[request setHTTPBody:postData];"],
    "",
    `[request setHTTPMethod:@${cq(m.method)}];`,
    "",
    "NSURLSession *session = [NSURLSession sharedSession];",
    "NSURLSessionDataTask *dataTask = [session dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {",
    "  if (error) {",
    '    NSLog(@"%@", error);',
    "  } else {",
    "    NSString *body = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];",
    '    NSLog(@"%@", body);',
    "  }",
    "  dispatch_semaphore_signal(sema);",
    "}];",
    "[dataTask resume];",
    "dispatch_semaphore_wait(sema, DISPATCH_TIME_FOREVER);",
  );
}
