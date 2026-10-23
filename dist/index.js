/**
 * @mpowerio/finance-adapters — barrel export.
 *
 * Factory Step 2 of the mpowerio Vertical Factory and the FIRST cross-repo
 * consumer of @mpowerio/core-contracts: createInvoice maps into a
 * core-contracts ArtifactRecord<'invoice'> (see ./artifact.ts).
 */
export { ok, gated, failure } from './types.js';
export { invoiceToArtifact, invoiceStatusToArtifactStatus, } from './artifact.js';
export { registerAdapter, getAdapter, listAdapters, removeAdapter, clearAdapters, } from './registry.js';
export { FreshBooksAdapter, readFreshBooksCredentialsFromEnv, } from './freshbooks.js';
export { QuickBooksAdapter, QUICKBOOKS_SCOPE, readQuickBooksCredentialsFromEnv, quickBooksConnectionKey, } from './quickbooks.js';
export { matchPayPalDeposit, } from './quickbooks-match.js';
//# sourceMappingURL=index.js.map