export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  headers.set("x-qice-request", "1");
  if (opts.body && !(opts.body instanceof FormData) && !(opts.body instanceof Blob) && typeof opts.body === "string") {
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  const res = await fetch(path, { ...opts, headers, credentials: "include" });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(data.error || "请求失败", res.status);
  return data as T;
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
