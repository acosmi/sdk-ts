// sanitize/config.ts — 端口自 acosmi-sdk-go/sanitize/config.go

import type { BlockType } from './types';

/**
 * SDK 层防御性配置。只做所有下游 provider 都不可能接受的底线剥除;
 * 具体 provider 适配由网关承担。
 *
 * 零值 = 不校验 / 不剥除, 等价于未启用。
 */
export interface MinimalSanitizeConfig {
  /** 体积上限 (字节, 仅对 base64 内联媒体生效; URL 版交网关把关). 0 = 不校验. */
  maxImageBytes?: number;
  maxVideoBytes?: number;
  maxPDFBytes?: number;

  /** history 轮次硬上限 (防止内存爆炸 / 上行带宽). 0 = 不校验. 超限抛 ErrHistoryTooDeep. */
  maxMessagesTurns?: number;

  /** 公共黑名单 (所有 provider 均拒绝的 block 类型). 默认空. */
  permanentDenyBlocks?: BlockType[];
}

export class HistoryTooDeepError extends Error {
  constructor() {
    super('sanitize: messages history exceeds configured depth');
    this.name = 'HistoryTooDeepError';
  }
}

export class BlockDeniedError extends Error {
  constructor() {
    super('sanitize: block type permanently denied');
    this.name = 'BlockDeniedError';
  }
}

/** 体积超限错误, 携带实际/上限字节数以便上游展示。 */
export class SizeError extends Error {
  blockType: BlockType;
  actual: number;
  limit: number;

  constructor(blockType: BlockType, actual: number, limit: number) {
    super(`sanitize: ${blockType} base64 size ${actual} exceeds limit ${limit}`);
    this.name = 'SizeError';
    this.blockType = blockType;
    this.actual = actual;
    this.limit = limit;
  }
}

// 单例实例 — 与 Go 侧 var ErrHistoryTooDeep / ErrBlockDenied 等价的"哨兵"用法
// 但 TS class 实例不能 const 哨兵化, 调用方应用 instanceof 判断。
export const ErrHistoryTooDeep = new HistoryTooDeepError();
export const ErrBlockDenied = new BlockDeniedError();
