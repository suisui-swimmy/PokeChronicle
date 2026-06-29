export function normalizeOcrText(rawText: string) {
  return rawText
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("")
    .replace(/[！]/g, "!")
    .replace(/[／/｜|]/g, "!")
    .replace(/!+/g, "!")
    .replace(/[？]/g, "?")
    .replace(/[。｡]/g, "。")
    .replace(/[、､]/g, "、")
    .replace(/[…]+/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

export function createOcrMatchText(rawText: string) {
  return normalizeOcrText(rawText)
    .replace(/[!！?？。、,.・･/／\\|｜…:：;；"'`´_＿\[\]（）(){}「」『』<>＜＞]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}
