# 通信枢纽（Hub）升级方案

> 从「局域网直连」升级为「可独立部署的通信枢纽」：任意节点之间都能通，使用方只需填一个地址。
> 版本：草案 v1 · 2026-11-09

---

## 0. 一页摘要

| 问题 | 结论 |
|---|---|
| 现在的通信范围 | 同一局域网。靠 mDNS/UDP 发现 + 直连 WebSocket，跨网段就断 |
| 要变成什么 | 增加一个可独立部署的**枢纽（Hub）**：客户端只做出站连接，所有跨网消息经枢纽转发 |
| 谁能部署 | 任何人。`docker run` 一条命令，或 `npx` 一行；启动后打印地址与邀请码 |
| 使用方要做什么 | 插件设置里填 `wss://hub.example.com` + 邀请码，点「测试连接」 |
| 自建能不能接入大网络 | 能。枢纽之间可互联（联邦），节点地址形如 `alice@hub-a.example` |
| 安全 | 传输 TLS；节点用现有 Ed25519 身份做挑战应答；**端到端加密**，枢纽只见密文 |
| 局域网还能用吗 | 能，且优先：同网段仍直连，跨网自动走枢纽，用户无感 |
| 工期 | 核心（能跨网聊天）5–7 人日；E2E + 离线 5 人日；群组/多端 5 人日；联邦 4 人日 |

关键取舍：**枢纽不是可信第三方**。它能决定“能不能转发、存多久”，但不能读内容——否则自建枢纽失去意义，也没人敢用别人的。

---

## 1. 现状与问题

### 1.1 现在怎么通

```
[节点 A]  --mDNS 广播-->  [同网段节点 B]
    └──── 直连 ws://ip:port ────┘
```

- `discovery.ts`：mDNS 发布 `_lanim._tcp` + UDP 42123 兜底广播
- `peer-network.ts`：按 nodeId 建直连 WS，`hello/helloAck` 带 Ed25519 签名
- `identity.ts`：`keyId = base32(sha256(pubkey))[:16]`，TOFU 钉住，冲突告警

### 1.2 卡在哪

| 限制 | 后果 |
|---|---|
| 只能同网段 | 家里和公司、两个办公室之间不能聊 |
| 需要互相可达 | 一方在 NAT 后面、或公司防火墙禁入站，就通不了 |
| 没有离线 | 对方关机，消息发不出去（outbox 只在本机重试） |
| 频道是本地状态 | 各节点各自维护频道列表，靠广播同步，跨网络无法收敛 |

### 1.3 目标（按优先级）

1. **跨网络可用**：只要两边都能访问同一个枢纽，就能通信
2. **部署极简**：一条命令起服务，一个地址接进来
3. **安全**：传输加密 + 端到端加密 + 身份可验证
4. **可自建、可互联**：单枢纽够用，枢纽之间能组成网络
5. 不破坏现有局域网体验

---

## 2. 产品形态

### 2.1 三种连接形态

| 形态 | 适用 | 数据路径 |
|---|---|---|
| **局域网直连**（现状，保留） | 同一网段 | A ⇄ B 直连，不经任何服务器 |
| **单枢纽**（默认推荐） | 家庭、小团队 | A ⇄ Hub ⇄ B，Hub 只转发密文 |
| **枢纽联邦**（进阶） | 多个组织互联 | A ⇄ HubA ⇄ HubB ⇄ B，按域名路由 |

客户端自动选择：发现同网段节点优先直连；直连不通时自动走枢纽；两者都不可用则离线排队。

### 2.2 使用方看到的东西

设置页新增「通信」一节：

```
连接方式
  ○ 仅局域网
  ● 通过枢纽          ← 默认
     地址   [ wss://hub.example.com        ]  [测试连接]
     邀请码 [ ****-****-****               ]
     状态   ● 已连接（12ms）· 节点 alice@hub.example.com

  ○ 自建枢纽          → 显示一条命令与二维码（手机/同事扫码即可接入）
```

就这些。没有证书、没有端口、没有密钥文件。

### 2.3 部署方看到的东西

```bash
# 一条命令
docker run -d --name lanim-hub -p 8787:8787 -v hub-data:/data \
  ghcr.io/mishiqian/lanim-hub:latest

# 或
npx @mishijian/lanim-hub --port 8787 --data ./hub-data
```

首次启动打印：

```
lan-im 枢纽已启动
  地址      wss://192.168.1.20:8787
  管理页    http://192.168.1.20:8787/admin
  邀请码    K7QF-3M2X-9WPB
  指纹      SHA256:8f:3c:...  (自签证书，客户端首次连接会显示并记住)
```

管理页只有四件事：在线节点、流量统计、邀请码管理、封禁。

---

## 3. 安全模型

### 3.1 三道防线

| 层 | 机制 | 防什么 |
|---|---|---|
| 传输 | TLS（wss）。公网强制；自签证书首次连接显示指纹，用户确认后钉住 | 窃听、中间人 |
| 身份 | 复用现有 Ed25519。枢纽发 nonce，节点签名 `hub/hello-v1\|hubId\|nodeId\|keyId\|nonce` | 冒充、重放 |
| 内容 | 端到端加密（X25519 ECDH + AES-256-GCM），枢纽只见密文 | 枢纽运营方偷看、枢纽被拖库 |

### 3.2 身份怎么算

- 节点身份 = 现有 `keyId`（Ed25519 公钥指纹），不新造体系
- 对外展示名：`<account>@<hub-domain>`，如 `alice@hub.example`
- 枢纽维护 `keyId → account` 绑定表；同一 `account` 被不同 keyId 占用时拒绝并告警（防抢名）

### 3.3 端到端加密

- 每个节点额外生成一把 **X25519 子钥**，用 Ed25519 主钥签名（signed prekey）后随 `hub/hello` 发布
  —— Node 原生支持 X25519 ECDH，但**不能**把 Ed25519 密钥直接转成 X25519，所以子钥是最干净的做法
- 每对节点：`X25519(priv_A, pub_B)` → HKDF-SHA256(salt=hubId) → `AES-256-GCM` 会话密钥
- 每条消息独立 nonce，密文外层带发送方签名（覆盖 recipient、msgId、ts）
- 首次通信自动完成，不需要手动换钥
- 群组频道：sender-key（M3），每个成员用会话密钥分发一条组密钥

> 代价说明：枢纽读不到内容，所以**服务端搜索、服务端内容审核都不可能**。搜索仍在本机做（现状就是这样，没退化）。

### 3.4 枢纽侧的防护

- 邀请码注册（默认开启），可设次数与有效期
- 每节点限速（消息/秒、字节/秒、离线队列上限）
- 离线队列 TTL 7 天，超限丢弃最旧并通知发送方
- 封禁名单（按 keyId / IP）
- 审计日志只记元数据（谁在什么时候给谁发了多少字节），不记内容

---

## 4. 技术架构

### 4.1 组件

```
┌──────────────── DSH 插件（客户端） ────────────────┐
│  peer-network（现有直连）   hub-client（新增）      │
│         └────────┬──────────────┘                  │
│              envelope（新增：E2E 封装/解封）        │
└───────────────────┼────────────────────────────────┘
                    │ wss（只出站）
            ┌───────▼────────┐
            │   Hub 进程      │  独立部署：Node 单进程 + SQLite/文件
            │  auth / router  │
            │  queue / blobs  │
            │  admin / metrics│
            └───────┬────────┘
                    │ hub↔hub（联邦，M4）
            ┌───────▼────────┐
            │   其他 Hub      │
            └────────────────┘
```

Hub 用 Node + TypeScript 写，单进程，零外部依赖（SQLite 用 better-sqlite3 或纯文件 JSON，视数据量）。**不依赖 DSH**——它要能跑在任何服务器上。

### 4.2 协议帧（新增）

```ts
// 节点 → 枢纽
{ t: 'hub/hello', hubId, nodeId, keyId, account, nonce, ts, sig, invite? }
{ t: 'relay', env: { id, toKeyId, kind, ciphertext, nonce, sig, ts, ttl } }
{ t: 'relay/ack', ids: string[] }
{ t: 'presence', status: 'online'|'away', typing?: boolean }
{ t: 'sync/request', since: number }

// 枢纽 → 节点
{ t: 'hub/challenge', nonce, hubId }
{ t: 'hub/ready', hubId, serverTime, limits: { msgPerSec, queueBytes } }
{ t: 'relay', env }            // 转发进来的
{ t: 'relay/receipt', id, status: 'delivered'|'queued'|'rejected', reason? }
{ t: 'presence', keyId, status, lastSeen }
{ t: 'sync/result', envs: Envelope[] }
{ t: 'hub/error', code, message }
```

现有 `PeerWireMessage`（msg/ack/file/channel…）保持不变，只是外面多包一层 `Envelope`；直连时仍走裸帧，跨网时走 `relay`。

### 4.3 Hub 数据模型

```sql
nodes(key_id PK, account, node_id, last_seen, blocked)
invites(code PK, max_uses, used, expires_at)
queue(id PK, to_key_id, env BLOB, size, created_at, expires_at)   -- 只存密文
blobs(id PK, to_key_id, size, chunks, created_at)                 -- 文件分片，加密
channels(id PK, owner_key_id, name, kind, meta)                   -- 群组成员表（M3）
members(channel_id, key_id, role, joined_at)
audit(id PK, ts, from_key_id, to_key_id, bytes, kind)
```

### 4.4 客户端模块（落到现有代码）

| 新文件 | 职责 |
|---|---|
| `src/host/hub-client.ts` | 与枢纽的连接、重连退避、心跳、离线队列拉取 |
| `src/host/hub-auth.ts` | 挑战应答签名、邀请码、证书指纹钉住 |
| `src/host/envelope.ts` | E2E 封装/解封（X25519 + AES-GCM），`keyId` 寻址 |
| `src/host/router.ts` | 选择路径：直连 > 枢纽；统一出口，`messaging`/`fileTransfer` 只调它 |
| `hub/`（独立包） | 枢纽服务：auth、router、queue、admin、metrics |

改动点：
- `runtime.ts`：启动时按配置决定是否连枢纽；`self` 增加 `hubId`
- `peer-network.ts`：保留直连逻辑，抽出 `send(to, frame)` 给 router 调用
- `protocol.ts`：新增 `HubWireMessage`、`Envelope`；`StoredConfig` 增加 `hub` 字段
- 客户端：设置页新增「通信」区块；顶部状态从「N 在线」细化为「直连 N / 经枢纽」

### 4.5 配置

```ts
interface StoredConfig {
  // ...现有
  hub?: {
    url: string                 // wss://hub.example.com
    invite?: string             // 邀请码（仅首次注册用）
    certPin?: string            // 自签证书指纹，首次确认后写入
    mode: 'auto' | 'lan-only' | 'hub-only'
  }
}
```

明文只存地址与指纹；私钥仍只在 `identity.json`（0600）。

---

## 5. 分阶段实施

| 阶段 | 内容 | 估时 | 验收标准 |
|---|---|---|---|
| **M1 通路** | Hub 骨架（auth/router/queue）+ 客户端 hub-client + 设置页填报 + 单枢纽跨网聊天 | 5–7 人日 | 两台不同网络的机器，填同一地址后能互发文字；杀掉一方再上线能收到离线消息 |
| **M2 安全** | TLS 自签 + 指纹钉住、E2E 封装、邀请码、限速与队列上限 | 5 人日 | 抓包看不到明文；无邀请码连不上；超 100 条/秒被限速 |
| **M3 完整通信** | 文件传输经枢纽（分片+断点）、群组频道（sender-key）、多端同账号 | 5 人日 | 100MB 文件中断后续传；群里发消息所有成员可读；手机+电脑同账号互见 |
| **M4 联邦** | hub↔hub 互联、域名寻址、跨枢纽路由 | 4 人日 | A@hubA 与 B@hubB 互通；hubB 宕机后 A 侧收到明确不可达 |
| 测试与运维 | 双枢纽集成测试、部署脚本、文档 | 3 人日 | CI 里能起两个 hub 跑通端到端 |

总计约 **22–24 人日**。M1+M2 是“能用且敢用”的最小闭环。

---

## 6. 风险与开放问题

| 风险 | 影响 | 应对 |
|---|---|---|
| E2E 与多端冲突 | 同一账号两台设备各自持有私钥 | M3 引入 device key：账号主钥签发设备子钥，消息给每个设备各加密一份 |
| 群组 E2E 复杂度 | 成员变动要换 sender key | 先做小群（≤50 人）；成员变动即轮换，历史消息用旧 key 保留 |
| 自签证书劝退 | 用户看到浏览器/客户端警告 | 只钉指纹、不做 HSTS 弹窗；有域名时一条 `--tls auto` 走 ACME |
| 枢纽被滥用 | 开放注册会变垃圾通道 | 默认邀请制；免费枢纽建议开队列上限 |
| 联邦信任 | 任何 hub 都能宣称自己在转发 | 联邦只做“可达性”，消息仍端到端加密；接收方按 keyId 校验签名 |
| 搜索退化 | 服务端不能搜 | 现状本机搜索，无退化；后续可做本地索引加密备份 |

**三个需要你拍板的点**

1. **枢纽命名**：叫「枢纽 / Hub」还是别的（避免和现有“频道”混淆）。
2. **E2E 什么时候上**：M1 先上 TLS+身份（快），M2 补 E2E；还是 M1 直接带 E2E（慢 2 天，但从第一天就安全）。
3. **默认连接方式**：默认「通过枢纽」还是「仅局域网」？前者开箱即用，后者零依赖。

---

## 7. 非目标（这一轮不做）

- NAT 打洞 / P2P 中继打洞（跨网统一走枢纽）
- 服务端内容审核或全文搜索（与 E2E 冲突）
- 中心化账号体系（不引入密码登录枢纽）
- 消息撤回跨枢纽强一致（尽力而为，最终以接收方本地为准）
