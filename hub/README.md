# @mishijian/lanim-hub

lan-im 的通信枢纽：**认证、路由、离线队列**，不解析、不存储任何消息内容。

- 协议：[PROTOCOL.md](../PROTOCOL.md)（HLP / LEP / LAP）
- 产品与架构：[RELAY-PRD.md](../RELAY-PRD.md)
- 规范向量：[spec/](../spec/README.md)

## 一条命令启动

```bash
npx @mishijian/lanim-hub --port 8787 --data ./hub-data
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

## 局域网使用

把枢纽跑在局域网里的一台机器上，其他人填 `ws://<那台机器IP>:8787`（或经反向代理的 `wss://`）。
流量只在内网，协议与加密跟公网部署完全一致。

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
