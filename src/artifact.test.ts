import { describe, it, expect } from 'vitest';
import type { ArtifactRecord } from '@mpowerio/core-contracts';
import { invoiceToArtifact, invoiceStatusToArtifactStatus } from './artifact.js';
import type { InvoiceResult } from './types.js';

const baseInvoice: InvoiceResult = {
  id: '1001',
  externalId: '1001',
  status: 'sent',
  amount: 500,
  currency: 'USD',
  dueDate: '2026-07-15',
  paymentLink: 'https://my.freshbooks.com/invoice/1001',
};

describe('invoiceToArtifact', () => {
  it('maps an InvoiceResult into an ArtifactRecord<"invoice"> with all required fields', () => {
    const record: ArtifactRecord<'invoice'> = invoiceToArtifact({
      invoice: baseInvoice,
      provider: 'freshbooks',
      sourceResourceType: 'estimate',
      sourceResourceId: 'est_123',
    });

    expect(record.kind).toBe('invoice');
    expect(record.id).toBe('1001');
    expect(record.provider).toBe('freshbooks');
    expect(record.sourceResourceType).toBe('estimate');
    expect(record.sourceResourceId).toBe('est_123');
    expect(record.externalUrl).toBe('https://my.freshbooks.com/invoice/1001');
    expect(record.status).toBe('ready');
  });

  it('uses the invoice paymentLink as the artifact externalUrl (invoice URL)', () => {
    const record = invoiceToArtifact({
      invoice: { ...baseInvoice, paymentLink: 'https://pay.example/inv/9' },
      provider: 'paypal',
      sourceResourceType: 'trip',
      sourceResourceId: 'trip_77',
    });
    expect(record.externalUrl).toBe('https://pay.example/inv/9');
    expect(record.provider).toBe('paypal');
  });

  it('OMITS externalUrl entirely when there is no payment link (no undefined leak)', () => {
    const { paymentLink, ...noLink } = baseInvoice;
    void paymentLink;
    const record = invoiceToArtifact({
      invoice: noLink,
      provider: 'freshbooks',
      sourceResourceType: 'estimate',
      sourceResourceId: 'est_5',
    });
    expect('externalUrl' in record).toBe(false);
  });

  it('passes through lastCheckedAt only when provided', () => {
    const withTs = invoiceToArtifact({
      invoice: baseInvoice,
      provider: 'freshbooks',
      sourceResourceType: 'estimate',
      sourceResourceId: 'est_5',
      lastCheckedAt: '2026-06-29T00:00:00Z',
    });
    expect(withTs.lastCheckedAt).toBe('2026-06-29T00:00:00Z');

    const withoutTs = invoiceToArtifact({
      invoice: baseInvoice,
      provider: 'freshbooks',
      sourceResourceType: 'estimate',
      sourceResourceId: 'est_5',
    });
    expect('lastCheckedAt' in withoutTs).toBe(false);
  });
});

describe('invoiceStatusToArtifactStatus', () => {
  it('maps a created/sent/paid invoice to a ready artifact', () => {
    expect(invoiceStatusToArtifactStatus('sent')).toBe('ready');
    expect(invoiceStatusToArtifactStatus('paid')).toBe('ready');
    expect(invoiceStatusToArtifactStatus('draft')).toBe('ready');
  });

  it('maps failed -> failed and pending -> pending', () => {
    expect(invoiceStatusToArtifactStatus('failed')).toBe('failed');
    expect(invoiceStatusToArtifactStatus('pending')).toBe('pending');
  });
});
