# 荆昊（Hao Jing）个人学术主页

纯静态网站：`index.html` + `styles.css` + `script.js`，无需构建，可直接部署到 GitHub Pages。
版式参考（layout inspired by）[Jin Rui 的主页](https://jinruii.github.io/)，代码与内容均为独立编写。

## 部署到 GitHub Pages
1. 登录 GitHub，点右上角 **+ → New repository**。
2. 仓库名必须为 `你的用户名.github.io`（例如 `haojing.github.io`），选 **Public**，点 Create。
3. 在仓库页点 **Add file → Upload files**，把 `index.html`、`styles.css`、`script.js`（以及以后的头像、CV 文件）拖进去，点 **Commit changes**。
4. 进入 **Settings → Pages**，Source 选 **Deploy from a branch**，Branch 选 `main` / `(root)`，保存。
5. 等 1–2 分钟，访问 `https://你的用户名.github.io`。以后修改文件并提交，网站会自动更新。

## 修改文字（中英文）
- **英文**：直接写在 `index.html` 里带 `data-i18n="键名"` 的元素中。
- **中文**：写在 `script.js` 顶部的 `ZH` 对象里，键名与 `data-i18n` 一致。
- 新增一段文字：在 HTML 写英文并加 `data-i18n="新键名"`，再在 `ZH` 里加 `"新键名": "中文"`。没写中文的键会显示英文。
- 论文标题、作者等不需要翻译的内容不加 `data-i18n` 即可。
- 语言切换按钮在导航栏右侧；默认跟随浏览器语言，选择会保存在浏览器 localStorage。

## 头像 / CV
- 头像：把照片放到仓库（如 `avatar.jpg`），将 `index.html` 中 `<div class="portrait"><span>HJ</span></div>` 换成 `<img class="portrait" src="avatar.jpg" alt="Hao Jing">`。
- CV：上传 `cv.pdf`，把侧栏 CV 链接的 `href="#"` 改为 `href="cv.pdf"`。
- 邮箱：把 `EMAIL_PLACEHOLDER` 和所有【邮箱】替换为真实邮箱。

## 待补充清单（公开页面已隐藏，补齐后再显示）
- **CV**：上传 `cv.pdf` 后，取消 `index.html` 侧栏中 CV 那一行的注释。
- **Google Scholar / ORCID**：填入本人链接后取消注释。注意 0009-0008-3606-7035 是导师的 ORCID，不能用。
- **两个乡村数字网站的链接**（「走进56个村落」「社会生态韧性·数字观测工作台」）：拿到网址后，参照第一张卡片加上 `<a class="pf-link" ...>`。
- **2026 年无人机灾害监测项目的立项级别**：拿到立项文件前不要写级别。
- **第三篇论文的正式英文题名和投稿状态**：现在用的是工作译名，状态写的是“写作中”。
- **奖项具体月份**：国赛金奖 / 铜奖、大创结题、校园开放日目前只写到年份。
- **头像**：照片放进仓库后，按上文替换 HJ 占位块。
- **不要放到主页上的**：专利（目前只有技术交底书）、软著，以及 `source/` 文件夹（里面的原始材料含个人隐私，不要上传到 GitHub）。
