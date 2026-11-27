# MATTSYSTEM — Suite de mejoras (27-11-2026)

## Objetivo y alcance
Implementar la suite completa de mejoras acordada por el propietario en una rama de Preview. No tocar producción. No incluir turnos de trabajo. Mantener compatibilidad con el ERP existente, las licencias, los complementos, la prueba gratuita y los roles Dueño/Administrador del negocio, Supervisor y Empleado.

## Reglas no negociables
- Ningún módulo o complemento se activa automáticamente al crear un negocio, aceptar una prueba o emitir una licencia.
- No inventar precios: las tarifas de nuevas funciones quedan sin precio comercial (monthly_price=0, setup_price=0) hasta que el propietario las defina; cero en catálogo técnico no debe presentarse como “gratis”.
- La Caja ya existe como módulo core; no duplicarla como complemento.
- Cuentas por cobrar ya existe como complemento opcional; conservar su activación contractual.
- Las funciones internas de MATTSYSTEM no se muestran como módulos comprables a los clientes.
- Respetar aislamiento por business_id, RLS y contexto firmado del tenant. Toda mutación sensible deja auditoría.
- No borrar datos de un negocio por vencimiento de licencia ni por desvincular a un empleado.
- Probar primero en Neon QA y Vercel Preview; nunca promover a producción sin autorización explícita.

## Mapa de funciones y módulos

### A. Mejoras operativas del negocio
1. Cierre y arqueo de caja: extender el módulo Caja existente; saldo esperado vs. contado, diferencia, responsable, fecha y motivo. No crear un segundo módulo Caja.
2. Control de deudas: usar Cuentas por cobrar existente (addon); mostrar vencimiento/antigüedad, pagos parciales, saldo y trazabilidad.
3. Alertas de stock mínimo: integrar en Productos/Inventario; umbral configurable por producto y avisos deduplicados.
4. Mermas y pérdidas: integrar en Inventario; motivo (vencido, dañado, desperdicio, ajuste), cantidad, costo y responsable; excluir ajustes no comerciales de ventas.
5. Historial de precios/costos: integrar en Productos; registrar cambios con fecha, usuario, valor anterior/nuevo y motivo.
6. Respaldo/exportación: integrar con Informes y herramientas de negocio; exportar solo datos del tenant autenticado y con permisos adecuados.

### B. Empleados y supervisores (todo excepto turnos)
1. Auditoría de acciones por usuario: ventas, gastos, compras, caja, inventario, cambios y eliminaciones; filtros por persona/fecha/acción.
2. Permisos granulares: capacidades separadas para crear, editar, anular, eliminar, ver costos, ver ganancias e informes.
3. Desvinculación segura: revocar sesiones/credenciales y permisos inmediatamente, conservar registros históricos, permitir reactivar solo con autorización.
4. Panel del Supervisor: ventas, gastos, costos, mermas, margen/ganancia estimada y comparativas; solo datos de su negocio.
5. Separación estricta: Supervisor no administra licencias, catálogo comercial, configuración de plataforma ni datos de otros negocios. Empleado no obtiene métricas sensibles salvo permiso explícito.
6. Sin turnos, fichaje, asistencia ni control horario.

### C. Herramientas comerciales internas MATTSYSTEM
1. Cotizador profesional PDF: licencia, configuración inicial opcional, módulos/complementos, pagos iniciales, mensualidad y proyección anual; mostrar descuentos de forma transparente.
2. Comparador de planes Básico/Profesional/Empresa, leyendo el catálogo real y respetando precios oficiales vigentes.
3. Seguimiento de prospectos: nombre, contacto, rubro, estado, próxima acción, notas y vínculo a cotizaciones; reutilizar prospectos de cotizaciones si es compatible, evitando duplicar registros.
4. Negocio de demostración: datos ficticios aislados, claramente identificados, sin mezclar con datos reales ni enviar notificaciones externas.
5. Historial y conversión de cotizaciones con trazabilidad; no emitir licencia hasta que la cotización esté aceptada, conforme al flujo actual.

### D. Herramientas internas y seguridad de MATTSYSTEM
1. Centro de control exclusivo del administrador de plataforma: negocios, estado, licencias, vencimientos, módulos contratados, ingresos recurrentes y salud de instalaciones.
2. Centro de notificaciones unificado, con filtros, preferencias y aislamiento por destinatario/tenant.
3. Auditoría de seguridad periódica: permisos, sesiones, límites de API, RLS, endpoints y eventos sospechosos; resultados legibles sin exponer secretos.
4. Gestión de sesiones/dispositivos: listar sesiones activas, revocar sesión o dispositivo y registrar auditoría.
5. Papelera con restauración segura, alcance por tenant y retención configurable; no restaurar registros que violen restricciones o pertenezcan a otro negocio.
6. Estado del sistema: conectividad API/DB, última operación correcta, versión desplegada y degradaciones; nunca mostrar credenciales ni datos sensibles.
7. Respaldos: verificar consistencia/checksum, retención, registro de restauración y acceso solo a administradores autorizados.
8. Novedades y versiones: mantener publicación y visibilidad por cliente como flujo existente, revisar filtros y UX.

## Inventario inicial existente en Neon QA (no recrear)
- Tablas existentes: app_audit_logs, app_backup_log, app_business_backups, app_cash_sessions, app_cash_movements, app_inventory_movements, app_trash, app_quotations, app_release_notes, app_notifications, app_notification_preferences, app_employee_offboarding_events.
- Catálogo de 18 módulos ya existe. Caja, Inventario, Productos, Informes, Empleados y Usuarios son módulos core; Cuentas por cobrar es addon opcional.
- API ya contiene rutas para /api/admin/activity, /api/admin/trash, /api/admin/quotations, /api/business/backups, /api/business/tools, /api/release-notes y /api/admin/security.
- Estos hallazgos indican componentes existentes, no certifican que todas las pantallas o flujos estén completos. Auditar y reutilizar antes de crear tablas/endpoints nuevos.

## Plan de entrega
- Fase 1 — auditoría funcional y brechas: inspeccionar rutas, UI, permisos, esquema, RLS y relaciones; marcar cada función como completa/parcial/ausente.
- Fase 2 — seguridad y datos: migraciones versionadas, índices y políticas RLS; pruebas tenant isolation; auditoría y revocación de sesiones.
- Fase 3 — operación: caja, mermas, stock, historial de precios, exportaciones y panel Supervisor.
- Fase 4 — comercial: cotizador PDF, comparador, pipeline de prospectos y demo.
- Fase 5 — plataforma: Centro de control, notificaciones, papelera, respaldos, salud y seguridad.
- Fase 6 — QA: validar sintaxis, scripts de build/test, rutas, permisos por rol, escenarios multiusuario y mobile; desplegar Preview y revisar logs.
- Entregar un informe con commits, migraciones aplicadas en QA, pruebas ejecutadas, limitaciones conocidas y URL Preview READY.

## Criterios de aceptación
- No hay regresiones de inicio de sesión, carga de dashboard, navegación ni módulos existentes.
- Un usuario de un negocio no puede leer/escribir datos de otro negocio aunque manipule IDs.
- Solo el administrador de plataforma modifica licencias/precios comerciales y administra el Centro de control.
- Supervisor ve métricas de su negocio pero no licencias ni configuración de plataforma.
- Empleado solo ve/ejecuta capacidades autorizadas.
- Baja de empleado revoca acceso sin borrar el historial.
- Los módulos opcionales requieren activación explícita y contrato cuando aplique.
- No se activa ni cobra ninguna tarifa nueva sin definición del propietario.
- No se incluye ninguna función de turnos de trabajo.
- Preview debe estar READY en el commit de esta rama; producción permanece intacta.

## Auditoría inicial de implementación (27-11-2026)

### Reutilizable ya presente en Neon QA
- Caja: app_cash_sessions ya contiene opening_amount, closing_amount, expected_amount, difference, opened_by, closed_by y estados open/closed; existe restricción de una sola caja abierta por negocio. app_cash_movements registra ingresos y egresos. El modelo de datos soporta arqueo/diferencia; falta verificar y completar UX, validaciones, cierre y reportes.
- Inventario: app_products ya tiene min_stock y stock; app_inventory_movements admite entry, exit, adjustment y waste con cantidad/costo/actor. Se puede reutilizar para alertas y mermas sin crear módulo duplicado.
- Auditoría: app_audit_logs existe y la API expone /api/admin/activity. Falta comprobar cobertura real de eventos por acción/usuario y acceso del administrador del negocio/supervisor.
- Respaldos: app_business_backups conserva payload, checksum, tamaño y datos de restauración; /api/business/backups existe. Revisar integridad, permisos, retención y UX de restauración.
- Papelera: app_trash y /api/admin/trash existen; actualmente el tipo de entidad permitido en DB incluye negocio, usuario y anuncio. Ampliar solo si se define restauración segura de más entidades.
- Cotizaciones/prospectos: app_quotations ya tiene prospect_name, prospect_email, industria, módulos, precios, estado y notas; /api/admin/quotations existe. Falta verificar pipeline/seguimiento y generación PDF real.
- Empleados: app_employee_offboarding_events, session_version y permisos JSON en app_users ya existen. Falta comprobar revocación inmediata de todas las sesiones y la granularidad efectiva de cada operación.
- Notificaciones y novedades: app_notifications, app_notification_preferences y app_release_notes existen; revisar experiencia unificada, destinatarios y filtros.
- Centro de control: existe la sección base y varias rutas administrativas, pero debe auditarse el alcance de métricas y estado operativo.

### Brechas de interfaz detectadas por inspección estática inicial
- No se encontraron referencias visibles de interfaz para “arqueo”, “diferencia de caja”, “merma”, “historial de precios”, “prospectos” como pipeline, “comparador de planes”, “sesiones activas” o “revocar sesión”.
- Existen menciones genéricas a PDF, seguridad, demostración y Centro de control, pero no bastan para certificar los flujos completos.
- No se verificó la aplicación con sesión real ni un recorrido E2E; no marcar como terminado ningún flujo solo por existir una tabla o endpoint.

### Decisiones de implementación derivadas
- No crear tablas duplicadas para caja, mermas, auditoría, respaldos, papelera, cotizaciones o novedades antes de revisar sus endpoints existentes.
- Próxima prioridad técnica: completar cierre/arqueo de caja y control de mermas/alertas de stock, luego historial de precios y panel de Supervisor; a continuación pipeline comercial y PDF; por último sesiones/dispositivos y Centro de control.
- Mantener la rama y Preview aislados. El deployment READY actual solo contiene la especificación y auditoría inicial; no representa la implementación funcional de estas mejoras.
