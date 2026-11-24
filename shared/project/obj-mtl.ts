/** Babylon 的 MTL 解析读取的贴图项（关键字小写）；bump 是 map_bump 的别名，Babylon 不认，导入时改成 map_bump */
const MTL_TEXTURE_KEYS = new Set(["map_ka", "map_kd", "map_ks", "map_bump", "bump", "map_d"]);

/** 贴图项选项的参数个数上限；-mm -o -s -t 后面跟的数字个数不定 */
const TEXTURE_OPTION_ARGS: Record<string, number> = {
  blendu: 1,
  blendv: 1,
  cc: 1,
  clamp: 1,
  bm: 1,
  boost: 1,
  texres: 1,
  imfchan: 1,
  type: 1,
  mm: 2,
  o: 3,
  s: 3,
  t: 3,
};

export type MtlLine = { key: string; value: string };

export type MtlTextureRef = { file: string; bumpMultiplier: string | null };

const isNumericToken = (token: string): boolean => /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(token);

export const isMtlTextureKey = (key: string): boolean => MTL_TEXTURE_KEYS.has(key);

/** 第一段空白前是关键字（转小写），其余是值；空行、注释返回 null */
export const parseMtlLine = (line: string): MtlLine | null => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const pos = trimmed.search(/\s/);
  if (pos < 0) return { key: trimmed.toLowerCase(), value: "" };
  return { key: trimmed.slice(0, pos).toLowerCase(), value: trimmed.slice(pos + 1).trim() };
};

/** 贴图项的值：去掉 -s 1 1 1 这类选项，剩下的是文件名（可带路径、空格）；-bm 是凹凸强度 */
export const parseMtlTextureValue = (value: string): MtlTextureRef => {
  const tokens = value.split(/\s+/).filter(Boolean);
  let bumpMultiplier: string | null = null;
  let i = 0;
  while (i < tokens.length - 1 && tokens[i].startsWith("-")) {
    const option = tokens[i].slice(1).toLowerCase();
    const maxArgs = TEXTURE_OPTION_ARGS[option];
    if (maxArgs === undefined) break;
    i += 1;
    for (let taken = 0; taken < maxArgs && i < tokens.length - 1; taken += 1) {
      if (maxArgs > 1 && !isNumericToken(tokens[i])) break;
      if (option === "bm") bumpMultiplier = tokens[i];
      i += 1;
    }
  }
  return { file: tokens.slice(i).join(" "), bumpMultiplier };
};

/** 规整后的贴图项：「关键字 [-bm 强度] 文件名」，文件名不含空白 */
export const formatMtlTextureLine = (key: string, file: string, bumpMultiplier: string | null): string => {
  const outKey = key === "bump" ? "map_bump" : key;
  const isBump = outKey === "map_bump";
  return bumpMultiplier !== null && isBump ? `${outKey} -bm ${bumpMultiplier} ${file}` : `${outKey} ${file}`;
};

/** 改写规整后的 MTL 里各贴图项的文件名 */
export const mapMtlTextureFiles = (text: string, map: (file: string) => string): string =>
  text
    .split("\n")
    .map((line) => {
      const parsed = parseMtlLine(line);
      if (!parsed || !isMtlTextureKey(parsed.key)) return line;
      return line.replace(/\S+(?=\s*$)/, (file) => map(file));
    })
    .join("\n");
