/**
 * 远端会话托管：把「别人调用我的 agent」映射成一个真实的 DSH session。
 *
 * 复用现成的 agent loop，不新造循环：
 *   open  → agentLoop.createAgent（可指定 preset）→ 得到 Agent
 *   send  → followup(UserMessage) → whenIdle → 从会话日志里取这一轮的回复
 *   close → handle.dispose()
 *
 * 会话日志是唯一事实源：回复从 `session.snapshotEvents()` 里读，不另外记一份。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { HostRuntime } from './runtime.ts'
import { CapabilitySet, SessionBudget, decideToolCall } from './capability.ts'
import type { AgentToolGrant } from '../protocol.ts'

import type { RemoteSessionRecord } from '../protocol.ts'
export type { RemoteSessionRecord }

interface LiveSession {
  record: RemoteSessionRecord
  agent: any
  dispose: () => Promise<void>
  budget: SessionBudget
  caps: CapabilitySet
}

export interface OpenInput {
  /** 复活历史会话时沿用原 id，调用方不需要知道会话换过 */
  remoteId?: string
  callerId: string
  agentKey: string
  preset?: string
  /** 模型路由：不指定时用宿主默认 */
  provider?: string
  model?: string
  /** 作者的角色设定：注册成该 agent 作用域的 prompt section */
  prompt?: string
  tools?: AgentToolGrant[]
  budget?: { turns?: number; tokens?: number; seconds?: number }
}

export interface OpenResult { ok: boolean; sessionId?: string; error?: string }
export interface SendResult { ok: boolean; text?: string; error?: string; turns?: number }

/** 从 SessionEvent 里抽出可读文本 */
function textOf(message: any): string {
  const blocks = Array.isArray(message?.content) ? message.content : []
  return blocks.filter((b: any) => b?.type === 'text').map((b: any) => String(b.text ?? '')).join('').trim()
}

export class AgentService {
  private readonly live = new Map<string, LiveSession>()
  private readonly history: RemoteSessionRecord[] = []
  private get file(): string { return join(this.runtime.storage.dataDir(), 'agent-sessions.json') }

  constructor(private readonly runtime: HostRuntime) {}

  /** 启动时恢复历史（会话日志由 DSH 持久化，这里只存作者侧可见的摘要） */
  async load(): Promise<void> {
    if (!existsSync(this.file)) return
    try {
      const rows = JSON.parse(await readFile(this.file, 'utf8')) as RemoteSessionRecord[]
      for (const row of rows) {
        if (row === null || typeof row.remoteId !== 'string') continue
        // 进程已经没了，上次留下的 active 记录不可能还活着
        this.history.push(row.status === 'active' ? { ...row, status: 'closed' } : row)
      }
    } catch { /* 坏文件当空处理 */ }
  }

  private async persist(): Promise<void> {
    try {
      const all = [...this.live.values()].map((s) => s.record).concat(this.history)
      await mkdir(this.runtime.storage.dataDir(), { recursive: true })
      await writeFile(this.file, `${JSON.stringify(all, null, 2)}\n`, 'utf8')
    } catch { /* 落盘失败不影响调用 */ }
  }

  list(): RemoteSessionRecord[] {
    return [...this.live.values()].map((s) => s.record).concat(this.history)
  }

  get(remoteId: string): RemoteSessionRecord | undefined {
    return this.live.get(remoteId)?.record ?? this.history.find((r) => r.remoteId === remoteId)
  }

  async open(input: OpenInput): Promise<OpenResult> {
    const ctx = this.runtime.ctx
    if (ctx === undefined) return { ok: false, error: '宿主上下文不可用' }
    const loop = typeof ctx.get === 'function' ? ctx.get('agentLoop') : undefined
    if (loop === undefined || typeof loop.createAgent !== 'function') {
      return { ok: false, error: '本机没有 agentLoop 服务，无法托管会话' }
    }

    const remoteId = input.remoteId ?? `s-${randomUUID()}`
    const dshSessionId = `lanim-${randomUUID()}`
    const root = join(this.runtime.storage.dataDir(), 'agent-share', input.agentKey.replace(/[^a-zA-Z0-9._-]/g, '_'), remoteId)
    try {
      await mkdir(root, { recursive: true })
    } catch (err: any) {
      return { ok: false, error: `创建工作目录失败：${err?.message ?? err}` }
    }

    const caps = new CapabilitySet(input.tools ?? [], root)
    const budgetLimits = {
      turns: input.budget?.turns ?? 30,
      tokens: input.budget?.tokens ?? 60000,
      seconds: input.budget?.seconds ?? 1800,
    }
    try {
      const presets = typeof ctx.get === 'function' ? ctx.get('agentPresets') : undefined
      const wantsPreset = input.preset !== undefined && input.preset !== ''
      const loopOptions: Record<string, unknown> = {}
      if (input.provider !== undefined && input.provider !== '') loopOptions.provider = input.provider
      if (input.model !== undefined && input.model !== '') loopOptions.model = input.model
      const authorPrompt = (input.prompt ?? '').trim()
      const handle = await loop.createAgent(ctx, {
        sessionId: dshSessionId,
        ...(Object.keys(loopOptions).length === 0 ? {} : { agentOptions: loopOptions }),
        meta: { cwd: root },
        // 身份绑定与能力闸都在 setup 里做：mount / section / on 都接受「尚未发布的 agent 上下文」
        setup: async (agentCtx: any) => {
          // 能力包络四道闸：挂在该 agent 作用域的 tools/pre-execute 上
          if (typeof agentCtx.on === 'function') {
            agentCtx.on('tools/pre-execute', async (exec: any, next: () => Promise<any>) => {
              const toolName = String(exec?.name ?? exec?.tool?.name ?? '')
              const args = (exec?.arguments ?? exec?.args ?? {}) as Record<string, unknown>
              const verdict = decideToolCall(caps, toolName, args)
              if (verdict.decision === 'allow') return next()
              if (verdict.decision === 'ask') return { kind: 'ask', reason: verdict.reason }
              this.runtime.clients.logEvent(`拦截工具调用 ${toolName}：${verdict.reason}`)
              return { kind: 'deny', reason: verdict.reason }
            })
          }
          {
                if (wantsPreset && presets !== undefined && typeof presets.mount === 'function') {
                  await presets.mount(agentCtx, input.preset)
                }
                if (authorPrompt !== '') {
                  const sp = typeof agentCtx.get === 'function' ? agentCtx.get('systemPrompt') : undefined
                  if (sp !== undefined && typeof sp.section === 'function') {
                    let order = 100
                    try {
                      const resolved = sp.getSectionOrder?.('persona-prefix')
                      if (typeof resolved === 'number') order = resolved
                    } catch { /* 用默认 order */ }
                    sp.section({ name: 'lanim:agent-persona', order, text: authorPrompt })
                  }
                }
          }
        },
      })
      const record: RemoteSessionRecord = {
        remoteId, dshSessionId, agentKey: input.agentKey, preset: input.preset ?? '',
        callerId: input.callerId, createdAt: Date.now(), lastActive: Date.now(),
        status: 'active', turns: 0, tokens: 0,
      }
      this.live.set(remoteId, {
        record,
        agent: handle.agent,
        dispose: () => handle.dispose(),
        budget: new SessionBudget(budgetLimits),
        caps: new CapabilitySet(input.tools ?? [], root),
      })
      this.runtime.clients.logEvent(`远端会话已开：${input.callerId} → ${input.agentKey}（${remoteId.slice(0, 8)}）`)
      void this.persist()
      this.runtime.clients.sessions(this.list())
      return { ok: true, sessionId: remoteId }
    } catch (err: any) {
      return { ok: false, error: `创建会话失败：${err?.message ?? err}` }
    }
  }

  async send(remoteId: string, text: string): Promise<SendResult> {
    let live = this.live.get(remoteId)
    if (live === undefined) {
      // 宿主重启或被断开后，旧 id 只在历史里；按记录把会话复活，调用方无感
      const revived = await this.revive(remoteId)
      if (revived === undefined) return { ok: false, error: '会话不存在或已关闭' }
      live = revived
    }

    const budgetCheck = live.budget.beginTurn()
    if (budgetCheck.decision === 'deny') return { ok: false, error: budgetCheck.reason }

    const agent = live.agent
    const before = typeof agent?.session?.seq === 'number' ? agent.session.seq : 0
    const message = {
      id: randomUUID(),
      role: 'user' as const,
      content: [{ type: 'text' as const, text }],
      source: { kind: 'user' as const },
    }

    try {
      agent.followup(message)
      // whenIdle 在「回合还没开始」时会立刻返回，必须等到本轮真正结束
      const deadline = Date.now() + 120_000
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 150))
        const seen = typeof agent?.session?.snapshotEvents === 'function'
          ? agent.session.snapshotEvents(before, agent.session.seq)
          : []
        if (seen.some((e: any) => e?.type === 'turn/end')) break
        if (typeof agent?.session?.seq === 'number' && agent.session.seq === before) continue
      }
      await agent.whenIdle()
    } catch (err: any) {
      return { ok: false, error: `执行失败：${err?.message ?? err}` }
    }

    const events = typeof agent?.session?.snapshotEvents === 'function'
      ? agent.session.snapshotEvents(before, agent.session.seq)
      : []
    let reply = ''
    let tokens = 0
    let endReason = ''
    for (const event of events) {
      if (event?.type === 'turn/end') {
        const reason = event.data?.reason
        endReason = typeof reason?.kind === 'string' ? reason.kind : ''
        if (endReason === 'error') {
          const failure = reason?.error
          endReason = `error: ${failure?.message ?? failure?.kind ?? '模型调用失败'}`
        }
      }
      if (event?.type === 'assistant/message') {
        const piece = textOf(event.data?.message)
        if (piece !== '') reply = piece
        const usage = event.data?.usage
        if (usage !== undefined && typeof usage.totalTokens === 'number') tokens += usage.totalTokens
      }
    }

    live.record.turns += 1
    live.record.tokens += tokens
    void this.persist()
    live.record.lastActive = Date.now()
    const tokenCheck = live.budget.addTokens(tokens)
    const result: SendResult = {
      ok: reply !== '',
      text: reply,
      turns: live.record.turns,
      ...(reply === ''
        ? { error: tokenCheck.decision === 'deny' ? tokenCheck.reason : `这一轮没有产生文本回复${endReason === '' ? '' : `（${endReason}）`}` }
        : {}),
    }
    return result
  }

  /** 用历史记录把会话复活到同一个 remoteId 上 */
  private async revive(remoteId: string): Promise<LiveSession | undefined> {
    const rec = this.history.find((r) => r.remoteId === remoteId)
    if (rec === undefined) return undefined
    const entry = this.runtime.agents.list().find((e) => `${e.card.author.accountId}/${e.card.id}` === rec.agentKey)
    if (entry === undefined) return undefined
    const card = entry.card
    const base = {
      remoteId,
      callerId: rec.callerId,
      agentKey: rec.agentKey,
      prompt: card.prompt,
      tools: card.requires.tools,
      budget: card.requires.budget,
    }
    // 先按原 preset 试；preset 没注册就退回会话级 prompt
    let opened = rec.preset === '' ? await this.open(base) : await this.open({ ...base, preset: rec.preset })
    if (opened.ok !== true) opened = await this.open(base)
    if (opened.ok !== true) return undefined
    const live = this.live.get(remoteId)
    if (live !== undefined) {
      live.record.turns = rec.turns
      live.record.tokens = rec.tokens
      live.record.createdAt = rec.createdAt
      void this.persist()
    }
    this.runtime.clients.logEvent(`会话已复活：${remoteId.slice(0, 8)}（${rec.agentKey} ← @${rec.callerId}）`)
    return live
  }

  async close(remoteId: string): Promise<boolean> {
    const live = this.live.get(remoteId)
    if (live === undefined) return false
    live.record.status = 'closed'
    this.history.push({ ...live.record })
    this.live.delete(remoteId)
    try {
      await live.dispose()
    } catch { /* 已释放 */ }
    this.runtime.clients.logEvent(`远端会话已关：${remoteId.slice(0, 8)}（${live.record.turns} 轮 / ${live.record.tokens} token）`)
    void this.persist()
    this.runtime.clients.sessions(this.list())
    return true
  }

  async closeAll(): Promise<void> {
    for (const id of [...this.live.keys()]) await this.close(id)
  }
}
