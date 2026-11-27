'use strict';
(() => {
 function init() {
  const nav = document.querySelector('.nav-menu');
  if (!nav || nav.dataset.adminGrouped === 'true') return;
  const groups = [
    { title: 'Principal', icon: 'bi-house-door', pages: ['dashboard','movimientos','notas','notificaciones','info','productos','empleados','erp'], open: true },
    { title: 'Administración', icon: 'bi-shield-lock', pages: ['administracion','admin-panaderias','admin-usuarios','admin-centro','admin-maintenance'], open: false },
    { title: 'Comercial', icon: 'bi-briefcase', pages: ['admin-licencias','admin-cotizador'], open: false },
    { title: 'Precios', icon: 'bi-tags', pages: ['admin-precios'], open: false },
    { title: 'Operaciones', icon: 'bi-diagram-3', pages: ['reportes-globales'], open: false },
    { title: 'Control y seguridad', icon: 'bi-shield-check', pages: ['actividad','seguridad'], open: false },
    { title: 'Soporte y comunicación', icon: 'bi-headset', pages: ['admin-notificaciones','admin-support'], open: false },
    { title: 'Preferencias y ayuda', icon: 'bi-sliders', pages: ['configuracion','guia-uso','contacto-soporte','novedades'], open: false }
  ];
  const links = [...nav.querySelectorAll(':scope > a[data-page-link]')];
  const byPage = new Map(links.map(link => [link.dataset.pageLink, link]));
  const style = document.createElement('style');
  style.textContent = `
    .nav-menu{gap:10px!important}
    #adminQuickActionsMount .quick-actions-section{margin:0 0 18px}
    #adminQuickActionsMount .quick-actions-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    @media(max-width:680px){#adminQuickActionsMount .quick-actions-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}#adminQuickActionsMount .quick-action{padding:9px 8px;gap:7px}#adminQuickActionsMount .quick-action-icon{width:30px;height:30px;flex:0 0 30px}#adminQuickActionsMount .quick-action>i{display:none}}
    .admin-nav-group{display:grid;gap:5px;min-width:0}
    .admin-nav-group[hidden]{display:none!important}
    .admin-nav-group__toggle{width:100%;display:flex;align-items:center;gap:9px;padding:8px 12px;border:0;border-radius:8px;color:#cdb59f;background:transparent;text-align:left;font:700 9px/1.2 'DM Sans',sans-serif;letter-spacing:1.1px;text-transform:uppercase}
    .admin-nav-group__toggle:hover,.admin-nav-group__toggle:focus-visible{color:#fff;background:rgba(255,255,255,.07);outline:none}
    .admin-nav-group__toggle i:first-child{font-size:13px;color:#e3bd95}
    .admin-nav-group__chevron{margin-left:auto;font-size:10px;transition:transform .18s}
    .admin-nav-group__toggle[aria-expanded="true"] .admin-nav-group__chevron{transform:rotate(90deg)}
    .admin-nav-group__items{display:grid;gap:5px;min-width:0}
    .admin-nav-group__items[hidden]{display:none!important}
    .admin-nav-group .nav-link{min-height:41px;font-size:11px}
  `;
  document.head.appendChild(style);
  const shortcutSection = document.querySelector('.quick-actions-section');
  const shortcutMount = document.getElementById('adminQuickActionsMount');
  if (shortcutSection && shortcutMount) { shortcutSection.querySelector('.section-title h3').textContent = 'Accesos rápidos'; shortcutSection.querySelector('.section-title .eyebrow').textContent = 'HERRAMIENTAS'; shortcutMount.appendChild(shortcutSection); }
  const fragments = [];
  const groupNodes = [];
  for (const definition of groups) {
    const items = definition.pages.map(page => byPage.get(page)).filter(Boolean);
    if (!items.length) continue;
    const section = document.createElement('section');
    section.className = 'admin-nav-group';
    section.dataset.adminNavGroup = definition.title;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'admin-nav-group__toggle';
    toggle.setAttribute('aria-expanded', definition.open ? 'true' : 'false');
    toggle.innerHTML = '<i class="bi ' + definition.icon + '" aria-hidden="true"></i><span>' + definition.title + '</span><i class="bi bi-chevron-right admin-nav-group__chevron" aria-hidden="true"></i>';
    const content = document.createElement('div');
    content.className = 'admin-nav-group__items';
    content.hidden = !definition.open;
    for (const link of items) content.appendChild(link);
    toggle.addEventListener('click', () => {
      content.hidden = !content.hidden;
      toggle.setAttribute('aria-expanded', content.hidden ? 'false' : 'true');
    });
    section.append(toggle, content);
    fragments.push(section);
    groupNodes.push({section,content,toggle,items});
  }
  nav.replaceChildren(...fragments);
  nav.dataset.adminGrouped = 'true';
  function syncVisibility() {
    for (const group of groupNodes) {
      const visible = group.items.some(link => !link.hidden);
      if (group.section.hidden !== !visible) group.section.hidden = !visible;
    }
  }
  nav.addEventListener('click', event => {
    const link = event.target.closest('[data-page-link]');
    if (!link) return;
    const group = link.closest('.admin-nav-group');
    if (group) {
      const content = group.querySelector('.admin-nav-group__items');
      const toggle = group.querySelector('.admin-nav-group__toggle');
      if (content && toggle) { content.hidden = false; toggle.setAttribute('aria-expanded','true'); }
    }
  });
  function syncQuickActionsVisibility() {
    const section = document.querySelector('#adminQuickActionsMount .quick-actions-section');
    if (!section) return;
    const user = window.PanaderiaAuth?.user;
    const isPlatformAdmin = user?.isPlatformAdmin === true;
    const inBusinessSupport = document.body.classList.contains('admin-support-mode') &&
      Boolean(window.PanaderiaAuth?.selectedBusinessId);
    section.hidden = isPlatformAdmin && !inBusinessSupport;
    const heading = section.querySelector('.section-title h3');
    const eyebrow = section.querySelector('.section-title .eyebrow');
    if (heading) heading.textContent = inBusinessSupport ? 'Accesos rápidos del negocio' : 'Accesos rápidos';
    if (eyebrow) eyebrow.textContent = inBusinessSupport ? 'ASISTENCIA AL NEGOCIO' : 'HERRAMIENTAS';
  }
  window.addEventListener('panaderia:authenticated', () => { syncVisibility(); syncQuickActionsVisibility(); });
  new MutationObserver(syncQuickActionsVisibility).observe(document.body,{attributes:true,attributeFilter:['class']});
  window.addEventListener('panaderia:pagenavigate', () => {
    syncQuickActionsVisibility();
    const activeLink = nav.querySelector('.nav-link.active[data-page-link]');
    const activeGroup = activeLink?.closest('.admin-nav-group');
    if (activeGroup) {
      const content = activeGroup.querySelector('.admin-nav-group__items');
      const toggle = activeGroup.querySelector('.admin-nav-group__toggle');
      if (content && toggle) { content.hidden = false; toggle.setAttribute('aria-expanded','true'); }
    }
  });
  new MutationObserver(syncVisibility).observe(nav,{subtree:true,attributes:true,attributeFilter:['hidden','class']});
  syncVisibility();
  syncQuickActionsVisibility();
 }
 Promise.resolve(window.PanaderiaAuthReady).then(init,init);
})();
