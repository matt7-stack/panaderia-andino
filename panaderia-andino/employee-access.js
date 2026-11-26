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
  function renderAccounts(employees, isOwner, events) {
    const latestByEmployee = new Map();
    (Array.isArray(events) ? events : []).forEach(event => {
      if (event.employee_user_id && !latestByEmployee.has(event.employee_user_id)) latestByEmployee.set(event.employee_user_id, event.event_type);
    });
    const list = $('#businessEmployeeAccountsList');
    if (!list) return;
    if (!employees.length) {
      list.innerHTML = '<p class="text-muted mb-0">Todavía no hay cuentas de empleados. Creá la primera desde el formulario.</p>';
      return;
    }
    list.innerHTML = employees.map(employee => {
      const active = employee.active === true;
      const pending = latestByEmployee.get(employee.id) === 'termination_requested';
      const action = active
        ? (isOwner
          ? (pending
            ? '<button class="btn btn-sm btn-outline-warning" type="button" data-employee-offboarding="terminate">Confirmar baja</button><button class="btn btn-sm btn-outline-secondary" type="button" data-employee-offboarding="reject_request">Rechazar solicitud</button>'
            : '<button class="btn btn-sm btn-outline-warning" type="button" data-employee-offboarding="terminate">Dar de baja</button>')
          : (pending
            ? '<span class="badge bg-warning text-dark">Solicitud pendiente</span>'
            : '<button class="btn btn-sm btn-outline-warning" type="button" data-employee-offboarding="request_termination">Solicitar baja</button>'))
        : (isOwner ? '<button class="btn btn-sm btn-outline-success" type="button" data-employee-offboarding="reactivate">Reactivar</button>' : '');
      return '<article class="border rounded-3 p-3 mb-3" data-business-employee="' + escapeHtml(employee.id) + '">' +
        '<div class="d-flex justify-content-between align-items-start flex-wrap gap-2"><div><strong>' + escapeHtml(employee.name) +
        '</strong><div class="small text-muted">' + escapeHtml(employee.email) + '</div></div><div class="d-flex align-items-center gap-2 flex-wrap">' +
        '<span class="badge ' + (active ? 'bg-success' : 'bg-secondary') + '">' + (active ? 'Activa' : 'Baja registrada') + '</span>' +
        action + '</div></div><div class="row g-2 mt-2">' +
        permissionMarkup(employee.permissions || {}, 'employee-' + employee.id) +
        '</div><div class="d-flex justify-content-end mt-3"><button class="btn btn-sm btn-bakery" type="button" data-save-business-employee-permissions>Guardar permisos</button></div></article>';
    }).join('');
  }
  function renderOffboardingEvents(events) {
    const list = $('#businessEmployeeOffboardingHistory');
    if (!list) return;
    if (!events.length) {
      list.innerHTML = '<p class="text-muted mb-0">Todavía no hay bajas ni solicitudes registradas.</p>';
      return;
    }
    const labels = { terminated: 'Baja confirmada', termination_requested: 'Solicitud de baja', termination_rejected: 'Solicitud rechazada', reactivated: 'Reactivación' };
    list.innerHTML = events.map(event => {
      const date = event.created_at ? new Date(event.created_at).toLocaleString('es-PY') : 'Fecha no disponible';
      return '<article class="border-bottom py-2"><div class="d-flex justify-content-between flex-wrap gap-2"><strong>' +
        escapeHtml(event.employee_name || event.employee_email || 'Empleado') + ' · ' + escapeHtml(labels[event.event_type] || 'Movimiento') +
        '</strong><small class="text-muted">' + escapeHtml(date) + '</small></div><div class="small text-muted">Registró: ' +
        escapeHtml(event.actor_name || 'Usuario no disponible') + '</div>' +
        (event.reason ? '<div class="small mt-1">Motivo: ' + escapeHtml(event.reason) + '</div>' : '') +
        (event.notes ? '<div class="small mt-1">Observaciones: ' + escapeHtml(event.notes) + '</div>' : '') + '</article>';
    }).join('');
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
      const events = Array.isArray(result.events) ? result.events : [];
      const limits = result.limits || {};
      const limitText = limits.employeeLimit == null ? 'sin límite fijo' : String(limits.employeeLimit);
      const active = Number(limits.activeEmployees || 0);
      const remaining = limits.remaining == null ? 'sin límite fijo' : String(limits.remaining);
      const summary = $('#businessEmployeeLimit');
      if (summary) summary.textContent = 'Plan ' + (limits.plan || 'actual') + ' · ' + active + ' empleados activos · límite ' + limitText + ' · disponibles ' + remaining + '.';
      renderAccounts(employees, authUser()?.role === 'admin', events);
      renderOffboardingEvents(events);
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
    const offboard = event.target.closest('[data-employee-offboarding]');
    const save = event.target.closest('[data-save-business-employee-permissions]');
    try {
      if (offboard) {
        offboard.disabled = true;
        const action = offboard.dataset.employeeOffboarding;
        if (action === 'reactivate') {
          if (!window.confirm('¿Reactivar esta cuenta? Se restaurará el acceso con sus permisos actuales.')) return;
          const notes = window.prompt('Observaciones de la reactivación (opcional):') || '';
          await api('/api/business/users', { method: 'PATCH', body: JSON.stringify({ id, action: 'reactivate', notes }) });
        } else if (action === 'request_termination') {
          const reason = window.prompt('Motivo de la solicitud de baja (opcional):') || '';
          const notes = window.prompt('Observaciones adicionales (opcional):') || '';
          if (!window.confirm('Enviar solicitud de baja al Dueño?')) return;
          await api('/api/business/users', { method: 'PATCH', body: JSON.stringify({ id, action, reason, notes }) });
          window.alert('Solicitud registrada. El Dueño recibió una notificación para revisarla.');
        } else if (action === 'reject_request') {
          const reason = window.prompt('Motivo del rechazo (opcional):') || '';
          if (!window.confirm('¿Rechazar la solicitud de baja? Se notificará al Supervisor.')) return;
          await api('/api/business/users', { method: 'PATCH', body: JSON.stringify({ id, action, reason }) });
        } else if (action === 'terminate') {
          const reason = window.prompt('Motivo de la baja (opcional):') || '';
          const notes = window.prompt('Observaciones adicionales (opcional):') || '';
          if (!window.confirm('Confirmar baja inmediata y cierre de todas las sesiones?')) return;
          await api('/api/business/users', { method: 'PATCH', body: JSON.stringify({ id, action, reason, notes }) });
        }
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
      if (offboard) offboard.disabled = false;
      if (save) save.disabled = false;
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
    if (event.target.closest('[data-employee-offboarding],[data-save-business-employee-permissions]')) handleAccountAction(event);
  });
  window.addEventListener('panaderia:authenticated', event => activate(event.detail || authUser()));
  window.addEventListener('panaderia:pagenavigate', event => {
    if (event.detail?.page === 'empleados' && canManage()) loadEmployees();
  });
  Promise.resolve(window.PanaderiaAuthReady).then(activate).catch(() => {});
  // Instalación PWA manual desde Novedades y versiones; no mostrar avisos automáticos.
  (function setupManualPwaInstall() {
    let installPrompt = null;
    const installCopy = /instal[aá].{0,35}mattsystem.{0,70}(dispositivo|celular|computadora|pc)|mattsystem.{0,60}instal.{0,60}(dispositivo|celular|computadora|pc)/i;
    function hideAutomaticInstallMessages(root = document) {
      const automaticBanner = document.getElementById('mattsystemPwaBanner');
      if (automaticBanner) automaticBanner.remove();
      // Algunos navegadores muestran una barra flotante de instalación dentro de la página.
      // Se elimina solo si el botón dice "Instalar" y el contenedor está anclado al borde inferior.
      root.querySelectorAll('button, [role="button"]').forEach(button => {
        const label = (button.textContent || button.getAttribute('aria-label') || '').trim();
        if (!/^instalar(?:\\s+app)?$/i.test(label)) return;
        const wrapper = button.closest('[role="dialog"], [role="status"], .alert, .toast, .install-banner, .pwa-install-prompt')
          || button.parentElement?.parentElement;
        if (!wrapper || wrapper === document.body) return;
        const style = window.getComputedStyle(wrapper);
        const fixedBottom = style.position === 'fixed' && (style.bottom !== 'auto' || Number.parseInt(style.insetBlockEnd, 10) >= 0);
        if (fixedBottom || /install|instal/i.test(String(wrapper.className || ''))) wrapper.remove();
      });
      root.querySelectorAll('body *').forEach(node => {
        if (node.children.length > 0) return;
        const text = (node.textContent || '').trim();
        if (text.length > 15 && text.length < 240 && installCopy.test(text)) {
          const wrapper = node.closest('[role="status"], .alert, .toast, .install-banner, .pwa-install-prompt') || node;
          wrapper.hidden = true;
          wrapper.setAttribute('aria-hidden', 'true');
        }
      });
    }
    function addInstallButton() {
      const refresh = document.getElementById('releaseRefresh');
      if (!refresh || document.getElementById('installAppPwaButton')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'installAppPwaButton';
      button.className = 'btn btn-bakery';
      button.innerHTML = '<i class="bi bi-phone"></i> Instalar app (PWA)';
      button.addEventListener('click', async () => {
        if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
          window.alert('MATTSYSTEM ya está instalado en este dispositivo.');
          return;
        }
        if (installPrompt) {
          const promptEvent = installPrompt;
          installPrompt = null;
          try {
            await promptEvent.prompt();
            const choice = await promptEvent.userChoice;
            if (choice?.outcome === 'accepted') button.textContent = 'Instalación aceptada';
          } catch (_) {
            window.alert('No se pudo abrir la instalación ahora. Volvé a intentarlo desde el menú del navegador.');
          }
          return;
        }
        const isAppleMobile = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const message = isAppleMobile
          ? 'Para instalar MATTSYSTEM: tocá el botón Compartir del navegador y elegí “Agregar a pantalla de inicio”.'
          : 'La instalación no está disponible en este momento. Abrí MATTSYSTEM en Chrome o Edge, verificá que estés conectado y volvé a intentarlo. También podés usar el menú del navegador y elegir “Instalar aplicación” o “Agregar a pantalla principal”.';
        window.alert(message);
      });
      refresh.insertAdjacentElement('afterend', button);
      const actions = refresh.parentElement;
      if (actions) {
        actions.style.display = 'flex';
        actions.style.flexWrap = 'wrap';
        actions.style.gap = '8px';
      }
    }
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      installPrompt = event;
      hideAutomaticInstallMessages();
      addInstallButton();
    });
    window.addEventListener('appinstalled', () => {
      installPrompt = null;
      const button = document.getElementById('installAppPwaButton');
      if (button) button.textContent = 'App instalada';
    });
    const observer = new MutationObserver(() => {
      hideAutomaticInstallMessages();
      addInstallButton();
    });
    function start() {
      hideAutomaticInstallMessages();
      addInstallButton();
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
    document.addEventListener('click', event => {
      if (event.target.closest('[data-page-link="novedades"], [data-go-page="novedades"]')) {
        setTimeout(addInstallButton, 60);
      }
    });
  })();

})();