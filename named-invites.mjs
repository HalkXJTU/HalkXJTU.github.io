// Shared by the private issuer and the static GitHub Pages entry point.
const utf8 = new TextEncoder();
const legacyFormat = /^INV-[A-Za-z0-9_-]{22}$/;
const namedFormat = /^inv-([a-zA-Z]+(?:-[a-zA-Z]+)*)-([a-z]{10})$/;
const domain = 'halk-homepage/named-invite/v1/';
const alphabet = 'abcdefghijklmnopqrstuvwxyz';
const tailLength = 10;

export function normalizeInviteName(value) {
  if (typeof value !== 'string' || value.length > 120 || !/^[A-Za-z]+(?:[ -]+[A-Za-z]+)*$/.test(value.trim())) {
    throw new Error('请输入由英文字母组成的姓名，可用空格或连字符分词。');
  }
  return value.trim().toLowerCase().replace(/[ -]+/g, '-');
}

// Convert a domain-separated hash stream to uniform base-26 digits without
// modulo bias. A recipient's existing random code supplies the secret entropy.
async function digits(kind, input) {
  const result = [];
  for (let block = 0; result.length < tailLength; block++) {
    const hash = await crypto.subtle.digest('SHA-256', utf8.encode(domain + kind + '/' + block + '/' + input));
    for (const byte of new Uint8Array(hash)) {
      if (byte >= 234) continue; // 234 = 9 * 26.
      result.push(byte % 26);
      if (result.length === tailLength) break;
    }
  }
  return result;
}

export async function formatNamedInvite(legacyCode, name) {
  if (!legacyFormat.test(legacyCode)) throw new Error('Invalid source invitation');
  const slug = normalizeInviteName(name);
  const [secret, shift] = await Promise.all([digits('secret', legacyCode), digits('name', slug)]);
  // This public spelling-dependent shift catches name/recipient mixups. The
  // name itself contributes no entropy and never needs to appear in the grant.
  const suffix = secret.map((digit, i) => alphabet[(digit + shift[i]) % 26]).join('');
  return 'inv-' + slug + '-' + suffix;
}

async function keys(secretLetters, releaseId) {
  if (typeof releaseId !== 'string' || !/^[a-f0-9]{24}$/.test(releaseId)) throw new Error('Invalid release');
  const salt = utf8.encode(domain + 'pbkdf2/' + releaseId);
  const password = await crypto.subtle.importKey('raw', utf8.encode(secretLetters), 'PBKDF2', false, ['deriveKey']);
  const master = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, password,
    { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
  const derive = label => crypto.subtle.sign('HMAC', master, utf8.encode(domain + label));
  const [lookup, wrapping] = await Promise.all([derive('lookup'), derive('wrapping')]);
  const id = Array.from(new Uint8Array(lookup, 0, 16), byte => byte.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey('raw', wrapping, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { id, key, aad: utf8.encode(domain + 'grant/' + releaseId + '/' + id) };
}

const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const decode = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));

export async function makeNamedGrant(legacyCode, releaseId) {
  if (!legacyFormat.test(legacyCode)) throw new Error('Invalid source invitation');
  const secret = (await digits('secret', legacyCode)).map(digit => alphabet[digit]).join('');
  const { id, key, aad } = await keys(secret, releaseId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, utf8.encode(legacyCode));
  return { id, iv: encode(iv), wrapped: encode(wrapped) };
}

export async function resolveNamedInvite(input, releaseId, namedGrants) {
  const match = typeof input === 'string' && input.length <= 135 && namedFormat.exec(input);
  if (!match || !namedGrants || typeof namedGrants !== 'object') throw new Error('wrong');
  const [, slug, suffix] = match;
  const shift = await digits('name', slug.toLowerCase());
  const secret = Array.from(suffix, (letter, i) => alphabet[(alphabet.indexOf(letter) - shift[i] + 26) % 26]).join('');
  const { id, key, aad } = await keys(secret, releaseId);
  if (!Object.hasOwn(namedGrants, id)) throw new Error('wrong');
  try {
    const { iv, wrapped } = namedGrants[id];
    if (iv.length !== 16 || wrapped.length !== 56) throw new Error();
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: aad }, key, decode(wrapped));
    const oldCode = new TextDecoder('utf-8', { fatal: true }).decode(clear);
    if (!legacyFormat.test(oldCode)) throw new Error();
    return oldCode;
  } catch {
    throw new Error('wrong');
  }
}
