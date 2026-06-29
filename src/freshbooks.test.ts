import { describe, it, expect, vi } from 'vitest';
import { FreshBooksAdapter } from './freshbooks.js';
import type { FetchLike, FetchLikeResponse, FreshBooksCredentials } from './freshbooks.js';
import type { CreateInvoiceParams } from './types.js';

const CREDS: FreshBooksCredentials = {
  clientId: 'cid',
  clientSecret: 'secret',
  accessToken: 'tok',
  accountId: 'acct1',
};

function jsonRes(payload: unknown): FetchLikeResponse {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  };
}

const SAMPLE_PARAMS: CreateInvoiceParams = {
  clientName: 'Acme',
  clientEmail: 'a@b.com',
  lineItems: [{ description: 'Roof repair', quantity: 1, unitPrice: 500 }],
  dueDate: '2026-07-15',
  sourceResourceType: 'estimate',
  sourceResourceId: 'est_123',
};

describe('FreshBooksAdapter — gated (no credentials)', () => {
  it('createInvoice returns gated and NEVER calls fetch when creds absent', async () => {
    const fetchSpy = vi.fn<FetchLike>(async () => {
      throw new Error('LIVE CALL LEAKED — gate failed');
    });
    const adapter = new FreshBooksAdapter({
      fetchImpl: fetchSpy,
      readCredentials: () => null,
    });

    const res = await adapter.createInvoice(SAMPLE_PARAMS);
    expect(res.ok).toBe(false);
    expect(res.gated).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('all four methods gate identically with no fetch', async () => {
    const fetchSpy = vi.fn<FetchLike>(async () => {
      throw new Error('LIVE CALL LEAKED');
    });
    const adapter = new FreshBooksAdapter({
      fetchImpl: fetchSpy,
      readCredentials: () => null,
    });

    const results = [
      await adapter.createInvoice(SAMPLE_PARAMS),
      await adapter.listInvoices(),
      await adapter.getBalance(),
      await adapter.syncCustomers(),
    ];
    for (const r of results) {
      expect(r.ok).toBe(false);
      expect(r.gated).toBe(true);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('FreshBooksAdapter — live path (mocked HTTP at the boundary)', () => {
  it('createInvoice maps the FreshBooks response into an ArtifactRecord<"invoice">', async () => {
    const mockFetch: FetchLike = async (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.includes('/users/clients') && method === 'GET') {
        return jsonRes({
          response: {
            result: {
              clients: [
                { id: 42, userid: 42, fname: 'Acme', lname: '', email: 'a@b.com', organization: 'Acme' },
              ],
            },
          },
        });
      }
      if (url.includes('/invoices/invoices') && method === 'POST') {
        return jsonRes({
          response: {
            result: {
              invoice: {
                id: 1001,
                invoiceid: 1001,
                v3_status: 'sent',
                amount: { amount: '500.00' },
                outstanding: { amount: '500.00' },
                currency_code: 'USD',
                due_date: '2026-07-15',
                links: { client_view: 'https://my.freshbooks.com/invoice/1001' },
              },
            },
          },
        });
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    };

    const adapter = new FreshBooksAdapter({
      fetchImpl: mockFetch,
      readCredentials: () => CREDS,
    });

    const res = await adapter.createInvoice(SAMPLE_PARAMS);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    const record = res.data;
    expect(record.kind).toBe('invoice');
    expect(record.provider).toBe('freshbooks');
    expect(record.sourceResourceType).toBe('estimate');
    expect(record.sourceResourceId).toBe('est_123');
    expect(record.externalUrl).toBe('https://my.freshbooks.com/invoice/1001');
    expect(record.status).toBe('ready');
    expect(record.id).toBe('1001');
  });

  it('listInvoices maps FreshBooks invoices into InvoiceResult[]', async () => {
    const mockFetch: FetchLike = async (url, init) => {
      const method = init?.method ?? 'GET';
      if (url.includes('/invoices/invoices') && method === 'GET') {
        return jsonRes({
          response: {
            result: {
              invoices: [
                {
                  id: 1,
                  invoiceid: 1,
                  v3_status: 'paid',
                  amount: { amount: '120.00' },
                  outstanding: { amount: '0.00' },
                  currency_code: 'USD',
                  due_date: '2026-06-01',
                  date_paid: '2026-05-30',
                  links: { client_view: 'https://my.freshbooks.com/invoice/1' },
                },
              ],
            },
          },
        });
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    };

    const adapter = new FreshBooksAdapter({
      fetchImpl: mockFetch,
      readCredentials: () => CREDS,
    });

    const res = await adapter.listInvoices({ status: 'paid' });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data).toHaveLength(1);
    expect(res.data[0]?.status).toBe('paid');
    expect(res.data[0]?.amount).toBe(120);
    expect(res.data[0]?.paidDate).toBe('2026-05-30');
  });

  it('returns a typed failure (not a throw) when the API errors', async () => {
    const mockFetch: FetchLike = async () => ({
      ok: false,
      status: 500,
      text: async () => 'boom',
      json: async () => ({}),
    });
    const adapter = new FreshBooksAdapter({
      fetchImpl: mockFetch,
      readCredentials: () => CREDS,
    });
    const res = await adapter.getBalance();
    expect(res.ok).toBe(false);
    expect(res.gated).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error).toContain('FreshBooks');
  });
});
