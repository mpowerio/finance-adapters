/**
 * Finance adapter registry — harvested verbatim in shape from the MOC
 * (mpower-crm/src/lib/integrations/registry.ts). Map-based, register at
 * startup, retrieve by name for multi-tenant / multi-provider routing.
 */

import type { FinanceAdapter } from './types.js';

const adapters = new Map<string, FinanceAdapter>();

/** Register a finance adapter by its `name`. */
export function registerAdapter(adapter: FinanceAdapter): void {
  adapters.set(adapter.name, adapter);
}

/** Get a registered adapter by name. Returns null if not found. */
export function getAdapter(name: string): FinanceAdapter | null {
  return adapters.get(name) ?? null;
}

/** List all registered adapter names. */
export function listAdapters(): string[] {
  return Array.from(adapters.keys());
}

/** Remove an adapter from the registry. Returns true if one was removed. */
export function removeAdapter(name: string): boolean {
  return adapters.delete(name);
}

/** Clear all registered adapters (useful for testing). */
export function clearAdapters(): void {
  adapters.clear();
}
