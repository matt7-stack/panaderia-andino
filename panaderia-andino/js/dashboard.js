'use strict';

(() => {
  const STORAGE_KEY = 'panaderiaAndino_data_v2';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const todayISO = () => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const monthISO = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const monthDate = (offset, day = 12) => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  const makeId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const money = (value) => `Gs. ${new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 }).format(Number(value) || 0)}`;
  const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const dateFormat = (dateValue) => {
    if (!dateValue) return '—';
    const [year, month, day] = dateValue.split('-').map(Number);
    if (!year || !month || !day) return escapeHTML(dateValue);
    const format = state.preferences.dateFormat || 'es-PY';
    return new Intl.DateTimeFormat(format, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(year, month - 1, day));
  };
  const monthName = (monthKey) => {
    const [year, month] = monthKey.split('-').map(Number);
    return new Intl.DateTimeFormat('es-PY', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
  };

  const createEmptyState = () => ({
    movements: [], invoices: [], employees: [], employeePayments: [],
    categories: { income: ['Ventas', 'Pedidos', 'Otros ingresos'], expense: ['Materia prima', 'Servicios', 'Alquiler', 'Salarios', 'Mantenimiento', 'Otros gastos'] },
    paymentMethods: ['Efectivo', 'Transferencia', 'Tarjeta', 'QR'], users: [],
    business: { name: 'Panadería Andino', address: '', phone: '', email: '', ruc: '', owner: 'Administrador', logo: '' },
    preferences: { dateFormat: 'es-PY', invoiceAlerts: true, confirmDelete: true }
  });

  let state = createEmptyState();
  let cloudUsers = [];
  let cloudReady = false;
  let cloudSaveTimer = null;
  let cloudUpdatedAt = null;
  let cloudSaving = false;
  let cloudSyncInterval = null;
  const cloudPayload = () => {
    const payload = JSON.parse(JSON.stringify(state));
    delete payload.users;
    return payload;
  };
  const saveState = (syncCloud = true) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (syncCloud && cloudReady && window.PanaderiaAuth?.user) {
        clearTimeout(cloudSaveTimer);
        cloudSaveTimer = setTimeout(async () => {
          cloudSaveTimer = null; cloudSaving = true;
          try {
            const saved = await window.PanaderiaAuth.api('/api/data', { method: 'PUT', body: JSON.stringify({ data: cloudPayload() }) });
            cloudUpdatedAt = saved.updatedAt || cloudUpdatedAt;
          } catch (error) {
            console.error('No se pudo sincronizar la información.', error);
            notify('No se pudo sincronizar con el servidor. Revisá tu conexión.');
          } finally { cloudSaving = false; }
        }, 500);
      }
      return true;
    } catch (error) {
      console.error('No se pudo guardar la información local.', error);
      notify('No se pudo guardar la información.');
      return false;
    }
  };

  const movementModalEl = $('#movementModal');
  const invoiceModalEl = $('#invoiceModal');
  const simpleModalEl = $('#simpleModal');
  const movementModal = bootstrap.Modal.getOrCreateInstance(movementModalEl);
  const invoiceModal = bootstrap.Modal.getOrCreateInstance(invoiceModalEl);
  const simpleModal = bootstrap.Modal.getOrCreateInstance(simpleModalEl);
  const appToast = bootstrap.Toast.getOrCreateInstance($('#appToast'), { delay: 3000 });
  let activeInvoiceTab = 'issued';
  let simpleModalMode = '';
  let simpleModalData = {};
  let chartInstance = null;
  let selectedPage = 'dashboard';
  const monthFilter = $('#monthFilter');
  monthFilter.value = monthISO();

  function notify(message) {
    $('#toastMessage').textContent = message;
    appToast.show();
  }
  function confirmDelete(message) {
    return state.preferences.confirmDelete === false || window.confirm(message);
  }
  function outstanding(invoice) {
    return Math.max(0, Number(invoice.amount) - Number(invoice.paidAmount || 0));
  }
  function getMonthMovements(monthKey) {
    return state.movements.filter((item) => item.date && item.date.startsWith(monthKey));
  }
  function sumType(items, type) {
    return items.filter((item) => item.type === type).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  }
  function pageNavigate(page) {
    if (!['dashboard', 'movimientos', 'notas', 'empleados', 'administracion', 'configuracion'].includes(page)) return;
    if (page === 'administracion' && window.PanaderiaAuth?.user?.role !== 'admin') return;
    selectedPage = page;
    $$('.page-view').forEach((view) => view.classList.toggle('active', view.dataset.page === page));
    $$('.nav-menu [data-page-link]').forEach((link) => {
      const active = link.dataset.pageLink === page;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    const titles = { dashboard: 'Dashboard', movimientos: 'Movimientos', notas: 'Notas', empleados: 'Empleados', administracion: 'Administración', configuracion: 'Configuración' };
    $('#breadcrumbCurrent').textContent = titles[page];
    $('#globalMonthPicker').classList.toggle('d-none', page !== 'dashboard');
    $('#sidebar').classList.remove('open');
    $('#sidebarBackdrop').classList.remove('show');
    $('#menuToggle').setAttribute('aria-expanded', 'false');
    if (page === 'movimientos') renderMovements();
    if (page === 'notas') renderInvoices();
    if (page === 'empleados') renderEmployees();
    if (page === 'administracion') renderAdminPanel();
    if (page === 'configuracion') renderSettings();
    window.history.replaceState(null, '', `#${page}`);
  }

  function updateCounters() {
    $('#movementNavCount').textContent = state.movements.length;
    $('#invoiceNavCount').textContent = state.invoices.length;
    $('#footerYear').textContent = new Date().getFullYear();
    $('#footerBusinessName').textContent = state.business.name || 'Panadería Andino';
    $('#topUserName').textContent = window.PanaderiaAuth?.user?.name || state.business.owner || 'Administrador';
  }

  function updateGreeting() {
    const hour = Number(new Intl.DateTimeFormat('es-PY', { timeZone: 'America/Asuncion', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    const greeting = hour >= 5 && hour < 12 ? ['¡Buenos días!', '☀️'] : (hour >= 12 && hour < 19 ? ['¡Buenas tardes!', '🌤️'] : ['¡Buenas noches!', '🌙']);
    const heading = $('#dashboardGreeting'); const icon = $('#dashboardGreetingIcon');
    if (heading) heading.textContent = greeting[0]; if (icon) icon.textContent = greeting[1];
  }

  function renderDashboard() {
    updateGreeting();
    const monthKey = monthFilter.value || monthISO();
    const monthMovements = getMonthMovements(monthKey);
    const income = sumType(monthMovements, 'income');
    const expense = sumType(monthMovements, 'expense');
    const profit = income - expense;
    const pending = state.invoices.reduce((total, invoice) => ['pending', 'partial'].includes(invoice.status) ? total + outstanding(invoice) : total, 0);
    $('#incomeTotal').textContent = money(income);
    $('#expenseTotal').textContent = money(expense);
    $('#profitTotal').textContent = money(profit);
    $('#pendingTotal').textContent = money(pending);
    $('#profitStatus').innerHTML = profit >= 0 ? '<i class="bi bi-check-circle"></i> Positivo' : '<i class="bi bi-exclamation-circle"></i> Negativo';
    $('#profitStatus').classList.toggle('negative', profit < 0);
    $('#profitStatus').classList.toggle('positive', profit >= 0);

    const recent = [...state.movements].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    $('#recentMovementsBody').innerHTML = recent.map((item) => `<tr>
      <td>${dateFormat(item.date).slice(0, 5)}</td>
      <td><span class="movement-name">${escapeHTML(item.description)}</span><small>${escapeHTML(item.category)}</small></td>
      <td><span class="status-pill ${item.type === 'income' ? 'status-income' : 'status-expense'}">${item.type === 'income' ? 'Ingreso' : 'Gasto'}</span></td>
      <td class="text-end ${item.type === 'income' ? 'amount-income' : 'amount-expense'}">${money(item.amount)}</td>
    </tr>`).join('');
    $('#recentEmpty').classList.toggle('d-none', recent.length > 0);

    renderChart(monthKey);
    updateCounters();
  }

  function renderChart(selectedMonth) {
    const canvas = $('#financeChart');
    if (!canvas || !window.Chart) return;
    const [year, month] = selectedMonth.split('-').map(Number);
    const labels = [];
    const incomeData = [];
    const expenseData = [];
    for (let offset = 5; offset >= 0; offset--) {
      const date = new Date(year, month - 1 - offset, 1);
      const key = monthISO(date);
      labels.push(new Intl.DateTimeFormat('es-PY', { month: 'short' }).format(date).replace('.', ''));
      const items = getMonthMovements(key);
      incomeData.push(sumType(items, 'income') / 1000000);
      expenseData.push(sumType(items, 'expense') / 1000000);
    }
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [
        { label: 'Ingresos', data: incomeData, backgroundColor: '#80502f', borderRadius: 5, maxBarThickness: 24 },
        { label: 'Gastos', data: expenseData, backgroundColor: '#df9146', borderRadius: 5, maxBarThickness: 24 }
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { backgroundColor: '#3e2114', padding: 10, titleFont: { family: 'DM Sans', size: 10 }, bodyFont: { family: 'DM Sans', size: 10 }, callbacks: { label: (context) => `${context.dataset.label}: ${money(context.raw * 1000000)}` } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#8b7b6d', font: { family: 'DM Sans', size: 9 } }, border: { display: false } },
          y: { beginAtZero: true, suggestedMax: Math.max(5, ...incomeData, ...expenseData) * 1.2, ticks: { color: '#a18f7f', font: { family: 'DM Sans', size: 9 }, callback: (value) => `${value}M` }, grid: { color: '#f0e8de', drawTicks: false }, border: { display: false } }
        }
      }
    });
  }

  function categoryOptions(type, selected = '') {
    const categories = state.categories[type] || [];
    return categories.map((category) => `<option value="${escapeHTML(category)}" ${category === selected ? 'selected' : ''}>${escapeHTML(category)}</option>`).join('');
  }
  function paymentOptions(selected = '') {
    return state.paymentMethods.map((method) => `<option value="${escapeHTML(method)}" ${method === selected ? 'selected' : ''}>${escapeHTML(method)}</option>`).join('');
  }
  function refreshMovementFilters() {
    const type = $('#movementTypeFilter').value;
    const selected = $('#movementCategoryFilter').value;
    const categories = type === 'all' ? [...state.categories.income, ...state.categories.expense] : (state.categories[type] || []);
    $('#movementCategoryFilter').innerHTML = '<option value="all">Todas las categorías</option>' + [...new Set(categories)].map((item) => `<option value="${escapeHTML(item)}">${escapeHTML(item)}</option>`).join('');
    if ([...$('#movementCategoryFilter').options].some((option) => option.value === selected)) $('#movementCategoryFilter').value = selected;
  }

  function renderMovements() {
    refreshMovementFilters();
    const search = $('#movementSearch').value.trim().toLowerCase();
    const type = $('#movementTypeFilter').value;
    const category = $('#movementCategoryFilter').value;
    const from = $('#movementStartDate').value;
    const to = $('#movementEndDate').value;
    const rows = [...state.movements].filter((item) => {
      const matchesSearch = !search || `${item.description} ${item.category} ${item.note || ''}`.toLowerCase().includes(search);
      const matchesType = type === 'all' || item.type === type;
      const matchesCategory = category === 'all' || item.category === category;
      const matchesFrom = !from || item.date >= from;
      const matchesTo = !to || item.date <= to;
      return matchesSearch && matchesType && matchesCategory && matchesFrom && matchesTo;
    }).sort((a, b) => b.date.localeCompare(a.date));
    $('#movementsTableBody').innerHTML = rows.map((item) => `<tr>
      <td>${dateFormat(item.date)}</td>
      <td><span class="table-main-text">${escapeHTML(item.description)}</span>${item.note ? `<span class="table-sub-text">${escapeHTML(item.note)}</span>` : ''}</td>
      <td>${escapeHTML(item.category)}</td>
      <td><span class="status-pill ${item.type === 'income' ? 'status-income' : 'status-expense'}">${item.type === 'income' ? 'Ingreso' : 'Gasto'}</span></td>
      <td>${escapeHTML(item.payment || '—')}</td>
      <td class="text-end table-amount ${item.type === 'income' ? 'amount-income' : 'amount-expense'}">${money(item.amount)}</td>
      <td><div class="table-actions"><button class="icon-action" type="button" title="Editar" aria-label="Editar movimiento" data-edit-movement="${escapeHTML(item.id)}"><i class="bi bi-pencil"></i></button><button class="icon-action danger" type="button" title="Eliminar" aria-label="Eliminar movimiento" data-delete-movement="${escapeHTML(item.id)}"><i class="bi bi-trash3"></i></button></div></td>
    </tr>`).join('');
    const income = sumType(rows, 'income');
    const expense = sumType(rows, 'expense');
    $('#movementIncomeTotal').textContent = money(income);
    $('#movementExpenseTotal').textContent = money(expense);
    $('#movementBalanceTotal').textContent = money(income - expense);
    $('#movementResultCount').textContent = `Mostrando ${rows.length} de ${state.movements.length} registros`;
    $('#movementsEmpty').classList.toggle('d-none', rows.length > 0);
  }

  function setMovementType(type) {
    $('#movementType').value = type;
    $$('.type-option').forEach((button) => button.classList.toggle('active', button.dataset.type === type));
    $('#movementCategory').innerHTML = categoryOptions(type);
  }
  function openMovementModal(type = 'income', id = '') {
    const form = $('#movementForm');
    form.reset();
    $('#movementId').value = '';
    $('#movementDate').value = todayISO();
    $('#movementPayment').innerHTML = paymentOptions(state.paymentMethods[0]);
    const item = id ? state.movements.find((row) => row.id === id) : null;
    if (item) {
      $('#movementModalTitle').textContent = 'Editar movimiento';
      $('#movementId').value = item.id;
      $('#movementDescription').value = item.description;
      $('#movementAmount').value = item.amount;
      $('#movementDate').value = item.date;
      $('#movementNote').value = item.note || '';
      setMovementType(item.type);
      $('#movementCategory').value = item.category;
      $('#movementPayment').innerHTML = paymentOptions(item.payment);
    } else {
      $('#movementModalTitle').textContent = type === 'income' ? 'Nuevo ingreso' : 'Nuevo gasto';
      setMovementType(type);
    }
    movementModal.show();
  }

  function renderInvoices() {
    const issued = state.invoices.filter((invoice) => invoice.direction === 'issued');
    const received = state.invoices.filter((invoice) => invoice.direction === 'received');
    const sales = issued.reduce((sum, item) => sum + Number(item.amount), 0);
    const purchases = received.reduce((sum, item) => sum + Number(item.amount), 0);
    const pending = state.invoices.reduce((sum, item) => ['pending', 'partial'].includes(item.status) ? sum + outstanding(item) : sum, 0);
    $('#invoiceSalesTotal').textContent = money(sales);
    $('#invoicePurchasesTotal').textContent = money(purchases);
    $('#invoicePendingTotal').textContent = money(pending);
    $('#invoiceSalesCount').textContent = `${issued.length} notas de venta`;
    $('#invoicePurchasesCount').textContent = `${received.length} notas de compra`;
    $('#issuedCount').textContent = issued.length;
    $('#receivedCount').textContent = received.length;
    $$('.invoice-tab').forEach((tab) => {
      const active = tab.dataset.invoiceTab === activeInvoiceTab;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    $('#invoicePartyHeading').textContent = activeInvoiceTab === 'issued' ? 'CLIENTE' : 'PROVEEDOR';
    const search = $('#invoiceSearch').value.trim().toLowerCase();
    const status = $('#invoiceStatusFilter').value;
    const rows = [...state.invoices].filter((invoice) => invoice.direction === activeInvoiceTab)
      .filter((invoice) => !search || `${invoice.number} ${invoice.party} ${invoice.description || ''}`.toLowerCase().includes(search))
      .filter((invoice) => status === 'all' || invoice.status === status)
      .sort((a, b) => b.date.localeCompare(a.date));
    const statusLabels = { draft: 'Borrador', pending: 'Pendiente', partial: 'Pago parcial', paid: 'Pagada', cancelled: 'Anulada' };
    const statusClasses = { draft: 'status-draft', pending: 'status-pending', partial: 'status-partial', paid: 'status-paid', cancelled: 'status-cancelled' };
    $('#invoicesTableBody').innerHTML = rows.map((invoice) => `<tr>
      <td><span class="table-main-text">${escapeHTML(invoice.number)}</span>${invoice.description ? `<span class="table-sub-text">${escapeHTML(invoice.description)}</span>` : ''}</td>
      <td>${escapeHTML(invoice.party)}</td><td>${dateFormat(invoice.date)}</td><td>${dateFormat(invoice.dueDate)}</td>
      <td class="text-end table-amount">${money(invoice.amount)}</td><td><span class="status-pill ${statusClasses[invoice.status] || 'status-draft'}">${statusLabels[invoice.status] || 'Borrador'}</span>${invoice.status === 'partial' ? `<span class="table-sub-text">Restan ${money(outstanding(invoice))}</span>` : ''}</td>
      <td><div class="table-actions"><button class="icon-action" type="button" title="Editar nota" aria-label="Editar nota" data-edit-invoice="${escapeHTML(invoice.id)}"><i class="bi bi-pencil"></i></button>${['pending', 'partial'].includes(invoice.status) ? `<button class="icon-action" type="button" title="Marcar pagada" aria-label="Marcar nota pagada" data-pay-invoice="${escapeHTML(invoice.id)}"><i class="bi bi-check2-circle"></i></button>` : ''}<button class="icon-action danger" type="button" title="Eliminar" aria-label="Eliminar nota" data-delete-invoice="${escapeHTML(invoice.id)}"><i class="bi bi-trash3"></i></button></div></td>
    </tr>`).join('');
    $('#invoiceResultCount').textContent = `Mostrando ${rows.length} de ${activeInvoiceTab === 'issued' ? issued.length : received.length} notas`;
    $('#invoicesEmpty').classList.toggle('d-none', rows.length > 0);
    updateCounters();
  }

  function openInvoiceModal(id = '', direction = activeInvoiceTab) {
    $('#invoiceForm').reset();
    $('#invoiceId').value = '';
    $('#invoiceDate').value = todayISO();
    $('#invoiceDueDate').value = todayISO();
    $('#invoicePaidAmount').value = 0;
    const invoice = id ? state.invoices.find((item) => item.id === id) : null;
    if (invoice) {
      $('#invoiceModalTitle').textContent = 'Editar nota';
      $('#invoiceId').value = invoice.id;
      $('#invoiceDirection').value = invoice.direction;
      $('#invoiceNumber').value = invoice.number;
      $('#invoiceParty').value = invoice.party;
      $('#invoiceStatus').value = invoice.status;
      $('#invoiceDate').value = invoice.date;
      $('#invoiceDueDate').value = invoice.dueDate || '';
      $('#invoiceAmount').value = invoice.amount;
      $('#invoicePaidAmount').value = invoice.paidAmount || 0;
      $('#invoiceDescription').value = invoice.description || '';
    } else {
      $('#invoiceModalTitle').textContent = 'Nueva nota';
      $('#invoiceDirection').value = direction;
      $('#invoiceNumber').value = nextInvoiceNumber(direction);
    }
    invoiceModal.show();
  }
  function nextInvoiceNumber(direction) {
    const prefix = direction === 'issued' ? 'NV-' : 'NC-';
    const numbers = state.invoices.filter((item) => item.direction === direction).map((item) => Number(item.number.split('-').pop()) || 0);
    return prefix + String(Math.max(0, ...numbers) + 1).padStart(6, '0');
  }

  function renderEmployees() {
    const employees = state.employees || []; const payments = state.employeePayments || [];
    const active = employees.filter((employee) => employee.active !== false); const month = monthISO();
    const payroll = payments.filter((payment) => payment.date?.startsWith(month)).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    $('#employeeCount').textContent = active.length; $('#employeePayrollTotal').textContent = money(payroll); $('#employeePaymentsCount').textContent = payments.length;
    $('#employeesTableBody').innerHTML = employees.map((employee) => `<tr><td><span class="table-main-text">${escapeHTML(employee.name)}</span><span class="table-sub-text">${escapeHTML(employee.phone || 'Sin teléfono')}</span></td><td>${escapeHTML(employee.position || '—')}</td><td class="table-amount">${money(employee.salary || 0)}</td><td>${employee.frequency === 'daily' ? 'Diario' : 'Mensual'}</td><td><span class="status-pill ${employee.active === false ? 'status-cancelled' : 'status-paid'}">${employee.active === false ? 'Inactivo' : 'Activo'}</span></td><td><div class="table-actions"><button class="icon-action" type="button" data-pay-employee="${escapeHTML(employee.id)}" title="Registrar pago"><i class="bi bi-cash-coin"></i></button><button class="icon-action" data-edit-employee="${escapeHTML(employee.id)}" title="Editar empleado"><i class="bi bi-pencil"></i></button><button class="icon-action" type="button" data-toggle-employee="${escapeHTML(employee.id)}" data-active="${employee.active === false ? 'false' : 'true'}" title="${employee.active === false ? 'Activar' : 'Desactivar'}"><i class="bi ${employee.active === false ? 'bi-person-check' : 'bi-person-x'}"></i></button></div></td></tr>`).join('') || '<tr><td colspan="6" class="text-center text-muted py-4">Todavía no hay empleados registrados.</td></tr>';
    $('#employeePaymentsTableBody').innerHTML = [...payments].sort((a,b) => String(b.date).localeCompare(String(a.date))).slice(0,100).map((payment) => `<tr><td>${dateFormat(payment.date)}</td><td>${escapeHTML(payment.employeeName)}</td><td>${escapeHTML(payment.period || 'Pago')}</td><td>${escapeHTML(payment.method || '—')}</td><td class="text-end table-amount">${money(payment.amount)}</td></tr>`).join('') || '<tr><td colspan="5" class="text-center text-muted py-4">Todavía no hay pagos registrados.</td></tr>';
  }

  function renderAdminPanel() {
    if (!$('#adminUserCount')) return;
    $('#adminUserCount').textContent = cloudUsers.length; $('#adminEmployeeCount').textContent = (state.employees || []).filter((employee) => employee.active !== false).length;
    $('#adminMovementCount').textContent = (state.movements || []).length; $('#adminLastSync').textContent = cloudUpdatedAt ? new Date(cloudUpdatedAt).toLocaleString('es-PY') : 'Pendiente';
  }

  function exportAdminBackup() {
    const backup = { application: 'Panadería Andino', exportedAt: new Date().toISOString(), data: cloudPayload() };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `respaldo-panaderia-andino-${todayISO()}.json`; link.click(); URL.revokeObjectURL(url); notify('Copia de seguridad descargada en este dispositivo.');
  }

  function renderSettings() {
    $('#businessName').value = state.business.name || '';
    $('#businessAddress').value = state.business.address || '';
    $('#businessPhone').value = state.business.phone || '';
    $('#businessEmail').value = state.business.email || '';
    $('#businessRuc').value = state.business.ruc || '';
    $('#businessOwner').value = state.business.owner || '';
    $('#businessPreviewName').textContent = state.business.name || 'Nombre del negocio';
    $('#businessPreviewAddress').textContent = state.business.address || 'Dirección de tu negocio';
    $('#businessPreviewPhone').textContent = state.business.phone || 'Teléfono';
    $('#businessPreviewEmail').textContent = state.business.email || 'Correo electrónico';
    $('#footerBusinessName').textContent = state.business.name || 'Panadería Andino';
    const logoPreview = $('#businessLogoPreview');
    logoPreview.innerHTML = state.business.logo ? `<img src="${state.business.logo}" alt="Logo del negocio">` : '<i class="bi bi-basket2-fill"></i><span>ANDINO</span>';
    $('#incomeCategoriesList').innerHTML = renderCategoryItems('income');
    $('#expenseCategoriesList').innerHTML = renderCategoryItems('expense');
    $('#paymentMethodsList').innerHTML = state.paymentMethods.map((method) => `<div class="payment-method-item"><i class="bi bi-credit-card-2-front"></i><span>${escapeHTML(method)}</span><button type="button" class="mini-delete" title="Eliminar método" aria-label="Eliminar método" data-delete-payment="${escapeHTML(method)}"><i class="bi bi-trash3"></i></button></div>`).join('') || '<div class="empty-inline">No hay métodos de pago.</div>';
    $('#usersTableBody').innerHTML = cloudUsers.map((user) => {
      const roleLabel = user.role === 'admin' ? 'Administrador' : (user.role === 'supervisor' ? 'Supervisor' : 'Empleado');
      const actions = user.role === 'admin' ? '<span class="table-sub-text">Cuenta principal</span>' : `<button class="icon-action" type="button" title="${user.active ? 'Desactivar' : 'Activar'} usuario" aria-label="${user.active ? 'Desactivar' : 'Activar'} usuario" data-toggle-user="${escapeHTML(user.id)}" data-active="${user.active ? 'true' : 'false'}"><i class="bi ${user.active ? 'bi-person-check' : 'bi-person-x'}"></i></button><button class="icon-action danger" type="button" title="Eliminar usuario" aria-label="Eliminar usuario" data-delete-user="${escapeHTML(user.id)}"><i class="bi bi-trash3"></i></button>`;
      return `<tr><td><span class="table-main-text">${escapeHTML(user.name)}</span></td><td>${escapeHTML(user.email)}</td><td>${roleLabel}</td><td><span class="status-pill ${user.active ? 'status-paid' : 'status-cancelled'}">${user.active ? 'Activo' : 'Inactivo'}</span></td><td><div class="table-actions">${actions}</div></td></tr>`;
    }).join('') || '<tr><td colspan="5" class="text-center text-muted py-4">No hay usuarios registrados.</td></tr>';
    $('#prefDateFormat').value = state.preferences.dateFormat || 'es-PY';
    $('#prefInvoiceAlerts').checked = state.preferences.invoiceAlerts !== false;
    $('#prefConfirmDelete').checked = state.preferences.confirmDelete !== false;
  }
  function renderCategoryItems(type) {
    const categories = state.categories[type] || [];
    if (!categories.length) return '<div class="empty-inline">No hay categorías registradas.</div>';
    return categories.map((category) => `<div class="category-item"><i class="bi ${type === 'income' ? 'bi-check-circle-fill' : 'bi-check-circle-fill'}"></i><span>${escapeHTML(category)}</span><small>${type === 'income' ? 'Ingreso' : 'Gasto'}</small><button type="button" class="mini-delete" title="Eliminar categoría" aria-label="Eliminar categoría" data-delete-category="${escapeHTML(category)}" data-category-type="${type}"><i class="bi bi-trash3"></i></button></div>`).join('');
  }

  function openSimpleModal(mode, data = {}) {
    simpleModalMode = mode; simpleModalData = data;
    const fields = $('#simpleModalFields');
    if (mode === 'category') {
      $('#simpleModalTitle').textContent = data.type === 'income' ? 'Nueva categoría de ingreso' : 'Nueva categoría de gasto';
      fields.innerHTML = `<div class="simple-modal-field"><label for="simpleName">Nombre de la categoría</label><input id="simpleName" name="name" maxlength="50" required placeholder="Ej. Ventas por delivery"></div>`;
    } else if (mode === 'payment') {
      $('#simpleModalTitle').textContent = 'Nuevo método de pago';
      fields.innerHTML = '<div class="simple-modal-field"><label for="simpleName">Nombre del método</label><input id="simpleName" name="name" maxlength="40" required placeholder="Ej. Billetera electrónica"></div>';
    } else if (mode === 'employee') {
      $('#simpleModalTitle').textContent = 'Agregar empleado';
      const employee = (state.employees || []).find((item) => item.id === data.employeeId) || {};
      $('#simpleModalTitle').textContent = data.employeeId ? 'Editar empleado' : 'Agregar empleado';
      fields.innerHTML = `<div class="simple-modal-field"><label for="simpleName">Nombre y apellido</label><input id="simpleName" required maxlength="90" value="${escapeHTML(employee.name || '')}" placeholder="Nombre completo"></div><div class="simple-modal-field"><label for="employeePosition">Cargo</label><input id="employeePosition" maxlength="70" value="${escapeHTML(employee.position || '')}" placeholder="Panadero, vendedor, cajero..."></div><div class="simple-modal-field"><label for="employeePhone">Teléfono</label><input id="employeePhone" maxlength="30" value="${escapeHTML(employee.phone || '')}" placeholder="Número de contacto"></div><div class="simple-modal-field"><label for="employeeSalary">Salario o jornal (Gs.)</label><input id="employeeSalary" type="number" min="0" step="1" required value="${Number(employee.salary || 0)}" placeholder="0"></div><div class="simple-modal-field"><label for="employeeFrequency">Frecuencia</label><select id="employeeFrequency"><option value="monthly" ${employee.frequency !== 'daily' ? 'selected' : ''}>Mensual</option><option value="daily" ${employee.frequency === 'daily' ? 'selected' : ''}>Diario</option></select></div>`;
    } else if (mode === 'employee-payment') {
      $('#simpleModalTitle').textContent = 'Registrar pago a empleado';
      const employeeOptions = (state.employees || []).filter((employee) => employee.active !== false).map((employee) => `<option value="${escapeHTML(employee.id)}">${escapeHTML(employee.name)}</option>`).join('');
      fields.innerHTML = `<div class="simple-modal-field"><label for="paymentEmployee">Empleado</label><select id="paymentEmployee" required>${employeeOptions}</select></div><div class="simple-modal-field"><label for="employeePaymentAmount">Importe (Gs.)</label><input id="employeePaymentAmount" type="number" min="1" step="1" required></div><div class="simple-modal-field"><label for="employeePaymentDate">Fecha de pago</label><input id="employeePaymentDate" type="date" value="${todayISO()}" required></div><div class="simple-modal-field"><label for="employeePaymentMethod">Método de pago</label><select id="employeePaymentMethod">${paymentOptions()}</select></div><div class="simple-modal-field"><label for="employeePaymentPeriod">Concepto</label><input id="employeePaymentPeriod" maxlength="80" value="Pago de salario" required></div>`;
      if (data.employeeId) fields.querySelector('#paymentEmployee').value = data.employeeId;
      const employeeSelect = fields.querySelector('#paymentEmployee'); const amountInput = fields.querySelector('#employeePaymentAmount');
      const setDefaultAmount = () => { const employee = (state.employees || []).find((item) => item.id === employeeSelect.value); if (employee && !amountInput.value) amountInput.value = employee.salary || ''; };
      employeeSelect.addEventListener('change', () => { amountInput.value = ''; setDefaultAmount(); }); setDefaultAmount();
    } else if (mode === 'user') {
      $('#simpleModalTitle').textContent = 'Agregar usuario';
      fields.innerHTML = '<div class="simple-modal-field"><label for="simpleName">Nombre</label><input id="simpleName" name="name" maxlength="70" required placeholder="Nombre y apellido"></div><div class="simple-modal-field"><label for="simpleEmail">Correo electrónico</label><input id="simpleEmail" name="email" type="email" maxlength="100" required placeholder="usuario@correo.com"></div><div class="simple-modal-field"><label for="simplePassword">Contraseña inicial</label><input id="simplePassword" name="password" type="password" minlength="12" autocomplete="new-password" required placeholder="Mínimo 12 caracteres"></div><div class="simple-modal-field"><label for="simpleRole">Rol</label><select id="simpleRole" name="role"><option value="employee">Empleado</option><option value="supervisor">Supervisor</option></select></div><small class="text-muted">Los usuarios creados no pueden administrar ni crear otras cuentas.</small>';
    }
    simpleModal.show();
  }

  // Navegación principal
  $$('[data-page-link]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); pageNavigate(link.dataset.pageLink); }));
  $$('[data-go-page]').forEach((button) => button.addEventListener('click', () => pageNavigate(button.dataset.goPage)));
  $('#menuToggle').addEventListener('click', () => {
    const open = $('#sidebar').classList.toggle('open');
    $('#sidebarBackdrop').classList.toggle('show', open);
    $('#menuToggle').setAttribute('aria-expanded', String(open));
  });
  $('#sidebarBackdrop').addEventListener('click', () => {
    $('#sidebar').classList.remove('open'); $('#sidebarBackdrop').classList.remove('show'); $('#menuToggle').setAttribute('aria-expanded', 'false');
  });
  $('#logoutButton').addEventListener('click', () => window.PanaderiaAuth?.logout());

  // Formularios de movimientos
  $$('[data-open-movement]').forEach((button) => button.addEventListener('click', () => openMovementModal(button.dataset.openMovement)));
  $$('.type-option').forEach((button) => button.addEventListener('click', () => setMovementType(button.dataset.type)));
  $('#movementForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const id = $('#movementId').value;
    const description = $('#movementDescription').value.trim();
    const amount = Number($('#movementAmount').value);
    const date = $('#movementDate').value;
    const type = $('#movementType').value;
    if (!description || !Number.isFinite(amount) || amount <= 0 || !date) { notify('Completá todos los campos obligatorios con valores válidos.'); return; }
    const record = { id: id || makeId(), description, amount, date, type, category: $('#movementCategory').value, payment: $('#movementPayment').value, note: $('#movementNote').value.trim() };
    if (id) state.movements = state.movements.map((item) => item.id === id ? record : item);
    else state.movements.push(record);
    saveState(); movementModal.hide(); renderDashboard(); renderMovements(); notify(id ? 'Movimiento actualizado correctamente.' : 'Movimiento registrado correctamente.');
  });
  $('#movementSearch').addEventListener('input', renderMovements);
  ['movementTypeFilter', 'movementCategoryFilter', 'movementStartDate', 'movementEndDate'].forEach((id) => $(`#${id}`).addEventListener('change', () => { if (id === 'movementTypeFilter') refreshMovementFilters(); renderMovements(); }));
  $('#clearMovementFilters').addEventListener('click', () => { $('#movementSearch').value = ''; $('#movementTypeFilter').value = 'all'; $('#movementCategoryFilter').value = 'all'; $('#movementStartDate').value = ''; $('#movementEndDate').value = ''; renderMovements(); });
  $('#movementsTableBody').addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit-movement]');
    const remove = event.target.closest('[data-delete-movement]');
    if (edit) openMovementModal('income', edit.dataset.editMovement);
    if (remove) {
      const id = remove.dataset.deleteMovement;
      if (!confirmDelete('¿Eliminar este movimiento? Esta acción no se puede deshacer.')) return;
      state.movements = state.movements.filter((item) => item.id !== id); saveState(); renderDashboard(); renderMovements(); notify('Movimiento eliminado.');
    }
  });
  $('#exportMovements').addEventListener('click', () => {
    const rows = [...$('#movementsTableBody').querySelectorAll('tr')];
    if (!rows.length) { notify('No hay movimientos para exportar con los filtros actuales.'); return; }
    const search = $('#movementSearch').value.trim().toLowerCase();
    const type = $('#movementTypeFilter').value; const category = $('#movementCategoryFilter').value;
    const from = $('#movementStartDate').value; const to = $('#movementEndDate').value;
    const filtered = state.movements.filter((item) => (!search || `${item.description} ${item.category} ${item.note || ''}`.toLowerCase().includes(search)) && (type === 'all' || item.type === type) && (category === 'all' || item.category === category) && (!from || item.date >= from) && (!to || item.date <= to));
    const csv = [['Fecha', 'Descripción', 'Categoría', 'Tipo', 'Método de pago', 'Importe', 'Observación'], ...filtered.map((item) => [item.date, item.description, item.category, item.type === 'income' ? 'Ingreso' : 'Gasto', item.payment, item.amount, item.note || ''])]
      .map((line) => line.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `movimientos-panaderia-andino-${todayISO()}.csv`; link.click(); URL.revokeObjectURL(url); notify('Archivo CSV generado.');
  });

  // Notas
  $('#newInvoiceButton').addEventListener('click', () => openInvoiceModal());
  $$('.invoice-tab').forEach((tab) => tab.addEventListener('click', () => { activeInvoiceTab = tab.dataset.invoiceTab; $('#invoiceSearch').value = ''; $('#invoiceStatusFilter').value = 'all'; renderInvoices(); }));
  $('#invoiceSearch').addEventListener('input', renderInvoices);
  $('#invoiceStatusFilter').addEventListener('change', renderInvoices);
  $('#invoiceForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const id = $('#invoiceId').value;
    const amount = Number($('#invoiceAmount').value);
    const paidAmount = Number($('#invoicePaidAmount').value || 0);
    if (!$('#invoiceNumber').value.trim() || !$('#invoiceParty').value.trim() || !$('#invoiceDate').value || amount <= 0 || paidAmount < 0 || paidAmount > amount) {
      notify('Revisá los datos. El monto pagado no puede superar el total de la nota.'); return;
    }
    let status = $('#invoiceStatus').value;
    if (paidAmount >= amount) status = 'paid';
    else if (paidAmount > 0 && status === 'pending') status = 'partial';
    const invoice = { id: id || makeId(), direction: $('#invoiceDirection').value, number: $('#invoiceNumber').value.trim(), party: $('#invoiceParty').value.trim(), status, date: $('#invoiceDate').value, dueDate: $('#invoiceDueDate').value, amount, paidAmount, description: $('#invoiceDescription').value.trim() };
    const duplicate = state.invoices.some((item) => item.id !== id && item.direction === invoice.direction && item.number.toLowerCase() === invoice.number.toLowerCase());
    if (duplicate) { notify('Ya existe una nota con ese número en esta lista.'); return; }
    if (id) state.invoices = state.invoices.map((item) => item.id === id ? invoice : item);
    else state.invoices.push(invoice);
    activeInvoiceTab = invoice.direction; saveState(); invoiceModal.hide(); renderInvoices(); renderDashboard(); notify(id ? 'Nota actualizada correctamente.' : 'Nota registrada correctamente.');
  });
  $('#invoicesTableBody').addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit-invoice]');
    const pay = event.target.closest('[data-pay-invoice]');
    const remove = event.target.closest('[data-delete-invoice]');
    if (edit) openInvoiceModal(edit.dataset.editInvoice);
    if (pay) {
      const id = pay.dataset.payInvoice;
      state.invoices = state.invoices.map((invoice) => invoice.id === id ? { ...invoice, paidAmount: invoice.amount, status: 'paid' } : invoice);
      saveState(); renderInvoices(); renderDashboard(); notify('Nota marcada como pagada.');
    }
    if (remove) {
      const id = remove.dataset.deleteInvoice;
      if (!confirmDelete('¿Eliminar esta nota? Esta acción no se puede deshacer.')) return;
      state.invoices = state.invoices.filter((invoice) => invoice.id !== id); saveState(); renderInvoices(); renderDashboard(); notify('Nota eliminada.');
    }
  });

  // Configuración y mantenimiento
  $$('.settings-tab').forEach((tab) => tab.addEventListener('click', () => {
    const target = tab.dataset.settingsTab;
    $$('.settings-tab').forEach((item) => item.classList.toggle('active', item === tab));
    $$('[data-settings-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.settingsPanel === target));
  }));
  $('#businessForm').addEventListener('submit', (event) => {
    event.preventDefault();
    state.business = { ...state.business, name: $('#businessName').value.trim(), address: $('#businessAddress').value.trim(), phone: $('#businessPhone').value.trim(), email: $('#businessEmail').value.trim(), ruc: $('#businessRuc').value.trim(), owner: $('#businessOwner').value.trim() };
    saveState(); renderSettings(); updateCounters(); notify('Datos del negocio guardados.');
  });
  $('#businessLogo').addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { notify('Seleccioná un archivo de imagen válido.'); return; }
    if (file.size > 1024 * 1024) { notify('El logo debe pesar menos de 1 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => { state.business.logo = String(reader.result); saveState(); renderSettings(); notify('Logo actualizado.'); };
    reader.onerror = () => notify('No se pudo leer la imagen seleccionada.');
    reader.readAsDataURL(file);
  });
  $$('[data-add-category]').forEach((button) => button.addEventListener('click', () => openSimpleModal('category', { type: button.dataset.addCategory })));
  $('#addPaymentMethod').addEventListener('click', () => openSimpleModal('payment'));
  $('#addUserButton').addEventListener('click', () => openSimpleModal('user'));
  $('#addEmployeeButton').addEventListener('click', () => openSimpleModal('employee'));
  $('#payEmployeeButton').addEventListener('click', () => { if (!(state.employees || []).some((employee) => employee.active !== false)) { notify('Primero registrá un empleado activo.'); return; } openSimpleModal('employee-payment'); });
  $('#employeesTableBody').addEventListener('click', (event) => {
    const pay = event.target.closest('[data-pay-employee]'); const edit = event.target.closest('[data-edit-employee]'); const toggle = event.target.closest('[data-toggle-employee]');
    if (pay) openSimpleModal('employee-payment', { employeeId: pay.dataset.payEmployee });
    if (edit) openSimpleModal('employee', { employeeId: edit.dataset.editEmployee });
    if (toggle) { const id = toggle.dataset.toggleEmployee; state.employees = state.employees.map((employee) => employee.id === id ? { ...employee, active: employee.active === false } : employee); saveState(); renderEmployees(); renderAdminPanel(); notify('Estado del empleado actualizado.'); }
  });
  $('#adminBackupButton').addEventListener('click', exportAdminBackup);
  $('#adminManageUsers').addEventListener('click', () => { pageNavigate('configuracion'); const tab = $('[data-settings-tab="users"]'); if (tab) tab.click(); });
  $('#simpleForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#simpleName')?.value.trim();
    if (!name && simpleModalMode !== 'employee-payment') return;
    if (simpleModalMode === 'employee') {
      const salary = Number($('#employeeSalary').value || 0); if (!Number.isFinite(salary) || salary < 0) { notify('Ingresá un salario válido.'); return; }
      state.employees = state.employees || [];
      const employeeData = { name, position: $('#employeePosition').value.trim(), phone: $('#employeePhone').value.trim(), salary, frequency: $('#employeeFrequency').value };
      if (simpleModalData.employeeId) state.employees = state.employees.map((employee) => employee.id === simpleModalData.employeeId ? { ...employee, ...employeeData, updatedAt: new Date().toISOString() } : employee);
      else state.employees.push({ id: makeId(), ...employeeData, active: true, createdAt: new Date().toISOString() });
      saveState(); simpleModal.hide(); renderEmployees(); renderAdminPanel(); notify(simpleModalData.employeeId ? 'Empleado actualizado correctamente.' : 'Empleado registrado correctamente.'); return;
    } else if (simpleModalMode === 'employee-payment') {
      const employee = (state.employees || []).find((item) => item.id === $('#paymentEmployee').value); const amount = Number($('#employeePaymentAmount').value); const date = $('#employeePaymentDate').value;
      if (!employee || !Number.isFinite(amount) || amount <= 0 || !date) { notify('Completá los datos del pago.'); return; }
      const paymentId = makeId(); const method = $('#employeePaymentMethod').value; const period = $('#employeePaymentPeriod').value.trim() || 'Pago de salario';
      state.employeePayments = state.employeePayments || []; state.employeePayments.push({ id: paymentId, employeeId: employee.id, employeeName: employee.name, amount, date, method, period, createdAt: new Date().toISOString() });
      state.movements.push({ id: makeId(), description: `Pago a ${employee.name}`, amount, date, type: 'expense', category: 'Salarios', payment: method, note: period, employeePaymentId: paymentId });
      saveState(); simpleModal.hide(); renderEmployees(); renderDashboard(); renderMovements(); renderAdminPanel(); notify('Pago registrado y contabilizado como gasto.'); return;
    } else if (simpleModalMode === 'category') {
      const inferredType = $('#simpleModalTitle').textContent.toLowerCase().includes('ingreso') ? 'income' : 'expense';
      const target = state.categories[inferredType];
      if (target.some((item) => item.toLowerCase() === name.toLowerCase())) { notify('Esa categoría ya existe.'); return; }
      target.push(name);
    } else if (simpleModalMode === 'payment') {
      if (state.paymentMethods.some((item) => item.toLowerCase() === name.toLowerCase())) { notify('Ese método de pago ya existe.'); return; }
      state.paymentMethods.push(name);
    } else if (simpleModalMode === 'user') {
      try {
        await window.PanaderiaAuth.api('/api/admin/users', { method: 'POST', body: JSON.stringify({ name, email: $('#simpleEmail').value.trim(), password: $('#simplePassword').value, role: $('#simpleRole').value }) });
        simpleModal.hide();
        await refreshCloudUsers();
        notify('Usuario creado. Ya puede iniciar sesión con sus credenciales.');
      } catch (error) { notify(error.message); }
      return;
    }
    saveState(); simpleModal.hide(); renderSettings(); notify('Información agregada correctamente.');
  });
  $('#settings-categories').addEventListener('click', (event) => {
    const remove = event.target.closest('[data-delete-category]');
    if (!remove) return;
    const name = remove.dataset.deleteCategory; const type = remove.dataset.categoryType;
    if (!confirmDelete(`¿Eliminar la categoría "${name}"?`)) return;
    state.categories[type] = state.categories[type].filter((item) => item !== name); saveState(); renderSettings(); refreshMovementFilters(); notify('Categoría eliminada. Los movimientos anteriores conservan su categoría.');
  });
  $('#paymentMethodsList').addEventListener('click', (event) => {
    const remove = event.target.closest('[data-delete-payment]');
    if (!remove) return;
    const name = remove.dataset.deletePayment;
    if (!confirmDelete(`¿Eliminar el método de pago "${name}"?`)) return;
    state.paymentMethods = state.paymentMethods.filter((item) => item !== name); saveState(); renderSettings(); notify('Método de pago eliminado.');
  });
  $('#usersTableBody').addEventListener('click', async (event) => {
    const remove = event.target.closest('[data-delete-user]');
    const toggle = event.target.closest('[data-toggle-user]');
    try {
      if (toggle) {
        const active = toggle.dataset.active !== 'true';
        await window.PanaderiaAuth.api('/api/admin/users', { method: 'PATCH', body: JSON.stringify({ id: toggle.dataset.toggleUser, active }) });
        await refreshCloudUsers();
        notify(active ? 'Usuario activado.' : 'Usuario desactivado.');
      } else if (remove) {
        if (!confirmDelete('¿Eliminar definitivamente este usuario?')) return;
        await window.PanaderiaAuth.api('/api/admin/users', { method: 'DELETE', body: JSON.stringify({ id: remove.dataset.deleteUser }) });
        await refreshCloudUsers();
        notify('Usuario eliminado.');
      }
    } catch (error) { notify(error.message); }
  });
  $('#preferencesForm').addEventListener('submit', (event) => {
    event.preventDefault();
    state.preferences = { ...state.preferences, dateFormat: $('#prefDateFormat').value, invoiceAlerts: $('#prefInvoiceAlerts').checked, confirmDelete: $('#prefConfirmDelete').checked };
    saveState(); renderDashboard(); renderMovements(); renderInvoices(); notify('Preferencias guardadas.');
  });
  $('#resetDemoData').hidden = true;
  $('#resetDemoData').addEventListener('click', () => {
    if (!window.confirm('Esto reemplazará todos los movimientos, notas y ajustes por los datos de ejemplo. ¿Continuar?')) return;
    notify('La carga de datos de demostración está deshabilitada para proteger la información real.');
  });

  // Período principal
  monthFilter.addEventListener('change', () => {
    if (!monthFilter.value) return;
    renderDashboard();
    const [year, month] = monthFilter.value.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    $('#movementStartDate').value = `${year}-${String(month).padStart(2, '0')}-01`;
    $('#movementEndDate').value = monthFilter.value === monthISO() ? todayISO() : `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
    renderMovements();
    notify(`Resumen actualizado: ${monthName(monthFilter.value)}.`);
  });

  function renderAll() {
    renderDashboard(); renderMovements(); renderInvoices(); renderEmployees(); renderAdminPanel(); renderSettings(); updateCounters();
  }

  async function refreshCloudUsers() {
    if (window.PanaderiaAuth?.user?.role !== 'admin') { cloudUsers = []; renderSettings(); return; }
    const result = await window.PanaderiaAuth.api('/api/admin/users');
    cloudUsers = result.users || [];
    renderSettings(); renderAdminPanel();
  }

  async function refreshCloudData() {
    if (!window.PanaderiaAuth?.user || !cloudReady || cloudSaving || cloudSaveTimer) return;
    try { const result = await window.PanaderiaAuth.api('/api/data');
      if (result.data && result.updatedAt && result.updatedAt !== cloudUpdatedAt) { state = { ...createEmptyState(), ...result.data }; delete state.users; cloudUpdatedAt = result.updatedAt; saveState(false); renderAll(); }
    } catch (error) { console.warn('Sincronización pendiente:', error.message); }
  }

  async function hydrateCloudData() {
    if (!window.PanaderiaAuth?.user) return;
    try {
      const result = await window.PanaderiaAuth.api('/api/data');
      if (result.data) { state = { ...createEmptyState(), ...result.data }; cloudUpdatedAt = result.updatedAt || null; }
      else { const saved = await window.PanaderiaAuth.api('/api/data', { method: 'PUT', body: JSON.stringify({ data: cloudPayload() }) }); cloudUpdatedAt = saved.updatedAt || null; }
      delete state.users; cloudReady = true; saveState(false); renderAll(); await refreshCloudUsers();
      if (cloudSyncInterval) clearInterval(cloudSyncInterval); cloudSyncInterval = setInterval(refreshCloudData, 10000);
    } catch (error) { console.error('No se pudo cargar el espacio compartido.', error); notify('No se pudieron cargar los datos compartidos. Recargá la página.'); }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshCloudData(); });
  window.addEventListener('panaderia:authenticated', hydrateCloudData);
  // La hidratación se inicia una sola vez mediante el evento panaderia:authenticated.

  // Valores iniciales de filtros y navegación solicitada por URL
  const initialMonth = monthFilter.value;
  const [initialYear, initialMonthNumber] = initialMonth.split('-').map(Number);
  $('#movementStartDate').value = `${initialYear}-${String(initialMonthNumber).padStart(2, '0')}-01`;
  $('#movementEndDate').value = todayISO();
  setInterval(updateGreeting, 60000);
  renderAll();
  const hashPage = window.location.hash.replace('#', '');
  if (['dashboard', 'movimientos', 'notas', 'empleados', 'administracion', 'configuracion'].includes(hashPage)) pageNavigate(hashPage);
})();
