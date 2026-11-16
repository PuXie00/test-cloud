/**
 * 升级包签名公钥（Ed25519，SPKI PEM）。私钥由负责发版的人保管，不能进仓库。
 *
 * 生成一次：pnpm update:keygen --out <仓库外的路径>/yz-update-key.pem
 * 脚本会把公钥写进下面这个常量（这个文件要提交）；私钥只写到 --out 指定的地方。
 *
 * 空字符串表示还没配置：软件拒绝导入、安装任何升级包。
 * 私钥丢了只能换一对新的：带新公钥的版本得在现场手动运行安装程序装上，之后才能继续用升级包。
 */
export const UPDATE_SIGNING_PUBLIC_KEY = ''
