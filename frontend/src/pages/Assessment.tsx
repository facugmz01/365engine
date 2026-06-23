import { useState, useEffect } from 'react';
import { Shield, Play, FileText, CheckCircle, AlertCircle } from 'lucide-react';
import { apiClient } from '../api/client';
import { useStore } from '../store/useStore';

export default function Assessment() {
  const { organizations, fetchOrganizations } = useStore();
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [clientId, setClientId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [certData, setCertData] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    if (organizations.length === 0) {
      fetchOrganizations();
    }
  }, [organizations, fetchOrganizations]);

  // When an org is selected, auto-fill tenant ID if possible
  useEffect(() => {
    if (selectedOrgId) {
      const org = organizations.find(o => o.id === selectedOrgId);
      if (org && org.tenant_id) {
        setTenantId(org.tenant_id);
      }
    }
  }, [selectedOrgId, organizations]);

  const handleRunAssessment = async () => {
    if (!selectedOrgId) {
      setMessage({ text: 'Por favor, selecciona una organización', type: 'error' });
      return;
    }

    setIsSubmitting(true);
    setMessage({ text: 'Iniciando evaluación en segundo plano...', type: 'info' });

    try {
      await apiClient.post('/assessment/run', {
        organization_id: selectedOrgId,
        client_id: clientId || undefined,
        tenant_id: tenantId || undefined,
        certificate_data: certData || undefined,
      });
      setMessage({ text: 'La evaluación de Zero Trust ha comenzado. Puede tomar varios minutos. Refresca el reporte más tarde.', type: 'success' });
    } catch (error: any) {
      setMessage({ text: `Error: ${error.response?.data?.detail || error.message}`, type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const reportUrl = selectedOrgId ? `${import.meta.env.VITE_API_URL || ''}/api/v1/assessment/report/${selectedOrgId}` : null;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
      <div className="flex items-center justify-between mb-8 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
            <Shield className="text-neon-cyan" /> Zero Trust Assessment
          </h1>
          <p className="text-text-muted text-sm mt-1">Evalúa la configuración de seguridad de tu inquilino utilizando la herramienta oficial de Microsoft.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1">
        
        {/* Left Column: Configuration */}
        <div className="glass-panel p-6 flex flex-col h-full lg:col-span-1">
          <h2 className="text-lg font-semibold text-text-primary mb-4 border-b border-border-color pb-2">Configuración</h2>
          
          <div className="space-y-5 flex-1">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">Organización</label>
              <select
                value={selectedOrgId}
                onChange={(e) => setSelectedOrgId(e.target.value)}
                className="w-full px-3 py-2.5 bg-bg-deep border border-border-color rounded-lg text-text-primary focus:ring-1 focus:ring-neon-cyan outline-none"
              >
                <option value="">-- Selecciona una organización --</option>
                {organizations.map(org => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            </div>

            <div className="bg-bg-deep/50 p-4 rounded-lg border border-border-color space-y-4">
              <p className="text-xs text-text-muted mb-2">
                Credenciales de Service Principal (Opcional si la organización ya tiene credenciales configuradas)
              </p>
              
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Tenant ID</label>
                <input
                  type="text"
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-deep border border-border-color rounded text-text-primary text-sm focus:ring-1 focus:ring-neon-cyan outline-none font-mono"
                  placeholder="00000000-0000-0000-0000-000000000000"
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Client ID (App ID)</label>
                <input
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-deep border border-border-color rounded text-text-primary text-sm focus:ring-1 focus:ring-neon-cyan outline-none font-mono"
                  placeholder="00000000-0000-0000-0000-000000000000"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">Certificado (Base64 PFX)</label>
                <textarea
                  value={certData}
                  onChange={(e) => setCertData(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-deep border border-border-color rounded text-text-primary text-xs focus:ring-1 focus:ring-neon-cyan outline-none font-mono h-24 resize-none"
                  placeholder="MIIJQIBAz..."
                />
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-border-color space-y-4">
            {message && (
              <div className={`p-3 rounded-lg text-xs flex items-start gap-2 ${
                message.type === 'error' ? 'bg-error/10 text-error border border-error/20' : 
                message.type === 'success' ? 'bg-success/10 text-success border border-success/20' :
                'bg-accent-blue/10 text-accent-blue border border-accent-blue/20'
              }`}>
                {message.type === 'error' ? <AlertCircle size={14} className="mt-0.5 shrink-0" /> : <CheckCircle size={14} className="mt-0.5 shrink-0" />}
                <span>{message.text}</span>
              </div>
            )}
            
            <button
              onClick={handleRunAssessment}
              disabled={isSubmitting || !selectedOrgId}
              className="btn w-full py-2.5 bg-neon-cyan hover:bg-neon-cyan/90 text-bg-deep rounded-lg transition-colors font-semibold text-sm flex justify-center items-center gap-2 disabled:opacity-50"
            >
              {isSubmitting ? <span className="loader shrink-0"></span> : <Play size={18} />}
              {isSubmitting ? 'Iniciando...' : 'Ejecutar Evaluación'}
            </button>
          </div>
        </div>

        {/* Right Column: Report Viewer */}
        <div className="glass-panel flex flex-col h-full lg:col-span-2 overflow-hidden">
          <div className="p-4 border-b border-border-color bg-bg-panel/50 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <FileText className="text-text-secondary" /> Visor de Reporte
            </h2>
            {selectedOrgId && (
              <a 
                href={reportUrl!} 
                target="_blank" 
                rel="noreferrer"
                className="text-xs text-neon-cyan hover:underline"
              >
                Abrir en nueva pestaña
              </a>
            )}
          </div>
          
          <div className="flex-1 bg-white relative">
            {!selectedOrgId ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted bg-bg-deep">
                <Shield size={48} className="opacity-20 mb-4" />
                <p>Selecciona una organización para ver su reporte</p>
              </div>
            ) : (
              <iframe
                src={reportUrl!}
                className="w-full h-full border-none"
                title="Zero Trust Assessment Report"
                onError={(e) => console.error('Iframe error', e)}
              />
            )}
            
            {/* Overlay if the report returns 404 (handled loosely by iframe behavior, but we can't perfectly catch 404 in cross-origin iframe. Assuming same-origin API) */}
          </div>
        </div>

      </div>
    </div>
  );
}
