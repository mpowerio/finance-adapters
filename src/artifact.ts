/**
 * Invoice → ArtifactRecord mapping.
 *
 * THE cross-repo proof: this module imports `ArtifactRecord` / `ArtifactStatus`
 * from the published `@mpowerio/core-contracts` and produces a fully-typed
 * `ArtifactRecord<'invoice'>`. If core-contracts did not resolve + type-check
 * from a separate repo, this file would not compile.
 */

import type { ArtifactRecord, ArtifactStatus } from '@mpowerio/core-contracts';
import type { FinanceProvider, InvoiceResult } from './types.js';

export interface InvoiceArtifactInput {
  invoice: InvoiceResult;
  provider: FinanceProvider;
  /** Canonical source row this invoice was generated from. */
  sourceResourceType: string;
  sourceResourceId: string;
  /** ISO-8601 of the last provider status check, if any. */
  lastCheckedAt?: string;
}

/**
 * Map a provider invoice-status string onto the core-contracts artifact
 * lifecycle. A successfully created/sent/paid invoice IS a ready artifact;
 * only an explicit failure or still-pending state diverges.
 */
export function invoiceStatusToArtifactStatus(status: string): ArtifactStatus {
  switch (status) {
    case 'failed':
      return 'failed';
    case 'pending':
      return 'pending';
    default:
      return 'ready';
  }
}

/**
 * Map an InvoiceResult into an ArtifactRecord<'invoice'>.
 *
 * Optional fields are conditionally assigned (never set to `undefined`) to
 * satisfy `exactOptionalPropertyTypes` and avoid leaking absent fields as keys.
 */
export function invoiceToArtifact(input: InvoiceArtifactInput): ArtifactRecord<'invoice'> {
  const { invoice, provider, sourceResourceType, sourceResourceId, lastCheckedAt } = input;

  const record: ArtifactRecord<'invoice'> = {
    id: invoice.id,
    kind: 'invoice',
    sourceResourceType,
    sourceResourceId,
    provider,
    status: invoiceStatusToArtifactStatus(invoice.status),
  };

  if (invoice.paymentLink) {
    record.externalUrl = invoice.paymentLink;
  }
  if (lastCheckedAt) {
    record.lastCheckedAt = lastCheckedAt;
  }

  return record;
}
