# Gestión Panadería — arquitectura multi-negocio

## Decisiones aprobadas

- Nombre comercial visible: **Gestión Panadería**.
- Existe una sola cuenta administradora global, propiedad del titular del sistema.
- No se crean administradores por panadería.
- Cada panadería es un espacio de datos independiente.
- Los usuarios de tipo supervisor/empleado pertenecen a una sola panadería.
- El administrador global puede crear, consultar, activar/desactivar y seleccionar panaderías.
- El administrador global puede restablecer la contraseña de los usuarios sin consultar ni recuperar la contraseña anterior.

## Estado encontrado en la versión actual

- La API está en `api/[...path].js`.
- La autenticación usa `app_users`, roles `admin`, `supervisor` y `employee`, cookies de sesión firmadas y hashes scrypt.
- Actualmente `app_state` tiene una única fila con `id = 1`; por tanto, todos los datos del negocio se guardan en un único documento JSONB.
- La cuenta administradora está limitada por un índice único parcial.
- El frontend desplegado se entrega como `app.bundle.html` y tres fragmentos comprimidos `app.bundle.part1..3`; los archivos de `js/` son referencias/fuentes separadas. No se debe asumir que editar esos JS cambia el frontend publicado.

## Diseño propuesto

1. Crear `app_businesses` con UUID, nombre, estado activo y fechas.
2. Añadir `business_id` nullable a `app_users`. La cuenta con rol `admin` permanece global y con `business_id = NULL`; empleados y supervisores tienen un negocio obligatorio.
3. Crear `app_business_state` con una fila JSONB por negocio. No reutilizar el registro global `app_state(id=1)` para nuevos negocios.
4. Migrar el contenido actual de `app_state` a un negocio inicial llamado con el nombre guardado en `data.business.name` (o “Panadería Andino” si está vacío). Asociar los usuarios no administradores actuales a ese negocio.
5. Mantener intacta la tabla `app_state` durante la transición como respaldo de lectura/rollback. No borrar datos ni usuarios.
6. Modificar las rutas de datos para que el servidor determine el negocio permitido: el empleado usa su `business_id`; el administrador global debe seleccionar un negocio y la API valida esa selección.
7. Añadir rutas de administración global para listar/crear/activar/desactivar negocios y restablecer contraseñas de usuarios.
8. El restablecimiento solo acepta una contraseña nueva válida, genera un nuevo hash scrypt y revoca sesiones existentes del usuario afectado. Nunca devuelve ni registra contraseñas.
9. Añadir selector de negocio y panel de negocios al frontend del administrador global.
10. Actualizar marca, metadatos, manifiesto, iconos/textos de acceso y nombre visible a “Gestión Panadería”, sin cambiar el dominio, el repositorio, secretos ni identificadores técnicos existentes.

## Reglas de seguridad obligatorias

- Nunca confiar en un `business_id` enviado por un empleado para leer o escribir datos.
- Verificar el rol admin en servidor en cada operación global.
- No exponer hashes de contraseñas en respuestas.
- No permitir que una sesión de empleado cambie de negocio.
- Mantener el administrador global único.
- No incluir secretos en GitHub ni en logs.
- Aplicar migraciones con transacciones y comprobaciones de recuentos antes/después.
- Hacer copia de seguridad y probar en un entorno/branch de datos aislado antes de producción.

## Estado del trabajo en esta rama

- [x] Añadidas columnas de versión de sesión y pertenencia de negocio en el esquema de la API (sin asignar ni migrar datos existentes).
- [x] Añadidas tablas base `app_businesses` y `app_business_state` (su creación es idempotente; todavía no se usan para servir datos).
- [x] Añadida operación de restablecimiento de contraseña desde el endpoint administrativo de usuarios; usa scrypt y aumenta la versión de sesión para invalidar sesiones anteriores.
- [x] Añadido el control de restablecimiento en el código fuente del panel de usuarios.
- [x] Actualizados el acceso, el título inicial y el manifiesto a “Gestión Panadería”.
- [ ] Aún falta migrar de forma controlada los datos históricos y cambiar `/api/data` para aislar cada negocio.
- [ ] Aún falta el panel global de creación/selección/activación de panaderías y la asignación de usuarios a cada negocio.
- [ ] Aún falta regenerar el paquete comprimido que sirve Vercel y validar la aplicación completa.

**Esta rama es de desarrollo y no está publicada.** La creación de tablas se ejecutará cuando la API actualizada se despliegue; no se ha ejecutado ninguna migración sobre registros existentes ni se ha modificado Neon manualmente.

## Orden de implementación

1. Preparar y probar la migración no destructiva.
2. Implementar autorización multi-negocio en la API.
3. Implementar panel global y selector de negocio en el frontend empaquetado.
4. Implementar restablecimiento de contraseña en API y panel.
5. Aplicar el cambio de marca en todos los recursos visibles.
6. Ejecutar pruebas de aislamiento con dos negocios y usuarios distintos.
7. Publicar solo después de verificar que los datos históricos siguen intactos.

## Fuera de alcance de esta etapa

No modificar ni eliminar datos reales de Neon, no cambiar credenciales ni variables de entorno, no reemplazar el sistema de autenticación y no publicar cambios en producción hasta completar las pruebas.
