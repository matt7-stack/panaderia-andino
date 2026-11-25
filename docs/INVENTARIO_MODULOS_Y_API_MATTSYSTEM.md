# Inventario funcional y API de MATTSYSTEM
Fecha de corte: 24 de noviembre de 2026
Código revisado: rama `fix/admin-client-panels-licenses-preview`, commit `8ce99a544b7fa849140f73a29ce02481ab46e917`.
Base de catálogo consultada: Neon, rama de desarrollo `erp-multimodules-development`.

> Este inventario distingue entre presencia en catálogo/código y funcionamiento probado. Ningún módulo se considera aprobado funcionalmente hasta ejecutar pruebas dinámicas.

## 1. Inventario del catálogo comercial

| Clave | Módulo | Estado en catálogo | Tipo | Observación |
|---|---|---|---|---|
| dashboard | Panel principal | Implementado / activo | Base | Indicadores y resumen |
| movements | Ingresos y gastos | Implementado / activo | Base | Movimientos financieros |
| invoices | Notas y comprobantes internos | Implementado / activo | Base | Notas, cobros y saldo pendiente |
| products | Productos y costos | Implementado / activo | Base | Catálogo, precios, costos y stock visible |
| sales | Ventas | Implementado / activo | Base | Ventas e historial |
| inventory | Inventario | Implementado / activo | Base | Existencias, entradas, salidas y mermas |
| customers | Clientes | Implementado / activo | Base | Fichas de clientes |
| suppliers | Proveedores | Implementado / activo | Base | Fichas de proveedores |
| purchases | Compras | Implementado / activo | Base | Compras y abastecimiento |
| recipes | Recetas | Implementado / activo | Base | Fórmulas e ingredientes |
| production | Producción | Implementado / activo | Base | Órdenes y lotes |
| cash | Caja | Implementado / activo | Base | Apertura, cierre y movimientos |
| reports | Informes avanzados | Implementado / activo | Base | Reportes y exportaciones |
| employees | Empleados y pagos | Implementado / activo | Base | Personal, pagos y permisos |
| users | Usuarios y permisos | Implementado / activo | Base | Usuarios del negocio |
| branches | Sucursales | Implementación en rama de trabajo; migración 024 pendiente de aplicar | Base | Directorio de sucursales y estado principal; falta completar el aislamiento de stock/caja/ventas por sede |
| delivery | Pedidos y entregas | Implementación en rama de trabajo; migración 024 pendiente de aplicar | Base | Alta de pedidos, asignación a sucursal, estados y bitácora; no descuenta stock ni genera venta automáticamente |
| receivables | Cuentas por cobrar | UI, API independiente y tablas implementadas en rama Neon de desarrollo | Complemento | No duplicar. Validar addon contratado/activo y sincronizar migraciones con el entorno correcto; `main` aún no contiene las tablas |

## 2. Pantallas detectadas

1. Dashboard.
2. Movimientos.
3. Notas.
4. Productos.
5. Empleados.
6. Administración principal.
7. Negocios registrados.
8. Licencias y ventas.
9. Notificaciones administrativas.
10. Configuración de soporte.
11. Usuarios y permisos.
12. Accesos rápidos.
13. Actividad y alertas.
14. Centro de seguridad.
15. Reportes globales.
16. Notificaciones del negocio.
17. Información y activación de licencia.
18. Configuración del negocio.
19. Guía de uso.
20. Contactar a soporte.

## 3. API: rutas y operaciones encontradas

| Ruta | Métodos observados | Función |
|---|---|---|
| `/api/auth/status` | GET | Estado de autenticación |
| `/api/auth/me` | GET | Usuario de sesión |
| `/api/auth/login` | POST | Inicio de sesión |
| `/api/auth/logout` | POST | Cierre de sesión |
| `/api/auth/bootstrap` | POST | Activación inicial del administrador |
| `/api/license/info` | GET | Información de licencia |
| `/api/license/verify-code` | POST | Verificación de código |
| `/api/license/activation-request` | POST | Solicitud de activación |
| `/api/admin/license-settings` | GET, PUT | Configuración general de licencias |
| `/api/admin/business-license` | GET, PATCH | Licencia asociada al negocio |
| `/api/admin/license-plan-settings` | GET, PUT | Precios y módulos de planes |
| `/api/admin/licenses` | GET, POST, PATCH | Gestión de licencias |
| `/api/admin/license-payments` | POST | Registro de pagos de licencia |
| `/api/admin/module-catalog` | GET, PUT | Catálogo y precios de módulos |
| `/api/admin/commercial-settings` | GET, PUT | Condiciones comerciales generales |
| `/api/admin/business-config` | GET, PUT | Rubro y módulos configurados |
| `/api/admin/quotations` | GET, POST, PATCH | Cotizaciones comerciales |
| `/api/business/module-catalog` | GET | Catálogo visible al negocio |
| `/api/business/module-requests` | GET, POST, PATCH | Solicitud y respuesta de ampliaciones |
| `/api/admin/module-requests` | GET, PATCH | Gestión administrativa de solicitudes |
| `/api/admin/businesses` | GET, POST, PATCH, DELETE | Alta, edición, estado y archivo de negocios |
| `/api/admin/clients` | GET | Resumen de clientes/negocios |
| `/api/admin/users` | GET, POST, PATCH, DELETE | Usuarios de plataforma |
| `/api/business/users` | GET, POST, PATCH | Usuarios y empleados del negocio |
| `/api/business/erp` | GET, POST, PATCH, DELETE | Operaciones ERP por módulo |
| `/api/business/employee-data` | GET, PUT | Datos operativos autorizados para empleados |
| `/api/data` | GET, PUT | Estado operativo general del negocio |
| `/api/notifications` | GET, PATCH | Notificaciones del usuario |
| `/api/notification-preferences` | GET, PUT | Preferencias de notificación |
| `/api/admin/notifications` | GET, POST, PATCH, DELETE | Comunicados administrativos |
| `/api/admin/activity` | GET, DELETE | Actividad administrativa |
| `/api/admin/security` | GET, POST | Intentos de acceso y revocación de sesiones |
| `/api/support/tickets` | GET, POST, PATCH | Solicitudes de soporte |
| `/api/support/tickets/reply` | POST | Respuesta a solicitudes |
| `/api/admin/support-settings` | GET, PUT, POST | Configuración y gestión de soporte |
| `/api/admin/trash` | GET, POST | Papelera y recuperación |
| `/api/admin/reset-data` | POST | Limpieza de datos operativos |
| `/api/admin/reset-system` | POST | Reinicio total con confirmación y contraseña |
| `/api/admin/overview` | GET | Resumen global |
| `/api/admin/database-info` | GET | Diagnóstico de base de datos |

## 4. Operaciones ERP y permisos detectados

El endpoint `/api/business/erp` identifica los módulos:
- Productos.
- Clientes.
- Proveedores.
- Ventas.
- Compras.
- Inventario.
- Recetas.
- Producción.
- Caja.
- Informes.

Permisos encontrados en backend:
- `sales.view`, `sales.create`, `sales.cancel`.
- `products.view`, `products.manage`.
- `inventory.view`, `inventory.manage`.
- `customers.view`, `customers.manage`.
- `suppliers.view`, `suppliers.manage`.
- `purchases.view`, `purchases.create`.
- `recipes.view`, `recipes.manage`.
- `production.view`, `production.manage`.
- `cash.view`, `cash.manage`, `cash.open`, `cash.close`.
- `reports.view`, `reports.export`.
- `receivables.view`, `receivables.manage` (declarados, pero sin flujo de API independiente localizado).

La administración de usuarios tiene restricciones por rol; las rutas ERP aplican controles de permisos y validan módulos configurados/licenciados. Debe comprobarse con pruebas de autorización reales y dos negocios de prueba.

## 5. Pruebas que deben ejecutarse por módulo

Para cada módulo implementado:
1. Abrir el módulo como administrador del negocio.
2. Crear un registro válido.
3. Consultar y verificar persistencia tras recargar.
4. Editar el registro.
5. Anular/eliminar según corresponda y revisar auditoría.
6. Validar importes, fechas, totales, stock y estados.
7. Probar valores vacíos, límites, duplicados y entradas inválidas.
8. Repetir con supervisor y empleado con permiso.
9. Repetir con empleado sin permiso y confirmar HTTP 403.
10. Repetir desde otro negocio y confirmar que no ve ni modifica los datos del primero.

## 6. Orden recomendado de pruebas integrales

1. Registro/alta de negocio, creación de usuario titular y activación de licencia.
2. Configuración de rubro, módulos contratados y permisos.
3. Productos, costos, clientes y proveedores.
4. Compras y actualización de inventario.
5. Ventas, cobros, notas y caja.
6. Recetas y producción.
7. Empleados, pagos y límites de usuarios.
8. Reportes y exportaciones.
9. Licencias, vencimientos, pagos y bloqueo de acceso.
10. Soporte, notificaciones, alertas, papelera y recuperación.
11. Respaldo, restauración y reinicio administrativo (solo en QA y con datos desechables).

## 7. Limitaciones

- Este inventario se obtuvo de código, pantallas y catálogo de una rama de desarrollo.
- La existencia de una ruta o pantalla no demuestra que el flujo esté libre de errores.
- Los módulos Sucursales y Pedidos/entregas están explícitamente desactivados y no implementados.
- Cuentas por cobrar requiere una decisión: completar la implementación del addon o retirarlo/desactivarlo del catálogo hasta que exista y supere pruebas.
- La demostración funcional completa y la matriz de pruebas quedan pendientes.


## 8. Actualización técnica posterior

- Se creó la rama aislada `feat/mattsystem-branches-delivery-admin` desde el último commit del Preview auditado.
- Se añadieron endpoints ERP para sucursales y pedidos/entregas, controles de permisos de empleados y una migración aditiva `024_branches_delivery.sql`.
- La gestión de pedidos incluye estados controlados (pendiente, confirmado, preparación, listo, en camino, entregado y cancelado), asignación a sucursal, artículos y bitácora.
- La creación de pedidos no descuenta stock ni registra una venta automáticamente; esa integración debe desarrollarse y probarse antes de ofrecer el flujo como ciclo comercial completo.
- La migración todavía no se aplicó a ninguna base de datos. No se modificó Neon `main` ni producción.
- El administrador agrupa la navegación por áreas y el atajo de nueva nota abre el formulario modal existente.

- La migración `025_default_branch_on_business_create.sql` crea automáticamente la sucursal principal cuando se registra un negocio nuevo.
