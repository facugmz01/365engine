// API Prefix
const API_BASE = '/api/v1';

const state = {
    token: localStorage.getItem('token') || null,
    role: localStorage.getItem('role') || null,
    username: localStorage.getItem('username') || 'admin',
    organizations: [],
    templates: [],
    jobs: [],
    users: [],
    auditLogs: [],
    groupDefinitions: [], // Array of { id, display_name, group_type, membership_rule }
    libraryFilter: 'all',
    deployFilter: 'all',
    packages: [],
    pkgFilter: 'all'
};

// ==========================================
// TOAST NOTIFICATIONS
// ==========================================
function showToast(message, isError = false) {
    const toast = document.getElementById('notification-toast');
    const toastMsg = toast.querySelector('.toast-message');
    toastMsg.textContent = message;
    
    if (isError) {
        toast.style.borderLeftColor = 'var(--color-error)';
    } else {
        toast.style.borderLeftColor = 'var(--neon-cyan)';
    }
    
    toast.classList.remove('hidden');
    
    // Auto hide after 4 seconds
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 4000);
}

document.querySelector('.toast-close').addEventListener('click', () => {
    document.getElementById('notification-toast').classList.add('hidden');
});

// ==========================================
// AUTHENTICATION HEADERS
// ==========================================
function getHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
    };
}

// ==========================================
// VIEWS & ROUTING SWITCHER
// ==========================================
function initView() {
    const loginView = document.getElementById('login-view');
    const dashboardView = document.getElementById('dashboard-view');
    
    if (state.token) {
        loginView.classList.add('hidden');
        loginView.classList.remove('active');
        dashboardView.classList.remove('hidden');
        dashboardView.classList.add('active');
        
        document.getElementById('user-display').textContent = state.username;
        document.getElementById('role-display').textContent = state.role ? state.role.toUpperCase() : 'UNKNOWN';

        // RBAC UI updates
        const adminElements = document.querySelectorAll('.admin-only');
        if (state.role === 'super_admin') {
            adminElements.forEach(el => el.classList.remove('hidden'));
        } else {
            adminElements.forEach(el => el.classList.add('hidden'));
            // If they are on an admin tab, redirect to tenants
            const activeNav = document.querySelector('.nav-link.active');
            if(activeNav && ['usuarios', 'auditoria'].includes(activeNav.dataset.tab)) {
                 switchTab('tenants');
            }
        }

        // Change submit button text for Deployers vs Approvers/Admins
        const btnDeploy = document.getElementById('btn-submit-deployment');
        if (btnDeploy) {
            if (state.role === 'deployer') {
                btnDeploy.innerHTML = '<i class="fa-solid fa-paper-plane"></i> <span>Solicitar Despliegue</span>';
            } else {
                btnDeploy.innerHTML = '<i class="fa-solid fa-rocket"></i> <span>Ejecutar Implementación (Directa)</span>';
            }
        }

        // Load initial data
        loadAllData();
    } else {
        dashboardView.classList.add('hidden');
        dashboardView.classList.remove('active');
        loginView.classList.remove('hidden');
        loginView.classList.add('active');
    }
}

// ==========================================
// LOAD ALL BACKEND DATA
// ==========================================
async function loadAllData() {
    const promises = [
        loadOrganizations(),
        loadTemplates(),
        loadPackages(),
        loadJobs()
    ];
    if (state.role === 'super_admin') {
        promises.push(loadUsers(), loadAuditLogs());
    }
    await Promise.all(promises);
}

// ==========================================
// AUTH FLOW
// ==========================================
async function checkSSOConfig() {
    try {
        const res = await fetch(`${API_BASE}/auth/sso/config`);
        if (res.ok) {
            const data = await res.json();
            if (data.enabled) {
                document.getElementById('sso-container').classList.remove('hidden');
            }
        }
    } catch (e) {
        console.error("Failed to fetch SSO config", e);
    }
}
checkSSOConfig();

document.getElementById('btn-sso-login')?.addEventListener('click', async () => {
    try {
        const res = await fetch(`${API_BASE}/auth/sso/login`);
        if (res.ok) {
            const data = await res.json();
            window.location.href = data.auth_url;
        } else {
            showToast('Error al iniciar flujo SSO', true);
        }
    } catch (e) {
        console.error("SSO Error", e);
    }
});
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const usernameInput = document.getElementById('username').value;
    const passwordInput = document.getElementById('password').value;
    const errorAlert = document.getElementById('login-error');
    
    errorAlert.classList.add('hidden');
    
    try {
        const response = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: usernameInput, password: passwordInput })
        });
        
        if (!response.ok) {
            throw new Error('Unauthorized');
        }
        
        const data = await response.json();
        state.token = data.access_token;
        state.role = data.role;
        state.username = data.username;
        localStorage.setItem('token', state.token);
        localStorage.setItem('role', state.role);
        localStorage.setItem('username', state.username);
        showToast('Sesión iniciada correctamente.');
        initView();
    } catch (err) {
        errorAlert.classList.remove('hidden');
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    state.token = null;
    state.role = null;
    state.username = null;
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('username');
    showToast('Sesión cerrada.');
    initView();
});

// Helper to handle unauthorized requests
function handleAPIError(res) {
    if (res.status === 401) {
        state.token = null;
        localStorage.removeItem('token');
        showToast('Sesión expirada o no autorizada.', true);
        initView();
        throw new Error('Unauthorized');
    }
}

// ==========================================
// ORGANIZATIONS / TENANTS
// ==========================================
async function loadOrganizations() {
    try {
        const res = await fetch(`${API_BASE}/organizations`, { headers: getHeaders() });
        handleAPIError(res);
        if (res.ok) {
            state.organizations = await res.json();
            renderOrganizations();
            populateSelectDropdowns();
        }
    } catch (err) {
        console.error('Error loading organizations:', err);
    }
}

function renderOrganizations() {
    const tbody = document.getElementById('tenants-list-tbody');
    tbody.innerHTML = '';
    
    if (state.organizations.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center">No hay tenants registrados.</td></tr>`;
        return;
    }
    
    state.organizations.forEach(org => {
        const hasCreds = org.credentials && org.credentials.length > 0;
        const credBadge = hasCreds 
            ? '<span class="badge badge-success"><i class="fa-solid fa-lock"></i> Configurado</span>'
            : '<span class="badge badge-warning"><i class="fa-solid fa-key"></i> Pendiente</span>';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${org.name}</strong></td>
            <td><code>${org.tenant_id}</code></td>
            <td>${credBadge}</td>
            <td>
                <button class="btn btn-primary btn-sm btn-manage-client" data-id="${org.id}">
                    <i class="fa-solid fa-gear"></i> Administrar Cliente
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    // Add Manage Client events
    document.querySelectorAll('.btn-manage-client').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const orgId = e.currentTarget.getAttribute('data-id');
            loadClientDetails(orgId);
        });
    });
}

// ==========================================
// CLIENT DETAILS VIEW
// ==========================================
let currentDetailOrgId = null;

async function loadClientDetails(orgId) {
    currentDetailOrgId = orgId;
    try {
        const res = await fetch(`${API_BASE}/organizations/${orgId}/details`, { headers: getHeaders() });
        handleAPIError(res);
        if (res.ok) {
            const data = await res.json();
            
            // Ficha Tecnica
            document.getElementById('detail-org-name').textContent = data.name;
            document.getElementById('detail-org-tenant-id').textContent = data.tenant_id;
            document.getElementById('detail-org-creds-badge').innerHTML = data.has_credentials 
                ? '<span class="badge badge-success"><i class="fa-solid fa-lock"></i> Configurado</span>'
                : '<span class="badge badge-warning"><i class="fa-solid fa-key"></i> Pendiente</span>';
            
            document.getElementById('detail-org-id').value = data.id;
            
            // Settings
            document.getElementById('detail-auto-drift-enabled').checked = data.auto_drift_enabled;
            document.getElementById('detail-drift-schedule').value = data.drift_scan_schedule || '';
            
            // Bind action buttons
            const btnCred = document.getElementById('btn-detail-cred');
            const btnTest = document.getElementById('btn-detail-test');
            const btnScan = document.getElementById('btn-detail-scan-manual');
            
            // remove old event listeners to avoid dupes
            const newBtnCred = btnCred.cloneNode(true); btnCred.parentNode.replaceChild(newBtnCred, btnCred);
            const newBtnTest = btnTest.cloneNode(true); btnTest.parentNode.replaceChild(newBtnTest, btnTest);
            const newBtnScan = btnScan.cloneNode(true); btnScan.parentNode.replaceChild(newBtnScan, btnScan);
            
            newBtnCred.addEventListener('click', () => showCredentialsForm(data.id, data.name));
            
            newBtnTest.disabled = !data.has_credentials;
            newBtnTest.addEventListener('click', () => validateTenantReadiness(data.id));
            
            newBtnScan.disabled = !data.has_credentials;
            newBtnScan.addEventListener('click', () => scanDrift(data.id));
            
            // Render Drift History
            const driftTbody = document.getElementById('detail-drift-tbody');
            driftTbody.innerHTML = '';
            if (data.drift_reports.length === 0) {
                driftTbody.innerHTML = '<tr><td colspan="4" class="text-center">No hay reportes de drift.</td></tr>';
            } else {
                data.drift_reports.forEach(r => {
                    const tr = document.createElement('tr');
                    const badge = r.drifts_found > 0 ? '<span class="badge badge-warning">' + r.drifts_found + ' Desviaciones</span>' : '<span class="badge badge-success">OK</span>';
                    const src = r.source === 'automated' ? '<i class="fa-solid fa-robot"></i> Automático' : '<i class="fa-solid fa-user"></i> Manual';
                    tr.innerHTML = `
                        <td>${new Date(r.created_at).toLocaleString()}</td>
                        <td>${src}</td>
                        <td>${badge}</td>
                        <td>
                            <button class="btn btn-sm btn-secondary" onclick='showDriftReportModal(${JSON.stringify(r.details)})'>Ver Reporte</button>
                        </td>
                    `;
                    driftTbody.appendChild(tr);
                });
            }
            
            // Render Jobs
            const jobsTbody = document.getElementById('detail-jobs-tbody');
            jobsTbody.innerHTML = '';
            if (data.deployments.length === 0) {
                jobsTbody.innerHTML = '<tr><td colspan="3" class="text-center">No hay despliegues realizados.</td></tr>';
            } else {
                data.deployments.forEach(j => {
                    jobsTbody.innerHTML += `<tr><td>${j.id}</td><td>${new Date(j.created_at).toLocaleString()}</td><td><span class="badge badge-info">${j.status}</span></td></tr>`;
                });
            }
            
            switchTab('client-details');
        }
    } catch (err) {
        console.error(err);
    }
}

// Drift Settings Save
document.getElementById('drift-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const orgId = document.getElementById('detail-org-id').value;
    const enabled = document.getElementById('detail-auto-drift-enabled').checked;
    const schedule = document.getElementById('detail-drift-schedule').value;
    
    try {
        const res = await fetch(`${API_BASE}/organizations/${orgId}/settings`, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify({
                auto_drift_enabled: enabled,
                drift_scan_schedule: schedule
            })
        });
        handleAPIError(res);
        if (res.ok) {
            showToast('Ajustes de automatización guardados correctamente.');
        } else {
            const err = await res.json();
            showToast(err.detail || 'Error al guardar configuración', true);
        }
    } catch (err) {
        console.error(err);
    }
});

// History Tabs Navigation
document.getElementById('tab-nav-drift').addEventListener('click', (e) => {
    e.target.classList.add('active');
    e.target.style.color = 'var(--text-primary)';
    e.target.style.borderBottom = '2px solid var(--neon-cyan)';
    
    const depTab = document.getElementById('tab-nav-deployments');
    depTab.classList.remove('active');
    depTab.style.color = 'var(--text-secondary)';
    depTab.style.borderBottom = 'none';
    
    document.getElementById('detail-drift-history').classList.remove('hidden');
    document.getElementById('detail-deployments-history').classList.add('hidden');
});

document.getElementById('tab-nav-deployments').addEventListener('click', (e) => {
    e.target.classList.add('active');
    e.target.style.color = 'var(--text-primary)';
    e.target.style.borderBottom = '2px solid var(--neon-cyan)';
    
    const driftTab = document.getElementById('tab-nav-drift');
    driftTab.classList.remove('active');
    driftTab.style.color = 'var(--text-secondary)';
    driftTab.style.borderBottom = 'none';
    
    document.getElementById('detail-deployments-history').classList.remove('hidden');
    document.getElementById('detail-drift-history').classList.add('hidden');
});

// Render the modal directly from JSON details
window.showDriftReportModal = function(details) {
    const driftBody = document.getElementById('drift-body');
    driftBody.innerHTML = '';
    
    const items = details.details || [];
    driftBody.innerHTML = `
        <div style="margin-bottom: 15px;">
            <span style="font-size: 1.2em; color: ${details.drifts_found > 0 ? 'var(--neon-orange)' : 'var(--neon-green)'}">
                ${details.drifts_found} directivas con desviación detectadas.
            </span>
        </div>
        <div style="max-height: 400px; overflow-y: auto;">
            <table class="table" style="font-size:0.9em;">
                <thead><tr><th>Directiva</th><th>Estado</th><th>Detalle</th></tr></thead>
                <tbody>
                    ${items.map(d => `
                        <tr>
                            <td>${d.template_name}</td>
                            <td>
                                ${d.status === 'drift_detected' ? '<span class="badge badge-warning">Modificado Remotamente</span>' : 
                                  d.status === 'missing_remotely' ? '<span class="badge badge-danger">Eliminado Remotamente</span>' : 
                                  '<span class="badge badge-info">' + d.status + '</span>'}
                            </td>
                            <td>
                                ${d.status === 'drift_detected' && d.diff.mismatches ? `<button class="btn btn-sm btn-secondary" onclick="alert('Diferencias encontradas:\\n' + ${JSON.stringify(JSON.stringify(d.diff.mismatches)).replace(/"/g, '&quot;')})">Ver Diff</button>` : d.diff.info || ''}
                            </td>
                        </tr>
                    `).join('')}
                    ${items.length === 0 ? '<tr><td colspan="3" class="text-center">No se encontraron desviaciones.</td></tr>' : ''}
                </tbody>
            </table>
        </div>
    `;
    
    document.getElementById('drift-modal').classList.remove('hidden');
};

async function scanDrift(orgId) {
    showToast('Escaneando drift en el tenant... Esto puede tomar unos segundos.');
    try {
        const res = await fetch(`${API_BASE}/organizations/${orgId}/drift-scan`, {
            method: 'POST',
            headers: getHeaders()
        });
        handleAPIError(res);
        if (res.ok) {
            const data = await res.json();
            
            const driftBody = document.getElementById('drift-body');
            driftBody.innerHTML = '';
            
            const details = data.details || [];
            
            driftBody.innerHTML = `
                <div style="margin-bottom: 15px;">
                    <span style="font-size: 1.2em; color: ${data.drifts_found > 0 ? 'var(--neon-orange)' : 'var(--neon-green)'}">
                        ${data.drifts_found} directivas con desviación detectadas.
                    </span>
                </div>
                <div style="max-height: 400px; overflow-y: auto;">
                    <table class="table" style="font-size:0.9em;">
                        <thead><tr><th>Directiva</th><th>Estado</th><th>Detalle</th></tr></thead>
                        <tbody>
                            ${details.map(d => `
                                <tr>
                                    <td>${d.template_name}</td>
                                    <td>
                                        ${d.status === 'drift_detected' ? '<span class="badge badge-warning">Modificado Remotamente</span>' : 
                                          d.status === 'missing_remotely' ? '<span class="badge badge-danger">Eliminado Remotamente</span>' : 
                                          '<span class="badge badge-info">' + d.status + '</span>'}
                                    </td>
                                    <td>
                                        ${d.status === 'drift_detected' && d.diff.mismatches ? `<button class="btn btn-sm btn-secondary" onclick="alert('Diferencias encontradas:\\n' + ${JSON.stringify(JSON.stringify(d.diff.mismatches))})">Ver Diff</button>` : d.diff.info || ''}
                                    </td>
                                </tr>
                            `).join('')}
                            ${details.length === 0 ? '<tr><td colspan="3" class="text-center">No se encontraron desviaciones.</td></tr>' : ''}
                        </tbody>
                    </table>
                </div>
            `;
            
            document.getElementById('drift-modal').classList.remove('hidden');
        } else {
            const err = await res.json();
            showToast(err.detail || 'Error al ejecutar el escaneo de drift.', true);
        }
    } catch (err) {
        console.error(err);
    }
}

document.getElementById('btn-close-drift')?.addEventListener('click', () => {
    document.getElementById('drift-modal').classList.add('hidden');
});

function showCredentialsForm(orgId, orgName) {
    document.getElementById('cred-org-id').value = orgId;
    document.getElementById('add-cred-modal').classList.remove('hidden');
    document.getElementById('add-cred-title').textContent = `Configurar Credenciales para ${orgName}`;
    document.getElementById('cred-client-id').value = '';
    document.getElementById('cred-client-secret').value = '';
}

// Add Org toggles
document.getElementById('btn-show-add-org').addEventListener('click', () => {
    document.getElementById('add-org-container').classList.remove('hidden');
    document.getElementById('add-cred-container').classList.add('hidden');
    document.getElementById('org-name').value = '';
    document.getElementById('org-tenant-id').value = '';
});

document.getElementById('btn-hide-add-org').addEventListener('click', () => {
    document.getElementById('add-org-container').classList.add('hidden');
});
document.getElementById('btn-cancel-add-org').addEventListener('click', () => {
    document.getElementById('add-org-container').classList.add('hidden');
});

document.getElementById('btn-hide-add-cred').addEventListener('click', () => {
    document.getElementById('add-cred-modal').classList.add('hidden');
});
document.getElementById('btn-cancel-add-cred').addEventListener('click', () => {
    document.getElementById('add-cred-modal').classList.add('hidden');
});

// Forms submissions
document.getElementById('add-org-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('org-name').value;
    const tenant_id = document.getElementById('org-tenant-id').value;
    
    try {
        const res = await fetch(`${API_BASE}/organizations`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ name, tenant_id })
        });
        handleAPIError(res);
        if (res.ok) {
            showToast('Organización registrada exitosamente.');
            document.getElementById('add-org-container').classList.add('hidden');
            loadOrganizations();
        } else {
            const err = await res.json();
            showToast(err.detail || 'Error al registrar organización.', true);
        }
    } catch (err) {
        console.error(err);
    }
});

document.getElementById('add-cred-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const orgId = document.getElementById('cred-org-id').value;
    const client_id = document.getElementById('cred-client-id').value;
    const client_secret = document.getElementById('cred-client-secret').value;
    
    try {
        const res = await fetch(`${API_BASE}/organizations/${orgId}/credentials`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ client_id, client_secret })
        });
        handleAPIError(res);
        if (res.ok) {
            showToast('Credenciales guardadas correctamente');
            document.getElementById('add-cred-modal').classList.add('hidden');
            loadOrganizations();
        } else {
            const err = await res.json();
            showToast(err.detail || 'Error al guardar credenciales.', true);
        }
    } catch (err) {
        console.error(err);
    }
});

// Dropdown utility
function populateSelectDropdowns() {
    const importSelect = document.getElementById('import-org-id');
    const deploySelect = document.getElementById('deploy-org-id');
    
    // Clear
    importSelect.innerHTML = '<option value="">Selecciona organización...</option>';
    deploySelect.innerHTML = '<option value="">Selecciona organización...</option>';
    
    state.organizations.forEach(org => {
        const hasCreds = org.credentials && org.credentials.length > 0;
        const optText = `${org.name} (${org.tenant_id.substring(0, 8)}...)`;
        
        // Append to import only if they have credentials
        if (hasCreds) {
            const optImport = document.createElement('option');
            optImport.value = org.id;
            optImport.textContent = optText;
            importSelect.appendChild(optImport);
        }
        
        const optDeploy = document.createElement('option');
        optDeploy.value = org.id;
        optDeploy.textContent = optText + (!hasCreds ? ' [Sin Creds]' : '');
        optDeploy.disabled = !hasCreds;
        deploySelect.appendChild(optDeploy);
    });
}

// ==========================================
// LIBRARY & BASES
// ==========================================
async function loadTemplates() {
    try {
        const res = await fetch(`${API_BASE}/templates`, { headers: getHeaders() });
        handleAPIError(res);
        if (res.ok) {
            state.templates = await res.json();
            renderTemplates();
            renderDeployTemplateCheckboxes();
        }
    } catch (err) {
        console.error('Error loading templates:', err);
    }
}

function renderTemplates() {
    const tbody = document.getElementById('templates-list-tbody');
    tbody.innerHTML = '';
    
    const filteredTemplates = state.libraryFilter === 'all' 
        ? state.templates 
        : state.templates.filter(t => t.category === state.libraryFilter);
    
    if (filteredTemplates.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center">No hay plantillas que coincidan con los filtros.</td></tr>`;
        return;
    }
    
    filteredTemplates.forEach(t => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${t.name}</strong></td>
            <td><span class="badge badge-category">${t.category.toUpperCase()}</span></td>
            <td><code>${t.endpoint}</code></td>
            <td>${t.description || '<span class="text-muted">Sin descripción</span>'}</td>
            <td>
                <button class="btn btn-secondary btn-sm btn-view-json" data-id="${t.id}">
                    <i class="fa-solid fa-code"></i> Payload JSON
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    document.querySelectorAll('.btn-view-json').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tid = e.currentTarget.getAttribute('data-id');
            const template = state.templates.find(t => t.id === tid);
            if (template) {
                showJsonModal(template.name, template.payload);
            }
        });
    });
}

// Library Filter Listener
document.getElementById('library-category-filter').addEventListener('change', (e) => {
    state.libraryFilter = e.target.value;
    renderTemplates();
});

// ==========================================
// PACKAGES (PLANTILLAS)
// ==========================================
async function loadPackages() {
    try {
        const res = await fetch(`${API_BASE}/packages`, { headers: getHeaders() });
        handleAPIError(res);
        if (res.ok) {
            state.packages = await res.json();
            renderPackages();
            populateDeployPackagesDropdown();
        }
    } catch (err) {
        console.error('Error loading packages:', err);
    }
}

function renderPackages() {
    const tbody = document.getElementById('packages-list-tbody');
    tbody.innerHTML = '';
    
    if (state.packages.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center">No hay plantillas guardadas. Usa "Armar Nueva Plantilla".</td></tr>`;
        return;
    }
    
    state.packages.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${p.name}</strong></td>
            <td>${p.description || '<span class="text-muted">Sin descripción</span>'}</td>
            <td><span class="badge badge-primary">${p.templates ? p.templates.length : 0}</span></td>
            <td>
                <!-- Future actions like view details, delete -->
                <button class="btn btn-secondary btn-sm" disabled><i class="fa-solid fa-eye"></i> Detalles</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function populateDeployPackagesDropdown() {
    const select = document.getElementById('deploy-selected-package');
    select.innerHTML = '<option value="">Selecciona plantilla...</option>';
    state.packages.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.templates.length} directivas)`;
        select.appendChild(opt);
    });
}

// Plantillas Form toggles
document.getElementById('btn-show-create-package').addEventListener('click', () => {
    document.getElementById('create-package-container').classList.remove('hidden');
    document.getElementById('create-package-form').reset();
    renderPkgDirectivesCheckboxes();
});

document.getElementById('btn-hide-create-package').addEventListener('click', () => {
    document.getElementById('create-package-container').classList.add('hidden');
});
document.getElementById('btn-cancel-create-package').addEventListener('click', () => {
    document.getElementById('create-package-container').classList.add('hidden');
});

// Plantillas filter
document.getElementById('pkg-category-filter').addEventListener('change', (e) => {
    state.pkgFilter = e.target.value;
    document.querySelectorAll('.pkg-tpl-item').forEach(el => {
        const cat = el.getAttribute('data-category');
        if (state.pkgFilter === 'all' || cat === state.pkgFilter) {
            el.style.display = 'flex';
        } else {
            el.style.display = 'none';
        }
    });
});

function renderPkgDirectivesCheckboxes() {
    const container = document.getElementById('pkg-directives-checkboxes');
    container.innerHTML = '';
    
    if (state.templates.length === 0) {
        container.innerHTML = '<p class="text-muted text-center">No hay directivas disponibles.</p>';
        return;
    }
    
    state.templates.forEach(t => {
        const div = document.createElement('div');
        div.className = 'checkbox-item pkg-tpl-item';
        div.setAttribute('data-category', t.category);
        div.innerHTML = `
            <input type="checkbox" id="chk-pkg-tpl-${t.id}" class="chk-pkg-template" value="${t.id}">
            <label for="chk-pkg-tpl-${t.id}">
                <span>${t.name}</span>
                <span class="badge badge-category">${t.category.toUpperCase()}</span>
            </label>
        `;
        container.appendChild(div);
    });
}

document.getElementById('create-package-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('create-pkg-name').value;
    const description = document.getElementById('create-pkg-description').value;
    const template_ids = Array.from(document.querySelectorAll('.chk-pkg-template:checked')).map(el => el.value);
    
    if (template_ids.length === 0) {
        showToast('Debes seleccionar al menos una directiva para la plantilla.', true);
        return;
    }
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando...';
    
    try {
        const res = await fetch(`${API_BASE}/packages`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ name, description, template_ids })
        });
        handleAPIError(res);
        if (res.ok) {
            showToast('Plantilla guardada exitosamente.');
            document.getElementById('create-package-container').classList.add('hidden');
            loadPackages();
        } else {
            const err = await res.json();
            showToast(err.detail || 'Error al guardar la plantilla.', true);
        }
    } catch (err) {
        console.error(err);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Guardar Plantilla';
    }
});

// ==========================================
// CREATE MANUAL TEMPLATE (DIRECTIVE)
// ==========================================
document.getElementById('btn-show-create-template').addEventListener('click', () => {
    document.getElementById('create-template-container').classList.remove('hidden');
    document.getElementById('create-template-form').reset();
    document.getElementById('create-tpl-payload').value = '{\n  \n}';
});

document.getElementById('btn-hide-create-template').addEventListener('click', () => {
    document.getElementById('create-template-container').classList.add('hidden');
});
document.getElementById('btn-cancel-create-template').addEventListener('click', () => {
    document.getElementById('create-template-container').classList.add('hidden');
});

document.getElementById('create-template-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('create-tpl-name').value;
    const category = document.getElementById('create-tpl-category').value;
    const endpoint = document.getElementById('create-tpl-endpoint').value;
    const description = document.getElementById('create-tpl-description').value;
    const payloadStr = document.getElementById('create-tpl-payload').value;
    
    let payload;
    try {
        payload = JSON.parse(payloadStr);
    } catch (err) {
        showToast('El Payload JSON ingresado no tiene un formato válido.', true);
        return;
    }
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando...';
    
    try {
        const res = await fetch(`${API_BASE}/templates`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ name, description, category, endpoint, payload })
        });
        handleAPIError(res);
        if (res.ok) {
            showToast('Plantilla creada exitosamente.');
            document.getElementById('create-template-container').classList.add('hidden');
            loadTemplates(); // Refresh table
        } else {
            const err = await res.json();
            showToast(err.detail || 'Error al crear la plantilla.', true);
        }
    } catch (err) {
        console.error(err);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Guardar Plantilla';
    }
});

// ==========================================
// IMPORT ENDPOINTS CONFIGURATION (ALL & CUSTOM)
// ==========================================
const ALL_IMPORT_RESOURCES = [
    { id: "settings_catalog", name: "Settings Catalog (Directivas)", endpoint: "deviceManagement/configurationPolicies", category: "intune" },
    { id: "device_configurations", name: "Perfiles de Configuración (Legacy)", endpoint: "deviceManagement/deviceConfigurations", category: "intune" },
    { id: "compliance_policies", name: "Directivas de Cumplimiento (Compliance)", endpoint: "deviceManagement/deviceCompliancePolicies", category: "intune" },
    { id: "autopilot_profiles", name: "Perfiles Autopilot", endpoint: "deviceManagement/windowsAutopilotDeploymentProfiles", category: "intune" },
    { id: "powershell_scripts", name: "PowerShell Scripts", endpoint: "deviceManagement/deviceManagementScripts", category: "intune" },
    { id: "remediations", name: "Remediaciones (Scripts de salud)", endpoint: "deviceManagement/deviceHealthScripts", category: "intune" },
    { id: "defender_intents", name: "Seguridad de Endpoint (Intents)", endpoint: "deviceManagement/intents", category: "defender" },
    { id: "conditional_access", name: "Directivas de Acceso Condicional", endpoint: "identity/conditionalAccess/policies", category: "entra_id" },
    { id: "sharepoint_sites", name: "Sitios de SharePoint", endpoint: "sites", category: "sharepoint" },
    { id: "purview_labels", name: "Etiquetas de Sensibilidad (Sensitivity Labels)", endpoint: "security/informationProtection/sensitivityLabels", category: "purview" }
];

function renderImportResourceCheckboxes() {
    const container = document.getElementById('import-resources-checkboxes');
    container.innerHTML = '';
    
    ALL_IMPORT_RESOURCES.forEach(r => {
        const div = document.createElement('div');
        div.className = 'checkbox-item';
        div.innerHTML = `
            <input type="checkbox" id="chk-import-${r.id}" class="chk-import-resource" value="${r.id}" checked>
            <label for="chk-import-${r.id}">
                <span>${r.name}</span>
                <span class="badge badge-category">${r.category.toUpperCase()}</span>
            </label>
        `;
        container.appendChild(div);
    });
}

// Import Mode change listener
document.getElementById('import-mode').addEventListener('change', (e) => {
    const customSelection = document.getElementById('import-custom-selection');
    if (e.target.value === 'custom') {
        customSelection.classList.remove('hidden');
        renderImportResourceCheckboxes();
    } else {
        customSelection.classList.add('hidden');
    }
});

// Enable/Disable custom manual endpoint checkbox listener
document.getElementById('import-enable-custom-endpoint').addEventListener('change', (e) => {
    const fields = document.getElementById('import-custom-endpoint-fields');
    const input = document.getElementById('import-custom-endpoint');
    if (e.target.checked) {
        fields.classList.remove('hidden');
        input.required = true;
    } else {
        fields.classList.add('hidden');
        input.required = false;
        input.value = '';
    }
});

// Import policy trigger toggles
document.getElementById('btn-show-import-policy').addEventListener('click', () => {
    document.getElementById('import-policy-container').classList.remove('hidden');
    document.getElementById('import-mode').value = 'all';
    document.getElementById('import-custom-selection').classList.add('hidden');
    document.getElementById('import-enable-custom-endpoint').checked = false;
    document.getElementById('import-custom-endpoint-fields').classList.add('hidden');
    document.getElementById('import-custom-endpoint').value = '';
    document.getElementById('import-custom-endpoint').required = false;
});

document.getElementById('btn-hide-import-policy').addEventListener('click', () => {
    document.getElementById('import-policy-container').classList.add('hidden');
});
document.getElementById('btn-cancel-import-policy').addEventListener('click', () => {
    document.getElementById('import-policy-container').classList.add('hidden');
});
document.getElementById('import-policy-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const organization_id = document.getElementById('import-org-id').value;
    const mode = document.getElementById('import-mode').value;
    
    // Disable form submission button
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    const originalBtnText = submitBtn.textContent;
    submitBtn.textContent = 'Encolando tareas...';

    try {
        if (mode === 'all') {
            // Bulk import using TCM Snapshot API
            const res = await fetch(`${API_BASE}/templates/import-tcm`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({
                    organization_id,
                    workloads: ["entra", "intune", "defender", "purview", "teams"]
                })
            });
            handleAPIError(res);
            if (res.ok) {
                showToast('Importación masiva mediante TCM iniciada en segundo plano.');
            } else {
                const err = await res.json();
                showToast(err.detail || 'Error al iniciar importación masiva TCM.', true);
            }
        } else {
            // Mode is custom, get selected checkboxes
            const checkedVals = Array.from(document.querySelectorAll('.chk-import-resource:checked')).map(el => el.value);
            const itemsToImport = ALL_IMPORT_RESOURCES.filter(r => checkedVals.includes(r.id));
            
            // Check if custom manual endpoint is enabled
            const enableCustom = document.getElementById('import-enable-custom-endpoint').checked;
            if (enableCustom) {
                const customEndpoint = document.getElementById('import-custom-endpoint').value.trim();
                const customCategory = document.getElementById('import-custom-category').value;
                if (customEndpoint) {
                    itemsToImport.push({
                        name: `Custom [${customCategory}]`,
                        endpoint: customEndpoint,
                        category: customCategory
                    });
                }
            }
            
            if (itemsToImport.length === 0) {
                showToast('Debes seleccionar al menos un recurso para importar.', true);
                submitBtn.disabled = false;
                submitBtn.textContent = originalBtnText;
                return;
            }
            
            let successCount = 0;
            let failCount = 0;
            
            // Dispatch calls concurrently
            const promises = itemsToImport.map(async (item) => {
                try {
                    const res = await fetch(`${API_BASE}/templates/import`, {
                        method: 'POST',
                        headers: getHeaders(),
                        body: JSON.stringify({
                            organization_id,
                            endpoint: item.endpoint,
                            category: item.category
                        })
                    });
                    handleAPIError(res);
                    if (res.ok) {
                        successCount++;
                    } else {
                        failCount++;
                    }
                } catch (err) {
                    console.error(`Error importing ${item.name}:`, err);
                    failCount++;
                }
            });
            
            await Promise.all(promises);
            
            if (successCount > 0) {
                showToast(`Se han encolado ${successCount} tareas de importación exitosamente.`);
            }
            if (failCount > 0) {
                showToast(`Hubo un problema al encolar ${failCount} tareas de importación.`, true);
            }
        }
    } catch (err) {
        console.error(err);
    } finally {
        // Enable button and hide form
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
        document.getElementById('import-policy-container').classList.add('hidden');
        
        // Reload templates library after 3 seconds
        setTimeout(loadTemplates, 3000);
    }
});


// JSON modal popup helpers
function showJsonModal(title, jsonPayload) {
    const modal = document.getElementById('json-modal');
    document.getElementById('json-modal-title').textContent = title;
    document.getElementById('json-modal-pre').textContent = JSON.stringify(jsonPayload, null, 2);
    modal.classList.remove('hidden');
}

document.getElementById('btn-close-json-modal').addEventListener('click', () => {
    document.getElementById('json-modal').classList.add('hidden');
});

// ==========================================
// DEPLOYMENT FORM BUILDER (DYNAMIC FIELDS)
// ==========================================
function renderDeployTemplateCheckboxes() {
    const container = document.getElementById('deploy-templates-checkboxes');
    container.innerHTML = '';
    
    if (state.templates.length === 0) {
        container.innerHTML = '<p class="text-muted text-center">No hay plantillas registradas en la biblioteca.</p>';
        return;
    }
    
    state.templates.forEach(t => {
        const div = document.createElement('div');
        div.className = 'checkbox-item tpl-item';
        div.setAttribute('data-category', t.category);
        div.innerHTML = `
            <input type="checkbox" id="chk-tpl-${t.id}" class="chk-deploy-template" value="${t.id}">
            <label for="chk-tpl-${t.id}">
                <span>${t.name}</span>
                <span class="badge badge-category">${t.category.toUpperCase()}</span>
            </label>
        `;
        container.appendChild(div);
        
        // Listen to checkbox change to render granular assignment overrides
        div.querySelector('input').addEventListener('change', buildPerTemplateAssignmentRows);
    });
    applyDeployFilter(); // Apply initial filter
}

document.getElementById('deploy-category-filter').addEventListener('change', (e) => {
    state.deployFilter = e.target.value;
    applyDeployFilter();
});

function applyDeployFilter() {
    document.querySelectorAll('.tpl-item').forEach(el => {
        const cat = el.getAttribute('data-category');
        if (state.deployFilter === 'all' || cat === state.deployFilter) {
            el.style.display = 'flex';
        } else {
            el.style.display = 'none';
        }
    });
}

// Dynamic Group Definition handling
document.getElementById('btn-add-group-def').addEventListener('click', () => {
    const id = 'group_' + Date.now();
    const group = { id, display_name: '', group_type: 'static', membership_rule: '' };
    state.groupDefinitions.push(group);
    
    renderGroupDefinitions();
});

function renderGroupDefinitions() {
    const listContainer = document.getElementById('create-groups-list');
    const noGroupsMsg = document.getElementById('no-groups-defined');
    
    // Clear list but preserve message reference
    listContainer.querySelectorAll('.group-def-card').forEach(el => el.remove());
    
    if (state.groupDefinitions.length === 0) {
        noGroupsMsg.classList.remove('hidden');
        return;
    }
    
    noGroupsMsg.classList.add('hidden');
    
    state.groupDefinitions.forEach((g, index) => {
        const div = document.createElement('div');
        div.className = 'group-def-card flex-column gap-10';
        div.innerHTML = `
            <button type="button" class="btn btn-close group-def-card-remove" data-id="${g.id}" title="Eliminar definición">
                <i class="fa-solid fa-trash-can text-danger"></i>
            </button>
            <div class="form-grid">
                <div class="form-group">
                    <label>Nombre del Grupo</label>
                    <input type="text" class="grp-display-name" data-id="${g.id}" value="${g.display_name}" placeholder="Ej: SG-Ventas-Piloto" required>
                </div>
                <div class="form-group">
                    <label>Tipo de Grupo</label>
                    <select class="grp-type" data-id="${g.id}">
                        <option value="static" ${g.group_type === 'static' ? 'selected' : ''}>Estático</option>
                        <option value="dynamic" ${g.group_type === 'dynamic' ? 'selected' : ''}>Dinámico</option>
                    </select>
                </div>
            </div>
            <div class="form-group grp-rule-container ${g.group_type !== 'dynamic' ? 'hidden' : ''}" id="rule-container-${g.id}">
                <label>Regla de Membresía Dinámica</label>
                <input type="text" class="grp-membership-rule" data-id="${g.id}" value="${g.membership_rule}" placeholder="Ej: (user.department -eq &quot;Sales&quot;)" ${g.group_type === 'dynamic' ? 'required' : ''}>
            </div>
        `;
        
        // Listeners for values update
        div.querySelector('.grp-display-name').addEventListener('input', (e) => {
            g.display_name = e.target.value;
            // Sync checkboxes in global and granular assignment rows
            syncGroupCheckboxes();
        });
        
        div.querySelector('.grp-type').addEventListener('change', (e) => {
            g.group_type = e.target.value;
            const ruleContainer = document.getElementById(`rule-container-${g.id}`);
            const ruleInput = ruleContainer.querySelector('.grp-membership-rule');
            
            if (g.group_type === 'dynamic') {
                ruleContainer.classList.remove('hidden');
                ruleInput.required = true;
            } else {
                ruleContainer.classList.add('hidden');
                ruleInput.required = false;
                g.membership_rule = '';
                ruleInput.value = '';
            }
        });
        
        div.querySelector('.grp-membership-rule').addEventListener('input', (e) => {
            g.membership_rule = e.target.value;
        });
        
        div.querySelector('.group-def-card-remove').addEventListener('click', () => {
            state.groupDefinitions = state.groupDefinitions.filter(item => item.id !== g.id);
            renderGroupDefinitions();
        });
        
        listContainer.appendChild(div);
    });
    
    // Sync group checkboxes in assignment section
    syncGroupCheckboxes();
}

// Sync group name checkboxes in global and granular assignment areas
function syncGroupCheckboxes() {
    // Update global deployment group checkboxes (under "Asignación Global -> custom_groups")
    const globalContainer = document.getElementById('deploy-assign-groups-checkboxes');
    if (globalContainer) {
        const checkedVals = Array.from(globalContainer.querySelectorAll('input:checked')).map(el => el.value);
        globalContainer.innerHTML = state.groupDefinitions.map(g => `
            <label class="checkbox-inline" style="margin-right:15px; display:inline-flex; align-items:center; gap:6px; cursor:pointer;">
                <input type="checkbox" class="global-assign-group-chk" value="${g.display_name}" ${checkedVals.includes(g.display_name) ? 'checked' : ''}> <span class="badge badge-info"><i class="fa-solid fa-users"></i> ${g.display_name || '<em>Sin nombre</em>'}</span>
            </label>
        `).join('') || '<p class="text-muted" style="margin:0; font-size:0.85rem;">Los grupos creados arriba aparecerán aquí.</p>';
    }
    
    // Update granular deployment checkboxes in each template-assignment-row
    document.querySelectorAll('.tpl-assign-groups-checkboxes').forEach(chkContainer => {
        const checkedVals = Array.from(chkContainer.querySelectorAll('input:checked')).map(el => el.value);
        chkContainer.innerHTML = state.groupDefinitions.map(g => `
            <label class="checkbox-inline" style="margin-right:15px; display:inline-flex; align-items:center; gap:6px; cursor:pointer;">
                <input type="checkbox" class="tpl-assign-group-chk" value="${g.display_name}" ${checkedVals.includes(g.display_name) ? 'checked' : ''}> <span class="badge badge-info"><i class="fa-solid fa-users"></i> ${g.display_name || '<em>Sin nombre</em>'}</span>
            </label>
        `).join('') || '<p class="text-muted" style="margin:0; font-size:0.85rem;">Agrega grupos en la sección 3 para verlos aquí.</p>';
    });
}

// Global target show/hide groups input list
document.getElementById('deploy-assignment-target').addEventListener('change', (e) => {
    const container = document.getElementById('deploy-groups-selector-container');
    if (e.target.value === 'custom_groups') {
        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
    }
});

// Deployment Source Logic
document.querySelectorAll('input[name="deploy_source"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        if (e.target.value === 'package') {
            document.getElementById('deploy-source-package-container').classList.remove('hidden');
            document.getElementById('deploy-source-custom-container').classList.add('hidden');
        } else {
            document.getElementById('deploy-source-package-container').classList.add('hidden');
            document.getElementById('deploy-source-custom-container').classList.remove('hidden');
        }
        buildPerTemplateAssignmentRows();
    });
});

document.getElementById('deploy-selected-package').addEventListener('change', (e) => {
    buildPerTemplateAssignmentRows();
    const pkg = state.packages.find(p => p.id === e.target.value);
    const info = document.getElementById('deploy-package-info');
    if (pkg) {
        info.textContent = `Contiene ${pkg.templates.length} directivas seleccionadas automáticamente.`;
    } else {
        info.textContent = '';
    }
});

// Build Granular assignment overrides list based on selection
function buildPerTemplateAssignmentRows() {
    let selectedTemplateIds = [];
    const deploySource = document.querySelector('input[name="deploy_source"]:checked').value;
    
    if (deploySource === 'package') {
        const pkgId = document.getElementById('deploy-selected-package').value;
        const pkg = state.packages.find(p => p.id === pkgId);
        if (pkg && pkg.templates) {
            selectedTemplateIds = pkg.templates.map(t => t.id);
        }
    } else {
        selectedTemplateIds = Array.from(document.querySelectorAll('.chk-deploy-template:checked')).map(el => el.value);
    }

    const container = document.getElementById('per-template-assignments-container');
    
    // Clear list
    container.innerHTML = '';
    
    if (selectedTemplateIds.length === 0) {
        container.innerHTML = '<p class="text-muted text-center">Selecciona directivas o una plantilla arriba para configurar asignaciones granulares.</p>';
        return;
    }
    
    selectedTemplateIds.forEach(tid => {
        const template = state.templates.find(t => t.id === tid);
        if (!template) return;
        
        const div = document.createElement('div');
        div.className = 'template-assignment-row flex-column';
        div.setAttribute('data-template-id', tid);
        div.innerHTML = `
            <div class="template-assignment-row-title">
                <span><i class="fa-solid fa-file-contract text-muted"></i> <strong>${template.name}</strong></span>
                <span class="badge badge-category">${template.category.toUpperCase()}</span>
            </div>
            <div class="template-assignment-row-body">
                <div class="form-group">
                    <label>Asignación Específica</label>
                    <select class="tpl-assign-target" data-template-id="${tid}">
                        <option value="unassigned">Sin asignar</option>
                        <option value="all_devices">Todos los dispositivos</option>
                        <option value="all_users">Todos los usuarios</option>
                        <option value="custom_groups">Grupos de seguridad específicos</option>
                    </select>
                </div>
                <div class="form-group tpl-assign-groups-container hidden" id="tpl-groups-container-${tid}">
                    <label>Grupos para esta política</label>
                    <div class="tpl-assign-groups-checkboxes mb-2" data-template-id="${tid}">
                        ${state.groupDefinitions.map(g => `
                            <label class="checkbox-inline" style="margin-right:15px; display:inline-flex; align-items:center; gap:5px;">
                                <input type="checkbox" class="tpl-assign-group-chk" value="${g.display_name}"> <span class="badge badge-info">${g.display_name}</span>
                            </label>
                        `).join('')}
                    </div>
                    <input type="text" class="tpl-assign-groups" data-template-id="${tid}" placeholder="Otros grupos existentes (Ej: SG-Custom-Ventas)">
                </div>
            </div>
        `;
        
        // Toggle specific groups field based on selection
        div.querySelector('.tpl-assign-target').addEventListener('change', (e) => {
            const ruleContainer = document.getElementById(`tpl-groups-container-${tid}`);
            if (e.target.value === 'custom_groups') {
                ruleContainer.classList.remove('hidden');
                // Removed required to allow only checkbox selection
            } else {
                ruleContainer.classList.add('hidden');
                ruleContainer.querySelector('.tpl-assign-groups').value = '';
                ruleContainer.querySelectorAll('.tpl-assign-group-chk').forEach(chk => chk.checked = false);
            }
        });
        
        container.appendChild(div);
    });
    
    // After rendering rows, sync group checkboxes into each new row
    syncGroupCheckboxes();
}


// Start Deployment action
let currentSimulatedJobId = null;

document.getElementById('deployment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const organization_id = document.getElementById('deploy-org-id').value;
    const bypass_validation = document.getElementById('deploy-bypass-validation').checked;
    
    let template_ids = [];
    const deploySource = document.querySelector('input[name="deploy_source"]:checked').value;
    if (deploySource === 'package') {
        const selectedPackageId = document.getElementById('deploy-selected-package').value;
        if (!selectedPackageId) {
            showToast('Debes seleccionar una plantilla.', true);
            return;
        }
        const pkg = state.packages.find(p => p.id === selectedPackageId);
        if (pkg && pkg.templates) {
            template_ids = pkg.templates.map(t => t.id);
        }
    } else {
        template_ids = Array.from(document.querySelectorAll('.chk-deploy-template:checked')).map(el => el.value);
    }
    
    if (template_ids.length === 0) {
        showToast('Debes seleccionar al menos una directiva a desplegar.', true);
        return;
    }
    
    // Group Definitions
    const create_groups = state.groupDefinitions.map(g => ({
        display_name: g.display_name,
        group_type: g.group_type,
        membership_rule: g.membership_rule || null
    }));
    
    // Global assignment
    const assignment_target = document.getElementById('deploy-assignment-target').value;
    let assign_to_groups = [];
    document.querySelectorAll('.global-assign-group-chk:checked').forEach(chk => {
        assign_to_groups.push(chk.value);
    });
    
    const assign_to_groups_raw = document.getElementById('deploy-assign-to-groups').value;
    if (assign_to_groups_raw) {
        assign_to_groups_raw.split(',').forEach(s => {
            const val = s.trim();
            if (val && !assign_to_groups.includes(val)) assign_to_groups.push(val);
        });
    }
    assign_to_groups = assign_to_groups.length > 0 ? assign_to_groups : null;
        
    // Granular assignments overrides
    const template_assignments = [];
    document.querySelectorAll('.template-assignment-row').forEach(row => {
        const template_id = row.getAttribute('data-template-id');
        const target = row.querySelector('.tpl-assign-target').value;
        
        let tpl_assign_to_groups = [];
        row.querySelectorAll('.tpl-assign-group-chk:checked').forEach(chk => {
            tpl_assign_to_groups.push(chk.value);
        });
        
        const groups_raw = row.querySelector('.tpl-assign-groups').value;
        if (groups_raw) {
            groups_raw.split(',').forEach(s => {
                const val = s.trim();
                if (val && !tpl_assign_to_groups.includes(val)) tpl_assign_to_groups.push(val);
            });
        }
            
        template_assignments.push({
            template_id,
            assignment_target: target,
            assign_to_groups: tpl_assign_to_groups.length > 0 ? tpl_assign_to_groups : null
        });
    });
    
    const payload = {
        organization_id,
        template_ids,
        create_groups: create_groups.length > 0 ? create_groups : null,
        assignment_target,
        assign_to_groups,
        template_assignments: template_assignments.length > 0 ? template_assignments : null,
        bypass_validation
    };
    
    const submitBtn = document.getElementById('btn-submit-deployment');
    submitBtn.disabled = true;
    submitBtn.querySelector('span').textContent = 'Simulando...';
    
    try {
        const res = await fetch(`${API_BASE}/deployments/simulate`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });
        handleAPIError(res);
        if (res.ok) {
            const data = await res.json();
            currentSimulatedJobId = data.job_id;
            
            // Build Simulation UI
            const simBody = document.getElementById('sim-body');
            simBody.innerHTML = '';
            
            if (data.simulation_report && data.simulation_report.summary) {
                const summary = data.simulation_report.summary;
                const details = data.simulation_report.details;
                
                simBody.innerHTML = `
                    <div style="display:flex; gap: 15px; margin-bottom: 20px;">
                        <div class="stat-box" style="flex:1; background: #1a1a1a; padding: 10px; text-align: center; border-radius: 5px;">
                            <h3 style="margin:0; color:var(--neon-green)">${summary.create}</h3>
                            <small>Crear</small>
                        </div>
                        <div class="stat-box" style="flex:1; background: #1a1a1a; padding: 10px; text-align: center; border-radius: 5px;">
                            <h3 style="margin:0; color:var(--neon-orange)">${summary.update}</h3>
                            <small>Modificar/Drift</small>
                        </div>
                        <div class="stat-box" style="flex:1; background: #1a1a1a; padding: 10px; text-align: center; border-radius: 5px;">
                            <h3 style="margin:0; color:var(--text-secondary)">${summary.skip}</h3>
                            <small>Sin Cambios</small>
                        </div>
                    </div>
                    <div style="max-height: 400px; overflow-y: auto;">
                        <table class="table" style="font-size:0.9em;">
                            <thead><tr><th>Directiva</th><th>Acción</th><th>Detalle</th></tr></thead>
                            <tbody>
                                ${details.map(d => `
                                    <tr>
                                        <td>${d.template_name}</td>
                                        <td>
                                            ${d.status === 'create' ? '<span class="badge badge-success">Crear</span>' : 
                                              d.status === 'update' ? '<span class="badge badge-warning">Modificar</span>' : 
                                              d.status === 'error' ? '<span class="badge badge-danger">Error</span>' :
                                              '<span class="badge badge-info">Ignorar</span>'}
                                        </td>
                                        <td>
                                            ${d.status === 'update' && d.diff.mismatches ? `<button class="btn btn-sm btn-secondary" onclick="alert('Diferencias encontradas:\\n' + ${JSON.stringify(JSON.stringify(d.diff.mismatches))})">Ver Diff</button>` : d.diff.info || ''}
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
            }
            
            document.getElementById('simulation-modal').classList.remove('hidden');
        } else {
            const err = await res.json();
            showToast(err.detail || 'Error al iniciar la simulación.', true);
        }
    } catch (err) {
        console.error(err);
    } finally {
        submitBtn.disabled = false;
        if (state.role === 'deployer') {
            submitBtn.querySelector('span').textContent = 'Solicitar Despliegue';
        } else {
            submitBtn.querySelector('span').textContent = 'Ejecutar Implementación (Directa)';
        }
    }
});

// Confirm Simulation Action
document.getElementById('btn-confirm-sim')?.addEventListener('click', async () => {
    if (!currentSimulatedJobId) return;
    const btn = document.getElementById('btn-confirm-sim');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Solicitando...';
    
    try {
        const res = await fetch(`${API_BASE}/deployments/${currentSimulatedJobId}/commit`, {
            method: 'POST',
            headers: getHeaders()
        });
        handleAPIError(res);
        if (res.ok) {
            document.getElementById('simulation-modal').classList.add('hidden');
            document.getElementById('deployment-form').reset();
            state.groupDefinitions = [];
            renderGroupDefinitions();
            document.getElementById('deploy-groups-selector-container').classList.add('hidden');
            buildPerTemplateAssignmentRows();
            
            showToast('Despliegue solicitado. Esperando aprobación...');
            switchTab('historial');
            loadJobs();
        } else {
            const err = await res.json();
            showToast(err.detail || 'Error al confirmar el despliegue.', true);
        }
    } catch (err) {
        console.error(err);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Solicitar Aprobación';
        currentSimulatedJobId = null;
    }
});

document.getElementById('btn-cancel-sim')?.addEventListener('click', () => {
    document.getElementById('simulation-modal').classList.add('hidden');
});
document.getElementById('btn-close-sim')?.addEventListener('click', () => {
    document.getElementById('simulation-modal').classList.add('hidden');
});

// ==========================================
// JOBS HISTORY & ROLLBACKS
// ==========================================
async function loadJobs() {
    try {
        const res = await fetch(`${API_BASE}/deployments`, { headers: getHeaders() });
        handleAPIError(res);
        if (res.ok) {
            state.jobs = await res.json();
            renderJobs();
        }
    } catch (err) {
        console.error('Error loading jobs:', err);
    }
}

function renderJobs() {
    const tbody = document.getElementById('jobs-list-tbody');
    tbody.innerHTML = '';
    
    if (state.jobs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center">No se registran trabajos de despliegue en el historial.</td></tr>`;
        return;
    }
    
    state.jobs.forEach(job => {
        let statusBadge = '';
        if (job.status === 'pending_approval') statusBadge = '<span class="badge badge-info"><i class="fa-solid fa-clock"></i> Pendiente Aprobación</span>';
        else if (job.status === 'pending') statusBadge = '<span class="badge badge-info"><i class="fa-solid fa-hourglass-start"></i> Pendiente</span>';
        else if (job.status === 'running') statusBadge = '<span class="badge badge-warning"><i class="fa-solid fa-spinner fa-spin"></i> Ejecutando</span>';
        else if (job.status === 'completed') statusBadge = '<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> Completado</span>';
        else if (job.status === 'failed') statusBadge = '<span class="badge badge-danger"><i class="fa-solid fa-triangle-exclamation"></i> Fallido</span>';
        else if (job.status === 'rejected') statusBadge = '<span class="badge badge-danger"><i class="fa-solid fa-xmark"></i> Rechazado</span>';
        
        // Resolve Org Name
        const org = state.organizations.find(o => o.id === job.organization_id);
        const orgName = org ? org.name : `ID: ${job.organization_id.substring(0, 8)}`;
        
        const createdDate = new Date(job.created_at).toLocaleString();
        
        // Check if rollback can be clicked (has deployed resources in parameters)
        const hasDeployedRes = job.parameters && job.parameters.deployed_resources && job.parameters.deployed_resources.length > 0;
        const hasCreatedGroups = job.parameters && job.parameters.created_groups_resolved && job.parameters.created_groups_resolved.length > 0;
        const canRollback = hasDeployedRes || hasCreatedGroups;
        
        let actionsHtml = `
            <button class="btn btn-secondary btn-sm btn-view-job-report" data-id="${job.id}">
                <i class="fa-solid fa-chart-simple"></i>
            </button>
        `;

        if (job.status === 'pending_approval' && ['approver', 'super_admin'].includes(state.role)) {
            actionsHtml += `
                <button class="btn btn-success btn-sm btn-approve-job" data-id="${job.id}" title="Aprobar">
                    <i class="fa-solid fa-check"></i>
                </button>
                <button class="btn btn-danger btn-sm btn-reject-job" data-id="${job.id}" title="Rechazar">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            `;
        } else if (job.status === 'running' || job.status === 'completed' || job.status === 'failed') {
             actionsHtml += `
                <button class="btn btn-primary btn-sm btn-view-console" data-id="${job.id}" data-org="${orgName}" title="Ver Consola">
                    <i class="fa-solid fa-terminal"></i>
                </button>
                <button class="btn btn-danger btn-sm btn-rollback-job" data-id="${job.id}" ${!canRollback ? 'disabled' : ''} title="Rollback">
                    <i class="fa-solid fa-rotate-left"></i>
                </button>
            `;
        }
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><code>${job.id.substring(0, 8)}</code></td>
            <td>${orgName}</td>
            <td>${statusBadge}</td>
            <td>-</td>
            <td>-</td>
            <td>${createdDate}</td>
            <td><div style="display:flex; gap:5px;">${actionsHtml}</div></td>
        `;
        tbody.appendChild(tr);
    });
    
    // Add report listener
    document.querySelectorAll('.btn-view-job-report').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const jid = e.currentTarget.getAttribute('data-id');
            showJobReportModal(jid);
        });
    });

    // Add rollback listener
    document.querySelectorAll('.btn-rollback-job').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const jid = e.currentTarget.getAttribute('data-id');
            triggerRollback(jid);
        });
    });

    document.querySelectorAll('.btn-view-console').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const jid = e.currentTarget.getAttribute('data-id');
            const org = e.currentTarget.getAttribute('data-org');
            openDeployConsole(jid, org);
        });
    });

    document.querySelectorAll('.btn-approve-job').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const jid = e.currentTarget.getAttribute('data-id');
            await handleApprovalAction(jid, 'approve');
        });
    });

    document.querySelectorAll('.btn-reject-job').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const jid = e.currentTarget.getAttribute('data-id');
            await handleApprovalAction(jid, 'reject');
        });
    });
}

async function handleApprovalAction(jobId, action) {
    try {
        const res = await fetch(`${API_BASE}/deployments/${jobId}/${action}`, {
            method: 'POST',
            headers: getHeaders()
        });
        handleAPIError(res);
        if (res.ok) {
            showToast(`Despliegue ${action === 'approve' ? 'aprobado' : 'rechazado'}.`);
            if (action === 'approve') {
                const orgName = state.organizations.find(o => o.id === state.jobs.find(j => j.id === jobId)?.organization_id)?.name || 'Tenant';
                openDeployConsole(jobId, orgName);
            }
            loadJobs();
        } else {
            const err = await res.json();
            showToast(err.detail || `Error al ${action} el despliegue.`, true);
        }
    } catch (err) {
        console.error(err);
    }
}

// Rollback request trigger
async function triggerRollback(jobId) {
    if (!confirm('¿Estás seguro de que deseas revertir todos los cambios realizados en este despliegue? Esta acción eliminará los grupos creados y las directivas del tenant destino.')) {
        return;
    }
    
    try {
        const res = await fetch(`${API_BASE}/deployments/${jobId}/rollback`, {
            method: 'POST',
            headers: getHeaders()
        });
        handleAPIError(res);
        if (res.ok) {
            showToast('Tarea de Rollback encolada en segundo plano.');
            setTimeout(loadJobs, 2000);
        } else {
            const err = await res.json();
            showToast(err.detail || 'Error al iniciar el rollback.', true);
        }
    } catch (err) {
        console.error(err);
    }
}

// Validate Tenant Readiness Trigger (Test Conectores button)
async function validateTenantReadiness(orgId) {
    const org = state.organizations.find(o => o.id === orgId);
    showToast(`Ejecutando validaciones previas para ${org ? org.name : 'inquilino'}...`);
    
    try {
        const res = await fetch(`${API_BASE}/organizations/${orgId}/validate`, {
            headers: getHeaders()
        });
        handleAPIError(res);
        if (res.ok) {
            const report = await res.json();
            showValidationReportModal(org ? org.name : 'Reporte de Tenant', report);
        } else {
            const err = await res.json();
            showToast(err.detail || 'Error al realizar validaciones.', true);
        }
    } catch (err) {
        console.error(err);
        showToast('Ocurrió un error al consultar las validaciones.', true);
    }
}

// Show job details modal report
function showJobReportModal(jobId) {
    const job = state.jobs.find(j => j.id === jobId);
    if (!job) return;
    
    const org = state.organizations.find(o => o.id === job.organization_id);
    const orgName = org ? org.name : `Tenant ID: ${job.organization_id}`;
    
    const modal = document.getElementById('job-detail-modal');
    const body = document.getElementById('job-modal-body');
    body.innerHTML = '';
    
    // Header details
    const divHeader = document.createElement('div');
    divHeader.className = 'report-section';
    divHeader.innerHTML = `
        <div class="form-grid">
            <div>
                <p><strong>ID de Trabajo:</strong> <code>${job.id}</code></p>
                <p><strong>Tenant Objetivo:</strong> ${orgName}</p>
                <p><strong>Estado Actual:</strong> ${job.status.toUpperCase()}</p>
            </div>
            <div>
                <p><strong>Creado el:</strong> ${new Date(job.created_at).toLocaleString()}</p>
                <p><strong>Finalizado el:</strong> ${job.completed_at ? new Date(job.completed_at).toLocaleString() : 'En proceso/Abortado'}</p>
            </div>
        </div>
    `;
    body.appendChild(divHeader);
    
    // Validation report section
    const valResults = job.parameters ? job.parameters.validation_results : null;
    const divValidation = document.createElement('div');
    divValidation.className = 'report-section';
    divValidation.innerHTML = '<h4>Reporte de Validaciones Previas</h4>';
    
    if (valResults) {
        const grid = document.createElement('div');
        grid.className = 'validation-grid';
        
        const details = valResults.details || {};
        Object.keys(details).forEach(key => {
            const item = details[key];
            const badgeClass = item.status === 'passed' ? 'badge-success' : 'badge-danger';
            
            const card = document.createElement('div');
            card.className = 'validation-card-item';
            card.innerHTML = `
                <div class="validation-card-header">
                    <span>${key.toUpperCase().replace('_', ' ')}</span>
                    <span class="badge ${badgeClass}">${item.status.toUpperCase()}</span>
                </div>
                <p class="text-secondary" style="font-size: 0.8125rem;">${item.message}</p>
            `;
            grid.appendChild(card);
        });
        divValidation.appendChild(grid);
    } else {
        divValidation.innerHTML += '<p class="text-muted">No se corrieron validaciones previas en este despliegue (bypass activado o job abortado al inicio).</p>';
    }
    body.appendChild(divValidation);
    
    // Templates deployed details section
    const divTemplates = document.createElement('div');
    divTemplates.className = 'report-section';
    divTemplates.innerHTML = '<h4>Directivas Aplicadas</h4>';
    
    if (job.templates && job.templates.length > 0) {
        const ul = document.createElement('ul');
        ul.className = 'flex-column gap-10';
        ul.style.listStyle = 'none';
        
        job.templates.forEach(t => {
            const li = document.createElement('li');
            li.style.padding = '10px 14px';
            li.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
            li.style.border = '1px solid var(--border-color)';
            li.style.borderRadius = '6px';
            li.innerHTML = `
                <div class="flex-row" style="justify-content: space-between; align-items: center;">
                    <strong>${t.name}</strong>
                    <span class="badge badge-category">${t.category.toUpperCase()}</span>
                </div>
                <code style="font-size: 0.75rem; margin-top: 4px; display: block;">${t.endpoint}</code>
            `;
            ul.appendChild(li);
        });
        divTemplates.appendChild(ul);
    } else {
        divTemplates.innerHTML += '<p class="text-muted">No hay plantillas asociadas a este job.</p>';
    }
    body.appendChild(divTemplates);

    modal.classList.remove('hidden');
}

// Show validation report modal for manual validations (Test Conectores)
function showValidationReportModal(title, report) {
    const modal = document.getElementById('job-detail-modal');
    const body = document.getElementById('job-modal-body');
    body.innerHTML = '';
    
    // Header
    const divHeader = document.createElement('div');
    divHeader.className = 'report-section';
    divHeader.innerHTML = `<h3>Resultado de Validación de Conectores - ${title}</h3>`;
    body.appendChild(divHeader);
    
    const divValidation = document.createElement('div');
    divValidation.className = 'report-section';
    
    const grid = document.createElement('div');
    grid.className = 'validation-grid';
    
    const details = report.details || {};
    Object.keys(details).forEach(key => {
        const item = details[key];
        const status = item.status || 'unknown';
        const badgeClass = status === 'passed' ? 'badge-success' : (status === 'warning' ? 'badge-warning' : 'badge-danger');
        
        const card = document.createElement('div');
        card.className = 'validation-card-item';
        card.innerHTML = `
            <div class="validation-card-header">
                <span>${key.toUpperCase().replace('_', ' ')}</span>
                <span class="badge ${badgeClass}">${status.toUpperCase()}</span>
            </div>
            <p class="text-secondary" style="font-size: 0.8125rem;">${item.message}</p>
        `;
        grid.appendChild(card);
    });
    
    divValidation.appendChild(grid);
    body.appendChild(divValidation);
    modal.classList.remove('hidden');
}

document.getElementById('btn-close-job-modal').addEventListener('click', () => {
    document.getElementById('job-detail-modal').classList.add('hidden');
});

// Refresh button for jobs
document.getElementById('btn-refresh-jobs').addEventListener('click', () => {
    showToast('Actualizando historial de trabajos.');
    loadJobs();
});

// ==========================================
// TABS SWITCHING LOGIC
// ==========================================
function switchTab(tabId) {
    // Update nav links active class
    document.querySelectorAll('.sidebar-nav .nav-link').forEach(link => {
        if (link.getAttribute('data-tab') === tabId) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
    
    // Update tab sections active class
    document.querySelectorAll('.tab-content').forEach(tab => {
        if (tab.id === `tab-${tabId}`) {
            tab.classList.add('active');
            tab.classList.remove('hidden');
        } else {
            tab.classList.remove('active');
            tab.classList.add('hidden');
        }
    });
    
    // Reload specific tab data on switch
    if (tabId === 'tenants') loadOrganizations();
    if (tabId === 'biblioteca') loadTemplates();
    if (tabId === 'historial') loadJobs();
}

document.querySelectorAll('.sidebar-nav .nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const tabId = e.currentTarget.getAttribute('data-tab');
        switchTab(tabId);
    });
});

// Auto-refresh jobs when running
setInterval(() => {
    if (state.token) {
        // If there are any running/pending jobs, refresh history periodically
        const hasActiveJobs = state.jobs.some(j => j.status === 'pending' || j.status === 'running');
        if (hasActiveJobs) {
            loadJobs();
        }
    }
}, 5000);

// ==========================================
// INITIALIZE APPLICATION
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initView();
});

// ==========================================
// REAL-TIME DEPLOYMENT CONSOLE
// ==========================================

let consolePollingInterval = null;

function openDeployConsole(jobId, orgName) {
    const overlay = document.getElementById('deploy-console-overlay');
    const consoleBody = document.getElementById('console-body');
    const titleEl = document.getElementById('console-title');
    const subtitleEl = document.getElementById('console-subtitle');
    const badgeEl = document.getElementById('console-status-badge');
    const iconEl = document.getElementById('console-status-icon');
    const viewHistoryBtn = document.getElementById('console-view-history-btn');

    // Reset console state
    consoleBody.innerHTML = `
        <div class="console-placeholder">
            <i class="fa-solid fa-terminal"></i>
            <span>Iniciando proceso de despliegue...</span>
        </div>`;
    document.getElementById('console-ok-count').textContent = '0';
    document.getElementById('console-warn-count').textContent = '0';
    document.getElementById('console-err-count').textContent = '0';
    titleEl.textContent = `Despliegue a: ${orgName}`;
    subtitleEl.textContent = `Job ID: ${jobId.substring(0, 8)}...`;
    badgeEl.textContent = 'EN CURSO';
    badgeEl.className = 'console-badge badge-running';
    iconEl.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
    viewHistoryBtn.style.display = 'none';

    overlay.classList.remove('hidden');
    
    // Stop any existing polling
    if (consolePollingInterval) clearInterval(consolePollingInterval);
    
    // Start polling
    let lastLogCount = 0;
    consolePollingInterval = setInterval(async () => {
        await pollDeployLogs(jobId, lastLogCount, (newCount, finished, finalStatus) => {
            lastLogCount = newCount;
            if (finished) {
                clearInterval(consolePollingInterval);
                consolePollingInterval = null;

                // Update header
                if (finalStatus === 'completed') {
                    iconEl.innerHTML = '<i class="fa-solid fa-circle-check" style="color: var(--success-green);"></i>';
                    badgeEl.textContent = 'COMPLETADO';
                    badgeEl.className = 'console-badge badge-success';
                    subtitleEl.textContent = 'Despliegue finalizado exitosamente';
                } else {
                    iconEl.innerHTML = '<i class="fa-solid fa-circle-xmark" style="color: var(--danger-red);"></i>';
                    badgeEl.textContent = 'FALLIDO';
                    badgeEl.className = 'console-badge badge-error';
                    subtitleEl.textContent = 'El despliegue terminó con errores';
                }

                viewHistoryBtn.style.display = 'inline-flex';
                // Refresh history tab in background
                loadJobs();
            }
        });
    }, 2000);
}

async function pollDeployLogs(jobId, lastLogCount, onUpdate) {
    try {
        const res = await fetch(`${API_BASE}/deployments/${jobId}/logs`, { headers: getHeaders() });
        if (!res.ok) return;
        const data = await res.json();

        const logs = data.logs || [];
        const newLogs = logs.slice(lastLogCount);

        if (newLogs.length > 0) {
            renderConsoleLogs(newLogs, lastLogCount === 0);
        }

        const finished = data.status === 'completed' || data.status === 'failed';
        onUpdate(logs.length, finished, data.status);
    } catch (err) {
        console.error('Console polling error:', err);
    }
}

function renderConsoleLogs(entries, isFirst) {
    const body = document.getElementById('console-body');
    
    // Remove placeholder if present
    const placeholder = body.querySelector('.console-placeholder');
    if (placeholder) placeholder.remove();

    let okCount = parseInt(document.getElementById('console-ok-count').textContent) || 0;
    let warnCount = parseInt(document.getElementById('console-warn-count').textContent) || 0;
    let errCount = parseInt(document.getElementById('console-err-count').textContent) || 0;

    entries.forEach(entry => {
        const line = document.createElement('div');
        line.className = `console-line console-line-${entry.level}`;

        const icon = {
            'SUCCESS': '<i class="fa-solid fa-circle-check"></i>',
            'ERROR':   '<i class="fa-solid fa-circle-xmark"></i>',
            'WARNING': '<i class="fa-solid fa-triangle-exclamation"></i>',
            'INFO':    '<i class="fa-solid fa-circle-info"></i>'
        }[entry.level] || '<i class="fa-solid fa-circle-info"></i>';

        const levelLabel = {
            'SUCCESS': 'OK',
            'ERROR':   'ERR',
            'WARNING': 'WARN',
            'INFO':    'INFO'
        }[entry.level] || entry.level;

        line.innerHTML = `
            <span class="console-ts">${entry.ts}</span>
            <span class="console-level-icon">${icon}</span>
            <span class="console-level-tag">[${levelLabel}]</span>
            <span class="console-msg">${escapeHtml(entry.msg)}</span>
        `;
        body.appendChild(line);

        // Update counters
        if (entry.level === 'SUCCESS') okCount++;
        else if (entry.level === 'WARNING') warnCount++;
        else if (entry.level === 'ERROR') errCount++;
    });

    document.getElementById('console-ok-count').textContent = okCount;
    document.getElementById('console-warn-count').textContent = warnCount;
    document.getElementById('console-err-count').textContent = errCount;

    // Auto-scroll to bottom
    body.scrollTop = body.scrollHeight;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Console Close btn listener
document.getElementById('console-close-btn').addEventListener('click', () => {
    document.getElementById('deploy-console-overlay').classList.add('hidden');
    if (consolePollingInterval) {
        clearInterval(consolePollingInterval);
        consolePollingInterval = null;
    }
});

document.getElementById('console-view-history-btn').addEventListener('click', () => {
    document.getElementById('deploy-console-overlay').classList.add('hidden');
    switchTab('historial');
});

// Allow reopening console from historial job rows (future enhancement hook)
function openConsoleForJob(jobId, orgName) {
    openDeployConsole(jobId, orgName);
    // Poll once to display existing logs immediately
    pollDeployLogs(jobId, 0, (count, finished, finalStatus) => {
        if (finished) {
            clearInterval(consolePollingInterval);
            const iconEl = document.getElementById('console-status-icon');
            const badgeEl = document.getElementById('console-status-badge');
            const subtitleEl = document.getElementById('console-subtitle');
            const viewHistoryBtn = document.getElementById('console-view-history-btn');
            if (finalStatus === 'completed') {
                iconEl.innerHTML = '<i class="fa-solid fa-circle-check" style="color: var(--success-green);"></i>';
                badgeEl.textContent = 'COMPLETADO';
                badgeEl.className = 'console-badge badge-success';
                subtitleEl.textContent = 'Despliegue finalizado exitosamente';
            } else {
                iconEl.innerHTML = '<i class="fa-solid fa-circle-xmark" style="color: var(--danger-red);"></i>';
                badgeEl.textContent = 'FALLIDO';
                badgeEl.className = 'console-badge badge-error';
                subtitleEl.textContent = 'El despliegue terminó con errores';
            }
            viewHistoryBtn.style.display = 'inline-flex';
        }
    });
}

// ==========================================
// USER MANAGEMENT & AUDIT LOGS (ADMIN ONLY)
// ==========================================

async function loadUsers() {
    try {
        const res = await fetch(`${API_BASE}/users`, { headers: getHeaders() });
        handleAPIError(res);
        if (res.ok) {
            state.users = await res.json();
            renderUsers();
        }
    } catch (err) {
        console.error('Error loading users:', err);
    }
}

function renderUsers() {
    const tbody = document.getElementById('users-list-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (state.users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">No hay usuarios.</td></tr>';
        return;
    }
    
    state.users.forEach(user => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${user.username}</strong></td>
            <td><span class="badge badge-info">${user.role.toUpperCase()}</span></td>
            <td>${user.is_active ? '<span class="text-success"><i class="fa-solid fa-check"></i> Activo</span>' : '<span class="text-danger"><i class="fa-solid fa-xmark"></i> Inactivo</span>'}</td>
            <td class="text-right">
                <button class="btn btn-secondary btn-sm" onclick="openEditUserModal('${user.id}')" title="Editar">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="btn btn-danger btn-sm" onclick="deleteUser('${user.id}')" title="Eliminar">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

document.getElementById('create-user-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('new-username').value;
    const password = document.getElementById('new-password').value;
    const role = document.getElementById('new-role').value;
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creando...';
    
    try {
        const res = await fetch(`${API_BASE}/users`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ username, password, role })
        });
        handleAPIError(res);
        if (res.ok) {
            showToast('Usuario creado exitosamente.');
            e.target.reset();
            loadUsers();
        } else {
            const err = await res.json();
            showToast(err.detail || 'Error al crear usuario.', true);
        }
    } catch (err) {
        console.error(err);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-user-plus"></i> Crear';
    }
});

async function loadAuditLogs() {
    try {
        const res = await fetch(`${API_BASE}/audit-logs`, { headers: getHeaders() });
        handleAPIError(res);
        if (res.ok) {
            state.auditLogs = await res.json();
            renderAuditLogs();
        }
    } catch (err) {
        console.error('Error loading audit logs:', err);
    }
}

function renderAuditLogs() {
    const tbody = document.getElementById('audit-list-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (state.auditLogs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No hay registros de auditoría.</td></tr>';
        return;
    }
    
    state.auditLogs.forEach(log => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${new Date(log.timestamp).toLocaleString()}</td>
            <td><strong>${log.username}</strong></td>
            <td><code>${log.action}</code></td>
            <td>${log.resource_type || '-'} ${log.resource_id ? `(<code>${log.resource_id.substring(0,8)}</code>)` : ''}</td>
            <td><pre style="margin:0; background:transparent; padding:0; font-size:0.8em; color: var(--text-secondary);">${JSON.stringify(log.details)}</pre></td>
        `;
        tbody.appendChild(tr);
    });
}

document.getElementById('btn-refresh-users')?.addEventListener('click', loadUsers);
document.getElementById('btn-refresh-audit')?.addEventListener('click', loadAuditLogs);

// User Edit & Delete logic
window.openEditUserModal = function(userId) {
    const user = state.users.find(u => u.id === userId);
    if (!user) return;
    
    document.getElementById('edit-user-id').value = user.id;
    document.getElementById('edit-username').value = user.username;
    document.getElementById('edit-role').value = user.role;
    document.getElementById('edit-status').value = user.is_active.toString();
    document.getElementById('edit-password').value = '';
    
    document.getElementById('edit-user-modal').classList.remove('hidden');
};

document.getElementById('btn-close-edit-user-modal')?.addEventListener('click', () => {
    document.getElementById('edit-user-modal').classList.add('hidden');
});
document.getElementById('btn-cancel-edit-user')?.addEventListener('click', () => {
    document.getElementById('edit-user-modal').classList.add('hidden');
});

document.getElementById('edit-user-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-user-id').value;
    const role = document.getElementById('edit-role').value;
    const is_active = document.getElementById('edit-status').value === 'true';
    const password = document.getElementById('edit-password').value;
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Guardando...';
    
    try {
        const payload = { role, is_active };
        if (password) payload.password = password;
        
        const res = await fetch(`${API_BASE}/users/${id}`, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });
        handleAPIError(res);
        if (res.ok) {
            showToast('Usuario actualizado exitosamente.');
            document.getElementById('edit-user-modal').classList.add('hidden');
            loadUsers();
        } else {
            const err = await res.json();
            showToast(err.detail || 'Error al actualizar usuario.', true);
        }
    } catch (err) {
        console.error(err);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
});

window.deleteUser = async function(userId) {
    if (!confirm('¿Estás seguro que deseas eliminar este usuario permanentemente?')) return;
    
    try {
        const res = await fetch(`${API_BASE}/users/${userId}`, {
            method: 'DELETE',
            headers: getHeaders()
        });
        handleAPIError(res);
        if (res.ok) {
            showToast('Usuario eliminado exitosamente.');
            loadUsers();
        } else {
            const err = await res.json();
            showToast(err.detail || 'Error al eliminar usuario.', true);
        }
    } catch (err) {
        console.error(err);
    }
};

