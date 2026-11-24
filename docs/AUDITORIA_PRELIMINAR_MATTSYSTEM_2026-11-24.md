# Auditoría preliminar de MATTSYSTEM
Fecha: 24 de noviembre de 2026
Rama de referencia auditada: `fix/admin-client-panels-licenses-preview`
Commit de referencia del Preview: `8ce99a544b7fa849140f73a29ce02481ab46e917`

> Estado: auditoría estática y de metadatos. Este documento no representa una certificación de seguridad ni una aprobación funcional. No se ejecutaron operaciones destructivas ni pruebas con datos reales.

## 1. Hallazgos prioritarios

### P0 — Producción no está desplegando la versión MATTSYSTEM auditada
- El despliegue de producción más reciente consultado es `dpl_AKiN5KpnKTuLBRFniUKq6vMVHmTU`, commit `4088be4b0a4f4426ea8733fc4bce95f4e2b3c45d`, rama `fix/guarani-thousands-income-entry`.
- Vercel asigna a ese despliegue los dominios `mattsystem-gestion.com` y `mattsystem.vercel.app`.
- El código de ese commit contiene una interfaz y API antiguas de Panadería Andino, con un conjunto de pantallas mucho menor que la versión MATTSYSTEM de la rama auditada.
- La versión MATTSYSTEM más completa está en `fix/admin-client-panels-licenses-preview` y el despliegue `dpl_5zWZruhk9d2t6Lxan5rt3PbZWWHT` está en Preview, sin los dominios principales.
- No promover ni cambiar dominios hasta terminar las pruebas y sincronizar el esquema de base de datos.

### P0 — La conexión de producción no aplica RLS de forma efectiva
- En la rama principal de Neon, las tablas operativas tienen Row Level Security habilitado; varias también tienen FORCE ROW LEVEL SECURITY.
- El rol configurado para producción es `panaderia_owner`, que figura con `BYPASSRLS=true` y es propietario de las tablas.
- La API de la rama MATTSYSTEM usa directamente `neon(DATABASE_URL)`; en el código inspeccionado no se encontró establecimiento de `app.business_id`, `app.user_id`, `app.context_signature`, ni cambio a `SET ROLE mattsystem_app`.
- Por tanto, las políticas RLS no constituyen una barrera efectiva para las consultas ejecutadas con ese rol. La aplicación tiene comprobaciones de negocio y permisos en sus endpoints, pero necesitamos que la base de datos también aplique el aislamiento.
- Acción requerida: implementar y probar una conexión de mínimo privilegio con contexto de negocio firmado y RLS forzado antes de usar datos comerciales reales.

### P1 — Desfase entre código y esquema de base de datos
- El código MATTSYSTEM inspeccionado utiliza, entre otras, estas tablas: `app_business_config`, `app_license_plan_settings`, `app_module_catalog`, `app_quotations`, `app_industry_templates`, `app_commercial_settings`, `app_business_addons` y `app_module_requests`.
- Esas ocho tablas no existen en la rama Neon `main` consultada, cuyo registro de migraciones llega a `014_lock_down_runtime_role`.
- La rama Neon de desarrollo `erp-multimodules-development` sí contiene esas tablas y migraciones comerciales hasta `021_quotation_industry_keys`, pero sus tablas no tienen RLS habilitado.
- La variable DATABASE_URL de Preview está descrita como conexión QA aislada. No se reveló ni se leyó su valor secreto; falta confirmar formalmente a qué rama apunta.
- Acción requerida: establecer una única matriz de compatibilidad entre commit, entorno Vercel, rama Neon y migraciones. No ejecutar migraciones en producción hasta revisar y probar el plan.

### P1 — Catálogo de precios sin valores comerciales cargados
En la rama Neon de desarrollo consultada:
- Los 18 registros del catálogo tienen precio mensual y de configuración en cero.
- La configuración comercial general tiene todos sus importes en cero.
- Los tres planes comparten G. 99.000 mensuales, 15% de descuento anual, G. 3.500.000 por licencia permanente y G. 8.000.000 por venta integral.
- Básico y Empresa tienen G. 1.200.000 de configuración; Profesional G. 1.500.000.
- Los tres planes comparten la misma lista de módulos incluidos.
- Estos valores no coinciden con la propuesta comercial previa y no deben presentarse como precios definitivos.
- Acción requerida: aprobar y cargar precios por plan y módulo; luego comprobar que el selector, la vista previa, la cotización y la persistencia cambien correctamente.

### P1 — Documentación técnica desactualizada
- El README de la rama MATTSYSTEM todavía describe una versión base con dashboard, movimientos, notas y empleados, y enumera como pendientes módulos que ahora existen en el código.
- No es suficiente para entregar el producto a un comprador.
- Acción requerida: reemplazarlo por documentación basada en el código y esquema vigentes, con arquitectura, endpoints, entidades, roles, permisos, configuración, despliegue, respaldo y recuperación.

## 2. Inventario funcional detectado en el catálogo

18 módulos identificados:
1. Panel principal — implementado y activo.
2. Ingresos y gastos — implementado y activo.
3. Notas y comprobantes internos — implementado y activo.
4. Productos y costos — implementado y activo.
5. Ventas — implementado y activo.
6. Inventario — implementado y activo.
7. Clientes — implementado y activo.
8. Proveedores — implementado y activo.
9. Compras — implementado y activo.
10. Recetas — implementado y activo.
11. Producción — implementado y activo.
12. Caja — implementado y activo.
13. Informes avanzados — implementado y activo.
14. Empleados y pagos — implementado y activo.
15. Usuarios y permisos — implementado y activo.
16. Sucursales — no implementado; inactivo.
17. Pedidos y entregas — no implementado; inactivo.
18. Cuentas por cobrar — implementado como complemento comercial (addon).

La marca “implementado” proviene del catálogo de configuración. Cada módulo todavía necesita pruebas funcionales de alta, consulta, edición, eliminación/anulación, cálculos, permisos y persistencia. No equivale a una prueba aprobada.

## 3. Pantallas y áreas encontradas en la interfaz MATTSYSTEM

- Dashboard.
- Movimientos.
- Notas.
- Productos.
- Empleados.
- Administración principal.
- Negocios registrados.
- Licencias y ventas.
- Notificaciones administrativas.
- Configuración de soporte.
- Usuarios y permisos.
- Accesos rápidos.
- Actividad y alertas.
- Centro de seguridad.
- Reportes globales.
- Notificaciones del negocio.
- Información y activación de licencia.
- Configuración del negocio.
- Guía de uso.
- Contactar a soporte.

## 4. API detectada

La API incluye rutas para:
- Autenticación, sesión, bootstrap y cierre de sesión.
- Licencias, verificación de códigos, pagos y configuración de planes.
- Catálogo comercial, configuración por rubro, módulos y cotizaciones.
- Negocios, usuarios, clientes y permisos.
- Operaciones ERP y datos de empleados.
- Notificaciones, preferencias, soporte y respuestas.
- Actividad, auditoría, seguridad y reportes.
- Papelera, limpieza de datos y reinicio total.

La lista exacta de métodos, entradas, salidas, roles autorizados y tablas usadas se documentará en la siguiente etapa.

## 5. Controles de seguridad observados en el código

- Contraseñas derivadas con scrypt y comparación de hash en tiempo constante.
- Cookie de sesión firmada con HMAC, HttpOnly, Secure y SameSite=Lax.
- Versión de sesión para invalidar sesiones anteriores.
- Bloqueo temporal tras seis intentos fallidos en una ventana de quince minutos.
- Verificación de rol administrador de plataforma en rutas administrativas.
- Validaciones de licencia y módulos contratados.
- Comprobaciones de permisos por módulo para operaciones ERP.
- Denegación de acceso general a datos operativos para el rol empleado en la ruta general.

Pendiente de prueba:
- Aislamiento real entre dos negocios distintos.
- Acceso directo a endpoints con roles distintos.
- Manipulación de identificadores de negocio y registros.
- RLS con el rol real de ejecución.
- CSRF, XSS, validación de archivos y límites de carga.
- Revocación de sesión, bloqueos y recuperación de cuenta.
- Pruebas de restauración y recuperación de respaldos.

Observación: la comprobación de origen permite solicitudes sin encabezado Origin. Debe revisarse específicamente para operaciones que modifican datos y definirse una política CSRF consistente.

## 6. Estado de las pruebas

| Área | Estado |
|---|---|
| Inspección estática de interfaz y API | Parcialmente realizada |
| Inventario de módulos | Identificado; falta validar comportamiento |
| Demostración guiada de cada módulo | Pendiente |
| Pruebas de flujos de negocio | Pendiente |
| Pruebas por rol y permisos | Revisión estática parcial; pruebas dinámicas pendientes |
| Pruebas RLS multiempresa | Pendiente; hallazgo crítico identificado |
| Pruebas de seguridad externas | No realizadas |
| Documentación técnica completa | Pendiente |
| Contrato final de cesión y acta de entrega | Pendiente de inventario y alcance definitivo |

Los despliegues consultados figuran como READY. No se encontraron registros de advertencia/error en la ventana de 30 minutos consultada; la ausencia de registros no demuestra ausencia de errores. No se ejecutaron pruebas interactivas completas en navegador.

## 7. Plan de trabajo

1. Resolver el despliegue: mantener MATTSYSTEM actual en Preview y evitar que una rama antigua vuelva a tomar los dominios principales.
2. Confirmar qué rama Neon usa cada entorno Vercel y sincronizar migraciones de forma segura.
3. Implementar RLS efectivo con rol de mínimo privilegio y contexto firmado.
4. Aprobar y cargar los precios reales de planes y módulos.
5. Construir pruebas automatizadas de API, permisos, aislamiento y procesos principales.
6. Ejecutar pruebas manuales en móvil y escritorio con datos de prueba.
7. Actualizar README y crear manual técnico, inventario de endpoints, modelo de datos y guía de despliegue.
8. Preparar demostración de producto, contrato de cesión, inventario de entregables y acta de aceptación.

## 8. Restricciones de esta auditoría

- No se leyó ni se copió ningún secreto de Vercel o Neon.
- No se modificó la base de datos.
- No se ejecutó el reinicio ni la limpieza de datos.
- No se cambió el dominio ni se promovió ningún despliegue.
- Los negocios y datos de prueba no se consideran cartera de clientes ni activos comerciales transferibles.
