(function () {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const groups = [
    { title: 'Ventas y notas', items: [['sales.view', 'Ver ventas y notas'], ['sales.create', 'Registrar ventas y notas'], ['sales.cancel', 'Anular ventas']] },
    { title: 'Autorizaciones comerciales', items: [['sales.price_override', 'Modificar precios de venta'], ['sales.discount', 'Aplicar descuentos en ventas'], ['delivery.price_override', 'Modificar precios y envío de pedidos'], ['delivery.discount', 'Aplicar descuentos en pedidos']] },
    { title: 'Productos', items: [['products.view', 'Ver productos'], ['products.manage', 'Administrar productos']] },
    { title: 'Inventario', items: [['inventory.view', 'Consultar existencias'], ['inventory.manage', 'Registrar movimientos de stock']] },
    { title: 'Clientes y proveedores', items: [['customers.view', 'Ver clientes'], ['customers.manage', 'Administrar clientes'], ['suppliers.view', 'Ver proveedores'], ['suppliers.manage', 'Administrar proveedores']] },
    { title: 'Compras', items: [['purchases.view', 'Ver compras'], ['purchases.create', 'Registrar compras']] },
    { title: 'Caja y finanzas', items: [['cash.view', 'Ver movimientos de caja'], ['cash.manage', 'Registrar movimientos de caja'], ['cash.open', 'Abrir caja'], ['cash.close', 'Cerrar caja']] },
    { title: 'Producción', items: [['recipes.view', 'Ver recetas'], ['recipes.manage', 'Administrar recetas'], ['production.view', 'Ver producción'], ['production.manage', 'Registrar producción']] },
    { title: 'Informes', items: [['reports.view', 'Consultar informes'], ['reports.export', 'Exportar informes']] },
    { title: 'Cuentas por cobrar', items: [['receivables.view', 'Consultar cuentas por cobrar'], ['receivables.manage', 'Registrar deudas y pagos']] },
    { title: 'Sucursales', items: [['branches.view', 'Consultar sucursales'], ['branches.manage', 'Administrar sucursales']] },
    { title: 'Pedidos y entregas', items: [['delivery.view', 'Consultar pedidos y entregas'], ['delivery.manage', 'Registrar pedidos y actualizar entregas']] }
  ];
  const allPermissionKeys = groups.flatMap(group => group.items.map(item => item[0]));
  let loading = false;

  function authUser() { return window.PanaderiaAuth?.user || null; }
  function canManage() {
    const user = authUser();
    return !!user && user.isPlatformAdmin !== true && ['admin','supervisor'].includes(user.role);
  }
  async function api(path, options) {
    if (!window.PanaderiaAuth?.api) throw new Error('La sesión todavía no está lista.');
    return window.PanaderiaAuth.api(path, options || {});
  }
  function permissionMarkup(permissions, prefix) {
    return groups.map(group => {
      const items = group.items.map(([key, label]) => {
        const id = prefix + '-' + key.replaceAll('.', '-');
        return '<label class="form-check d-flex align-items-center gap-2 mb-0"><input class="form-check-input mt-0 employee-permission" type="checkbox" data-permission="' +
          escapeHtml(key) + '" id="' + escapeHtml(id) + '"' + (permissions?.[key] === true ? ' checked' : '') +
          '><span class="form-check-label">' + escapeHtml(label) + '</span></label>';
      }).join('');
      return '<div class="col-12 col-lg-6"><div class="border rounded-3 p-2 h-100"><strong class="d-block mb-2">' +
        escapeHtml(group.title) + '</strong><div class="d-grid gap-2">' + items + '</div></div></div>';
    }).join('');
  }
  function readPermissions(container) {
    const result = {};
    for (const key of allPermissionKeys) {
      const input = container?.querySelector('[data-permission="' + key + '"]');
      result[key] = input?.checked === true;
    }
    return result;
  }
  function renderAccounts(employees) {
    const list = $('#businessEmployeeAccountsList');
    if (!list) return;
    if (!employees.length) {
      list.innerHTML = '<p class="text-muted mb-0">Todavía no hay cuentas de empleados. Creá la primera desde el formulario.</p>';
      return;
    }
    const owner = authUser()?.role === 'admin';
    list.innerHTML = employees.map(employee => {
      const active = employee.active === true;
      const action = active
        ? (owner ? '<button class="btn btn-sm btn-outline-danger" type="button" data-offboard-business-employee>Dar de baja</button>' : '<button class="btn btn-sm btn-outline-warning" type="button" data-request-business-employee-offboard>Solicitar baja</button>')
        : (owner ? '<button class="btn btn-sm btn-outline-success" type="button" data-reactivate-business-employee>Reactivar</button>' : '');
      return '<article class="border rounded-3 p-3 mb-3" data-business-employee="' + escapeHtml(employee.id) + '">' +
        '<div class="d-flex justify-content-between align-items-start flex-wrap gap-2"><div><strong>' + escapeHtml(employee.name) +
        '</strong><div class="small text-muted">' + escapeHtml(employee.email) + '</div></div><div class="d-flex align-items-center gap-2 flex-wrap">' +
        '<span class="badge ' + (active ? 'bg-success' : 'bg-secondary') + '">' + (active ? 'Activa' : 'Sin acceso') + '</span>' +
        action + '</div></div><div class="row g-2 mt-2">' +
        permissionMarkup(employee.permissions || {}, 'employee-' + employee.id) +
        '</div><div class="d-flex justify-content-end mt-3"><button class="btn btn-sm btn-bakery" type="button" data-save-business-employee-permissions>Guardar permisos</button></div></article>';
    }).join('');
  }
  function renderLifecycle(events) {
    const panel = $('#employeeLifecycleHistory');
    if (!panel) return;
    const owner = authUser()?.role === 'admin';
    const rows = Array.isArray(events) ? events : [];
    const pending = rows.filter(item => item.event_type === 'termination_requested' && item.status === 'pending');
    const history = rows.filter(item => !(item.event_type === 'termination_requested' && item.status === 'pending'));
    panel.innerHTML = (owner && pending.length ? '<div class="mb-3"><strong>Solicitudes pendientes del Supervisor</strong>' +
      pending.map(item => '<article class="border rounded-3 p-3 mt-2" data-lifecycle-request="' + escapeHtml(item.id) + '" data-employee-id="' + escapeHtml(item.employee_user_id) + '">' +
        '<div><strong>' + escapeHtml(item.employee_name) + '</strong><div class="small text-muted">Solicitó: ' + escapeHtml(item.actor_name) + ' · ' + escapeHtml(new Date(item.created_at).toLocaleString('es-PY')) + '</div>' +
        '<p class="mb-2 mt-2">' + escapeHtml(item.reason || 'Sin motivo indicado') + '</p></div><div class="d-flex gap-2 flex-wrap">' +
        '<button type="button" class="btn btn-sm btn-danger" data-approve-employee-offboard>Confirmar baja</button>' +
        '<button type="button" class="btn btn-sm btn-outline-secondary" data-reject-employee-offboard>Rechazar solicitud</button></div></article>').join('') + '</div>' : '') +
      '<div><strong>Historial de movimientos de personal</strong>' +
      (history.length ? history.map(item => '<div class="border-bottom py-2"><div class="d-flex justify-content-between flex-wrap gap-2"><strong>' +
        escapeHtml(item.employee_name) + '</strong><span class="small text-muted">' + escapeHtml(new Date(item.created_at).toLocaleString('es-PY')) +
        '</span></div><div class="small">' + escapeHtml(({terminated:'Baja confirmada',reactivated:'Cuenta reactivada',termination_request_rejected:'Solicitud rechazada',termination_requested:'Solicitud de baja'})[item.event_type] || item.event_type) +
        ' · Responsable: ' + escapeHtml(item.actor_name) + '</div>' + (item.reason ? '<div class="small text-muted">' + escapeHtml(item.reason) + '</div>' : '') + '</div>').join('') : '<p class="small text-muted mt-2 mb-0">Todavía no hay movimientos registrados.</p>') + '</div>';
  }
  async function loadEmployees() {
    const panel = $('#supervisorEmployeeAccounts');
    if (!panel || !canManage() || loading) return;
    loading = true;
    const refresh = $('#refreshBusinessEmployees');
    if (refresh) refresh.disabled = true;
    try {
      const result = await api('/api/business/users');
      const employees = Array.isArray(result.employees) ? result.employees : [];
      const limits = result.limits || {};
      const limitText = limits.employeeLimit == null ? 'sin límite fijo' : String(limits.employeeLimit);
      const active = Number(limits.activeEmployees || 0);
      const remaining = limits.remaining == null ? 'sin límite fijo' : String(limits.remaining);
      const summary = $('#businessEmployeeLimit');
      if (summary) summary.textContent = 'Plan ' + (limits.plan || 'actual') + ' · ' + active + ' empleados activos · límite ' + limitText + ' · disponibles ' + remaining + '.';
      renderAccounts(employees);
      const lifecycle = await api('/api/business/employees/lifecycle');
      renderLifecycle(lifecycle.events || []);
    } catch (error) {
      const list = $('#businessEmployeeAccountsList');
      if (list) list.innerHTML = '<p class="text-danger mb-0">' + escapeHtml(error.message || 'No se pudieron cargar las cuentas.') + '</p>';
      const summary = $('#businessEmployeeLimit');
      if (summary) summary.textContent = 'No se pudo consultar el límite de usuarios de la licencia.';
    } finally {
      loading = false;
      if (refresh) refresh.disabled = false;
    }
  }
  function initializeCreatePermissions() {
    const target = $('#businessEmployeeCreatePermissions');
    if (target && !target.dataset.ready) {
      target.innerHTML = permissionMarkup({}, 'new-employee');
      target.dataset.ready = 'true';
    }
  }
  async function createEmployee(event) {
    event.preventDefault();
    if (!canManage()) return;
    const form = event.currentTarget;
    const button = $('#businessEmployeeCreateButton');
    const name = $('#businessEmployeeName')?.value.trim() || '';
    const email = $('#businessEmployeeEmail')?.value.trim() || '';
    const password = $('#businessEmployeePassword')?.value || '';
    if (!name || !email || password.length < 12) {
      window.alert('Completá nombre, correo y una contraseña de al menos 12 caracteres.');
      return;
    }
    if (button) button.disabled = true;
    try {
      const permissions = readPermissions($('#businessEmployeeCreatePermissions'));
      await api('/api/business/users', { method: 'POST', body: JSON.stringify({ name, email, password, permissions }) });
      form.reset();
      $('#businessEmployeeCreatePermissions')?.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = false; });
      initializeCreatePermissions();
      await loadEmployees();
      window.alert('Cuenta de empleado creada. Puede iniciar sesión con su correo y contraseña.');
    } catch (error) {
      window.alert(error.message || 'No se pudo crear la cuenta.');
    } finally {
      if (button) button.disabled = false;
    }
  }
  async function handleAccountAction(event) {
    const card = event.target.closest('[data-business-employee]');
    if (!card || !canManage()) return;
    const id = card.dataset.businessEmployee;
    const toggle = event.target.closest('[data-toggle-business-employee]');
    const save = event.target.closest('[data-save-business-employee-permissions]');
    const offboard = event.target.closest('[data-offboard-business-employee]');
    const requestOffboard = event.target.closest('[data-request-business-employee-offboard]');
    const reactivate = event.target.closest('[data-reactivate-business-employee]');
    try {
      if (offboard || requestOffboard || reactivate) {
        const action = offboard ? 'terminate' : requestOffboard ? 'request_termination' : 'reactivate';
        const question = action === 'terminate' ? 'Confirmar la baja? Se cerrarán sus sesiones y se conservará su historial.' :
          action === 'request_termination' ? 'Enviar al Dueño una solicitud de baja?' : 'Reactivar el acceso de este empleado?';
        if (!window.confirm(question)) return;
        const reason = window.prompt('Motivo (opcional):', '') || '';
        const button = offboard || requestOffboard || reactivate;
        button.disabled = true;
        await api('/api/business/employees/lifecycle', { method: 'POST', body: JSON.stringify({ action, employeeId: id, reason }) });
        await loadEmployees();
        window.alert(action === 'request_termination' ? 'Solicitud enviada al Dueño.' : action === 'terminate' ? 'Baja confirmada. Las sesiones fueron revocadas y el historial se conservó.' : 'Empleado reactivado.');
      } else if (toggle) {
        toggle.disabled = true;
        const active = !card.querySelector('.badge')?.classList.contains('bg-success');
        await api('/api/business/users', { method: 'PATCH', body: JSON.stringify({ id, active }) });
        await loadEmployees();
      } else if (save) {
        save.disabled = true;
        const permissions = readPermissions(card);
        await api('/api/business/users', { method: 'PATCH', body: JSON.stringify({ id, permissions }) });
        await loadEmployees();
        window.alert('Permisos actualizados. Las sesiones anteriores del empleado fueron revocadas.');
      }
    } catch (error) {
      window.alert(error.message || 'No se pudo actualizar la cuenta.');
    } finally {
      if (toggle) toggle.disabled = false;
      if (save) save.disabled = false;
    }
  }
  async function resolveLifecycleRequest(event, card) {
    const approve = event.target.closest('[data-approve-employee-offboard]');
    const reject = event.target.closest('[data-reject-employee-offboard]');
    if (!approve && !reject) return;
    if (authUser()?.role !== 'admin') return;
    const action = approve ? 'terminate' : 'reject_request';
    if (!window.confirm(approve ? 'Confirmar la baja solicitada? Se revocarán las sesiones y se conservará el historial.' : 'Rechazar esta solicitud de baja?')) return;
    const reason = window.prompt('Motivo (opcional):', '') || '';
    const button = approve || reject; button.disabled = true;
    try {
      await api('/api/business/employees/lifecycle', { method: 'POST', body: JSON.stringify({
        action, employeeId: card.dataset.employeeId, requestId: card.dataset.lifecycleRequest, reason
      }) });
      await loadEmployees();
      window.alert(approve ? 'Baja confirmada. Las sesiones fueron revocadas y el historial se conservó.' : 'Solicitud rechazada.');
    } catch (error) {
      window.alert(error.message || 'No se pudo resolver la solicitud.');
      button.disabled = false;
    }
  }
  function activate(user) {
    const panel = $('#supervisorEmployeeAccounts');
    if (!panel) return;
    const modules=user?.businessConfig?.modules;
    const moduleAllowed=!Array.isArray(modules)||(modules.includes('users')&&modules.includes('employees'));
    panel.hidden = !user || user.isPlatformAdmin === true || !['admin','supervisor'].includes(user.role) || !moduleAllowed;
    if (!panel.hidden) {
      initializeCreatePermissions();
      loadEmployees();
    }
  }
  document.addEventListener('submit', event => {
    if (event.target?.id === 'businessEmployeeCreateForm') createEmployee(event);
  });
  document.addEventListener('click', event => {
    if (event.target.closest('#refreshBusinessEmployees')) loadEmployees();
    if (event.target.closest('[data-toggle-business-employee],[data-save-business-employee-permissions],[data-offboard-business-employee],[data-request-business-employee-offboard],[data-reactivate-business-employee]')) handleAccountAction(event);
    const request = event.target.closest('[data-lifecycle-request]');
    if (request && canManage()) resolveLifecycleRequest(event, request);
  });
  window.addEventListener('panaderia:authenticated', event => activate(event.detail || authUser()));
  window.addEventListener('panaderia:pagenavigate', event => {
    if (event.detail?.page === 'empleados' && canManage()) loadEmployees();
  });
  Promise.resolve(window.PanaderiaAuthReady).then(activate).catch(() => {});
})();