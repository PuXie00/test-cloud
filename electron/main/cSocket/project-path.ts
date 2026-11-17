/**
 * C++ CONFIG|Pro|open 只认相对路径 Project/<工程名>，不发本机绝对路径。
 * Windows 一直是 .\Project\<工程名>；Linux 版 C++ 收 ./Project/<工程名>（反斜杠在 Linux 上是文件名里的普通字符）。
 * 传进来的可以是工程目录的完整路径或工程名，取最后一段当工程名（工程名不允许带 / 和 \）。
 */
export const toCppRelativeProjectPath = (projectPath: string, platform: string = process.platform): string => {
  const name = projectPath.trim().split(/[\\/]+/).filter(Boolean).pop() ?? ''
  return platform === 'win32' ? `.\\Project\\${name}` : `./Project/${name}`
}
