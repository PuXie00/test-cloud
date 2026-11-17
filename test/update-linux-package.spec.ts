import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LINUX_INSTALL_HELPER, LINUX_INSTALL_PREFIX } from '../electron/main/update/installers'
import { UPDATE_PRODUCT } from '../shared/update/types'
// @ts-expect-error 发版脚本是 .mjs，没有类型
import * as tool from '../scripts/update-package.mjs'

const ROOT = path.resolve(__dirname, '..')
const LINUX_DIR = path.join(ROOT, 'build', 'linux')
const readRepo = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')
const pkg = JSON.parse(readRepo('package.json')) as { name: string; productName: string }

type BuilderConfig = {
  extraFiles: { from: string }[]
  win: { extraFiles: { from: string; to: string }[] }
  linux: {
    executableName: string
    target: string[]
    extraFiles: { from: string; to: string }[]
    extraResources: { from: string; to: string }[]
  }
  deb: { afterInstall: string; fpm: string[] }
  electronFuses?: { runAsNode?: boolean }
}

const loadExtractZip = async () => {
  const mod = await import('extract-zip')
  return ((mod as { default?: unknown }).default ?? mod) as (zip: string, opts: { dir: string }) => Promise<void>
}

describe.each(['electron-builder.json', 'electron-builder.dev.json'])('%s 的 Linux 打包配置', (file) => {
  const config = JSON.parse(readRepo(file)) as BuilderConfig

  it('只出 deb，程序名同包名（辅助程序、polkit 动作里写死了）', () => {
    expect(config.linux.target).toEqual(['deb'])
    expect(config.linux.executableName).toBe(pkg.name)
    expect(pkg.productName).toBe(pkg.name)
  })

  it('不关 runAsNode：root 辅助程序用软件自带的 Node 验包', () => {
    expect(config.electronFuses?.runAsNode).not.toBe(false)
  })

  it('运动学程序按平台拷：Windows 是 YXZ.exe，Linux 是 YXZ', () => {
    expect(config.extraFiles.map((entry) => entry.from)).not.toContain('YXZ.exe')
    expect(config.win.extraFiles).toEqual([{ from: 'YXZ.exe', to: 'YXZ.exe' }])
    expect(config.linux.extraFiles).toEqual([{ from: 'YXZ', to: 'YXZ' }])
  })

  it('root 辅助程序、验包脚本、公钥拷到 resources/linux', () => {
    expect(config.linux.extraResources).toEqual([
      { from: 'build/linux/yz-install-update', to: LINUX_INSTALL_HELPER },
      { from: 'build/linux/verify-update.cjs', to: 'linux/verify-update.cjs' },
      { from: 'shared/update/signing-key.ts', to: 'linux/signing-key.ts' },
    ])
  })

  it('安装后脚本建 Project，polkit 动作装进系统', () => {
    expect(config.deb.afterInstall).toBe('build/linux/after-install.tpl')
    expect(config.deb.fpm).toEqual([
      'build/linux/yzapp.install-update.policy=/usr/share/polkit-1/actions/yzapp.install-update.policy',
    ])
  })
})

describe('Linux 安装包里的脚本', () => {
  it('polkit 动作指向装好后的 root 辅助程序', () => {
    const policy = readFileSync(path.join(LINUX_DIR, 'yzapp.install-update.policy'), 'utf8')
    expect(policy).toContain('<action id="yzapp.install-update">')
    expect(policy).toContain(
      `<annotate key="org.freedesktop.policykit.exec.path">${LINUX_INSTALL_PREFIX}/${pkg.productName}/resources/${LINUX_INSTALL_HELPER}</annotate>`,
    )
    expect(policy).toMatch(/<allow_active>auth_admin<\/allow_active>/)
  })

  it('辅助程序认的包名、程序名同打包配置，验包脚本认的产品同软件', () => {
    const helper = readFileSync(path.join(LINUX_DIR, 'yz-install-update'), 'utf8')
    expect(helper).toContain(`\nPACKAGE=${pkg.name}\n`)
    expect(helper).toContain(`\nEXECUTABLE=${pkg.name}\n`)
    const verifyScript = readFileSync(path.join(LINUX_DIR, 'verify-update.cjs'), 'utf8')
    expect(verifyScript).toContain(`const PRODUCT = '${UPDATE_PRODUCT}'`)
  })

  it('安装后脚本以 electron-builder 默认的为准（升级 electron-builder 时要对一下）', () => {
    const ours = readFileSync(path.join(LINUX_DIR, 'after-install.tpl'), 'utf8')
    const upstream = readRepo('node_modules/app-builder-lib/templates/linux/after-install.tpl')
    expect(ours.startsWith(upstream)).toBe(true)
  })
})

describe.skipIf(process.platform === 'win32')('Linux 脚本在本机跑', () => {
  let tmp: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'yz-linux-pkg-'))
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('脚本语法没问题', async () => {
    expect(spawnSync('sh', ['-n', path.join(LINUX_DIR, 'yz-install-update')]).status).toBe(0)
    const rendered = readFileSync(path.join(LINUX_DIR, 'after-install.tpl'), 'utf8')
      .replaceAll('${executable}', 'yzapp')
      .replaceAll('${sanitizedProductName}', 'yzapp')
    const file = path.join(tmp, 'postinst')
    await fs.writeFile(file, rendered)
    expect(spawnSync('bash', ['-n', file]).status).toBe(0)
  })

  it.skipIf(process.getuid?.() === 0)('辅助程序不是 root 跑就拒绝', () => {
    const result = spawnSync(path.join(LINUX_DIR, 'yz-install-update'), [tmp], { encoding: 'utf8' })
    expect(result.status).toBe(10)
    expect(result.stderr).toContain('root')
  })

  it('安装后脚本：第一次建 Project 设成 1777，已有的不改权限', async () => {
    const ours = readFileSync(path.join(LINUX_DIR, 'after-install.tpl'), 'utf8')
    const marker = ours.indexOf('# ---- 以上同 electron-builder')
    expect(marker).toBeGreaterThan(0)
    const appDir = path.join(tmp, 'opt', 'yzapp')
    await fs.mkdir(path.join(appDir, 'resources', 'linux'), { recursive: true })
    await fs.writeFile(path.join(appDir, 'resources', 'linux', 'yz-install-update'), '#!/bin/sh\n', { mode: 0o644 })
    const section = ours.slice(marker).replaceAll("'/opt/${sanitizedProductName}'", `'${appDir}'`)
    const script = path.join(tmp, 'ours.sh')
    await fs.writeFile(script, section)

    expect(spawnSync('sh', [script]).status).toBe(0)
    const project = path.join(appDir, 'Project')
    expect((await fs.stat(project)).mode & 0o7777).toBe(0o1777)
    expect((await fs.stat(path.join(appDir, 'resources', 'linux', 'yz-install-update'))).mode & 0o777).toBe(0o755)

    // 管理员改过权限：升级时再跑一次不改回去
    await fs.chmod(project, 0o2775)
    expect(spawnSync('sh', [script]).status).toBe(0)
    expect((await fs.stat(project)).mode & 0o7777).toBe(0o2775)
  })

  describe('root 端重新验包（verify-update.cjs）', () => {
    let keys: { publicKeyPem: string; privateKeyPem: string }
    let packageDir: string
    let workDir: string
    let script: string
    const debName = 'yzapp_1.2.0.deb'
    const debBytes = Buffer.alloc(300_000, 7)

    /** 验包脚本和公钥放在一起，同装好后的 resources/linux */
    const installScript = async (publicKeyPem: string) => {
      const dir = path.join(tmp, 'resources-linux')
      await fs.mkdir(dir, { recursive: true })
      script = path.join(dir, 'verify-update.cjs')
      await fs.copyFile(path.join(LINUX_DIR, 'verify-update.cjs'), script)
      await fs.writeFile(
        path.join(dir, 'signing-key.ts'),
        `export const UPDATE_SIGNING_PUBLIC_KEY = \`${publicKeyPem}\`\n`,
      )
    }

    const verify = () =>
      spawnSync(process.execPath, [script, packageDir, workDir], { encoding: 'utf8', timeout: 20_000 })

    beforeEach(async () => {
      keys = tool.generateSigningKeys()
      const installer = path.join(tmp, debName)
      await fs.writeFile(installer, debBytes)
      const { packagePath } = (await tool.packUpdate({
        installer,
        privateKeyPem: keys.privateKeyPem,
        version: '1.2.0',
        arch: process.arch,
        outDir: path.join(tmp, 'out'),
      })) as { packagePath: string }
      // 同软件存好的 packages/<版本>
      packageDir = path.join(tmp, 'Updates', 'packages', '1.2.0')
      await (await loadExtractZip())(packagePath, { dir: packageDir })
      workDir = path.join(tmp, 'work')
      await fs.mkdir(workDir)
      await installScript(keys.publicKeyPem)
    })

    it('通过：.deb 拷进临时目录，打出路径', async () => {
      const result = verify()
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      expect(result.stdout).toBe(`${path.join(workDir, debName)}\n`)
      expect(await fs.readFile(path.join(workDir, debName))).toEqual(debBytes)
    })

    it('.deb 被换过就不通过', async () => {
      await fs.writeFile(path.join(packageDir, debName), Buffer.alloc(debBytes.length, 8))
      const result = verify()
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('sha512')
    })

    it('别的私钥签的、没配公钥的都不通过', async () => {
      await installScript(tool.generateSigningKeys().publicKeyPem)
      expect(verify()).toMatchObject({ status: 1, stderr: expect.stringContaining('签名不对') })
      await installScript('')
      expect(verify()).toMatchObject({ status: 1, stderr: expect.stringContaining('没有配置升级签名公钥') })
    })

    it('不跟符号链接', async () => {
      const target = path.join(tmp, 'elsewhere.deb')
      await fs.writeFile(target, debBytes)
      await fs.rm(path.join(packageDir, debName))
      await fs.symlink(target, path.join(packageDir, debName))
      expect(verify().status).toBe(1)
    })
  })

  /**
   * root 辅助程序走到 apt-get 之前的整段：装好后的目录结构、验包、读 .deb 的包名。
   * 测试里不是 root，用去掉 root 检查的副本；软件本体换成跑 Node 的小脚本（同 ELECTRON_RUN_AS_NODE）。
   */
  describe.skipIf(spawnSync('sh', ['-c', 'command -v dpkg-deb']).status !== 0)('root 辅助程序', () => {
    const buildDeb = async (packageName: string) => {
      const root = path.join(tmp, `deb-${packageName}`)
      await fs.mkdir(path.join(root, 'DEBIAN'), { recursive: true })
      await fs.writeFile(
        path.join(root, 'DEBIAN', 'control'),
        `Package: ${packageName}\nVersion: 1.2.0\nArchitecture: all\nMaintainer: test <t@example.com>\nDescription: test\n`,
      )
      const deb = path.join(tmp, `${packageName}.deb`)
      expect(spawnSync('dpkg-deb', ['--root-owner-group', '--build', root, deb]).status).toBe(0)
      return deb
    }

    const runHelper = async (packageName: string) => {
      const keys = tool.generateSigningKeys() as { publicKeyPem: string; privateKeyPem: string }
      const { packagePath } = (await tool.packUpdate({
        installer: await buildDeb(packageName),
        privateKeyPem: keys.privateKeyPem,
        version: '1.2.0',
        arch: process.arch,
        outDir: path.join(tmp, 'out'),
      })) as { packagePath: string }
      const packageDir = path.join(tmp, 'Updates', 'packages', '1.2.0')
      await (await loadExtractZip())(packagePath, { dir: packageDir })

      // 同 /opt/yzapp：程序本体 + resources/linux
      const appDir = path.join(tmp, 'opt', 'yzapp')
      const helperDir = path.join(appDir, 'resources', 'linux')
      await fs.mkdir(helperDir, { recursive: true })
      await fs.writeFile(path.join(appDir, pkg.name), `#!/bin/sh\nexec "${process.execPath}" "$@"\n`, { mode: 0o755 })
      await fs.copyFile(path.join(LINUX_DIR, 'verify-update.cjs'), path.join(helperDir, 'verify-update.cjs'))
      await fs.writeFile(
        path.join(helperDir, 'signing-key.ts'),
        `export const UPDATE_SIGNING_PUBLIC_KEY = \`${keys.publicKeyPem}\`\n`,
      )
      const source = readFileSync(path.join(LINUX_DIR, 'yz-install-update'), 'utf8')
      const rootCheck = '[ "$(id -u)" -eq 0 ] || fail 10 "要用 root 运行（pkexec）"\n'
      expect(source).toContain(rootCheck)
      const helper = path.join(helperDir, 'yz-install-update')
      await fs.writeFile(helper, source.replace(rootCheck, ''), { mode: 0o755 })
      return spawnSync(helper, [packageDir], { encoding: 'utf8', timeout: 30_000 })
    }

    it('验过签名以后，包名不是 yzapp 就不装', async () => {
      const result = await runHelper('otherpkg')
      expect(result.stderr).toContain('安装包是 otherpkg，不是 yzapp')
      expect(result.status).toBe(12)
    })
  })
})
