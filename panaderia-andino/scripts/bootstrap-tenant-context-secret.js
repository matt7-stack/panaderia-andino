'use strict';

const { neon } = require('@neondatabase/serverless');

const databaseUrl = process.env.DATABASE_URL || '';
const tenantSecret = process.env.TENANT_CONTEXT_SECRET || '';

if (!databaseUrl) throw new Error('DATABASE_URL is required.');
if (!/^[a-f0-9]{64}$/i.test(tenantSecret)) {
  throw new Error('TENANT_CONTEXT_SECRET must be 32 bytes encoded as 64 hexadecimal characters.');
}

async function main() {
  const sql = neon(databaseUrl);
  const normalizedSecret = tenantSecret.toLowerCase();

  // Bootstrap only when empty. Never rotate or overwrite an existing secret implicitly.
  await sql`INSERT INTO app_private.tenant_context_secret(singleton, secret_hex)
    VALUES (TRUE, ${normalizedSecret})
    ON CONFLICT (singleton) DO NOTHING`;

  const rows = await sql`SELECT secret_hex = ${normalizedSecret} AS matches
    FROM app_private.tenant_context_secret
    WHERE singleton = TRUE`;

  if (rows[0]?.matches !== true) {
    throw new Error('The database already has a different tenant secret. Use the explicit rotation procedure; no value was changed.');
  }

  process.stdout.write('Tenant HMAC secret verified in database. Secret value was not printed.\n');
}

main().catch((error) => {
  process.stderr.write((error && error.message ? error.message : 'Tenant secret bootstrap failed.') + '\n');
  process.exitCode = 1;
});
