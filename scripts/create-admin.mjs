/**
 * 创建或重置后台账号。密码在本机做 PBKDF2，Worker 只保存 HMAC。
 * 用法：node scripts/create-admin.mjs --phone 13800000000 --password 'Admin1234' --name 管理员 --role admin --force
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
function flag(name, fallback = "") {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1]) return fallback;
  return args[i + 1];
}

const phone = flag("--phone");
const password = flag("--password");
const name = flag("--name", "管理员");
const role = flag("--role", "admin");
const force = args.includes("--force");
const remote = args.includes("--remote");

if (!/^1\d{10}$/.test(phone)) {
  console.error("请用 --phone 传入 11 位、1 开头的手机号");
  process.exit(1);
}
if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
  console.error("密码至少 8 位，且同时包含字母和数字");
  process.exit(1);
}
if (role !== "admin" && role !== "consultant") {
  console.error("--role 只能是 admin 或 consultant");
  process.exit(1);
}

function pepperFromEnv() {
  if (process.env.PEPPER) return process.env.PEPPER;
  try {
    const text = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
    const line = text.split("\n").find((row) => row.startsWith("PEPPER="));
    if (line) return line.slice("PEPPER=".length).trim();
  } catch {
    /* 生产环境用 wrangler secret，脚本执行前请 export PEPPER */
  }
  return "";
}

const pepper = pepperFromEnv();
if (!pepper) {
  console.error("找不到 PEPPER。本地请准备 .dev.vars；远程请先 export PEPPER");
  process.exit(1);
}

const enc = new TextEncoder();
const material = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
const bits = await crypto.subtle.deriveBits(
  { name: "PBKDF2", salt: enc.encode(`qice-v1:${phone}`), iterations: 600_000, hash: "SHA-256" },
  material,
  256,
);
const clientKey = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
const salt = randomBytes(16).toString("hex");
const hmacKey = await crypto.subtle.importKey("raw", enc.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const sig = await crypto.subtle.sign("HMAC", hmacKey, enc.encode(clientKey + salt));
const hash = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
const id = crypto.randomUUID();
const now = new Date().toISOString();
const esc = (value) => value.replaceAll("'", "''");

const sql = `
${force ? `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE phone = '${phone}');
DELETE FROM users WHERE phone = '${phone}';` : ""}
INSERT INTO users (id, phone, password_hash, salt, role, name, status, must_change_password, failed_logins, created_at)
VALUES ('${id}', '${phone}', '${hash}', '${salt}', '${role}', '${esc(name)}', 'active', 0, 0, '${now}');
`;

const file = join(tmpdir(), `qice-admin-${id}.sql`);
writeFileSync(file, sql);
const wranglerArgs = ["wrangler", "d1", "execute", "qice-ai", remote ? "--remote" : "--local", "--file", file];
const result = spawnSync("npx", wranglerArgs, { stdio: "inherit", cwd: new URL("..", import.meta.url) });
unlinkSync(file);
if (result.status !== 0) process.exit(result.status || 1);
console.log(`已写入 ${role} 账号 ${phone}（${name}）。首次由管理员创建的顾问请改用后台「账号」页，临时密码需首次登录修改。`);
