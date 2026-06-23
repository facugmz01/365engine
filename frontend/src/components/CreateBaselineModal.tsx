import React, { useState } from 'react';
import { X, Package as PackageIcon } from 'lucide-react';
import { apiClient } from '../api/client';
import { useStore } from '../store/useStore';

interface CreateBaselineModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CreateBaselineModal({ isOpen, onClose }: CreateBaselineModalProps) {
  const { templates, fetchPackages } = useStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(new Set());
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const toggleTemplateSelection = (id: string) => {
    const newSelected = new Set(selectedTemplateIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedTemplateIds(newSelected);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (selectedTemplateIds.size === 0) {
      setError("Debes seleccionar al menos una plantilla.");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient.post('/packages', {
        name,
        description,
        template_ids: Array.from(selectedTemplateIds),
      });
      await fetchPackages();
      onClose();
      setName('');
      setDescription('');
      setSelectedTemplateIds(new Set());
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Error al crear el baseline');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200 p-4">
      <div className="bg-bg-panel border border-border-color rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-border-color shrink-0">
          <div className="flex items-center gap-2">
            <PackageIcon className="text-accent-blue" size={20} />
            <h2 className="text-lg font-semibold text-text-primary">Nuevo Paquete Baseline</h2>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-6 flex-1">
          <form id="create-baseline-form" onSubmit={handleSubmit}>
            {error && (
              <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-lg text-error text-sm">
                {error}
              </div>
            )}

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Nombre del Paquete <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-bg-deep border border-border-color rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent-blue transition-all"
                  placeholder="Ej. Seguridad Core Windows 10"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Descripción
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-bg-deep border border-border-color rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent-blue transition-all"
                  placeholder="Breve descripción del paquete..."
                  rows={2}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Selecciona las Plantillas ({selectedTemplateIds.size} seleccionadas) <span className="text-error">*</span>
              </label>
              
              <div className="border border-border-color rounded-lg overflow-hidden">
                <div className="max-h-60 overflow-y-auto bg-bg-deep divide-y divide-border-color">
                  {templates.length === 0 ? (
                    <div className="p-4 text-center text-sm text-text-muted">
                      No hay plantillas disponibles. Crea una primero.
                    </div>
                  ) : (
                    templates.map(template => (
                      <label key={template.id} className="flex items-start gap-3 p-3 hover:bg-bg-panel/50 cursor-pointer transition-colors">
                        <div className="mt-0.5">
                          <input
                            type="checkbox"
                            checked={selectedTemplateIds.has(template.id)}
                            onChange={() => toggleTemplateSelection(template.id)}
                            className="rounded border-border-color bg-bg-card text-accent-blue focus:ring-accent-blue"
                          />
                        </div>
                        <div>
                          <div className="font-medium text-sm text-text-primary">{template.name}</div>
                          <div className="text-xs text-text-muted mt-0.5">Categoría: {template.category}</div>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </div>
          </form>
        </div>

        <div className="p-4 border-t border-border-color flex justify-end gap-3 shrink-0 bg-bg-panel">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="create-baseline-form"
            disabled={isSubmitting || !name || selectedTemplateIds.size === 0}
            className="btn btn-primary px-4 py-2 bg-accent-blue hover:bg-accent-blue/80 text-white rounded-lg transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSubmitting ? 'Guardando...' : 'Crear Baseline'}
          </button>
        </div>
      </div>
    </div>
  );
}
