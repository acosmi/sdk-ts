// enduser.ts — v1.6.0 业务侧终端用户 id (endUserId) 公共工具
//
// 网关 sanitizer 仍会做权限校验 + 派生兜底; 此处仅负责 SDK 侧的基本约束:
//   - 正则: [a-zA-Z0-9_-]+ (与上游官方文档一致, 不含 ":" / "." 等隐式破坏字符)
//   - 长度: ≤ 512
//   - 禁止隐私信息: SDK 无从机械判定, 仅在 README / guide 提示, 不在代码做拦截
//
// 该 helper 暴露 validateEndUserId 公开 API, 方便 caller 在赋值前自校验,
// 避免请求被网关 sanitizer 静默丢弃。

/** maxEndUserIdLength 与上游 DeepSeek 官方文档对齐。 */
export const maxEndUserIdLength = 512;

/**
 * 检查 endUserId 是否符合规范 (字符集 + 长度)。
 * 空串视为合法 (表示未设置), 返回 null。
 *
 * 网关侧 sanitizer 在收到非空但校验失败的值时会 drop 并 metric, 不阻塞请求;
 * 但 caller 在自有业务侧拿到来源 (如 DB 内部 id) 后, 推荐先调用本函数明确语义。
 *
 * @returns 错误信息字符串, 或 null 表示合法
 */
export function validateEndUserId(s: string | undefined | null): string | null {
  if (!s) return null;
  if (s.length > maxEndUserIdLength) {
    return `endUserId length ${s.length} > ${maxEndUserIdLength}`;
  }
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ok =
      (c >= 0x61 && c <= 0x7a) || // a-z
      (c >= 0x41 && c <= 0x5a) || // A-Z
      (c >= 0x30 && c <= 0x39) || // 0-9
      c === 0x5f || // _
      c === 0x2d; // -
    if (!ok) {
      return `endUserId contains invalid char code 0x${c.toString(16)} at offset ${i} (allowed: [a-zA-Z0-9_-])`;
    }
  }
  return null;
}

/**
 * 识别 SSE 协议中的注释行 (":<text>"), 如 ": keep-alive"。
 *
 * 上游 (如 DeepSeek) 在开始推理前可能持续发送 SSE 注释作为保活;
 * 注释行不构成事件, SDK 解析器必须显式跳过, 否则未来若 else-branch 把
 * 未匹配行误送 JSON.parse 会回归出 parse error。
 *
 * 严格定义: 行的首字节是 ":". 不放宽允许行首空白 (SSE 规范不允许)。
 */
export function isSSECommentLine(line: string): boolean {
  return line.length > 0 && line.charCodeAt(0) === 0x3a; // ':'
}
