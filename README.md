# 学术主页与专属邀请

站点的新版和旧版仍是静态页面，可部署到 GitHub Pages。访客使用各自收到的邀请码解锁，两版共用同一阅读会话。独立的验证服务保存邀请码摘要和累计次数，站主在邀请邮件中说明计数方式。

## 本机预览与邀请管理

使用 Node.js 24。在发布目录运行 `node tools/preview.mjs`，再运行 `node tools/invitations.mjs`。前者提供 [访客预览](http://127.0.0.1:4173/)，后者提供[仅限本机的邀请管理](http://127.0.0.1:4174/)。打开管理页，填写只够自己识别收件人的备注，即可生成专属邀请码、复制邀请文字、查看成功解锁次数或停用邀请码。

站主也可以在本机预览的同一输入框使用已配置的四位个人密码。预览后台将站主的解锁次数单独列出。要设置或更换此密码，可在 PowerShell 7 中运行 `(Read-Host '新的四位密码' -MaskInput) | node tools/preview.mjs --set-owner-pin`。正式网站使用为各位收件人生成的邀请码。

本机模式使用独立的 SQLite 数据库和私有配置。Windows 默认为 `%LOCALAPPDATA%\HalkHomepage\access-local`。保管此目录及 `%LOCALAPPDATA%\HalkHomepage\releases` 的私有发布密钥。有密文的完整 ZIP 供部署使用，单独解压 ZIP 无法恢复访问凭据。新设备需要从本人的私有备份恢复密钥，或从私有原稿重新打包。

## 正式发信与线上统计

1. 按[部署说明](access-service/README.md)发布验证服务，使用独立的生产数据库和随机管理密钥。Pages 和 Worker 均配置好后再发送邀请。
2. 将本次发布密钥文件交给 **Worker Secrets** 的 `SITE_RELEASE`。可用 PowerShell 在本机授权的 Wrangler 工作目录运行下方命令。文件路径中的发布编号来自公开 `gate-config.json` 的 `id`。密钥文件、管理员令牌、名单、原始邀请码和数据库只保存在站主私有环境。
3. 在公开 `gate-config.json` 里设置 `accessEndpoint` 为已部署 Worker 的 HTTPS 地址，路径为 `/access/unlock`。保持 `id`、`manifestIv` 和同一批 `vault/` 文件配套。仅设置站主工具的地址不能代替访客端的此项配置。
4. 在发布仓库之外准备站主管理配置 JSON，包含 `API_BASE`（Worker 的 HTTPS 地址加 `/access`）、`PUBLIC_SITE_URL`（公开主页的 HTTPS 地址）、`ADMIN_TOKEN`（同 Worker 管理 Secret）。将绝对路径赋给环境变量 `SITE_OPERATOR_CONFIG` 后启动 `node tools/invitations.mjs`。本机后台显示“线上主页”，此时生成的邀请与统计来自正式数据。
5. 每位收件人使用各自的码，邮件附主页链接、专属码及按码计数的简短说明。多位收件人分别拟稿。也可运行 `node tools/invitations.mjs create "收件人备注"` 和 `node tools/invitations.mjs list`。每个码只在生成时显示一次。

```powershell
$siteConfigFile = Read-Host '输入本次公开发布文件 gate-config.json 的完整路径'
$releaseId = (Get-Content -Raw -LiteralPath $siteConfigFile | ConvertFrom-Json).id
$releaseFile = Join-Path $env:LOCALAPPDATA "HalkHomepage\releases\$releaseId.json"
Get-Content -Raw -LiteralPath $releaseFile | npx wrangler secret put SITE_RELEASE
```

正确的邀请码获准解锁时计一次。普通刷新、切换语言、切换版式不增加次数。短时间内重试同一网络请求会去重。转发会沿用同一码的计数。停用可阻止后续解锁，已获准的标签页会话最长持续两小时。

## 更新内容

在独立私有目录编辑原稿。运行 `node tools/pack-site.mjs "原稿目录" "新的输出目录"`，得到 `vault/` 与 `gate-config.json`。设置环境变量 `SITE_ACCESS_ENDPOINT` 可将经确认的生产验证地址写入发布配置。对应 AES-256 密钥只写入仓库外的私有 `releases` 目录。将密钥部署到验证服务，然后发布本批静态文件。保留生产数据库和 `INVITE_HMAC_KEY` 即可延续已有邀请与计数。

主页历史上公开的内容可能仍保存在以往提交或他人的副本中。站点代码不收集访客 IP、邮箱或页面浏览轨迹。

入口构图曾参考 SO called 的 [Animated Characters Login Page](https://21st.dev/@socolled/components/animated-characters-login-page)，目前的角色图形和指针定位逻辑由站点本地实现。
