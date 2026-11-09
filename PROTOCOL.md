# lan-im 通信协议 v1（规范）

> 状态：草案（normative draft）· 2026-11-09
> 配套文档：[RELAY-PRD.md](RELAY-PRD.md)（产品与架构）

---

## 0. 这份文档解决什么问题

RELAY-PRD 里只有几个帧名，那不是协议，只是草图。草图不能保证互操作，原因很具体：

| 草图里没写清的东西 | 不同实现会分叉成 |
|---|---|
| JSON 字段顺序、数字格式、Unicode 转义 | 一样的内容算出两种签名，彼此验不过 |
| 签名到底覆盖哪些字节 | “我签的是对象，你验的是字符串” |
| 未知字段怎么处理 | 一方忽略、一方报错，升级即断连 |
| 版本怎么协商 | 新客户端连旧枢纽直接握手失败 |
| 加密参数（KDF、nonce、AAD）用什么 | 两边都“AES-GCM”，却解不开 |

所以这里给的是**字节级、语言无关、带测试向量**的规范。判定标准只有一条：

> 任何人用任何语言、任何 WebSocket 库、任何 Ed25519 实现，照着本文能互通；
> 且本文附带的测试向量能被独立实现逐字节复现。

---

## 1. 分层

```
┌──────────────────────────────────────────┐
│ LAP  应用负载  消息/文件/频道/已读        │  加密前的业务数据
├──────────────────────────────────────────┤
│ LEP  信封      端到端加密 + 签名          │  枢纽看不懂，只当字节转发
├──────────────────────────────────────────┤
│ HLP  链路      节点 ↔ 枢纽 的控制与路由   │  JSON 帧，明文（只有元数据）
├──────────────────────────────────────────┤
│ TLS + WebSocket                          │
└──────────────────────────────────────────┘
```

**关键约束**：HLP 的 `relay` 帧只携带 LEP 信封的 base64url 字符串，枢纽**不解析**信封内容。这条约束是“枢纽可被任意实现替换”的前提。

**唯一路径**：节点之间没有直连。所有节点只与枢纽建立连接，应用负载一律经 LEP 加密后由枢纽转发。

---

## 2. 通用约定

| 项 | 规定 |
|---|---|
| 传输 | WebSocket over TLS（`wss`）。局域网直连可用 `ws`，但不得跨公网 |
| 帧编码 | 每个 WS **文本帧** = 一个 UTF-8 JSON 对象，顶层必须有 `t`（帧类型）与 `v`（协议版本，整数） |
| 二进制字段 | 一律 **base64url 无填充**（RFC 4648 §5），字段名后缀无特殊标记 |
| 键 ID | `keyId` = base32(sha256(Ed25519 公钥原始 32 字节)) 前 16 字符，大写，无填充 |
| 信封 ID | 26 字符 Crockford Base32（ULID 风格，前 10 字符为毫秒时间），全局唯一 |
| 时间 | Unix 毫秒，整数 |
| 整数 | JSON number，禁止浮点表示整数；> 2^53 用字符串 |
| 字符串 | UTF-8，不做 HTML 转义；`\u` 转义仅允许出现在 JSON 语法层 |
| 帧大小 | 控制帧 ≤ 64 KiB；`relay` ≤ 1 MiB（base64 前 768 KiB 原文） |
| 心跳 | 双方每 20 s 发 `ping`，60 s 未收到 `pong` 关闭连接（close code 1001） |
| 保序 | 同一 (from,to) 对内的 LEP 信封按 `seq` 单调递增；接收方自行重排 |

---

## 3. HLP：链路协议

### 3.1 状态机

```
节点                                枢纽
 │ ── ws 连接（wss） ───────────────▶ │
 │ ── hello {v:{min,max}, nonce, …} ─▶│
 │ ◀─ challenge {hubNonce} ───────────│   （防重放，一次性）
 │ ── auth {sig} ─────────────────────▶│
 │ ◀─ ready {version, features, …} ───│   （认证完成，可发 relay）
 │ ◀── ping/pong、relay、receipt ─────▶│
```

- 任一时刻只能有一个未完成的握手；重复 `hello` 直接 `hub/error 1005`
- `ready` 之前的任何 `relay` 都会被丢弃并回 `hub/error 1001`

### 3.2 帧

**hello（节点 → 枢纽）**

```json
{ "t": "hello", "v": 1,
  "hubId": "hubA.example",
  "nodeId": "6f1e2a3c-0000-4a00-9000-000000000001",
  "account": "alice",
  "keyId": "KZDVVJ2UMNDUYAUF",
  "prekey": "e06Qm75__kTEZaIgA31gjuNYl9Me-XLwf3SJLLD3PxM",
  "prekeySig": "…",
  "invite": "K7QF-3M2X-9WPB",
  "nonce": "5f3c1a00",
  "ts": 1762670400000,
  "caps": { "min": 1, "max": 1, "features": ["text", "presence"] } }
```

- `prekey`：X25519 公钥（32 字节 base64url）
- `prekeySig`：`Ed25519(identity, "lanim-prekey-v1\0" || keyId || prekey)`
- 首次注册需要 `invite`；已注册节点可省略

**challenge（枢纽 → 节点）**

```json
{ "t": "challenge", "v": 1, "hubNonce": "9c1e77b2", "ts": 1762670400123 }
```

**auth（节点 → 枢纽）**：签名覆盖的字节**不是 JSON**，而是固定拼装：

```
"lanim-hlp-v1" 0x00 hubId 0x00 nodeId 0x00 keyId 0x00 clientNonce 0x00 hubNonce 0x00 ts(十进制 ASCII)
```

```json
{ "t": "auth", "v": 1, "keyId": "KZDVVJ2UMNDUYAUF", "ts": 1762670400200,
  "sig": "14ajQV7JVS4wEKcwF0DSsIeW2Af_pf6u7J-CtMQBwiismjbU903cZgcaBdN9q0JS8yn_5uypqEs9HHik8NycAA" }
```

- `ts` 必须在枢纽时间的 ±120 s 内，否则 `1006`
- `hubNonce` 一次性，用过即作废；同一 nonce 的第二次 `auth` 一律 `1006`

**ready（枢纽 → 节点）**

```json
{ "t": "ready", "v": 1, "hubId": "hubA.example",
  "version": 1, "features": ["text", "presence", "queue"],
  "serverTime": 1762670400300,
  "limits": { "frameBytes": 1048576, "msgPerSec": 50, "queueBytes": 268435456 } }
```

**relay（双向）**：`env` 是 LEP 信封字节的 base64url，枢纽不解析。

```json
{ "t": "relay", "v": 1, "env": "…base64url…" }
```

**relay/receipt（枢纽 → 发送方）**

```json
{ "t": "relay/receipt", "v": 1, "ids": ["01J0000000000000000000000A"], "status": "queued" }
```

`status` ∈ `delivered | queued | rejected`；`rejected` 必须带 `reason`（错误码）。

**presence（双向）**

```json
{ "t": "presence", "v": 1, "keyId": "ZZZZ1111YYYY2222", "status": "online", "lastSeen": 1762670400000 }
```

**lookup（节点 → 枢纽，用于离线投递）**

```json
{ "t": "lookup", "v": 1, "keyId": "ZZZZ1111YYYY2222" }
{ "t": "lookup/result", "v": 1, "keyId": "…", "account": "bob", "prekey": "…", "prekeySig": "…", "hubId": "hubA.example", "online": true }
```

找不到时回 `{"t":"lookup/result","v":1,"keyId":"…","found":false}`。

**ping / pong / error**

```json
{ "t": "ping", "v": 1, "ts": 1762670400000 }
{ "t": "pong", "v": 1, "ts": 1762670400001 }
{ "t": "hub/error", "v": 1, "code": 1003, "message": "rate limited", "retryAfterMs": 1000 }
```

### 3.3 错误码（固定，不得自定义数字）

| code | 语义 | 连接是否关闭 |
|---|---|---|
| 1001 | 未认证 / 认证失效 | 关闭 |
| 1002 | 不支持的版本 | 关闭 |
| 1003 | 被限流 | 保持，带 `retryAfterMs` |
| 1004 | 帧过大 | 保持 |
| 1005 | 未知帧类型 / 重复握手 | 保持 |
| 1006 | 签名无效 / 时间戳越界 / nonce 重放 | 关闭 |
| 1007 | 邀请码无效或已用尽 | 关闭 |
| 1008 | 节点被封禁 | 关闭 |
| 1009 | 内部错误 | 保持 |

### 3.4 版本协商

1. `hello.caps = {min,max,features[]}`；枢纽取 `min(hub.max, caps.max)`，若 `< max(caps.min, hub.min)` → `1002`
2. `ready.version` 即本次连接使用的版本；后续所有帧的 `v` 必须等于它
3. `features` 取交集；**未协商的 feature 相关帧必须忽略**（不是报错）
4. 未知的 `features` 字符串忽略，不产生副作用

---

## 4. LEP：端到端信封

### 4.1 字节布局

```
sig(64) || headerLen(u32 BE) || header(JSON UTF-8) || ciphertext || tag(16)
```

- `sig`：发送方 Ed25519 对 `header || ciphertext || tag` 的签名（不含 sig 本身）
- `header`：UTF-8 JSON，字段顺序**不要求**（因为签名覆盖的是原始字节，不是重新序列化的对象）
- 接收方必须先按收到的原始字节验签名，再解析 header

### 4.2 header

```json
{ "v": 1,
  "id": "01J0000000000000000000000A",
  "from": "K7QF3M2X9WPB0000",
  "to": "ZZZZ1111YYYY2222",
  "ts": 1762670400000,
  "seq": 42,
  "kind": "text",
  "nonce": "AAAAAAAB" }
```

- `kind` ∈ `text | file-meta | file-chunk | channel | presence | receipt`
- `seq`：同一 (from,to) 的单调计数，从 0 开始；接收方据此判重与排序
- `nonce`：12 字节 base64url；**4 字节随机前缀（每对密钥固定）+ 8 字节计数器**

### 4.3 密钥派生（必须逐字实现）

```
shared = X25519(a.x25519_priv, b.x25519_pub)
salt   = "lanim-e2e-v1|" + join(sort([a.keyId, b.keyId]), "|")
info   = "lanim-envelope-v1"
key    = HKDF-SHA256(ikm=shared, salt, info, L=32)
```

- 双方算出的 `salt` 必须一致（排序保证）
- `X25519` 公钥必须先经过 `prekeySig` 验证，否则不得用于派生
- 单向：每条消息用同一把会话密钥，靠 nonce 唯一性保证安全；计数器到 2^63 必须重新握手

### 4.4 加解密

```
AAD = header 原始字节
ct, tag = AES-256-GCM(key, nonce, plaintext, AAD)
```

- 解密失败（tag 校验不过）必须丢弃并记录，不能降级为“忽略加密”
- 收件人不是本机 `keyId` 时丢弃（防投递错人）

---

## 5. LAP：应用负载

信封的 `plaintext` 是 UTF-8 JSON，结构与现有 `PeerWireMessage` 对齐，但去掉传输字段（`t` 保留）：

```json
{ "t": "msg", "body": "你好", "ts": 1762670400000 }
```

| kind | plaintext 结构 |
|---|---|
| `text` | `{t:"msg"|"recall"|"edit", …}`（与现有 msg/recall/edit 帧同构） |
| `presence` | `{t:"presence", status, typing?}` |
| `channel` | `{t:"channelAdd"|"channelUpdate"|…}` |
| `file-meta` | `{t:"file", name, size, mime, sha256, totalChunks}` |
| `file-chunk` | `{t:"chunk", seq, data}`（每块 ≤ 512 KiB） |
| `receipt` | `{t:"ack", id}` / `{t:"read", id, ts}` |

**没有例外**：任何应用负载都必须经 LEP 封装，包括同一局域网内的收发。
不存在“直连裸帧”路径——少一条路径就少一类“忘了加密”的 bug。

---

## 6. 兼容性规则

| 规则 | 要求 |
|---|---|
| 未知字段 | 必须忽略（前后兼容的基础） |
| 未知帧类型 | 回 `1005`，**保持连接**；不得断开 |
| 未知 `kind` | 忽略该信封，回 `receipt status=rejected, reason=unsupported-kind` |
| 版本升级 | 大版本不兼容即协商失败；小版本靠 `features` 增量 |
| 弃用 | 至少保留一个大版本的兼容窗口，`ready.features` 里标注 `deprecated:xxx` |
| 扩展点 | 自定义数据只允许放在 `x-` 前缀字段，标准实现必须忽略 |

---

## 7. 一致性验证

### 7.1 测试向量（可逐字节复现）

**V1 — 握手签名**

```
Ed25519 seed      000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
公钥 base64url    A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg
keyId (base32)    KZDVVJ2UMNDUYAUF
hubId             hubA.example
nodeId            6f1e2a3c-0000-4a00-9000-000000000001
clientNonce       5f3c1a00
hubNonce          9c1e77b2
ts                1762670400200
待签字节 (UTF-8)  lanim-hlp-v1 ␀ hubA.example ␀ 6f1e2a3c-0000-4a00-9000-000000000001 ␀
                  KZDVVJ2UMNDUYAUF ␀ 5f3c1a00 ␀ 9c1e77b2 ␀ 1762670400200
待签字节 (hex)    6c616e696d2d686c702d763100687562412e6578616d706c650036663165326133632d
                  303030302d346130302d393030302d303030303030303030303031004b5a4456564a
                  32554d4e44555941554600356633633161303000396331653737623200313736323637
                  30343030323030
签名 (base64url)  14ajQV7JVS4wEKcwF0DSsIeW2Af_pf6u7J-CtMQBwiismjbU903cZgcaBdN9q0JS8yn_5uypqEs9HHik8NycAA
```

> 注意：`␀` 是单个 0x00 字节。字段之间**只有**分隔符，没有空格或换行；上面为了可读才折行。

**V2 — ECDH + HKDF**

```
a.x25519 seed  1111…1111（32 字节）
b.x25519 seed  2222…2222（32 字节）
a.pub          e06Qm75__kTEZaIgA31gjuNYl9Me-XLwf3SJLLD3PxM
b.pub          D6poTtKIZ7l_Smot7l34zpdOdrcBjj8iocTPJnhXDyA
shared (hex)   9e004098efc091d4ec2663b4e9f5cfd4d7064571690b4bea97ab146ab9f35056
salt           lanim-e2e-v1|D6poTtKIZ7l_Smot7l34zpdOdrcBjj8iocTPJnhXDyA|e06Qm75__kTEZaIgA31gjuNYl9Me-XLwf3SJLLD3PxM
key (hex)      124d454ea63ec6a4e426525a7c1d8ebfaa1221589d47e9e9602e79c6456b727a
```

**V3 — 信封加解密**

```
key              V2 的 key
nonce            000000000000000000000001
header 字节(hex) 7b2276223a312c226964223a2230314a3030303030303030303030303030303030303030
                 303041222c2266726f6d223a224b375146334d32583957504230303030222c22746f223a22
                 5a5a5a5a313131315959595932323232222c227473223a313736323637303430303030302c
                 226b696e64223a2274657874227d
明文(hex)        7b2274223a226d7367222c22626f6479223a22e4bda0e5a5bd227d
密文(hex)        791f649faecfcd2eb42c33f163afe73b316ec2040d136d83087404
tag(hex)         c59b74618543fffce56cf607fbc5b826
```

> 这三个向量覆盖了互操作最容易出错的三个点：签名覆盖的字节、KDF 参数、GCM 的 AAD。

### 7.2 一致性套件

- `spec/vectors/*.json`：机器可读的向量（含期望输出）
- `npm run spec:check`：用实现去跑向量，逐字节比对
- CI 里再跑一个**独立第二实现**（200 行左右的 Go 或 Python 最小枢纽 + 客户端）：
  - 用同一份向量
  - 跨语言完成一次握手 + 收发一条加密消息
  - 任何一方改协议而不同步向量，CI 直接红

第二条是“保证不同实现不受影响”的硬约束——没有第二实现，规范只是愿望。

---

## 8. 版本路线

| 协议版本 | 范围 | 兼容策略 |
|---|---|---|
| **v1**（M1–M2） | 握手、relay、presence、lookup、text | 冻结后只加 `features` |
| v1+（M3） | 新增 `file-*`、`channel`、receipt features | 同版本内加 feature，不破坏 v1 |
| v2（M4） | 联邦：`to` 支持 `keyId@hubDomain`，新增 `fwd` 帧 | 大版本，`caps.min` 提升 |

---

## 9. 尚未定稿的点

1. **`seq` 的持久化**：进程重启后从 0 还是从磁盘恢复？建议恢复（否则接收方判重失效）。
2. **多设备**：一个 keyId 对应多设备时，`prekey` 需要是设备级列表（M3 补充）。
3. **联邦寻址**：`keyId@hubDomain` 还是独立 `hubId` 字段（M4 前定）。
4. **限流维度**：按 keyId 还是按连接（建议 keyId，防重连绕过）。
