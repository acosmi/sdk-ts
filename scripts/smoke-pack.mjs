#!/usr/bin/env node
// scripts/smoke-pack.mjs — packed-tarball smoke test
//
// 拦截 v1.0.0 翻车模式: 源码 typecheck/lint/test/build 全过 + dist 已生成,
// 但 packed 产物在 consumer 视角 broken (exports 路径错位 / declare module
// path 没 rewrite). prepublishOnly 内最后一道闸.
//
// 同时拦截 2.19.3 翻车模式: 类型检查全过, 但以子路径为入口 import 即抛错
// (adapters/openai、adapters/anthropic 求值时撞上循环依赖里的顶层 new).
// 只做 tsc 的闸门从不在运行期加载任何入口, 所以必须真的 import / require 一次.
//
// 流程:
//   1. npm pack → acosmi-sdk-ts-<version>.tgz
//   2. mkdtemp 临时 consumer 项目 (隔离的 node_modules)
//   3. npm init -y + npm i <tgz> + npm i -D typescript
//   4. 写 smoke.ts 用包名 import + 调 augmentation 添加的 method
//   5. npx tsc --noEmit → 必须 0 退出码
//   6. 从 package.json exports 读出每个声明了 import / require 条件的子路径,
//      各起一个全新 node 进程, 用包名分别 ESM import() 与 CJS require();
//      任一抛错即失败 (每个入口都是该进程加载的第一个模块)
//
// 跨平台:
//   - 用 spawnSync 不用 exec/execSync (无 shell injection)
//   - args 数组形式传入 (路径含空格不被分词)
//   - npm bin 平台检测 (Windows: npm.cmd, Unix: npm)
//   - 运行期加载直接 spawn process.execPath (node 本体, 不是 .cmd, 不经 shell)
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

// exports 条件树里任一层出现 import / require 即为代码入口; 值只是字符串的子路径
// (如 ./package.json) 没有条件, 自然跳过. 返回 [{ subpath, conditions }].
function codeEntriesFromExports(exportsField) {
  if (exportsField == null) {
    throw new Error('package.json 没有 exports 字段');
  }
  // exports 语法糖 (字符串 / 数组 / 顶层即条件对象) 等价于 { ".": exports }
  const isSubpathMap =
    typeof exportsField === 'object' &&
    !Array.isArray(exportsField) &&
    Object.keys(exportsField).every((key) => key.startsWith('.'));
  const subpaths = isSubpathMap ? exportsField : { '.': exportsField };

  const entries = [];
  for (const [subpath, target] of Object.entries(subpaths)) {
    const conditions = new Set();
    collectConditions(target, conditions);
    if (conditions.size === 0) continue;
    if (subpath.includes('*')) {
      throw new Error(`exports 子路径 ${subpath} 是通配模式, 运行期加载无法确定具体入口`);
    }
    entries.push({ subpath, conditions });
  }
  if (entries.length === 0) {
    throw new Error('exports 中没有任何声明了 import / require 条件的子路径');
  }
  return entries;
}

function collectConditions(target, found) {
  if (Array.isArray(target)) {
    for (const item of target) collectConditions(item, found);
    return;
  }
  if (target === null || typeof target !== 'object') return;
  for (const [condition, value] of Object.entries(target)) {
    if (condition === 'import' || condition === 'require') found.add(condition);
    collectConditions(value, found);
  }
}

// 单个入口加载不应超过这个时长; 超时按失败处理, 不让闸门无限挂起
const LOAD_TIMEOUT_MS = 60_000;

const loaderSource = (loadExpression) =>
  `try {\n  ${loadExpression};\n} catch (err) {\n  console.error(err && err.stack ? err.stack : String(err));\n  process.exit(1);\n}\n`;

console.log(`[smoke-pack] pkg = ${pkgName}@${pkgVersion}`);

// 1. npm pack
console.log('[smoke-pack] step 1/6 — npm pack ...');
run(npmBin, ['pack'], sdkRoot);
// npm pack 命名规则: @scope/name → scope-name-<version>.tgz
const tgzName = `${pkgName.replace(/^@/, '').replace('/', '-')}-${pkgVersion}.tgz`;
const tgzPath = join(sdkRoot, tgzName);
console.log(`[smoke-pack]   tarball = ${tgzPath}`);

// 2. mkdtemp consumer
const tmpDir = mkdtempSync(join(tmpdir(), 'sdk-ts-smoke-'));
console.log(`[smoke-pack] step 2/6 — consumer dir = ${tmpDir}`);

let exitCode = 0;
try {
  // 3. npm init + install
  console.log('[smoke-pack] step 3/6 — npm init + install tarball + typescript ...');
  run(npmBin, ['init', '-y'], tmpDir);
  run(npmBin, ['i', tgzPath], tmpDir);
  run(npmBin, ['i', '-D', 'typescript'], tmpDir);

  // 4. smoke.ts: 用包名 import + 调 augmentation method (覆盖各 declare module 文件至少一个)
  const smokeContent = `import {
  BusinessError,
  Client,
  classifyComplianceError,
  complianceScopes,
  type QuotaSummarySubscriptionPool,
} from '${pkgName}';

declare const c: Client;

// declare module augmentation 各取代表方法 (consumer 视角全部应可调)
c.getBalance();                       // entitlements.ts
c.getWalletStats();                   // wallet.ts
c.listTokenPackages();                // packages.ts
c.listNotifications(1, 20, '');       // notifications.ts (page, pageSize, typeFilter)
c.listTools();                        // tools.ts
c.browseSkillStore({});               // skills.ts
c.agentRuns.create({ appId: 'app', input: 'hi' }); // client/agent-runs.ts
c.agentRuns.stream('run_1');          // namespaced agent run gateway
c.agentRuns.run({ appId: 'app', input: 'hi' });
c.agentRuns.cancel('run_1');
c.agentRuns.get('run_1');
c.agentRuns.listArtifacts('run_1');
c.agentRuns.downloadArtifact('run_1', 'artifact_1');
c.agentRuns.submitLocalToolResult('run_1', { requestId: 'local_1', ok: false, error: 'denied' });
c.agentRuns.runWithLocalTools({ appId: 'app', input: 'hi' }, {
  read_file: async (_input, ctx) => ({ requestId: ctx.requestId })
});
c.compliance.createEvidenceAsset({
  assetType: 'HASH_ONLY',
  name: 'artifact',
  hashAlgorithm: 'sha256',
  declaredHash: 'abc123',
}, { idempotencyKey: 'asset-1' });
c.compliance.getEvidenceAsset(1);
c.compliance.issueTimestamp({ hashAlgorithm: 'sha256', digest: 'abc123' }, { idempotencyKey: 'ts-1' });
c.compliance.waitForTimestampVerified(1);
c.compliance.getProviderRequest(1);
const _complianceScopes = complianceScopes();
const _complianceInfo = classifyComplianceError(new BusinessError(1031000013, 'step up'));
c.submitBugReport({});                // bug-report.ts
c.applyRequestSanitizers({} as any);  // sanitize-bridge.ts
// [W-RESET-CARD-WEEKLY-QUOTA-20260920 D-13] 订阅池的加油包三件套 —— 纯类型面加性字段。
// 这里是它们**唯一**能被编译器钉住的地方: 源码 tsconfig 的 include 只有 src/ (test/ 被显式
// exclude), 而 vitest 走 esbuild 只剥类型不做检查, 所以字段名写错一个字母时运行期断言照样全绿;
// 只有 consumer 视角对 packed .d.ts 的这一跳会红。同时顺带证明三个字段真的进了产物。
declare const _pool: QuotaSummarySubscriptionPool;
const _boosterRemaining: number | undefined = _pool.boosterRemaining;
const _boosterCount: number | undefined = _pool.boosterCount;
const _boosterNextExpiresAt: string | undefined = _pool.boosterNextExpiresAt;
void _boosterRemaining;
void _boosterCount;
void _boosterNextExpiresAt;
// ws.ts: 仅验证类型存在 (实际调用涉及 WebSocket 真连接, smoke 不跑)
const _wsConnect: typeof c.connect | undefined = undefined;
const _wsIsConnected: typeof c.isConnected | undefined = undefined;
void _wsConnect;
void _wsIsConnected;
void _complianceScopes;
void _complianceInfo;
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
  console.log('[smoke-pack] step 4/6 — tsc --noEmit (consumer 视角验证) ...');
  run(npxBin, ['tsc', '--noEmit'], tmpDir);

  // 6. 运行期加载: 每个代码入口 × 声明了的条件, 各起一个全新 node 进程用包名加载
  console.log('[smoke-pack] step 5/6 — node 运行期 import() / require() 每个 exports 代码入口 ...');
  writeFileSync(join(tmpDir, 'load-import.mjs'), loaderSource('await import(process.argv[2])'));
  writeFileSync(join(tmpDir, 'load-require.cjs'), loaderSource('require(process.argv[2])'));
  const loaders = [
    { condition: 'import', script: 'load-import.mjs' },
    { condition: 'require', script: 'load-require.cjs' },
  ];
  const loadFailures = [];
  for (const { subpath, conditions } of codeEntriesFromExports(pkgJson.exports)) {
    const specifier = subpath === '.' ? pkgName : `${pkgName}/${subpath.slice(2)}`;
    for (const { condition, script } of loaders) {
      if (!conditions.has(condition)) continue;
      const res = spawnSync(process.execPath, [script, specifier], {
        cwd: tmpDir,
        encoding: 'utf8',
        timeout: LOAD_TIMEOUT_MS,
      });
      const label = `${condition.padEnd(7)} ${specifier}`;
      if (!res.error && res.status === 0) {
        console.log(`[smoke-pack]   ✓ ${label}`);
        continue;
      }
      const outcome = res.error
        ? String(res.error.message)
        : `exit status ${res.status}${res.signal ? `, signal ${res.signal}` : ''}`;
      const detail = [outcome, (res.stderr || '').trim()].filter(Boolean).join('\n');
      console.error(`[smoke-pack]   ✗ ${label}\n${detail}`);
      loadFailures.push(label);
    }
  }
  if (loadFailures.length > 0) {
    throw new Error(`运行期加载失败 ${loadFailures.length} 项: ${loadFailures.join('; ')}`);
  }

  console.log('[smoke-pack] step 6/6 — ✓ PASS (consumer 视角 packed 产物可用)');
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
