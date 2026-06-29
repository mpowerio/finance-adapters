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

// ─── Provider identity ───────────────────────────────────────────────
export type FinanceProvider = 'freshbooks' | 'paypal' | (string & {});

/** The Factory artifact shape every adapter produces for a created invoice. */
export type InvoiceArtifact = ArtifactRecord<'invoice'>;

// ─── Invoice input ───────────────────────────────────────────────────
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

// ─── Result rows ─────────────────────────────────────────────────────
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

// ─── Result envelope ─────────────────────────────────────────────────
// Adapters NEVER throw across the boundary and NEVER make a live call when
// credentials are absent — they return a typed gated/failure result instead.
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

export function ok<T>(data: T): AdapterOk<T> {
  return { ok: true, gated: false, data };
}
export function gated(error: string): AdapterGated {
  return { ok: false, gated: true, error };
}
export function failure(error: string): AdapterFailure {
  return { ok: false, gated: false, error };
}

// ─── Adapter interface (harvested from MOC) ──────────────────────────
export interface FinanceAdapter {
  name: string;
  /** Create an invoice and return it as a core-contracts ArtifactRecord. */
  createInvoice(params: CreateInvoiceParams): Promise<AdapterResult<InvoiceArtifact>>;
  listInvoices(filters?: InvoiceFilters): Promise<AdapterResult<InvoiceResult[]>>;
  getBalance(): Promise<AdapterResult<BalanceResult>>;
  syncCustomers(): Promise<AdapterResult<CustomerResult[]>>;
}
