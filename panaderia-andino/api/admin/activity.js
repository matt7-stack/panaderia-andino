'use strict';

// Ruta explícita para el historial de actividad del administrador.
// Reutiliza el handler común y conserva la autenticación y validaciones existentes.
const handler = require('../[...path].js');

module.exports = async function adminActivityHandler(req, res) {
  req.url = '/api/admin/activity';
  return handler(req, res);
};
