#!/usr/bin/env node
/**
 * 升级包工具（格式见 shared/update/types.ts）。
 *
 * 1) 生成签名密钥，只做一次。私钥放仓库外、妥善保管（丢了怎么办见 shared/update/signing-key.ts）：
 *      pnpm update:keygen --out D:\keys\yz-update-key.pem
 *    公钥会写进 shared/update/signing-key.ts，提交这个文件；之后打的安装包才认这把私钥签的升级包。
 *
 * 2) 打升级包：先 pnpm build（或 build:linux:*）出安装程序，再
 *      pnpm update:pack --key D:\keys\yz-update-key.pem --notes 更新说明.txt
 *    默认读 release/<版本>/yzapp_<版本>.exe（Windows x64），输出到同一个目录：
 *      yzapp_<版本>_<平台>-<架构>.yzupd  拷到现场：系统设置 › 软件更新 › 选择升级包
 *      latest-<平台>-<架构>.json         有更新服务器后，和 .yzupd 一起放到 YZ_UPDATE_URL 指向的目录
 *    平台按安装程序的扩展名判断：.exe 是 win32，.deb / .rpm / .AppImage 是 linux；
 *    架构用 --arch 指定（x64、arm64…，取值同 Node 的 process.arch），默认 x64。每种平台 + 架构各打一个包。
 *    其他参数：--installer <文件>  --version <x.y.z>  --out <目录>  --released-at <ISO 时间>
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC_KEY_FILE = path.join(REPO_ROOT, 'shared', 'update', 'signing-key.ts')
const KEY_CONST_RE = /export const UPDATE_SIGNING_PUBLIC_KEY = (?:'([^']*)'|`([^`]*)`)/

export const PRODUCT = 'yzapp'
const ARCH_RE = /^[a-z0-9_]{1,20}$/

/** 按安装程序扩展名认平台（同 shared/update/types.ts 的 INSTALLER_EXTENSIONS） */
export const platformOfInstaller = (file) => {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.exe') return 'win32'
  if (['.deb', '.rpm', '.appimage'].includes(ext)) return 'linux'
  throw new Error(`认不出安装程序 ${path.basename(file)} 是哪个平台的（.exe / .deb / .rpm / .AppImage）`)
}

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

export const generateSigningKeys = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  }
}

export const publicKeyOf = (privateKeyPem) =>
  createPublicKey(createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'pem' })

/** signing-key.ts 里的公钥，没配为空字符串 */
export const readPublicKeyConstant = (source) => {
  const match = KEY_CONST_RE.exec(source)
  if (!match) throw new Error(`${PUBLIC_KEY_FILE} 里找不到 UPDATE_SIGNING_PUBLIC_KEY`)
  return (match[1] ?? match[2] ?? '').trim()
}

export const writePublicKeyConstant = (source, publicKeyPem) => {
  if (!KEY_CONST_RE.test(source)) throw new Error(`${PUBLIC_KEY_FILE} 里找不到 UPDATE_SIGNING_PUBLIC_KEY`)
  return source.replace(KEY_CONST_RE, () => `export const UPDATE_SIGNING_PUBLIC_KEY = \`${publicKeyPem}\``)
}

const sha512File = (file) =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')))
  })

/** 安装程序本来就压缩过，zip 里只存不压，现场解得快 */
const writeZip = async (dest, entries) => {
  const { ZipArchive } = await import('archiver')
  await new Promise((resolve, reject) => {
    const output = createWriteStream(dest)
    const archive = new ZipArchive({ store: true })
    output.on('close', resolve)
    output.on('error', reject)
    archive.on('error', reject)
    archive.pipe(output)
    for (const entry of entries) {
      if (entry.file) archive.file(entry.file, { name: entry.name })
      else archive.append(entry.data, { name: entry.name })
    }
    Promise.resolve(archive.finalize()).catch(reject)
  })
}

/** 打一个签名的升级包，并生成服务器用的 latest.json */
export const packUpdate = async ({
  installer,
  privateKeyPem,
  version,
  notes = '',
  releasedAt = new Date().toISOString(),
  outDir,
  product = PRODUCT,
  arch = 'x64',
}) => {
  if (!VERSION_RE.test(version)) throw new Error(`版本号格式不对：${version}`)
  if (!ARCH_RE.test(arch)) throw new Error(`架构写法不对：${arch}`)
  const platform = platformOfInstaller(installer)
  const installerStat = await fs.stat(installer)
  const manifest = {
    format: 1,
    product,
    platform,
    arch,
    version,
    releasedAt,
    notes,
    installer: {
      file: path.basename(installer),
      size: installerStat.size,
      sha512: await sha512File(installer),
    },
  }
  // 签的是这几个字节；软件里按原样验，不重新序列化
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  const signature = sign(null, manifestBytes, createPrivateKey(privateKeyPem)).toString('base64')

  await fs.mkdir(outDir, { recursive: true })
  const packagePath = path.join(outDir, `${product}_${version}_${platform}-${arch}.yzupd`)
  await writeZip(packagePath, [
    { name: 'manifest.json', data: manifestBytes },
    { name: 'manifest.sig', data: Buffer.from(`${signature}\n`, 'utf8') },
    { name: manifest.installer.file, file: installer },
  ])

  const latest = {
    platform,
    arch,
    version,
    releasedAt,
    notes,
    file: path.basename(packagePath),
    size: (await fs.stat(packagePath)).size,
    sha512: await sha512File(packagePath),
  }
  const latestPath = path.join(outDir, `latest-${platform}-${arch}.json`)
  await fs.writeFile(latestPath, `${JSON.stringify(latest, null, 2)}\n`, 'utf8')
  return { packagePath, latestPath, manifest, latest }
}

const isInside = (child, parent) => {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

const exists = (file) =>
  fs.access(file).then(
    () => true,
    () => false,
  )

const die = (message) => {
  console.error(message)
  process.exit(1)
}

const keygen = async (args) => {
  const { values } = parseArgs({ args, options: { out: { type: 'string' }, force: { type: 'boolean' } } })
  if (!values.out) die('用 --out 指定私钥保存位置（放在仓库外面）')
  const out = path.resolve(values.out)
  if (isInside(out, REPO_ROOT)) die('私钥不能放在仓库里，换一个仓库外的位置')
  if (await exists(out)) die(`${out} 已经存在，换个位置或先挪走`)
  const source = await fs.readFile(PUBLIC_KEY_FILE, 'utf8')
  if (readPublicKeyConstant(source) && !values.force) {
    die(
      'signing-key.ts 里已经有公钥了。换钥匙后，已经装出去的软件不认新钥匙签的升级包，' +
        '得在现场手动运行一次安装程序。确定要换就加 --force',
    )
  }
  const keys = generateSigningKeys()
  await fs.mkdir(path.dirname(out), { recursive: true })
  await fs.writeFile(out, keys.privateKeyPem, { mode: 0o600, flag: 'wx' })
  await fs.writeFile(PUBLIC_KEY_FILE, writePublicKeyConstant(source, keys.publicKeyPem), 'utf8')
  console.log(`私钥：${out}（妥善保管，不要提交、不要发给别人）`)
  console.log(`公钥已写进 ${path.relative(REPO_ROOT, PUBLIC_KEY_FILE)}，请提交这个文件`)
}

const pack = async (args) => {
  const { values } = parseArgs({
    args,
    options: {
      key: { type: 'string' },
      installer: { type: 'string' },
      notes: { type: 'string' },
      version: { type: 'string' },
      out: { type: 'string' },
      'released-at': { type: 'string' },
      arch: { type: 'string' },
    },
  })
  if (!values.key) die('用 --key 指定私钥文件')
  const pkg = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'))
  const version = values.version ?? pkg.version
  const installer = path.resolve(
    values.installer ?? path.join(REPO_ROOT, 'release', version, `${pkg.productName}_${version}.exe`),
  )
  if (!(await exists(installer))) die(`找不到安装程序 ${installer}，先 pnpm build，或用 --installer 指定`)
  const privateKeyPem = await fs.readFile(path.resolve(values.key), 'utf8')
  const configured = readPublicKeyConstant(await fs.readFile(PUBLIC_KEY_FILE, 'utf8'))
  if (!configured) die('signing-key.ts 里还没有公钥，先 pnpm update:keygen')
  if (publicKeyOf(privateKeyPem).trim() !== configured) {
    die('这把私钥和 signing-key.ts 里的公钥对不上，装出去的软件会拒绝这个升级包')
  }
  const notes = values.notes ? (await fs.readFile(path.resolve(values.notes), 'utf8')).trim() : ''
  const result = await packUpdate({
    installer,
    privateKeyPem,
    version,
    notes,
    releasedAt: values['released-at'],
    arch: values.arch,
    outDir: path.resolve(values.out ?? path.dirname(installer)),
  })
  console.log(`升级包：${result.packagePath}`)
  console.log(`latest 文件：${result.latestPath}`)
}

const main = async () => {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'keygen') return keygen(args)
  if (command === 'pack') return pack(args)
  die('用法：node scripts/update-package.mjs keygen --out <私钥路径> | pack --key <私钥路径> [--notes <文件>]')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => die(err instanceof Error ? err.message : String(err)))
}
