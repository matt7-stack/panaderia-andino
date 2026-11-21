'use strict';

(() => {
  const CHECK_URL = '/api/auth/status';
  const CHECK_INTERVAL = 60000;
  const REQUEST_TIMEOUT = 8000;
  let checking = false;
  let lastState = 'checking';
  let statusNode;

  const ensureStatusNode = () => {
    if (statusNode?.isConnected) return statusNode;
    statusNode = document.createElement('section');
    statusNode.id = 'mattsystemConnectionStatus';
    statusNode.className = 'mattsystem-connection-status';
    statusNode.setAttribute('role', 'status');
    statusNode.setAttribute('aria-live', 'polite');
    statusNode.setAttribute('aria-atomic', 'true');
    statusNode.hidden = true;
    statusNode.innerHTML = '<span class="connection-status-dot" aria-hidden="true"></span><span class="connection-status-message"></span><button type="button" class="connection-status-retry">Reintentar</button>';
    const host = document.querySelector('.main-content') || document.body;
    host.prepend(statusNode);
    statusNode.querySelector('button').addEventListener('click', () => checkServer(true));
    return statusNode;
  };

  const renderStatus = (state, message) => {
    const node = ensureStatusNode();
    node.dataset.state = state;
    node.querySelector('.connection-status-message').textContent = message;
    node.hidden = state === 'online';
    const retry = node.querySelector('button');
    retry.hidden = state === 'checking';
    retry.disabled = state === 'checking';
    if (state !== lastState) {
      window.dispatchEvent(new CustomEvent('mattsystem:server-status', { detail: { state } }));
      lastState = state;
    }
  };

  async function checkServer(force = false) {
    if (checking || (!force && document.visibilityState === 'hidden')) return;
    if (!navigator.onLine) {
      renderStatus('offline', 'Sin conexión a Internet. Los datos se actualizarán al recuperar la conexión.');
      return;
    }
    checking = true;
    renderStatus('checking', 'Comprobando conexión segura con el servidor…');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const response = await fetch(CHECK_URL, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const payload = await response.json();
      if (typeof payload.adminExists !== 'boolean') throw new Error('Respuesta de servidor no válida');
      renderStatus('online', 'Conectado al servidor.');
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'El servidor está tardando demasiado en responder.' : 'No se pudo conectar con el servidor. Verificá la conexión y volvé a intentar.';
      renderStatus('unreachable', message);
    } finally {
      window.clearTimeout(timeout);
      checking = false;
    }
  }

  const enhanceTouchTargets = () => {
    document.documentElement.classList.add('mattsystem-responsive-ready');
    document.querySelectorAll('button, [role="button"], input, select, textarea').forEach((control) => {
      if (!control.hasAttribute('aria-label') && !control.labels?.length && !control.textContent?.trim()) return;
      if (control.matches('button, [role="button"]')) control.classList.add('mattsystem-touch-target');
    });
  };

  const start = () => {
    ensureStatusNode();
    enhanceTouchTargets();
    checkServer(true);
    window.addEventListener('online', () => checkServer(true));
    window.addEventListener('offline', () => renderStatus('offline', 'Sin conexión a Internet. Los datos se actualizarán al recuperar la conexión.'));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkServer(true); });
    window.setInterval(() => checkServer(false), CHECK_INTERVAL);
    document.addEventListener('click', (event) => {
      const link = event.target.closest('[data-page-link]');
      if (link && window.matchMedia('(max-width: 767.98px)').matches) {
        document.querySelector('.sidebar')?.classList.remove('open');
        document.querySelector('.sidebar-backdrop')?.classList.remove('show');
        document.querySelector('#menuToggle')?.setAttribute('aria-expanded', 'false');
      }
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
