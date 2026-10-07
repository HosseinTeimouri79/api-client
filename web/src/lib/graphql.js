// GraphQL requests travel as ordinary HTTP requests (the server does the same in src/protocols/graphql.js);
// this mirror feeds the code snippet generators.
export function gqlToHttp(req) {
  const d = req.protocol_data ?? {};
  let variables;
  try { const v = JSON.parse(d.variables || "null"); if (v && typeof v === "object" && !Array.isArray(v)) variables = v; } catch { /* snippets show what can be shown */ }
  if (d.httpMethod === "GET") {
    const params = [...(req.params ?? []), { key: "query", value: d.query ?? "", enabled: true }];
    if (variables) params.push({ key: "variables", value: JSON.stringify(variables), enabled: true });
    if (d.operationName) params.push({ key: "operationName", value: d.operationName, enabled: true });
    return { ...req, method: "GET", params, body: { mode: "none" } };
  }
  const body = { query: d.query ?? "", ...(variables && { variables }), ...(d.operationName && { operationName: d.operationName }) };
  return { ...req, method: "POST", body: { mode: "json", content: JSON.stringify(body, null, 2) } };
}
