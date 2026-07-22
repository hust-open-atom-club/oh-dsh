# RFC: TSC 优先的构建与单一 tsconfig

Status: implemented

[English](2026-06-17-ts-build-config.md) | 中文

## 问题

此前的 TypeScript 构建与类型检查配置存在以下问题：

- `build` 使用 `tsc` 将 `packages/<group>/<pkg>` 和 `vendor/*` 下的 `.ts` 转换为 `.d.ts` 文件，然后使用 `tsdown` 将 `.ts` 转换为打包后的 `.js` 文件。这导致两个工具各自执行 TypeScript 转换。
- `typecheck` 倾向于通过一个根目录的 typecheck 配置来校验 package、vendor 源码、示例、测试和脚本。

目标是让构建与类型检查使用一致的 tsconfig 边界和 TypeScript 解析/转换行为。构建应通过单一编译器和配置生成 `.js`、`.d.ts`、`.js.map` 和 `.d.ts.map`，使发布产物与类型校验保持一致。

验证过程中发现了若干具体的技术问题和可能的路径：

- `tsdown` 使用 `oxc` 进行 TypeScript 转换，其行为与 `tsc` 不同。
    - `tsdown` 输出的打包 `.d.ts` 与 Cordis 内部的相对模块增强（module augmentation）结构冲突。
    - tsc 的输出受 `allowImportingTsExtensions` 影响，因此需要确保生成的 `.js` 文件不会导入 `.ts` 文件，且生成的 `.d.ts` 文件保留 NodeNext/Node16 接受的显式相对说明符。为此，包内相对导入在 TypeScript 源码中使用显式 `.ts` 说明符，由 `rewriteRelativeImportExtensions` 在输出的 JS 中将其重写为 `.js`。
    - `tsdown` 输出的打包 `.js` 与 `tsc -b` 逐文件输出的 `.js` 行为不同，例如装饰器转换行为。
- `vendor/*/src`、示例、测试和脚本无法全部以 plain-include 方式纳入一个根目录的严格程序。
    - 在根目录严格配置下直接对 `vendor/*/src` 做类型检查，会触发大量不属于本项目所有权范围的类型错误。
    - `packages/*/*` 对 `vendor` 的包依赖解析到 `vendor/*/lib`，以适应不同的 tsconfig 严格度。

## 决策

包内相对导入使用显式 `.ts` 说明符。

`pnpm run build` 是两阶段构建：

- 阶段 1：`tsc -b tsconfig.build.json` 将逐模块的 `.js`、声明文件 `.d.ts`、JS sourcemap `.js.map` 和声明 sourcemap `.d.ts.map` 输出到各 package 的 `lib/types`。这是权威的 TypeScript 编译结果。发布时保留 `.d.ts` / `.d.ts.map`，忽略 `.js` / `.js.map`。
    - 构建项目使用 `tsc -b` 编译的 project-reference 图。例如，根 `tsconfig.build.json` 引用 package 和 vendor 的 tsconfig，校验并输出 package/vendor 的构建结果。
- 阶段 2：打包器读取 `lib/types` 下输出的 JS，将打包后的运行时入口写为 `lib/index.js` 或 `lib/index.mjs`（沿用当前行为）。此阶段仅做打包，禁止读取 TypeScript 源码或输出声明文件。

`tsdown` 不再负责 TypeScript 编译或声明文件输出。

`pnpm run typecheck` 以 build 模式运行根 `tsconfig.json`。
- 根 `tsconfig.json` 是唯一的开发/类型检查项目。它以 `noEmit` 方式检查示例、测试和脚本，并通过 references 校验 package/vendor 源码。
- 被引用的 package/vendor 项目保持与 build 相同的输出行为，因此 typecheck 可以刷新它们的 `lib/types` 输出，而无需使用独立的 no-emit 图。项目特定的严格度变更放在各自的 `packages/*/*/tsconfig.json` 或 `vendor/*/tsconfig.json` 中。
- 根 no-emit 项目禁用 `rewriteRelativeImportExtensions`；它不输出任何文件，且包含跨 project-reference 边界导入 helper 的测试。package/vendor 的 emit 项目保持重写开启。

命令编排结构如下：

```sh
pnpm run build:
tsc -b tsconfig.build.json
tsdown

pnpm run verify-node-next-types:
tsx scripts/verify-node-next-types.ts

pnpm run typecheck:
tsc -b tsconfig.json
```

`pnpm run demo:*` 仍通过 tsx 和根路径直接运行 `src`，无需编译步骤。

## 曾考虑的替代方案

- **继续使用 `tsdown`/oxc 作为 TypeScript 转换器**：oxc 的转换行为与 `tsc` 不同（装饰器转换有差异、打包 JS 与逐文件输出不同），且其打包 `.d.ts` 与 Cordis 内部的相对模块增强结构冲突。
- **用一个根目录严格程序覆盖 package、vendor、示例、测试和脚本**：vendor 源码在根目录严格标志下会触发不属于本项目所有权范围的类型错误；带有逐项目严格度的 project references 才是可行的边界。

## 后果

构建职责更加清晰：

- `packages/<group>/<pkg>` 和 `vendor/*` 下的每个模块有一份本地 tsconfig，同时服务于构建、类型检查和直接运行源码的工具（如 `tsx` 和 `vitest`）。
- `build` 命令使用 `tsconfig.build.json`。`tsc -b` 负责可发布的逐模块 `.js` 和 `.d.ts` 输出，打包器仅负责 `lib/index.*`。
    - `lib/types/*.d.ts` 和 `.d.ts.map` 是发布用的声明输出。
    - `lib/types/*.d.ts` 使用显式 `.ts` 相对说明符，TypeScript 的 NodeNext/Node16 解析器会将其映射到同级的 `.d.ts` 文件。
    - `lib/types/*.js` 仅作为打包器输入，禁止用作运行时入口或公开导入目标。
    - `lib/index.*` 是发布用的运行时输出，由打包器（当前为 `tsdown`）生成。
- `pnpm run verify-node-next-types` 扫描构建出的声明文件，检查是否存在缺少文件扩展名的相对说明符，然后以 `moduleResolution: "NodeNext"` 对构建出的 `types`/`exports` 接口进行临时外部 ESM 消费方的类型检查，确保声明说明符的回归在发布前被捕获。
- `typecheck` 命令使用 `tsconfig.json`。示例、测试和脚本由根 no-emit 项目检查，package 和 vendor 模块保持与 `build` 相同的输出行为。package 和 vendor 源码始终处于 project-reference 边界之后。

Cordis 的 vendor 副本现在与上游多了一处类型结构差异。在上游同步时，该差异必须被重新应用或明确废弃。
