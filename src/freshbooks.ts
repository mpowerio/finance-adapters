/**
 * FreshBooks Adapter — harvested from mpower-crm/src/lib/integrations/freshbooks.ts.
 *
 * OAuth2 + REST adapter for FreshBooks invoicing and financial data. In this
 * packaging env the OAuth secrets do not exist, so EVERY method is GATED: if
 * the credential set (FRESHBOOKS_CLIENT_ID / FRESHBOOKS_CLIENT_SECRET /
 * FRESHBOOKS_ACCESS_TOKEN / FRESHBOOKS_ACCOUNT_ID) is incomplete the method
 * returns a typed `{ ok:false, gated:true, error }` and makes NO live call.
 * The live HTTP path is kept structured but un-exercised; fetch is resolved
 * only AFTER the gate passes.
 */

import {
  type FinanceAdapter,
  type CreateInvoiceParams,
  type InvoiceResult,
  type InvoiceFilters,
  type CustomerResult,
  type BalanceResult,
  type InvoiceArtifact,
  type AdapterResult,
  ok,
  gated,
  failure,
} from './types.js';
import { invoiceToArtifact } from './artifact.js';

const FRESHBOOKS_API_URL = 'https://api.freshbooks.com';

// ─── Minimal fetch surface (avoids a DOM-lib / @types/node dependency) ──
export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<FetchLikeResponse>;

// ─── Credentials ─────────────────────────────────────────────────────
export interface FreshBooksCredentials {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  accountId: string;
}

/**
 * Read the full FreshBooks credential set from the environment. Returns null
 * (→ gated) if ANY of the four are absent. CLIENT_ID/SECRET gate the OAuth app;
 * ACCESS_TOKEN/ACCOUNT_ID gate the live REST surface (MOC's runtime vars).
 */
export function readFreshBooksCredentialsFromEnv(): FreshBooksCredentials | null {
  const clientId = process.env.FRESHBOOKS_CLIENT_ID;
  const clientSecret = process.env.FRESHBOOKS_CLIENT_SECRET;
  const accessToken = process.env.FRESHBOOKS_ACCESS_TOKEN;
  const accountId = process.env.FRESHBOOKS_ACCOUNT_ID;
  if (!clientId || !clientSecret || !accessToken || !accountId) return null;
  return { clientId, clientSecret, accessToken, accountId };
}

export interface FreshBooksAdapterOptions {
  /** Inject an HTTP impl. Defaults to global fetch. Tests pass a mock. */
  fetchImpl?: FetchLike;
  /** Override the credential source. Defaults to env. */
  readCredentials?: () => FreshBooksCredentials | null;
}

const GATE_MESSAGE =
  'FreshBooks credentials absent (FRESHBOOKS_CLIENT_ID / FRESHBOOKS_CLIENT_SECRET / FRESHBOOKS_ACCESS_TOKEN / FRESHBOOKS_ACCOUNT_ID) — gated, no live call made.';

export class FreshBooksAdapter implements FinanceAdapter {
  readonly name = 'freshbooks';
  private readonly fetchImpl?: FetchLike;
  private readonly readCredentials: () => FreshBooksCredentials | null;

  constructor(options: FreshBooksAdapterOptions = {}) {
    // NOTE: deliberately does NOT throw on missing creds (unlike MOC) so the
    // adapter can be registered in a gated env and resolve creds per-call.
    if (options.fetchImpl) this.fetchImpl = options.fetchImpl;
    this.readCredentials = options.readCredentials ?? readFreshBooksCredentialsFromEnv;
  }

  // Resolved only AFTER the gate passes — see each method. Keeping this private
  // and post-gate is what guarantees the gate cannot leak a live call.
  private resolveFetch(): FetchLike {
    if (this.fetchImpl) return this.fetchImpl;
    const g = (globalThis as unknown as { fetch?: FetchLike }).fetch;
    if (!g) throw new Error('No fetch implementation available');
    return g;
  }

  private async request<T>(
    creds: FreshBooksCredentials,
    fetchImpl: FetchLike,
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${FRESHBOOKS_API_URL}${path}`;
    const init: { method: string; headers: Record<string, string>; body?: string } = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.accessToken}`,
      },
    };
    if (body) init.body = JSON.stringify(body);

    const res = await fetchImpl(url, init);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`FreshBooks API error ${res.status}: ${text}`);
    }

    const json = (await res.json()) as {
      response?: { errors?: { message?: string }[]; result?: unknown };
    };
    if (json.response?.errors) {
      throw new Error(`FreshBooks: ${json.response.errors[0]?.message || 'Unknown error'}`);
    }
    return json.response?.result as T;
  }

  // ─── createInvoice → ArtifactRecord<'invoice'> ──────────────────────
  async createInvoice(params: CreateInvoiceParams): Promise<AdapterResult<InvoiceArtifact>> {
    const creds = this.readCredentials();
    if (!creds) return gated(GATE_MESSAGE);
    const fetchImpl = this.resolveFetch();

    try {
      const clientId = await this.findOrCreateClient(
        creds,
        fetchImpl,
        params.clientName,
        params.clientEmail
      );

      const lines = params.lineItems.map((li) => ({
        name: li.description,
        description: li.description,
        qty: li.quantity,
        unit_cost: { amount: li.unitPrice.toFixed(2), code: params.currency || 'USD' },
      }));

      const invoicePayload = {
        invoice: {
          customerid: clientId,
          create_date: new Date().toISOString().split('T')[0],
          due_date: params.dueDate,
          lines,
          notes: params.notes || '',
          status: 2, // 2 = sent
          currency_code: params.currency || 'USD',
        },
      };

      const data = await this.request<{ invoice: FBInvoice }>(
        creds,
        fetchImpl,
        'POST',
        `/accounting/account/${creds.accountId}/invoices/invoices`,
        invoicePayload
      );

      const invoiceResult = this.toInvoiceResult(data.invoice, params.dueDate);
      return ok(
        invoiceToArtifact({
          invoice: invoiceResult,
          provider: 'freshbooks',
          sourceResourceType: params.sourceResourceType,
          sourceResourceId: params.sourceResourceId,
          lastCheckedAt: new Date().toISOString(),
        })
      );
    } catch (err: unknown) {
      return failure(`FreshBooks createInvoice failed: ${errMsg(err)}`);
    }
  }

  // ─── listInvoices ───────────────────────────────────────────────────
  async listInvoices(filters?: InvoiceFilters): Promise<AdapterResult<InvoiceResult[]>> {
    const creds = this.readCredentials();
    if (!creds) return gated(GATE_MESSAGE);
    const fetchImpl = this.resolveFetch();

    try {
      let path = `/accounting/account/${creds.accountId}/invoices/invoices?per_page=50`;
      if (filters?.status) path += `&search[v3_status]=${encodeURIComponent(filters.status)}`;
      if (filters?.clientId) path += `&search[customerid]=${encodeURIComponent(filters.clientId)}`;
      if (filters?.from) path += `&search[date_min]=${encodeURIComponent(filters.from)}`;
      if (filters?.to) path += `&search[date_max]=${encodeURIComponent(filters.to)}`;

      const data = await this.request<{ invoices: FBInvoice[] }>(creds, fetchImpl, 'GET', path);
      const invoices = data.invoices || [];
      return ok(invoices.map((inv) => this.toInvoiceResult(inv, inv.due_date || '')));
    } catch (err: unknown) {
      return failure(`FreshBooks listInvoices failed: ${errMsg(err)}`);
    }
  }

  // ─── getBalance ─────────────────────────────────────────────────────
  async getBalance(): Promise<AdapterResult<BalanceResult>> {
    const creds = this.readCredentials();
    if (!creds) return gated(GATE_MESSAGE);
    const fetchImpl = this.resolveFetch();

    try {
      const invoicesData = await this.request<{ invoices: FBInvoice[] }>(
        creds,
        fetchImpl,
        'GET',
        `/accounting/account/${creds.accountId}/invoices/invoices?per_page=100&search[v3_status]=unpaid`
      );
      const invoices = invoicesData.invoices || [];
      let pending = 0;
      let currency = 'USD';
      for (const inv of invoices) {
        pending += parseFloat(inv.outstanding?.amount || '0');
        currency = inv.currency_code || currency;
      }

      const paymentsData = await this.request<{ payments: { amount: { amount: string } }[] }>(
        creds,
        fetchImpl,
        'GET',
        `/accounting/account/${creds.accountId}/payments/payments?per_page=100`
      );
      const payments = paymentsData.payments || [];
      let available = 0;
      for (const p of payments) {
        available += parseFloat(p.amount?.amount || '0');
      }

      return ok({ available, pending, currency });
    } catch (err: unknown) {
      return failure(`FreshBooks getBalance failed: ${errMsg(err)}`);
    }
  }

  // ─── syncCustomers ──────────────────────────────────────────────────
  async syncCustomers(): Promise<AdapterResult<CustomerResult[]>> {
    const creds = this.readCredentials();
    if (!creds) return gated(GATE_MESSAGE);
    const fetchImpl = this.resolveFetch();

    try {
      const data = await this.request<{ clients: FBClient[] }>(
        creds,
        fetchImpl,
        'GET',
        `/accounting/account/${creds.accountId}/users/clients?per_page=100`
      );
      return ok(
        (data.clients || []).map((c) => {
          const customer: CustomerResult = {
            id: String(c.id || c.userid),
            name: c.organization || `${c.fname || ''} ${c.lname || ''}`.trim(),
            email: c.email || '',
          };
          if (c.mob_phone) customer.phone = c.mob_phone;
          return customer;
        })
      );
    } catch (err: unknown) {
      return failure(`FreshBooks syncCustomers failed: ${errMsg(err)}`);
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────
  private toInvoiceResult(inv: FBInvoice, fallbackDueDate: string): InvoiceResult {
    const result: InvoiceResult = {
      id: String(inv.id || inv.invoiceid),
      externalId: String(inv.id || inv.invoiceid),
      status: mapStatus(inv.v3_status),
      amount: parseFloat(inv.amount?.amount || '0'),
      currency: inv.currency_code || 'USD',
      dueDate: inv.due_date || fallbackDueDate,
    };
    if (inv.v3_status === 'paid' && inv.date_paid) result.paidDate = inv.date_paid;
    if (inv.links?.client_view) result.paymentLink = inv.links.client_view;
    return result;
  }

  private async findOrCreateClient(
    creds: FreshBooksCredentials,
    fetchImpl: FetchLike,
    name: string,
    email: string
  ): Promise<number> {
    let searchPath = `/accounting/account/${creds.accountId}/users/clients?per_page=50`;
    if (email) searchPath += `&search[email]=${encodeURIComponent(email)}`;

    const data = await this.request<{ clients: FBClient[] }>(creds, fetchImpl, 'GET', searchPath);
    const clients = data.clients || [];
    const match = clients.find(
      (c) =>
        (email && c.email === email) ||
        `${c.fname || ''} ${c.lname || ''}`.trim() === name ||
        c.organization === name
    );
    if (match) return match.id || match.userid;

    const nameParts = name.split(' ');
    const fname = nameParts[0] || name;
    const lname = nameParts.slice(1).join(' ') || '';

    const result = await this.request<{ client: { id: number; userid: number } }>(
      creds,
      fetchImpl,
      'POST',
      `/accounting/account/${creds.accountId}/users/clients`,
      { client: { fname, lname, email: email || undefined, organization: name } }
    );
    return result.client.id || result.client.userid;
  }
}

// ─── Module-private helpers ──────────────────────────────────────────
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

function mapStatus(status: string): string {
  switch (status) {
    case 'paid':
      return 'paid';
    case 'partial':
      return 'partial';
    case 'sent':
    case 'viewed':
      return 'sent';
    case 'draft':
    case 'created':
      return 'draft';
    case 'overdue':
      return 'overdue';
    case 'declined':
      return 'failed';
    default:
      return 'pending';
  }
}

// ─── Internal FreshBooks shapes ──────────────────────────────────────
interface FBInvoice {
  id: number;
  invoiceid: number;
  v3_status: string;
  amount?: { amount: string };
  outstanding?: { amount: string };
  currency_code?: string;
  due_date?: string;
  date_paid?: string;
  links?: { client_view?: string };
}

interface FBClient {
  id: number;
  userid: number;
  fname?: string;
  lname?: string;
  email?: string;
  organization?: string;
  mob_phone?: string;
}
