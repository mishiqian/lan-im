/**
 * 调用授权：只有两道门——身份认证通过、授权（卡片开放调用 + 会话归属）通过。
 *
 * 不做「陌生人降级」：没验证就拒绝，验证了就按卡片声明的能力给，
 * 少一层规则就少一处能被绕过去的地方。
 */

export interface CallerIdentity {
  accountId: string
  /** 身份签名验证通过且与钉住的 keyId 一致 */
  verified: boolean
}

export interface TargetAgent {
  id: string
  authorAccountId: string
  /** 卡片 exposure.callable */
  callable: boolean
}

export interface AuthResult { ok: boolean; error?: string }

/** 能否对这个 agent 发起调用 */
export function authorizeCall(caller: CallerIdentity, target: TargetAgent | undefined): AuthResult {
  if (caller.accountId === '') {
    return { ok: false, error: '调用方身份缺失（连接没有完成握手）' }
  }
  if (!caller.verified) {
    return { ok: false, error: `@${caller.accountId} 的身份未通过验证，拒绝调用` }
  }
  if (target === undefined) {
    return { ok: false, error: '没有这个 agent' }
  }
  if (!target.callable) {
    return { ok: false, error: `@${target.authorAccountId} 没有开放调用` }
  }
  return { ok: true }
}

/** 能否操作某个已开的会话（只有开它的那个人可以继续驱动它） */
export function authorizeSessionControl(callerAccountId: string, sessionOwner: string | undefined): AuthResult {
  if (sessionOwner === undefined) {
    return { ok: false, error: '会话不存在或已关闭' }
  }
  if (callerAccountId === '' || callerAccountId !== sessionOwner) {
    return { ok: false, error: '这个会话不是你开的，无权操作' }
  }
  return { ok: true }
}
