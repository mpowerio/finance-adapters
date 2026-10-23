import { describe, expect, it, vi } from 'vitest';
import { QuickBooksAdapter, matchPayPalDeposit, QUICKBOOKS_SCOPE, type QuickBooksConnectionState } from './index.js';
import * as built from '../dist/index.js';

// Review r1 probes, synthetic only. Exercise source AND the shipped package bytes.
const NOW = Date.parse('2026-10-23T12:00:00Z');
const methods = ['listAccounts', 'listCustomers', 'listVendors', 'listPurchases', 'listBills', 'listDeposits', 'listPayments', 'listInvoices', 'syncCustomers'] as const;
const purchase = {
  Id: 'PUR-1', TotalAmt: 125, CurrencyRef: { value: 'USD' }, TxnDate: '2026-10-21',
  PaymentType: 'CreditCard', Credit: false, AccountRef: { value: '42' },
  EntityRef: { value: 'V-1', type: 'Vendor', name: 'Synthetic Supplier' },
  Line: [{ Amount: 125, DetailType: 'AccountBasedExpenseLineDetail', AccountBasedExpenseLineDetail: { AccountRef: { value: '7' } } }],
};
const token = { token_type: 'bearer', access_token: 'synthetic-new-access', refresh_token: 'synthetic-new-refresh', expires_in: 3600, x_refresh_token_expires_in: 8640000 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Retry-After': '60' } });

describe.each([
  ['source', QuickBooksAdapter, matchPayPalDeposit, QUICKBOOKS_SCOPE],
  ['dist', built.QuickBooksAdapter, built.matchPayPalDeposit, built.QUICKBOOKS_SCOPE],
] as const)('review r1 %s', (_label, Adapter, match, scope) => {
  function fixture(body: unknown, status = 200, expired = false) {
    let state: QuickBooksConnectionState = {
      status: 'active', accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh',
      accessTokenExpiresAt: NOW + (expired ? -1 : 3600000), refreshTokenExpiresAt: NOW + 8640000000,
    };
    const fetchImpl = vi.fn(async (url: string) => expired ? json({ error: 'invalid_grant' }, 400)
      : url.includes('oauth2') ? json(token) : json(body, status));
    const adapter = new Adapter({
      connection: { tenantId: 'synthetic', realmId: '123', environment: 'sandbox' }, homeCurrency: 'USD', now: () => NOW,
      readCredentials: () => ({ clientId: 'synthetic', clientSecret: 'synthetic', redirectUri: 'http://localhost/callback' }),
      fetchImpl, tokenStore: { withLock: async (_key, work) => work({ load: async () => structuredClone(state), save: async next => { state = structuredClone(next); } }) },
    });
    return { adapter, fetchImpl, state: () => state };
  }
  const read = (row: unknown) => fixture({ QueryResponse: { Purchase: [row] } }).adapter.listPurchases();
  it('keeps charge and refund output bytes distinguishable', async () => {
    const charge = await read(purchase), refund = await read({ ...purchase, Credit: true });
    expect(charge).toMatchObject({ ok: true, data: [{ credit: false, paymentType: 'CreditCard', amount: 125, lines: [{ amount: 125 }] }] });
    expect(refund).toMatchObject({ ok: true, data: [{ credit: true, paymentType: 'CreditCard', amount: 125, lines: [{ amount: 125 }] }] });
    expect(JSON.stringify(refund)).not.toBe(JSON.stringify(charge));
    expect(JSON.stringify(refund)).toBe(JSON.stringify(charge).replace('"credit":false', '"credit":true'));
  });
  it.each(['Vendor', 'Customer', 'Employee'])('preserves typed Purchase payee %s in output bytes', async type => {
    const entityRef = { value: 'PAYEE-1', type, name: 'Synthetic Payee' };
    // Stray legacy fields must not relabel EntityRef as a different party.
    const result = await read({ ...purchase, EntityRef: entityRef, VendorRef: { value: 'WRONG' }, CustomerRef: { value: 'WRONG' } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Read failed');
    expect(JSON.parse(JSON.stringify(result.data[0]))).toEqual({
      id: 'PUR-1', amount: 125, currency: 'USD', date: '2026-10-21', lines: [{ amount: 125, linkedTransactions: [] }],
      credit: false, paymentType: 'CreditCard', entityRef, ...(type === 'Vendor' ? { vendorId: 'PAYEE-1' } : {}),
    });
  });
  it.each(['Cash', 'Check', 'CreditCard'])('normalizes documented default Credit for %s', async PaymentType => {
    for (const Credit of [undefined, null, false]) expect(await read({ ...purchase, PaymentType, Credit })).toMatchObject({ ok: true, data: [{ paymentType: PaymentType, credit: false }] });
  });
  it('keeps optional payee absence and name absence without inventing identity', async () => {
    const absent = await read({ ...purchase, EntityRef: undefined });
    expect(absent.ok).toBe(true);
    if (absent.ok) { expect(absent.data[0]).not.toHaveProperty('entityRef'); expect(absent.data[0]).not.toHaveProperty('vendorId'); }
    expect(await read({ ...purchase, EntityRef: { value: 'V-1', type: 'Vendor' } })).toMatchObject({ data: [{ entityRef: { value: 'V-1', type: 'Vendor' }, vendorId: 'V-1' }] });
  });
  it.each([
    { Credit: 'true' }, { Credit: 'false' }, { Credit: 1 }, { Credit: {} },
    { PaymentType: undefined }, { PaymentType: null }, { PaymentType: 'Wire' },
    { PaymentType: 'Cash', Credit: true }, { PaymentType: 'Check', Credit: true },
    { EntityRef: null }, { EntityRef: {} }, { EntityRef: { value: '', type: 'Vendor' } },
    { EntityRef: { value: 'V-1' } }, { EntityRef: { value: 'V-1', type: 'OtherName' } },
    { EntityRef: { value: 'V-1', type: 'Vendor', name: 7 } },
  ])('rejects malformed Purchase evidence without partial data %j', async change => {
    const result = await fixture({ QueryResponse: { Purchase: [purchase, { ...purchase, Id: 'PUR-2', ...change }] } }).adapter.listPurchases();
    expect(result).toMatchObject({ ok: false, code: 'invalid_response' }); expect(result).not.toHaveProperty('data');
  });
  it('retains Bill VendorRef without Purchase-only fields', async () => {
    const result = await fixture({ QueryResponse: { Bill: [{ Id: 'B-1', TotalAmt: 125, TxnDate: '2026-10-21', VendorRef: { value: 'V-1' }, Line: [{ Amount: 125 }] }] } }).adapter.listBills();
    expect(result).toEqual({ ok: true, gated: false, data: [{ id: 'B-1', amount: 125, currency: 'USD', date: '2026-10-21', lines: [{ amount: 125, linkedTransactions: [] }], vendorId: 'V-1' }] });
  });
  it.each(methods)('%s keeps HTTP/auth failures loud and examined-empty separate', async method => {
    for (const status of [401, 403, 404, 429, 500, 503]) {
      const result = await fixture({ Fault: { type: 'AUTHENTICATION', Error: [{ code: '3200' }] } }, status).adapter[method]();
      expect(result).toMatchObject({ ok: false, code: expect.any(String) }); expect(result).not.toHaveProperty('data');
    }
    const f = fixture({}, 200, true), result = await f.adapter[method]();
    expect(result).toMatchObject({ ok: false, code: 'reconnect_needed' }); expect(result).not.toHaveProperty('data');
    expect(f.state().status).toBe('needs_reauth'); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(await fixture({ QueryResponse: {} }).adapter[method]()).toEqual({ ok: true, gated: false, data: [] });
  });
  it('keeps accounting scope and writes disabled without HTTP', async () => {
    expect(scope).toBe('com.intuit.quickbooks.accounting');
    const f = fixture({});
    expect(await f.adapter.createInvoice({ clientName: 'Synthetic', clientEmail: '', lineItems: [], dueDate: '', sourceResourceType: 'estimate', sourceResourceId: 'E' })).toMatchObject({ code: 'writes_disabled' });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    { Deposit: [], maxResults: 0, totalCount: 3 }, { Deposit: [], Invoice: [] },
    { Invoice: [] }, { Deposit: [], totalCount: '0' }, { Deposit: [], totalCount: -1 },
  ])('rejects contradictory empty query metadata %j', async QueryResponse => {
    const result = await fixture({ QueryResponse }).adapter.listDeposits();
    expect(result).toMatchObject({ ok: false, code: 'invalid_response' }); expect(result).not.toHaveProperty('data');
  });
  it('accepts an explicit consistent empty page', async () => {
    expect(await fixture({ QueryResponse: { Deposit: [], totalCount: 0, maxResults: 0 } }).adapter.listDeposits()).toEqual({ ok: true, gated: false, data: [] });
  });
  it('keeps the reviewed match controls conservative', () => {
    const paypal = { id: 'PP-001', invoiceNumber: 'FPC-1001', amount: 125, currency: 'USD', customerId: 'C-1' };
    const invoice = { id: 'I-1', externalId: 'I-1', invoiceNumber: 'FPC-1001', amount: 125, currency: 'USD', status: 'paid', dueDate: '2026-10-20', customerId: 'C-1', balance: 0 };
    const payment = { id: 'P-1', amount: 125, currency: 'USD', date: '2026-10-21', customerId: 'C-1', reference: 'PP-001', lines: [{ amount: 125, linkedTransactions: [{ id: 'I-1', type: 'Invoice' }] }] };
    const deposit = { id: 'D-1', amount: 125, currency: 'USD', date: '2026-10-22', lines: [{ amount: 125, linkedTransactions: [{ id: 'P-1', type: 'Payment' }] }] };
    const snapshot = { invoices: [invoice], payments: [payment], deposits: [deposit] };
    expect(match(paypal, snapshot)).toMatchObject({ data: { status: 'matched', depositId: 'D-1', paymentId: 'P-1', invoiceId: 'I-1' } });
    for (const deposits of [[{ ...deposit, amount: 120 }], [{ ...deposit, lines: [{ ...deposit.lines[0]!, amount: 120 }, { amount: 5, linkedTransactions: [] }] }], [deposit, { ...deposit, id: 'D-2' }]]) {
      expect(match(paypal, { ...snapshot, deposits })).not.toMatchObject({ data: { status: 'matched' } });
    }
    expect(match({ ...paypal, id: 'OTHER' }, snapshot)).toMatchObject({ data: { status: 'unmatched' } });
    expect(match(paypal, { ...snapshot, deposits: [{ ...deposit, date: '2026-10-20' }] })).toMatchObject({ data: { status: 'matched' } });
    expect(match(paypal, { ...snapshot, payments: [payment, { ...payment, id: 'P-2' }] })).toMatchObject({ data: { status: 'ambiguous' } });
    expect(match(paypal, { ...snapshot, invoices: [{ ...invoice, status: 'unpaid', balance: 125 }] })).toMatchObject({ data: { status: 'unmatched' } });
  });
});
