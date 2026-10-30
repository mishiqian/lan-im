/**
 * Agent 集市面板（M0）：看我发布的、看别人发布的、发布、安装、卸载。
 *
 * 只做视图与表单；网络请求由 App 传进来的回调完成，错误也由 App 统一展示。
 */
import * as React from 'react'
import type { AgentCard, AgentEntry, AgentToolGrant } from '../protocol.ts'
import { Icon, LanImMark } from './components.ts'

export interface PublishInput {
  id: string
  name: string
  summary: string
  inputHint: string
  tools: AgentToolGrant[]
  cloneable: boolean
  callable: boolean
  sampleIn: string
  sampleOut: string
}

export interface AgentPanelProps {
  entries: AgentEntry[]
  selfAccount: string
  busy: boolean
  onPublish: (input: PublishInput) => void
  onInstall: (entry: AgentEntry) => void
  onUninstall: (entry: AgentEntry) => void
  onClose: () => void
}

const hashShort = (card: AgentCard): string => (card.integrity?.sha256 ?? '').slice(0, 12)

function toolLabel(grant: AgentToolGrant): string {
  if (grant.scope !== undefined) return `${grant.name} · ${grant.scope}`
  if (grant.allow !== undefined && grant.allow.length > 0) return `${grant.name} · ${grant.allow.join(' / ')}`
  return grant.name
}

/** 卡片行 */
function AgentRow(props: { entry: AgentEntry; onOpen: () => void }): React.ReactElement {
  const { card } = props.entry
  return React.createElement('button', { className: 'lim-agent-row', onClick: props.onOpen },
    React.createElement('span', { className: 'lim-agent-row-main' },
      React.createElement('span', { className: 'lim-agent-name' }, card.name),
      React.createElement('span', { className: 'lim-agent-ver' }, `v${card.version}`),
      React.createElement('span', { className: 'lim-agent-author' }, `@${card.author.accountId}`),
    ),
    React.createElement('span', { className: 'lim-agent-summary' }, card.summary),
    React.createElement('span', { className: 'lim-agent-tags' },
      props.entry.source === 'mine'
        ? React.createElement('span', { className: 'lim-chip lim-chip-own' }, '我发布的')
        : props.entry.installed
          ? React.createElement('span', { className: 'lim-chip lim-chip-on' }, `已安装 ${props.entry.installedVersion ?? ''}`)
          : React.createElement('span', { className: 'lim-chip' }, '未安装'),
      card.exposure.callable ? React.createElement('span', { className: 'lim-chip' }, '可调用') : null,
    ),
  )
}

/** 详情弹层：安装前看到的就是这些 */
function AgentDetail(props: {
  entry: AgentEntry
  busy: boolean
  onClose: () => void
  onInstall: () => void
  onUninstall: () => void
}): React.ReactElement {
  const { card } = props.entry
  return React.createElement('div', { className: 'lim-modal', onClick: props.onClose },
    React.createElement('div', { className: 'lim-modal-box wide lim-agent-detail', onClick: (e: any) => e.stopPropagation() },
      React.createElement('div', { className: 'lim-agent-detail-head' },
        React.createElement(LanImMark, { size: 28, tile: '#0891B2' }),
        React.createElement('div', { className: 'lim-agent-detail-title' },
          React.createElement('div', { className: 'lim-setup-title' }, card.name),
          React.createElement('div', { className: 'lim-setup-hint' }, `@${card.author.accountId} · v${card.version} · 哈希 ${hashShort(card)}`),
        ),
      ),
      React.createElement('div', { className: 'lim-setup-hint' }, card.summary),

      React.createElement('div', { className: 'lim-agent-block-title' }, '需要的能力'),
      card.requires.tools.length === 0
        ? React.createElement('div', { className: 'lim-setup-hint' }, '不使用工具，只做文本推理')
        : React.createElement('div', { className: 'lim-agent-tags' },
            card.requires.tools.map((grant) => React.createElement('span', { key: grant.name, className: 'lim-chip' }, toolLabel(grant))),
          ),

      React.createElement('div', { className: 'lim-agent-block-title' }, '样例'),
      card.samples.map((s, i) => React.createElement('div', { key: i, className: 'lim-sample' },
        React.createElement('div', { className: 'lim-sample-label' }, '输入'),
        React.createElement('div', { className: 'lim-sample-body' }, s.in),
        React.createElement('div', { className: 'lim-sample-label' }, '输出'),
        React.createElement('div', { className: 'lim-sample-body' }, s.out),
      )),

      React.createElement('div', { className: 'lim-agent-detail-actions' },
        props.entry.installed
          ? React.createElement('button', { className: 'lim-send ghost', disabled: props.busy, onClick: props.onUninstall }, '卸载')
          : React.createElement('button', { className: 'lim-send', disabled: props.busy, onClick: props.onInstall }, '安装到本机'),
        React.createElement('button', { className: 'lim-send ghost', onClick: props.onClose }, '关闭'),
      ),
    ),
  )
}

/** 发布弹层：M0 只填骨架，具体 preset 正文装完再改 */
function PublishForm(props: {
  busy: boolean
  selfAccount: string
  onClose: () => void
  onSubmit: (input: PublishInput) => void
}): React.ReactElement {
  const [id, setId] = React.useState('')
  const [name, setName] = React.useState('')
  const [summary, setSummary] = React.useState('')
  const [inputHint, setInputHint] = React.useState('')
  const [sampleIn, setSampleIn] = React.useState('')
  const [sampleOut, setSampleOut] = React.useState('')
  const [readScope, setReadScope] = React.useState('share/**')
  const [useFsRead, setUseFsRead] = React.useState(false)
  const [useBash, setUseBash] = React.useState(false)
  const [bashAllow, setBashAllow] = React.useState('git log, rg ')
  const [cloneable, setCloneable] = React.useState(true)
  const [callable, setCallable] = React.useState(false)

  const submit = (): void => {
    const tools: AgentToolGrant[] = []
    if (useFsRead) tools.push({ name: 'fs.read', scope: readScope.trim() || 'share/**' })
    if (useBash) tools.push({ name: 'bash', allow: bashAllow.split(',').map((s) => s.trim()).filter(Boolean) })
    props.onSubmit({
      id: id.trim(), name: name.trim(), summary: summary.trim(), inputHint: inputHint.trim(),
      tools, cloneable, callable, sampleIn: sampleIn.trim(), sampleOut: sampleOut.trim(),
    })
  }

  return React.createElement('div', { className: 'lim-modal', onClick: props.onClose },
    React.createElement('div', { className: 'lim-modal-box wide lim-agent-form', onClick: (e: any) => e.stopPropagation() },
      React.createElement('div', { className: 'lim-setup-title' }, '发布一个 agent'),
      React.createElement('div', { className: 'lim-setup-hint' }, `以 @${props.selfAccount} 的身份发布到局域网；装到你机器上的人会看到下面所有内容`),

      React.createElement('div', { className: 'lim-field' },
        React.createElement('label', null, 'ID（小写字母/数字/连字符）'),
        React.createElement('input', { className: 'lim-input', value: id, placeholder: 'pr-reviewer', onChange: (e: any) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')) }),
      ),
      React.createElement('div', { className: 'lim-field' },
        React.createElement('label', null, '名称'),
        React.createElement('input', { className: 'lim-input', value: name, placeholder: 'PR 审阅', maxLength: 24, onChange: (e: any) => setName(e.target.value) }),
      ),
      React.createElement('div', { className: 'lim-field' },
        React.createElement('label', null, '一句话说明'),
        React.createElement('input', { className: 'lim-input', value: summary, placeholder: '读 diff，按团队规范出评审意见', maxLength: 80, onChange: (e: any) => setSummary(e.target.value) }),
      ),
      React.createElement('div', { className: 'lim-field' },
        React.createElement('label', null, '输入提示'),
        React.createElement('input', { className: 'lim-input', value: inputHint, placeholder: '贴 diff 或 PR 链接', onChange: (e: any) => setInputHint(e.target.value) }),
      ),

      React.createElement('div', { className: 'lim-agent-block-title' }, '需要的能力'),
      React.createElement('label', { className: 'lim-tool-row' },
        React.createElement('input', { type: 'checkbox', checked: useFsRead, onChange: (e: any) => setUseFsRead(e.target.checked) }),
        React.createElement('span', null, '读取共享目录'),
        React.createElement('input', { className: 'lim-input lim-input-inline', value: readScope, disabled: !useFsRead, onChange: (e: any) => setReadScope(e.target.value) }),
      ),
      React.createElement('label', { className: 'lim-tool-row' },
        React.createElement('input', { type: 'checkbox', checked: useBash, onChange: (e: any) => setUseBash(e.target.checked) }),
        React.createElement('span', null, '执行命令'),
        React.createElement('input', { className: 'lim-input lim-input-inline', value: bashAllow, disabled: !useBash, onChange: (e: any) => setBashAllow(e.target.value) }),
      ),

      React.createElement('div', { className: 'lim-agent-block-title' }, '发布方式'),
      React.createElement('label', { className: 'lim-tool-row' },
        React.createElement('input', { type: 'checkbox', checked: cloneable, onChange: (e: any) => setCloneable(e.target.checked) }),
        React.createElement('span', null, '允许克隆（别人装到本机，自己跑）'),
      ),
      React.createElement('label', { className: 'lim-tool-row' },
        React.createElement('input', { type: 'checkbox', checked: callable, onChange: (e: any) => setCallable(e.target.checked) }),
        React.createElement('span', null, '允许调用（跑在你这台机器上，M1 才有）'),
      ),

      React.createElement('div', { className: 'lim-agent-block-title' }, '一组样例'),
      React.createElement('textarea', { className: 'lim-input lim-textarea', rows: 2, value: sampleIn, placeholder: '输入示例', onChange: (e: any) => setSampleIn(e.target.value) }),
      React.createElement('textarea', { className: 'lim-input lim-textarea', rows: 3, value: sampleOut, placeholder: '期望输出', onChange: (e: any) => setSampleOut(e.target.value) }),

      React.createElement('div', { className: 'lim-agent-detail-actions' },
        React.createElement('button', { className: 'lim-send', disabled: props.busy, onClick: submit }, props.busy ? '发布中…' : '发布'),
        React.createElement('button', { className: 'lim-send ghost', onClick: props.onClose }, '取消'),
      ),
    ),
  )
}

export function AgentPanel(props: AgentPanelProps): React.ReactElement {
  const [detail, setDetail] = React.useState<AgentEntry | null>(null)
  const [publishing, setPublishing] = React.useState(false)
  const mine = props.entries.filter((e) => e.source === 'mine')
  const peers = props.entries.filter((e) => e.source === 'peer')

  const openDetail = (entry: AgentEntry): void => setDetail(entry)
  const current = detail === null ? null : props.entries.find((e) => e.card.id === detail.card.id && e.card.author.accountId === detail.card.author.accountId) ?? detail

  return React.createElement('div', { className: 'lim-agents' },
    React.createElement('div', { className: 'lim-agents-head' },
      React.createElement('span', { className: 'lim-agents-title' }, 'Agent 集市'),
      React.createElement('button', { className: 'lim-send lim-publish', onClick: () => setPublishing(true) }, '发布'),
    ),
    React.createElement('div', { className: 'lim-agents-scroll' },
      mine.length > 0
        ? React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'lim-agents-group' }, '我发布的'),
            mine.map((entry) => React.createElement(AgentRow, { key: `m-${entry.card.id}`, entry, onOpen: () => openDetail(entry) })),
          )
        : null,
      React.createElement('div', { className: 'lim-agents-group' }, '局域网可用'),
      peers.length === 0
        ? React.createElement('div', { className: 'lim-empty lim-empty-compact' },
            React.createElement('div', { className: 'lim-empty-title' }, '还没有别人发布'),
            React.createElement('div', { className: 'lim-empty-hint' }, '同一局域网里有人发布后，这里会出现卡片'),
          )
        : peers.map((entry) => React.createElement(AgentRow, { key: `p-${entry.card.author.accountId}-${entry.card.id}`, entry, onOpen: () => openDetail(entry) })),
    ),
    current !== null
      ? React.createElement(AgentDetail, {
          entry: current,
          busy: props.busy,
          onClose: () => setDetail(null),
          onInstall: () => { props.onInstall(current); setDetail(null) },
          onUninstall: () => { props.onUninstall(current); setDetail(null) },
        })
      : null,
    publishing
      ? React.createElement(PublishForm, {
          busy: props.busy,
          selfAccount: props.selfAccount,
          onClose: () => setPublishing(false),
          onSubmit: (input) => { props.onPublish(input); setPublishing(false) },
        })
      : null,
  )
}
