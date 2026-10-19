export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function shouldRetryGet(method: string | undefined, status: number, attempt: number): boolean {
  const verb = (method || "GET").toUpperCase();
  return attempt === 0 && (verb === "GET" || verb === "HEAD") && status === 502;
}

export function parseApiPayload(text: string, status: number): Record<string, unknown> {
  if (!text) return {};
  try {
    const data = JSON.parse(text) as unknown;
    return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return { error: status >= 500 ? "服务暂时不可用，请稍后再试" : "请求失败" };
  }
}

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  headers.set("x-qice-request", "1");
  if (opts.body && !(opts.body instanceof FormData) && !(opts.body instanceof Blob) && typeof opts.body === "string") {
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  const once = async () => {
    const res = await fetch(path, { ...opts, headers, credentials: "include" });
    const data = parseApiPayload(await res.text(), res.status);
    if (!res.ok) throw new ApiError(typeof data.error === "string" ? data.error : "请求失败", res.status);
    return data as T;
  };
  try {
    return await once();
  } catch (err) {
    if (err instanceof ApiError && shouldRetryGet(opts.method, err.status, 0)) return once();
    throw err;
  }
}

export function putFile(id: string, blob: Blob, mime: string) {
  return fetch(`/api/files/${id}/content`, {
    method: "PUT",
    body: blob,
    credentials: "include",
    headers: { "content-type": mime || "application/octet-stream", "x-qice-request": "1" },
  }).then(async (res) => {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new ApiError(payload.error || "上传失败", res.status);
  });
}
