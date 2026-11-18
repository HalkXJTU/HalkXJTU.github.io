export function dashboard(session, live) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <meta name="operator-session" content="${session}">
  <title>邀请管理 · 学术主页</title>
  <style>
    :root{color-scheme:light;--ink:#202c2a;--muted:#4f615c;--teal:#225e59;accent-color:var(--teal)}
    *{box-sizing:border-box}
    body{margin:0;background:#f7f6f0;color:var(--ink);font:16px/1.55 "Segoe UI",Arial,"Microsoft YaHei",sans-serif}
    main{width:min(850px,100%);margin:auto;padding:clamp(24px,6vw,68px) clamp(18px,4vw,42px)}
    h1,h2,h3,p{margin:0}h1{font-size:clamp(27px,4vw,38px);line-height:1.2}h2{font-size:20px}h3{font-size:16px}
    header,.section-title{display:flex;align-items:center;justify-content:space-between;gap:12px}
    .target,.help,.status{color:var(--muted);font-size:14px}
    .target{border-bottom:2px solid #8dada1;padding:4px 0;white-space:nowrap}
    .section{background:#fffefb;border:1px solid #d8dcd3;border-radius:12px;padding:clamp(16px,3vw,26px);margin-top:24px}
    .help{margin-top:6px}.status{margin:10px 0 0}.status:empty{display:none}.error{color:#8b3a2d}
    form{margin-top:16px}label{font-size:14px;font-weight:600}.entry{display:flex;gap:10px;margin-top:5px}
    input,button,textarea{font:inherit}input,textarea{border:1px solid #94a49b;border-radius:6px;background:#fff;color:var(--ink)}
    input{flex:1;min-width:0;padding:9px 10px}button{min-height:42px;border-radius:6px;padding:7px 14px;cursor:pointer}
    button:disabled{opacity:.6;cursor:wait}.primary{background:var(--teal);border:1px solid var(--teal);color:#fff}
    .plain{background:transparent;border:1px solid #aab8af;color:var(--teal)}.stop{color:#854634;border-color:#cfb4a6}
    button:hover:not(:disabled){filter:brightness(.91)}:focus-visible{outline:3px solid #438077;outline-offset:2px}
    #created{background:#eff5ef;border:1px solid #b8d0bd;padding:16px;margin-top:16px;border-radius:8px}
    textarea{display:block;margin:10px 0;padding:10px;width:100%;resize:vertical;min-height:6.5em;font-size:14px}
    .actions{display:flex;gap:8px;flex-wrap:wrap}.scroll{overflow-x:auto}table{margin-top:12px;width:100%;border-collapse:collapse;text-align:left;font-size:14px}
    th,td{border-bottom:1px solid #d8ded7;padding:10px 8px 10px 0;vertical-align:middle}thead{color:var(--muted)}
    td:first-child{overflow-wrap:anywhere}td:last-child{text-align:right}td:nth-child(2){font-variant-numeric:tabular-nums}
    td:nth-child(3){white-space:nowrap}tbody tr:last-child td{border-bottom:0}.empty{color:var(--muted);text-align:left!important}
    @media(max-width:490px){.entry{flex-direction:column}.section{padding:14px}.section-title{align-items:baseline}td,th{font-size:13px;padding-right:5px}td button{padding:6px 8px}}
  </style>
  <script src="/operator.js" defer></script>
</head>
<body data-offline-grants="${live ? 'true' : 'false'}">
  <main>
    <header><h1>邀请管理</h1><span class="target">${live ? '线上主页' : '本机预览'}</span></header>
    <section class="section" aria-labelledby="issue-title">
      <h2 id="issue-title">生成专属邀请码</h2>
      <p class="help">${live ? '从本机邀请池分配；再次输入同一备注可取回该收件人的有效码。' : '这里的链接和邀请码仅供本机预览。给老师发信时，请使用正式邀请池。'}</p>
      <form id="issue"><label for="recipient">收件人备注</label>
        <div class="entry"><input id="recipient" name="recipient" required autocomplete="off"><button class="primary" type="submit">生成邀请码</button></div>
      </form>
      <p class="status" id="issue-status" role="status"></p>
      <div id="created" hidden><h3 id="created-for"></h3>
        <p class="help">${live ? '请将主页地址和这枚专用码一并发给收件人。' : '请现在保存邀请码，离开后无法在列表中查看原码。'}</p>
        <textarea id="invite-text" aria-label="可复制的邀请文字" rows="3" readonly></textarea>
        <div class="actions"><button type="button" class="primary" id="copy">复制邀请文字</button><button type="button" class="plain" id="hide">收起并清除</button></div>
      </div>
    </section>
    <section class="section" aria-labelledby="counts-title">
      <div class="section-title"><h2 id="counts-title">成功解锁次数</h2><button type="button" class="plain" id="reload">刷新统计</button></div>
      <p class="help">${live ? '这里显示统计服务收到的成功解锁次数。浏览器离线或未能送达的访问可能漏计。' : '每次用邀请码验证成功计一次。'}刷新页面、同一会话内切换版本不会增加次数。邀请码被转发后，次数也会记在原码上。</p>
      <p class="status" id="count-status" role="status"></p>
      <div class="scroll"><table aria-label="按邀请码统计的成功解锁次数">
        <thead><tr><th scope="col">收件人备注</th><th scope="col" aria-sort="descending">次数 ↓</th><th scope="col">状态</th><th scope="col" aria-label="操作"></th></tr></thead>
        <tbody id="counts"></tbody>
      </table></div>
    </section>
  </main>
</body></html>`;
}
