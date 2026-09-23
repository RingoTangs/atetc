# tsdown-template

<p align="center">
  <strong>一个基于 tsdown 的精简 TypeScript 库模板。</strong>
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%3E%3D22-5FA04E?logo=nodedotjs&logoColor=white">
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white">
  <img alt="tsdown" src="https://img.shields.io/badge/tsdown-0.23-0F172A?logo=vite&logoColor=white">
  <img alt="Vitest" src="https://img.shields.io/badge/Vitest-4-6E9F18?logo=vitest&logoColor=white">
  <img alt="ESLint" src="https://img.shields.io/badge/ESLint-10-4B32C3?logo=eslint&logoColor=white">
  <img alt="Prettier" src="https://img.shields.io/badge/Prettier-3-F7B93E?logo=prettier&logoColor=1A2B34">
</p>

<p align="center">
  默认提供 ESM / CJS 双格式产物、类型声明生成，以及可直接使用的测试与代码质量工具链。
</p>

<p align="center">
  <a href="./README.md">English</a> | 简体中文
</p>

## 环境要求

- 运行包需要 Node.js `>=22`
- 开发此模板需要 Node.js `22.23.2`
- pnpm `10`

## 日常开发

- `pnpm i`：安装依赖
- `pnpm dev`：生成未压缩的本地开发构建
- `pnpm build`：生成压缩后的生产构建
- `pnpm test`：启动 Vitest watch 模式
- `pnpm test:run`：执行一次 Vitest 测试
- `pnpm lint`：对仓库运行 ESLint
- `pnpm lint:fix`：应用 ESLint 自动修复
- `pnpm format`：使用 Prettier 检查格式
- `pnpm format:fix`：使用 Prettier 格式化支持的文件
- `pnpm typecheck`：使用 `tsc -b` 检查 TypeScript 项目引用
- `pnpm check`：执行 lint、格式检查、类型检查和测试
- `pnpm fix`：执行 lint 和 format 自动修复
- `pnpm pack:check`：预览 npm 将要打包的文件

## 使用方式

1. 基于此模板创建新的仓库。
2. 按你的项目需求更新 `package.json` 元信息。
3. 执行 `pnpm i` 安装依赖。
4. 开发时使用 `pnpm dev`。
5. 提交前使用 `pnpm check` 做完整校验。

## 发布说明

发布真实 npm 包前：

1. 删除 `package.json` 中的 `private: true`，或将其改为 `false`。
2. 更新 `name`、`version`、`description`、`author`、`repository`、`bugs` 和 `homepage`。
3. 执行 `pnpm check`，验证 lint、格式、类型和测试。
4. 执行 `pnpm build`，生成待发布的包产物。
5. 执行 `pnpm pack:check`，检查 npm 包内容。
6. 确认 dry-run 输出无误后，再执行 `npm publish`。

第 3～5 步用于发布前主动检查。`npm publish` 会通过 `prepublishOnly` 生命周期脚本自动重复执行这些检查，依次运行 `pnpm check`、`pnpm build` 和 `pnpm pack:check`。

## 输出说明

发布包包含 `dist/` 中经过压缩的 ESM、CJS 运行时文件及类型声明，以及 npm 元数据、README 和 LICENSE。运行时文件的开头包含由包名和版本号组成的 banner。
