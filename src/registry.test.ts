import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerAdapter,
  getAdapter,
  listAdapters,
  removeAdapter,
  clearAdapters,
} from './registry.js';
import type { FinanceAdapter } from './types.js';

function stubAdapter(name: string): FinanceAdapter {
  return {
    name,
    createInvoice: async () => ({ ok: false, gated: true, error: 'stub' }),
    listInvoices: async () => ({ ok: false, gated: true, error: 'stub' }),
    getBalance: async () => ({ ok: false, gated: true, error: 'stub' }),
    syncCustomers: async () => ({ ok: false, gated: true, error: 'stub' }),
  };
}

describe('finance adapter registry', () => {
  beforeEach(() => clearAdapters());

  it('registers and retrieves an adapter by its name', () => {
    const fb = stubAdapter('freshbooks');
    registerAdapter(fb);
    expect(getAdapter('freshbooks')).toBe(fb);
  });

  it('returns null for an unknown adapter', () => {
    expect(getAdapter('nope')).toBeNull();
  });

  it('lists all registered adapter names', () => {
    registerAdapter(stubAdapter('freshbooks'));
    registerAdapter(stubAdapter('paypal'));
    expect(listAdapters().sort()).toEqual(['freshbooks', 'paypal']);
  });

  it('removes an adapter', () => {
    registerAdapter(stubAdapter('freshbooks'));
    expect(removeAdapter('freshbooks')).toBe(true);
    expect(getAdapter('freshbooks')).toBeNull();
    expect(removeAdapter('freshbooks')).toBe(false);
  });

  it('clears all adapters', () => {
    registerAdapter(stubAdapter('a'));
    registerAdapter(stubAdapter('b'));
    clearAdapters();
    expect(listAdapters()).toEqual([]);
  });
});
