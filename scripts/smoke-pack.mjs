#!/usr/bin/env node
// scripts/smoke-pack.mjs — packed-tarball smoke test
//
// 拦截 v1.0.0 翻车模式: 源码 typecheck/lint/test/build 全过 + dist 已生成,
// 但 packed 产物在 consumer 视角 broken (exports 路径错位 / declare module
// path 没 rewrite). prepublishOnly 内最后一道闸.
//
// 流程:
//   1. npm pack → acosmi-sdk-ts-<version>.tgz
//   2. mkdtemp 临时 consumer 项目 (隔离的 node_modules)
//   3. npm init -y + npm i <tgz> + npm i -D typescript
//   4. 写 smoke.ts 用包名 import + 调 augmentation 添加的 method
//   5. npx tsc --noEmit → 必须 0 退出码
//
// 跨平台:
//   - 用 spawnSync 不用 exec/execSync (无 shell injection)
//   - args 数组形式传入 (路径含空格不被分词)
//   - npm bin 平台检测 (Windows: npm.cmd, Unix: npm)
//   - mkdtempSync 走 os.tmpdir() (Windows %TEMP%, Unix /tmp)

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(__dirname, '..');
const pkgJson = JSON.parse(readFileSync(join(sdkRoot, 'package.json'), 'utf8'));
const pkgName = pkgJson.name;
const pkgVersion = pkgJson.version;

const isWin = process.platform === 'win32';
const npmBin = isWin ? 'npm.cmd' : 'npm';
const npxBin = isWin ? 'npx.cmd' : 'npx';

function run(cmd, args, cwd) {
  // Windows 下 Node 20.12+ 安全限制 (CVE-2024-27980 修复) 禁止直接 spawn .cmd/.bat
  // 必须 shell:true 走 cmd.exe; args 全是字面量或本地构建路径, 无 user input 注入面.
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: isWin });
  if (res.error) {
    throw res.error;
  }
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with status ${res.status}`);
  }
}

console.log(`[smoke-pack] pkg = ${pkgName}@${pkgVersion}`);

// 1. npm pack
console.log('[smoke-pack] step 1/5 — npm pack ...');
run(npmBin, ['pack'], sdkRoot);
// npm pack 命名规则: @scope/name → scope-name-<version>.tgz
const tgzName = `${pkgName.replace(/^@/, '').replace('/', '-')}-${pkgVersion}.tgz`;
const tgzPath = join(sdkRoot, tgzName);
console.log(`[smoke-pack]   tarball = ${tgzPath}`);

// 2. mkdtemp consumer
const tmpDir = mkdtempSync(join(tmpdir(), 'sdk-ts-smoke-'));
console.log(`[smoke-pack] step 2/5 — consumer dir = ${tmpDir}`);

let exitCode = 0;
try {
  // 3. npm init + install
  console.log('[smoke-pack] step 3/5 — npm init + install tarball + typescript ...');
  run(npmBin, ['init', '-y'], tmpDir);
  run(npmBin, ['i', tgzPath], tmpDir);
  run(npmBin, ['i', '-D', 'typescript'], tmpDir);

  // 4. smoke.ts: 用包名 import + 调 augmentation method (覆盖 9 处 declare module 中各文件至少一个)
  const smokeContent = `import { Client } from '${pkgName}';

declare const c: Client;

// 9 处 declare module augmentation 各取代表方法 (consumer 视角全部应可调)
c.getBalance();                       // entitlements.ts
c.getWalletStats();                   // wallet.ts
c.listTokenPackages();                // packages.ts
c.listNotifications(1, 20, '');       // notifications.ts (page, pageSize, typeFilter)
c.listTools();                        // tools.ts
c.browseSkillStore({});               // skills.ts
c.submitBugReport({});                // bug-report.ts
c.applyRequestSanitizers({} as any);  // sanitize-bridge.ts
// ws.ts: 仅验证类型存在 (实际调用涉及 WebSocket 真连接, smoke 不跑)
const _wsConnect: typeof c.connect | undefined = undefined;
const _wsIsConnected: typeof c.isConnected | undefined = undefined;
void _wsConnect;
void _wsIsConnected;
`;
  writeFileSync(join(tmpDir, 'smoke.ts'), smokeContent);

  // consumer 端 tsconfig
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      esModuleInterop: true,
    },
    include: ['smoke.ts'],
  };
  writeFileSync(join(tmpDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));

  // 5. tsc --noEmit
  console.log('[smoke-pack] step 4/5 — tsc --noEmit (consumer 视角验证) ...');
  run(npxBin, ['tsc', '--noEmit'], tmpDir);

  console.log('[smoke-pack] step 5/5 — ✓ PASS (consumer 视角 packed 产物可用)');
} catch (err) {
  console.error('[smoke-pack] ✗ FAILED');
  console.error(err.message);
  exitCode = 1;
} finally {
  // 清理: 删 tgz + tmpDir (失败时保留 tmpDir 供调试)
  try {
    rmSync(tgzPath, { force: true });
  } catch {
    // ignore
  }
  if (exitCode === 0) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  } else {
    console.error(`[smoke-pack] consumer dir 保留供调试: ${tmpDir}`);
  }
}

process.exit(exitCode);
