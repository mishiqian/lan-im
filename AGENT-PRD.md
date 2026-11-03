# LAN Agent 集市 · 需求文档

> 版本 v1.0（2026-10-30）｜归属：`@mishiqian/lan-im` 插件｜状态：设计定稿，M0 开发中

## 0. 一句话

让局域网里任何装了本插件的人，能把自己调教好的 agent 发布出来——别人可以**克隆到本机**用，也可以**直接调用**（作者机器上跑，结果回传）；全程不经过任何云端。

## 1. 背景与目标

现状：团队里会调 agent 的人，产出靠截图、口头传授、发文件夹传递。结果是配置走样、换人就废、没人敢改。

目标：
- 复制能力：一次发布，别人 5 分钟装上可用
- 借用能力：不想装、或需要作者机器上的数据/算力时，直接调用
- 全程局域网内完成，无云、无账号体系依赖、无计费

## 2. 名词

| 词 | 含义 |
|---|---|
| Agent | 一个可发布单元：角色卡 + preset + 技能 + 样例 |
| 卡片 | `agent.json`，描述 agent 是什么、要什么权限、长什么样 |
| 克隆 | 接收方拿到源码，在自己机器、自己的模型上跑 |
| 服务 | 接收方发任务给作者的 agent，作者机器上跑，结果回传 |
| ServiceSession | 一个调用者 × 一个 agent 的一段连续对话；隔离单位 |
| 能力包络 | 带范围限定的工具授权集合（不是开关） |
| keyId | 身份公钥的指纹，真正唯一的身份标识 |

## 3. 对象模型

```
Agent（卡片 + preset + 技能 + 样例，签名防篡改）
  └─ ServiceSession（调用者 × agent；独立上下文/目录/预算）
       └─ Turn（一问 + 一答 + 期间工具活动）
```

**会话不是"一次调用"。** 同一调用者可续用同一会话；不同调用者之间永不共享会话。

## 4. 功能需求

### F1 创作与发布（M0）

- F1.1 从「名称 + 角色设定」生成 agent 包：拿本机一份 preset 当骨架，把 persona 段换成作者的 prompt
- F1.2 卡片必须含：id、版本（semver）、名称、一句话说明、**角色设定 prompt**（核心，10–8000 字）；工具与样例可选
- F1.3 发布前本地校验；非法卡片给出字段级错误
- F1.4 卡片带内容哈希；M2 起加作者签名
- F1.5 发布动作需二次确认（对外可见，不可撤回）

### F2 目录与发现（M0）

- F2.1 发布后通过现有广播/通道让局域网内其他实例看到
- F2.2 目录条目按 `作者 + id` 去重，保留最新版本
- F2.3 目录落盘，重启不丢
- F2.4 展示：名称、作者、版本、一句话说明、工具清单、样例数

### F3 克隆安装（M0）

- F3.1 安装前展示「安装卡」：说明、所需工具/权限、样例、作者、哈希
- F3.2 未确认不得写盘
- F3.3 校验哈希；不一致拒绝
- F3.4 依赖检查：模型、工具、权限缺什么直接列出
- F3.5 写入 `~/.dsh/.agent-presets/<作者>-<id>/`，安装后 DSH 的 preset 列表可见
- F3.6 记录安装来源与版本；M2 提供「有新版本」提示（不自动升级）

### F4 服务调用 · 会话托管（M1）

- F4.1 远端会话 = 作者机器上的一个 DSH session，复用现有 agent loop，不新造循环
- F4.2 生命周期：`open → send → (idle 30min) suspend → resume → close`；作者可 `kill`
- F4.3 每会话独立工作目录 `agent-share/<agent>/sessions/<sid>/`
- F4.4 流式回传：状态、文本增量、工具起止；不回传工具原始输出
- F4.5 作者离线时消息进 outbox，上线后补发
- F4.6 每次 Turn 带 `turnId`，重发去重

### F5 能力包络（M1）

- F5.1 卡片声明的工具必须带范围：`fs.read{scope}`、`fs.write{scope}`、`bash{allow,deny}`、`web.fetch{allow}`
- F5.2 四道闸全在执行层（`tools/pre-execute`），不写提示词：
  1. 工具白名单
  2. 参数范围（路径 realpath 前缀、命令前缀、域名）
  3. 越界动作 → 审批（弹给作者，60s 超时即拒）
  4. 预算（token/时长）超限中止并返回已产出部分
- F5.3 服务型 agent 的 fs 根默认 `~/.dsh/agent-share/<agent>/`，不是作者真实工作区
- F5.4 每次工具调用写入会话事件（可回放审计）

### F6 配额与熔断（M1）

- F6.1 每调用者日配额 = 会话预算（卡片声明，默认 30 轮 / 60k token / 30 分钟）
- F6.2 每会话预算：30 轮 / 60k token / 30 分钟活跃
- F6.3 全局日预算 + 一键熔断（暂停服务，已开会话挂起）
- F6.4 不做分层降级：**身份验证通过 + 卡片开放调用 = 放行**，否则一律拒绝；
  给了哪些工具就只给哪些（能力包络），没有「陌生人只读」这一层

### F7 身份与信任（M1）

- F7.1 建号时生成 Ed25519 密钥对，私钥 0600 存于插件数据目录
- F7.2 `keyId = base32(sha256(pubkey))[:16]`，显示为 `@alice · K7QF`
- F7.3 建连握手：交换 nodeId/accountId/pubkey + 签名，双向验签
- F7.4 TOFU 钉住 `accountId → keyId`；同账号换钥弹「身份冲突」告警并拒绝调用
- F7.5 `agent.open/send` 帧带签名；`turnId + ts` 防重放
- F7.6 跨机器同一身份：M2 提供导出/导入（口令加密私钥）

### F8 会话管理（M1）

- F8.1 会话**永久保留**，不自动清理
- F8.2 作者侧会话列表：谁、何时开始、几轮、token、状态；分页 + 筛选
- F8.3 会话详情：事件流回放（工具名/耗时/参数摘要）；调用方看不到工具原始输出
- F8.4 操作：中止、挂起、删除、拉黑账号、调整该会话预算
- F8.5 会话索引存 `ctx.storage`，与日志删除联动；索引为派生，不造第二事实源
- F8.6 存储阈值提醒：单 agent 超过 1 GB 时作者端提示，由作者手动清理

### F9 隐私与告知（M1）

- F9.1 调用方首次连接某 agent 时明确告知：对话永久保存在作者机器上
- F9.2 未确认不得发送消息
- F9.3 作者可导出/删除单个会话

### F10 UI（M0 起）

- M0：Agent 页（我的 / 可用）、卡片详情、安装确认、本地试跑
- M1：作者侧服务会话列表与审计、调用方 agent 聊天界面（复用消息 UI）
- 通用：键盘可达、`focus-visible`、对比度 AA、`prefers-reduced-motion`

## 5. 数据格式

### agent.json

```json
{
  "schema": 1,
  "id": "pr-reviewer",
  "version": "1.2.0",
  "name": "PR 审阅",
  "summary": "读 diff，按团队规范出评审意见",
  "prompt": "你是代码评审员。先看风险，再看测试覆盖，最后给一句结论。",
  "author": { "accountId": "alice", "keyId": "K7QF3M2X" },
  "input": { "type": "text", "hint": "贴 diff 或 PR 链接" },
  "output": { "type": "markdown" },
  "requires": {
    "model": "deepseek-flash",
    "permissions": "read-only",
    "tools": [
      { "name": "fs.read", "scope": "share/**" },
      { "name": "bash", "allow": ["git log", "rg ", "ls"], "deny": ["rm", "curl", "ssh"] }
    ],
    "budget": { "turns": 30, "tokens": 60000, "seconds": 1800 }
  },
  "exposure": { "cloneable": true, "callable": false, "acl": "lan" },
  "samples": [{ "in": "…", "out": "…" }],
  "integrity": { "sha256": "…" }
}
```

### 包结构

```
<id>/
  agent.json          # 卡片
  preset.yml          # agent-presets 组合
  skills/*.md         # 技能正文
  samples/*.json      # 样例（可选）
```

传输：M0 用单文件 JSON 包（`*.agentpkg.json`，文本内联、二进制 base64），走现有文件通道。

### 服务帧

```
hello        { v, nodeId, accountId, name, pubkey, ts, sig }
hello_ack    { nodeId, accountId, pubkey, ts, sig }
agent.open   { agentId, sessionId?, callerId, ts, sig }
agent.opened { sessionId, resumed, quota }
agent.send   { sessionId, turnId, text, ts, sig }
agent.event  { sessionId, turnId, kind: text|tool|status|error, data }
agent.result { sessionId, turnId, output, usage }
agent.close  { sessionId }
agent.kill   { sessionId }
```

## 6. 非功能需求

- 性能：卡片列表 1000 条分页不卡；会话列表首屏 ≤300ms
- 存储：永久保留；单 agent 1 GB 提醒阈值
- 兼容：DSH ≥ 0.2.1-rc.2；不改 agent-loop
- 安全：越权尝试 100% 拒绝（工具/路径/身份/重放/配额五类）
- 可观测：每次运行可在会话日志回放

## 7. 里程碑

| 阶段 | 范围 | 估时 | 出口 |
|---|---|---|---|
| M0 | 卡片 + 发布 + 目录 + 克隆安装 + 试跑（无远程调用） | 7–9 人日 | 另一台机器装完，3 个样例跑通 2 个 |
| M1 | 身份 + 会话托管 + 能力包络 + 配额 + 两端 UI | 22–25 人日 | 20 次调用，越权 0 放行 |
| M2 | 审批弹层 + HTTP 入口 + 版本升级 + 跨机身份 | 14–16 人日 | 10 次带工具调用，0 泄漏 |

## 8. 验收

- M0：A 发布 → B 目录可见 → B 安装 → preset 列表出现 → 跑样例 2/3 通过；哈希篡改包被拒
- M1：跨机聊天式调用；作者离线消息不丢；路径逃逸/越权工具/冒名/重放/超配额五类全部拒绝；作者能 kill 会话
- M2：curl 调 HTTP 入口返回 401/200 正确；版本升级提示；导出私钥后另一台 keyId 一致

## 9. 风险与假设

| 风险 | 级别 | 缓解 |
|---|---|---|
| 提示词注入读走作者文件 | 高 | 包络 scope 默认指向 `agent-share/`，真实工作区需显式开启 |
| 身份首次接触被中间人 | 中 | TOFU 钉住 + 冲突告警；已知局限，写进文档 |
| 永久保留导致磁盘增长 | 中 | 1 GB 阈值提醒 + 手动清理 + 导出 |
| 作者离线服务不可用 | 中 | 异步队列 + 可退回克隆 |
| 克隆源码被冒名转载 | 中 | 哈希 + 作者 keyId；M2 签名 |

假设：
- 使用范围是同一局域网；准入只看两件事——身份验证通过、卡片开放调用
- 单次调用成本 ¥0.01–0.05 可接受
- 克隆内容公开可见可接受

## 10. 不做的事

公网穿透、计费结算、模型训练、多 agent 编排、自动清理会话、云同步。
