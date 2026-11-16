import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = path.dirname(fileURLToPath(import.meta.url));
const destRoot = path.resolve(srcRoot, "..", "console-srr - re");

const EXCLUDE_DIRS = new Set([
  ".cursor",
  ".superpowers",
  ".git",
  "dist",
  "dist-electron",
  "doc",
  "docs",
  "node_modules",
  "release",
  "python",
]);

const EXCLUDE_FILES = new Set(["migrate-txt.mjs"]);

const isTestFile = (name) => {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".test.ts") ||
    lower.endsWith(".spec.ts") ||
    lower.endsWith(".test.tsx") ||
    lower.endsWith(".spec.tsx")
  );
};

const rel = (filePath) => path.relative(srcRoot, filePath).replaceAll("\\", "/");

/** Windows 上覆盖只读文件会 EPERM。先去掉目标的只读再复制。 */
const copyOver = async (srcFile, destFile) => {
  try {
    await fs.copyFile(srcFile, destFile);
  } catch (error) {
    if (error?.code !== "EPERM" && error?.code !== "EACCES") throw error;
    await fs.chmod(destFile, 0o666);
    await fs.copyFile(srcFile, destFile);
    console.log(`已去掉只读后覆盖 ${rel(srcFile)}`);
  }
};

const walk = async (dir, visitFile) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      await walk(fullPath, visitFile);
      continue;
    }
    if (!entry.isFile()) continue;
    if (EXCLUDE_FILES.has(entry.name) || isTestFile(entry.name)) continue;
    await visitFile(fullPath);
  }
};

const migrate = async () => {
  if (path.resolve(srcRoot) === path.resolve(destRoot)) {
    throw new Error("源目录与目标目录相同，已中止");
  }

  await fs.access(destRoot).catch(() => {
    throw new Error(`目标目录不存在：${destRoot}`);
  });

  let copied = 0;

  await walk(srcRoot, async (srcFile) => {
    const destFile = path.join(destRoot, path.relative(srcRoot, srcFile));
    await fs.mkdir(path.dirname(destFile), { recursive: true });
    await copyOver(srcFile, destFile);
    copied += 1;
    if (copied % 500 === 0) console.log(`已覆盖 ${copied} 个文件…`);
  });

  console.log(`完成：${copied} 个文件已覆盖到 ${destRoot}`);
};

await migrate();
