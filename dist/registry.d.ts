/**
 * Finance adapter registry — harvested verbatim in shape from the MOC
 * (mpower-crm/src/lib/integrations/registry.ts). Map-based, register at
 * startup, retrieve by name for multi-tenant / multi-provider routing.
 */
import type { FinanceAdapter } from './types.js';
/** Register a finance adapter by its `name`. */
export declare function registerAdapter(adapter: FinanceAdapter): void;
/** Get a registered adapter by name. Returns null if not found. */
export declare function getAdapter(name: string): FinanceAdapter | null;
/** List all registered adapter names. */
export declare function listAdapters(): string[];
/** Remove an adapter from the registry. Returns true if one was removed. */
export declare function removeAdapter(name: string): boolean;
/** Clear all registered adapters (useful for testing). */
export declare function clearAdapters(): void;
//# sourceMappingURL=registry.d.ts.map