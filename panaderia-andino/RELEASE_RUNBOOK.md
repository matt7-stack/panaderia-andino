# Release runbook — Mattsystem

Última verificación: 2026-11-21 22:00 UTC  
Rama candidata: `security/hmac-tenant-context`  
Commit de código validado: `5e5e20f28434f9dc374a64f29c2b717648f32227`  
PR: https://github.com/matt7-stack/panaderia-andino/pull/8

## 1. Estado técnico comprobado

- GitHub Actions `Validate source`: SUCCESS para el commit indicado.
- Vercel Preview del commit indicado: READY; la compilación terminó correctamente.
- La página raíz del Preview responde HTTP 200.
- La URL de Producción también presenta `FUNCTION_INVOCATION_FAILED` en `/api/auth/status` y `/api/auth/me`. La inspección de `main` encontró que `api/[...path].js` importa `require('postgres')`, mientras que `package.json` solo declara `@neondatabase/serverless`; ese desajuste de dependencia explica el fallo de inicialización. La rama candidata ya sustituye ese import por el driver declarado y el validador ahora impide que vuelva a ocurrir.
- `GET /api/auth/status` y otras rutas que acceden a Neon responden HTTP 500 con SQLSTATE `08P01`, mensaje `no such user`.
- La variable `DATABASE_URL` específica de la rama Preview se actualizó el 2026-11-21 a las 21:54:54 UTC para usar la conexión pooled de Neon QA con `panaderia_owner`. El deployment actual se creó aproximadamente a las 21:52:55 UTC, antes de ese cambio; por eso conserva el snapshot anterior de variables. Cambiar una variable no modifica deployments ya creados.
- El límite de Vercel `api-deployments-free-per-day` rechazó el siguiente deployment con `retryAfter: 86400`. La hora comunicada para volver a intentar es 2026-11-22 21:54:57 UTC. No intentar eludir el límite ni crear deployments repetidos antes de esa hora.
- Neon QA `tenant-rls-role-test` responde. `panaderia_owner` puede asumir `mattsystem_app`; el rol de runtime está `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER` y `NOBYPASSRLS`.
- Neon Producción tiene registradas las migraciones 001–014. Verificación actual: 33 tablas públicas con RLS y 24 con FORCE RLS.
- En Producción, `app_private.tenant_context_secret` todavía tiene cero filas. No inicializar manualmente con un secreto distinto: el primer arranque de la API debe insertar/verificar de forma idempotente el secreto configurado en Vercel.
- Producción tiene actualmente cero negocios, cero licencias y cero aceptaciones de prueba. No crear datos ficticios en Producción.
- La cuenta administradora de plataforma `matt7atx@gmail.com` existe y está activa. No se ha validado el inicio de sesión HTTP con la contraseña real.
- No se ha fusionado el PR ni desplegado esta rama a Producción. La versión de Producción sigue siendo el deployment anterior.

## 2. Variables de entorno

Las variables sensibles están configuradas en Vercel para Preview y Producción. No imprimir, copiar a Git ni compartir sus valores.

| Variable | Preview | Production |
|---|---|---|
| `DATABASE_URL` | Neon QA, rama `tenant-rls-role-test-2026-11`, conexión pooled con `panaderia_owner` | Neon principal de Producción, conexión pooled con login técnico autorizado para `SET ROLE mattsystem_app` |
| `SESSION_SECRET` | Clave exclusiva de Preview | Clave exclusiva de Producción |
| `TENANT_CONTEXT_SECRET` | HMAC exclusivo de QA | HMAC exclusivo de Producción |

La clave HMAC debe tener 64 caracteres hexadecimales (32 bytes). La fila de `app_private.tenant_context_secret` debe coincidir exactamente con la variable del entorno correspondiente. El bootstrap no debe sobrescribir un secreto distinto. Nunca compartir secretos entre Preview y Producción.

## 3. Migraciones

Producción ya tiene registradas las migraciones 001–014. No volver a ejecutar a ciegas ni repetir DDL manual.

Para una base QA nueva, aplicar las migraciones en orden desde la versión que realmente tenga registrada esa rama. Las migraciones de seguridad relevantes son:

1. `008_tenant_rls_enforcement.sql`
2. `009_signed_tenant_context.sql`
3. `010_auth_admin_rls.sql`
4. `011_runtime_role_set_option.sql`
5. `012_auth_audit_insert_policy.sql`
6. `013_trial_acceptance_and_permanent_licenses.sql`
7. `014_lock_down_runtime_role.sql`

Antes de cualquier cambio de esquema en Producción, confirmar el backup `backup-prod-before-rls-2026-11-21` y revisar su estado. Si una migración falla, detener el procedimiento.

## 4. Pruebas obligatorias en Preview

Después de la hora de restablecimiento del límite:

1. Confirmar que el head de la rama y el commit objetivo son los esperados.
2. Crear un único Preview nuevo para ese commit; verificar que incorpora el `DATABASE_URL` actualizado.
3. Verificar `/api/auth/status`: debe responder JSON válido (200 sin sesión o 200 autenticado, según contrato) y nunca 500.
4. Verificar `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`, cookies seguras, sesión expirada y bloqueo por intentos.
5. Probar la cuenta de administrador de plataforma sin registrar ni mostrar su contraseña.
6. Crear dos negocios ficticios únicamente en QA y probar que ninguno puede consultar, modificar ni eliminar datos del otro.
7. Probar administrador de negocio, supervisor y empleados con permisos permitidos y denegados.
8. Probar productos, inventario, ventas, caja, compras, producción, clientes, proveedores, soporte, notificaciones y reportes.
9. Probar aceptación única de prueba, duración, límites, auditoría y rechazo de una segunda solicitud.
10. Probar suscripciones vencidas, activas y licencias permanentes; verificar que una permanente no vence ni admite renovación.
11. Probar carga, edición, concurrencia, límites de datos y errores de red.
12. Revisar móvil, tablet y escritorio: navegación, formularios, tablas, modales, botones y controles táctiles.
13. Revisar logs de runtime y exigir cero errores de conexión, SQL, autorización o aislamiento.

No considerar aprobado un módulo por compilar o por devolver una página HTML: debe pasar pruebas HTTP y funcionales.

## 5. Publicación

1. No fusionar mientras el Preview tenga errores o pruebas pendientes.
2. Confirmar migraciones, roles, variables y secreto HMAC de Producción sin exponer credenciales.
3. Mantener el PR abierto hasta completar la matriz de pruebas.
4. Tras aprobación técnica, fusionar el PR y esperar el deployment Production READY del commit esperado.
5. Ejecutar pruebas de humo de Producción: página, estado de autenticación, login autorizado, sesión, permisos y lectura/escritura controlada. No crear negocios ficticios ni modificar datos reales sin autorización.
6. Confirmar que la fila HMAC de Producción se inicializó y coincide con la variable configurada.
7. Vigilar logs y conservar el deployment anterior para rollback.

## 6. Reversión y criterios de bloqueo

- Conservar el deployment anterior de Producción y su URL/ID.
- Si la versión nueva falla, volver al deployment anterior desde Vercel.
- No borrar datos ni revertir migraciones automáticamente.
- Detener la publicación ante cualquier fuga entre negocios, bypass de permisos, fallo de autenticación, error 500, secreto HMAC no coincidente o inconsistencia de licencias.
- No declarar el sistema listo para clientes hasta que el Preview pase todas las pruebas, Producción esté desplegada y las pruebas de humo de Producción sean satisfactorias.
