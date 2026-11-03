/**
 * 能力包络：把「卡片声明的工具」变成可以逐次判定的闸。
 *
 * 设计约束（PRD F5）：
 * - 判定必须在执行层，不能只写提示词；
 * - 四道闸：工具白名单 → 参数范围 → 审批 → 预算；
 * - 路径判定要穿过 realpath（防符号链接逃逸）；
 * - 命令判定里 deny 优先于 allow，并且默认拒绝 shell 控制符（否则 `ls; rm -rf /` 会溜过去）。
 *
 * 本模块只做纯判定，不做 IO 执行，方便单测与复用。
 */
import { existsSync, realpathSync } from 'node:fs'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'
import type { AgentToolGrant } from '../protocol.ts'

export type Decision = 'allow' | 'deny' | 'ask'

export interface Verdict {
  decision: Decision
  /** 给审计与调用方看的理由；allow 时为简短说明 */
  reason: string
}

const allow = (reason: string): Verdict => ({ decision: 'allow', reason })
const deny = (reason: string): Verdict => ({ decision: 'deny', reason })

/** bash 里能改变执行流的字符；不拦就等于 allow 形同虚设 */
const SHELL_CONTROL = /[;&|\n\r`$><]|\$\(/

/** scope → 规范化前缀；`share/**` 等价于前缀 `share/` */
function scopePrefix(scope: string): string {
  const s = scope.trim().replace(/\\/g, '/')
  const trimmed = s.endsWith('/**') ? s.slice(0, -3) : s.endsWith('/*') ? s.slice(0, -2) : s
  return trimmed.replace(/^\.\//, '').replace(/\/+$/, '')
}

export class CapabilitySet {
  private readonly grants = new Map<string, AgentToolGrant>()

  constructor(grants: AgentToolGrant[], private readonly agentRoot: string) {
    for (const grant of grants) this.grants.set(grant.name, grant)
  }

  names(): string[] {
    return [...this.grants.keys()]
  }

  /** 第一道闸：这个工具在不在包络里 */
  checkTool(name: string): Verdict {
    return this.grants.has(name) ? allow('工具已授权') : deny(`工具 ${name} 不在这个 agent 的能力包络里`)
  }

  /** 第二道闸（fs）：路径必须落在 scope 内，且穿过 realpath 之后仍在里面 */
  checkPath(name: 'fs.read' | 'fs.write', target: string): Verdict {
    const toolVerdict = this.checkTool(name)
    if (toolVerdict.decision !== 'allow') return toolVerdict

    const grant = this.grants.get(name)
    const scope = grant?.scope
    if (scope === undefined) return deny(`${name} 没有声明 scope`)

    if (isAbsolute(target)) return deny('不接受绝对路径')
    if (target.split(/[\\/]/).some((seg) => seg === '..')) return deny('路径里不能有 ..')

    const prefix = scopePrefix(scope)
    const normalizedTarget = normalize(target).replace(/\\/g, '/')
    if (normalizedTarget !== prefix && !normalizedTarget.startsWith(`${prefix}/`)) {
      return deny(`路径 ${target} 超出授权范围 ${scope}`)
    }

    const rootReal = existsSync(this.agentRoot) ? realpathSync(this.agentRoot) : resolve(this.agentRoot)
    const abs = join(rootReal, normalizedTarget)
    const real = existsSync(abs) ? realpathSync(abs) : normalize(abs)
    if (real !== rootReal && !real.startsWith(`${rootReal}${sep}`)) {
      return deny('路径解析后落在授权目录之外（可能是符号链接逃逸）')
    }
    return allow(`在 ${scope} 内`)
  }

  /** 第二道闸（bash）：allow 前缀命中、deny 优先、控制符一律拒 */
  checkCommand(command: string): Verdict {
    const toolVerdict = this.checkTool('bash')
    if (toolVerdict.decision !== 'allow') return toolVerdict

    const grant = this.grants.get('bash')
    const cmd = command.trim()
    if (cmd === '') return deny('空命令')
    if (SHELL_CONTROL.test(cmd)) return deny('命令包含管道/重定向/命令替换等控制符，需人工确认')
    if (cmd.includes('..')) return deny('命令里出现 ..，需人工确认')

    for (const blocked of grant?.deny ?? []) {
      if (blocked !== '' && cmd.startsWith(blocked.trim())) return deny(`命令命中禁止前缀「${blocked}」`)
    }
    const allowList = grant?.allow ?? []
    if (allowList.length === 0) return deny('bash 未声明 allow 白名单')
    for (const item of allowList) {
      if (item !== '' && cmd.startsWith(item.trim())) return allow(`命中允许前缀「${item}」`)
    }
    return deny('命令不在允许前缀里')
  }

  /** 第二道闸（web.fetch）：按域名后缀匹配 */
  checkDomain(url: string): Verdict {
    const toolVerdict = this.checkTool('web.fetch')
    if (toolVerdict.decision !== 'allow') return toolVerdict

    let host: string
    try {
      host = new URL(url).hostname.toLowerCase()
    } catch {
      return deny('URL 解析失败')
    }
    const patterns = this.grants.get('web.fetch')?.allow ?? []
    if (patterns.length === 0) return deny('web.fetch 未声明允许域名')
    for (const raw of patterns) {
      const pattern = raw.trim().toLowerCase().replace(/^\*\./, '')
      if (pattern === '') continue
      if (host === pattern || host.endsWith(`.${pattern}`)) return allow(`域名在允许列表（${raw}）`)
    }
    return deny(`域名 ${host} 不在允许列表`)
  }
}

export interface BudgetLimits { turns: number; tokens: number; seconds: number }

export interface BudgetSnapshot { turns: number; tokens: number; seconds: number }

/** 第三/四道闸：会话预算；超限返回 deny，调用方据此中止回合 */
export class SessionBudget {
  private turns = 0
  private tokens = 0
  private readonly startedAt = Date.now()

  constructor(private readonly limits: BudgetLimits) {}

  snapshot(): BudgetSnapshot {
    return { turns: this.turns, tokens: this.tokens, seconds: Math.round((Date.now() - this.startedAt) / 1000) }
  }

  remaining(): BudgetSnapshot {
    const snap = this.snapshot()
    return {
      turns: Math.max(0, this.limits.turns - snap.turns),
      tokens: Math.max(0, this.limits.tokens - snap.tokens),
      seconds: Math.max(0, this.limits.seconds - snap.seconds),
    }
  }

  /** 回合开始前调用 */
  beginTurn(): Verdict {
    const left = this.remaining()
    if (left.turns <= 0) return deny(`本会话轮数已用尽（${this.limits.turns}）`)
    if (left.seconds <= 0) return deny(`本会话时长已用尽（${this.limits.seconds}s）`)
    this.turns += 1
    return allow(`剩余 ${left.turns - 1} 轮`)
  }

  /** 回合结束后记账 */
  addTokens(tokens: number): Verdict {
    this.tokens += Math.max(0, Math.round(tokens))
    const left = this.remaining()
    return left.tokens > 0 ? allow(`剩余 ${left.tokens} token`) : deny(`本会话 token 已用尽（${this.limits.tokens}）`)
  }
}
