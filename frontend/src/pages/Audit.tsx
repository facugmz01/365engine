import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { History, Search, ShieldAlert, User, Clock, FileJson } from 'lucide-react';

interface AuditLog {
  id: string;
  timestamp: string;
  username: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details: any;
}

export default function Audit() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const response = await apiClient.get('/audit-logs');
        setLogs(response.data);
      } catch (err: any) {
        setError(err.response?.data?.detail || 'Error al cargar los logs de auditoría');
      } finally {
        setIsLoading(false);
      }
    };
    fetchLogs();
  }, []);

  const filteredLogs = logs.filter(log => 
    log.action.toLowerCase().includes(searchTerm.toLowerCase()) || 
    log.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (log.resource_type && log.resource_type.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
      <div className="flex items-center justify-between mb-8 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
            <History className="text-accent-blue" /> Auditoría del Sistema
          </h1>
          <p className="text-text-muted text-sm mt-1">Registro inmutable de todas las acciones administrativas.</p>
        </div>
        
        <div className="relative w-72">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
            <Search size={16} />
          </div>
          <input
            type="text"
            placeholder="Buscar por usuario o acción..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-3 py-2 bg-bg-card border border-border-color rounded-lg text-sm text-text-primary focus:ring-1 focus:ring-accent-blue focus:border-accent-blue outline-none transition-all"
          />
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-error/10 border border-error/20 rounded-lg text-error text-sm flex items-center gap-2">
          <ShieldAlert size={16} /> {error}
        </div>
      )}

      <div className="glass-panel overflow-hidden flex-1 flex flex-col">
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-text-muted uppercase bg-bg-panel border-b border-border-color sticky top-0 z-10">
              <tr>
                <th className="px-6 py-4 font-semibold">Fecha y Hora</th>
                <th className="px-6 py-4 font-semibold">Usuario</th>
                <th className="px-6 py-4 font-semibold">Acción</th>
                <th className="px-6 py-4 font-semibold">Recurso</th>
                <th className="px-6 py-4 font-semibold text-right">Detalles</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-color">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-text-muted">
                    <div className="flex flex-col items-center justify-center">
                      <div className="w-6 h-6 border-2 border-accent-blue border-t-transparent rounded-full animate-spin mb-2"></div>
                      Cargando registros...
                    </div>
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-text-muted">
                    <History size={32} className="mx-auto mb-3 opacity-30" />
                    No se encontraron registros de auditoría.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-bg-panel/30 transition-colors group">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2 text-text-secondary font-mono text-xs">
                        <Clock size={14} className="text-text-muted" />
                        {new Date(log.timestamp).toLocaleString()}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 font-medium">
                        <div className="w-6 h-6 rounded bg-bg-deep border border-border-color flex items-center justify-center text-text-muted">
                          <User size={12} />
                        </div>
                        <span className={log.username === 'System' ? 'text-accent-purple' : 'text-text-primary'}>
                          {log.username}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 rounded-md bg-bg-deep border border-border-color text-xs font-medium text-text-primary capitalize">
                        {log.action.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-text-secondary">
                      {log.resource_type ? (
                        <div className="flex flex-col">
                          <span className="text-xs uppercase tracking-wider text-text-muted">{log.resource_type}</span>
                          <span className="font-mono text-xs truncate max-w-[150px]" title={log.resource_id}>{log.resource_id || '-'}</span>
                        </div>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {log.details && Object.keys(log.details).length > 0 ? (
                        <button 
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bg-deep hover:bg-border-color border border-border-color rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
                          onClick={() => alert(JSON.stringify(log.details, null, 2))}
                        >
                          <FileJson size={14} /> JSON
                        </button>
                      ) : (
                        <span className="text-text-muted text-xs">-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
