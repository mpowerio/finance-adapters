/** Opt-in SANDBOX ONLY. Never prints tokens, entity contents, IDs or raw errors. */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QuickBooksAdapter } from '../dist/index.js';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}; no network call made.`);
  return value;
}
async function main() {
  if (process.argv.slice(2).join(' ') !== '--sandbox') {
    throw new Error('Use --sandbox after operator sandbox setup. No network call made.');
  }
  const realmId = required('QUICKBOOKS_SANDBOX_REALM_ID');
  const tenantId = required('QUICKBOOKS_SMOKE_TENANT_ID');
  const homeCurrency = required('QUICKBOOKS_HOME_CURRENCY');
  const clientId = required('QUICKBOOKS_CLIENT_ID');
  const clientSecret = required('QUICKBOOKS_CLIENT_SECRET');
  const redirectUri = required('QUICKBOOKS_REDIRECT_URI');
  const file = required('QUICKBOOKS_TOKEN_FILE');
  const key = Buffer.from(required('QUICKBOOKS_TOKEN_KEY_BASE64'), 'base64');
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (!isAbsolute(file) || resolve(file) === repo || resolve(file).startsWith(repo + sep) || key.length !== 32) {
    throw new Error('Token file must be outside the repository; encryption key must decode to 32 bytes. No network call made.');
  }
  const lock = `${file}.lock`;
  const tokenStore = {
    async withLock(connectionKey, work) {
      // Cross-process exclusion; never clear someone else's lock. On a crash,
      // operator verifies no process remains before removing the stale lock.
      await mkdir(lock, { mode: 0o700 });
      try {
        const save = async state => {
          const iv = randomBytes(12);
          const cipher = createCipheriv('aes-256-gcm', key, iv);
          const encrypted = Buffer.concat([cipher.update(JSON.stringify({ connectionKey, state })), cipher.final()]);
          const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
          const handle = await open(temp, 'wx', 0o600);
          try {
            await handle.writeFile(JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') }));
            await handle.sync();
          } finally { await handle.close(); }
          try {
            await rename(temp, file);
            const directory = await open(dirname(file), 'r');
            try { await directory.sync(); } finally { await directory.close(); }
          } finally { await rm(temp, { force: true }); }
        };
        const load = async () => {
          let content;
          try {
            const stat = await lstat(file);
            if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error('Unsafe token file');
            content = await readFile(file, 'utf8');
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            // Initial pair must be obtained by the operator using sandbox OAuth.
            const state = {
              status: 'active', accessToken: required('QUICKBOOKS_ACCESS_TOKEN'), refreshToken: required('QUICKBOOKS_REFRESH_TOKEN'),
              accessTokenExpiresAt: Number(required('QUICKBOOKS_ACCESS_EXPIRES_AT_MS')),
              refreshTokenExpiresAt: Number(required('QUICKBOOKS_REFRESH_EXPIRES_AT_MS')),
              ...(process.env.QUICKBOOKS_REFRESH_HARD_EXPIRES_AT_MS ? { refreshTokenHardExpiresAt: Number(process.env.QUICKBOOKS_REFRESH_HARD_EXPIRES_AT_MS) } : {}),
            };
            await save(state);
            return state;
          }
          const envelope = JSON.parse(content);
          const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
          decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
          const stored = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'));
          if (stored.connectionKey !== connectionKey) throw new Error('Connection identity mismatch');
          return stored.state;
        };
        return await work({ load, save });
      } finally { await rm(lock, { recursive: true }); }
    },
  };
  const allowed = new Set(['sandbox-quickbooks.api.intuit.com', 'oauth.platform.intuit.com']);
  const fetchImpl = (url, init) => {
    const target = new URL(url);
    if (target.protocol !== 'https:' || !allowed.has(target.hostname)
        || (target.hostname === 'sandbox-quickbooks.api.intuit.com' && init?.method !== 'GET')
        || (target.hostname === 'oauth.platform.intuit.com' && (target.pathname !== '/oauth2/v1/tokens/bearer' || init?.method !== 'POST'))) {
      throw new Error('Sandbox-only HTTP guard refused the request');
    }
    return fetch(url, { ...init, redirect: 'error' });
  };
  const adapter = new QuickBooksAdapter({
    connection: { tenantId, realmId, environment: 'sandbox' }, tokenStore, homeCurrency, fetchImpl,
    readCredentials: () => ({ clientId, clientSecret, redirectUri }),
  });
  const refreshed = await adapter.refreshConnection();
  if (!refreshed.ok) throw new Error(`Token smoke failed: ${refreshed.code}. Reconnect/storage action may be needed; no token values logged.`);
  console.log('Token refresh + encrypted pair persistence: OK');
  for (const method of ['listAccounts', 'listCustomers', 'listVendors', 'listPurchases', 'listBills', 'listDeposits', 'listPayments', 'listInvoices']) {
    const result = await adapter[method]();
    if (!result.ok) throw new Error(`${method}: ${result.code}; smoke FAILED. No partial success claimed.`);
    console.log(`${method}: examined ${result.data.length} rows`);
  }
  console.log('Sandbox read smoke completed. No accounting writes issued. This is not a live PayPal reconciliation proof.');
}
main().catch(error => {
  // Only our own safe high-level messages; storage/provider exception text is not emitted.
  const message = error instanceof Error ? error.message : '';
  const safe = /^(Use --sandbox|Missing QUICKBOOKS_|Token file must|Token smoke failed:|list(?:Accounts|Customers|Vendors|Purchases|Bills|Deposits|Payments|Invoices):)/.test(message);
  console.error(safe ? message : 'Sandbox smoke failed during configuration/storage. Check secure local setup; no secrets logged.');
  process.exitCode = 1;
});
