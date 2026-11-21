# Security and initial administrator setup

1. Provision Neon and connect it to the Vercel project.
2. Configure `DATABASE_URL`, `ADMIN_EMAIL`, `SESSION_SECRET`, and `ADMIN_BOOTSTRAP_TOKEN` in Vercel Project Settings → Environment Variables.
3. Deploy to Production.
4. The owner opens the one-time activation link containing `#activar=<ADMIN_BOOTSTRAP_TOKEN>` and chooses a new password in the activation form.
5. After the admin row exists, the bootstrap endpoint refuses further activations. The partial unique index also limits the database to one admin account.
6. The administrator creates employee/supervisor accounts from Settings → Users. The server API refuses user management requests unless the session belongs to the admin.

Do not put secrets in source files, frontend JavaScript, URLs sent to third parties, or the repository. If the activation token is disclosed, rotate `ADMIN_BOOTSTRAP_TOKEN` before first activation.

## Tenant isolation and production release

- Apply database migrations in order: `008_tenant_rls_enforcement.sql`, `009_signed_tenant_context.sql`, `010_auth_admin_rls.sql`, and `011_runtime_role_set_option.sql`, after migrations 001–007.
- Configure `TENANT_CONTEXT_SECRET` as exactly 64 hexadecimal characters (32 random bytes). The API decodes it to the same 32-byte HMAC key that PostgreSQL reads from `app_private.tenant_context_secret.secret_hex`.
- Before enabling the signed tenant context, run `npm run bootstrap:tenant-secret` with the privileged database connection and the same `TENANT_CONTEXT_SECRET`. The script inserts the value only when the database row is empty; it refuses to overwrite a different existing value and never prints the secret.
- The application must assume `mattsystem_app` inside authenticated transactions. This role must remain `NOSUPERUSER` and `NOBYPASSRLS`; the database owner connection needs the `SET` membership option.
- Keep Preview and Production database URLs, session secrets, and tenant HMAC secrets separate. Do not promote a deployment until the target database has all migrations and its HMAC secret has been bootstrapped and verified.
