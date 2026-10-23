import { describe, expect, it, vi } from 'vitest';
import { QuickBooksAdapter, type QuickBooksConnectionState, type QuickBooksTokenStore } from './quickbooks.js';
import { matchPayPalDeposit } from './quickbooks-match.js';

const NOW = Date.parse('2026-10-23T12:00:00Z');
const initial: QuickBooksConnectionState = {
  status: 'active', accessToken: 'access-old', refreshToken: 'refresh-old',
  accessTokenExpiresAt: NOW + 3600_000, refreshTokenExpiresAt: NOW + 86400_000,
};
function fixture(overrides: Partial<QuickBooksConnectionState> = {}) {
  let state: QuickBooksConnectionState | null = { ...initial, ...overrides };
  let tail = Promise.resolve();
  const save = vi.fn(async (next: QuickBooksConnectionState) => { state = { ...next }; });
  const store: QuickBooksTokenStore = {
    withLock: async (_key, work) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await previous;
      try { return await work({ load: async () => state, save }); }
      finally { release(); }
    },
  };
  const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => response({ QueryResponse: {} }));
  const options = {
    connection: { tenantId: 'test-tenant', realmId: '123', environment: 'sandbox' as const },
    readCredentials: () => ({ clientId: 'cid', clientSecret: 'secret', redirectUri: 'http://localhost/callback' }),
    tokenStore: store, fetchImpl, now: () => NOW, homeCurrency: 'USD',
  };
  return { options, fetchImpl, save, state: () => state };
}
function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
const refreshResponse = {
  access_token: 'access-new', refresh_token: 'refresh-new', token_type: 'bearer',
  expires_in: 3600, x_refresh_token_expires_in: 8640000, x_refresh_token_hard_expires_in: 17280000,
};

describe('QuickBooks boundary', () => {
  it('gates absent configuration with zero HTTP', async () => {
    const f = fixture();
    const adapter = new QuickBooksAdapter({ ...f.options, readCredentials: () => null });
    expect(await adapter.listInvoices()).toMatchObject({ ok: false, gated: true });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it('distinguishes examined-empty from expired authentication', async () => {
    const f = fixture();
    const adapter = new QuickBooksAdapter(f.options);
    expect(await adapter.listDeposits()).toEqual({ ok: true, gated: false, data: [] });
    f.fetchImpl.mockImplementation(async () => response({ error: 'invalid_grant' }, 400));
    const expired = fixture({ accessTokenExpiresAt: NOW - 1 });
    expired.options.fetchImpl = f.fetchImpl;
    const result = await new QuickBooksAdapter(expired.options).listDeposits();
    expect(result).toMatchObject({ ok: false, gated: false, code: 'reconnect_needed', connectionStatus: 'needs_reauth' });
    expect(result).not.toHaveProperty('data');
    expect(expired.state()?.status).toBe('needs_reauth');
  });
  it('saves rotation and both expiries before the read', async () => {
    const f = fixture({ accessTokenExpiresAt: NOW + 300_000 });
    f.fetchImpl.mockImplementation(async url => {
      if (url.includes('oauth2')) return response(refreshResponse);
      expect(f.state()?.refreshToken).toBe('refresh-new');
      return response({ QueryResponse: {} });
    });
    expect((await new QuickBooksAdapter(f.options).listAccounts()).ok).toBe(true);
    expect(f.save.mock.calls[0]?.[0].status).toBe('refreshing');
    expect(f.state()).toMatchObject({ status: 'active', accessToken: 'access-new', refreshToken: 'refresh-new',
      accessTokenExpiresAt: NOW + 3600_000, refreshTokenExpiresAt: NOW + 8640000_000,
      refreshTokenHardExpiresAt: NOW + 17280000_000 });
    expect(f.fetchImpl.mock.calls[0]?.[1]?.body).toContain('refresh_token=refresh-old');
    expect(f.fetchImpl.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer access-new' });
  });
  it('serializes refresh across two instances sharing a connection', async () => {
    const f = fixture({ accessTokenExpiresAt: NOW - 1 });
    f.fetchImpl.mockImplementation(async url => response(url.includes('oauth2') ? refreshResponse : { QueryResponse: {} }));
    const results = await Promise.all([new QuickBooksAdapter(f.options).listAccounts(), new QuickBooksAdapter(f.options).listAccounts()]);
    expect(results.every(r => r.ok)).toBe(true);
    expect(f.fetchImpl.mock.calls.filter(([url]) => url.includes('oauth2'))).toHaveLength(1);
  });
  it.each([401, 403, 404, 429, 500])('HTTP %i is a typed failure, never empty success', async status => {
    const f = fixture();
    f.fetchImpl.mockImplementation(async url => url.includes('oauth2') ? response(refreshResponse) : response({}, status));
    const result = await new QuickBooksAdapter(f.options).listDeposits();
    expect(result).toMatchObject({ ok: false, gated: false });
    expect(result).toHaveProperty('code');
    expect(result).not.toHaveProperty('data');
  });
  it.each([{}, { QueryResponse: null }, { QueryResponse: { Deposit: null } }, { QueryResponse: { Invoice: [] } }, { Fault: { type: 'AuthenticationFault' } }])('rejects malformed/fault payload %j', async payload => {
    const f = fixture();
    f.fetchImpl.mockImplementation(async () => response(payload));
    expect(await new QuickBooksAdapter(f.options).listDeposits()).toMatchObject({ ok: false, gated: false });
  });
});

describe('known-answer match (synthetic)', () => {
  const paypal = { id: 'PP-001', invoiceNumber: 'FPC-1001', amount: 125, currency: 'USD', customerId: 'C-1' };
  const invoices = [{ id: 'I-1', externalId: 'I-1', invoiceNumber: 'FPC-1001', amount: 125, currency: 'USD', status: 'paid', dueDate: '2026-10-20', customerId: 'C-1', balance: 0 }];
  const payments = [{ id: 'P-1', amount: 125, currency: 'USD', date: '2026-10-21', customerId: 'C-1', reference: 'PP-001', lines: [{ amount: 125, linkedTransactions: [{ id: 'I-1', type: 'Invoice' }] }] }];
  const deposits = [{ id: 'D-1', amount: 125, currency: 'USD', date: '2026-10-22', lines: [{ amount: 125, linkedTransactions: [{ id: 'P-1', type: 'Payment' }] }] }];
  it('PP-001 -> D-1/P-1/I-1 exactly', () => {
    expect(matchPayPalDeposit(paypal, { invoices, payments, deposits })).toEqual({ ok: true, gated: false,
      data: { status: 'matched', paypalPaymentId: 'PP-001', depositId: 'D-1', paymentId: 'P-1', invoiceId: 'I-1' } });
  });
  it('does not guess with duplicate deposits', () => {
    expect(matchPayPalDeposit(paypal, { invoices, payments, deposits: [...deposits, { ...deposits[0]!, id: 'D-2' }] })).toMatchObject({ ok: true, data: { status: 'ambiguous' } });
  });
  it.each([{ amount: 124.99 }, { currency: 'CAD' }, { invoiceNumber: 'FPC-1002' }, { customerId: 'C-2' }])('does not match altered PayPal evidence %j', change => {
    expect(matchPayPalDeposit({ ...paypal, ...change }, { invoices, payments, deposits })).toMatchObject({ ok: true, data: { status: 'unmatched' } });
  });
  it('does not match a broken payment-to-invoice link or a missing PayPal reference', () => {
    for (const payment of [{ ...payments[0]!, reference: 'different' }, { ...payments[0]!, lines: [] },
      { ...payments[0]!, lines: [{ amount: 125, linkedTransactions: [{ id: 'wrong', type: 'Invoice' }] }] }]) {
      expect(matchPayPalDeposit(paypal, { invoices, payments: [payment], deposits })).toMatchObject({ ok: true, data: { status: 'unmatched' } });
    }
  });
  it('does not match net fees, wrong currency, or missing deposit links', () => {
    for (const deposit of [{ ...deposits[0]!, amount: 120 }, { ...deposits[0]!, currency: 'CAD' }, { ...deposits[0]!, lines: [] }]) {
      expect(matchPayPalDeposit(paypal, { invoices, payments, deposits: [deposit] })).toMatchObject({ ok: true, data: { status: 'unmatched' } });
    }
  });
  it('does not choose between duplicate invoice numbers or duplicated provider IDs', () => {
    for (const duplicate of [{ ...invoices[0]!, id: 'I-2' }, invoices[0]!]) {
      expect(matchPayPalDeposit(paypal, { invoices: [...invoices, duplicate], payments, deposits })).toMatchObject({ ok: true, data: { status: 'ambiguous' } });
    }
  });
  it('rejects invalid money precision and non-finite input', () => {
    for (const amount of [125.001, NaN, Infinity, -125, 0]) {
      expect(matchPayPalDeposit({ ...paypal, amount }, { invoices, payments, deposits })).toMatchObject({ ok: false, code: 'invalid_input' });
    }
  });

});

describe('read entities and complete queries', () => {
  const txn = { Id: 'T-1', TotalAmt: 125, CurrencyRef: { value: 'USD' }, TxnDate: '2026-10-21', Line: [{ Amount: 125, LinkedTxn: [{ TxnId: 'P-1', TxnType: 'Payment' }] }] };
  it.each([
    ['Account', 'listAccounts', { Id: 'A-1', Name: 'Checking', AccountType: 'Bank', Classification: 'Asset', CurrentBalance: 125, Active: false }],
    ['Customer', 'listCustomers', { Id: 'C-1', DisplayName: 'Synthetic Customer', PrimaryEmailAddr: { Address: 'test@example.invalid' } }],
    ['Vendor', 'listVendors', { Id: 'V-1', DisplayName: 'Synthetic Vendor', Vendor1099: true, Active: false }],
    ['Purchase', 'listPurchases', { ...txn, PaymentType: 'CreditCard', Credit: false, EntityRef: { value: 'V-1', type: 'Vendor', name: 'Synthetic Supplier' } }], ['Bill', 'listBills', { ...txn, VendorRef: { value: 'V-1' } }],
    ['Deposit', 'listDeposits', txn], ['Payment', 'listPayments', { ...txn, CustomerRef: { value: 'C-1' }, PaymentRefNum: 'PP-001' }],
    ['Invoice', 'listInvoices', { Id: 'I-1', TotalAmt: 125, Balance: 0, DocNumber: 'FPC-1001', CustomerRef: { value: 'C-1' } }],
  ] as const)('reads and validates %s', async (entity, method, row) => {
    const f = fixture();
    f.fetchImpl.mockImplementation(async (url, init) => {
      expect(url.startsWith('https://sandbox-quickbooks.api.intuit.com/v3/company/123/query?')).toBe(true);
      expect(init?.method).toBe('GET');
      expect(init?.redirect).toBe('error');
      const sql = new URL(url).searchParams.get('query');
      expect(sql).toContain(`SELECT * FROM ${entity}`);
      expect(sql).toContain("MetaData.LastUpdatedTime >= '2026-01-01T00:00:00.000Z'");
      if (['Account', 'Customer', 'Vendor'].includes(entity)) expect(sql).toContain('Active IN (true, false)');
      return response({ QueryResponse: { [entity]: [row], startPosition: 1, maxResults: 1 } });
    });
    const result = await new QuickBooksAdapter(f.options)[method]({ updatedSince: '2026-01-01T00:00:00Z' });
    expect(result).toMatchObject({ ok: true, data: [{ id: row.Id }] });
    if (entity === 'Vendor') expect(result).toMatchObject({ data: [{ vendor1099: true, active: false }] });
    if (entity === 'Deposit') expect(result).toMatchObject({ data: [{ amount: 125, currency: 'USD', lines: [{ amount: 125, linkedTransactions: [{ id: 'P-1', type: 'Payment' }] }] }] });
  });
  it('matches the declared synthetic answer after actual mocked adapter reads', async () => {
    const f = fixture();
    f.fetchImpl.mockImplementation(async url => {
      const sql = new URL(url).searchParams.get('query')!;
      if (sql.includes('FROM Invoice')) return response({ QueryResponse: { Invoice: [{ Id: 'I-1', TotalAmt: 125, Balance: 0, DocNumber: 'FPC-1001', CustomerRef: { value: 'C-1' } }] } });
      if (sql.includes('FROM Payment')) return response({ QueryResponse: { Payment: [{ ...txn, Id: 'P-1', CustomerRef: { value: 'C-1' }, PaymentRefNum: 'PP-001', Line: [{ Amount: 125, LinkedTxn: [{ TxnId: 'I-1', TxnType: 'Invoice' }] }] }] } });
      if (sql.includes('FROM Deposit')) return response({ QueryResponse: { Deposit: [{ ...txn, Id: 'D-1' }] } });
      throw new Error('Unexpected request');
    });
    const adapter = new QuickBooksAdapter(f.options);
    const invoices = await adapter.listInvoices(); const payments = await adapter.listPayments(); const deposits = await adapter.listDeposits();
    if (!invoices.ok || !payments.ok || !deposits.ok) throw new Error('Reads failed');
    expect(matchPayPalDeposit({ id: 'PP-001', invoiceNumber: 'FPC-1001', amount: 125, currency: 'USD', customerId: 'C-1' },
      { invoices: invoices.data, payments: payments.data, deposits: deposits.data })).toEqual({ ok: true, gated: false,
      data: { status: 'matched', paypalPaymentId: 'PP-001', depositId: 'D-1', paymentId: 'P-1', invoiceId: 'I-1' } });
  });
  it('paginates to a verified empty page after an exact full page', async () => {
    const f = fixture();
    f.fetchImpl.mockResolvedValueOnce(response({ QueryResponse: { Deposit: [txn], startPosition: 1, maxResults: 1 } }))
      .mockResolvedValueOnce(response({ QueryResponse: {} }));
    expect(await new QuickBooksAdapter({ ...f.options, pageSize: 1 }).listDeposits()).toMatchObject({ ok: true, data: [{ id: 'T-1' }] });
    expect(new URL(f.fetchImpl.mock.calls[1]![0]).searchParams.get('query')).toContain('STARTPOSITION 2 MAXRESULTS 1');
  });
  it.each(['error', 'duplicate', 'limit'])('never returns partial success on pagination %s', async mode => {
    const f = fixture();
    f.fetchImpl.mockResolvedValueOnce(response({ QueryResponse: { Deposit: [txn] } }))
      .mockResolvedValue(mode === 'error' ? response({}, 500) : response({ QueryResponse: { Deposit: [txn] } }));
    const result = await new QuickBooksAdapter({ ...f.options, pageSize: 1, maxPages: mode === 'limit' ? 1 : 3 }).listDeposits();
    expect(result.ok).toBe(false); expect(result).not.toHaveProperty('data');
  });
  it.each([{ Deposit: [{ ...txn, TotalAmt: '125' }] }, { Deposit: [{ ...txn, Line: null }] }, { Deposit: [{ ...txn, CurrencyRef: { value: '???' } }] }, { maxResults: 1 }, { Deposit: [], maxResults: 1 }])('rejects corrupt financial response %j', async payload => {
    const f = fixture(); f.fetchImpl.mockResolvedValue(response({ QueryResponse: payload }));
    expect(await new QuickBooksAdapter(f.options).listDeposits()).toMatchObject({ code: 'invalid_response', ok: false });
  });
  it('does not invent a currency when QBO and configuration omit it', async () => {
    const f = fixture();
    f.fetchImpl.mockResolvedValue(response({ QueryResponse: { Invoice: [{ Id: 'I', TotalAmt: 1, Balance: 1, CustomerRef: { value: 'C' } }] } }));
    const { homeCurrency: _unused, ...options } = f.options;
    expect(await new QuickBooksAdapter(options).listInvoices()).toMatchObject({ ok: false, code: 'invalid_response' });
  });
  it.each([{ updatedSince: "2026-01-01' OR 1=1" }, { updatedSince: 'yesterday' }])('rejects invalid timestamp before HTTP %j', async filters => {
    const f = fixture(); expect(await new QuickBooksAdapter(f.options).listAccounts(filters)).toMatchObject({ code: 'invalid_input' });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it('builds supported invoice filters and rejects injection/status/date ambiguity', async () => {
    const f = fixture(); const adapter = new QuickBooksAdapter(f.options);
    expect((await adapter.listInvoices({ clientId: '42', status: 'paid', from: '2026-01-01', to: '2026-10-23' })).ok).toBe(true);
    const sql = new URL(f.fetchImpl.mock.calls[0]![0]).searchParams.get('query');
    expect(sql).toContain("CustomerRef = '42'"); expect(sql).toContain("Balance = '0'");
    expect(sql).toContain("TxnDate >= '2026-01-01'"); expect(sql).toContain("TxnDate <= '2026-10-23'");
    for (const filters of [{ clientId: "42' OR Id='1" }, { status: 'invented' }, { from: '2026-02-30' }, { from: '2026-10-23', to: '2026-01-01' }]) {
      expect(await adapter.listInvoices(filters)).toMatchObject({ code: 'invalid_input' });
    }
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('disables writes even with credentials and does not fabricate a wallet balance', async () => {
    const f = fixture(); const adapter = new QuickBooksAdapter(f.options);
    expect(await adapter.createInvoice({ clientName: 'Synthetic', clientEmail: '', lineItems: [], dueDate: '', sourceResourceType: 'estimate', sourceResourceId: 'E' }))
      .toMatchObject({ ok: false, code: 'writes_disabled' });
    expect(await adapter.getBalance()).toMatchObject({ ok: false, code: 'unsupported_operation' });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
});

describe('token lifecycle failures and recovery boundaries', () => {
  it.each(['clientId', 'clientSecret', 'redirectUri'] as const)('gates missing %s', async key => {
    const f = fixture(); const creds = f.options.readCredentials(); creds[key] = '';
    expect(await new QuickBooksAdapter({ ...f.options, readCredentials: () => creds }).listInvoices()).toMatchObject({ gated: true });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it.each([{ refreshTokenExpiresAt: NOW }, { refreshTokenHardExpiresAt: NOW }, { status: 'needs_reauth' as const }, { status: 'refreshing' as const }])('stops without HTTP when reconnect required %j', async state => {
    const f = fixture(state);
    expect(await new QuickBooksAdapter(f.options).listDeposits()).toMatchObject({ code: 'reconnect_needed' });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it('never retries invalid_grant on subsequent calls', async () => {
    const f = fixture({ accessTokenExpiresAt: NOW - 1 });
    f.fetchImpl.mockResolvedValue(response({ error: 'invalid_grant', error_description: 'secret-material' }, 400));
    const adapter = new QuickBooksAdapter(f.options);
    for (let i = 0; i < 2; i++) expect(await adapter.listInvoices()).toMatchObject({ code: 'reconnect_needed' });
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('persists even an unchanged refresh token and preserves a known hard expiry', async () => {
    const f = fixture({ refreshTokenHardExpiresAt: NOW + 5000_000 });
    const { x_refresh_token_hard_expires_in: _unused, ...body } = refreshResponse;
    f.fetchImpl.mockResolvedValue(response({ ...body, refresh_token: 'refresh-old' }));
    expect(await new QuickBooksAdapter(f.options).refreshConnection()).toMatchObject({ ok: true });
    expect(f.state()).toMatchObject({ refreshToken: 'refresh-old', accessToken: 'access-new', refreshTokenHardExpiresAt: NOW + 5000_000 });
    expect(f.save).toHaveBeenCalledTimes(2);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('bounds the rolling expiry to 100 days', async () => {
    const f = fixture(); f.fetchImpl.mockResolvedValue(response({ ...refreshResponse, x_refresh_token_expires_in: 90000000 }));
    await new QuickBooksAdapter(f.options).refreshConnection();
    expect(f.state()?.refreshTokenExpiresAt).toBe(NOW + 100 * 86400_000);
  });
  it('retries a stale access token once after saving refreshed credentials', async () => {
    const f = fixture();
    f.fetchImpl.mockResolvedValueOnce(response({}, 401)).mockResolvedValueOnce(response(refreshResponse)).mockResolvedValueOnce(response({ QueryResponse: {} }));
    expect(await new QuickBooksAdapter(f.options).listInvoices()).toEqual({ ok: true, gated: false, data: [] });
    expect(f.fetchImpl).toHaveBeenCalledTimes(3);
    expect(f.fetchImpl.mock.calls[2]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer access-new' });
  });
  it('never uses a rotated token when its durable save fails; next instance reconnects', async () => {
    const f = fixture({ accessTokenExpiresAt: NOW - 1 });
    f.fetchImpl.mockResolvedValue(response(refreshResponse));
    const save = f.save.getMockImplementation()!;
    f.save.mockImplementation(async next => { if (next.status === 'active') throw new Error('secret'); await save(next); });
    expect(await new QuickBooksAdapter(f.options).listDeposits()).toMatchObject({ ok: false, code: 'storage_error' });
    expect(f.state()?.status).toBe('refreshing');
    expect(await new QuickBooksAdapter(f.options).listDeposits()).toMatchObject({ code: 'reconnect_needed' });
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('does not start remote rotation if saving intent fails', async () => {
    const f = fixture({ accessTokenExpiresAt: NOW - 1 }); f.save.mockRejectedValue(new Error('secret'));
    expect(await new QuickBooksAdapter(f.options).listAccounts()).toMatchObject({ code: 'storage_error' });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it.each([{ ...refreshResponse, refresh_token: '' }, { ...refreshResponse, expires_in: -1 }, { ...refreshResponse, x_refresh_token_expires_in: undefined }, { ...refreshResponse, token_type: 'wrong' }])('does not use malformed refresh result %j', async body => {
    const f = fixture({ accessTokenExpiresAt: NOW - 1 }); f.fetchImpl.mockResolvedValue(response(body));
    expect(await new QuickBooksAdapter(f.options).listAccounts()).toMatchObject({ code: 'reconnect_needed' });
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('preserves active state after explicit rate-limit rejection of refresh', async () => {
    const f = fixture({ accessTokenExpiresAt: NOW - 1 });
    f.fetchImpl.mockResolvedValue(new Response('{"error":"throttled"}', { status: 429, headers: { 'Retry-After': '60' } }));
    expect(await new QuickBooksAdapter(f.options).listAccounts()).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 60 });
    expect(f.state()?.status).toBe('active');
  });
  it('returns typed redacted network and JSON failures', async () => {
    const f = fixture(); f.fetchImpl.mockRejectedValueOnce(new Error('access-old secret refresh-old'));
    const result = await new QuickBooksAdapter(f.options).listDeposits();
    expect(result).toMatchObject({ code: 'network_error' });
    expect(JSON.stringify(result)).not.toMatch(/access-old|refresh-old|secret/);
    f.fetchImpl.mockResolvedValue(new Response('not-json', { status: 200 }));
    expect(await new QuickBooksAdapter(f.options).listDeposits()).toMatchObject({ code: 'invalid_response' });
  });
  it('times out a hung fetch and a hung body without returning empty', async () => {
    const f = fixture(); f.fetchImpl.mockImplementation(() => new Promise(() => {}));
    expect(await new QuickBooksAdapter({ ...f.options, timeoutMs: 5 }).listDeposits()).toMatchObject({ code: 'timeout' });
    expect(f.fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    f.fetchImpl.mockResolvedValue(new Response(new ReadableStream({ start() {} })));
    expect(await new QuickBooksAdapter({ ...f.options, timeoutMs: 5 }).listDeposits()).toMatchObject({ code: 'timeout' });
  });
  it('locks by app, tenant, realm and environment, with immutable adapter identity', async () => {
    const f = fixture(); const keys: string[] = [];
    const withLock = f.options.tokenStore.withLock;
    f.options.tokenStore.withLock = (key, work) => { keys.push(key); return withLock(key, work); };
    const adapter = new QuickBooksAdapter(f.options);
    f.options.connection.realmId = '456';
    await adapter.listAccounts();
    expect(keys[0]).toBe('["quickbooks","sandbox","cid","test-tenant","123"]');
    expect(f.fetchImpl.mock.calls[0]?.[0]).toContain('/company/123/');
  });
});

describe('additional no-silent-failure contracts', () => {
  it.each(['accessToken', 'refreshToken'] as const)('gates an absent stored %s', async key => {
    const f = fixture({ [key]: '' });
    expect(await new QuickBooksAdapter(f.options).listInvoices()).toMatchObject({ gated: true, code: 'configuration_missing' });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it('identifies rate limits even when refresh error body is not JSON', async () => {
    const f = fixture({ accessTokenExpiresAt: NOW - 1 });
    f.fetchImpl.mockResolvedValue(new Response('rate limited', { status: 429 }));
    expect(await new QuickBooksAdapter(f.options).listInvoices()).toMatchObject({ code: 'rate_limited' });
    expect(f.state()?.status).toBe('active');
  });
  it('persists reconnect after an uncertain refresh network outcome', async () => {
    const f = fixture({ accessTokenExpiresAt: NOW - 1 }); f.fetchImpl.mockRejectedValue(new Error('network'));
    expect(await new QuickBooksAdapter(f.options).listInvoices()).toMatchObject({ code: 'reconnect_needed' });
    expect(f.state()?.status).toBe('needs_reauth');
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each(['listAccounts', 'listCustomers', 'listVendors', 'listPurchases', 'listBills', 'listDeposits', 'listPayments', 'listInvoices', 'syncCustomers'] as const)('%s never converts expired auth to an empty list', async method => {
    const f = fixture({ accessTokenExpiresAt: NOW - 1 }); f.fetchImpl.mockResolvedValue(response({ error: 'invalid_grant' }, 400));
    const result = await new QuickBooksAdapter(f.options)[method]();
    expect(result).toMatchObject({ ok: false, gated: false, code: 'reconnect_needed' });
    expect(result).not.toHaveProperty('data');
  });
});
