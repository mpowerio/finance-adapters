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
import { type FinanceAdapter, type CreateInvoiceParams, type InvoiceResult, type InvoiceFilters, type CustomerResult, type BalanceResult, type InvoiceArtifact, type AdapterResult } from './types.js';
export interface FetchLikeResponse {
    ok: boolean;
    status: number;
    text(): Promise<string>;
    json(): Promise<unknown>;
}
export type FetchLike = (url: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}) => Promise<FetchLikeResponse>;
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
export declare function readFreshBooksCredentialsFromEnv(): FreshBooksCredentials | null;
export interface FreshBooksAdapterOptions {
    /** Inject an HTTP impl. Defaults to global fetch. Tests pass a mock. */
    fetchImpl?: FetchLike;
    /** Override the credential source. Defaults to env. */
    readCredentials?: () => FreshBooksCredentials | null;
}
export declare class FreshBooksAdapter implements FinanceAdapter {
    readonly name = "freshbooks";
    private readonly fetchImpl?;
    private readonly readCredentials;
    constructor(options?: FreshBooksAdapterOptions);
    private resolveFetch;
    private request;
    createInvoice(params: CreateInvoiceParams): Promise<AdapterResult<InvoiceArtifact>>;
    listInvoices(filters?: InvoiceFilters): Promise<AdapterResult<InvoiceResult[]>>;
    getBalance(): Promise<AdapterResult<BalanceResult>>;
    syncCustomers(): Promise<AdapterResult<CustomerResult[]>>;
    private toInvoiceResult;
    private findOrCreateClient;
}
//# sourceMappingURL=freshbooks.d.ts.map