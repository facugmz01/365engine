import { useState } from 'react';
import { Download, UploadCloud, FileJson, Server, Activity, Eye } from 'lucide-react';
import { apiClient } from '../api/client';
import { useStore } from '../store/useStore';
import SnapshotPreviewModal from '../components/SnapshotPreviewModal';

const PREDEFINED_ENDPOINTS: Record<string, string[]> = {
  intune: [
    "deviceManagement/configurationPolicies",
    "deviceManagement/deviceConfigurations",
    "deviceManagement/deviceCompliancePolicies",
    "deviceAppManagement/managedAppPolicies",
    "deviceManagement/groupPolicyConfigurations"
  ],
  entra: [
    "identity/conditionalAccess/policies",
    "identity/conditionalAccess/namedLocations",
    "policies/authenticationMethodsPolicy/authenticationMethodConfigurations",
    "directory/administrativeUnits"
  ],
  defender: [
    "security/cases/edr/alerts",
    "security/alerts"
  ],
  exchange: [],
  purview: [],
  teams: [],
  sharepoint: []
};

export default function Import() {
  const [importMode, setImportMode] = useState<'live' | 'tcm' | 'backup'>('live');
  const [isImporting, setIsImporting] = useState(false);
  const [isFetchingLivePreview, setIsFetchingLivePreview] = useState(false);
  const [importLog, setImportLog] = useState<string[]>([]);
  const { organizations, fetchOrganizations } = useStore();

  // Live tenant import (from a live tenant via Graph API)
  const [liveOrgId, setLiveOrgId] = useState('');
  const [liveEndpoint, setLiveEndpoint] = useState('');
  const [liveCategory, setLiveCategory] = useState('intune');
  const [importAllEndpoints, setImportAllEndpoints] = useState(false);

  // TCM snapshot import
  const [tcmOrgId, setTcmOrgId] = useState('');
  const [tcmWorkloads, setTcmWorkloads] = useState('entra,intune,defender,purview,teams');

  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [isFetchingPreview, setIsFetchingPreview] = useState(false);

  const addLog = (msg: string) => setImportLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const handleLivePreview = async () => {
    if (!liveOrgId) {
      alert('Selecciona un inquilino.');
      return;
    }
    if (!importAllEndpoints && !liveEndpoint) {
      alert('Especifica el endpoint o marca la opción de importar todos.');
      return;
    }
    
    setIsFetchingLivePreview(true);
    addLog('Obteniendo vista previa de políticas en vivo...');
    
    try {
      const endpointsToFetch = importAllEndpoints ? (PREDEFINED_ENDPOINTS[liveCategory] || []) : [liveEndpoint];
      if (endpointsToFetch.length === 0) {
         addLog(`⚠ No hay endpoints para previsualizar.`);
         setIsFetchingLivePreview(false);
         return;
      }
      
      const response = await apiClient.post('/templates/preview', {
        organization_id: liveOrgId,
        endpoints: endpointsToFetch
      });
      
      setPreviewData(response.data.data || []);
      setIsPreviewMode(true);
      addLog(`✓ Vista previa obtenida: ${response.data.data?.length || 0} políticas extraídas de ${endpointsToFetch.length} endpoint(s).`);
    } catch (error: any) {
      addLog(`✗ Error en vista previa: ${error.response?.data?.detail || error.message}`);
    } finally {
      setIsFetchingLivePreview(false);
    }
  };

  const handleLiveImport = async () => {
    if (!liveOrgId) {
      alert('Selecciona un inquilino.');
      return;
    }
    if (!importAllEndpoints && !liveEndpoint) {
      alert('Especifica el endpoint o marca la opción de importar todos.');
      return;
    }
    setIsImporting(true);
    addLog('Iniciando importación desde inquilino activo...');
    try {
      if (importAllEndpoints) {
        const endpointsToFetch = PREDEFINED_ENDPOINTS[liveCategory] || [];
        if (endpointsToFetch.length === 0) {
          addLog(`⚠ No hay endpoints predefinidos configurados para la categoría ${liveCategory}.`);
        }
        for (const ep of endpointsToFetch) {
          try {
            const response = await apiClient.post('/templates/import', {
              organization_id: liveOrgId,
              endpoint: ep,
              category: liveCategory,
            });
            addLog(`✓ ${ep}: ${response.data.message}`);
          } catch (epError: any) {
             addLog(`✗ Error en ${ep}: ${epError.response?.data?.detail || epError.message}`);
          }
        }
        addLog('Importación masiva completada.');
      } else {
        const response = await apiClient.post('/templates/import', {
          organization_id: liveOrgId,
          endpoint: liveEndpoint,
          category: liveCategory,
        });
        addLog(`✓ ${response.data.message}`);
        addLog(`  Organización: ${response.data.organization_name}`);
        addLog(`  Endpoint: ${response.data.endpoint}`);
      }
    } catch (error: any) {
      addLog(`✗ Error general: ${error.response?.data?.detail || error.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleTcmImport = async () => {
    if (!tcmOrgId) {
      alert('Por favor selecciona un inquilino.');
      return;
    }
    setIsImporting(true);
    addLog('Iniciando importación TCM Snapshot...');
    try {
      // Backend: POST /api/v1/templates/import-tcm
      const workloadList = tcmWorkloads.split(',').map(w => w.trim()).filter(Boolean);
      const response = await apiClient.post('/templates/import-tcm', {
        organization_id: tcmOrgId,
        workloads: workloadList,
      });
      addLog(`✓ ${response.data.message}`);
      addLog(`  Organización: ${response.data.organization_name}`);
      addLog(`  Workloads: ${response.data.workloads?.join(', ')}`);
    } catch (error: any) {
      addLog(`✗ Error: ${error.response?.data?.detail || error.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleTcmPreview = async () => {
    if (!tcmOrgId) {
      alert('Por favor selecciona un inquilino.');
      return;
    }
    setIsFetchingPreview(true);
    addLog('Obteniendo vista previa del Snapshot TCM...');
    try {
      const workloadList = tcmWorkloads.split(',').map(w => w.trim()).filter(Boolean);
      const response = await apiClient.post('/snapshots/fetch', {
        organization_id: tcmOrgId,
        workloads: workloadList,
      });
      setPreviewData(response.data.data || []);
      setIsPreviewMode(true);
      addLog(`✓ Vista previa obtenida: ${response.data.data?.length || 0} ítems encontrados.`);
    } catch (error: any) {
      addLog(`✗ Error en vista previa: ${error.response?.data?.detail || error.message}`);
    } finally {
      setIsFetchingPreview(false);
    }
  };

  // Load organizations if needed
  const ensureOrgs = () => {
    if (organizations.length === 0) fetchOrganizations();
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
      <div className="flex items-center justify-between mb-8 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
            <Download className="text-accent-blue" /> Importar Configuraciones
          </h1>
          <p className="text-text-muted text-sm mt-1">Ingesta plantillas desde entornos existentes o respaldos.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          {/* Mode selector */}
          <div className="flex gap-2 p-1 bg-bg-deep rounded-xl border border-border-color">
            {[
              { id: 'live', label: 'Desde Tenant Activo', icon: Activity },
              { id: 'tcm', label: 'TCM Snapshot', icon: Server },
              { id: 'backup', label: 'Backup ZIP', icon: FileJson },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => { setImportMode(id as any); ensureOrgs(); }}
                className={`flex-1 px-4 py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-all ${
                  importMode === id
                    ? 'bg-bg-card shadow-sm text-text-primary border border-border-color'
                    : 'text-text-secondary hover:text-text-primary border border-transparent'
                }`}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>

          <div className="glass-panel p-8">
            {/* Live Tenant Import */}
            {importMode === 'live' && (
              <div className="animate-in fade-in">
                <h2 className="text-lg font-semibold text-text-primary mb-2">Importar desde Tenant Activo</h2>
                <p className="text-text-muted text-sm mb-6">Extrae configuraciones directamente de un inquilino conectado via Microsoft Graph API.</p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1.5">Inquilino Origen</label>
                    <select
                      value={liveOrgId}
                      onChange={(e) => setLiveOrgId(e.target.value)}
                      className="w-full px-3 py-2.5 bg-bg-deep border border-border-color rounded-lg text-text-primary focus:ring-1 focus:ring-accent-blue outline-none"
                    >
                      <option value="">-- Selecciona un inquilino --</option>
                      {organizations.map(org => (
                        <option key={org.id} value={org.id}>{org.name}{!org.has_credentials ? ' (Sin credenciales)' : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1.5">Graph API Endpoint</label>
                    <input
                      type="text"
                      list="endpoints-list"
                      value={liveEndpoint}
                      onChange={(e) => setLiveEndpoint(e.target.value)}
                      disabled={importAllEndpoints}
                      className="w-full px-4 py-2.5 bg-bg-deep border border-border-color rounded-lg text-text-primary focus:ring-1 focus:ring-accent-blue outline-none font-mono text-sm disabled:opacity-50"
                      placeholder={importAllEndpoints ? "Se importarán todos los endpoints predefinidos" : "Ej: deviceManagement/configurationPolicies"}
                    />
                    <datalist id="endpoints-list">
                      {PREDEFINED_ENDPOINTS[liveCategory]?.map(ep => (
                        <option key={ep} value={ep} />
                      ))}
                    </datalist>
                  </div>
                  <div className="flex items-center gap-2 mt-1 mb-2">
                    <input 
                      type="checkbox" 
                      id="importAll" 
                      checked={importAllEndpoints}
                      onChange={(e) => setImportAllEndpoints(e.target.checked)}
                      className="rounded border-border-color bg-bg-deep text-accent-blue focus:ring-accent-blue"
                    />
                    <label htmlFor="importAll" className="text-sm text-text-secondary cursor-pointer">
                      Importar todos los endpoints comunes de esta categoría
                    </label>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1.5">Categoría</label>
                    <select
                      value={liveCategory}
                      onChange={(e) => setLiveCategory(e.target.value)}
                      className="w-full px-3 py-2.5 bg-bg-deep border border-border-color rounded-lg text-text-primary focus:ring-1 focus:ring-accent-blue outline-none"
                    >
                      <option value="intune">Intune</option>
                      <option value="entra">Entra ID</option>
                      <option value="defender">Defender</option>
                      <option value="purview">Purview</option>
                      <option value="exchange">Exchange</option>
                      <option value="sharepoint">SharePoint</option>
                      <option value="teams">Teams</option>
                    </select>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={handleLivePreview}
                      disabled={isFetchingLivePreview || isImporting || !liveOrgId}
                      className="btn w-full py-2.5 bg-bg-panel hover:bg-bg-card border border-border-color text-text-primary rounded-lg transition-colors font-medium text-sm flex justify-center items-center gap-2 disabled:opacity-50"
                    >
                      {isFetchingLivePreview ? <Activity size={18} className="animate-spin" /> : <Eye size={18} />}
                      Vista Previa
                    </button>
                    <button
                      onClick={handleLiveImport}
                      disabled={isImporting || isFetchingLivePreview || !liveOrgId}
                      className="btn btn-primary w-full py-2.5 bg-accent-blue hover:bg-accent-blue/90 text-white rounded-lg transition-colors font-medium text-sm flex justify-center items-center gap-2 disabled:opacity-50"
                    >
                      {isImporting ? <Activity size={18} className="animate-spin" /> : <UploadCloud size={18} />}
                      {isImporting ? 'Importando...' : 'Iniciar Importación'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TCM Snapshot Import */}
            {importMode === 'tcm' && (
              <div className="animate-in fade-in">
                <h2 className="text-lg font-semibold text-text-primary mb-2">Importar desde TCM Snapshot</h2>
                <p className="text-text-muted text-sm mb-6">Extrae configuraciones usando la API de Tenant Configuration Management de Microsoft.</p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1.5">Inquilino Origen</label>
                    <select
                      value={tcmOrgId}
                      onChange={(e) => setTcmOrgId(e.target.value)}
                      className="w-full px-3 py-2.5 bg-bg-deep border border-border-color rounded-lg text-text-primary focus:ring-1 focus:ring-accent-blue outline-none"
                    >
                      <option value="">-- Selecciona un inquilino --</option>
                      {organizations.map(org => (
                        <option key={org.id} value={org.id}>{org.name}{!org.has_credentials ? ' (Sin credenciales)' : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1.5">Workloads (separados por coma)</label>
                    <input
                      type="text"
                      value={tcmWorkloads}
                      onChange={(e) => setTcmWorkloads(e.target.value)}
                      className="w-full px-4 py-2.5 bg-bg-deep border border-border-color rounded-lg text-text-primary focus:ring-1 focus:ring-accent-blue outline-none font-mono text-sm"
                      placeholder="entra,intune,defender,purview,teams"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={handleTcmPreview}
                      disabled={isFetchingPreview || isImporting || !tcmOrgId}
                      className="btn w-full py-2.5 bg-bg-panel hover:bg-bg-card border border-border-color text-text-primary rounded-lg transition-colors font-medium text-sm flex justify-center items-center gap-2 disabled:opacity-50"
                    >
                      {isFetchingPreview ? <Activity size={18} className="animate-spin" /> : <Eye size={18} />}
                      Vista Previa
                    </button>
                    <button
                      onClick={handleTcmImport}
                      disabled={isImporting || isFetchingPreview || !tcmOrgId}
                      className="btn btn-primary w-full py-2.5 bg-accent-blue hover:bg-accent-blue/90 text-white rounded-lg transition-colors font-medium text-sm flex justify-center items-center gap-2 disabled:opacity-50"
                    >
                      {isImporting ? <Activity size={18} className="animate-spin" /> : <Server size={18} />}
                      Auto-Importar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Backup ZIP (placeholder - no backend endpoint) */}
            {importMode === 'backup' && (
              <div className="animate-in fade-in">
                <h2 className="text-lg font-semibold text-text-primary mb-2">Subir Backup Local</h2>
                <p className="text-text-muted text-sm mb-6">Sube un archivo ZIP o JSON con plantillas exportadas manualmente.</p>

                <div className="border-2 border-dashed border-border-color rounded-xl p-10 text-center hover:border-accent-blue/50 transition-colors bg-bg-deep/50 cursor-pointer">
                  <div className="w-12 h-12 rounded-full bg-bg-panel flex items-center justify-center mx-auto mb-4 text-accent-blue">
                    <UploadCloud size={24} />
                  </div>
                  <h3 className="text-text-primary font-medium mb-1">Haz clic o arrastra un archivo</h3>
                  <p className="text-text-muted text-xs">Soporta ZIP y JSON hasta 50MB</p>
                  <p className="text-text-muted text-xs mt-3 italic">(Funcionalidad en desarrollo)</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Import Log */}
        <div>
          <div className="glass-panel p-6 h-full flex flex-col border-dashed border-border-color/50 bg-bg-deep/20">
            <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wider mb-4 flex items-center justify-between">
              Registro de Importación
              {importLog.length > 0 && (
                <button
                  onClick={() => setImportLog([])}
                  className="text-xs text-text-muted hover:text-text-primary transition-colors normal-case tracking-normal"
                >
                  Limpiar
                </button>
              )}
            </h3>
            {importLog.length === 0 ? (
              <div className="flex flex-col items-center justify-center flex-1 text-text-muted">
                <Download size={32} className="opacity-30 mb-3" />
                <p className="text-sm">Inicia una importación para ver el registro aquí.</p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto font-mono text-xs space-y-1">
                {importLog.map((line, idx) => (
                  <div
                    key={idx}
                    className={`${
                      line.includes('✓') ? 'text-success' :
                      line.includes('✗') ? 'text-error' :
                      'text-text-secondary'
                    }`}
                  >
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      
      <SnapshotPreviewModal 
        isOpen={isPreviewMode} 
        onClose={() => setIsPreviewMode(false)} 
        data={previewData || []} 
        title={importMode === 'live' ? "Vista Previa de Tenant Activo" : "Vista Previa de Snapshot TCM"}
        sourceMode={importMode === 'live' ? 'live' : 'tcm'}
      />
    </div>
  );
}
