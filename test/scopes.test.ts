// 端口自 acosmi-sdk-go/scopes.go 关键常量
import { describe, it, expect } from 'vitest';
import {
  allScopes,
  modelScopes,
  commerceScopes,
  skillScopes,
  remoteControlScopes,
  ScopeAI,
  ScopeSkills,
  ScopeAccount,
  ScopeRemoteControl,
  ScopeRemoteControlAgentRun,
  ScopeRemoteControlSessionControl,
  ScopeRemoteControlPermissionResponse,
} from '../src/auth/scopes';

describe('scopes', () => {
  it('allScopes = 三个分组 scope', () => {
    expect(allScopes()).toEqual([ScopeAI, ScopeSkills, ScopeAccount]);
  });

  it('modelScopes 仅含 AI', () => {
    expect(modelScopes()).toEqual([ScopeAI]);
  });

  it('commerceScopes 含 AI + Account', () => {
    expect(commerceScopes()).toEqual([ScopeAI, ScopeAccount]);
  });

  it('skillScopes 仅含 Skills', () => {
    expect(skillScopes()).toEqual([ScopeSkills]);
  });

  it('allScopes 返回新切片, 修改不影响内部', () => {
    const a = allScopes();
    a.push('foo');
    expect(allScopes()).toEqual([ScopeAI, ScopeSkills, ScopeAccount]);
  });

  // ---------------------------------------------------------------------------
  // Phase 4 远程控制 scope (契约 §6 #1 红线)
  // ---------------------------------------------------------------------------

  it('Phase 4: remoteControlScopes 仅含分组 ScopeRemoteControl', () => {
    expect(remoteControlScopes()).toEqual([ScopeRemoteControl]);
  });

  it('Phase 4: ScopeRemoteControl 字面量 === "remote_control"', () => {
    expect(ScopeRemoteControl).toBe('remote_control');
  });

  it('Phase 4: 3 个子 scope 常量字面量正确', () => {
    expect(ScopeRemoteControlAgentRun).toBe('remote_control:agent-run');
    expect(ScopeRemoteControlSessionControl).toBe('remote_control:session-control');
    expect(ScopeRemoteControlPermissionResponse).toBe('remote_control:permission-response');
  });

  it('Phase 4 红线: allScopes 不包含 remote_control (桌面登录不自动获权)', () => {
    const list = allScopes();
    expect(list).not.toContain(ScopeRemoteControl);
    expect(list).not.toContain(ScopeRemoteControlAgentRun);
    expect(list).not.toContain(ScopeRemoteControlSessionControl);
    expect(list).not.toContain(ScopeRemoteControlPermissionResponse);
  });
});
