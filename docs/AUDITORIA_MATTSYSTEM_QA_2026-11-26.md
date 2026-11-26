# Auditoría de MATTSYSTEM — QA — 26 de noviembre de 2026

## Alcance y límites
Revisión del branch `feat/employee-offboarding-2026-11-26` y su proyecto Vercel Preview. Base inspeccionada: base `gestion_panaderia` del branch Neon QA `qa-admin-finance-dev-2026-11`. No se consultó ni modificó producción. No se leyeron valores de secretos ni credenciales. No se eliminaron datos de negocio.

El despliegue Preview que estaba disponible al inicio apuntaba al commit `e3b7f4013e1bf250e31e179cfa791f334d7e2184`; el branch de GitHub ya estaba ocho commits por delante (HEAD inicial `25df7f5c3616211ad29f93e2536367548360ec87`). Por eso se considera obsoleto respecto del código inspeccionado. Se intentó crear un Preview desde el commit remediado, pero Vercel devolvió HTTP 402 `api-deployments-free-per-day` (más de 100 deploys del día; `retryAfter=86400`). No hay CLI `vercel` instalada en el entorno para un fallback. El despliegue activo sigue en el commit antiguo; no se afirma que la rama remediada esté publicada.

## Hallazgos priorizados

### Alto — el cron rechazaba el encabezado Authorization estándar
En `api/[...path].js`, el handler de `/api/internal/backup` eliminaba el prefijo con una expresión regular sobre-escapada (`Bearer\\s+`). Node confirma que no reconoce `Bearer <secreto>` como espacio en blanco: el valor completo se comparaba con `CRON_SECRET` y el endpoint respondía 401. El mismo trabajo diario genera respaldos y alertas de vencimiento de licencias; por tanto, el fallo impedía ambos flujos. Corregido a `Bearer\s+` y añadido un control estático específico.

### Alto — riesgo de fallback de Preview a la conexión genérica
La selección `DATABASE_URL_RUNTIME || DATABASE_URL` permitía que un Preview, si perdía su URL QA, intentase utilizar la variable genérica. El entorno de Preview observado sí tiene `DATABASE_URL_RUNTIME` ligada a QA, pero el código no fallaba de forma cerrada. Se añadió una condición: con `VERCEL_ENV=preview`, si falta `DATABASE_URL_RUNTIME`, la función falla antes de abrir conexión; nunca recurre a `DATABASE_URL`. Desarrollo local conserva el fallback para trabajar.

### Medio — posibilidad de alterar el historial de auditoría mediante contexto de negocio
Las políticas RLS iniciales permitían UPDATE y DELETE de `app_audit_logs` al mismo negocio. Se añadió migración 042 para que esos dos comandos sean exclusivos del administrador de plataforma.

### Medio — alcance de eliminación RLS de cotizaciones demasiado amplio
La política DELETE de `app_quotations` también contemplaba el mismo negocio, aunque la administración de cotizaciones es una función de plataforma. Migración 042 restringe DELETE a administrador de plataforma. La API ya exige ese rol.

### Medio — auditoría de cotización no atómica ante carrera
La API registraba primero la auditoría y después borraba la cotización. Si el estado cambiaba entre ambas consultas, podía quedar una marca de borrado sin que la fila se hubiese borrado. Se reemplazó por un CTE transaccional que borra y audita solo las filas realmente eliminadas, conservando bloqueadas las cotizaciones aceptadas/convertidas.

### Medio — Content Security Policy incompleta
El encabezado CSP actual solo limita `frame-ancestors`, `object-src`, `base-uri`, `form-action` y upgrades HTTPS; no define `default-src`, `script-src`, `style-src` ni `connect-src`. No se endureció automáticamente porque el frontend monolítico usa scripts/estilos inline y recursos externos; hacerlo sin nonces/hashes podría impedir el arranque. Requiere una fase de CSP compatible y pruebas de navegador.

### Medio — política SELECT de usuarios del negocio más amplia que los endpoints
La política RLS de `app_users` permite lectura de filas del mismo negocio. La API de gestión de empleados añade controles de rol, pero conviene revisar minimización por columna y por acción para evitar exposición en futuras rutas. No se alteró para no romper la consulta legítima de propietarios/supervisores ni notificaciones.

### Bajo/medio — limitación de rate limiting
Se verificó protección de login por correo (6 fallos) y por IP (12 fallos), con ventana de 15 minutos y respuesta 429. No se observó un limitador general equivalente para todas las operaciones autenticadas de escritura; queda como mejora, con especial atención a endpoints costosos.

## Estado de funcionalidades y reglas revisadas
- Eliminación de cotizaciones: UI solicita confirmación y oculta/impide borrar estados aceptado/convertido; API revisa rol, UUID y estado; auditoría atómica tras el cambio.
- Duraciones personalizadas de licencia: 1 a 3650 días para creación, activación y renovación.
- Prueba gratuita por negocio: días manuales 1 a 3650; la configuración predeterminada global limita 1 a 90 días.
- Avisos de vencimiento: el cron genera alertas idempotentes a administrador y usuarios activos del negocio, también el día del vencimiento. La función depende de que Vercel ejecute el cron en producción; no se ejecutó un cron real desde Preview.
- Baja de empleados: la ruta de baja confirmada incrementa `session_version`; al revalidarse la cookie, una sesión anterior deja de ser válida. Se inspeccionaron las ramas de solicitud, rechazo, confirmación y reactivación.
- Licencias: las escrituras están limitadas a administrador de plataforma; los controles de rol y licencia se aplican en servidor.
- Reinicio: exige administrador, contraseña actual y texto `REINICIAR`; la lista de borrados se ejecuta como transacción y revierte ante error. No se probó ni ejecutó porque es una acción destructiva.
- PWA: código conserva instalación manual desde “Novedades y versiones”, atiende `beforeinstallprompt`, ofrece instrucciones de iOS y elimina el banner automático de instalación; se incrementó la caché de service worker para forzar actualización de assets.

## Evidencia de pruebas

| Caso | Resultado | Evidencia |
|---|---|---|
| Página raíz y app bundle | Aprobado | HTTP 200; `/app.bundle.html` devuelve HTML |
| API disponible | Aprobado | `/api/auth/status` HTTP 200, `adminExists:true` |
| Estado de mantenimiento | Aprobado | HTTP 200, `active:false` |
| Sesión sin cookie | Aprobado | `/api/auth/me` HTTP 401, sin autenticar |
| Login con usuario ficticio inválido | Aprobado (rechazo esperado) | HTTP 401, mensaje genérico |
| Login real administrador | No verificable | No se proporcionaron credenciales y no se leyeron secretos |
| Endpoints admin/negocio sin sesión | Aprobado | Cotizaciones, licencias, usuarios, ERP, datos, notificaciones, seguridad, negocios y respaldos devuelven 401 |
| Cron sin token | Aprobado (rechazo esperado) | HTTP 401 |
| CSRF cross-site | Aprobado | POST con Origin ajeno + `Sec-Fetch-Site: cross-site` devuelve 403 |
| CORS cross-origin | Aprobado | OPTIONS desde origen ajeno devuelve 403 y no expone ACAO |
| Headers de seguridad | Aprobado parcialmente | HSTS, nosniff, DENY, Referrer-Policy, Permissions-Policy, CSP presentes |
| Neon QA | Aprobado | DB `gestion_panaderia`; branch QA READY; URL runtime Preview vinculada a QA; no se usó branch producción |
| Migraciones y RLS | Aprobado | 42 migraciones del baseline hasta 041; migración 042 aplicada y verificada en QA (43 entradas registradas); las 57 tablas públicas están RLS ENABLED y FORCE |
| Rol SQL de runtime | Aprobado en metadatos | `mattsystem_runtime` sin SUPERUSER ni BYPASSRLS |
| npm test | Aprobado | Validador estático completa sin error |
| npm run build | Aprobado | Ejecuta el mismo validador y completa sin error |
| Guardia DB Preview fail-closed | Aprobado | Prueba local con `VERCEL_ENV=preview`, sin `DATABASE_URL_RUNTIME` y con una `DATABASE_URL` ficticia: `db()` se detiene antes de conectarse |
| Regex del token Cron | Aprobado | Prueba Node con `Bearer test-secret`; extracción de Bearer pasa y la validación estática confirma un solo patrón correcto |
| RLS migración 042 | Aprobado | En QA, UPDATE/DELETE de auditoría y DELETE de cotizaciones quedaron con `app_is_platform_admin()`
| UI móvil/escritorio y consola de navegador | No verificable | Sandbox no trae Chromium/Chrome/Firefox; no se ejecutó un navegador |
| Instalación PWA real | No verificable | Manifest y service worker responden 200; flujo UI está en código, falta browser real |
| Flujos completos con sesión por rol | No verificable | Sin credenciales de cuentas QA por rol |
| Cron autenticado y alerta el mismo día | No verificable | Requiere secreto Cron y ejecución real; Vercel Cron no se ejecuta en Preview |
| Reinicio/eliminaciones destructivas | No probado | Se dejó sin ejecutar para preservar datos |

## Estado del despliegue tras la remediación
- HEAD del branch de Preview: `109bfbf8a612a52eb584d4a54581bd27efe05979` (posteriormente, solo se añadió esta actualización documental).
- La variable `DATABASE_URL_RUNTIME` está configurada como secreto solo para el target Preview y la rama QA; no se leyeron valores.
- El deployment previo continúa READY, pero sigue en `e3b7f4013e1bf250e31e179cfa791f334d7e2184`, no en el commit remediado.
- El nuevo deployment fue bloqueado por la cuota de Vercel; por eso no se hizo retest HTTP sobre el código remediado.

## Cambios de esta remediación
1. Preview falla de forma cerrada sin `DATABASE_URL_RUNTIME`.
2. Parser de autorización Bearer del cron corregido.
3. Eliminación y auditoría de cotizaciones atómicas.
4. Migración 042 aplicada en el branch Neon QA; protege historial de auditoría y cotizaciones por RLS.
5. Validador estático cubre las tres correcciones.
6. Service worker actualizado para invalidar la caché anterior.

## Pendientes para cerrar E2E
- Resolver la cuota de deploys de Vercel y crear un nuevo Preview; verificar que su SHA coincida con el commit remediado antes de probarlo.
- Inicio real del administrador, cuentas Dueño/Supervisor/Empleado y pruebas con dos negocios aislados.
- Probar UI móvil y escritorio, instalación PWA y consola.
- Probar cron autenticado en el entorno que lo ejecuta, sin exponer su secreto.
- Completar CSP compatible y limitar SELECT de usuarios por mínimo privilegio.
