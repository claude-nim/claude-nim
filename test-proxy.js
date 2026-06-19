const { startProxyServer } = require("./out/server.js");
const fs = require("fs");
const crypto = require("crypto");
const os = require("os");

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

startProxyServer(3456, apiKey, "meta/llama-3.3-70b-instruct", () => console.log("Proxy running on 3456"));
