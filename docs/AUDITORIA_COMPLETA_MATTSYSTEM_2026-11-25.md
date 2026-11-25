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
| Administración/soporte/alertas | Rutas y pantallas presentes | Pendiente |

## Conclusión

El Preview compila y contiene las correcciones listadas, pero MATTSYSTEM **todavía no debe declararse listo para clientes reales**. Los bloqueos principales son RLS/rol de mínimo privilegio, desfase de producción y pruebas end-to-end por negocio y rol. La versión de producción se dejó intacta.
