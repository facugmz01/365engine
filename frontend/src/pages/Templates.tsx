import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import type { Template } from '../store/useStore';
import { FileText, Plus, Search, Eye, Download, Trash2, Code } from 'lucide-react';
import CreateTemplateModal from '../components/CreateTemplateModal';
import TemplateDetailsModal from '../components/TemplateDetailsModal';

export default function Templates() {
  const { templates, fetchTemplates, deleteTemplate, isLoading, error } = useStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const filteredTemplates = templates.filter(t =>
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (t.endpoint && t.endpoint.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const getCategoryColor = (category: string) => {
    switch (category.toLowerCase()) {
      case 'intune': return 'text-accent-blue bg-accent-blue/10 border-accent-blue/20';
      case 'entra': return 'text-accent-purple bg-accent-purple/10 border-accent-purple/20';
      case 'defender': return 'text-error bg-error/10 border-error/20';
      case 'purview': return 'text-warning bg-warning/10 border-warning/20';
      case 'exchange': return 'text-success bg-success/10 border-success/20';
      case 'teams': return 'text-neon-cyan bg-neon-cyan/10 border-neon-cyan/20';
      default: return 'text-text-secondary bg-bg-deep border-border-color';
    }
  };

  const handleDownload = (e: React.MouseEvent, template: Template) => {
    e.stopPropagation();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(template.payload, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `${template.name.replace(/\s+/g, '_')}_payload.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (window.confirm('¿Estás seguro de que deseas eliminar esta plantilla?')) {
      try {
        await deleteTemplate(id);
      } catch (err) {
        console.error("Error deleting template:", err);
      }
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
      <div className="flex items-center justify-between mb-8 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
            <FileText className="text-accent-blue" /> Plantillas Base
          </h1>
          <p className="text-text-muted text-sm mt-1">Gestiona las políticas y configuraciones individuales de Intune.</p>
        </div>
        <div className="flex gap-4">
          <div className="relative w-64">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
              <Search size={16} />
            </div>
            <input
              type="text"
              placeholder="Buscar plantillas..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-3 py-2 bg-bg-card border border-border-color rounded-lg text-sm text-text-primary focus:ring-1 focus:ring-accent-blue focus:border-accent-blue outline-none transition-all"
            />
          </div>
          <button onClick={() => setIsModalOpen(true)} className="btn btn-primary flex items-center gap-2 px-4 py-2 bg-accent-blue hover:bg-accent-blue/80 text-white rounded-lg transition-colors font-medium text-sm">
            <Plus size={18} />
            Nueva Plantilla
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
                <th className="px-6 py-4 font-semibold">Nombre</th>
                <th className="px-6 py-4 font-semibold">Categoría</th>
                <th className="px-6 py-4 font-semibold">Graph Endpoint</th>
                <th className="px-6 py-4 font-semibold text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-color">
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-text-muted">Cargando plantillas...</td>
                </tr>
              ) : filteredTemplates.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-text-muted">
                    No se encontraron plantillas.
                  </td>
                </tr>
              ) : (
                filteredTemplates.map((template: Template) => (
                  <tr key={template.id} className="hover:bg-bg-panel/30 transition-colors group cursor-pointer">
                    <td className="px-6 py-4">
                      <div className="font-medium text-text-primary">{template.name}</div>
                      {template.description && (
                        <div className="text-xs text-text-muted mt-1 truncate max-w-sm">{template.description}</div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-md text-xs font-medium border capitalize ${getCategoryColor(template.category)}`}>
                        {template.category}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-text-secondary">
                      <div className="flex items-center gap-1.5 font-mono text-xs">
                        <Code size={13} className="text-text-muted flex-shrink-0" />
                        <span className="truncate max-w-[240px]" title={template.endpoint}>{template.endpoint}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            setSelectedTemplate(template);
                            setIsDetailsModalOpen(true);
                          }} 
                          title="Ver Payload"
                          className="p-2 text-text-muted hover:text-accent-blue hover:bg-accent-blue/10 rounded-md transition-colors"
                        >
                          <Eye size={16} />
                        </button>
                        <button 
                          onClick={(e) => handleDownload(e, template)}
                          title="Descargar JSON"
                          className="p-2 text-text-muted hover:text-success hover:bg-success/10 rounded-md transition-colors"
                        >
                          <Download size={16} />
                        </button>
                        <button 
                          onClick={(e) => handleDelete(e, template.id)}
                          title="Eliminar Plantilla"
                          className="p-2 text-text-muted hover:text-error hover:bg-error/10 rounded-md transition-colors"
                        >
                          <Trash2 size={16} />
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
      
      <CreateTemplateModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
      />
      
      <TemplateDetailsModal
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        template={selectedTemplate}
      />
    </div>
  );
}
