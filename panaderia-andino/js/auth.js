'use strict';
(() => {
  const gate = document.createElement('div');
  gate.id = 'authGate';
  gate.className = 'auth-gate';
  gate.setAttribute('role', 'dialog');
  gate.setAttribute('aria-modal', 'true');
  gate.setAttribute('aria-labelledby', 'authTitle');
  gate.innerHTML = '<div class="auth-card"><div class="auth-brand"><span class="auth-brand-icon">🥐</span><div><strong>Gestión Panadería</strong><small>GESTIÓN DEL NEGOCIO</small></div></div><div id="authContent"></div><p class="auth-footnote">Acceso privado · Datos protegidos</p></div>';
  document.body.appendChild(gate);

  const content = document.getElementById('authContent');
  const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let activationToken = '';
  const hash = window.location.hash || '';
  if (hash.startsWith('#activar=')) {
    activationToken = decodeURIComponent(hash.slice('#activar='.length));
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  let recoveryToken = '';
  let recoveryIssueSecret = '';
  if (hash.startsWith('#recuperar=')) {
    recoveryToken = decodeURIComponent(hash.slice('#recuperar='.length));
  } else if (hash.startsWith('#emitir-recuperacion=')) {
    recoveryIssueSecret = decodeURIComponent(hash.slice('#emitir-recuperacion='.length));
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (window.PanaderiaAuth?.user?.isPlatformAdmin === true) {
      const businessId = localStorage.getItem('gestionPanaderia_businessId');
      if (businessId && !headers['X-Business-Id']) headers['X-Business-Id'] = businessId;
    }
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
    let result = {};
    try { result = await response.json(); } catch (_) { /* response without JSON */ }
    if (!response.ok) {
      if (response.status === 401 && window.PanaderiaAuth?.user) {
        window.PanaderiaAuth.user = null;
        document.body.classList.add('auth-locked');
        showLogin('Tu sesión venció. Iniciá sesión nuevamente.');
      }
      throw new Error(result.error || 'No se pudo completar la solicitud.');
    }
    return result;
  }

  function showMessage(message) {
    const box = document.getElementById('authError');
    if (!box) return;
    box.textContent = message || '';
    box.hidden = !message;
  }

  function showLogin(message = '') {
    document.body.classList.add('auth-locked');
    content.innerHTML = `<div class="auth-heading"><span>BIENVENIDO</span><h1 id="authTitle">Iniciar sesión</h1><p>Ingresá con tu cuenta para acceder al panel.</p></div><form id="loginForm" class="auth-form"><label for="authEmail">Correo electrónico</label><input id="authEmail" name="email" type="email" autocomplete="username" required maxlength="254" placeholder="tu@correo.com"><label for="authPassword">Contraseña</label><input id="authPassword" name="password" type="password" autocomplete="current-password" required><div id="authError" class="auth-error" role="alert" hidden></div><button class="auth-submit" type="submit">Entrar al sistema <span>→</span></button></form>`;
    showMessage(message);
    document.getElementById('loginForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('button');
      button.disabled = true;
      showMessage('');
      try {
        const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: document.getElementById('authEmail').value, password: document.getElementById('authPassword').value }) });
        establish(result.user);
      } catch (error) { showMessage(error.message); button.disabled = false; }
    });
    document.getElementById('authEmail').focus();
  }

  function showSetup() {
    document.body.classList.add('auth-locked');
    content.innerHTML = `<div class="auth-heading"><span>PRIMER ACCESO</span><h1 id="authTitle">Activar administrador</h1><p>Creá tu cuenta principal. Solo esta cuenta podrá agregar nuevos usuarios.</p></div><form id="setupForm" class="auth-form"><label for="authName">Tu nombre</label><input id="authName" name="name" autocomplete="name" required maxlength="70" placeholder="Nombre y apellido"><p class="auth-help">Se utilizará el correo de administrador configurado de forma segura en el servidor.</p><label for="authPassword">Crear contraseña</label><input id="authPassword" name="password" type="password" autocomplete="new-password" minlength="12" required placeholder="Mínimo 12 caracteres"><label for="authConfirm">Confirmar contraseña</label><input id="authConfirm" name="confirm" type="password" autocomplete="new-password" minlength="12" required><div id="authError" class="auth-error" role="alert" hidden></div><button class="auth-submit" type="submit">Activar mi cuenta <span>→</span></button></form>`;
    document.getElementById('setupForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('button');
      const password = document.getElementById('authPassword').value;
      if (password !== document.getElementById('authConfirm').value) return showMessage('Las contraseñas no coinciden.');
      if (password.length < 12) return showMessage('Usá al menos 12 caracteres.');
      button.disabled = true;
      showMessage('');
      try {
        const result = await api('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ token: activationToken, name: document.getElementById('authName').value, password }) });
        activationToken = '';
        establish(result.user);
      } catch (error) { showMessage(error.message); button.disabled = false; }
    });
    document.getElementById('authName').focus();
  }

  async function issueRecoveryLink() {
    document.body.classList.add('auth-locked');
    content.innerHTML = '<div class="auth-heading"><span>RECUPERACIÓN SEGURA</span><h1 id="authTitle">Preparando enlace</h1><p>Estamos validando el acceso y preparando tu formulario de contraseña.</p></div><div class="auth-form"><div class="auth-help">No cierres esta página hasta que aparezca el formulario.</div><div id="authError" class="auth-error" role="alert" hidden></div></div>';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let result;
      try {
        result = await api('/api/auth/create-recovery', {
          method: 'POST',
          headers: { 'X-Admin-Recovery': recoveryIssueSecret },
          body: '{}',
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }
      recoveryIssueSecret = '';
      recoveryToken = result.token;
      history.replaceState(null, '', window.location.pathname + window.location.search + '#recuperar=' + encodeURIComponent(recoveryToken));
      showRecovery();
    } catch (error) {
      const box = document.getElementById('authError');
      if (box) {
        box.textContent = error.name === 'AbortError'
          ? 'El servidor tardó demasiado en responder. Recargá esta página para intentar nuevamente.'
          : error.message;
        box.hidden = false;
      }
    }
  }

  function showRecovery() {
    document.body.classList.add('auth-locked');
    gate.classList.remove('auth-gate-hidden');
    content.innerHTML = `<div class="auth-heading"><span>RECUPERACIÓN SEGURA</span><h1 id="authTitle">Crear nueva contraseña</h1><p>Elegí una contraseña nueva para tu cuenta de administrador global. El enlace se puede utilizar una sola vez.</p></div><form id="recoveryForm" class="auth-form"><label for="recoveryPassword">Nueva contraseña</label><input id="recoveryPassword" name="password" type="password" autocomplete="new-password" minlength="12" maxlength="200" required placeholder="Mínimo 12 caracteres"><label for="recoveryConfirm">Confirmar contraseña</label><input id="recoveryConfirm" name="confirm" type="password" autocomplete="new-password" minlength="12" maxlength="200" required><div id="authError" class="auth-error" role="alert" hidden></div><button class="auth-submit" type="submit">Guardar contraseña <span>→</span></button></form>`;
    document.getElementById('recoveryForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = event.currentTarget.querySelector('button');
      const password = document.getElementById('recoveryPassword').value;
      if (password.length < 12) return showMessage('Usá al menos 12 caracteres.');
      if (password !== document.getElementById('recoveryConfirm').value) return showMessage('Las contraseñas no coinciden.');
      button.disabled = true;
      showMessage('');
      try {
        await api('/api/auth/recover', { method: 'POST', body: JSON.stringify({ token: recoveryToken, password }) });
        recoveryToken = '';
        history.replaceState(null, '', window.location.pathname + window.location.search);
        showLogin('Contraseña actualizada correctamente. Iniciá sesión con tu nueva contraseña.');
      } catch (error) {
        showMessage(error.message);
        button.disabled = false;
      }
    });
    document.getElementById('recoveryPassword').focus();
  }

  const appMode = new URLSearchParams(window.location.search).get('app');
  if (appMode === 'admin' || appMode === 'client') {
    document.body.dataset.appMode = appMode;
    const modeStyle = document.createElement('style');
    modeStyle.textContent = appMode === 'admin'
      ? 'body[data-app-mode="admin"] .page-view:not([data-page="administracion"]):not([data-page="configuracion"]){display:none!important} body[data-app-mode="admin"] #page-administracion{display:block!important} body[data-app-mode="admin"] #page-administracion[hidden]{display:block!important} body[data-app-mode="admin"] #page-configuracion:not(.active){display:none!important} body[data-app-mode="admin"] #page-configuracion.active{display:block!important} body[data-app-mode="admin"] #page-configuracion .settings-panel:not(.active){display:none!important} body[data-app-mode="admin"] #page-configuracion .settings-panel.active{display:block!important} body[data-app-mode="admin"] #page-configuracion [data-settings-tab]:not([data-settings-tab="users"]){display:none!important}'
      : 'body[data-app-mode="client"] #adminNavLink,body[data-app-mode="client"] #page-administracion{display:none!important}';
    document.head.appendChild(modeStyle);
  }

  function showWrongApp(message) {
    document.body.classList.add('auth-locked');
    gate.classList.remove('auth-gate-hidden');
    content.innerHTML = `<div class="auth-heading"><span>ACCESO RESTRINGIDO</span><h1 id="authTitle">Aplicación incorrecta</h1><p>${esc(message)}</p></div><button class="auth-submit" id="wrongAppLogout" type="button">Cerrar sesión <span>→</span></button>`;
    document.getElementById('wrongAppLogout').addEventListener('click', () => window.PanaderiaAuth?.logout());
  }

  function establish(user) {
    if (appMode === 'admin' && user.isPlatformAdmin !== true) {
      window.PanaderiaAuth.user = user;
      showWrongApp('Esta aplicación es exclusiva del administrador global. Ingresá desde Gestión Panadería Clientes.');
      return;
    }
    if (appMode === 'client' && user.isPlatformAdmin === true) {
      window.PanaderiaAuth.user = user;
      showWrongApp('Esta es la aplicación para panaderías clientes. El administrador debe ingresar desde Gestión Panadería Administrador.');
      return;
    }
    window.PanaderiaAuth.user = user;
    document.body.classList.remove('auth-locked');
    gate.classList.add('auth-gate-hidden');
    const name = document.getElementById('topUserName');
    if (name) name.textContent = user.name;
    const meta = document.querySelector('.user-meta small');
    if (meta) meta.textContent = user.role === 'admin' ? 'Administrador' : (user.role === 'supervisor' ? 'Supervisor' : 'Empleado');
    const adminGuide = document.getElementById('adminGuideSection');
    if (adminGuide) adminGuide.hidden = user.isPlatformAdmin !== true;
    const adminNav = document.getElementById('adminNavLink');
    if (adminNav) adminNav.hidden = user.isPlatformAdmin !== true;
    const usersTab = document.querySelector('[data-settings-tab="users"]');
    const usersPanel = document.querySelector('[data-settings-panel="users"]');
    if (usersTab) usersTab.hidden = user.isPlatformAdmin !== true;
    if (usersPanel) usersPanel.hidden = user.isPlatformAdmin !== true;
    if (appMode === 'admin') {
      const adminPage = document.getElementById('page-administracion');
      document.querySelectorAll('.page-view').forEach(view => view.classList.toggle('active', view === adminPage));
      if (adminPage) adminPage.classList.add('active');
      document.querySelectorAll('[data-page-link]').forEach(link => {
        const active = link.dataset.pageLink === 'administracion';
        link.hidden = !active;
        link.classList.toggle('active', active);
      });
      const title = document.getElementById('breadcrumbCurrent');
      if (title) title.textContent = 'Administración';
    }
    window.dispatchEvent(new CustomEvent('panaderia:authenticated', { detail: user }));
    if (user.role !== 'admin' && window.location.hash === '#configuracion') window.location.hash = '#dashboard';
  }

  window.PanaderiaAuth = {
    user: null,
    api,
    async logout() {
      try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch (_) { /* always clear local view */ }
      this.user = null;
      window.location.replace(window.location.pathname);
    }
  };

  window.PanaderiaAuthReady = (async () => {
    if (recoveryIssueSecret) { await issueRecoveryLink(); return null; }
    if (recoveryToken) { showRecovery(); return null; }
    try {
      const current = await api('/api/auth/me');
      if (current.authenticated && current.user) { establish(current.user); return current.user; }
      const status = await api('/api/auth/status');
      if (!status.adminExists && activationToken) showSetup();
      else if (!status.adminExists) showLogin('La cuenta administradora todavía no fue activada. Necesitás el enlace de activación inicial.');
      else showLogin();
      return null;
    } catch (error) {
      showLogin('No se pudo conectar con el servidor. Verificá la conexión y volvé a cargar la página.');
      return null;
    }
  })();
})();
