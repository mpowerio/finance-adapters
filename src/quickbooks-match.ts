import { ok, type BookInvoiceResult, type BookTransactionResult } from './types.js';
import { quickBooksFailure, type QuickBooksResult } from './quickbooks.js';

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
export type QuickBooksDepositMatch =
  | { status: 'matched'; paypalPaymentId: string; depositId: string; paymentId: string; invoiceId: string }
  | { status: 'unmatched'; reason: string }
  | { status: 'ambiguous'; reason: string };

function cents(amount: number): number | null {
  const value = Math.round(amount * 100);
  return Number.isFinite(amount) && Number.isSafeInteger(value) && Math.abs(amount * 100 - value) < 0.000001 ? value : null;
}
/**
 * Conservative one-payment/one-invoice, whole-deposit reconciliation. Host must
 * supply complete successful reads from ONE tenant/realm. Fees, batches, partial
 * allocations and missing references require human reconciliation, not guesses.
 * This records no ledger writes and does not mark an invoice paid.
 */
export function matchPayPalDeposit(paypal: PayPalPaymentEvidence, snapshot: QuickBooksMatchSnapshot): QuickBooksResult<QuickBooksDepositMatch> {
  try {
    if (![paypal.id, paypal.invoiceNumber, paypal.customerId].every(v => typeof v === 'string' && v.trim())
        || !/^[A-Z]{3}$/.test(paypal.currency) || cents(paypal.amount) === null || paypal.amount <= 0) {
      return quickBooksFailure('invalid_input', 'Valid PayPal reference, invoice, customer mapping, currency and positive two-decimal amount are required.');
    }
    for (const rows of [snapshot.invoices, snapshot.payments, snapshot.deposits]) {
      if (!Array.isArray(rows) || rows.some(row => typeof row.id !== 'string' || !row.id
          || cents(row.amount) === null || !/^[A-Z]{3}$/.test(row.currency))) {
        return quickBooksFailure('invalid_input', 'Invalid reconciliation snapshot.');
      }
      if (new Set(rows.map(row => row.id)).size !== rows.length) {
        return ok({ status: 'ambiguous', reason: 'Duplicate provider IDs in snapshot.' });
      }
    }
    const invoices = snapshot.invoices.filter(invoice => invoice.invoiceNumber === paypal.invoiceNumber && invoice.customerId === paypal.customerId);
    if (invoices.length > 1) return ok({ status: 'ambiguous', reason: 'Invoice number is not unique for the mapped customer.' });
    const invoice = invoices[0];
    if (!invoice || invoice.currency !== paypal.currency || cents(invoice.amount) !== cents(paypal.amount)) {
      return ok({ status: 'unmatched', reason: 'No exact invoice number/customer/amount/currency evidence.' });
    }
    const sameAmount = (amount: number) => cents(amount) !== null && cents(amount) === cents(paypal.amount);
    const matches: Extract<QuickBooksDepositMatch, { status: 'matched' }>[] = [];
    for (const payment of snapshot.payments) {
      if (payment.reference !== paypal.id || payment.customerId !== paypal.customerId || payment.currency !== paypal.currency || !sameAmount(payment.amount)) continue;
      const paymentLine = payment.lines[0];
      if (payment.lines.length !== 1 || !paymentLine || !sameAmount(paymentLine.amount) || paymentLine.linkedTransactions.length !== 1
          || paymentLine.linkedTransactions[0]?.type !== 'Invoice' || paymentLine.linkedTransactions[0].id !== invoice.id) continue;
      for (const deposit of snapshot.deposits) {
        const line = deposit.lines[0];
        if (deposit.currency !== paypal.currency || !sameAmount(deposit.amount) || deposit.lines.length !== 1 || !line
            || !sameAmount(line.amount) || line.linkedTransactions.length !== 1
            || line.linkedTransactions[0]?.type !== 'Payment' || line.linkedTransactions[0].id !== payment.id) continue;
        matches.push({ status: 'matched', paypalPaymentId: paypal.id, depositId: deposit.id, paymentId: payment.id, invoiceId: invoice.id });
      }
    }
    if (matches.length > 1) return ok({ status: 'ambiguous', reason: 'Multiple complete deposit/payment/invoice chains.' });
    return ok(matches[0] ?? { status: 'unmatched', reason: 'No unique whole-deposit chain with exact PayPal reference; reconcile manually.' });
  } catch {
    return quickBooksFailure('invalid_input', 'Malformed reconciliation snapshot; no match attempted.');
  }
}
