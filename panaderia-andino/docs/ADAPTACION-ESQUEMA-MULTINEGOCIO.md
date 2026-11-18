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
