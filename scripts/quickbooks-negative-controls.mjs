/** Run deliberate regressions in disposable copies; never edit the real source. */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mutations = [
  {
    name: 'discard-purchase-direction', file: 'quickbooks.ts',
    from: '...this.transaction(row, false), credit: row.Credit === true, paymentType,',
    to: '...this.transaction(row, false),',
    test: 'keeps charge and refund output bytes distinguishable',
  },
  {
    name: 'discard-purchase-payee', file: 'quickbooks.ts',
    from: 'if (row.EntityRef !== undefined) {', to: 'if (false) {',
    test: 'preserves typed Purchase payee Vendor in output bytes',
  },
  {
    name: 'expired-token-empty-success', file: 'quickbooks.ts',
    from: 'return error instanceof BoundaryError ? error.result :',
    to: "return error instanceof BoundaryError && error.result.code === 'reconnect_needed' ? ok([] as T) : error instanceof BoundaryError ? error.result :",
    test: 'distinguishes examined-empty from expired authentication',
  },
  {
    name: 'discard-refresh-rotation', file: 'quickbooks.ts',
    from: 'refreshToken: str(body.refresh_token)', to: 'refreshToken: previous.refreshToken',
    test: 'saves rotation and both expiries before the read',
  },
  {
    name: 'pick-first-duplicate-match', file: 'quickbooks-match.ts',
    from: "if (matches.length > 1) return ok({ status: 'ambiguous', reason: 'Multiple complete deposit/payment/invoice chains.' });",
    to: '// Deliberate defect: choose first candidate even when ambiguous.',
    test: 'does not guess with duplicate deposits',
  },
];
const results = [];
for (const mutation of mutations) {
  const directory = resolve(root, 'node_modules/.cache/quickbooks-negative-controls', mutation.name);
  await mkdir(directory, { recursive: true });
  await cp(resolve(root, 'src'), resolve(directory, 'src'), { recursive: true });
  await cp(resolve(root, 'dist'), resolve(directory, 'dist'), { recursive: true });
  await cp(resolve(root, 'package.json'), resolve(directory, 'package.json'));
  const path = resolve(directory, 'src', mutation.file);
  const source = await readFile(path, 'utf8');
  if (source.split(mutation.from).length !== 2) throw new Error(`Mutation anchor changed: ${mutation.name}`);
  await writeFile(path, source.replace(mutation.from, mutation.to));
  const report = resolve(directory, 'result.json');
  const run = spawnSync(process.execPath, [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', 'src/quickbooks.test.ts', 'src/quickbooks-review.test.ts', '--root', directory, '--reporter=json', `--outputFile=${report}`], { cwd: directory, encoding: 'utf8' });
  await writeFile(resolve(directory, 'output.log'), run.stdout + run.stderr);
  const result = JSON.parse(await readFile(report, 'utf8'));
  const caught = run.status !== 0 && result.testResults.flatMap(test => test.assertionResults)
    .some(test => test.title === mutation.test && test.status === 'failed');
  results.push({ mutation: mutation.name, caught, failedTests: result.numFailedTests, expectedFailingTest: mutation.test });
  console.log(`${mutation.name}: ${caught ? 'CAUGHT' : 'MISSED'}`);
}
await mkdir(resolve(root, '.verification/negative-controls'), { recursive: true });
await writeFile(resolve(root, '.verification/negative-controls/results.json'), JSON.stringify(results, null, 2) + '\n');
if (results.some(result => !result.caught)) process.exitCode = 1;
