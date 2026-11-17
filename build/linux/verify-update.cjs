'use strict'
/**
 * Linux 版在软件里装升级时，root 辅助程序 yz-install-update 先用它在 root 自己的副本上重新验升级包：
 *   ELECTRON_RUN_AS_NODE=1 /opt/yzapp/yzapp verify-update.cjs <升级包目录> <root 的临时目录>
 * 升级包目录是软件存好的 packages/<版本>（manifest.json、manifest.sig、.deb），在普通用户的目录里。
 * 读进来的字节先验签名，.deb 边算 sha512 边写进临时目录：验过的就是要装的，中途换不掉。
 * 公钥读同目录的 signing-key.ts（打包时从 shared/update/signing-key.ts 原样拷来，和软件里验包的是同一把）。
 * 规则同 electron/main/update/package-store.ts（这里是独立脚本，不能引用那边的代码）。
 * 通过：标准输出打出临时目录里 .deb 的路径，退出码 0；不通过：标准错误打原因，退出码 1。
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

/** 同 shared/update/types.ts 的 UPDATE_PRODUCT */
const PRODUCT = 'yzapp'
/** 同 scripts/update-package.mjs 读公钥的写法 */
const KEY_CONST_RE = /export const UPDATE_SIGNING_PUBLIC_KEY = (?:'([^']*)'|`([^`]*)`)/
const DEB_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._+~-]{0,199}\.deb$/
const SHA512_BASE64_RE = /^[A-Za-z0-9+/]{86}==$/

class VerifyError extends Error {}

const check = (condition, message) => {
  if (!condition) throw new VerifyError(message)
}

const readPublicKey = () => {
  const source = fs.readFileSync(path.join(__dirname, 'signing-key.ts'), 'utf8')
  const match = KEY_CONST_RE.exec(source)
  const key = match ? (match[1] ?? match[2] ?? '').trim() : ''
  check(key, '软件里没有配置升级签名公钥')
  return key
}

/** 只读普通文件，不跟符号链接 */
const openRegularFile = (file) => {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  if (!fs.fstatSync(fd).isFile()) {
    fs.closeSync(fd)
    throw new VerifyError(`${path.basename(file)} 不是普通文件`)
  }
  return fd
}

const readSmallFile = (file, limit) => {
  const fd = openRegularFile(file)
  try {
    const size = fs.fstatSync(fd).size
    check(size <= limit, `${path.basename(file)} 太大`)
    const data = Buffer.alloc(size)
    let done = 0
    while (done < size) {
      const n = fs.readSync(fd, data, done, size - done, null)
      if (n === 0) break
      done += n
    }
    return data.subarray(0, done)
  } finally {
    fs.closeSync(fd)
  }
}

/** 边读边算 sha512 边写，返回 sha512（base64）；超过 expectedSize 就停 */
const copyWithHash = (src, dest, expectedSize) => {
  const input = openRegularFile(src)
  let output
  try {
    output = fs.openSync(dest, 'wx', 0o644)
    const hash = crypto.createHash('sha512')
    const buffer = Buffer.allocUnsafe(1 << 20)
    let total = 0
    for (;;) {
      const n = fs.readSync(input, buffer, 0, buffer.length, null)
      if (n === 0) break
      total += n
      check(total <= expectedSize, '安装程序大小和升级包里写的不一样')
      hash.update(buffer.subarray(0, n))
      let written = 0
      while (written < n) written += fs.writeSync(output, buffer, written, n - written)
    }
    check(total === expectedSize, '安装程序大小和升级包里写的不一样')
    fs.fsyncSync(output)
    return hash.digest('base64')
  } finally {
    fs.closeSync(input)
    if (output !== undefined) fs.closeSync(output)
  }
}

const verify = (srcDir, workDir) => {
  const publicKey = readPublicKey()
  const manifestBytes = readSmallFile(path.join(srcDir, 'manifest.json'), 1 << 20)
  const signature = Buffer.from(readSmallFile(path.join(srcDir, 'manifest.sig'), 4096).toString('utf8').trim(), 'base64')
  check(crypto.verify(null, manifestBytes, publicKey, signature), '签名不对，不是用本软件的签名私钥打的升级包')

  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  check(manifest && manifest.format === 1, '升级包格式不认识')
  check(manifest.product === PRODUCT, `这是 ${manifest.product} 的升级包，不是 ${PRODUCT}`)
  check(
    manifest.platform === 'linux' && manifest.arch === process.arch,
    `这是 ${manifest.platform} ${manifest.arch} 的升级包，本机是 linux ${process.arch}`,
  )
  const installer = manifest.installer
  check(installer && typeof installer.file === 'string' && DEB_NAME_RE.test(installer.file), '安装程序不是 .deb')
  check(Number.isSafeInteger(installer.size) && installer.size > 0, '安装程序大小不对')
  check(typeof installer.sha512 === 'string' && SHA512_BASE64_RE.test(installer.sha512), '安装程序校验值不对')

  const dest = path.join(workDir, installer.file)
  const sha512 = copyWithHash(path.join(srcDir, installer.file), dest, installer.size)
  check(sha512 === installer.sha512, '安装程序和升级包里写的不一样（sha512 对不上），可能被改过')
  return dest
}

const main = () => {
  const [srcDir, workDir] = process.argv.slice(2)
  if (!srcDir || !workDir) {
    process.stderr.write('用法：verify-update.cjs <升级包目录> <临时目录>\n')
    return 1
  }
  try {
    process.stdout.write(`${verify(srcDir, workDir)}\n`)
    return 0
  } catch (err) {
    process.stderr.write(`verify-update: ${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}

process.exitCode = main()
