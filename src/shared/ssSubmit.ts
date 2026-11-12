export type UploadKind = "vat" | "social_security";

export function socialSecuritySubmitError(
  files: { kind: string; parse_status: string }[],
  manual: boolean,
): string | null {
  const social = files.filter((file) => file.kind === "social_security");
  if (manual) {
    return social.length ? null : "请先上传本单位社保人员清单。识别不了时，上传后可以交给顾问。";
  }
  const ready = social.some((file) => file.parse_status === "success" || file.parse_status === "partial");
  return ready ? null : "请先上传一份识别成功的本单位社保人员清单。识别失败可以重试，或点「交给顾问处理」。";
}

export function enterpriseUploadKindError(kind: string): string | null {
  if (kind === "social_security") return null;
  if (kind === "vat") return "企业账号不再接收新的增值税申报表，请上传本单位社保人员清单。";
  return "文件类型不正确";
}
