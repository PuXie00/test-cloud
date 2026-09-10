/** `precision` 未传时：无小数 step → 整数；有小数 step 则按 step 推断。显式 precision 优先。 */
export const inferInputPrecision = (step: unknown): number => {
  const n = Number(step);
  if (!Number.isFinite(n)) return 0;
  const stepText = String(n);
  const dotIndex = stepText.indexOf(".");
  if (dotIndex === -1) return 0;
  return stepText.length - dotIndex - 1;
};

export const resolveInputPrecision = (
  precision: number | undefined,
  step: unknown,
): number => {
  if (precision != null && Number.isFinite(precision)) {
    return Math.max(0, Math.floor(precision));
  }
  return inferInputPrecision(step ?? 1);
};

/**
 * 按小数位数约束草稿。允许未完成前缀（"" / "-" / "1."）。
 * 超出位数则截断；非法字符返回 null（应忽略本次输入）。
 */
export const sanitizeNumericDraft = (text: string, precision: number): string | null => {
  if (text === "") return "";
  const prec = Math.max(0, Math.floor(precision));
  if (/[eE]/.test(text)) return null;

  if (prec === 0) {
    if (text === "-" || text === "+") return text;
    return /^[+-]?\d+$/.test(text) ? text : null;
  }

  if (text === "-" || text === "+" || text === "." || text === "-." || text === "+.") {
    return text;
  }

  const match = text.match(/^([+-]?)(\d*)(?:\.(\d*))?$/);
  if (!match) return null;
  const sign = match[1] ?? "";
  const intPart = match[2] ?? "";
  const frac = match[3];
  if (frac != null && frac.length > prec) {
    return `${sign}${intPart}.${frac.slice(0, prec)}`;
  }
  return text;
};

export const roundToInputPrecision = (value: number, precision: number): number => {
  const factor = 10 ** Math.max(0, Math.floor(precision));
  return Math.round(value * factor) / factor;
};
