# Changelog

All notable changes to `@acosmi/sdk-ts` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] — 2026-05-01

### Fixed

- **Layer 1 — packaging**:`tsup.config.ts` 三 entry 显式声明 `outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.cjs' })`,让产物与 `package.json.exports` 8 处 `.mjs` 引用对账。修复 1.0.0 在 bun / Node ESM 下 `Cannot find module '@acosmi/sdk-ts'`。
- **Layer 2 — d.ts augmentation**:9 处 `declare module` 由相对路径(`'../client'` / `'./client'`)改为包名 `'@acosmi/sdk-ts'`:
  - `src/client/{wallet,entitlements,packages,notifications,tools,skills}.ts`(6 处)
  - `src/{ws,sanitize-bridge,bug-report}.ts`(3 处)

  修复后 augmentation 在 consumer 视角合并到 inline `declare class Client`,50+ 方法(`getBalance` / `submitBugReport` / `browseSkills` / `getWalletStats` / `listNotifications` / `chat` 等)在 user 项目可正常 typecheck。
- **tsconfig.json**:附带加 `baseUrl` + `paths "@acosmi/sdk-ts": ["./src/client.ts"]`,让源码 typecheck 阶段 self-reference 也能合并到 class Client。

### Added

- **`scripts/smoke-pack.mjs`** + `prepublishOnly` 末尾追加 `&& npm run test:pack`:跨平台 Node 脚本(Windows + Linux/macOS),在 `npm publish` 前从 packed tarball 装临时 consumer 项目跑 `tsc --noEmit`,验证 9 处 augmentation 在 consumer 视角合并成功。拦截"源码 typecheck 过 / packed 产物 broken"模式(1.0.0 翻车的根因机制)。

## [1.0.0] — 2026-05-01 [DEPRECATED]

> **⚠ DEPRECATED**:双层 broken packaging。请升级到 1.0.1+:`npm install @acosmi/sdk-ts@latest`。
>
> 已通过 `npm deprecate @acosmi/sdk-ts@1.0.0 'broken packaging, use 1.0.1+'` 标记,安装时会显示 deprecation warning。

### 已知问题(已在 1.0.1 修复)

- `package.json.exports` 8 处 `.mjs` 引用指向不存在的文件(tsup 实际输出 `.js + .cjs`)— bun/Node ESM resolver 报 `Cannot find module`,仅 CJS `require()` 可用。
- 9 处 d.ts augmentation 用相对路径,packed 产物中路径不可解析 — `getBalance` / `submitBugReport` 等 50+ 方法在 consumer typecheck 时 TS2339(`Property X does not exist on type 'Client'`)。

### 端口源

- `acosmi-sdk-go` v1.0.0 全量端口
- 36/36 vitest 全绿,源码 typecheck/lint/build 0 错误
- 翻车机制:`prepublishOnly` 仅跑源码 typecheck/vitest/build,不验证 packed product 在 consumer 视角能否解析

[1.0.1]: https://github.com/acosmi/sdk-ts/releases/tag/v1.0.1
[1.0.0]: https://www.npmjs.com/package/@acosmi/sdk-ts/v/1.0.0
