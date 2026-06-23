import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import type { Package } from '../store/useStore';
import { Package as PackageIcon, Plus, Search, MoreVertical, PlayCircle, X, ShieldAlert } from 'lucide-react';
import { apiClient } from '../api/client';
import { useNavigate } from 'react-router-dom';
import CreateBaselineModal from '../components/CreateBaselineModal';

export default function Baselines() {
  const { packages, fetchPackages, organizations, fetchOrganizations, templates, fetchTemplates, isLoading, error } = useStore();
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Deploy modal state
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [selectedPkg, setSelectedPkg] = useState<Package | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [assignmentTarget, setAssignmentTarget] = useState<'unassigned' | 'all_devices' | 'all_users'>('unassigned');
  const [isDeploying, setIsDeploying] = useState(false);

  useEffect(() => {
    fetchPackages();
    if (organizations.length === 0) fetchOrganizations();
    if (templates.length === 0) fetchTemplates();
  }, [fetchPackages, fetchOrganizations, fetchTemplates, organizations.length, templates.length]);

  const filteredPackages = packages.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleOpenDeployModal = (pkg: Package) => {
    setSelectedPkg(pkg);
    setShowDeployModal(true);
    setSelectedOrgId('');
    setAssignmentTarget('unassigned');
  };

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPkg || !selectedOrgId) return;

    setIsDeploying(true);
    try {
      // Backend expects POST /api/v1/deployments/simulate with:
      // { organization_id, template_ids, assignment_target }
      // Extract template IDs from the selected package
      const templateIds = selectedPkg.templates?.map(t => t.id) ?? [];

      if (templateIds.length === 0) {
        alert('Este paquete no tiene plantillas asociadas.');
        return;
      }

      const response = await apiClient.post('/deployments/simulate', {
        organization_id: selectedOrgId,
        template_ids: templateIds,
        assignment_target: assignmentTarget,
      });

      const jobId = response.data.job_id;
      alert(`Simulación completada.\nJob ID: ${jobId}\n\nRevisa el resultado en la página de Trabajos para enviarlo a aprobación.`);
      setShowDeployModal(false);
      navigate('/jobs');
    } catch (error: any) {
      alert('Error al iniciar despliegue: ' + (error.response?.data?.detail || error.message));
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
      <div className="flex items-center justify-between mb-8 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
            <PackageIcon className="text-accent-blue" /> Paquetes Baseline
          </h1>
          <p className="text-text-muted text-sm mt-1">Agrupa plantillas para desplegarlas en lote a tus clientes.</p>
        </div>
        <div className="flex gap-4">
          <div className="relative w-64">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
              <Search size={16} />
            </div>
            <input
              type="text"
              placeholder="Buscar baselines..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-3 py-2 bg-bg-card border border-border-color rounded-lg text-sm text-text-primary focus:ring-1 focus:ring-accent-blue focus:border-accent-blue outline-none transition-all"
            />
          </div>
          <button onClick={() => setIsCreateModalOpen(true)} className="btn btn-primary flex items-center gap-2 px-4 py-2 bg-accent-blue hover:bg-accent-blue/80 text-white rounded-lg transition-colors font-medium text-sm">
            <Plus size={18} />
            Crear Baseline
          </button>
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
                <th className="px-6 py-4 font-semibold">Nombre del Paquete</th>
                <th className="px-6 py-4 font-semibold">Descripción</th>
                <th className="px-6 py-4 font-semibold">Plantillas</th>
                <th className="px-6 py-4 font-semibold">Fecha Creación</th>
                <th className="px-6 py-4 font-semibold text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-color">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-text-muted">Cargando paquetes...</td>
                </tr>
              ) : filteredPackages.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-text-muted">
                    No se encontraron paquetes.
                  </td>
                </tr>
              ) : (
                filteredPackages.map((pkg: Package) => (
                  <tr key={pkg.id} className="hover:bg-bg-panel/30 transition-colors group cursor-pointer">
                    <td className="px-6 py-4">
                      <div className="font-medium text-text-primary flex items-center gap-2">
                        <PackageIcon size={16} className="text-text-muted" />
                        {pkg.name}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-text-secondary truncate max-w-sm">
                      {pkg.description || '-'}
                    </td>
                    <td className="px-6 py-4 text-text-secondary text-xs">
                      {pkg.templates?.length ?? 0} plantilla(s)
                    </td>
                    <td className="px-6 py-4 text-text-secondary">
                      {new Date(pkg.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 rounded-lg text-xs font-medium transition-colors"
                          onClick={(e) => { e.stopPropagation(); handleOpenDeployModal(pkg); }}
                        >
                          <PlayCircle size={14} /> Desplegar
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); alert("Opciones de baseline en desarrollo"); }} className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-card rounded-md transition-colors">
                          <MoreVertical size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Deploy Modal */}
      {showDeployModal && selectedPkg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-md p-6 relative">
            <button
              onClick={() => setShowDeployModal(false)}
              className="absolute top-4 right-4 text-text-muted hover:text-text-primary transition-colors"
            >
              <X size={20} />
            </button>

            <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2 mb-2">
              <PlayCircle size={20} className="text-accent-blue" />
              Simular y Desplegar Paquete
            </h3>
            <p className="text-sm text-text-secondary mb-1">
              Paquete: <span className="font-medium text-text-primary">{selectedPkg.name}</span>
            </p>
            <p className="text-xs text-text-muted mb-6">
              {selectedPkg.templates?.length ?? 0} plantilla(s) incluida(s). Se ejecutará una simulación primero.
            </p>

            <form onSubmit={handleDeploy} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Inquilino de Destino</label>
                <select
                  required
                  value={selectedOrgId}
                  onChange={(e) => setSelectedOrgId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-bg-deep border border-border-color rounded-lg text-text-primary focus:ring-1 focus:ring-accent-blue outline-none"
                >
                  <option value="">-- Selecciona un Inquilino --</option>
                  {organizations.map(org => (
                    <option key={org.id} value={org.id}>
                      {org.name} {!org.has_credentials ? '(Sin credenciales)' : ''}
                    </option>
                  ))}
                </select>
                {selectedOrgId && !organizations.find(o => o.id === selectedOrgId)?.has_credentials && (
                  <div className="mt-2 p-2 bg-warning/10 border border-warning/20 rounded text-xs text-warning flex items-center gap-1.5">
                    <ShieldAlert size={14} /> Este inquilino no tiene credenciales configuradas.
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Destino de Asignación</label>
                <select
                  value={assignmentTarget}
                  onChange={(e) => setAssignmentTarget(e.target.value as any)}
                  className="w-full px-3 py-2.5 bg-bg-deep border border-border-color rounded-lg text-text-primary focus:ring-1 focus:ring-accent-blue outline-none"
                >
                  <option value="unassigned">Sin Asignar</option>
                  <option value="all_devices">Todos los Dispositivos</option>
                  <option value="all_users">Todos los Usuarios</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowDeployModal(false)}
                  className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isDeploying || !selectedOrgId}
                  className="px-4 py-2 bg-accent-blue text-white text-sm font-medium rounded-lg hover:bg-accent-blue/90 disabled:opacity-50 transition-colors"
                >
                  {isDeploying ? 'Simulando...' : 'Iniciar Simulación'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <CreateBaselineModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </div>
  );
}
