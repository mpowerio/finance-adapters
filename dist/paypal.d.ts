import { type FinanceAdapter, type InvoiceFilters } from "./types.js";
type Money = {
    value: string;
    currency_code: string;
};
export declare function transaction(info: {
    transaction_id: string;
    invoice_id?: string;
    transaction_event_code: string;
    transaction_amount: Money;
    fee_amount?: Money;
}): {
    id: string;
    invoiceNumber: string | undefined;
    code: string;
    currency: string;
    gross: number;
    fee: number;
    net: number;
};
export interface CancelApproval {
    expectedInvoiceId: string;
    nonce: string;
    approvedBy: string;
    approvedAt: string;
    expectedRecipientEmail: string;
    expectedInvoiceNumber: string;
}
export declare class PayPalAdapter implements FinanceAdapter {
    private readonly transport;
    readonly name = "paypal";
    constructor(transport?: (url: string, options: RequestInit) => Promise<Response>);
    createInvoice(): Promise<import("./types.js").AdapterFailure>;
    getBalance(): Promise<import("./types.js").AdapterFailure>;
    syncCustomers(): Promise<import("./types.js").AdapterFailure>;
    private request;
    private invoice;
    getInvoice(id: string): Promise<import("./types.js").AdapterFailure | import("./types.js").AdapterOk<{
        id: string;
        externalId: string;
        number: string;
        recipient: {
            name: any;
            business: any;
            email: string | null;
        };
        status: string;
        amount: number;
        currency: string;
        invoiceDate: any;
        dueDate: any;
        seriesId: any;
    }>>;
    listInvoices(filters?: InvoiceFilters): Promise<import("./types.js").AdapterFailure | import("./types.js").AdapterOk<{
        id: string;
        externalId: string;
        number: string;
        recipient: {
            name: any;
            business: any;
            email: string | null;
        };
        status: string;
        amount: number;
        currency: string;
        invoiceDate: any;
        dueDate: any;
        seriesId: any;
    }[]>>;
    cancelInvoice(id: string, approval: CancelApproval): Promise<import("./types.js").AdapterFailure | import("./types.js").AdapterOk<{
        id: string;
        nonce: string;
        approvedBy: string;
        approvedAt: string;
        recipientEmail: string;
        invoiceNumber: string;
        acceptedAt: string;
        customerNotification: boolean;
    }>>;
    searchTransactions(start: string, end: string): Promise<import("./types.js").AdapterFailure | import("./types.js").AdapterOk<{
        id: string;
        invoiceNumber: string | undefined;
        code: string;
        currency: string;
        gross: number;
        fee: number;
        net: number;
    }[]>>;
    verifyWebhook(headers: Headers, event: {
        id: string;
        event_type: string;
        resource: {
            id?: string;
            invoice?: {
                id: string;
            };
        };
    }): Promise<import("./types.js").AdapterFailure | import("./types.js").AdapterOk<{
        idempotencyKey: string;
        type: string;
        resourceId: string;
    }>>;
}
export {};
//# sourceMappingURL=paypal.d.ts.map