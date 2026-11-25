# Auditoría técnica de MATTSYSTEM — 25/11/2026

## Alcance y límites

- Código revisado: `matt7-stack/panaderia-andino`, rama `feat/admin-private-finance-notes-qa`.
- Commit final auditado: `c33c0cf76cb18dd5598c027496b7482949a313b5`.
- Preview: `https://mattsystem-bz8qwf60b-mattaye2831-7602.vercel.app`.
- Base de QA: Neon `gestion_panaderia`, rama `qa-admin-finance-dev-2026-11` (`br-cool-term-b6qc4t20`).
- No se modificó producción, sus dominios ni su base de datos.
- No se realizaron pruebas destructivas ni se usaron datos reales de clientes.
- La validación fue estática, de esquema/datos de QA y de despliegue. No equivale a una prueba end-to-end con navegador y cuentas de cada rol.

## Cambios aplicados

1. **Protección CSRF/origen**
   - Las operaciones no seguras ahora requieren un encabezado Origin verificable.
   - Se rechazan solicitudes marcadas como `Sec-Fetch-Site: cross-site`.
   - GET/HEAD/OPTIONS pueden seguir funcionando sin Origin para comprobaciones y clientes no navegador.
2. **Cabeceras HTTP**
   - Añadidas `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security` y una política CSP limitada para impedir framing y objetos.
3. **Importes en guaraníes**
   - Se normalizan separadores de miles/decimales en la API: `100.000` y `100000` representan 100.000.
   - El formulario privado de finanzas envía el texto original para evitar que el navegador convierta `100.000` en 100.
   - Se aplica la normalización a los endpoints que recibían `input.amount`.
4. **Fechas de finanzas privadas**
   - Se valida la fecha ISO completa, incluyendo que exista en el calendario; ya no basta con que coincida con el patrón YYYY-MM-DD.
5. **Navegación**
   - Se cambió la etiqueta del acceso ERP de “Gastos” a “Gestión operativa”.
   - Se conservó la corrección anterior del acordeón de Administración y el desplazamiento del menú.
6. **Catálogo comercial QA**
   - Básico: Gs. 120.000/mes.
   - Profesional: Gs. 200.000/mes.
   - Empresa: Gs. 320.000/mes.
   - Se quitó Cuentas por cobrar de la lista de módulos incluidos en Empresa; sigue siendo un complemento independiente.
   - Sucursales y Pedidos/entregas quedaron inactivos/no implementados en el catálogo QA hasta completar sus integraciones.
   - No se inventaron importes para licencia permanente, venta integral ni el complemento de Cuentas por cobrar. El cotizador ya rechaza cotizaciones permanentes o de venta completa si el precio está en cero.
7. **Rendimiento de consultas**
   - Se creó y aplicó en QA la migración `028_query_performance_indexes.sql` con seis índices para historial por negocio, lotes de producción, cotizaciones y papelera activa.
8. **Regresiones**
   - Se amplió `scripts/validate-source.js` para comprobar las defensas CSRF, cabeceras, normalización monetaria, validación de fechas, etiqueta de Gestión operativa y migración 028.

## Validaciones realizadas

- Vercel Preview final: estado **READY**.
- Build: validación estática correcta; 3/12 funciones serverless, dentro del límite Hobby.
- Migraciones de QA: hasta `028_query_performance_indexes`.
- Catálogo QA: precios mensuales verificados; Sucursales/Pedidos desactivados; Cuentas por cobrar mantiene modo addon.
- Integridad referencial: 0 claves foráneas no validadas.
- QA tiene 52 tablas.
- Los registros recientes de una versión anterior mostraron un timeout al iniciar `GET /api/auth/me`. El despliegue final no tenía registros de error/advertencia al momento de la consulta, pero no se considera resuelto hasta probar inicio de sesión real.
- El preview final no recibió tráfico de prueba suficiente para demostrar que todos los flujos funcionan.

## Hallazgos críticos pendientes

### P0 — Aislamiento de datos en PostgreSQL

En la rama QA, las 52 tablas tienen RLS desactivado. La conexión usa `panaderia_owner` con `BYPASSRLS=true`. Por tanto, RLS no protege contra errores de consulta ni contra una ruta que omita el filtro de negocio. El backend contiene filtros por `business_id` y relaciones compuestas, pero esto no sustituye una segunda barrera de base de datos.

**Acción requerida antes de clientes reales:** implementar un rol runtime de mínimo privilegio y contexto de negocio firmado por transacción; adaptar todas las rutas a ese contexto; habilitar y probar RLS con dos negocios aislados. No activar RLS sin ese cambio, porque podría romper el sistema o quedar mal configurado.

### P0 — Producción no contiene la versión actual de MATTSYSTEM

El deployment que Vercel identifica como producción sigue en el commit `4088be4b0a4f4426ea8733fc4bce95f4e2b3c45d`, cuyo HTML todavía dice “Panadería Andino” y presenta el sistema anterior. La versión auditada está en Preview. No promover producción hasta cerrar seguridad, migraciones y pruebas E2E.

### P1 — Pruebas funcionales por rol

No se completó la ejecución en navegador de alta/edición/anulación, recarga, permisos y aislamiento entre dos negocios. El entorno QA contiene un administrador y no tiene negocios ni operaciones de prueba; por ello no se pudieron probar los ciclos completos de ventas, compras, inventario, caja, producción, empleados, soporte y licencias.

### P1 — Timeout de inicio

Se registró un timeout de inicialización en `/api/auth/me` en el deployment anterior. Debe comprobarse con login real, recarga y sesión persistente en el deployment final.

### P1 — Controles adicionales recomendados

- Agregar rate limiting por IP además del bloqueo por correo en login.
- Incorporar MFA para la cuenta administradora de plataforma.
- Revisar CSP completa y SRI/autohospedaje de dependencias CDN antes de endurecer `script-src`.
- Ejecutar pruebas de restauración real de copias de seguridad; la existencia de una tabla de logs no demuestra que haya un backup restaurable.
- Verificar límites de sesión, recuperación de cuenta y rotación de `SESSION_SECRET`.
- Auditar exportaciones PDF/Excel, WhatsApp, archivos y entradas XSS con payloads de prueba.
- Probar en escritorio y móvil cada botón, formulario, estado vacío, error de red y doble envío.

## Estado funcional por área

| Área | Estado de código | Prueba E2E |
|---|---|---|
| Dashboard | Presente | Pendiente |
| Ingresos y gastos | Presente; normalización monetaria reforzada | Pendiente |
| Notas y comprobantes | Presente | Pendiente |
| Productos y costos | Presente | Pendiente |
| Ventas | Presente; anulación/stock/caja requiere prueba de ciclo | Pendiente |
| Inventario | Presente | Pendiente |
| Clientes y proveedores | Presente | Pendiente |
| Compras | Presente; anulación/stock requiere prueba de ciclo | Pendiente |
| Recetas y producción | Presente; consumos y rendimiento requieren prueba | Pendiente |
| Caja | Presente | Pendiente |
| Informes | Presente | Pendiente |
| Empleados y permisos | Controles backend presentes | Pendiente por rol |
| Usuarios | Gestión administrativa presente | Pendiente por rol |
| Cuentas por cobrar | Complemento separado y con controles de idempotencia | Pendiente |
| Sucursales y pedidos | Desactivados en catálogo QA hasta completar integración | No habilitar |
| Licencias/cotizador | Planes y reglas presentes; precios mensuales QA corregidos | Pendiente |
| Copias de seguridad | Descarga JSON local; sin restauración ni respaldo remoto automático | Pendiente / incompleto |
| Administración/soporte/alertas | Rutas y pantallas presentes | Pendiente |

## Conclusión

El Preview compila y contiene las correcciones listadas, pero MATTSYSTEM **todavía no debe declararse listo para clientes reales**. Los bloqueos principales son RLS/rol de mínimo privilegio, desfase de producción y pruebas end-to-end por negocio y rol. La versión de producción se dejó intacta.


---

## Actualización de correcciones críticas — 25/11/2026

**Versión de QA:** commit `09c23390203ce2d2463b57200cd65e36304ba22d`  
**Preview:** `https://mattsystem-83ij7sspw-mattaye2831-7602.vercel.app`  
**Neon QA:** rama `qa-admin-finance-dev-2026-11` (`br-cool-term-b6qc4t20`)

### Correcciones críticas implementadas

1. **RLS activado y forzado:** las 34 tablas `app_*` con `business_id` tienen RLS y FORCE ROW LEVEL SECURITY. También se protegieron `businesses`, `app_users`, soporte, pagos de licencia, preferencias de notificación, restablecimientos de contraseña y tablas administrativas.
2. **Rol de ejecución de mínimo privilegio:** el Preview usa `mattsystem_runtime`, que no es superusuario, no tiene `BYPASSRLS`, no puede crear bases/roles ni truncar tablas. La conexión usa el endpoint pooler de Neon. El rol propietario anterior queda separado para migraciones.
3. **Contexto por transacción:** cada consulta autenticada aplica `app.user_id`, `app.business_id` y el rol de plataforma mediante `set_config(..., true)` dentro de una transacción Neon. Las rutas especializadas de complementos y cuentas por cobrar también se ejecutan dentro del contexto.
4. **Políticas por rol:** el administrador de plataforma puede administrar negocios; el usuario del negocio solo ve su negocio; el supervisor puede crear/editar empleados de su negocio sin elevar permisos. Se preservó el límite de empleados de la licencia.
5. **Catálogo público:** el acceso público queda limitado al ID de negocio explícitamente validado por la ruta de catálogo; no concede escritura.
6. **CSRF global:** todas las operaciones que modifican datos exigen Origin válido y rechazan `Sec-Fetch-Site: cross-site`. Esto también se aplica a las dos rutas API especializadas.
7. **Límite de intentos por IP:** se añadió contador por IP con HMAC, sin guardar la dirección IP en claro en la tabla de intentos; se conserva el límite por correo.
8. **Copias remotas y restauración:** se agregó almacenamiento por negocio, checksum SHA-256, historial, descarga JSON y restauración con confirmación. Se conservan hasta 14 copias por negocio.
9. **Respaldo diario:** se configuró un Vercel Schedule a las 02:00 de Paraguay (`America/Asuncion`) que llama el endpoint protegido por `CRON_SECRET`.
10. **CSP adicional:** se añadieron `form-action 'self'` y `upgrade-insecure-requests`, manteniendo bloqueo de frames y objetos.
11. **Finanzas y licencias:** siguen vigentes las correcciones anteriores de importes y precios mensuales oficiales en QA.
12. **Validaciones automáticas:** el build verifica que existan las migraciones, el contexto RLS, el control CSRF, las rutas de respaldo/restauración y la programación diaria.

### Pruebas realizadas

- Migraciones 029 y 030 registradas en Neon QA.
- 34/34 tablas con `business_id` tienen RLS habilitado y forzado; no quedó ninguna tabla de ese conjunto sin ambas propiedades.
- El rol runtime confirmó `rolsuper=false`, `rolbypassrls=false`, `rolcreatedb=false`, `rolcreaterole=false` y no tiene permiso TRUNCATE.
- Prueba SQL transaccional de aislamiento con dos negocios ficticios: lectura cruzada bloqueada, escritura cruzada sin filas afectadas, catálogo público limitado, supervisor limitado a empleados y administrador con acceso global. La prueba se ejecutó dentro de una subtransacción revertida; no quedaron negocios ni usuarios ficticios.
- El endpoint `/api/auth/status` respondió HTTP 200 y confirmó que existe el administrador.
- `/api/auth/me` sin cookie respondió HTTP 401, que es el resultado esperado para una sesión no autenticada.
- `POST /api/auth/logout` sin Origin respondió HTTP 403; con Origin del mismo Preview respondió HTTP 200.
- La página principal respondió HTTP 200.
- Se comprobaron cabeceras HTTP de seguridad, incluido CSP, HSTS, X-Frame-Options, Referrer-Policy y Permissions-Policy.
- Build Vercel Preview: **READY**; validación estática correcta; 3/12 funciones serverless.
- Se revocaron los enlaces temporales de bypass usados para las pruebas y se detuvieron los sandboxes temporales.

### Pendientes que requieren una acción externa o una prueba con credenciales reales

1. **Inicio de sesión completo:** no se probó con la contraseña real del administrador ni se consultó ningún secreto de sesión. El endpoint de estado y el control de sesión no autenticada sí se probaron. Falta que el propietario pruebe su inicio de sesión en el Preview.
2. **Restauración con datos reales:** la ruta y el flujo están implementados, pero QA no contiene negocios con datos operativos; falta ejecutar una creación/restauración real con un negocio de prueba.
3. **MFA:** sigue siendo una mejora recomendada. No se activó automáticamente para evitar bloquear la cuenta administradora sin registrar primero una aplicación autenticadora y códigos de recuperación.
4. **Schedule en Preview:** la programación está declarada en `vercel.json` y tiene `CRON_SECRET` de Preview, pero no se pudo invocar desde las herramientas disponibles. Vercel Schedules admite ejecuciones en Preview y puede invocarse/activarse desde el panel o CLI.
5. **Producción:** no se modificó la rama, la base ni las variables de producción. Producción continúa en la versión anterior. Para obtener estas protecciones en clientes reales se requiere aplicar las migraciones 029/030 en la rama de producción, configurar allí `DATABASE_URL_RUNTIME` con su propio rol sin BYPASSRLS y `CRON_SECRET`, ejecutar las pruebas de aceptación y recién entonces promover el código.
6. **Pruebas funcionales de cada módulo:** ventas, compras, inventario, caja, producción, exportaciones, WhatsApp y permisos necesitan un negocio y usuarios de prueba; QA estaba vacío y no se usaron datos de producción.

**Conclusión actualizada:** el bloqueo de aislamiento de datos quedó corregido y probado en QA a nivel SQL. La API ya se ejecuta con un rol sin BYPASSRLS y las mutaciones tienen defensa CSRF global. El Preview está READY. MATTSYSTEM todavía no debe promoverse a producción hasta completar la prueba de login del propietario, restauración con un negocio de prueba y el despliegue coordinado de las migraciones y credenciales de runtime en producción.
