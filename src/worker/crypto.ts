function decodeKey(b64: string): Uint8Array {
  const bin = atob(b64);
  if (bin.length !== 32) throw new Error("SETTINGS_ENC_KEY 必须是 32 字节的 base64");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function aesKey(b64: string): Promise<CryptoKey> {
  const raw = decodeKey(b64);
  const key = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  return crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(keyB64: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(keyB64), new TextEncoder().encode(plain)));
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv, 0);
  packed.set(ct, iv.length);
  let s = "";
  for (const b of packed) s += String.fromCharCode(b);
  return btoa(s);
}

export async function decryptSecret(keyB64: string, packedB64: string): Promise<string> {
  const bin = atob(packedB64);
  const raw = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await aesKey(keyB64), ct);
  return new TextDecoder().decode(plain);
}
