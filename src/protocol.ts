/**
 * 局域网即时通信（lan-im）共享协议 v5：账号身份 + UUID 频道/私有频道 + 可靠消息 + 消息附件 + 局域网网盘 + 搜索 + PSK。
 */

export const WS_PATH = '/lan-im/ws'
export const API_ROUTE = '/lan-im/api'
export const MDNS_TYPE = 'lanim'
export const PROTOCOL_VERSION = 5
/** 实时视图在内存中保留的历史条数（历史文件本身不截断） */
export const HISTORY_LIMIT = 500
export const PEER_TIMEOUT_MS = 20000
export const SWEEP_INTERVAL_MS = 3000
export const DISCOVERY_PORT = 42123
export const ANNOUNCE_INTERVAL_MS = 5000
export const UDP_MAGIC = 'DSH-LAN-IM'
/** 文件分片大小（字节），base64 后约 64KB */
export const CHUNK_SIZE = 48 * 1024
/** 文件大小上限（字节） */
export const MAX_FILE_SIZE = 20 * 1024 * 1024
/** 撤回限时（毫秒） */
export const RECALL_WINDOW_MS = 2 * 60 * 1000

export interface Account {
  username: string
  displayName: string
  passwordHash?: string
  salt?: string
}

export interface SelfInfo {
  accountId: string
  name: string
  nodeId: string
  ip: string
  wsPort: number
  /** 是否启用了共享密钥（PSK） */
  hasPsk: boolean
  /** 是否设置了本机密码 */
  hasPassword?: boolean
}

export interface Peer {
  accountId: string
  name: string
  nodeId: string
  ip: string
  wsPort: number
  lastSeen: number
  /** 对方公钥指纹；旧版本可能没有 */
  keyId?: string
  /** 身份是否已验证：true=签名通过且钉住一致；false=未验证/冲突 */
  trusted?: boolean
}

export type ChannelKind = 'public' | 'private'

export interface Channel {
  /** UUID，稳定；'*' 为内置公共频道 */
  id: string
  name: string
  description?: string
  kind: ChannelKind
  /** 创建者 accountId；'*' 表示迁移产生的无主频道（所有节点可管理） */
  createdBy: string
  createdAt: number
  /** 私有频道成员 accountId（含创建者）；公开频道省略 */
  members?: string[]
  /** 仅本机视图使用：false 表示已离开的公开频道（可重新加入） */
  joined?: boolean
}

/** 消息目标类型：频道（含公共频道 '*'）或账号（私聊） */
export type TargetType = 'channel' | 'account'

export interface ChatMessage {
  id: string
  from: string
  fromName: string
  /** 目标：'*'=公共频道 | 频道 id | 账号 id */
  to: string
  toType: TargetType
  body: string
  ts: number
  kind: 'text' | 'system'
  local: boolean
  status?: 'sent' | 'delivered'
  recalled?: boolean
  edited?: boolean
}

/** 频道共享文件索引（v2 局域网网盘）。物理文件在 ownerNodeId，其他节点按需拉取缓存。 */
export interface SharedFile {
  id: string
  name: string
  size: number
  mime: string
  ownerNodeId: string
  ownerAccount: string
  channelId: string
  uploadedAt: number
  sha256: string
}

export interface FileInfo {
  id: string
  from: string
  fromName: string
  to: string
  toType: TargetType
  name: string
  size: number
  mime: string
  ts: number
  /** 本机保存路径（接收方本机有值） */
  path?: string
}


/** ---------- Agent 集市（M0） ---------- */

/** 能力包络里允许声明的工具 */
export const AGENT_TOOLS = ['fs.read', 'fs.write', 'bash', 'web.fetch'] as const
export type AgentToolName = (typeof AGENT_TOOLS)[number]
export const AGENT_PERMISSIONS = ['read-only', 'workspace-write', 'danger-full-access'] as const
export type AgentPermission = (typeof AGENT_PERMISSIONS)[number]

export interface AgentToolGrant {
  name: AgentToolName
  scope?: string
  allow?: string[]
  deny?: string[]
}

export interface AgentBudget { turns?: number; tokens?: number; seconds?: number }
export interface AgentSample { in: string; out: string; note?: string }

export interface AgentCard {
  schema: number
  id: string
  version: string
  name: string
  summary: string
  /** 角色设定正文——agent 的核心，装到对方机器上就是这个 prompt 在生效 */
  prompt: string
  author: { accountId: string; keyId?: string }
  input: { type: 'text' | 'file' | 'any'; hint?: string }
  output: { type: 'markdown' | 'text' | 'json' | 'file' }
  requires: { model?: string; permissions?: AgentPermission; tools: AgentToolGrant[]; budget: AgentBudget }
  exposure: { cloneable: boolean; callable: boolean; acl?: 'lan' | 'accounts'; accounts?: string[] }
  samples: AgentSample[]
  integrity?: { sha256?: string; keyId?: string; sig?: string }
}

export interface AgentPackageFile { path: string; encoding: 'utf8' | 'base64'; data: string }

export interface AgentPackage {
  format: string
  schema: number
  card: AgentCard
  files: AgentPackageFile[]
  integrity: { card: string; files: string; pkg: string }
}

/** 目录条目：卡片 + 来源 */
export interface AgentEntry {
  card: AgentCard
  /** mine = 我发布的；peer = 别人发布的 */
  source: 'mine' | 'peer'
  /** 我是否已安装（仅 peer 有意义） */
  installed: boolean
  /** 已安装版本（用于提示升级） */
  installedVersion?: string
}

/** 一次远端托管会话的落盘记录（作者侧可见） */
export interface RemoteSessionRecord {
  remoteId: string
  dshSessionId: string
  agentKey: string
  preset: string
  callerId: string
  createdAt: number
  lastActive: number
  status: 'active' | 'suspended' | 'closed'
  turns: number
  tokens: number
}

/** 节点间 WebSocket 消息帧 */
export type PeerWireMessage =
  | {
      t: 'hello'; accountId: string; nodeId: string; name: string; pskId?: string
      channels?: Channel[]; sharedFiles?: SharedFile[]
      /** 身份：公钥 + 指纹 + 时间戳 + 对 (nodeId|accountId|ts) 的签名 */
      pubkey?: string; keyId?: string; ts?: number; sig?: string
    }
  | { t: 'helloAck'; accountId: string; nodeId: string; pubkey?: string; keyId?: string; ts?: number; sig?: string }
  | { t: 'msg'; id: string; from: string; fromName: string; to: string; toType: TargetType; body: string; ts: number }
  | { t: 'ack'; id: string }
  | { t: 'recall'; id: string; from: string }
  | { t: 'edit'; id: string; from: string; body: string; ts: number }
  | { t: 'file'; id: string; from: string; fromName: string; to: string; toType: TargetType; name: string; size: number; mime: string; sha256: string; ts: number; totalChunks: number }
  | { t: 'chunk'; id: string; seq: number; data: string }
  | { t: 'channelAdd'; channel: Channel }
  | { t: 'channelUpdate'; channel: Channel }
  | { t: 'channelDelete'; id: string }
  | { t: 'channelMemberAdd'; channelId: string; accountId: string }
  | { t: 'channelMemberRemove'; channelId: string; accountId: string }
  | { t: 'channelsSync'; channels: Channel[] }
  | { t: 'fileAdd'; file: SharedFile }
  | { t: 'fileRemove'; id: string; channelId: string }
  | { t: 'fileFetch'; id: string; requesterAccountId: string; requesterNodeId: string }
  | { t: 'fileData'; id: string; name: string; mime: string; size: number; sha256: string; totalChunks: number; seq: number; data: string }
  | { t: 'sharedFilesSync'; files: SharedFile[] }
  | { t: 'agentCard'; card: AgentCard }
  | { t: 'agentCardsSync'; cards: AgentCard[] }
  | { t: 'agentFetch'; reqId: string; accountId: string; id: string }
  | { t: 'agentPkg'; reqId: string; pkg?: AgentPackage; error?: string }
  | { t: 'agentOpen'; reqId: string; agentId: string; caller: string }
  | { t: 'agentOpened'; reqId: string; ok: boolean; sessionId?: string; error?: string }
  | { t: 'agentSend'; reqId: string; sessionId: string; text: string }
  | { t: 'agentSent'; reqId: string; ok: boolean; text?: string; error?: string; turns?: number }
  | { t: 'agentClose'; sessionId: string }

/** 客户端 → 宿主 */
export type ClientOutMessage =
  | { t: 'send'; to: string; toType: TargetType; body: string }
  | { t: 'setName'; name: string }
  | { t: 'setupAccount'; username: string; displayName: string; password?: string }
  | { t: 'setupPsk'; psk: string }
  | { t: 'setPassword'; password: string }
  | { t: 'search'; keyword: string }
  | { t: 'recall'; id: string }
  | { t: 'edit'; id: string; body: string }
  | { t: 'createChannel'; name: string; kind?: ChannelKind; description?: string }
  | { t: 'renameChannel'; id: string; name: string; description?: string }
  | { t: 'deleteChannel'; id: string }
  | { t: 'joinChannel'; id: string }
  | { t: 'leaveChannel'; id: string }
  | { t: 'inviteChannelMember'; channelId: string; accountId: string }
  | { t: 'removeChannelMember'; channelId: string; accountId: string }
  | { t: 'removeSharedFile'; id: string }
  | { t: 'fileStart'; uploadId: string; name: string; size: number; mime: string; to: string; toType: TargetType; share?: boolean; channelId?: string }
  | { t: 'fileChunk'; uploadId: string; seq: number; data: string }
  | { t: 'fileEnd'; uploadId: string }

/** 宿主 → 客户端 */
export type HostInMessage =
  | { t: 'snapshot'; self: SelfInfo; peers: Peer[]; channels: Channel[]; messages: ChatMessage[]; files: FileInfo[]; sharedFiles: SharedFile[]; log: string[] }
  | { t: 'msg'; message: ChatMessage }
  | { t: 'peers'; peers: Peer[] }
  | { t: 'self'; self: SelfInfo }
  | { t: 'log'; log: string[] }
  | { t: 'channels'; channels: Channel[] }
  | { t: 'searchResult'; keyword: string; results: ChatMessage[] }
  | { t: 'file'; file: FileInfo }
  | { t: 'sharedFiles'; sharedFiles: SharedFile[] }
  | { t: 'error'; message: string }

/** 发现通道上报的节点种子（mDNS / UDP 解析后） */
export interface PeerSeed {
  nodeId: string
  accountId: string
  name: string
  ip: string
  wsPort: number
  pskId?: string
}
