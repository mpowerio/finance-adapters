/**
 * @mpowerio/finance-adapters — Types
 *
 * Harvested from the MOC FinanceAdapter registry
 * (mpower-crm/src/lib/integrations/types.ts). The unifying envelope for
 * multi-provider invoicing/payments. The key Factory move: createInvoice maps
 * its provider result into an `ArtifactRecord<'invoice'>` IMPORTED from the
 * published `@mpowerio/core-contracts` — the cross-repo proof.
 */
import type { ArtifactRecord } from '@mpowerio/core-contracts';
export type FinanceProvider = 'freshbooks' | 'quickbooks' | 'paypal' | (string & {});
/** The Factory artifact shape every adapter produces for a created invoice. */
export type InvoiceArtifact = ArtifactRecord<'invoice'>;
export interface LineItem {
    description: string;
    quantity: number;
    unitPrice: number;
}
export interface CreateInvoiceParams {
    clientName: string;
    clientEmail: string;
    lineItems: LineItem[];
    dueDate: string;
    currency?: string;
    notes?: string;
    /**
     * The canonical row this invoice is generated FROM. Maps directly into
     * ArtifactRecord.sourceResourceType / sourceResourceId. e.g. 'estimate'
     * (FPC) | 'trip' (JBET).
     */
    sourceResourceType: 'estimate' | 'trip' | (string & {});
    sourceResourceId: string;
}
export interface InvoiceResult {
    id: string;
    externalId: string;
    status: string;
    amount: number;
    currency: string;
    dueDate: string;
    paidDate?: string;
    /** Provider-hosted invoice/client-view URL → becomes artifact externalUrl. */
    paymentLink?: string;
}
export interface CustomerResult {
    id: string;
    name: string;
    email: string;
    phone?: string;
    active?: boolean;
}
export interface BalanceResult {
    available: number;
    pending: number;
    currency: string;
}
export interface InvoiceFilters {
    status?: string;
    clientId?: string;
    from?: string;
    to?: string;
}
export interface AdapterOk<T> {
    ok: true;
    gated: false;
    data: T;
}
export interface AdapterGated {
    ok: false;
    gated: true;
    error: string;
}
export interface AdapterFailure {
    ok: false;
    gated: false;
    error: string;
}
export type AdapterResult<T> = AdapterOk<T> | AdapterGated | AdapterFailure;
export declare function ok<T>(data: T): AdapterOk<T>;
export declare function gated(error: string): AdapterGated;
export declare function failure(error: string): AdapterFailure;
export interface FinanceAdapter {
    name: string;
    /** Create an invoice and return it as a core-contracts ArtifactRecord. */
    createInvoice(params: CreateInvoiceParams): Promise<AdapterResult<InvoiceArtifact>>;
    listInvoices(filters?: InvoiceFilters): Promise<AdapterResult<InvoiceResult[]>>;
    getBalance(): Promise<AdapterResult<BalanceResult>>;
    syncCustomers(): Promise<AdapterResult<CustomerResult[]>>;
}
export interface FinanceReadFilters {
    /** Inclusive ISO timestamp; replay the boundary and upsert by provider ID. */
    updatedSince?: string;
}
export interface AccountResult {
    id: string;
    name: string;
    accountType: string;
    classification?: string;
    active?: boolean;
    currentBalance?: number;
    currency?: string;
}
export interface VendorResult {
    id: string;
    name: string;
    /** Provider signal only. Never an automatic tax/vendor classification. */
    vendor1099?: boolean;
    active?: boolean;
}
export interface BookTransactionLine {
    amount: number;
    linkedTransactions: {
        id: string;
        type: string;
    }[];
}
export interface BookTransactionResult {
    id: string;
    amount: number;
    currency: string;
    date: string;
    documentNumber?: string;
    reference?: string;
    customerId?: string;
    vendorId?: string;
    lines: BookTransactionLine[];
}
export interface PurchaseResult extends BookTransactionResult {
    /** True is a credit-card refund. Totals and lines retain provider amounts; no sign conversion. */
    credit: boolean;
    paymentType: 'Cash' | 'Check' | 'CreditCard';
    /** Purchase payee; vendorId is populated only when type is Vendor. */
    entityRef?: {
        value: string;
        type: 'Vendor' | 'Customer' | 'Employee';
        name?: string;
    };
}
export interface BookInvoiceResult extends InvoiceResult {
    invoiceNumber?: string;
    customerId: string;
    balance: number;
}
export interface FinanceReadAdapter extends FinanceAdapter {
    listInvoices(filters?: InvoiceFilters & FinanceReadFilters): Promise<AdapterResult<BookInvoiceResult[]>>;
    listAccounts(filters?: FinanceReadFilters): Promise<AdapterResult<AccountResult[]>>;
    listCustomers(filters?: FinanceReadFilters): Promise<AdapterResult<CustomerResult[]>>;
    listVendors(filters?: FinanceReadFilters): Promise<AdapterResult<VendorResult[]>>;
    listPurchases(filters?: FinanceReadFilters): Promise<AdapterResult<PurchaseResult[]>>;
    listBills(filters?: FinanceReadFilters): Promise<AdapterResult<BookTransactionResult[]>>;
    listDeposits(filters?: FinanceReadFilters): Promise<AdapterResult<BookTransactionResult[]>>;
    listPayments(filters?: FinanceReadFilters): Promise<AdapterResult<BookTransactionResult[]>>;
}
//# sourceMappingURL=types.d.ts.map