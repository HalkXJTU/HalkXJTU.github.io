'use strict';
const session = document.querySelector('meta[name="operator-session"]').content;
const offlineGrants = document.body.dataset.offlineGrants === 'true';
const form = document.querySelector('#issue');
const formButton = form.querySelector('button');
const label = document.querySelector('#recipient');
const issued = document.querySelector('#created');
const inviteText = document.querySelector('#invite-text');
const countStatus = document.querySelector('#count-status');
const issueStatus = document.querySelector('#issue-status');
const tbody = document.querySelector('#counts');
const reload = document.querySelector('#reload');
let listRequest = 0;

function status(element, text, error = false) {
  element.classList.toggle('error', error);
  element.textContent = text;
}
async function api(path, payload) {
  const response = await fetch(path, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { 'X-Operator-Session': session, 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    cache: 'no-store'
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '未能完成请求，请重新打开本机后台。');
  return result;
}
function clearCode() {
  inviteText.value = '';
  issued.hidden = true;
}
function showRow(invite) {
  const row = document.createElement('tr');
  const state = invite.revoked ? (offlineGrants ? '已标记停用' : '已停用') : '有效';
  for (const value of [invite.label, invite.successes === null ? '暂无统计' : String(invite.successes), state]) {
    const cell = row.insertCell();
    cell.textContent = value;
  }
  const action = row.insertCell();
  if (!invite.revoked) {
    const stop = document.createElement('button');
    stop.className = 'plain stop';
    stop.type = 'button';
    stop.textContent = '停用';
    stop.setAttribute('aria-label', '停用给 ' + invite.label + ' 的邀请码');
    stop.addEventListener('click', async () => {
      const notice = offlineGrants ? '需导出并重新发布 invitation-grants.json 才会对公开主页生效。' : '之后再次解锁需要新码，已有次数会保留。';
      if (!window.confirm('停用给「' + invite.label + '」的邀请码？' + notice)) return;
      stop.disabled = true;
      try {
        await api('/invitations/' + encodeURIComponent(invite.id) + '/revoke', {});
        if (issued.dataset.id === invite.id) clearCode();
        await refresh();
      } catch (error) { status(countStatus, error.message, true); }
      finally { stop.disabled = false; }
    });
    action.append(stop);
  }
  return row;
}
async function refresh() {
  const request = ++listRequest;
  reload.disabled = true;
  try {
    const result = await api('/invitations');
    if (request !== listRequest) return;
    const invites = result.invites.sort((a, b) => (b.successes ?? -1) - (a.successes ?? -1) || a.label.localeCompare(b.label, 'zh'));
    tbody.replaceChildren(...invites.map(showRow));
    if (!invites.length) {
      const cell = tbody.insertRow().insertCell();
      cell.colSpan = 4;
      cell.className = 'empty';
      cell.textContent = '尚未生成邀请码';
    }
    const messages = [];
    if (result.countsAvailable === false) messages.push('统计服务当前不可用，仍可分配邀请码。');
    else if (invites.some(item => item.successes === null)) messages.push('部分邀请码尚无对应统计记录。');
    if (offlineGrants && invites.some(item => item.revoked)) messages.push('标记停用后，须导出并重新发布授权文件方可生效。');
    status(countStatus, messages.join(' '), result.countsAvailable === false);
  } catch (error) {
    if (request === listRequest) status(countStatus, error.message, true);
  } finally { if (request === listRequest) reload.disabled = false; }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const recipient = label.value.trim();
  if (!recipient || [...recipient].length > 120) {
    status(issueStatus, '请填写 1 至 120 个字符的收件人备注。', true);
    label.focus();
    return;
  }
  if (!issued.hidden && !window.confirm('生成下一份邀请前，请确认已保存当前邀请码。继续吗？')) return;
  formButton.disabled = true;
  try {
    const invite = await api('/invitations', { label: recipient });
    document.querySelector('#created-for').textContent = '给' + invite.label + '的邀请';
    inviteText.value = '学术主页：' + invite.site + '\n您的专属邀请码：' + invite.code + '\n主页会按此邀请码累计成功解锁次数。';
    issued.dataset.id = invite.id;
    issued.hidden = false;
    label.value = '';
    status(issueStatus, '邀请码已生成。');
    await refresh();
  } catch (error) { status(issueStatus, error.message, true); }
  finally { formButton.disabled = false; }
});
document.querySelector('#hide').addEventListener('click', () => {
  clearCode();
  status(issueStatus, '');
  label.focus();
});
document.querySelector('#copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(inviteText.value);
    status(issueStatus, '邀请文字已复制。');
  } catch {
    inviteText.focus();
    inviteText.select();
    status(issueStatus, '已选中邀请文字，可使用系统复制命令。');
  }
});
reload.addEventListener('click', refresh);
window.addEventListener('pageshow', event => { if (event.persisted) { clearCode(); refresh(); } });
refresh();
