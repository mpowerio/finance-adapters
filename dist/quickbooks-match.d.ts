import { type BookInvoiceResult, type BookTransactionResult } from './types.js';
import { type QuickBooksResult } from './quickbooks.js';
export interface PayPalPaymentEvidence {
    id: string;
    invoiceNumber: string;
    amount: number;
    currency: string;
    /** Explicit host-verified PayPal customer -> QBO customer mapping, never a name guess. */
    customerId: string;
}
export interface QuickBooksMatchSnapshot {
    invoices: readonly BookInvoiceResult[];
    payments: readonly BookTransactionResult[];
    deposits: readonly BookTransactionResult[];
}
export type QuickBooksDepositMatch = {
    status: 'matched';
    paypalPaymentId: string;
    depositId: string;
    paymentId: string;
    invoiceId: string;
} | {
    status: 'unmatched';
    reason: string;
} | {
    status: 'ambiguous';
    reason: string;
};
/**
 * Conservative one-payment/one-invoice, whole-deposit reconciliation. Host must
 * supply complete successful reads from ONE tenant/realm. Fees, batches, partial
 * allocations and missing references require human reconciliation, not guesses.
 * This records no ledger writes and does not mark an invoice paid.
 */
export declare function matchPayPalDeposit(paypal: PayPalPaymentEvidence, snapshot: QuickBooksMatchSnapshot): QuickBooksResult<QuickBooksDepositMatch>;
//# sourceMappingURL=quickbooks-match.d.ts.map