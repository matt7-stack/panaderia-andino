'use strict';
(() => {
  const gate = document.createElement('div');
  gate.id = 'authGate';
  gate.className = 'auth-gate';
  gate.setAttribute('role', 'dialog');
  gate.setAttribute('aria-modal', 'true');
  gate.setAttribute('aria-labelledby', 'authTitle');
  gate.innerHTML = '<div class="auth-card"><div class="auth-brand"><span class="auth-brand-icon">🥐</span><div><strong>Panadería Andino</strong><small>GESTIÓN DEL NEGOCIO</small></div></div><div id="authContent"></div><p class="auth-footnote">Acceso privado · Datos protegidos</p></div>';
  document.body.appendChild(gate);

  const content = document.getElementById('authContent');
  const esc = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let activationToken = '';
  const hash = window.location.hash || '';
  if (hash.startsWith('#activar=')) {
    activationToken = decodeURIComponent(hash.slice('#activar='.length));
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
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

  function showSetup(adminEmail) {
    document.body.classList.add('auth-locked');
    content.innerHTML = `<div class="auth-heading"><span>PRIMER ACCESO</span><h1 id="authTitle">Activar administrador</h1><p>Creá tu cuenta principal. Solo esta cuenta podrá agregar nuevos usuarios.</p></div><form id="setupForm" class="auth-form"><label for="authName">Tu nombre</label><input id="authName" name="name" autocomplete="name" required maxlength="70" placeholder="Nombre y apellido"><label for="authEmail">Correo administrador</label><input id="authEmail" type="email" value="${esc(adminEmail)}" readonly><label for="authPassword">Crear contraseña</label><input id="authPassword" name="password" type="password" autocomplete="new-password" minlength="12" required placeholder="Mínimo 12 caracteres"><label for="authConfirm">Confirmar contraseña</label><input id="authConfirm" name="confirm" type="password" autocomplete="new-password" minlength="12" required><div id="authError" class="auth-error" role="alert" hidden></div><button class="auth-submit" type="submit">Activar mi cuenta <span>→</span></button></form>`;
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

  function establish(user) {
    window.PanaderiaAuth.user = user;
    document.body.classList.remove('auth-locked');
    gate.classList.add('auth-gate-hidden');
    const name = document.getElementById('topUserName');
    if (name) name.textContent = user.name;
    const meta = document.querySelector('.user-meta small');
    if (meta) meta.textContent = user.role === 'admin' ? 'Administrador' : (user.role === 'supervisor' ? 'Supervisor' : 'Empleado');
    const usersTab = document.querySelector('[data-settings-tab="users"]');
    const usersPanel = document.querySelector('[data-settings-panel="users"]');
    if (usersTab) usersTab.hidden = user.role !== 'admin';
    if (usersPanel) usersPanel.hidden = user.role !== 'admin';
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
    try {
      const current = await api('/api/auth/me');
      if (current.authenticated && current.user) { establish(current.user); return current.user; }
      const status = await api('/api/auth/status');
      if (!status.adminExists && activationToken) showSetup(status.adminEmail);
      else if (!status.adminExists) showLogin('La cuenta administradora todavía no fue activada. Necesitás el enlace de activación inicial.');
      else showLogin();
      return null;
    } catch (error) {
      showLogin('No se pudo conectar con el servidor. Verificá la conexión y volvé a cargar la página.');
      return null;
    }
  })();
})();
