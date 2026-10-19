export const MODEL_SLOT_KEYS = ["llm_text_primary", "llm_text_fallback", "llm_vision_primary", "llm_vision_fallback"] as const;

export type ModelSlotKey = (typeof MODEL_SLOT_KEYS)[number];

/** 四个槽同时写成空值会清掉已保存的分配。只有明确确认时才允许。 */
export function emptyModelSlotRejection(
  incoming: Record<string, unknown>,
  existing: Record<string, string | null | undefined>,
  explicitClear: boolean,
): string | null {
  const touches = MODEL_SLOT_KEYS.some((key) => Object.prototype.hasOwnProperty.call(incoming, key));
  if (!touches) return null;
  const next = MODEL_SLOT_KEYS.map((key) => {
    if (Object.prototype.hasOwnProperty.call(incoming, key)) return String(incoming[key] ?? "").trim();
    return String(existing[key] ?? "").trim();
  });
  if (next.some((value) => value.length > 0)) return null;
  const hadAssignment = MODEL_SLOT_KEYS.some((key) => String(existing[key] ?? "").trim().length > 0);
  if (!hadAssignment || explicitClear) return null;
  return "不能一次清空全部模型分配。若确实要停用全部槽位，请明确确认清空。";
}
