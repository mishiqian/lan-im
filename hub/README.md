# @mishijian/lanim-hub

lan-im 的通信枢纽：**认证、路由、离线队列**，不解析、不存储任何消息内容。

- 协议：[PROTOCOL.md](../PROTOCOL.md)（HLP / LEP / LAP）
- 产品与架构：[RELAY-PRD.md](../RELAY-PRD.md)
- 规范向量：[spec/](../spec/README.md)

## 部署方式（三选一）

### A. Docker（推荐）

```bash
# 方式 1：compose（仓库内的 hub/ 目录）
cd hub && docker compose up -d

# 方式 2：直接构建
docker build -t lanim-hub ./hub
docker run -d --name lanim-hub -p 8787:8787 -v "$PWD/data:/data" lanim-hub
```

数据卷挂在 `/data`，重启容器不会丢邀请码与队列。

### B. 全局安装（有 Node 20+ 的机器）

```bash
npm install -g /path/to/lan-im/hub     # 从源码目录安装
lanim-hub --port 8787 --data ./hub-data --tls
```

（发布到 npm 之后即可 `npm i -g @mishijian/lanim-hub`，当前需从本地目录安装。）

### C. 直接跑（调试用）

```bash
cd /path/to/lan-im/hub
npm install --omit=dev
node bin/lanim-hub.mjs --port 8787 --data ./hub-data
```

### systemd（Linux 常驻）

```ini
[Unit]
Description=lan-im hub
After=network.target

[Service]
WorkingDirectory=/opt/lanim-hub
ExecStart=/usr/bin/node bin/lanim-hub.mjs --host 0.0.0.0 --port 8787 --data /var/lib/lanim-hub
Restart=always
User=lanim

[Install]
WantedBy=multi-user.target
```

首次启动会生成邀请码并打印接入信息：

```
lan-im 枢纽已启动
  地址      ws://<本机IP>:8787
  健康检查  http://127.0.0.1:8787/health
  管理接口  http://127.0.0.1:8787/admin/nodes
  邀请码    K7QF-3M2X-9WPB
  数据目录  ./hub-data
```

自动生成的 `invites.json` 只有权限 0600 的持有者可读。

## 使用方怎么接

任何装了插件的人，在「个人中心 → 通信枢纽」里填：

```
地址    ws://<枢纽主机>:8787/hlp    或   wss://hub.example.com/hlp
邀请码  <枢纽启动时打印的那串>
```

点「连接」即可。插件自带的「在本机启动枢纽」只是把这套流程自动化，
和独立部署的枢纽**完全同源**：可以随时在两者之间切换，客户端只改地址。

## TLS

本版本默认明文 `ws`，**仅建议本机或可信内网**。公网部署请在前面放一层反向代理终止 TLS：

```nginx
location /hlp {
  proxy_pass http://127.0.0.1:8787;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}
```

客户端填 `wss://你的域名` 即可。（内置自签证书在 M2 补齐。）

## 接口

| 路径 | 用途 |
|---|---|
| `ws://…/hlp` | HLP 协议入口 |
| `GET /health` | 存活与节点数 |
| `GET /admin/nodes` | 在线节点列表（keyId / account / online / lastSeen） |

## 测试

```bash
node --test test/*.test.mjs
```

包含两类：

1. `smoke.test.mjs` — 两个客户端完成握手、互发一条**端到端加密**消息、验证离线队列投递
2. `vectors.test.mjs` — 用 `spec/vectors` 逐字节校验握手签名、ECDH+HKDF、AES-GCM 信封

`smoke.test.mjs` 里的客户端是**按规范独立实现**的（不 import 客户端代码），
这也是“协议可被第三方实现”的第一块验证。

## 现在做了什么 / 还没做什么

已实现：hello/challenge/auth、ready、relay 路由、离线队列、lookup（prekey 目录）、
presence 广播、ping、邀请码、错误码、健康检查。

未实现（M2）：限流、队列上限落盘、管理页、自签 TLS 内置、节点封禁、审计日志。
