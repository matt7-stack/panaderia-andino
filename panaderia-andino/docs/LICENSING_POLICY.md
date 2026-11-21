# Política de licencias y condiciones de uso — Mattsystem

**Estado:** especificación funcional y comercial para implementación.  
**Ámbito:** aplicación SaaS multiempresa de Mattsystem.  
**Regla de seguridad:** la autorización se decide en el servidor; la interfaz nunca es la autoridad de licencia.

## 1. Regla obligatoria de acceso

1. Un negocio solo puede utilizar funciones operativas si tiene una licencia válida y activa, o una prueba gratuita válida que haya aceptado expresamente.
2. Sin licencia ni prueba aceptada, el negocio permanece bloqueado. No se concede acceso operativo por el mero hecho de crear una cuenta.
3. La cuenta administradora de plataforma conserva el acceso administrativo global necesario para gestionar clientes, licencias, soporte y facturación. Esta excepción no concede acceso operativo a los datos privados de un negocio sin autorización.
4. El control se aplica en cada endpoint/API del servidor y en cada operación protegida; ocultar botones en el navegador no es suficiente.
5. El servidor comprueba estado, fechas, producto/sistema, negocio propietario y límites antes de autorizar cada operación. Rechaza por defecto ante estados desconocidos o errores de validación.

## 2. Prueba gratuita opcional

1. La prueba es opcional y requiere aceptación explícita del comprador/administrador del negocio antes de comenzar.
2. La duración inicial propuesta es de **7 días**, configurable por el administrador de plataforma.
3. No requiere tarjeta ni genera cobro automático.
4. La fecha y hora de inicio, vencimiento, negocio, usuario que aceptó, versión de las condiciones y registro de auditoría deben conservarse.
5. Se permite una sola prueba por negocio. Cambiar correo, administrador, usuarios, dispositivo o nombre comercial no reinicia ni extiende la prueba.
6. La prueba no puede superponerse con otra licencia ni reiniciarse manualmente. Las excepciones deben quedar documentadas y autorizadas por el administrador de plataforma.
7. Si el comprador no acepta la prueba, el negocio continúa bloqueado hasta adquirir y activar una licencia comercial.

## 3. Fin de la prueba o vencimiento

1. Al llegar el vencimiento, el servidor bloquea inmediatamente las operaciones de negocio, sin depender de que el usuario cierre sesión o recargue la página.
2. No existe conversión automática a un plan pago, renovación automática ni cargo automático.
3. Para continuar, el cliente debe comprar una licencia comercial y activar el código válido asociado a su negocio.
4. Si no compra, conserva acceso limitado a la pantalla de licencia, soporte y solicitud/exportación de datos conforme a la política de retención y al contrato.
5. El bloqueo no elimina, sobrescribe ni transfiere los datos del negocio. La restauración de acceso después del pago no debe requerir recrear el negocio.

## 4. Estados de licencia

- **missing:** no existe licencia asignada; acceso operativo bloqueado.
- **trial/active:** prueba aceptada y vigente; acceso temporal sujeto a límites de prueba.
- **pending:** licencia creada pero aún no activada/validada; acceso bloqueado.
- **active:** licencia comercial validada y dentro de su vigencia; acceso según el plan.
- **expired:** vencimiento alcanzado; acceso operativo bloqueado.
- **suspended:** suspendida por decisión administrativa o incumplimiento contractual; acceso operativo bloqueado.
- **cancelled:** cancelada; acceso operativo bloqueado.
- **permanent:** modalidad comercial sin fecha de vencimiento, solo si fue emitida expresamente como licencia permanente y continúa dentro de sus condiciones contractuales. No equivale a cesión de propiedad intelectual.

Los estados desconocidos o inconsistentes se consideran no autorizados (fail closed).

## 5. Compra, activación y renovación

1. Cada licencia comercial tiene código único, aleatorio, no secuencial y no reutilizable.
2. El código se almacena de forma segura (preferentemente como hash verificable) y nunca se expone en listados públicos ni logs.
3. La activación valida código, sistema/producto, negocio propietario, estado, vigencia y que no haya sido canjeado por otro negocio.
4. La licencia pertenece a un único negocio. No se permite compartirla, duplicarla, transferirla ni activarla en otra empresa salvo autorización contractual expresa.
5. Solo el administrador/supervisor autorizado del negocio puede introducir el código; solo el administrador de plataforma puede emitir, suspender o administrar licencias globales.
6. La renovación registra período cubierto, importe, fecha, referencia/comprobante y actor que la registró. La renovación solo reactiva cuando el pago/condición comercial fue validado.
7. No se debe activar una licencia por el mero registro de un pago sin verificar que corresponde a la licencia y al período correctos.

## 6. Planes y límites

Los planes iniciales propuestos son:
- **Inicial/Básico:** 1 usuario empleado además del administrador, sujeto a la definición comercial final.
- **Profesional:** hasta 4 usuarios empleados además del administrador, sujeto a la definición comercial final.
- **Empresarial:** límites y funciones definidos en la oferta/contrato.

Los límites exactos de usuarios, dispositivos, almacenamiento, sucursales, funciones y soporte deben venir de la configuración de la licencia en el servidor, no de valores enviados por el navegador. Al reducir un plan, el sistema debe impedir el cambio si el negocio supera el nuevo límite, hasta que se regularice. El administrador principal puede modificar los límites comerciales para una licencia específica.

## 7. Licencia permanente y venta del software

1. **Licencia permanente de uso:** concede derecho de uso indefinido de la versión/alcance pactados, no propiedad del código fuente, marca, diseños, documentación ni derechos de autor. Debe especificar actualizaciones, soporte, hosting, copias de seguridad, infraestructura, dispositivos permitidos y servicios que pueden seguir generando cargos.
2. **Venta/cesión del software:** operación distinta que requiere contrato independiente, inventario preciso de entregables, alcance de derechos cedidos, exclusiones, propiedad intelectual de terceros, código fuente, credenciales, infraestructura, soporte y responsabilidades. No se presume por pagar una licencia permanente.
3. No se anuncia ni registra una licencia permanente hasta que el backend pueda representarla explícitamente, sin fecha de vencimiento, con trazabilidad y reglas de suspensión/cancelación acordadas.

## 8. Aislamiento, seguridad y auditoría

1. Toda licencia se vincula a un único `business_id`; cada consulta y mutación de negocio debe respetar el aislamiento multiempresa y RLS.
2. Un negocio nunca puede consultar, activar, renovar, suspender ni modificar la licencia o pagos de otro negocio.
3. La API verifica permisos y licencia en servidor; no confía en localStorage, cookies no firmadas, parámetros de URL ni datos enviados por el cliente.
4. Los cambios de plan, emisión, activación, prueba, renovación, suspensión, cancelación y cambios de límites generan auditoría con actor, fecha, negocio, licencia y motivo, sin registrar códigos completos, contraseñas ni secretos.
5. Se limitan intentos de activación y se registran fallos sin filtrar si un código pertenece a otro negocio.
6. Los datos permanecen aislados y preservados durante bloqueo, vencimiento y suspensión. La exportación y eliminación se rigen por el contrato, la ley aplicable y la política de retención.
7. Los endpoints públicos (por ejemplo, catálogo público) solo pueden devolver los campos expresamente autorizados y no deben permitir operaciones administrativas ni exponer datos privados.

## 9. Experiencia del cliente

Cuando no exista una licencia válida, mostrar una pantalla adaptable a móviles con:
- estado y motivo del bloqueo;
- nombre del producto y negocio;
- fecha de vencimiento, cuando corresponda;
- campo para introducir código de licencia;
- enlace/canal de contacto para comprar o renovar;
- aviso de que los datos se conservan y cómo solicitar su exportación.

No mostrar controles operativos que aparenten estar disponibles. Tras activar correctamente, renovar o cambiar el estado, actualizar sesión y permisos consultando nuevamente al servidor.

## 10. Condiciones contractuales que deben comunicarse antes de contratar

La oferta y contrato deben especificar: titular y negocio licenciatario; modalidad y plan; precio e impuestos; moneda y medios de pago; duración y fecha de inicio/fin; límites de usuarios/dispositivos/funciones; alcance de soporte y actualizaciones; hosting e infraestructura; copias de seguridad y recuperación; responsabilidades del cliente; uso permitido y prohibiciones; confidencialidad y protección de datos; suspensión y cancelación; renovación y mora; exportación y retención de datos; disponibilidad y mantenimiento; limitación razonable de responsabilidad; jurisdicción y mecanismo de resolución de controversias.

La política debe revisarse con asesoría legal/contable en Paraguay antes de utilizarse como contrato definitivo. Los precios comerciales son configurables y no quedan fijados por este documento.

## 11. Criterios mínimos de aceptación antes de publicar

- Un negocio sin licencia no puede consultar ni modificar ninguna función operativa por API.
- Un negocio con prueba no aceptada no obtiene acceso.
- La prueba aceptada funciona solo durante el período y no puede repetirse para el mismo negocio.
- Al vencer la prueba, las operaciones protegidas devuelven bloqueo de licencia y la interfaz muestra activación/compra.
- Un código inválido, vencido, suspendido, de otro sistema o de otro negocio no activa.
- Un código válido activa exclusivamente el negocio propietario.
- Un cliente no puede alterar fechas, límites, estado, pagos o plan desde el navegador.
- Renovación válida restaura acceso sin pérdida de datos; renovación no validada no lo hace.
- La licencia permanente (cuando se habilite) no vence por fecha, pero sigue sometida a los términos pactados.
- Roles, RLS y aislamiento entre negocios se mantienen incluso con licencia vencida.
- Las pruebas incluyen endpoints directos, sesiones antiguas, múltiples dispositivos, móvil/escritorio y errores de base de datos.
- No se publica como terminado hasta que las pruebas automatizadas y de integración pasen en el commit que se despliega.

---
**Nota de implementación:** esta política documenta el comportamiento objetivo. Los puntos que no estén implementados y probados en backend/UI no deben anunciarse como funcionalidad disponible.
