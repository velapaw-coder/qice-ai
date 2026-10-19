/** 浏览器侧慢哈希。Worker 只做 HMAC，避免免费版 10ms CPU 被 PBKDF2 打满。 */
export const PBKDF2_ITERATIONS = 600_000;
export const PASSWORD_SALT_PREFIX = "qice-v1:";

export function bufToHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export async function deriveClientKey(phone: string, password: string): Promise<string> {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(PASSWORD_SALT_PREFIX + phone), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    256,
  );
  return bufToHex(bits);
}

export async function serverPasswordHash(pepper: string, clientKey: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(clientKey + salt));
  return bufToHex(sig);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return bufToHex(digest);
}

export function passwordError(password: string): string | null {
  if (password.length < 8) return "密码至少 8 位";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "密码需要同时包含字母和数字";
  return null;
}

export function phoneError(phone: string): string | null {
  if (!/^1\d{10}$/.test(phone)) return "请填写 11 位、1 开头的手机号";
  return null;
}
