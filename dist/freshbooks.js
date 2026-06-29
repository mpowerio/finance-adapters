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
import { ok, gated, failure, } from './types.js';
import { invoiceToArtifact } from './artifact.js';
const FRESHBOOKS_API_URL = 'https://api.freshbooks.com';
/**
 * Read the full FreshBooks credential set from the environment. Returns null
 * (→ gated) if ANY of the four are absent. CLIENT_ID/SECRET gate the OAuth app;
 * ACCESS_TOKEN/ACCOUNT_ID gate the live REST surface (MOC's runtime vars).
 */
export function readFreshBooksCredentialsFromEnv() {
    const clientId = process.env.FRESHBOOKS_CLIENT_ID;
    const clientSecret = process.env.FRESHBOOKS_CLIENT_SECRET;
    const accessToken = process.env.FRESHBOOKS_ACCESS_TOKEN;
    const accountId = process.env.FRESHBOOKS_ACCOUNT_ID;
    if (!clientId || !clientSecret || !accessToken || !accountId)
        return null;
    return { clientId, clientSecret, accessToken, accountId };
}
const GATE_MESSAGE = 'FreshBooks credentials absent (FRESHBOOKS_CLIENT_ID / FRESHBOOKS_CLIENT_SECRET / FRESHBOOKS_ACCESS_TOKEN / FRESHBOOKS_ACCOUNT_ID) — gated, no live call made.';
export class FreshBooksAdapter {
    name = 'freshbooks';
    fetchImpl;
    readCredentials;
    constructor(options = {}) {
        // NOTE: deliberately does NOT throw on missing creds (unlike MOC) so the
        // adapter can be registered in a gated env and resolve creds per-call.
        if (options.fetchImpl)
            this.fetchImpl = options.fetchImpl;
        this.readCredentials = options.readCredentials ?? readFreshBooksCredentialsFromEnv;
    }
    // Resolved only AFTER the gate passes — see each method. Keeping this private
    // and post-gate is what guarantees the gate cannot leak a live call.
    resolveFetch() {
        if (this.fetchImpl)
            return this.fetchImpl;
        const g = globalThis.fetch;
        if (!g)
            throw new Error('No fetch implementation available');
        return g;
    }
    async request(creds, fetchImpl, method, path, body) {
        const url = `${FRESHBOOKS_API_URL}${path}`;
        const init = {
            method,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${creds.accessToken}`,
            },
        };
        if (body)
            init.body = JSON.stringify(body);
        const res = await fetchImpl(url, init);
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`FreshBooks API error ${res.status}: ${text}`);
        }
        const json = (await res.json());
        if (json.response?.errors) {
            throw new Error(`FreshBooks: ${json.response.errors[0]?.message || 'Unknown error'}`);
        }
        return json.response?.result;
    }
    // ─── createInvoice → ArtifactRecord<'invoice'> ──────────────────────
    async createInvoice(params) {
        const creds = this.readCredentials();
        if (!creds)
            return gated(GATE_MESSAGE);
        const fetchImpl = this.resolveFetch();
        try {
            const clientId = await this.findOrCreateClient(creds, fetchImpl, params.clientName, params.clientEmail);
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
            const data = await this.request(creds, fetchImpl, 'POST', `/accounting/account/${creds.accountId}/invoices/invoices`, invoicePayload);
            const invoiceResult = this.toInvoiceResult(data.invoice, params.dueDate);
            return ok(invoiceToArtifact({
                invoice: invoiceResult,
                provider: 'freshbooks',
                sourceResourceType: params.sourceResourceType,
                sourceResourceId: params.sourceResourceId,
                lastCheckedAt: new Date().toISOString(),
            }));
        }
        catch (err) {
            return failure(`FreshBooks createInvoice failed: ${errMsg(err)}`);
        }
    }
    // ─── listInvoices ───────────────────────────────────────────────────
    async listInvoices(filters) {
        const creds = this.readCredentials();
        if (!creds)
            return gated(GATE_MESSAGE);
        const fetchImpl = this.resolveFetch();
        try {
            let path = `/accounting/account/${creds.accountId}/invoices/invoices?per_page=50`;
            if (filters?.status)
                path += `&search[v3_status]=${encodeURIComponent(filters.status)}`;
            if (filters?.clientId)
                path += `&search[customerid]=${encodeURIComponent(filters.clientId)}`;
            if (filters?.from)
                path += `&search[date_min]=${encodeURIComponent(filters.from)}`;
            if (filters?.to)
                path += `&search[date_max]=${encodeURIComponent(filters.to)}`;
            const data = await this.request(creds, fetchImpl, 'GET', path);
            const invoices = data.invoices || [];
            return ok(invoices.map((inv) => this.toInvoiceResult(inv, inv.due_date || '')));
        }
        catch (err) {
            return failure(`FreshBooks listInvoices failed: ${errMsg(err)}`);
        }
    }
    // ─── getBalance ─────────────────────────────────────────────────────
    async getBalance() {
        const creds = this.readCredentials();
        if (!creds)
            return gated(GATE_MESSAGE);
        const fetchImpl = this.resolveFetch();
        try {
            const invoicesData = await this.request(creds, fetchImpl, 'GET', `/accounting/account/${creds.accountId}/invoices/invoices?per_page=100&search[v3_status]=unpaid`);
            const invoices = invoicesData.invoices || [];
            let pending = 0;
            let currency = 'USD';
            for (const inv of invoices) {
                pending += parseFloat(inv.outstanding?.amount || '0');
                currency = inv.currency_code || currency;
            }
            const paymentsData = await this.request(creds, fetchImpl, 'GET', `/accounting/account/${creds.accountId}/payments/payments?per_page=100`);
            const payments = paymentsData.payments || [];
            let available = 0;
            for (const p of payments) {
                available += parseFloat(p.amount?.amount || '0');
            }
            return ok({ available, pending, currency });
        }
        catch (err) {
            return failure(`FreshBooks getBalance failed: ${errMsg(err)}`);
        }
    }
    // ─── syncCustomers ──────────────────────────────────────────────────
    async syncCustomers() {
        const creds = this.readCredentials();
        if (!creds)
            return gated(GATE_MESSAGE);
        const fetchImpl = this.resolveFetch();
        try {
            const data = await this.request(creds, fetchImpl, 'GET', `/accounting/account/${creds.accountId}/users/clients?per_page=100`);
            return ok((data.clients || []).map((c) => {
                const customer = {
                    id: String(c.id || c.userid),
                    name: c.organization || `${c.fname || ''} ${c.lname || ''}`.trim(),
                    email: c.email || '',
                };
                if (c.mob_phone)
                    customer.phone = c.mob_phone;
                return customer;
            }));
        }
        catch (err) {
            return failure(`FreshBooks syncCustomers failed: ${errMsg(err)}`);
        }
    }
    // ─── Private helpers ────────────────────────────────────────────────
    toInvoiceResult(inv, fallbackDueDate) {
        const result = {
            id: String(inv.id || inv.invoiceid),
            externalId: String(inv.id || inv.invoiceid),
            status: mapStatus(inv.v3_status),
            amount: parseFloat(inv.amount?.amount || '0'),
            currency: inv.currency_code || 'USD',
            dueDate: inv.due_date || fallbackDueDate,
        };
        if (inv.v3_status === 'paid' && inv.date_paid)
            result.paidDate = inv.date_paid;
        if (inv.links?.client_view)
            result.paymentLink = inv.links.client_view;
        return result;
    }
    async findOrCreateClient(creds, fetchImpl, name, email) {
        let searchPath = `/accounting/account/${creds.accountId}/users/clients?per_page=50`;
        if (email)
            searchPath += `&search[email]=${encodeURIComponent(email)}`;
        const data = await this.request(creds, fetchImpl, 'GET', searchPath);
        const clients = data.clients || [];
        const match = clients.find((c) => (email && c.email === email) ||
            `${c.fname || ''} ${c.lname || ''}`.trim() === name ||
            c.organization === name);
        if (match)
            return match.id || match.userid;
        const nameParts = name.split(' ');
        const fname = nameParts[0] || name;
        const lname = nameParts.slice(1).join(' ') || '';
        const result = await this.request(creds, fetchImpl, 'POST', `/accounting/account/${creds.accountId}/users/clients`, { client: { fname, lname, email: email || undefined, organization: name } });
        return result.client.id || result.client.userid;
    }
}
// ─── Module-private helpers ──────────────────────────────────────────
function errMsg(err) {
    return err instanceof Error ? err.message : 'Unknown error';
}
function mapStatus(status) {
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
//# sourceMappingURL=freshbooks.js.map