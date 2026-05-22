// support/index.ts — 支持 / 反馈域 barrel
//
// bug-report.ts 既被 side-effect import (注入 submitBugReport 等到 Client.prototype)
// 又导出 BugReportResult / BugView 类型。

// === 业务方法 — side-effect import 注入到 Client.prototype ===
import './bug-report';

export type { BugReportResult, BugView } from './bug-report';
