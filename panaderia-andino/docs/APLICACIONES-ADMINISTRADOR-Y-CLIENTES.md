# Aplicaciones separadas — Gestión Panadería

## Objetivo
Publicar dos puntos de entrada instalables y separados que reutilizan el mismo backend y la sesión segura de la aplicación.

- Administrador: `/admin/` — exclusivo de la cuenta global (`isPlatformAdmin === true`).
- Clientes: `/client/` — para cuentas pertenecientes a una panadería; bloquea la cuenta global.

## Implementación inicial
- Cada aplicación tiene su propio HTML de entrada y manifiesto PWA con nombre, alcance y URL de inicio independientes.
- Los dos shells cargan la aplicación existente en un iframe del mismo origen, por lo que conservan la sesión HTTP segura y las rutas API actuales.
- `js/auth.js` valida el modo seleccionado después de autenticar. Si el rol no corresponde, muestra una pantalla de acceso restringido y no deja usar el panel.
- El modo administrador oculta los menús y páginas de clientes y abre directamente Administración.
- El modo cliente oculta Administración.
- `js/dashboard.js` verifica `isPlatformAdmin` en la navegación a Administración; no confía en el rol genérico `admin` de una panadería.

## Instalación
- Android/Chrome: abrir `/admin/` o `/client/` y elegir Instalar aplicación / Añadir a pantalla principal.
- iOS/Safari: abrir el enlace, Compartir y Añadir a pantalla de inicio.
- PC: Chrome o Edge permiten instalar desde el icono de instalación de la barra de direcciones.
- Tablets: se adapta al tamaño de pantalla mediante el diseño responsive existente.

## Enlaces
- Administrador: `/admin/`
- Clientes: `/client/`

## Límites antes de producción
Esto crea dos PWAs independientes; todavía no son binarios nativos firmados de Google Play o App Store. Para distribución en tiendas se deberá añadir Capacitor, iconos/splash nativos, permisos, pruebas en dispositivos y procesos de firma.
La documentación de arquitectura multi-negocio advierte que la migración completa de datos históricos y el aislamiento de `/api/data` todavía requieren verificación. No publicar a clientes reales ni modificar Neon hasta terminar pruebas de aislamiento con dos panaderías y confirmar que las cuentas solo acceden a sus datos.
