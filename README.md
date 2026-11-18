# 学术主页与专属邀请码

GitHub Pages 从 main 根目录提供新版和旧版主页、邀请码输入界面、三语脚本、加密资源及公开的邀请授权文件。浏览器用收到的邀请码在本地打开对应授权，取得本版资料的解密密钥。GitHub Pages 与其静态资源可访问时即可阅读。ChatGPT Sites 提供一个独立的访问计数接口，首页在解锁成功后异步上报。

## 访客与计数

- 访客打开 https://halkxjtu.github.io/ 并粘贴邮件中的专属邀请码。GitHub 上的 `invitation-grants.json` 包含随机标识和加密后的授权，不含邀请码、收件人姓名或邮箱。
- 计数服务为 `https://halk-invite-access.wxz20050705.chatgpt.site/access/visits`。浏览器发送由邀请码单独派生的计数凭据和随机事件编号。服务保存匿名计数，包括重试去重所需的记录。收件人备注在站主的电脑上管理。
- 刷新或切换语言、版式会沿用当前会话。统计服务无法连接时仍可解锁，浏览器在条件允许时补报。长期断网、未再次打开或清理浏览器数据可能导致少记。转发邀请码会共用该码的计数。
- GitHub Pages 提供的是可下载的资料。已解锁的访客可以保存已展示的内容，以前公开过的历史提交和缓存也可能保留旧版。

## 本机预览和正式邀请

使用 Node.js 24，运行 `node tools/preview.mjs` 后打开 http://127.0.0.1:4173/ 。该地址使用独立的本机测试库，也支持站主已配置的四位个人密码。正式首页使用高熵的独立邀请码。

正式管理使用站主电脑上的私有 `operator.json`。在 PowerShell 中，将 `$env:SITE_OPERATOR_CONFIG` 设为该文件的绝对路径，设置 `$env:SITE_OPERATOR_PORT = '4175'`，再运行 `node tools/invitations.mjs`。在 http://127.0.0.1:4175/ 分配邀请码、查看成功次数。默认的本机测试管理位于端口 4174，使用独立数据库。私有配置、邀请码池、名单及发布密钥均应保存在仓库外并由站主备份。

| 操作 | 已选择正式配置后的命令 |
| --- | --- |
| 建立或复用本站的私有邀请码池 | `node tools/invitations.mjs init` |
| 生成本版公开授权文件 | `node tools/invitations.mjs export` |
| 向 Sites 登记匿名计数摘要 | `node tools/invitations.mjs register` |
| 为一位收件人分配邀请码 | `node tools/invitations.mjs create "收件人备注"` |
| 按收件人查看计数 | `node tools/invitations.mjs list` |
| 停用邀请码 | `node tools/invitations.mjs revoke <标识>`，随后重新导出并发布授权文件 |

从已发布的池中给每位老师分配一个码，每人一封邮件，附同一个主页网址及该收件人的码，并说明主页统计成功解锁次数。新分配不需要逐封重新发布。停用会在更新后的 GitHub 授权文件发布后阻止新的解锁。已有会话可继续使用至到期。

## 更新主页

在独立私有工作区维护 HTML、CSS、脚本与资料。运行 `node tools/pack-site.mjs "私有原稿目录" "新的输出目录"` 创建新的一批密文。若需要计数，打包前将 `SITE_STATS_ENDPOINT` 设为本页所列的 HTTPS 计数接口。发布密钥保存在仓库外的私有 releases 目录。将配套的 `vault/`、`gate-config.json` 放入发布目录，然后用同一私有池执行 `export` 得到与该发布编号匹配的 `invitation-grants.json`。这三者需一起发布。新内容的密钥只在站主机生成，Sites 配置只包含统计管理令牌。

入口构图曾参考 SO called 的 [Animated Characters Login Page](https://21st.dev/@socolled/components/animated-characters-login-page)。
