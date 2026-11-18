import { randomBytes } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localAccessDir, privateReleaseDir } from './access-paths.mjs';
import { invitationList, openPool, PoolError, registerCounts } from './offline-invites.mjs';
import { dashboard } from './invitations-ui.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const operatorPort = Number(process.env.SITE_OPERATOR_PORT || 4174);
if (!Number.isInteger(operatorPort) || operatorPort < 1024 || operatorPort > 65535) {
  throw new Error('请选择 1024 至 65535 之间的本机管理端口。');
}
const operatorOrigin = 'http://127.0.0.1:' + operatorPort;
const previewOrigin = 'http://127.0.0.1:4173';
const consoleHelp = 'node tools/invitations.mjs [serve | list | create "收件人备注" ["English Name"] | revoke ID | init | export | register]';

async function settings() {
  const remoteFile = process.env.SITE_OPERATOR_CONFIG;
  const filename = remoteFile || join(localAccessDir, 'access-config.json');
  if (!isAbsolute(filename)) throw new Error('请为私有配置指定绝对路径。');
  const location = await realpath(filename).catch(() => {
    throw new Error('无法打开私有配置。请检查 SITE_ACCESS_DIR 或 SITE_OPERATOR_CONFIG。');
  });
  const outside = relative(await realpath(repo), location);
  if (!outside.startsWith('..' + sep) && !isAbsolute(outside)) {
    throw new Error('管理凭据应保存在发布仓库外。');
  }
  const config = JSON.parse(await readFile(location, 'utf8').then(s => s.replace(/^\uFEFF/, '')));
  if (typeof config.ADMIN_TOKEN !== 'string' || !config.ADMIN_TOKEN.trim()) {
    throw new Error('私有配置缺少 ADMIN_TOKEN。');
  }
  const api = new URL(remoteFile ? config.API_BASE : previewOrigin + '/access');
  const site = new URL(remoteFile ? config.PUBLIC_SITE_URL : previewOrigin + '/');
  if (remoteFile && (api.protocol !== 'https:' || site.protocol !== 'https:')) {
    throw new Error('线上服务和主页都需要完整的 HTTPS 地址。');
  }
  if (api.username || api.password || api.search || api.hash || site.username || site.password || site.search || site.hash) {
    throw new Error('请使用不含凭据、查询参数和锚点的 API 与主页地址。');
  }
  api.pathname = api.pathname.replace(/\/+$/, '') + '/';
  return { api, site: site.href, token: config.ADMIN_TOKEN, live: Boolean(remoteFile),
    pool: remoteFile ? openPool(dirname(location)) : null };
}

class ServiceError extends Error {
  constructor(status) {
    const messages = {
      400: '请填写有效的收件人备注（1 至 120 个字符）。',
      401: '管理凭据未通过验证，请检查私有配置。',
      403: '管理凭据未通过验证，请检查私有配置。',
      404: '未找到邀请码或访问服务，请检查服务地址。',
      429: '请求过于频繁，请稍后再试。'
    };
    super(messages[status] || '暂时无法连接访问服务，请检查服务状态后刷新列表。');
    this.status = status;
  }
}

async function requestApi(config, path, options = {}) {
  let reply;
  try {
    reply = await fetch(new URL('admin/invites' + path, config.api), {
      method: options.method || 'GET',
      headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'error',
      signal: AbortSignal.timeout(10000)
    });
  } catch { throw new ServiceError(502); }
  if (!reply.ok) throw new ServiceError(reply.status);
  return reply.json();
}

function listInvites(config) {
  return config.live ? invitationList(config) : requestApi(config, '');
}
function issueInvite(config, label, englishName) {
  if (config.live) return config.pool.issue(label, englishName);
  if (englishName) throw new PoolError('英文姓名适用于正式邀请管理。');
  return requestApi(config, '', { method: 'POST', body: { label } });
}
function revokeInvite(config, id) {
  return config.live ? config.pool.revoke(id) : requestApi(config, '/' + encodeURIComponent(id) + '/revoke', { method: 'POST', body: {} });
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 2048) throw new ServiceError(400);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ServiceError(400); }
}

async function serve(config) {
  const nonce = randomBytes(32).toString('base64url');
  const script = await readFile(new URL('./invitations-ui.js', import.meta.url));
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (req.headers.host !== new URL(operatorOrigin).host) return json(res, 403, {});
    try {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(dashboard(nonce, config.live));
      }
      if (req.method === 'GET' && req.url === '/operator.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
        return res.end(script);
      }
      const origin = req.headers.origin;
      if (req.headers['x-operator-session'] !== nonce || (origin && origin !== operatorOrigin)) {
        return json(res, 403, {});
      }
      if (req.method === 'GET' && req.url === '/invitations') {
        const data = await listInvites(config);
        return json(res, 200, { ...data, site: config.site });
      }
      if (req.method !== 'POST' || origin !== operatorOrigin ||
          req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
        return json(res, 403, {});
      }
      if (req.url === '/invitations') {
        const payload = await readBody(req);
        const result = await issueInvite(config, payload?.label, payload?.englishName);
        return json(res, 201, { ...result, site: config.site });
      }
      const revoke = /^\/invitations\/([a-zA-Z0-9_-]{1,80})\/revoke$/.exec(req.url);
      if (revoke) {
        await readBody(req);
        const result = await revokeInvite(config, revoke[1]);
        return json(res, 200, result);
      }
      json(res, 404, {});
    } catch (error) {
      json(res, error instanceof ServiceError ? error.status : error instanceof PoolError ? 400 : 502, {
        error: error instanceof ServiceError || error instanceof PoolError ? error.message : '访问服务响应异常，请刷新列表。'
      });
    }
  });
  server.on('error', () => {
    console.error('无法启动本机邀请管理，请确认端口可用。');
    process.exitCode = 1;
  });
  server.listen(operatorPort, '127.0.0.1', () => console.log('邀请管理已启动 ' + operatorOrigin + '/'));
}

async function main() {
  const [command = 'serve', ...args] = process.argv.slice(2);
  if (['-h', '--help', 'help'].includes(command)) return console.log(consoleHelp);
  const validCounts = { serve: [0], list: [0], create: [1, 2], revoke: [1], init: [0], export: [0], register: [0] };
  if (!Object.hasOwn(validCounts, command) || !validCounts[command].includes(args.length)) {
    throw new Error(consoleHelp);
  }
  const config = await settings();
  if (command === 'serve') return serve(config);
  try {
    let result;
    switch (command) {
      case 'list': result = await listInvites(config); break;
      case 'create': result = await issueInvite(config, args[0], args[1]); break;
      case 'revoke': result = await revokeInvite(config, args[0]); break;
      default:
        if (!config.live) throw new Error('请先设置正式站主配置 SITE_OPERATOR_CONFIG。');
        if (command === 'init') result = config.pool.init();
        if (command === 'export') result = await config.pool.exportGrants(join(repo, 'gate-config.json'), privateReleaseDir, join(repo, 'invitation-grants.json'));
        if (command === 'register') result = await registerCounts(config);
    }
    console.log(JSON.stringify({ target: config.live ? 'live' : 'local', site: config.site, ...result }, null, 2));
  } finally { config.pool?.close(); }
}
main().catch(error => {
  console.error(error instanceof SyntaxError ? '私有配置文件的 JSON 格式有误。' : error.message);
  process.exitCode = 1;
});
