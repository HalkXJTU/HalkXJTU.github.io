# 本机验证码服务

此目录供本机预览使用。`node tools/preview.mjs` 在 http://127.0.0.1:4173/ 启动 SQLite 预览服务。站主个人预览密码和本机测试邀请存在仓库外的私有目录。运行 `node --test access-service/access.test.mjs` 验证本机授权、重试计数和停用行为。

正式访客由 GitHub Pages 上的脚本与加密授权文件在浏览器本地验码。ChatGPT Sites 只接收成功访问的匿名计数事件。正式站主使用本机邀请工具查看次数和分配邀请码。详见[主页使用说明](../README.md)。
