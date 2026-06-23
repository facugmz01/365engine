import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { ArrowLeft, KeyRound, Activity, AlertTriangle, ShieldCheck, X, RefreshCw } from 'lucide-react';
import { apiClient } from '../api/client';

interface OrgDetails {
  id: string;
  name: string;
  tenant_id: string;
  has_credentials: boolean;
  auto_drift_enabled: boolean;
  drift_scan_schedule: string | null;
  deployments: { id: string; status: string; created_at: string }[];
  drift_reports: { id: string; created_at: string; drifts_found: number; source: string; details: any }[];
}

export default function TenantDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { fetchOrganizations } = useStore();
  const [orgDetails, setOrgDetails] = useState<OrgDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  // Modal state
  const [showCredModal, setShowCredModal] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  const loadOrgDetails = async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      // Use GET /api/v1/organizations/{org_id}/details which returns the extended view
      const response = await apiClient.get(`/organizations/${id}/details`);
      setOrgDetails(response.data);
    } catch (err: any) {
      console.error('Failed to load org details', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOrgDetails();
  }, [id]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <div className="w-8 h-8 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!orgDetails) {
    return (
      <div className="p-8 text-text-muted text-center">
        <AlertTriangle size={32} className="mx-auto mb-3 opacity-50" />
        No se encontró el inquilino o hubo un error al cargar los datos.
      </div>
    );
  }

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      // Backend: POST /api/v1/organizations/{org_id}/credentials
      await apiClient.post(`/organizations/${orgDetails.id}/credentials`, {
        client_id: clientId,
        client_secret: clientSecret,
      });
      setShowCredModal(false);
      setClientId('');
      setClientSecret('');
      await loadOrgDetails();        // Reload details
      await fetchOrganizations();    // Refresh global store
    } catch (error: any) {
      alert('Error al guardar credenciales: ' + (error.response?.data?.detail || error.message));
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    try {
      // Backend: GET /api/v1/organizations/{org_id}/validate
      const response = await apiClient.get(`/organizations/${orgDetails.id}/validate`);
      alert('Validación completada:\n\n' + JSON.stringify(response.data, null, 2));
    } catch (error: any) {
      alert('Error en la prueba de conexión: ' + (error.response?.data?.detail || error.message));
    } finally {
      setIsTesting(false);
    }
  };

  const handleScanDrift = async () => {
    setIsScanning(true);
    try {
      // Backend: POST /api/v1/organizations/{org_id}/drift-scan
      const response = await apiClient.post(`/organizations/${orgDetails.id}/drift-scan`);
      alert('Escaneo de drift completado:\n\n' + JSON.stringify(response.data, null, 2));
      await loadOrgDetails();
    } catch (error: any) {
      alert('Error en el escaneo de drift: ' + (error.response?.data?.detail || error.message));
    } finally {
      setIsScanning(false);
    }
  };

  const getJobStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed': return 'text-success bg-success/10 border-success/20';
      case 'failed': return 'text-error bg-error/10 border-error/20';
      case 'running': return 'text-accent-blue bg-accent-blue/10 border-accent-blue/20';
      case 'pending_approval': return 'text-warning bg-warning/10 border-warning/20';
      default: return 'text-text-secondary bg-bg-deep border-border-color';
    }
  };

  return (
    <div className="animate-in fade-in duration-300">
      <button
        onClick={() => navigate('/tenants')}
        className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors mb-6 text-sm font-medium"
      >
        <ArrowLeft size={16} />
        Volver a Inquilinos
      </button>

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-3">
            {orgDetails.name}
            {orgDetails.has_credentials ? (
              <span className="px-2.5 py-0.5 rounded-full bg-success/10 text-success border border-success/20 text-xs font-semibold flex items-center gap-1">
                <ShieldCheck size={14} /> Activo
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full bg-warning/10 text-warning border border-warning/20 text-xs font-semibold flex items-center gap-1">
                <AlertTriangle size={14} /> Sin Credenciales
              </span>
            )}
          </h1>
          <p className="text-text-muted text-sm font-mono mt-1">Tenant ID: {orgDetails.tenant_id}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={loadOrgDetails}
            className="btn btn-secondary px-3 py-2 border border-border-color rounded-lg bg-bg-card hover:bg-bg-card-hover transition-colors text-sm font-medium flex items-center gap-2 text-text-secondary"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => setShowCredModal(true)}
            className="btn btn-secondary px-4 py-2 border border-border-color rounded-lg bg-bg-card hover:bg-bg-card-hover transition-colors text-sm font-medium flex items-center gap-2 text-text-primary"
          >
            <KeyRound size={16} />
            Actualizar Credenciales
          </button>
          <button
            onClick={handleScanDrift}
            className="btn btn-secondary px-4 py-2 border border-border-color rounded-lg bg-bg-card hover:bg-bg-card-hover transition-colors text-sm font-medium flex items-center gap-2 text-text-primary disabled:opacity-50"
            disabled={!orgDetails.has_credentials || isScanning}
          >
            <Activity size={16} className={isScanning ? 'animate-spin' : ''} />
            {isScanning ? 'Escaneando...' : 'Escanear Drift'}
          </button>
          <button
            onClick={handleTestConnection}
            className="btn btn-primary px-4 py-2 bg-accent-blue hover:bg-accent-blue/90 text-white rounded-lg transition-colors text-sm font-medium flex items-center gap-2 disabled:opacity-50"
            disabled={!orgDetails.has_credentials || isTesting}
          >
            <ShieldCheck size={16} className={isTesting ? 'animate-spin' : ''} />
            {isTesting ? 'Probando...' : 'Test Conexión'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border-color">
        {['overview', 'deployments', 'drift'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${
              activeTab === tab
                ? 'border-accent-blue text-accent-blue'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {tab === 'overview' ? 'Ficha Técnica' : tab === 'deployments' ? 'Despliegues' : 'Drift Reports'}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="glass-panel p-6">
            <h3 className="text-lg font-semibold mb-4 text-text-primary border-b border-border-color pb-2">Información del Entorno</h3>
            <div className="space-y-4">
              <div>
                <p className="text-text-muted text-xs uppercase tracking-wider mb-1">Nombre Comercial</p>
                <p className="text-text-primary font-medium">{orgDetails.name}</p>
              </div>
              <div>
                <p className="text-text-muted text-xs uppercase tracking-wider mb-1">Microsoft Tenant ID</p>
                <p className="text-text-primary font-mono text-sm break-all">{orgDetails.tenant_id}</p>
              </div>
              <div>
                <p className="text-text-muted text-xs uppercase tracking-wider mb-1">Credenciales</p>
                <p className={orgDetails.has_credentials ? 'text-success font-medium' : 'text-warning font-medium'}>
                  {orgDetails.has_credentials ? '✓ Configuradas' : '✗ No configuradas'}
                </p>
              </div>
            </div>
          </div>

          <div className="glass-panel p-6">
            <h3 className="text-lg font-semibold mb-4 text-text-primary border-b border-border-color pb-2">Automatización (Drift)</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-text-primary font-medium">Análisis Automático</p>
                  <p className="text-text-muted text-sm">Detectar cambios no autorizados diariamente</p>
                </div>
                <div className={`w-12 h-6 rounded-full transition-colors relative ${orgDetails.auto_drift_enabled ? 'bg-success' : 'bg-bg-card-hover'}`}>
                  <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${orgDetails.auto_drift_enabled ? 'translate-x-6' : ''}`}></div>
                </div>
              </div>
              {orgDetails.auto_drift_enabled && orgDetails.drift_scan_schedule && (
                <div>
                  <p className="text-text-muted text-xs uppercase tracking-wider mb-1">Horario Programado (UTC)</p>
                  <p className="text-text-primary font-mono text-sm">{orgDetails.drift_scan_schedule}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Deployments Tab */}
      {activeTab === 'deployments' && (
        <div className="glass-panel overflow-hidden">
          {orgDetails.deployments.length === 0 ? (
            <div className="text-center py-12 text-text-muted">
              <Activity size={32} className="mx-auto mb-3 opacity-50" />
              <p>No hay despliegues registrados para este inquilino.</p>
            </div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-text-muted uppercase bg-bg-panel border-b border-border-color">
                <tr>
                  <th className="px-6 py-4 font-semibold">Job ID</th>
                  <th className="px-6 py-4 font-semibold">Estado</th>
                  <th className="px-6 py-4 font-semibold">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-color">
                {orgDetails.deployments.map(dep => (
                  <tr key={dep.id} className="hover:bg-bg-panel/30 transition-colors">
                    <td className="px-6 py-4 font-mono text-xs text-text-secondary">{dep.id.substring(0, 16)}...</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${getJobStatusColor(dep.status)}`}>
                        {dep.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-text-secondary text-xs">{new Date(dep.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Drift Reports Tab */}
      {activeTab === 'drift' && (
        <div className="glass-panel overflow-hidden">
          {orgDetails.drift_reports.length === 0 ? (
            <div className="text-center py-12 text-text-muted">
              <Activity size={32} className="mx-auto mb-3 opacity-50" />
              <p>No hay reportes de drift para este inquilino.</p>
            </div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-text-muted uppercase bg-bg-panel border-b border-border-color">
                <tr>
                  <th className="px-6 py-4 font-semibold">Fecha</th>
                  <th className="px-6 py-4 font-semibold">Drifts Detectados</th>
                  <th className="px-6 py-4 font-semibold">Origen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-color">
                {orgDetails.drift_reports.map(rep => (
                  <tr key={rep.id} className="hover:bg-bg-panel/30 transition-colors">
                    <td className="px-6 py-4 text-text-secondary text-xs">{new Date(rep.created_at).toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <span className={rep.drifts_found > 0 ? 'text-warning font-semibold' : 'text-success'}>
                        {rep.drifts_found}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-0.5 rounded bg-bg-deep border border-border-color text-xs text-text-secondary capitalize">{rep.source}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Credentials Modal */}
      {showCredModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-md p-6 relative">
            <button
              onClick={() => setShowCredModal(false)}
              className="absolute top-4 right-4 text-text-muted hover:text-text-primary transition-colors"
            >
              <X size={20} />
            </button>

            <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2 mb-6">
              <KeyRound size={20} className="text-accent-blue" />
              Configurar Credenciales
            </h3>

            <form onSubmit={handleSaveCredentials} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Application (Client) ID</label>
                <input
                  type="text"
                  required
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-deep border border-border-color rounded-lg text-text-primary focus:ring-1 focus:ring-accent-blue outline-none"
                  placeholder="ID de la aplicación Entra ID"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Client Secret</label>
                <input
                  type="password"
                  required
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-deep border border-border-color rounded-lg text-text-primary focus:ring-1 focus:ring-accent-blue outline-none"
                  placeholder="Valor del secreto"
                />
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowCredModal(false)}
                  className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 bg-accent-blue text-white text-sm font-medium rounded-lg hover:bg-accent-blue/90 disabled:opacity-50 transition-colors"
                >
                  {isSaving ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
