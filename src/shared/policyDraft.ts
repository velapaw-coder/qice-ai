export function adoptBlockedReason(status: string | null | undefined): string | null {
  if (status === "已采纳") return "这份草稿已经采纳过，不能再次采纳";
  if (status === "已驳回") return "这份草稿已经驳回，不能再采纳";
  if (status === "重复") return "这份草稿已标为重复，不能再采纳";
  return null;
}
