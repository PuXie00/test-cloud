import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_NAME = path.basename(SCRIPT_PATH);

const EXCLUDE_DIRS = new Set([
  "release",
  "dist",
  "dist-electron",
  ".git",
  "node_modules"
]);

const CODE_EXTS = new Set([".js", ".ts", ".tsx",".html",".css"]);
const CODE_TXT_RE = /\.(js|ts|tsx|html|css)\.txt$/i;

const srcRoot = process.cwd();
const destRoot = path.join(path.dirname(srcRoot), `${path.basename(srcRoot)}-txt`);

const isExcludedDir = (name) => EXCLUDE_DIRS.has(name) || name === path.basename(destRoot);

const isCodeFile = (name) => CODE_EXTS.has(path.extname(name).toLowerCase());

const rel = (from, filePath) => path.relative(from, filePath).replaceAll("\\", "/");

const walk = async (dir, visitFile) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isExcludedDir(entry.name)) continue;
      if (path.resolve(fullPath) === path.resolve(destRoot)) continue;
      await walk(fullPath, visitFile);
      continue;
    }
    if (entry.isFile()) {
      await visitFile(fullPath, entry.name);
    }
  }
};

const migrate = async () => {
  if (path.resolve(srcRoot) === path.resolve(destRoot)) {
    throw new Error("源目录与目标目录相同，已中止");
  }

  await fs.mkdir(destRoot, { recursive: true });

  let copied = 0;
  let coded = 0;

  await walk(srcRoot, async (srcFile, name) => {
    const relative = path.relative(srcRoot, srcFile);
    const destFile = isCodeFile(name)
      ? path.join(destRoot, `${relative}.txt`)
      : path.join(destRoot, relative);

    await fs.mkdir(path.dirname(destFile), { recursive: true });
    await fs.copyFile(srcFile, destFile);
    copied += 1;
    if (isCodeFile(name)) coded += 1;
    if (copied % 500 === 0) {
      console.log(`已复制 ${copied} 个文件…`);
    }
  });

  console.log(`完成：${copied} 个文件 → ${destRoot}`);
  console.log(`其中 ${coded} 个 js/ts/tsx 已写为 原文件名.原后缀.txt`);
};

const restore = async () => {
  let renamed = 0;
  let skipped = 0;

  await walk(srcRoot, async (srcFile, name) => {
    if (!CODE_TXT_RE.test(name)) return;

    const destFile = srcFile.slice(0, -4);
    try {
      await fs.rm(destFile, { force: true });
      await fs.rename(srcFile, destFile);
      renamed += 1;
    } catch (error) {
      skipped += 1;
      console.error(`跳过 ${rel(srcRoot, srcFile)}：${error.message}`);
    }
  });

  console.log(`完成：已去掉 .txt 后缀 ${renamed} 个文件`);
  if (skipped > 0) console.log(`失败 ${skipped} 个`);
};

const command = process.argv[2] ?? "migrate";

if (command === "re") {
  await restore();
} else if (command === "migrate") {
  await migrate();
} else {
  console.log(`用法：
  node ./${SCRIPT_NAME}       复制到同级 ${path.basename(destRoot)}/，js/ts/tsx 写成 *.ext.txt
  node ./${SCRIPT_NAME} re    将当前目录下 *.js.txt / *.ts.txt / *.tsx.txt 去掉 .txt`);
  process.exit(1);
}
