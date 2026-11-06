/**
 * .env.[mode] 里的 YZ_* 打包时写进来（见 vite.config.ts），这里填进 process.env。
 * 系统里已有同名环境变量就不覆盖：现场排查改系统变量即可，不用重新打包。
 * 必须在 main/index.ts 最先 import，其他模块读 process.env.YZ_* 之前就要填好。
 */
for (const [key, value] of Object.entries(__YZ_ENV__)) {
  if (process.env[key] === undefined) process.env[key] = value
}
