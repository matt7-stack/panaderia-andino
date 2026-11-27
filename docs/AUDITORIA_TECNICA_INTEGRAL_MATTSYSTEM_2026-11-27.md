# Auditoría técnica integral MATTSYSTEM — 27/11/2026

## 1. Identificación y alcance

- Repositorio: `matt7-stack/panaderia-andino`
- Rama auditada: `feat/business-improvements-suite-2026-11-27`
- HEAD de cierre de esta ronda: `3e2e647f3db73c8f5a64b90230b5ad2b40475413`
- Base inspeccionada: Neon QA, proyecto `quiet-grass-59745537`, rama `br-cool-term-b6qc4t20`, base `gestion_panaderia`.
- No se consultó ni modificó la base de producción. No se leyeron valores de secretos ni credenciales.
- Archivos revisados: API principal, bundle de interfaz, módulos JavaScript de empleados/ERP/operaciones/gastos/mejoras, autenticación, navegación, CSS, configuración Vercel/PWA, workflow y migraciones de seguridad, licencias, versiones, complementos, sucursales, entregas y observabilidad.

Esta auditoría combina lectura estática del código, inspección de políticas y metadatos reales de QA, y ejecución de la validación automatizada del repositorio. No equivale a una prueba E2E con navegador y cuentas de cada rol.

## 2. Resultado ejecutivo

Se encontraron y corrigieron tres brechas de seguridad/integridad:

1. La tabla global `app_commercial_other_prices` no tenía RLS, aunque el rol de ejecución tenía SELECT/INSERT/UPDATE/DELETE.
2. La política de inserción de eventos de salud comparaba el actor con un GUC sin validar la firma del contexto.
3. Las políticas de confirmación de versiones permitían a un contexto de negocio actualizar columnas más amplias que la confirmación técnica que necesita el runtime: podían alterar campos de asignación/instalación, aprobación/pago de una mejora y el historial de versiones dentro de su propio negocio.

También se corrigió el registro de la migración 052, que había creado las tablas de versiones pero no había insertado su versión en `schema_migrations`.

### Verificación de base de datos QA

| Comprobación | Resultado |
|---|---:|
| Tablas públicas | 66 |
| Tablas con RLS habilitado y FORCE | 66 |
| Tablas públicas sin RLS | 0 |
| Migraciones 052, 053, 054 y 055 registradas | Sí |
| Política del catálogo comercial | Solo administrador de plataforma |
| Consulta al catálogo como `mattsystem_runtime` sin contexto firmado | 0 filas visibles |
| Triggers de protección de confirmación de versión | 3 presentes |

El rol `mattsystem_runtime` se observó como LOGIN, sin SUPERUSER y sin BYPASSRLS. `mattsystem_app` no tiene LOGIN ni BYPASSRLS. El rol propietario de QA tiene BYPASSRLS, por lo que las comprobaciones de aislamiento deben ejecutarse siempre con el rol runtime o de aplicación, no solo con el propietario.

## 3. Remediaciones realizadas

### 3.1 Migración 054 — catálogo comercial, telemetría y ledger

Archivo: `panaderia-andino/migrations/054_commercial_catalog_rls_and_migration_ledger.sql`

- Activa y fuerza RLS en `app_commercial_other_prices`.
- Crea política de acceso total únicamente para `public.app_is_platform_admin()`.
- Reemplaza la política de inserción de `app_health_events` para validar el actor con `public.app_context_user_id()`, que comprueba el HMAC del contexto.
- Registra retroactivamente `052_versioned_releases` en `schema_migrations`.
- Registra la propia migración 054.
- Se aplicó en QA dentro de una transacción y se verificó con consultas de metadatos.

### 3.2 Migración 055 — límites de confirmación de versiones

Archivo: `panaderia-andino/migrations/055_version_acknowledgement_guards.sql`

- `app_business_versions`: un negocio solo puede confirmar la versión que ya tiene asignada como destino; no puede cambiar el destino, el negocio ni el usuario que la asignó.
- `app_version_upgrade_requests`: el contexto del negocio solo puede realizar la transición `paid -> applied`, con fecha de aplicación, sin alterar precio, referencia de pago, aceptación, aprobación, negocio o release.
- `app_business_version_history`: un negocio solo puede insertar una entrada `runtime_acknowledged` que coincida con la versión instalada y destino asignados, y con un paquete publicado y listo para entrega.
- El administrador de plataforma conserva las operaciones administrativas completas.
- Se aplicó en QA y se verificó la presencia de los tres triggers.

### 3.3 Validación automatizada

Archivo actualizado: `panaderia-andino/scripts/validate-source.js`

Se añadieron verificaciones estáticas para impedir que se eliminen accidentalmente las protecciones de 054 y 055.

GitHub Actions:
- Ejecución: https://github.com/matt7-stack/panaderia-andino/actions/runs/46058205656
- SHA probado: `3e2e647f3db73c8f5a64b90230b5ad2b40475413`
- Resultado: SUCCESS.

La acción ejecuta el validador estático del proyecto. No debe interpretarse como test funcional completo, prueba de navegador ni test de restauración.

## 4. Controles revisados que están presentes

### Autenticación y sesión
- Contraseñas almacenadas mediante scrypt con sal aleatoria y comparación de hash en tiempo constante.
- Cookie de sesión HttpOnly, Secure y SameSite=Lax, con firma HMAC y expiración.
- La sesión se vuelve a contrastar contra el usuario activo y `session_version`, lo que permite invalidar sesiones tras una baja o revocación.
- La activación inicial del administrador utiliza un flujo de bootstrap de un solo uso.
- Las mutaciones verifican origen; los encabezados de origen cruzado y Fetch Metadata se rechazan.
- Hay límites de intentos de inicio de sesión por correo/IP y un límite general por IP para la API.

### Autorización y aislamiento
- La API utiliza contexto de solicitud con AsyncLocalStorage y firma HMAC para que los GUC de tenant no sean confiables sin validación.
- RLS está habilitado y forzado en las 66 tablas públicas de QA.
- Licencias, configuración comercial, catálogo de módulos y complementos tienen políticas de administración de plataforma.
- Se revisaron rutas de usuarios, notificaciones, empleados, datos operativos, ERP, complementos, cuentas por cobrar y herramientas.
- La ruta de empleados limita los datos devueltos por módulos y permisos; los endpoints verifican el negocio en servidor.
- Las cuentas por cobrar usan claves de idempotencia, bloqueos de fila, validaciones de saldo, anulaciones auditadas y sincronización financiera en triggers.
- Sucursales y entregas usan claves foráneas compuestas que vinculan los registros al mismo negocio.

### Licencias y versiones
- Las escrituras de licencias están restringidas al administrador de plataforma mediante API y RLS.
- Se verificaron validaciones de fechas, estados, límites de usuarios, límites de dispositivos configurados y módulos.
- Los artefactos de versiones tienen campos SHA-256/tamaño y el código verifica la integridad antes de la distribución.
- Las mejoras permanentes requieren aceptación y pago registrados por el administrador antes de asignar el destino.
- La migración 055 cierra la posibilidad de que el negocio manipule directamente los campos de pago/aprobación mediante el contexto runtime.

### Frontend y PWA
- La aplicación evita cachear rutas `/api/` en el service worker.
- El shell de la aplicación usa estrategia de red primero y fallback offline para el bundle.
- Se revisaron los puntos de inserción HTML; las plantillas dinámicas identificadas usan escape en los valores interpolados examinados.
- No se detectó uso de `eval()`, `new Function()` ni URLs `javascript:` en el bundle inspeccionado.
- La UI usa sincronización periódica y conserva una copia local, pero la estrategia de concurrencia requiere mejora (ver pendientes).

## 5. Hallazgos pendientes y riesgos residuales

Estos puntos no se presentan como corregidos. Requieren una fase específica antes de considerar el sistema listo para una operación comercial de alta confianza.

### Corregido en esta ronda — concurrencia del estado general

El guardado general de `/api/data` ahora exige `expectedUpdatedAt` y ejecuta el UPSERT condicionado por `app_state.updated_at IS NOT DISTINCT FROM expectedUpdatedAt`. Si otra sesión guardó primero, el servidor devuelve HTTP 409 con código `DATA_VERSION_CONFLICT` y la marca de tiempo actual del servidor. Las escrituras iniciales también quedan protegidas frente a dos creaciones simultáneas.

El cliente envía la versión que leyó, recibe el conflicto como error estructurado, conserva una copia local bajo `STORAGE_KEY_conflict_backup` y pausa la sincronización automática para no reemplazar silenciosamente los cambios locales. El validador comprueba estos contratos y GitHub Actions pasó en el SHA actual.

Se ejecutó una prueba transaccional aislada en QA que confirmó que la primera escritura con versión correcta se acepta y que una escritura con versión antigua afecta cero filas. Esta prueba valida el predicado SQL de concurrencia; aún falta probar dos sesiones completas en navegador.

**Estado:** mitigación implementada y validada a nivel SQL/estático; pendiente E2E de dos usuarios/dispositivos y una interfaz guiada para resolver conflictos.

### Alto — límite de dispositivos configurado, pero no demostrado como aplicado

Hay campos `device_limit` en configuración y licencias, pero la API inspeccionada no contiene registro de dispositivos, identificadores de dispositivo ni una verificación de límite al crear/renovar sesión. El panel de salud declara correctamente `enforcement: not_verified`.

**Conclusión:** el valor se puede configurar, pero no debe venderse como límite efectivamente aplicado hasta implementar y probar el registro/revocación de dispositivos. Un fingerprint del navegador por sí solo no es una frontera de seguridad fiable; se requiere un token de dispositivo aleatorio revocable y validación en servidor.

### Medio — Content Security Policy incompleta

El encabezado CSP actual limita `frame-ancestors`, `object-src`, `base-uri`, `form-action` y upgrades HTTPS, pero no define `default-src`, `script-src`, `style-src` ni `connect-src`. Esto reduce la defensa en profundidad frente a XSS.

No se endureció en esta ronda porque el bundle utiliza scripts y estilos inline; activar directivas estrictas sin nonces/hashes y pruebas reales puede impedir el inicio de la aplicación.

**Acción recomendada:** migrar gradualmente a scripts/estilos externos o nonces/hashes y desplegar una CSP estricta en modo Report-Only antes de bloquear.

### Medio — cobertura de pruebas insuficiente

El workflow ejecuta validaciones estáticas. No hay en el pipeline una suite automatizada de pruebas unitarias, de integración, API con Postgres, navegador o E2E por rol. No se pudo verificar en navegador real:
- Login completo y recuperación de sesión.
- Flujos concurrentes con dos dispositivos.
- Aislamiento entre dos negocios.
- Dueño/Supervisor/Empleado en todas las pantallas.
- Formularios y navegación móvil/escritorio.
- PWA instalada y actualización desde caché.
- Flujo real del cron autenticado.
- Restauración de respaldo sobre una base descartable.

**Acción recomendada:** crear pruebas API/RLS con roles reales y E2E Playwright en Preview con datos ficticios. Incluir dos sesiones concurrentes para comprobar que el HTTP 409 aparece sin pérdida de cambios.

### Medio — reproducibilidad de dependencias

`package.json` no tiene lockfile en el árbol inspeccionado y `web-push` usa una versión semver con rango. Esto permite que instalaciones futuras resuelvan dependencias distintas.

**Acción recomendada:** añadir `package-lock.json`, fijar versiones y usar `npm ci` en CI.

### Medio — CSP/XSS y bundle monolítico

El bundle principal supera 600 KB y concentra UI, estado, sincronización y muchas funciones. La API principal concentra aproximadamente 372 KB y 3.700 líneas en un catch-all. Aunque no se detectó `eval` y las interpolaciones revisadas usan escape, el gran número de puntos `innerHTML` y la concentración de rutas elevan el coste de revisar cada cambio.

**Acción recomendada:** mantener escape centralizado, preferir `textContent` para texto, introducir pruebas XSS y dividir gradualmente rutas/servicios sin exceder el límite de funciones de Vercel.

### Medio — límites globales de API y operación

El límite general de 300 solicitudes por IP cada cinco minutos protege contra abuso básico, pero se aplica de forma uniforme y requiere una escritura/consulta en DB por solicitud. Rutas de lectura frecuente, login y operaciones costosas podrían necesitar límites diferenciados y almacenamiento de contadores optimizado.

### Medio — respaldos y recuperación

El cron crea copias del estado operativo en la propia base de datos y valida checksum. Esto no equivale a una copia independiente del proveedor ni demuestra recuperación real. El panel marca correctamente `providerSnapshots: not_verified` y `restoreDrill: not_verified`.

**Acción recomendada:** exportación externa cifrada, retención independiente y simulacro periódico de restauración en QA.

## 6. Aspectos que no deben confundirse con fallos confirmados

- El rol propietario de Neon puede omitir RLS por diseño; las pruebas de aislamiento deben ejecutarse con el rol runtime, no con el propietario.
- La ausencia de eventos o snapshots en el panel de salud no prueba por sí sola que el servicio esté caído; puede indicar que aún no se generaron.
- El estado de Vercel no se considera verificado si faltan credenciales de lectura o si la API del proveedor no responde.
- El validador estático exitoso no prueba que todas las pantallas funcionen en un navegador.
- El checksum de un respaldo prueba integridad del contenido almacenado, no que una restauración sea operativa.

## 7. Recomendación de salida a Preview

Las migraciones 054 y 055 están aplicadas únicamente en QA y el validador de GitHub Actions pasó para el SHA indicado. La rama aún necesita:
1. Revisión E2E en un Preview que apunte al mismo SHA.
2. Pruebas con usuarios QA de los tres roles y dos negocios.
3. Prueba de concurrencia y recuperación de conflictos.
4. Confirmación de límites de dispositivos o deshabilitar su promesa comercial hasta implementarlos.
5. Verificación de cron y simulacro de restauración.

No se modificó producción ni se declara este código listo para producción por el solo hecho de que la validación estática haya pasado.
