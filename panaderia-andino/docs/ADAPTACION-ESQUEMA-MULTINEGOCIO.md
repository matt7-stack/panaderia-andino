# Adaptación del esquema para Gestión Panadería

Fecha: 2026-11-18

## Hallazgo confirmado en el entorno aislado

La rama Neon `gestion-panaderia-dev-20261118` es una copia aislada del proyecto de pruebas. Su estructura actual usa estas tablas:

- `businesses`: catálogo de panaderías, con `id`, `name`, `slug`, `active` y `created_at`.
- `app_users`: usuarios con `business_id NOT NULL` y `is_platform_admin NOT NULL DEFAULT FALSE`.
- `app_state`: estado JSONB por negocio, con `business_id NOT NULL` y un índice único por negocio.
- `app_login_attempts`: control de intentos de acceso.

En esta rama aislada, la consulta de recuentos devolvió 1 negocio, 0 usuarios, 0 estados y 2 registros de intentos de acceso. No se modificaron filas ni esquema durante esta inspección.

## Incompatibilidad detectada en la rama de código

La API actual de `feature/gestion-panaderia-multinegocio` todavía espera un modelo distinto:

- Crea `app_businesses` y `app_business_state`, que no son las tablas existentes del entorno de pruebas.
- Sigue leyendo y escribiendo `app_state WHERE id = 1`.
- No filtra el estado por `business_id`.
- No selecciona ni aplica `is_platform_admin`.
- Crea usuarios sin asignarles un `business_id`, aunque el esquema de pruebas lo exige.

Por lo tanto, desplegar esta versión contra el esquema de pruebas conocido puede fallar y, aun si algunas consultas funcionaran, no ofrecería aislamiento multi-negocio. No debe publicarse así.

## Modelo objetivo recomendado

Conservar los nombres de tablas ya existentes en el entorno de pruebas:

1. `businesses` será el catálogo único de panaderías.
2. `app_state` almacenará un documento JSONB por cada `business_id`; toda lectura y escritura deberá usar el negocio efectivo autorizado por el servidor.
3. `app_users.business_id` será obligatorio para supervisores y empleados.
4. La única cuenta propietaria del sistema será identificada por `is_platform_admin = TRUE`. Para permitir que sea global, la migración del esquema de desarrollo deberá hacer nullable `app_users.business_id` para esa cuenta y mantener una restricción que exija negocio a los demás usuarios.
5. El servidor deberá verificar `is_platform_admin` en cada ruta global. Un usuario normal nunca podrá elegir ni cambiar su `business_id) mediante datos enviados desde el navegador.
6. El administrador global seleccionará un negocio en el panel. La API validará esa selección y usará ese identificador solo para las operaciones autorizadas del administrador.
7. El índice de administrador por negocio existente debe revisarse antes de decidir si se conserva; la regla de negocio es una sola cuenta global, no administradores locales por panadería.

## Cambios necesarios en la API

- Añadir `session_version` de forma compatible y usarla para revocar sesiones al restablecer contraseñas o desactivar cuentas.
- Incluir `is_platform_admin` y `business_id` en el usuario autenticado, sin exponer hashes.
- Separar autorización global de autorización por negocio.
- Crear rutas globales para listar, crear y activar/desactivar negocios, y para asignar usuarios a un negocio.
- En `/api/data`, resolver el negocio en el servidor: el empleado/supervisor usa su propio `business_id`; el administrador global requiere un negocio seleccionado y validado.
- Cambiar GET, PUT y limpieza de datos para operar únicamente sobre el estado de ese negocio.
- Mantener el restablecimiento de contraseña limitado a usuarios no globales, con hash scrypt y revocación de sesiones.

## Secuencia segura de implementación

1. Mantener esta revisión en la rama de desarrollo y usar exclusivamente la rama Neon aislada.
2. Alinear primero la API con `businesses`, `app_users` y `app_state`; no crear un segundo catálogo de negocios.
3. Añadir las restricciones necesarias en la rama aislada y probarlas con datos sintéticos de dos negocios, un usuario por negocio y una cuenta global.
4. Verificar que los usuarios de un negocio no pueden leer ni escribir datos del otro, incluso enviando manualmente otro identificador.
5. Probar inicio/cierre de sesión, restablecimiento de contraseña, revocación de sesión y permisos globales.
6. Actualizar el frontend y regenerar el paquete `app.bundle.html` y sus fragmentos.
7. Ejecutar pruebas de regresión de las funciones existentes antes de considerar cualquier despliegue.

## Límite de esta revisión

Este documento registra hallazgos y diseño. No ejecuta migraciones, no modifica datos, no cambia variables de entorno y no autoriza despliegues. El esquema de producción sigue sin estar identificado de forma verificable y debe permanecer intacto.


## Resultado de la primera migración de desarrollo (18 nov 2026)

Se aplicó exclusivamente en la rama Neon aislada `gestion-panaderia-dev-20261118` del proyecto de pruebas:

- `app_users.business_id` ahora admite NULL únicamente para la cuenta global.
- Se añadió `app_users.session_version INTEGER NOT NULL DEFAULT 0`.
- Se sustituyó el índice de administrador por negocio por un índice único parcial que permite una sola cuenta global.
- Se añadió una restricción que exige que el administrador global tenga `role='admin'` y `business_id IS NULL`, mientras que supervisores y empleados deben tener un negocio y no pueden ser administradores globales.

Prueba transaccional con dos negocios ficticios, dos usuarios de distinto ámbito y una cuenta global: **PASS**. La prueba verificó que cada negocio tuviera su propio estado y que el estado del negocio Sur no apareciera al consultar el ámbito del Norte. Los datos sintéticos se eliminaron dentro de la misma transacción.

Recuento posterior: 1 negocio preexistente, 0 usuarios, 0 estados y 2 registros de intentos de acceso. No se alteraron los registros preexistentes.

También se probaron las restricciones negativas: la base rechaza un empleado sin negocio y rechaza la creación de un segundo administrador global. Los intentos de prueba se ejecutaron sin dejar usuarios de prueba persistidos.

Esta prueba valida restricciones y estructura de base de datos; todavía no valida el aislamiento de la API ni la interfaz. La API actual aún debe adaptarse antes de que el modelo pueda considerarse funcional.


## Implementación inicial de API en rama feature (18 nov 2026)

Se adaptó `api/[...path].js` para trabajar con el esquema real de desarrollo:

- La cuenta global se identifica mediante `is_platform_admin=TRUE`; no se crean administradores locales por negocio.
- El bootstrap inicial crea la cuenta global sin `business_id`, y el estado de autenticación devuelve el ámbito de la cuenta sin exponer hashes.
- El login y la validación de sesión comprueban la versión de sesión y que el negocio asignado a un usuario normal siga activo.
- `GET/POST/PATCH /api/admin/businesses` permite al administrador global listar, crear y modificar/activar negocios.
- `GET/POST/PATCH/DELETE /api/admin/users` permite gestionar usuarios de todos los negocios; la creación exige un negocio activo y el restablecimiento de contraseña invalida sesiones anteriores.
- `/api/data` y `/api/admin/reset-data` consultan y escriben exclusivamente el estado identificado por `business_id`. Para el administrador global, el negocio se selecciona mediante el encabezado `X-Business-Id` o el parámetro `businessId`; para supervisores y empleados se ignora cualquier negocio enviado por el cliente y se utiliza siempre el negocio de su cuenta.
- Se eliminaron de la API las referencias al catálogo paralelo `app_businesses`, al estado paralelo `app_business_state` y al antiguo estado global `app_state WHERE id=1`. La API ya no ejecuta DDL automáticamente en cada petición.

### Validación realizada y pendiente

- El archivo actualizado pasó una comprobación de sintaxis JavaScript.
- Se verificaron estáticamente las rutas de negocio, la selección de ámbito, las operaciones `ON CONFLICT(business_id)`, la revocación de sesiones y la eliminación de las referencias al esquema paralelo.
- **Pendiente:** pruebas de integración ejecutando las rutas HTTP contra la rama Neon aislada, incluyendo intentos de acceso cruzado y CRUD de negocios/usuarios.
- **Pendiente:** adaptar la interfaz para que el administrador global pueda seleccionar el negocio activo y enviar `X-Business-Id`; el formulario actual de alta de usuarios aún no envía `businessId`.
- No se desplegó la API, no se modificaron variables de entorno ni se tocó producción.


## Interfaz de administración global (18 nov 2026)

Se añadió en la rama feature:

- Selector persistente de panadería para la cuenta global.
- Alta de negocios desde el selector.
- Envío automático del encabezado `X-Business-Id` en llamadas autenticadas del administrador global.
- Selector de negocio obligatorio al crear supervisores o empleados.
- Al cambiar de negocio, la interfaz intenta guardar los cambios pendientes en el negocio anterior antes de cambiar el ámbito; si la sincronización está en curso o falla, cancela el cambio.
- Las pestañas de administración de usuarios se muestran únicamente a la cuenta global identificada por `isPlatformAdmin`.

### Validación estática posterior

Los tres archivos modificados (`api/[...path].js`, `js/auth.js` y `js/dashboard.js`) pasaron comprobación de sintaxis JavaScript. La comparación con `main` confirma que la rama feature está 19 commits por delante y no está detrás.

Se volvió a consultar únicamente el recuento de la rama Neon aislada: 1 negocio, 0 usuarios, 0 estados y 2 intentos de acceso. No se insertaron ni eliminaron datos durante esta comprobación.

**Limitación importante:** todavía no se ejecutó la aplicación contra Neon mediante peticiones HTTP reales ni se regeneró el bundle de producción. Por ello no se considera terminada la prueba funcional; la rama sigue sin desplegarse y producción permanece intacta.
