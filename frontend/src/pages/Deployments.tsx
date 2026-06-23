import { useEffect, useState, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import type { Job } from '../store/useStore';
import {
  Rocket, Search, ChevronRight, ChevronLeft, Users, Package,
  Plus, X, Terminal, ThumbsUp, ThumbsDown, PlayCircle, CheckCircle2,
  XCircle, AlertCircle, Clock, Filter, RefreshCw, Trash2, Eye
} from 'lucide-react';
import { apiClient } from '../api/client';

// ── Types ─────────────────────────────────────────────────────────────────────
interface EntraGroup {
  id: string;
  displayName: string;
  groupTypes: string[];
  membershipRule?: string;
  securityEnabled: boolean;
}

interface NewGroup {
  display_name: string;
  group_type: 'static' | 'dynamic';
  membership_rule: string;
}

interface TemplateAssignment {
  template_id: string;
  assignment_target: 'all_devices' | 'all_users' | 'custom_groups' | 'unassigned';
  assign_to_groups: string[];
}

// ── Helper: status badge ───────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  switch (status?.toLowerCase()) {
    case 'completed':
      return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-success/10 text-success border border-success/20"><CheckCircle2 size={12} /> Completado</span>;
    case 'failed':
      return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-error/10 text-error border border-error/20"><XCircle size={12} /> Fallido</span>;
    case 'pending_approval':
      return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-warning/10 text-warning border border-warning/20"><AlertCircle size={12} /> Requiere Aprobación</span>;
    case 'running':
    case 'in_progress':
      return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-accent-blue/10 text-accent-blue border border-accent-blue/20"><PlayCircle size={12} className="animate-pulse" /> En Progreso</span>;
    case 'simulated':
      return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-accent-purple/10 text-accent-purple border border-accent-purple/20"><Terminal size={12} /> Simulado</span>;
    case 'rejected':
      return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-error/10 text-error border border-error/20"><XCircle size={12} /> Rechazado</span>;
    default:
      return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-bg-card-hover text-text-secondary border border-border-color"><Clock size={12} /> {status}</span>;
  }
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function Deployments() {
  const { organizations, fetchOrganizations, templates, fetchTemplates, jobs, fetchJobs } = useStore();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1 - Tenant
  const [selectedOrgId, setSelectedOrgId] = useState('');

  // Step 2 - Templates
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [templateSearch, setTemplateSearch] = useState('');
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);

  // Step 3 - Groups
  const [globalTarget, setGlobalTarget] = useState<'all_devices' | 'all_users' | 'custom_groups' | 'unassigned'>('unassigned');
  const [entraGroups, setEntraGroups] = useState<EntraGroup[]>([]);
  const [groupSearch, setGroupSearch] = useState('');
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [groupsError, setGroupsError] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [newGroups, setNewGroups] = useState<NewGroup[]>([]);
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [draftGroup, setDraftGroup] = useState<NewGroup>({ display_name: '', group_type: 'static', membership_rule: '' });

  // Step 4 - Review & Deploy
  const [isBypassing, setIsBypassing] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState<any>(null);
  const [simJobId, setSimJobId] = useState<string | null>(null);

  // Console / Log Modal
  const [consoleJobId, setConsoleJobId] = useState<string | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<any[]>([]);
  const [consoleStatus, setConsoleStatus] = useState('');
  const logsEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    fetchOrganizations();
    fetchTemplates();
    fetchJobs();
  }, []);

  // ── Scroll logs ──
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleLogs]);

  // ── Load Entra Groups ──
  const loadGroups = useCallback(async (search = '') => {
    if (!selectedOrgId) return;
    setIsLoadingGroups(true);
    setGroupsError('');
    try {
      const params = search ? `?search=${encodeURIComponent(search)}` : '';
      const res = await apiClient.get(`/organizations/${selectedOrgId}/groups${params}`);
      setEntraGroups(res.data.groups || []);
    } catch (e: any) {
      setGroupsError(e.response?.data?.detail || 'Error al cargar grupos');
    } finally {
      setIsLoadingGroups(false);
    }
  }, [selectedOrgId]);

  useEffect(() => {
    if (step === 3 && selectedOrgId) loadGroups();
  }, [step, selectedOrgId]);

  // ── Console ──
  const openConsole = async (jobId: string) => {
    setConsoleJobId(jobId);
    setConsoleLogs([]);
    setConsoleStatus('');
    await pollConsoleLogs(jobId);
    pollRef.current = window.setInterval(() => {
      pollConsoleLogs(jobId);
      fetchJobs();
    }, 2500);
  };

  const closeConsole = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setConsoleJobId(null);
  };

  const pollConsoleLogs = async (jobId: string) => {
    try {
      const res = await apiClient.get(`/deployments/${jobId}/logs`);
      setConsoleLogs(res.data.logs || []);
      setConsoleStatus(res.data.status || '');
    } catch { }
  };

  // ── Template filtering ──
  const CATEGORIES: Record<string, string[]> = {
    intune: ['deviceManagement', 'deviceAppManagement'],
    entra: ['identity', 'directory', 'policies'],
    defender: ['security'],
    exchange: ['admin/exchange'],
    teams: ['teamwork', 'communications'],
    purview: ['compliance', 'solutions'],
  };

  const filteredTemplates = templates.filter(t => {
    const matchesSearch = t.name?.toLowerCase().includes(templateSearch.toLowerCase()) ||
      t.endpoint?.toLowerCase().includes(templateSearch.toLowerCase());
    if (categoryFilter === 'all') return matchesSearch;
    const cats = CATEGORIES[categoryFilter] || [];
    return matchesSearch && cats.some(c => t.endpoint?.startsWith(c));
  });

  const toggleTemplate = (id: string) => {
    setSelectedTemplateIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleGroup = (id: string) => {
    setSelectedGroupIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  // ── Add new group draft ──
  const addNewGroup = () => {
    if (!draftGroup.display_name.trim()) return;
    setNewGroups(prev => [...prev, draftGroup]);
    setDraftGroup({ display_name: '', group_type: 'static', membership_rule: '' });
    setShowAddGroup(false);
  };

  // ── Simulate ──
  const handleSimulate = async () => {
    setIsSimulating(true);
    setSimulationResult(null);
    try {
      const selectedGroupNames = entraGroups
        .filter(g => selectedGroupIds.includes(g.id))
        .map(g => g.displayName);

      const payload = {
        organization_id: selectedOrgId,
        template_ids: selectedTemplateIds,
        assignment_target: globalTarget,
        assign_to_groups: globalTarget === 'custom_groups' ? [
          ...selectedGroupNames,
          ...newGroups.map(g => g.display_name)
        ] : null,
        create_groups: newGroups.length > 0 ? newGroups : null,
        bypass_validation: isBypassing,
      };

      const res = await apiClient.post('/deployments/simulate', payload);
      setSimulationResult(res.data.simulation_report);
      setSimJobId(res.data.job_id);
      fetchJobs();
    } catch (e: any) {
      alert('Error en simulación: ' + (e.response?.data?.detail || e.message));
    } finally {
      setIsSimulating(false);
    }
  };

  // ── Commit to approval ──
  const handleCommit = async () => {
    if (!simJobId) return;
    try {
      await apiClient.post(`/deployments/${simJobId}/commit`);
      alert('✅ Despliegue enviado a aprobación. Revisa en la consola.');
      fetchJobs();
      setSimulationResult(null);
      setSimJobId(null);
      openConsole(simJobId);
    } catch (e: any) {
      alert('Error: ' + (e.response?.data?.detail || e.message));
    }
  };

  const handleApproval = async (action: 'approve' | 'reject', jobId: string) => {
    try {
      await apiClient.post(`/deployments/${jobId}/${action}`);
      fetchJobs();
      closeConsole();
      alert(action === 'approve' ? '✅ Despliegue aprobado y en ejecución.' : '❌ Despliegue rechazado.');
    } catch (e: any) {
      alert('Error: ' + (e.response?.data?.detail || e.message));
    }
  };

  const selectedOrg = organizations.find(o => o.id === selectedOrgId);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">

      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
            <Rocket className="text-accent-blue" /> Centro de Despliegue
          </h1>
          <p className="text-text-muted text-sm mt-1">Asigna directivas a grupos de Entra ID con flujo de aprobación.</p>
        </div>
        <button onClick={() => fetchJobs()} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary border border-border-color rounded-lg hover:bg-bg-card transition-colors">
          <RefreshCw size={13} /> Actualizar Jobs
        </button>
      </div>

      {/* Two-column layout */}
      <div className="flex gap-6 flex-1 min-h-0">

        {/* LEFT: Wizard */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Step progress */}
          <div className="flex items-center gap-2 mb-5 flex-shrink-0">
            {(['1', '2', '3', '4'] as const).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all
                  ${parseInt(s) === step ? 'bg-accent-blue text-white shadow-[0_0_12px_rgba(59,130,246,0.4)]' :
                    parseInt(s) < step ? 'bg-success/20 text-success border border-success/30' :
                      'bg-bg-card border border-border-color text-text-muted'}`}>
                  {parseInt(s) < step ? <CheckCircle2 size={14} /> : s}
                </div>
                <span className={`text-xs font-medium ${step === parseInt(s) ? 'text-text-primary' : 'text-text-muted'}`}>
                  {['Inquilino', 'Directivas', 'Grupos', 'Revisar'][i]}
                </span>
                {i < 3 && <ChevronRight size={14} className="text-text-muted" />}
              </div>
            ))}
          </div>

          {/* ── STEP 1: Tenant ── */}
          {step === 1 && (
            <div className="glass-panel p-6 flex-1">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Package size={18} className="text-accent-blue" /> Selecciona el Inquilino de Destino</h2>
              <div className="space-y-3">
                {organizations.map(org => (
                  <button
                    key={org.id}
                    onClick={() => setSelectedOrgId(org.id)}
                    className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all
                      ${selectedOrgId === org.id ? 'border-accent-blue bg-accent-blue/5 shadow-[0_0_12px_rgba(59,130,246,0.1)]' : 'border-border-color bg-bg-card hover:border-border-focus hover:bg-bg-panel'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${selectedOrgId === org.id ? 'bg-accent-blue text-white' : 'bg-bg-deep border border-border-color text-text-muted'}`}>
                        <Package size={16} />
                      </div>
                      <div className="text-left">
                        <div className="font-medium text-text-primary">{org.name}</div>
                        <div className="text-xs text-text-muted">{org.tenant_id || 'Sin Tenant ID'}</div>
                      </div>
                    </div>
                    {!org.has_credentials && (
                      <span className="text-xs text-warning bg-warning/10 border border-warning/20 px-2 py-0.5 rounded">Sin credenciales</span>
                    )}
                    {selectedOrgId === org.id && <CheckCircle2 size={18} className="text-accent-blue" />}
                  </button>
                ))}
              </div>
              <div className="flex justify-end mt-6">
                <button disabled={!selectedOrgId} onClick={() => setStep(2)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/90 disabled:opacity-40 transition-colors">
                  Siguiente <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: Templates ── */}
          {step === 2 && (
            <div className="glass-panel p-6 flex-1 flex flex-col">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Filter size={18} className="text-accent-blue" /> Selecciona las Directivas</h2>
              <div className="flex gap-3 mb-4">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input value={templateSearch} onChange={e => setTemplateSearch(e.target.value)}
                    placeholder="Buscar directiva..."
                    className="w-full pl-9 pr-3 py-2 bg-bg-deep border border-border-color rounded-lg text-sm text-text-primary focus:ring-1 focus:ring-accent-blue outline-none" />
                </div>
                <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
                  className="px-3 py-2 bg-bg-deep border border-border-color rounded-lg text-sm text-text-primary outline-none focus:ring-1 focus:ring-accent-blue">
                  <option value="all">Todas</option>
                  <option value="intune">Intune</option>
                  <option value="entra">Entra ID</option>
                  <option value="defender">Defender</option>
                  <option value="exchange">Exchange</option>
                  <option value="teams">Teams</option>
                  <option value="purview">Purview</option>
                </select>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
                {filteredTemplates.length === 0 ? (
                  <div className="text-center py-12 text-text-muted text-sm">No hay directivas que coincidan.</div>
                ) : filteredTemplates.map(t => {
                  const selected = selectedTemplateIds.includes(t.id);
                  return (
                    <button key={t.id} onClick={() => toggleTemplate(t.id)}
                      className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left
                        ${selected ? 'border-accent-blue/50 bg-accent-blue/5' : 'border-border-color bg-bg-card hover:bg-bg-panel'}`}>
                      <div>
                        <div className={`text-sm font-medium ${selected ? 'text-accent-blue' : 'text-text-primary'}`}>{t.name}</div>
                        <div className="text-xs text-text-muted font-mono">{t.endpoint}</div>
                      </div>
                      {selected && <CheckCircle2 size={16} className="text-accent-blue flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-between items-center mt-4 flex-shrink-0">
                <span className="text-xs text-text-muted">{selectedTemplateIds.length} seleccionada(s)</span>
                <div className="flex gap-3">
                  <button onClick={() => setStep(1)} className="flex items-center gap-2 px-4 py-2 border border-border-color rounded-lg text-sm text-text-secondary hover:text-text-primary transition-colors">
                    <ChevronLeft size={16} /> Atrás
                  </button>
                  <button disabled={selectedTemplateIds.length === 0} onClick={() => setStep(3)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/90 disabled:opacity-40 transition-colors">
                    Siguiente <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 3: Groups ── */}
          {step === 3 && (
            <div className="glass-panel p-6 flex-1 flex flex-col">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Users size={18} className="text-accent-blue" /> Asignar a Grupos</h2>
              <div className="mb-4">
                <label className="text-xs text-text-muted uppercase tracking-widest font-bold mb-2 block">Destino Global</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['unassigned', 'all_devices', 'all_users', 'custom_groups'] as const).map(t => (
                    <button key={t} onClick={() => setGlobalTarget(t)}
                      className={`py-2 px-3 rounded-lg text-xs font-medium border transition-all
                        ${globalTarget === t ? 'bg-accent-blue text-white border-accent-blue' : 'border-border-color text-text-secondary hover:bg-bg-panel'}`}>
                      {t === 'unassigned' ? 'Sin asignar' : t === 'all_devices' ? 'Todos los Dispositivos' : t === 'all_users' ? 'Todos los Usuarios' : 'Grupos Específicos'}
                    </button>
                  ))}
                </div>
              </div>

              {globalTarget === 'custom_groups' && (
                <>
                  {/* Search existing groups */}
                  <div className="mb-3">
                    <label className="text-xs text-text-muted uppercase tracking-widest font-bold mb-2 block">Grupos Existentes en Entra ID</label>
                    <div className="flex gap-2 mb-2">
                      <div className="relative flex-1">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                        <input value={groupSearch} onChange={e => setGroupSearch(e.target.value)} placeholder="Buscar grupos..."
                          className="w-full pl-9 pr-3 py-2 bg-bg-deep border border-border-color rounded-lg text-sm text-text-primary focus:ring-1 focus:ring-accent-blue outline-none" />
                      </div>
                      <button onClick={() => loadGroups(groupSearch)} className="px-3 py-2 border border-border-color rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors">
                        <RefreshCw size={14} />
                      </button>
                    </div>
                    {groupsError && <div className="text-xs text-error bg-error/10 p-2 rounded-lg mb-2">{groupsError}</div>}
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {isLoadingGroups ? (
                        <div className="text-center py-4 text-text-muted text-sm">Cargando grupos...</div>
                      ) : entraGroups.map(g => {
                        const isDynamic = g.groupTypes?.includes('DynamicMembership');
                        const selected = selectedGroupIds.includes(g.id);
                        return (
                          <button key={g.id} onClick={() => toggleGroup(g.id)}
                            className={`w-full flex items-center justify-between p-2.5 rounded-lg border text-left transition-all
                              ${selected ? 'border-accent-blue/50 bg-accent-blue/5' : 'border-border-color bg-bg-card hover:bg-bg-panel'}`}>
                            <div>
                              <span className={`text-sm ${selected ? 'text-accent-blue' : 'text-text-primary'}`}>{g.displayName}</span>
                              <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${isDynamic ? 'bg-accent-purple/10 text-accent-purple' : 'bg-bg-deep text-text-muted'}`}>
                                {isDynamic ? 'Dinámico' : 'Estático'}
                              </span>
                            </div>
                            {selected && <CheckCircle2 size={14} className="text-accent-blue flex-shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* New groups to create */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-text-muted uppercase tracking-widest font-bold">Crear Nuevos Grupos</label>
                      <button onClick={() => setShowAddGroup(true)} className="flex items-center gap-1 text-xs text-accent-blue hover:underline">
                        <Plus size={12} /> Agregar
                      </button>
                    </div>
                    {showAddGroup && (
                      <div className="p-3 bg-bg-deep border border-border-color rounded-lg mb-2 space-y-2">
                        <input value={draftGroup.display_name} onChange={e => setDraftGroup(d => ({ ...d, display_name: e.target.value }))}
                          placeholder="Nombre del grupo" className="w-full px-3 py-1.5 bg-bg-card border border-border-color rounded text-sm text-text-primary focus:ring-1 focus:ring-accent-blue outline-none" />
                        <div className="flex gap-2">
                          <select value={draftGroup.group_type} onChange={e => setDraftGroup(d => ({ ...d, group_type: e.target.value as any }))}
                            className="flex-1 px-3 py-1.5 bg-bg-card border border-border-color rounded text-sm text-text-primary outline-none">
                            <option value="static">Estático</option>
                            <option value="dynamic">Dinámico</option>
                          </select>
                        </div>
                        {draftGroup.group_type === 'dynamic' && (
                          <input value={draftGroup.membership_rule} onChange={e => setDraftGroup(d => ({ ...d, membership_rule: e.target.value }))}
                            placeholder='Regla dinámica, ej: (device.deviceOSType -eq "Windows")'
                            className="w-full px-3 py-1.5 bg-bg-card border border-border-color rounded text-sm text-text-primary focus:ring-1 focus:ring-accent-blue outline-none font-mono" />
                        )}
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => setShowAddGroup(false)} className="text-xs text-text-secondary hover:text-text-primary px-2 py-1">Cancelar</button>
                          <button onClick={addNewGroup} className="text-xs bg-accent-blue text-white px-3 py-1 rounded hover:bg-accent-blue/90">Agregar</button>
                        </div>
                      </div>
                    )}
                    <div className="space-y-1 max-h-24 overflow-y-auto">
                      {newGroups.map((g, i) => (
                        <div key={i} className="flex items-center justify-between p-2 bg-bg-card border border-border-color rounded-lg">
                          <div>
                            <span className="text-sm text-text-primary">{g.display_name}</span>
                            <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${g.group_type === 'dynamic' ? 'bg-accent-purple/10 text-accent-purple' : 'bg-bg-deep text-text-muted'}`}>
                              {g.group_type === 'dynamic' ? 'Dinámico (nuevo)' : 'Estático (nuevo)'}
                            </span>
                          </div>
                          <button onClick={() => setNewGroups(prev => prev.filter((_, j) => j !== i))} className="text-text-muted hover:text-error p-1 transition-colors">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="flex justify-between items-center mt-4 flex-shrink-0">
                <button onClick={() => setStep(2)} className="flex items-center gap-2 px-4 py-2 border border-border-color rounded-lg text-sm text-text-secondary hover:text-text-primary transition-colors">
                  <ChevronLeft size={16} /> Atrás
                </button>
                <button onClick={() => setStep(4)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/90 transition-colors">
                  Revisar <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 4: Review & Deploy ── */}
          {step === 4 && (
            <div className="glass-panel p-6 flex-1 flex flex-col overflow-y-auto">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Rocket size={18} className="text-accent-blue" /> Revisar y Simular</h2>

              <div className="space-y-4 mb-6">
                <div className="p-4 bg-bg-card border border-border-color rounded-xl">
                  <div className="text-xs text-text-muted uppercase tracking-widest mb-1">Inquilino</div>
                  <div className="font-medium text-text-primary">{selectedOrg?.name}</div>
                </div>
                <div className="p-4 bg-bg-card border border-border-color rounded-xl">
                  <div className="text-xs text-text-muted uppercase tracking-widest mb-2">Directivas ({selectedTemplateIds.length})</div>
                  <div className="space-y-1">
                    {templates.filter(t => selectedTemplateIds.includes(t.id)).map(t => (
                      <div key={t.id} className="text-sm text-text-secondary flex items-center gap-2">
                        <CheckCircle2 size={12} className="text-success" /> {t.name}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="p-4 bg-bg-card border border-border-color rounded-xl">
                  <div className="text-xs text-text-muted uppercase tracking-widest mb-1">Asignación</div>
                  <div className="text-sm text-text-secondary capitalize">{globalTarget.replace('_', ' ')}</div>
                  {globalTarget === 'custom_groups' && (
                    <div className="mt-2 space-y-1">
                      {entraGroups.filter(g => selectedGroupIds.includes(g.id)).map(g => (
                        <span key={g.id} className="inline-block text-xs bg-accent-blue/10 text-accent-blue border border-accent-blue/20 px-2 py-0.5 rounded mr-1">{g.displayName}</span>
                      ))}
                      {newGroups.map((g, i) => (
                        <span key={i} className="inline-block text-xs bg-accent-purple/10 text-accent-purple border border-accent-purple/20 px-2 py-0.5 rounded mr-1">{g.display_name} (nuevo)</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 mb-4">
                <input type="checkbox" id="bypass" checked={isBypassing} onChange={e => setIsBypassing(e.target.checked)}
                  className="w-4 h-4 accent-accent-blue" />
                <label htmlFor="bypass" className="text-sm text-text-secondary">Omitir validaciones de licencia / capacidad</label>
              </div>

              {simulationResult && (
                <div className="mb-4 p-4 bg-bg-deep border border-border-color rounded-xl">
                  <div className="text-xs text-text-muted uppercase tracking-widest mb-2">Resultado de Simulación</div>
                  <div className="text-sm text-success">
                    ✓ Simulación completada. {simulationResult.applied?.length ?? 0} directiva(s) verificadas.
                  </div>
                  {simJobId && (
                    <button onClick={() => openConsole(simJobId)} className="mt-2 flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary">
                      <Eye size={12} /> Ver logs de simulación
                    </button>
                  )}
                </div>
              )}

              <div className="flex gap-3 mt-auto flex-shrink-0">
                <button onClick={() => setStep(3)} className="flex items-center gap-2 px-4 py-2 border border-border-color rounded-lg text-sm text-text-secondary hover:text-text-primary transition-colors">
                  <ChevronLeft size={16} /> Atrás
                </button>
                {!simulationResult ? (
                  <button onClick={handleSimulate} disabled={isSimulating}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-accent-blue text-white rounded-lg text-sm font-medium hover:bg-accent-blue/90 disabled:opacity-50 transition-colors">
                    {isSimulating ? <><RefreshCw size={14} className="animate-spin" /> Simulando...</> : <><Terminal size={14} /> Ejecutar Simulación</>}
                  </button>
                ) : (
                  <button onClick={handleCommit}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-success text-white rounded-lg text-sm font-medium hover:bg-success/90 transition-colors">
                    <Rocket size={14} /> Enviar a Aprobación
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: Recent Jobs */}
        <div className="w-80 flex-shrink-0 flex flex-col">
          <div className="glass-panel flex-1 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-border-color flex-shrink-0">
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2"><Terminal size={14} className="text-accent-blue" /> Historial de Despliegues</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {jobs.length === 0 ? (
                <div className="text-center py-8 text-text-muted text-sm">Sin despliegues aún.</div>
              ) : jobs.slice(0, 20).map((job: Job) => {
                const org = organizations.find(o => o.id === job.organization_id);
                return (
                  <div key={job.id} className="p-3 bg-bg-card border border-border-color rounded-xl hover:border-border-focus transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-text-primary truncate max-w-[120px]">{org?.name || 'Inquilino'}</span>
                      <StatusBadge status={job.status} />
                    </div>
                    <div className="text-xs text-text-muted mb-2">{new Date(job.created_at).toLocaleString()}</div>
                    <div className="flex gap-1.5">
                      <button onClick={() => openConsole(job.id)}
                        className="flex-1 flex items-center justify-center gap-1 py-1 text-xs border border-border-color rounded-md hover:bg-bg-panel text-text-secondary hover:text-text-primary transition-colors">
                        <Eye size={11} /> Logs
                      </button>
                      {job.status === 'pending_approval' && (
                        <>
                          <button onClick={() => handleApproval('approve', job.id)}
                            className="flex items-center gap-1 py-1 px-2 text-xs bg-success/10 text-success border border-success/20 rounded-md hover:bg-success/20 transition-colors">
                            <ThumbsUp size={11} />
                          </button>
                          <button onClick={() => handleApproval('reject', job.id)}
                            className="flex items-center gap-1 py-1 px-2 text-xs bg-error/10 text-error border border-error/20 rounded-md hover:bg-error/20 transition-colors">
                            <ThumbsDown size={11} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Live Console Modal ── */}
      {consoleJobId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-4xl h-[80vh] flex flex-col relative border-accent-blue/30 shadow-[0_0_30px_rgba(59,130,246,0.1)]">
            <div className="flex items-center justify-between p-4 border-b border-border-color bg-bg-panel/50 flex-shrink-0">
              <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                <Terminal size={20} className="text-accent-blue" /> Consola de Despliegue
                <span className="text-xs font-mono text-text-muted">[{consoleJobId.substring(0, 8)}...]</span>
                {consoleStatus && <StatusBadge status={consoleStatus} />}
              </h3>
              <div className="flex items-center gap-2">
                {consoleStatus === 'pending_approval' && (
                  <>
                    <button onClick={() => handleApproval('reject', consoleJobId)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-error/10 text-error hover:bg-error/20 border border-error/20 transition-colors">
                      <ThumbsDown size={14} /> Rechazar
                    </button>
                    <button onClick={() => handleApproval('approve', consoleJobId)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-success/10 text-success hover:bg-success/20 border border-success/20 transition-colors">
                      <ThumbsUp size={14} /> Aprobar
                    </button>
                  </>
                )}
                {consoleStatus === 'simulated' && (
                  <button onClick={async () => { await apiClient.post(`/deployments/${consoleJobId}/commit`); fetchJobs(); closeConsole(); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 border border-accent-blue/20 transition-colors">
                    <PlayCircle size={14} /> Enviar a Aprobación
                  </button>
                )}
                <button onClick={closeConsole} className="text-text-muted hover:text-text-primary p-1 rounded transition-colors"><X size={20} /></button>
              </div>
            </div>
            <div className="flex-1 bg-black p-4 overflow-y-auto font-mono text-sm">
              {consoleLogs.length === 0 ? (
                <div className="text-text-muted flex items-center gap-2"><Clock size={14} className="animate-spin" /> Esperando logs...</div>
              ) : consoleLogs.map((log, idx) => (
                <div key={idx} className="mb-1">
                  <span className="text-text-muted">[{new Date(log.timestamp || Date.now()).toLocaleTimeString()}] </span>
                  <span className={(log.level || '') === 'ERROR' ? 'text-error' : (log.level || '') === 'WARNING' ? 'text-warning' : (log.level || '') === 'SUCCESS' ? 'text-success' : 'text-text-secondary'}>
                    {typeof log === 'string' ? log : log.message}
                  </span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
