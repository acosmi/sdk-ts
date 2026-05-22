// model-helpers.ts — ManagedModel catalog helpers (v1.2+)
//
// 目标 — 让 CrabCode / CrabClaw 等下游产品在做 desktop automation / computer-use 选模型时
// 完全依赖 SDK listModels 下发的 capabilities + inputModalities 字段, 杜绝任何
// 基于模型名 substring 的硬编码推断 (例如 "包含 vision 就当视觉模型").
//
// 红线:
//   1. 这里没有任何 model name match — 只读 ManagedModel 字段.
//   2. 缺失字段一律保守判负 — 缺 inputModalities 视为 "未声明", 不当 image-capable.
//   3. supports_desktop_visual_understanding 是 capability 矩阵字段, 与
//      inputModalities=['image'] 是正交两件事; 桌面 sidecar 选择必须两个条件同时满足.

import type { InputModality, ManagedModel } from './types';

/**
 * 判断 ManagedModel 是否声明支持指定输入模态.
 *
 * 语义:
 *   - model 为 null/undefined → false
 *   - model.inputModalities 缺失或非数组 → false (保守, 未声明不当支持)
 *   - 大小写敏感 (上游契约即小写 'text' | 'image')
 */
export function modelSupportsInputModality(
  model: ManagedModel | null | undefined,
  modality: InputModality,
): boolean {
  if (!model) return false;
  const mods = model.inputModalities;
  if (!Array.isArray(mods)) return false;
  return mods.includes(modality);
}

/** 等价 modelSupportsInputModality(model, 'image') — 调用方常见快捷判定. */
export function modelSupportsImageInput(model: ManagedModel | null | undefined): boolean {
  return modelSupportsInputModality(model, 'image');
}

/**
 * 在 catalog 中按 catalog 顺序查找首个支持指定模态的模型.
 *
 * 选择规则:
 *   1. isEnabled !== false (默认开, 显式 false 才剔除)
 *   2. inputModalities 包含指定模态
 *   3. 命中后按 catalog 顺序返回第一个; 未命中返 null
 *
 * 注意: 该 helper 不读 isDefault, 调用方需要 "默认优先" 请用
 * findDesktopVisualUnderstandingModel 或自行排序.
 */
export function findFirstModelByInputModality(
  models: ManagedModel[],
  modality: InputModality,
): ManagedModel | null {
  if (!Array.isArray(models)) return null;
  for (const m of models) {
    if (!m) continue;
    if (m.isEnabled === false) continue;
    if (!modelSupportsInputModality(m, modality)) continue;
    return m;
  }
  return null;
}

/**
 * 在 catalog 中选出最适合做 "桌面视觉理解 sidecar" 的模型.
 *
 * 设计目的: CrabCode desktop automation 链路里, 主模型不一定多模态;
 * 截图先送 sidecar 解析成结构化 UI 描述, 再喂主模型. 这里选 sidecar 模型
 * 严格走运营标注的 supports_desktop_visual_understanding capability, 不靠
 * 模型名猜.
 *
 * 选择规则 (按用户指定顺序):
 *   1. isEnabled !== false
 *   2. capabilities.supports_desktop_visual_understanding === true
 *   3. inputModalities 包含 'image' (必须真能吃图)
 *   4. 命中集合中优先 isDefault === true; 否则返回 catalog 顺序第一个
 *
 * 全部不满足返 null. 调用方收到 null 应:
 *   - 提示用户在管理后台/网关侧开启桌面视觉 sidecar 模型, 或
 *   - 降级停掉依赖截图的工作流, 而不是硬选一个非视觉模型送图.
 */
export function findDesktopVisualUnderstandingModel(
  models: ManagedModel[],
): ManagedModel | null {
  if (!Array.isArray(models)) return null;
  const candidates: ManagedModel[] = [];
  for (const m of models) {
    if (!m) continue;
    if (m.isEnabled === false) continue;
    if (m.capabilities?.supports_desktop_visual_understanding !== true) continue;
    if (!modelSupportsInputModality(m, 'image')) continue;
    candidates.push(m);
  }
  if (candidates.length === 0) return null;
  for (const m of candidates) {
    if (m.isDefault === true) return m;
  }
  return candidates[0];
}
