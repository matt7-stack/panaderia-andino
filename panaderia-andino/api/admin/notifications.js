'use strict';

// Ruta explícita para el envío de notificaciones de administración.
// Reutiliza el handler común para mantener autenticación, validaciones y persistencia.
const handler = require('../[...path].js');

module.exports = async function adminNotificationsHandler(req, res) {
  req.url = '/api/admin/notifications';
  return handler(req, res);
};
