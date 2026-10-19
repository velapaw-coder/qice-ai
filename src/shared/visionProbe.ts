const DIGITS: Record<string, string[]> = {
  "0": ["11111", "10001", "10001", "10001", "10001", "10001", "11111"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["11110", "00001", "00001", "11110", "10000", "10000", "11111"],
  "3": ["11110", "00001", "00001", "11110", "00001", "00001", "11110"],
  "4": ["10001", "10001", "10001", "11111", "00001", "00001", "00001"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["11111", "10000", "10000", "11111", "10001", "10001", "11111"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["11111", "10001", "10001", "11111", "10001", "10001", "11111"],
  "9": ["11111", "10001", "10001", "11111", "00001", "00001", "11111"],
};

const SCALE = 6;
const GAP = 4;
const PAD = 10;

export const VISION_PROBE_PROMPT = "图片中央印着一串数字。只回复这串数字，不要解释。";

export function makeVisionProbe(code?: string): { code: string; pngBase64: string; prompt: string } {
  const value = code && /^\d{6}$/.test(code) ? code : String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 900000));
  const width = PAD * 2 + value.length * 5 * SCALE + (value.length - 1) * GAP;
  const height = PAD * 2 + 7 * SCALE;
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const on = pixelOn(value, x, y);
      const i = row + 1 + x * 3;
      const v = on ? 20 : 255;
      raw[i] = v;
      raw[i + 1] = v;
      raw[i + 2] = v;
    }
  }
  return { code: value, pngBase64: bytesToBase64(encodePng(width, height, raw)), prompt: VISION_PROBE_PROMPT };
}

export function visionProbePassed(reply: string, code: string): boolean {
  return reply.includes(code);
}

export function visionProbeFailure(reply: string, code: string, status: number): string {
  const snippet = reply.replace(/\s+/g, " ").trim().slice(0, 80);
  return `回复里没有图中的数字 ${code}（HTTP ${status}${snippet ? `，模型回复：${snippet}` : ""}）。只返回 HTTP 200 不能说明模型能看图。`;
}

function pixelOn(code: string, x: number, y: number): boolean {
  const lx = x - PAD;
  const ly = y - PAD;
  if (lx < 0 || ly < 0) return false;
  const cell = 5 * SCALE + GAP;
  const index = Math.floor(lx / cell);
  if (index < 0 || index >= code.length) return false;
  const ox = lx - index * cell;
  const col = Math.floor(ox / SCALE);
  const row = Math.floor(ly / SCALE);
  if (col < 0 || col > 4 || row < 0 || row > 6) return false;
  return DIGITS[code[index]!]?.[row]?.[col] === "1";
}

function encodePng(width: number, height: number, raw: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [signature, chunk("IHDR", ihdr), chunk("IDAT", zlibStore(raw)), chunk("IEND", new Uint8Array())];
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)], 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function zlibStore(raw: Uint8Array): Uint8Array {
  const parts: number[] = [0x78, 0x01];
  let offset = 0;
  while (offset < raw.length) {
    const n = Math.min(65535, raw.length - offset);
    const last = offset + n >= raw.length;
    parts.push(last ? 1 : 0, n & 255, (n >> 8) & 255);
    const nlen = (~n) & 0xffff;
    parts.push(nlen & 255, (nlen >> 8) & 255);
    for (let i = 0; i < n; i++) parts.push(raw[offset + i]!);
    offset += n;
  }
  let a = 1;
  let b = 0;
  for (const byte of raw) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  parts.push((adler >>> 24) & 255, (adler >>> 16) & 255, (adler >>> 8) & 255, adler & 255);
  return Uint8Array.from(parts);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
