import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import type { Organization } from '../store/useStore';
import { Plus, KeyRound, Globe, MoreVertical } from 'lucide-react';
import CreateTenantModal from '../components/CreateTenantModal';
import { useState } from 'react';

export default function Tenants() {
  const { organizations, fetchOrganizations, isLoading, error } = useStore();
  const navigate = useNavigate();
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    fetchOrganizations();
  }, [fetchOrganizations]);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Inquilinos Registrados</h1>
          <p className="text-text-muted text-sm mt-1">Gestiona los entornos de Microsoft 365 de tus clientes.</p>
        </div>
        <button onClick={() => setIsModalOpen(true)} className="btn btn-primary flex items-center gap-2 px-4 py-2 bg-accent-blue hover:bg-accent-blue/80 text-white rounded-lg transition-colors font-medium text-sm">
          <Plus size={18} />
          Nuevo Inquilino
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-error/10 border border-error/20 rounded-lg text-error text-sm">
          {error}
        </div>
      )}

      <div className="glass-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-text-muted uppercase bg-bg-panel/50 border-b border-border-color">
              <tr>
                <th className="px-6 py-4 font-semibold">Cliente</th>
                <th className="px-6 py-4 font-semibold">Tenant ID</th>
                <th className="px-6 py-4 font-semibold">Credenciales</th>
                <th className="px-6 py-4 font-semibold text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-color">
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-text-muted">Cargando inquilinos...</td>
                </tr>
              ) : organizations.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-text-muted">No hay inquilinos registrados.</td>
                </tr>
              ) : (
                organizations.map((org: Organization) => (
                  <tr 
                    key={org.id} 
                    className="hover:bg-bg-panel/30 transition-colors cursor-pointer group"
                    onClick={() => navigate(`/tenants/${org.id}`)}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-bg-card border border-border-color flex items-center justify-center text-text-secondary group-hover:text-accent-blue transition-colors">
                          <Globe size={16} />
                        </div>
                        <span className="font-medium text-text-primary">{org.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-text-secondary font-mono text-xs">
                      {org.tenant_id}
                    </td>
                    <td className="px-6 py-4">
                      {org.has_credentials ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-success/10 text-success border border-success/20">
                          <KeyRound size={12} /> OK
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-warning/10 text-warning border border-warning/20">
                          <KeyRound size={12} /> Pendiente
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-card rounded-md transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          alert("Opciones de inquilino en desarrollo");
                        }}
                      >
                        <MoreVertical size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      <CreateTenantModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
      />
    </div>
  );
}
