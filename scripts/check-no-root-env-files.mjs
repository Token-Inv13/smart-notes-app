import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const allowlist = new Set(['.env', '.env.example', '.env.e2e.example']);

const rootEntries = readdirSync(repoRoot, { withFileTypes: true });
const envCandidates = rootEntries
  .filter((entry) => entry.isFile() && entry.name.startsWith('.env'))
  .map((entry) => entry.name)
  .sort();

const forbidden = envCandidates.filter((name) => !allowlist.has(name));

if (forbidden.length > 0) {
  console.error('[env-secrets-guard] FAIL: fichiers .env racine non autorisés détectés:');
  for (const name of forbidden) {
    console.error(` - ${name}`);
  }
  console.error('[env-secrets-guard] Autorisés:', Array.from(allowlist).join(', '));
  process.exit(1);
}

const trackedHintPath = join(repoRoot, '.env');
if (existsSync(trackedHintPath) && statSync(trackedHintPath).isFile()) {
  console.log('[env-secrets-guard] INFO: .env racine présent (autorisé par politique locale).');
}

console.log('[env-secrets-guard] OK: aucun fichier .env racine interdit détecté.');
