import type { AdapterOk, FinanceReadAdapter, FinanceReadFilters, InvoiceFilters, CreateInvoiceParams, InvoiceArtifact, BalanceResult, AccountResult, VendorResult, CustomerResult, BookInvoiceResult, BookTransactionResult } from './types.js';
export declare const QUICKBOOKS_SCOPE = "com.intuit.quickbooks.accounting";
export type QuickBooksErrorCode = 'configuration_missing' | 'invalid_configuration' | 'invalid_input' | 'reconnect_needed' | 'rate_limited' | 'not_found' | 'forbidden' | 'api_error' | 'invalid_response' | 'network_error' | 'timeout' | 'storage_error' | 'writes_disabled' | 'unsupported_operation' | 'pagination_incomplete';
export interface QuickBooksFailure {
    ok: false;
    gated: false;
    code: QuickBooksErrorCode;
    error: string;
    connectionStatus?: 'needs_reauth';
    httpStatus?: number;
    retryAfterSeconds?: number;
}
export interface QuickBooksGated {
    ok: false;
    gated: true;
    code: 'configuration_missing';
    error: string;
}
export type QuickBooksResult<T> = AdapterOk<T> | QuickBooksFailure | QuickBooksGated;
export interface QuickBooksCredentials {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}
export interface QuickBooksConnection {
    tenantId: string;
    realmId: string;
    environment: 'sandbox' | 'production';
}
export interface QuickBooksConnectionState {
    status: 'active' | 'refreshing' | 'needs_reauth';
    accessToken: string;
    refreshToken: string;
    /** Absolute epoch milliseconds, calculated at token receipt. */
    accessTokenExpiresAt: number;
    refreshTokenExpiresAt: number;
    refreshTokenHardExpiresAt?: number;
}
export interface QuickBooksTokenSession {
    load(): Promise<QuickBooksConnectionState | null>;
    /** Atomic, durable commit BEFORE resolving; do not log token values. */
    save(state: QuickBooksConnectionState): Promise<void>;
}
export interface QuickBooksTokenStore {
    /**
     * Exclusive across ALL instances/workers using this key, including reconnect.
     * Each save commits immediately, even if work later fails. A transaction that
     * rolls back earlier saves on failure is NOT a valid implementation.
     */
    withLock<T>(key: string, work: (session: QuickBooksTokenSession) => Promise<T>): Promise<T>;
}
export interface QuickBooksAdapterOptions {
    connection?: QuickBooksConnection;
    tokenStore?: QuickBooksTokenStore;
    readCredentials?: () => QuickBooksCredentials | null;
    fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
    /** Verified company home currency, used ONLY when QBO omits CurrencyRef. */
    homeCurrency?: string;
    now?: () => number;
    timeoutMs?: number;
    pageSize?: number;
    maxPages?: number;
}
export declare function readQuickBooksCredentialsFromEnv(): QuickBooksCredentials | null;
/** Use this same key for OAuth callbacks/reconnect and scheduled refresh. */
export declare function quickBooksConnectionKey(connection: QuickBooksConnection, clientId: string): string;
export declare function quickBooksFailure(code: QuickBooksErrorCode, message: string): QuickBooksFailure;
export declare class QuickBooksAdapter implements FinanceReadAdapter {
    readonly name = "quickbooks";
    private readonly options;
    constructor(options?: QuickBooksAdapterOptions);
    private now;
    private boundary;
    private authenticated;
    private http;
    private json;
    private httpFailure;
    private since;
    private query;
    private currency;
    private transaction;
    listAccounts(filters?: FinanceReadFilters): Promise<QuickBooksResult<AccountResult[]>>;
    listCustomers(filters?: FinanceReadFilters): Promise<QuickBooksResult<CustomerResult[]>>;
    listVendors(filters?: FinanceReadFilters): Promise<QuickBooksResult<VendorResult[]>>;
    listPurchases(filters?: FinanceReadFilters): Promise<QuickBooksResult<BookTransactionResult[]>>;
    listBills(filters?: FinanceReadFilters): Promise<QuickBooksResult<BookTransactionResult[]>>;
    listDeposits(filters?: FinanceReadFilters): Promise<QuickBooksResult<BookTransactionResult[]>>;
    listPayments(filters?: FinanceReadFilters): Promise<QuickBooksResult<BookTransactionResult[]>>;
    listInvoices(filters?: InvoiceFilters & FinanceReadFilters): Promise<QuickBooksResult<BookInvoiceResult[]>>;
    syncCustomers(): Promise<QuickBooksResult<CustomerResult[]>>;
    createInvoice(_params: CreateInvoiceParams): Promise<QuickBooksResult<InvoiceArtifact>>;
    getBalance(): Promise<QuickBooksResult<BalanceResult>>;
    /** Daily host scheduler hook; no background timer or hidden network traffic. */
    refreshConnection(): Promise<QuickBooksResult<{
        status: 'active';
    }>>;
}
//# sourceMappingURL=quickbooks.d.ts.map