import { useEffect, useState, useRef } from 'react';
import { useStore } from '../store/useStore';
import type { Job } from '../store/useStore';
import { Briefcase, Search, CheckCircle2, XCircle, AlertCircle, Clock, PlayCircle, Eye, X, Terminal, ThumbsUp, ThumbsDown } from 'lucide-react';
import { apiClient } from '../api/client';

export default function Jobs() {
  const { jobs, fetchJobs, organizations, fetchOrganizations, isLoading, error } = useStore();
  const [searchTerm, setSearchTerm] = useState('');

  // Console state
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [consoleStatus, setConsoleStatus] = useState<string>('');
  const logsEndRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    fetchJobs();
    if (organizations.length === 0) {
      fetchOrganizations();
    }
  }, [fetchJobs, fetchOrganizations, organizations.length]);

  const filteredJobs = jobs.filter(j =>
    j.status.toLowerCase().includes(searchTerm.toLowerCase()) ||
    getOrgName(j.organization_id).toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getOrgName = (orgId: string) => {
    const org = organizations.find(o => o.id === orgId);
    return org ? org.name : orgId?.substring(0, 8) + '...';
  };

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-success/10 text-success border border-success/20"><CheckCircle2 size={12} /> Completado</span>;
      case 'failed':
        return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-error/10 text-error border border-error/20"><XCircle size={12} /> Fallido</span>;
      case 'pending_approval':
        // Backend uses pending_approval (not awaiting_approval)
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
  };

  const handleOpenConsole = async (jobId: string) => {
    setSelectedJobId(jobId);
    setLogs([]);
    setConsoleStatus('');
    pollLogs(jobId);
    pollIntervalRef.current = window.setInterval(() => {
      pollLogs(jobId);
      fetchJobs();
    }, 2000);
  };

  const closeConsole = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setSelectedJobId(null);
  };

  const pollLogs = async (jobId: string) => {
    try {
      // Backend: GET /api/v1/deployments/{job_id}/logs
      const response = await apiClient.get(`/deployments/${jobId}/logs`);
      setLogs(response.data.logs || []);
      setConsoleStatus(response.data.status || '');
    } catch (e) {
      console.error('Error fetching deployment logs', e);
    }
  };

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const handleApprovalAction = async (action: 'approve' | 'reject') => {
    if (!selectedJobId) return;
    try {
      // Backend: POST /api/v1/deployments/{job_id}/approve  OR  /deployments/{job_id}/reject
      await apiClient.post(`/deployments/${selectedJobId}/${action}`);
      alert(`Acción '${action === 'approve' ? 'Aprobado' : 'Rechazado'}' ejecutada correctamente.`);
      closeConsole();
      fetchJobs();
    } catch (err: any) {
      alert('Error ejecutando la acción: ' + (err.response?.data?.detail || err.message));
    }
  };

  // Get the current status of the job being viewed in the console
  const selectedJob = jobs.find(j => j.id === selectedJobId);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
      <div className="flex items-center justify-between mb-8 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
            <Briefcase className="text-accent-blue" /> Trabajos (Deployments)
          </h1>
          <p className="text-text-muted text-sm mt-1">Supervisa y aprueba despliegues o importaciones en curso.</p>
        </div>
        <div className="relative w-72">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
            <Search size={16} />
          </div>
          <input
            type="text"
            placeholder="Buscar por estado o inquilino..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-3 py-2 bg-bg-card border border-border-color rounded-lg text-sm text-text-primary focus:ring-1 focus:ring-accent-blue focus:border-accent-blue outline-none transition-all"
          />
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-error/10 border border-error/20 rounded-lg text-error text-sm">
          {error}
        </div>
      )}

      <div className="glass-panel overflow-hidden flex-1 flex flex-col">
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-text-muted uppercase bg-bg-panel border-b border-border-color sticky top-0 z-10">
              <tr>
                <th className="px-6 py-4 font-semibold">Inquilino Destino</th>
                <th className="px-6 py-4 font-semibold">Estado</th>
                <th className="px-6 py-4 font-semibold">Plantillas</th>
                <th className="px-6 py-4 font-semibold">Fecha Inicio</th>
                <th className="px-6 py-4 font-semibold text-right">Consola</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-color">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-text-muted">Cargando trabajos...</td>
                </tr>
              ) : filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-text-muted">
                    No hay trabajos registrados.
                  </td>
                </tr>
              ) : (
                filteredJobs.map((job: Job) => (
                  <tr key={job.id} className="hover:bg-bg-panel/30 transition-colors group cursor-pointer">
                    <td className="px-6 py-4 font-medium text-text-primary">
                      {getOrgName(job.organization_id)}
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(job.status)}
                    </td>
                    <td className="px-6 py-4 text-text-secondary text-xs">
                      {job.templates?.length ?? 0} plantilla(s)
                    </td>
                    <td className="px-6 py-4 text-text-secondary font-mono text-xs">
                      {new Date(job.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleOpenConsole(job.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bg-deep hover:bg-border-color border border-border-color rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
                      >
                        <Eye size={14} /> Ver Logs
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live Console Modal */}
      {selectedJobId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-4xl h-[80vh] flex flex-col relative border-accent-blue/30 shadow-[0_0_30px_rgba(59,130,246,0.1)]">
            <div className="flex items-center justify-between p-4 border-b border-border-color bg-bg-panel/50">
              <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                <Terminal size={20} className="text-accent-blue" />
                Consola de Despliegue en Vivo
                <span className="text-xs font-mono text-text-muted ml-2">[{selectedJobId.substring(0, 8)}...]</span>
                {consoleStatus && getStatusBadge(consoleStatus)}
              </h3>
              <div className="flex items-center gap-3">
                {/* Show approve/reject only for pending_approval jobs */}
                {selectedJob?.status === 'pending_approval' && (
                  <>
                    <button
                      onClick={() => handleApprovalAction('reject')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-error/10 text-error hover:bg-error/20 border border-error/20 transition-colors"
                    >
                      <ThumbsDown size={14} /> Rechazar
                    </button>
                    <button
                      onClick={() => handleApprovalAction('approve')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-success/10 text-success hover:bg-success/20 border border-success/20 transition-colors"
                    >
                      <ThumbsUp size={14} /> Aprobar
                    </button>
                  </>
                )}
                {/* Commit simulated → pending_approval */}
                {selectedJob?.status === 'simulated' && (
                  <button
                    onClick={async () => {
                      try {
                        await apiClient.post(`/deployments/${selectedJobId}/commit`);
                        alert('Despliegue enviado a aprobación.');
                        fetchJobs();
                        closeConsole();
                      } catch (err: any) {
                        alert('Error: ' + (err.response?.data?.detail || err.message));
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 border border-accent-blue/20 transition-colors"
                  >
                    <PlayCircle size={14} /> Enviar a Aprobación
                  </button>
                )}
                <button onClick={closeConsole} className="text-text-muted hover:text-text-primary transition-colors p-1 bg-bg-deep rounded-md">
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="flex-1 bg-black p-4 overflow-y-auto font-mono text-sm">
              {logs.length === 0 ? (
                <div className="text-text-muted flex items-center gap-2">
                  <Clock size={14} className="animate-spin" /> Esperando logs...
                </div>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className="mb-1">
                    <span className="text-text-muted">
                      [{typeof log === 'string' ? '' : new Date(log.timestamp || Date.now()).toLocaleTimeString()}]
                    </span>{' '}
                    <span className={
                      (log.level || '') === 'ERROR' ? 'text-error' :
                      (log.level || '') === 'WARNING' ? 'text-warning' :
                      (log.level || '') === 'SUCCESS' ? 'text-success' : 'text-text-secondary'
                    }>
                      {typeof log === 'string' ? log : log.message}
                    </span>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
