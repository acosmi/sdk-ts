// 端口自 acosmi-sdk-go/scopes.go 关键常量
import { describe, it, expect } from 'vitest';
import {
  allScopes,
  modelScopes,
  commerceScopes,
  skillScopes,
  ScopeAI,
  ScopeSkills,
  ScopeAccount,
} from '../src/scopes';

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
});
