/** 序列名上限（字符数，按 Unicode 码点计） */
export const SEQUENCE_NAME_MAX_LENGTH = 8;

/** 新建序列的基础名；重名时追加「 (2)」「 (3)」…，与系统新建文件夹一致 */
export const NEW_SEQUENCE_BASE_NAME = "新动作";

const codePointLength = (value: string): number => [...value].length;

const clampName = (value: string): string => [...value].slice(0, SEQUENCE_NAME_MAX_LENGTH).join("");

export const normalizeSequenceName = (value: string): string => value.trim();

export const sequenceNameError = (
  raw: string,
  existingNames: readonly string[],
): string | null => {
  const name = normalizeSequenceName(raw);
  if (!name) return "请输入序列名";
  if (codePointLength(name) > SEQUENCE_NAME_MAX_LENGTH) return "序列名不能超过 8 个字符";
  const taken = new Set(existingNames.map(normalizeSequenceName));
  if (taken.has(name)) return "序列名已存在";
  return null;
};

/** 在已有名称之外取下一个「新动作」「新动作 (2)」…，结果不超过 8 个字符 */
export const nextNewSequenceName = (existingNames: readonly string[]): string => {
  const taken = new Set(existingNames.map(normalizeSequenceName));
  if (!taken.has(NEW_SEQUENCE_BASE_NAME)) return NEW_SEQUENCE_BASE_NAME;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${NEW_SEQUENCE_BASE_NAME} (${index})`;
    if (codePointLength(candidate) > SEQUENCE_NAME_MAX_LENGTH) break;
    if (!taken.has(candidate)) return candidate;
  }
  return clampName(NEW_SEQUENCE_BASE_NAME);
};
