import * as core from "@babylonjs/core";

const globalScope = globalThis as unknown as { BABYLON?: unknown };

// `@babylonjs/core` 导出的是不可扩展（sealed）的 ESM 命名空间，无法在运行时挂载新成员。
// UMD 网格包（babylon.gridMaterial.min.js）需要一个可变的全局 `BABYLON` 来附加 `GridMaterial`，
// 因此这里把 core 命名空间摊平为一个普通对象暴露到全局。
if (!globalScope.BABYLON) {
  globalScope.BABYLON = { ...core };
}
