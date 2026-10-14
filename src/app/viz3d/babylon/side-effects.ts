// 按路径引入 Babylon 时，原型扩展不会自动注册（以前靠 `import * as core` 全量带入）。
// 这里集中引入用到的副作用模块；新用到 scene / engine 上的扩展方法时在此补充。

// scene.pick / pickWithRay：点选物体、Gizmo 工具层
import "@babylonjs/core/Culling/ray";
// engine.createDynamicTexture：WebGL 下的 DynamicTexture（吊点标签）；WebGPU 引擎自带
import "@babylonjs/core/Engines/Extensions/engine.dynamicTexture";
