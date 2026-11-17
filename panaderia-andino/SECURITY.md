# Security and initial administrator setup

1. Provision Neon and connect it to the Vercel project.
2. Configure `DATABASE_URL`, `ADMIN_EMAIL`, `SESSION_SECRET`, and `ADMIN_BOOTSTRAP_TOKEN` in Vercel Project Settings → Environment Variables.
3. Deploy to Production.
4. The owner opens the one-time activation link containing `#activar=<ADMIN_BOOTSTRAP_TOKEN>` and chooses a new password in the activation form.
5. After the admin row exists, the bootstrap endpoint refuses further activations. The partial unique index also limits the database to one admin account.
6. The administrator creates employee/supervisor accounts from Settings → Users. The server API refuses user management requests unless the session belongs to the admin.

Do not put secrets in source files, frontend JavaScript, URLs sent to third parties, or the repository. If the activation token is disclosed, rotate `ADMIN_BOOTSTRAP_TOKEN` before first activation.
