# Release runbook — Mattsystem

Estado de preparación: 2026-11-21  
Rama candidata: `security/hmac-tenant-context`  
Commit de código auditado antes de este documento: `27ba6b94426df4664060d8a71ed17ffd349b87cd`

## 1. Estado conocido antes de publicar

- El validador estático, `npm test`, `npm run build`, los chequeos de sintaxis y `git diff --check` pasaron en la rama candidata.
- `vercel build` terminó correctamente en el entorno local de Vercel CLI.
- Vercel no ha creado un deployment para el commit candidato debido al estado `build-rate-limit`. No se debe intentar eludir este límite.
- La rama principal Neon de Producción tiene registradas las migraciones 001–012.
- La rama `preprod-security-migration-2026-11-21` recibió y verificó la migración 012 para corregir la política de auditoría anónima.
- La migración 013 agrega aceptación de prueba gratuita por negocio y modalidad de licencia permanente; debe aplicarse y verificarse en QA y Producción antes de publicar la API que la utiliza.
- Las variables de Vercel están configuradas por entorno; sus valores sensibles no se imprimen ni se copian a Git.
- La fila HMAC de Producción aún debe inicializarse/verificarse mediante la primera ejecución de la versión corregida. No se debe escribir una clave manual distinta.

## 2. Variables de entorno

Configurar como tipo **Sensitive** en Vercel:

| Variable | Preview | Production |
|---|---|---|
| `DATABASE_URL` | Rama Neon QA, usuario backend autorizado para `SET ROLE mattsystem_app` | Rama principal Neon de Producción, usuario backend autorizado para `SET ROLE mattsystem_app` |
| `SESSION_SECRET` | Secreto exclusivo de Preview | Secreto exclusivo de Producción |
| `TENANT_CONTEXT_SECRET` | Secreto HMAC exclusivo de Preview | Secreto HMAC exclusivo de Producción |

No copiar secretos entre Preview y Production. No incluir valores secretos en Git, logs, capturas ni tickets.

La variable HMAC debe contener exactamente 64 caracteres hexadecimales (32 bytes). La fila de base de datos debe contener el mismo secreto en `app_private.tenant_context_secret`. La API corregida inicializa y compara esa fila de forma idempotente en Preview y Producción; nunca sobrescribe una clave distinta. No usar el secreto de Preview en Producción.

## 3. Orden obligatorio de migraciones en Producción

Antes de migrar, crear y verificar un respaldo/branch de Neon desde la rama principal. Confirmar que el respaldo corresponde al proyecto y base de Producción.

Aplicar, en este orden, sin saltar archivos:

1. `migrations/008_tenant_rls_enforcement.sql`
2. `migrations/009_signed_tenant_context.sql`
3. `migrations/010_auth_admin_rls.sql`
4. `migrations/011_runtime_role_set_option.sql`
5. `migrations/012_auth_audit_insert_policy.sql`
6. `migrations/013_trial_acceptance_and_permanent_licenses.sql`

Si una migración falla, detener el procedimiento, conservar los logs y no continuar con la siguiente. No ejecutar DDL manual alternativo para forzar el avance.

## 4. Verificaciones de base de datos después de migrar

- Versiones 001–013 presentes en `public.schema_migrations`.
- 32/32 tablas públicas esperadas con RLS habilitado.
- Las tablas operativas con aislamiento de negocio tienen FORCE RLS según la migración.
- Rol `mattsystem_app` existe, es `NOSUPERUSER`, `NOBYPASSRLS` y no tiene permiso de inicio de sesión.
- La membresía de `panaderia_owner` permite SET a `mattsystem_app`, sin herencia implícita.
- La tabla `app_private.tenant_context_secret` contiene exactamente una fila.
- Una transacción sin firma válida no ve datos de ningún negocio.
- La firma HMAC válida permite ver solo los registros del negocio autenticado.
- `app_trial_claims` impide más de una prueba por negocio y registra usuario, fecha, IP, agente y versión de condiciones aceptadas.
- Una suscripción exige fecha de vencimiento; una licencia permanente permanece activa sin vencimiento y no admite renovación.
- Las funciones SECURITY DEFINER tienen `search_path` fijado y permisos EXECUTE limitados.

## 5. Orden de despliegue

1. Esperar a que Vercel permita una nueva compilación sin el estado `build-rate-limit`.
2. Generar el Preview del commit exacto que se pretende publicar.
3. Confirmar que el Preview usa exclusivamente Neon QA y sus secretos propios.
4. Probar inicio/cierre de sesión, recuperación, sesiones expiradas y bloqueo por intentos fallidos.
5. Probar administrador de plataforma, administrador de negocio, supervisor y empleados con/sin permisos.
6. Crear dos negocios de prueba y verificar que ninguno pueda leer, modificar ni eliminar datos del otro.
7. Probar productos, inventario, ventas, caja, compras, producción, clientes, proveedores, licencias y notificaciones.
8. Revisar móvil, tablet y escritorio; confirmar controles táctiles, tablas, formularios y navegación.
9. Aplicar y verificar las migraciones de Producción, inicializar la clave HMAC de Producción y confirmar las variables Sensitive.
10. Desplegar el commit aprobado y ejecutar las mismas pruebas de humo contra Producción.

## 6. Reversión

- Conservar el deployment de Producción anterior y su URL/ID antes de promover.
- Si el nuevo deployment falla, volver al deployment anterior desde Vercel.
- No eliminar migraciones ni datos para revertir una publicación.
- Las migraciones son parte del contrato de seguridad de la nueva API; cualquier reversión de esquema requiere un plan específico y revisión manual.
- Registrar errores de runtime y detener nuevas operaciones si se detecta fuga entre negocios, permisos incorrectos o fallos de autenticación.

## 7. Criterio de autorización

No marcar la versión como publicada ni lista para clientes hasta tener un Preview READY del commit exacto, todas las pruebas funcionales aprobadas, migraciones verificadas en Producción, clave HMAC coincidente y despliegue Production READY.
