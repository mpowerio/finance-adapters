// Ambient, dependency-free declaration of the only Node global this package
// touches. Mirrors core-contracts' zero-runtime-deps posture (no @types/node).
declare const process: { env: Record<string, string | undefined> };
