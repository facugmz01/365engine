import React, { useState } from 'react';
import { X, FileCode } from 'lucide-react';
import { apiClient } from '../api/client';
import { useStore } from '../store/useStore';

interface CreateTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CreateTemplateModal({ isOpen, onClose }: CreateTemplateModalProps) {
  const { fetchTemplates } = useStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('intune');
  const [endpoint, setEndpoint] = useState('');
  const [payloadStr, setPayloadStr] = useState('{}');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    let parsedPayload;
    try {
      parsedPayload = JSON.parse(payloadStr);
    } catch (e) {
      setError("El payload debe ser un JSON válido.");
      setIsSubmitting(false);
      return;
    }

    try {
      await apiClient.post('/templates', {
        name,
        description,
        category,
        endpoint,
        payload: parsedPayload,
      });
      await fetchTemplates();
      onClose();
      // Reset form
      setName('');
      setDescription('');
      setCategory('intune');
      setEndpoint('');
      setPayloadStr('{}');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Error al crear la plantilla');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-bg-panel border border-border-color rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-border-color">
          <div className="flex items-center gap-2">
            <FileCode className="text-accent-blue" size={20} />
            <h2 className="text-lg font-semibold text-text-primary">Nueva Plantilla</h2>
          </div>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-error/10 border border-error/20 rounded-lg text-error text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Nombre <span className="text-error">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-bg-deep border border-border-color rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent-blue transition-all"
                placeholder="Ej. Windows 10 Compliance"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Categoría <span className="text-error">*</span>
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-bg-deep border border-border-color rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent-blue transition-all"
              >
                <option value="intune">Intune</option>
                <option value="entra">Entra ID</option>
                <option value="defender">Defender</option>
                <option value="purview">Purview</option>
              </select>
            </div>
          </div>
          
          <div className="mb-4">
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Endpoint (Graph API) <span className="text-error">*</span>
            </label>
            <input
              type="text"
              required
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              className="w-full bg-bg-deep border border-border-color rounded-lg px-3 py-2 text-text-primary font-mono text-sm focus:outline-none focus:border-accent-blue transition-all"
              placeholder="Ej. deviceManagement/configurationPolicies"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-text-secondary mb-1">Descripción</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-bg-deep border border-border-color rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent-blue transition-all"
              placeholder="Breve descripción de la plantilla"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Payload (JSON) <span className="text-error">*</span>
            </label>
            <textarea
              required
              rows={6}
              value={payloadStr}
              onChange={(e) => setPayloadStr(e.target.value)}
              className="w-full bg-bg-deep border border-border-color rounded-lg px-3 py-2 text-text-primary font-mono text-sm focus:outline-none focus:border-accent-blue transition-all"
              placeholder="{}"
            />
          </div>

          <div className="mt-8 flex justify-end gap-3">
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
              disabled={isSubmitting || !name || !endpoint}
              className="btn btn-primary px-4 py-2 bg-accent-blue hover:bg-accent-blue/80 text-white rounded-lg transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting ? 'Guardando...' : 'Crear Plantilla'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
