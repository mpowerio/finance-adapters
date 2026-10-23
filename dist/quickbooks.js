/** Read-first QBO adapter. Implementation from public Intuit documentation only. */
import { ok } from './types.js';
export const QUICKBOOKS_SCOPE = 'com.intuit.quickbooks.accounting';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REFRESH_MARGIN_MS = 300_000;
const HUNDRED_DAYS_MS = 100 * 86400_000;
export function readQuickBooksCredentialsFromEnv() {
    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
    const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI;
    return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}
/** Use this same key for OAuth callbacks/reconnect and scheduled refresh. */
export function quickBooksConnectionKey(connection, clientId) {
    return JSON.stringify(['quickbooks', connection.environment, clientId, connection.tenantId, connection.realmId]);
}
export function quickBooksFailure(code, message) {
    return { ok: false, gated: false, code, error: `quickbooks: ${message}` };
}
class BoundaryError extends Error {
    result;
    constructor(result) {
        super(result.error);
        this.result = result;
    }
}
function fail(code, message) {
    throw new BoundaryError(quickBooksFailure(code, message));
}
function reconnect() {
    return { ...quickBooksFailure('reconnect_needed', 'Reconnect needed. Reauthorize the QuickBooks connection before syncing.'), connectionStatus: 'needs_reauth' };
}
function record(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        fail('invalid_response', 'Expected an object in the provider response.');
    return value;
}
function str(value) {
    if (typeof value !== 'string' || !value.trim())
        fail('invalid_response', 'Missing or invalid text in provider response.');
    return value;
}
function num(value) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        fail('invalid_response', 'Missing or invalid number in provider response.');
    return value;
}
function optionalText(row, key) {
    return row[key] === undefined ? undefined : str(row[key]);
}
function ref(row, key) {
    return row[key] === undefined ? undefined : str(record(row[key]).value);
}
function date(value) {
    const text = str(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text) {
        fail('invalid_response', 'Invalid transaction date.');
    }
    return text;
}
export class QuickBooksAdapter {
    name = 'quickbooks';
    options;
    constructor(options = {}) {
        // Snapshot connection identity; caller mutation must not switch realms mid-read.
        this.options = { ...options, ...(options.connection ? { connection: { ...options.connection } } : {}) };
    }
    now() { return (this.options.now ?? Date.now)(); }
    async boundary(work) {
        try {
            return await work();
        }
        catch (error) {
            // Never echo fetch/store/provider exception text: it may contain tokens/PII.
            return error instanceof BoundaryError ? error.result : quickBooksFailure('storage_error', 'Connection storage/configuration failed; sync stopped.');
        }
    }
    async authenticated(work, forceRefresh = false) {
        return this.boundary(async () => {
            const creds = (this.options.readCredentials ?? readQuickBooksCredentialsFromEnv)();
            const connection = this.options.connection;
            const store = this.options.tokenStore;
            if (!creds?.clientId?.trim() || !creds.clientSecret?.trim() || !creds.redirectUri?.trim()
                || !connection?.tenantId?.trim() || !connection.realmId?.trim() || !store) {
                return { ok: false, gated: true, code: 'configuration_missing', error: 'quickbooks: App credentials, connection identity and durable token store are required; no HTTP call made.' };
            }
            if (!/^\d+$/.test(connection.realmId) || !['sandbox', 'production'].includes(connection.environment)
                || !/^https?:\/\//.test(creds.redirectUri) || !/^[\x21-\x7e]+$/.test(creds.clientId + creds.clientSecret)
                || (this.options.homeCurrency !== undefined && !/^[A-Z]{3}$/.test(this.options.homeCurrency))) {
                fail('invalid_configuration', 'Invalid realm, environment, OAuth configuration or home currency.');
            }
            for (const [value, limit] of [[this.options.pageSize ?? 1000, 1000], [this.options.maxPages ?? 1000, 10000], [this.options.timeoutMs ?? 30000, 120000]]) {
                if (!Number.isInteger(value) || value < 1 || value > limit)
                    fail('invalid_configuration', 'Invalid request bounds.');
            }
            return store.withLock(quickBooksConnectionKey(connection, creds.clientId), async (session) => {
                let state = await session.load();
                if (!state)
                    return { ok: false, gated: true, code: 'configuration_missing', error: 'quickbooks: No authorized connection; no HTTP call made.' };
                if (!state.accessToken?.trim() || !state.refreshToken?.trim()) {
                    return { ok: false, gated: true, code: 'configuration_missing', error: 'quickbooks: Stored token pair is missing; authorize the connection. No HTTP call made.' };
                }
                if (!Number.isFinite(state.accessTokenExpiresAt) || !Number.isFinite(state.refreshTokenExpiresAt)
                    || (state.refreshTokenHardExpiresAt !== undefined && !Number.isFinite(state.refreshTokenHardExpiresAt))) {
                    fail('invalid_configuration', 'Stored token pair/expiry metadata is incomplete; reconnect the connection.');
                }
                const markReconnect = async () => {
                    if (state.status !== 'needs_reauth')
                        await session.save({ ...state, status: 'needs_reauth' });
                    throw new BoundaryError(reconnect());
                };
                if (state.status !== 'active' || state.refreshTokenExpiresAt <= this.now()
                    || (state.refreshTokenHardExpiresAt ?? Infinity) <= this.now())
                    return markReconnect();
                const refresh = async () => {
                    const previous = state;
                    // Persist intent before the non-transactional remote rotation. A crash or
                    // failed save cannot silently reuse an old refresh token on the next run.
                    await session.save({ ...previous, status: 'refreshing' });
                    const started = this.now();
                    let response;
                    try {
                        response = await this.http(TOKEN_URL, {
                            method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded',
                                Authorization: `Basic ${btoa(`${creds.clientId}:${creds.clientSecret}`)}`, 'x-include-refresh-token-hard-expires-in': 'true' },
                            body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(previous.refreshToken)}`,
                        });
                    }
                    catch {
                        return markReconnect();
                    }
                    if (response.status === 401 || response.status >= 500)
                        return markReconnect();
                    if ([403, 404, 429].includes(response.status)) {
                        await session.save(previous);
                        throw new BoundaryError(this.httpFailure(response));
                    }
                    let body;
                    try {
                        body = record(await this.json(response));
                    }
                    catch {
                        return markReconnect();
                    }
                    if (body.error === 'invalid_grant' || response.status === 401)
                        return markReconnect();
                    if (!response.ok || body.error !== undefined) {
                        // A 429/4xx explicitly rejected the refresh; 5xx may have rotated.
                        if (response.status >= 500 || response.ok)
                            return markReconnect();
                        await session.save(previous);
                        throw new BoundaryError(this.httpFailure(response));
                    }
                    let next;
                    try {
                        const access = num(body.expires_in);
                        const rolling = num(body.x_refresh_token_expires_in);
                        const hard = body.x_refresh_token_hard_expires_in === undefined ? undefined : num(body.x_refresh_token_hard_expires_in);
                        if (access <= 0 || rolling <= 0 || (hard !== undefined && hard <= 0)
                            || String(body.token_type).toLowerCase() !== 'bearer')
                            return markReconnect();
                        next = { status: 'active', accessToken: str(body.access_token), refreshToken: str(body.refresh_token),
                            accessTokenExpiresAt: started + access * 1000,
                            refreshTokenExpiresAt: started + Math.min(rolling * 1000, HUNDRED_DAYS_MS),
                            ...((hard !== undefined || previous.refreshTokenHardExpiresAt !== undefined)
                                ? { refreshTokenHardExpiresAt: Math.min(hard === undefined ? Infinity : started + hard * 1000, previous.refreshTokenHardExpiresAt ?? Infinity) } : {}),
                        };
                        if (![next.accessTokenExpiresAt, next.refreshTokenExpiresAt, next.refreshTokenHardExpiresAt ?? 0].every(Number.isFinite))
                            return markReconnect();
                    }
                    catch {
                        return markReconnect();
                    }
                    await session.save(next);
                    state = next;
                };
                if (forceRefresh || state.accessTokenExpiresAt <= this.now() + REFRESH_MARGIN_MS)
                    await refresh();
                const base = connection.environment === 'sandbox' ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com';
                const request = async (path) => {
                    // Long paginated pulls can outlive an access token.
                    if (state.accessTokenExpiresAt <= this.now() + REFRESH_MARGIN_MS)
                        await refresh();
                    const send = () => this.http(`${base}/v3/company/${connection.realmId}${path}`, {
                        method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${state.accessToken}` },
                    });
                    let response = await send();
                    if (response.status === 401) {
                        await refresh();
                        response = await send();
                    }
                    if (response.status === 401)
                        return markReconnect();
                    if (!response.ok)
                        throw new BoundaryError(this.httpFailure(response));
                    const body = record(await this.json(response));
                    if (body.Fault !== undefined) {
                        const fault = record(body.Fault);
                        if (fault.type === 'AuthenticationFault')
                            return markReconnect();
                        fail('api_error', 'Provider returned a Fault; sync stopped.');
                    }
                    return body;
                };
                return ok(await work(request));
            });
        });
    }
    async http(url, init) {
        const controller = new AbortController();
        let timer;
        const timeout = new Promise((_resolve, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new BoundaryError(quickBooksFailure('timeout', 'Request timed out; sync stopped.'))); }, this.options.timeoutMs ?? 30000);
        });
        try {
            const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
            if (!fetchImpl)
                fail('invalid_configuration', 'No fetch implementation is available.');
            // Buffer under the deadline too; response headers alone do not complete a read.
            return await Promise.race([timeout, (async () => {
                    const response = await fetchImpl(url, { ...init, signal: controller.signal, redirect: 'error' });
                    const text = await response.text();
                    return new Response(text, { status: response.status, headers: response.headers });
                })()]);
        }
        catch (error) {
            if (error instanceof BoundaryError)
                throw error;
            return fail('network_error', 'Network request failed; sync stopped.');
        }
        finally {
            if (timer !== undefined)
                clearTimeout(timer);
        }
    }
    async json(response) {
        try {
            return await response.json();
        }
        catch {
            return fail('invalid_response', 'Provider returned invalid JSON.');
        }
    }
    httpFailure(response) {
        const code = response.status === 429 ? 'rate_limited' : response.status === 404 ? 'not_found'
            : response.status === 403 ? 'forbidden' : 'api_error';
        const result = { ...quickBooksFailure(code, `HTTP ${response.status}; sync stopped.`), httpStatus: response.status };
        const retry = response.headers.get('Retry-After');
        if (retry) {
            const seconds = /^\d+$/.test(retry) ? Number(retry) : Math.ceil((Date.parse(retry) - this.now()) / 1000);
            if (Number.isFinite(seconds) && seconds >= 0)
                return { ...result, retryAfterSeconds: seconds };
        }
        return result;
    }
    since(filters) {
        if (filters?.updatedSince === undefined)
            return [];
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(filters.updatedSince)
            || !Number.isFinite(Date.parse(filters.updatedSince)))
            fail('invalid_input', 'updatedSince must be an ISO timestamp with timezone.');
        return [`MetaData.LastUpdatedTime >= '${new Date(filters.updatedSince).toISOString()}'`];
    }
    async query(entity, map, clauses) {
        return this.boundary(async () => {
            const where = clauses();
            // QBO name lists otherwise silently omit inactive records.
            if (['Account', 'Customer', 'Vendor'].includes(entity))
                where.push('Active IN (true, false)');
            return this.authenticated(async (request) => {
                const rows = [];
                const ids = new Set();
                const pageSize = this.options.pageSize ?? 1000;
                for (let page = 0; page < (this.options.maxPages ?? 1000); page++) {
                    const start = page * pageSize + 1;
                    const sql = `SELECT * FROM ${entity}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDERBY Id STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
                    const body = record(await request(`/query?query=${encodeURIComponent(sql)}`));
                    const result = record(body.QueryResponse);
                    const items = result[entity];
                    if (items === undefined) {
                        // Intuit represents a successful zero-row query with QueryResponse:{}.
                        if (Object.keys(result).some(key => !['startPosition', 'maxResults', 'totalCount'].includes(key))
                            || (result.maxResults !== undefined && result.maxResults !== 0)
                            || (result.totalCount !== undefined && result.totalCount !== 0))
                            fail('invalid_response', 'Query response omitted the requested entity.');
                        return rows;
                    }
                    if (!Array.isArray(items) || items.length > pageSize
                        || (result.startPosition !== undefined && result.startPosition !== start)
                        || (result.maxResults !== undefined && result.maxResults !== items.length))
                        fail('invalid_response', 'Invalid page shape or pagination metadata.');
                    for (const item of items) {
                        const row = record(item);
                        const id = str(row.Id);
                        if (ids.has(id))
                            fail('pagination_incomplete', 'Repeated provider ID across pages; restart with an overlapping cursor.');
                        ids.add(id);
                        rows.push(map(row));
                    }
                    if (items.length < pageSize)
                        return rows;
                }
                return fail('pagination_incomplete', 'Page limit reached; no partial results returned.');
            });
        });
    }
    currency(row) {
        const currency = ref(row, 'CurrencyRef') ?? this.options.homeCurrency;
        if (!currency || !/^[A-Z]{3}$/.test(currency))
            fail('invalid_response', 'Currency missing/invalid; configure verified company homeCurrency.');
        return currency;
    }
    transaction = (row) => {
        if (!Array.isArray(row.Line))
            fail('invalid_response', 'Transaction lines are missing.');
        const lines = row.Line.map(value => {
            const line = record(value);
            const links = line.LinkedTxn ?? [];
            if (!Array.isArray(links))
                fail('invalid_response', 'Invalid transaction links.');
            return { amount: num(line.Amount), linkedTransactions: links.map(value => {
                    const link = record(value);
                    return { id: str(link.TxnId), type: str(link.TxnType) };
                }) };
        });
        const result = { id: str(row.Id), amount: num(row.TotalAmt), currency: this.currency(row), date: date(row.TxnDate), lines };
        const documentNumber = optionalText(row, 'DocNumber');
        if (documentNumber !== undefined)
            result.documentNumber = documentNumber;
        const reference = optionalText(row, 'PaymentRefNum');
        if (reference !== undefined)
            result.reference = reference;
        const customerId = ref(row, 'CustomerRef');
        if (customerId !== undefined)
            result.customerId = customerId;
        const vendorId = ref(row, 'VendorRef');
        if (vendorId !== undefined)
            result.vendorId = vendorId;
        return result;
    };
    listAccounts(filters) {
        return this.query('Account', row => {
            const account = { id: str(row.Id), name: str(row.Name), accountType: str(row.AccountType) };
            if (row.Classification !== undefined)
                account.classification = str(row.Classification);
            if (row.Active !== undefined) {
                if (typeof row.Active !== 'boolean')
                    fail('invalid_response', 'Invalid account activity.');
                account.active = row.Active;
            }
            if (row.CurrentBalance !== undefined)
                account.currentBalance = num(row.CurrentBalance);
            if (row.CurrencyRef !== undefined || this.options.homeCurrency)
                account.currency = this.currency(row);
            return account;
        }, () => this.since(filters));
    }
    listCustomers(filters) {
        return this.query('Customer', row => {
            const customer = { id: str(row.Id), name: str(row.DisplayName), email: row.PrimaryEmailAddr === undefined ? '' : str(record(row.PrimaryEmailAddr).Address) };
            if (row.PrimaryPhone !== undefined)
                customer.phone = str(record(row.PrimaryPhone).FreeFormNumber);
            if (row.Active !== undefined) {
                if (typeof row.Active !== 'boolean')
                    fail('invalid_response', 'Invalid customer activity.');
                customer.active = row.Active;
            }
            return customer;
        }, () => this.since(filters));
    }
    listVendors(filters) {
        return this.query('Vendor', row => {
            const vendor = { id: str(row.Id), name: str(row.DisplayName) };
            if (row.Vendor1099 !== undefined) {
                if (typeof row.Vendor1099 !== 'boolean')
                    fail('invalid_response', 'Invalid Vendor1099.');
                vendor.vendor1099 = row.Vendor1099;
            }
            if (row.Active !== undefined) {
                if (typeof row.Active !== 'boolean')
                    fail('invalid_response', 'Invalid vendor activity.');
                vendor.active = row.Active;
            }
            return vendor;
        }, () => this.since(filters));
    }
    listPurchases(filters) { return this.query('Purchase', this.transaction, () => this.since(filters)); }
    listBills(filters) { return this.query('Bill', this.transaction, () => this.since(filters)); }
    listDeposits(filters) { return this.query('Deposit', this.transaction, () => this.since(filters)); }
    listPayments(filters) { return this.query('Payment', this.transaction, () => this.since(filters)); }
    listInvoices(filters) {
        return this.query('Invoice', row => {
            const balance = num(row.Balance);
            const amount = num(row.TotalAmt);
            const invoice = { id: str(row.Id), externalId: str(row.Id), amount, balance,
                currency: this.currency(row), customerId: str(ref(row, 'CustomerRef')),
                status: balance === 0 ? 'paid' : balance < amount ? 'partial' : 'unpaid',
                dueDate: row.DueDate === undefined ? '' : date(row.DueDate) };
            if (row.DocNumber !== undefined)
                invoice.invoiceNumber = str(row.DocNumber);
            return invoice;
        }, () => {
            const clauses = this.since(filters);
            if (filters?.status) {
                if (filters.status === 'paid')
                    clauses.push('Balance = \'0\'');
                else if (filters.status === 'unpaid')
                    clauses.push('Balance > \'0\'');
                else
                    fail('invalid_input', 'Supported invoice status filters are paid and unpaid (any outstanding balance).');
            }
            if (filters?.clientId !== undefined) {
                if (!/^\d+$/.test(filters.clientId))
                    fail('invalid_input', 'clientId must be a QBO numeric ID.');
                clauses.push(`CustomerRef = '${filters.clientId}'`);
            }
            for (const [value, operator] of [[filters?.from, '>='], [filters?.to, '<=']]) {
                if (value !== undefined) {
                    try {
                        date(value);
                    }
                    catch {
                        fail('invalid_input', 'Invoice date filters must be YYYY-MM-DD.');
                    }
                    clauses.push(`TxnDate ${operator} '${value}'`);
                }
            }
            if (filters?.from && filters.to && filters.from > filters.to)
                fail('invalid_input', 'Invoice from date must not follow to date.');
            return clauses;
        });
    }
    syncCustomers() { return this.listCustomers(); }
    async createInvoice(_params) {
        return quickBooksFailure('writes_disabled', 'writes disabled in read-first phase');
    }
    async getBalance() {
        // Available/pending wallet balances have no honest company-ledger equivalent.
        return quickBooksFailure('unsupported_operation', 'Wallet balance is not defined for books; use listAccounts for per-account balances.');
    }
    /** Daily host scheduler hook; no background timer or hidden network traffic. */
    refreshConnection() {
        return this.authenticated(async () => ({ status: 'active' }), true);
    }
}
//# sourceMappingURL=quickbooks.js.map