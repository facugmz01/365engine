import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { Building2, Briefcase, FileText, Activity } from 'lucide-react';
import { apiClient } from '../api/client';

export default function Dashboard() {
  const { organizations, templates, jobs, fetchOrganizations, fetchTemplates, fetchJobs } = useStore();
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);

  useEffect(() => {
    if (organizations.length === 0) fetchOrganizations();
    if (templates.length === 0) fetchTemplates();
    if (jobs.length === 0) fetchJobs();

    // Fetch recent audit logs for the activity feed
    apiClient.get('/audit-logs')
      .then(res => setAuditLogs(res.data.slice(0, 8)))
      .catch(() => setAuditLogs([]))
      .finally(() => setLogsLoading(false));
  }, []);

  const activeJobs = jobs.filter(j =>
    j.status === 'running' || j.status === 'pending_approval' || j.status === 'simulated'
  ).length;

  const tenantsWithCreds = organizations.filter(o => o.has_credentials).length;

  const getActionColor = (action: string) => {
    if (action.includes('deploy') || action.includes('approve')) return 'text-success';
    if (action.includes('reject') || action.includes('delete')) return 'text-error';
    if (action.includes('login')) return 'text-accent-blue';
    return 'text-text-secondary';
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="glass-panel p-6 relative overflow-hidden group hover:border-border-focus transition-colors">
          <div className="flex items-start justify-between mb-3">
            <h3 className="text-text-secondary text-sm font-medium">Total Inquilinos</h3>
            <Building2 size={18} className="text-text-muted" />
          </div>
          <p className="text-3xl font-bold text-text-primary">{organizations.length}</p>
          <p className="text-xs text-text-muted mt-1">{tenantsWithCreds} con credenciales</p>
          <div className="absolute bottom-0 left-0 h-1 bg-neon-cyan transition-all duration-500"
            style={{ width: organizations.length > 0 ? `${Math.min((tenantsWithCreds / organizations.length) * 100, 100)}%` : '0%' }}
          ></div>
        </div>

        <div className="glass-panel p-6 relative overflow-hidden group hover:border-warning/40 transition-colors">
          <div className="flex items-start justify-between mb-3">
            <h3 className="text-text-secondary text-sm font-medium">Trabajos Activos</h3>
            <Activity size={18} className="text-text-muted" />
          </div>
          <p className="text-3xl font-bold text-text-primary">{activeJobs}</p>
          <p className="text-xs text-text-muted mt-1">{jobs.length} total histórico</p>
          <div className="absolute bottom-0 left-0 h-1 bg-warning w-full opacity-30"></div>
        </div>

        <div className="glass-panel p-6 relative overflow-hidden group hover:border-success/40 transition-colors">
          <div className="flex items-start justify-between mb-3">
            <h3 className="text-text-secondary text-sm font-medium">Plantillas</h3>
            <FileText size={18} className="text-text-muted" />
          </div>
          <p className="text-3xl font-bold text-text-primary">{templates.length}</p>
          <p className="text-xs text-text-muted mt-1">Políticas disponibles</p>
          <div className="absolute bottom-0 left-0 h-1 bg-success w-[60%]"></div>
        </div>

        <div className="glass-panel p-6 relative overflow-hidden group hover:border-accent-blue/40 transition-colors">
          <div className="flex items-start justify-between mb-3">
            <h3 className="text-text-secondary text-sm font-medium">Completados</h3>
            <Briefcase size={18} className="text-text-muted" />
          </div>
          <p className="text-3xl font-bold text-text-primary">
            {jobs.filter(j => j.status === 'completed').length}
          </p>
          <p className="text-xs text-text-muted mt-1">Despliegues exitosos</p>
          <div className="absolute bottom-0 left-0 h-1 bg-accent-blue w-[45%]"></div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="glass-panel p-6">
        <h3 className="text-lg font-semibold mb-4 border-b border-border-color pb-3 flex items-center gap-2">
          <Activity size={18} className="text-accent-blue" />
          Actividad Reciente
        </h3>

        {logsLoading ? (
          <div className="text-text-muted text-center py-10 flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-accent-blue border-t-transparent rounded-full animate-spin"></div>
            Cargando actividad...
          </div>
        ) : auditLogs.length === 0 ? (
          <div className="text-text-muted text-center py-10">
            No hay actividad reciente registrada.
          </div>
        ) : (
          <div className="space-y-3">
            {auditLogs.map((log, idx) => (
              <div key={log.id || idx} className="flex items-start gap-4 p-3 rounded-lg hover:bg-bg-panel/40 transition-colors">
                <div className="w-8 h-8 rounded-full bg-bg-deep border border-border-color flex items-center justify-center text-xs font-bold text-text-secondary uppercase flex-shrink-0">
                  {(log.username || 'S').substring(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-text-primary text-sm">{log.username || 'Sistema'}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-md bg-bg-deep border border-border-color capitalize ${getActionColor(log.action)}`}>
                      {log.action.replace(/_/g, ' ')}
                    </span>
                    {log.resource_type && (
                      <span className="text-xs text-text-muted capitalize">{log.resource_type.replace(/_/g, ' ')}</span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted mt-0.5">
                    {new Date(log.timestamp).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
