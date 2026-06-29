/**
 * @mpowerio/finance-adapters — Types
 *
 * Harvested from the MOC FinanceAdapter registry
 * (mpower-crm/src/lib/integrations/types.ts). The unifying envelope for
 * multi-provider invoicing/payments. The key Factory move: createInvoice maps
 * its provider result into an `ArtifactRecord<'invoice'>` IMPORTED from the
 * published `@mpowerio/core-contracts` — the cross-repo proof.
 */
export function ok(data) {
    return { ok: true, gated: false, data };
}
export function gated(error) {
    return { ok: false, gated: true, error };
}
export function failure(error) {
    return { ok: false, gated: false, error };
}
//# sourceMappingURL=types.js.map