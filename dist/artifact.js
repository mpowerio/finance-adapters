/**
 * Invoice → ArtifactRecord mapping.
 *
 * THE cross-repo proof: this module imports `ArtifactRecord` / `ArtifactStatus`
 * from the published `@mpowerio/core-contracts` and produces a fully-typed
 * `ArtifactRecord<'invoice'>`. If core-contracts did not resolve + type-check
 * from a separate repo, this file would not compile.
 */
/**
 * Map a provider invoice-status string onto the core-contracts artifact
 * lifecycle. A successfully created/sent/paid invoice IS a ready artifact;
 * only an explicit failure or still-pending state diverges.
 */
export function invoiceStatusToArtifactStatus(status) {
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
export function invoiceToArtifact(input) {
    const { invoice, provider, sourceResourceType, sourceResourceId, lastCheckedAt } = input;
    const record = {
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
//# sourceMappingURL=artifact.js.map