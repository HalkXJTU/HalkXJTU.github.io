# 邀请验证服务

静态首页可继续使用 GitHub Pages。独立的 Cloudflare Worker 验证邀请码，并从 D1 原子更新该邀请的成功解锁次数。每个邀请码有 128 位随机数，创建时完整显示一次，数据库保存其 HMAC。收件人备注由站主填写。访客接口只接收解锁所需字段，应用没有 IP、邮箱或浏览轨迹字段。

## 部署 Worker

在此目录旁准备一份私有部署工作副本，使用 Node.js 与官方 Wrangler。将 `wrangler.example.toml` 复制为 `wrangler.toml`。确认 `ALLOWED_ORIGINS` 为主页实际使用的精确 HTTPS 来源。多个来源使用逗号分隔。

1. 运行 `npx wrangler login` 与 `npx wrangler d1 create academic-invitations`，把返回的数据库 ID 写进 `wrangler.toml` 的 `database_id`。
2. 运行 `npx wrangler d1 migrations apply academic-invitations --remote` 建表。运行 `npx wrangler deploy` 发布 Worker。
3. 使用 `npx wrangler secret put ADMIN_TOKEN` 和 `npx wrangler secret put INVITE_HMAC_KEY` 分别保存两个独立、高熵的随机秘密。两者各使用至少 32 个随机字节；更换 HMAC 密钥会使所有已有邀请码失效。
4. 使用 `npx wrangler secret put SITE_RELEASE` 保存本次发布的单个 JSON 对象，属性 `id` 为公开发布编号，`key` 为私有的 32 字节 AES 密钥（标准 Base64）。每次重新打包，更新这一个 Secret，使版本与解密密钥一起生效。
5. 将静态页的验证接口设置为此 Worker 的 HTTPS 地址加 `/access/unlock`，并把站主工具指向同一 Worker。私有部署文件、站主令牌、发给收件人的明码及发布密钥应保存在公开仓库之外。

接口未配置好时拒绝解锁。过期版本收到 409，错误或撤销的邀请码收到 403。撤销对后续解锁生效。浏览器已解密的会话由前端控制其寿命。

[Cloudflare Workers 快速入门](https://developers.cloudflare.com/workers/get-started/guide/) · [D1 命令](https://developers.cloudflare.com/d1/wrangler-commands/) · [Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) · [D1 批处理的事务语义](https://developers.cloudflare.com/d1/worker-api/d1-database/)

## 本地预览和接口

本地预览服务使用 Node.js 24 的内置 SQLite。传给 `createLocalAccessService(privateDir)` 的绝对路径必须位于发布目录以外。该目录中的 `access-config.json` 包含 `ADMIN_TOKEN`、`INVITE_HMAC_KEY`、`SITE_RELEASE` 对象和 `ALLOWED_ORIGINS`。本地预览通常使用 `http://127.0.0.1:4173`。SQLite 数据文件会在同一私有目录内创建。运行 `node --test access-service/access.test.mjs` 可从项目根目录执行本地回归测试。

- `POST /access/unlock` 接收 `{code,release,visit?}`，成功返回 `{id,key}`。可选 UUID v4 参数 `visit` 用于将同一邀请、同一发布的网络重试在十分钟内合并计数。临时回执只含不可逆的摘要和失效时间，后续请求清理过期回执。
- `POST /access/admin/invites` 接收 `{label}`，返回 `{id,label,code}`。
- `GET /access/admin/invites` 返回 `{invites:[{id,label,successes,revoked}]}`。
- `POST /access/admin/invites/{id}/revoke` 撤销一个邀请码。

站主接口通过请求头 `Authorization: Bearer …` 验证。所有返回均带 `Cache-Control: no-store`。浏览器跨域请求仅允许配置的来源。
