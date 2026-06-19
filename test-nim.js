const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const https = require("https");

const KEY_FILE = os.homedir() + "/.claude-nim-key";
const ALGORITHM = "aes-256-gcm";
function getMachineKey() {
  const machineId = `${os.hostname()}-${os.platform()}-${os.arch()}-${os.userInfo().username}`;
  return crypto.scryptSync(machineId, "claude-nim-salt", 32);
}
const payload = fs.readFileSync(KEY_FILE, "utf8");
const { iv, data, tag } = JSON.parse(payload);
const decipher = crypto.createDecipheriv(ALGORITHM, getMachineKey(), Buffer.from(iv, "hex"));
decipher.setAuthTag(Buffer.from(tag, "hex"));
const apiKey = Buffer.concat([decipher.update(Buffer.from(data, "hex")), decipher.final()]).toString("utf8");

const body = JSON.stringify({
  model: 'meta/llama-3.3-70b-instruct',
  messages: [{ role: 'user', content: 'hello' }],
  tools: [{ type: 'function', function: { name: 'test', description: 'test', parameters: { type: 'object', properties: {} } } }]
});

const req = https.request('https://integrate.api.nvidia.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  }
}, (res) => {
  let chunks = '';
  res.on('data', d => chunks += d);
  res.on('end', () => console.log(res.statusCode, chunks.substring(0, 100)));
});
req.write(body);
req.end();
