# 局域网即时通信（lan-im）

让局域网内所有**安装本插件**的 DeepSeek Harness 实例以**账号身份**互相发现、可靠地互发消息聊天。

## 特性

- **账号体系**：以账号（username + 显示名）而非机器作为身份；首次打开设置账号，之后免登录。
- **发现**：**mDNS + UDP 广播双通道**，按设备去重；组播被隔离的网络也能发现。
- **可靠消息**：私聊**送达确认（ack）+ 离线补发**（持久化 outbox，对端上线自动补发），群聊尽力投递。
- **实时推送**：客户端↔宿主走浏览器原生 **WebSocket**（同源升级，无轮询），窗口关闭也保持连接。
- **通知未读**：悬浮按钮**未读角标** + 桌面通知（窗口关闭/页面不可见时）。
- **频道**：UUID 稳定标识，支持重命名/描述/解散；公共频道 + 私有频道（成员邀请/移除、消息按成员路由）。
- **局域网网盘**：每个频道一个共享文件空间，索引广播 + 按需拉取 + 本地缓存；上传者可删除。
- **历史**：本地落盘到 `~/.dsh/plugins-data/lan-im/`（内存窗口上限 500 条，历史文件全量保留）。
- **UI**：侧边栏入口 + 悬浮可拖拽窗（✕/Esc/点击外关闭）+ 🛠 诊断日志。

## 前置条件

- DeepSeek Harness 标准组合（已含 `webServer`，支持 `registerUpgrade`）。
- 同一局域网、各节点互通；放行 **UDP 5353（mDNS 组播）** 与 **UDP 42123（广播兜底）**，以及节点间 WebSocket 临时端口。

## 安装

```sh
# 方式一：本地目录
cd lan-im && npm install && npm run build
dsh plugin --profile web add .
dsh web     # 重启组合生效

# 方式二：git 源
dsh plugin --profile web add git:<仓库地址>.git && dsh web

# 方式三：npm 源（发布后）
dsh plugin --profile web add @dsh-external/lan-im && dsh web

# 方式四：静态压缩包（已构建好 lib，源码一并附带）
tar -xzf lan-im-plugin-static-v0.5.0.tar.gz
cd lan-im && npm install && npm run build
dsh plugin --profile web add .
dsh web
```

> `dsh web` 重启会中断当前 GUI 会话，请自行择机执行。

## 使用

1. 首次打开悬浮窗 → 输入**账号 + 显示名**（密码可选）创建账号。
2. 侧边栏「局域网聊天」标签 / 右下角 💬 按钮 / `Ctrl+Shift+L` 唤起悬浮窗。
3. 公共频道群发，或点左侧某账号切换**一对一私聊**（已送达有状态提示）。
4. 频道内可切换「消息 / 文件」tab；文件 tab 支持上传、下载、预览与删除共享文件。
5. 窗口关闭时来消息 → 悬浮按钮出现未读角标 + 桌面通知（首次点击按钮时授权）。

## 网络端口

| 端口 | 协议 | 用途 |
|---|---|---|
| 5353/UDP | mDNS 组播（224.0.0.251） | 节点发现（主通道） |
| 42123/UDP | 广播 | 节点发现（兜底通道） |
| 临时 TCP | WebSocket | 节点间消息（mDNS SRV 广播实际端口） |

## 构建与验证

```sh
npm install && npm run build

# 冒烟：宿主
node -e "import('./lib/index.js').then(m=>console.log(typeof m.apply, JSON.stringify(m.inject)))"
# 期望: function ["webServer"]

# 端到端自测（账号/发现/消息/频道管理/私有频道/网盘按需拉取/离线补发/PSK/落盘）
node scripts/e2e.mjs

# 扫描局域网节点（诊断）
node scripts/diag.mjs
```

## 排障

打开悬浮窗右上角 **🛠** 查看诊断日志，或 `node scripts/diag.mjs` 扫描节点。

- 扫不到节点 → 放行 UDP 5353 + 42123（入站+出站），确认同子网、组播/广播未被隔离。
- 私聊一直「已发送」不「已送达」→ 对方节点离线或 WebSocket 被拦，消息已入待发队列，对方上线后自动补发。

## 已知限制

- 频道消息为尽力投递；私聊补发有 outbox 容量上限（每账号 200 条，超出丢最旧）。
- 共享文件 owner 离线时，只能使用已缓存文件，未缓存文件需等 owner 上线。
- 密码 P0 仅存哈希，不做跨机校验；真正的跨节点信任见后续「共享密钥（PSK）」。
- 无端到端加密，明文传输，仅适用于可信局域网。
- 未读计数为会话内状态，浏览器刷新后清零。

## 目录结构

```
lan-im/
├── package.json             # dsh.client + dsh.bundle.patch + 依赖(ws, bonjour-service)
├── cordis.patch.yml
├── tsconfig.json / tsconfig.client.json / tsdown.config.mjs
├── src/
│   ├── protocol.ts          # 共享协议/类型/常量（宿主与客户端共用）
│   ├── index.ts             # 宿主入口：只做插件注册 + 生命周期接线
│   ├── host/                # 宿主端按领域拆分
│   │   ├── runtime.ts       # 组合根：装配各模块，编排启动/停止
│   │   ├── storage.ts       # 数据目录、config/历史/outbox 落盘
│   │   ├── client-hub.ts    # 宿主 → 浏览器客户端事件广播
│   │   ├── channel-registry.ts # 频道注册与同步
│   │   ├── message-store.ts # 实时消息窗口 + 历史回放/搜索
│   │   ├── outbox.ts        # 私聊离线补发队列
│   │   ├── peer-network.ts  # 节点间 WebSocket 连接与 wire 协议
│   │   ├── discovery.ts     # mDNS + UDP 双通道发现
│   │   ├── messaging.ts     # 发送 / 撤回 / 编辑
│   │   ├── file-transfer.ts # 消息附件分片传输
│   │   ├── shared-file-store.ts # 频道共享文件索引 + 按需拉取/缓存
│   │   ├── settings.ts      # 账号 / 显示名 / PSK 设置
│   │   ├── client-bridge.ts # 浏览器 WS 协议桥
│   │   ├── http-gateway.ts  # REST API + 文件下载 + WS 升级
│   │   └── util.ts          # 纯函数（hash/ip/body 解析等）
│   └── client/
│       ├── index.ts         # 客户端入口：App 状态编排 + DOM 挂载
│       ├── components.ts    # 聊天窗口等 UI 组件
│       ├── styles.ts        # 悬浮窗样式
│       └── format.ts        # 格式化/深色/通知等纯函数
├── scripts/                 # e2e 自测、diag 诊断
└── lib/                     # 构建产物
```
