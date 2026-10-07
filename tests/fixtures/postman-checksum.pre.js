var timestamp = new Date();
var jsonBody = pm.request.body.raw;
var uid = JSON.parse(jsonBody)['uid'];
const params = JSON.parse(jsonBody)['params'];
const newObj = Object.fromEntries(
  Object.entries(params).map(([key, val]) => [key, val.replace('$timestamp', timestamp.toISOString())])
);

var sha1_val = CryptoJS.SHA1(JSON.stringify(newObj) + pm.variables.get('api_key'));
postman.setGlobalVariable("checksum", sha1_val);

pm.request.body.raw = {
  "checksum": "{{checksum}}",
  "params": newObj,
  "uid" : uid
};

