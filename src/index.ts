/**
 * @mpowerio/finance-adapters — barrel export.
 *
 * Factory Step 2 of the mpowerio Vertical Factory and the FIRST cross-repo
 * consumer of @mpowerio/core-contracts: createInvoice maps into a
 * core-contracts ArtifactRecord<'invoice'> (see ./artifact.ts).
 */

export type {
  FinanceAdapter,
  CreateInvoiceParams,
  InvoiceResult,
  InvoiceFilters,
  CustomerResult,
  BalanceResult,
  LineItem,
  FinanceProvider,
  InvoiceArtifact,
  AdapterResult,
  AdapterOk,
  AdapterGated,
  AdapterFailure,
} from './types.js';
export { ok, gated, failure } from './types.js';

export {
  invoiceToArtifact,
  invoiceStatusToArtifactStatus,
  type InvoiceArtifactInput,
} from './artifact.js';

export {
  registerAdapter,
  getAdapter,
  listAdapters,
  removeAdapter,
  clearAdapters,
} from './registry.js';

export {
  FreshBooksAdapter,
  readFreshBooksCredentialsFromEnv,
  type FreshBooksAdapterOptions,
  type FreshBooksCredentials,
  type FetchLike,
  type FetchLikeResponse,
} from './freshbooks.js';

export type {
  FinanceReadAdapter, FinanceReadFilters, AccountResult, VendorResult,
  BookTransactionLine, BookTransactionResult, BookInvoiceResult,
} from './types.js';
export {
  QuickBooksAdapter, QUICKBOOKS_SCOPE, readQuickBooksCredentialsFromEnv,
  quickBooksConnectionKey,
  type QuickBooksAdapterOptions, type QuickBooksCredentials, type QuickBooksConnection,
  type QuickBooksConnectionState, type QuickBooksTokenSession, type QuickBooksTokenStore,
  type QuickBooksErrorCode, type QuickBooksFailure, type QuickBooksGated, type QuickBooksResult,
} from './quickbooks.js';
export {
  matchPayPalDeposit, type PayPalPaymentEvidence, type QuickBooksMatchSnapshot,
  type QuickBooksDepositMatch,
} from './quickbooks-match.js';
