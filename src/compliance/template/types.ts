// compliance/template/types.ts — SDK-safe 合同模板公共领域类型。
//
// 设计原则见 compliance/evidence/types.ts 顶部说明。对应后端 compliance gateway
// S5（合并 G5 契约）。模板生命周期：DRAFT → 上传 PDF → 编辑字段 → publish 进入
// PUBLISHED；可 archive 进入 ARCHIVED；删除只允许在 DRAFT 状态。

import type { PageRequest } from '../../shared/pagination';

// =============================================================================
// Field overlay
// =============================================================================

/** 模板上的可填充字段类型：签名 / 印章 / 文本 / 日期 / 勾选。 */
export type ContractTemplateFieldType = 'signature' | 'seal' | 'text' | 'date' | 'check';

/**
 * 模板字段叠加项。一个模板包含一组字段——签名 / 印章 / 文本 / 日期 / 勾选——
 * 字段在 PDF 上的位置以 `page`（页码）+ `x`/`y`/`width`/`height`（坐标 / 尺寸）
 * 描述。SDK 不在客户端做几何 / 坐标系校验，原样透传给后端。
 */
export interface ContractTemplateField {
  /** 字段稳定 key，调用方业务侧自定。 */
  key: string;
  /** 字段类型。 */
  type: ContractTemplateFieldType;
  /** 字段在 UI 上展示的标签。 */
  label: string;
  /** PDF 页码（1-based 或调用方约定，SDK 原样透传）。 */
  page: number;
  /** PDF 坐标系横坐标。 */
  x: number;
  /** PDF 坐标系纵坐标。 */
  y: number;
  /** 字段宽度。 */
  width: number;
  /** 字段高度。 */
  height: number;
  /** 字段绑定的角色（签署人角色 key，可选）。 */
  assignedRole?: string;
  /** 字段在模板内的排序键。 */
  order: number;
  /** 是否为必填字段。 */
  required: boolean;
}

// =============================================================================
// Template
// =============================================================================

/** 模板状态。DRAFT 可编辑 / 删除 / 上传 PDF / publish；PUBLISHED / ARCHIVED 只读。 */
export type ContractTemplateStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

/**
 * 合同模板详情。对应后端 G5 `ContractTemplateResp`。
 *
 * - `pdfHash` / `pdfPageCount` 在【上传 PDF】之后才有值。
 * - `currentVersion` 记录【已发布】版本号；DRAFT 阶段为 0。
 * - `fields` 是【当前编辑中】的字段叠加快照——publish 时会同步固化进版本表。
 * - 时间字段 `createTime` 为 ISO-8601 字符串。
 */
export interface ContractTemplateResp {
  id: number;
  /** 模板编号（业务编号，区别于数值主键 `id`）。 */
  templateNo: string;
  name: string;
  description?: string | null;
  status: ContractTemplateStatus;
  /** 已上传 PDF 的哈希；未上传时缺省。 */
  pdfHash?: string | null;
  /** 已上传 PDF 的页数；未上传时缺省。 */
  pdfPageCount?: number | null;
  fields: ContractTemplateField[];
  /** 已发布版本号；DRAFT 阶段为 0。 */
  currentVersion: number;
  /** 创建时间 ISO-8601。 */
  createTime: string;
}

/**
 * 合同模板分页【列表项】视图。对应后端 G5 `ContractTemplatePageItem`。
 *
 * 与 {@link ContractTemplateResp} 一致的 SDK-safe 子集，**不含 `fields`**——
 * 字段叠加只在详情 / 版本快照里返回，分页列表不下发，避免大对象 N+1。
 */
export interface ContractTemplatePageItem {
  id: number;
  templateNo: string;
  name: string;
  description?: string | null;
  status: ContractTemplateStatus;
  pdfHash?: string | null;
  pdfPageCount?: number | null;
  currentVersion: number;
  /** 创建时间 ISO-8601。 */
  createTime: string;
}

/**
 * 合同模板版本快照。对应后端 G5 `ContractTemplateVersion`。
 *
 * 每次 publish 会落一个版本快照，记录当时的 `name` / `pdfHash` / `fields` /
 * `statusAtSnapshot`（publish 时模板的状态字面量）。版本是【不可变】的离线复核
 * 依据。
 */
export interface ContractTemplateVersion {
  id: number;
  templateId: number;
  version: number;
  name: string;
  pdfHash?: string | null;
  fields: ContractTemplateField[];
  /** publish 时模板状态的字面量快照。 */
  statusAtSnapshot: string;
  /** 创建时间 ISO-8601。 */
  createTime: string;
}

// =============================================================================
// Requests
// =============================================================================

/**
 * 创建合同模板请求。`fields` 可选——通常先在 DRAFT 状态创建模板、再上传 PDF、
 * 然后再单独 `updateContractTemplate` 设置 / 调整字段叠加。
 */
export interface CreateContractTemplateRequest {
  name: string;
  description?: string;
  fields?: ContractTemplateField[];
}

/**
 * 更新合同模板请求。仅 DRAFT 状态下允许调用——服务端在 PUBLISHED / ARCHIVED
 * 状态下会拒绝更新。所有字段可选，缺省的字段视为【不修改】。
 */
export interface UpdateContractTemplateRequest {
  name?: string;
  description?: string;
  fields?: ContractTemplateField[];
}

/**
 * 上传模板 PDF 请求。`pdfBase64` 为 base64 编码的 PDF 原文；SDK 不在客户端做
 * PDF 解析 / 几何校验。
 */
export interface UploadContractTemplatePdfRequest {
  /** base64 编码的 PDF 原文。 */
  pdfBase64: string;
}

/**
 * `listContractTemplates` 请求参数。
 *
 * 继承 {@link PageRequest} 分页 / 排序字段；全部可选。`createTimeStart` /
 * `createTimeEnd` 为调用方提供的【原样字符串】，后端按 `yyyy-MM-dd HH:mm:ss`
 * 解析；SDK 不做格式校验或时区转换。
 */
export interface ListContractTemplatesRequest extends PageRequest {
  /** 模板状态过滤。 */
  status?: ContractTemplateStatus | string;
  /** 创建时间下界，`yyyy-MM-dd HH:mm:ss`。 */
  createTimeStart?: string;
  /** 创建时间上界，`yyyy-MM-dd HH:mm:ss`。 */
  createTimeEnd?: string;
}
