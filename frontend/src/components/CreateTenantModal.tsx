import React, { useState } from 'react';
import { X, Globe } from 'lucide-react';
import { apiClient } from '../api/client';
import { useStore } from '../store/useStore';

interface CreateTenantModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CreateTenantModal({ isOpen, onClose }: CreateTenantModalProps) {
  const { fetchOrganizations } = useStore();
  const [name, setName] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await apiClient.post('/organizations', {
        name,
        tenant_id: tenantId,
      });
      await fetchOrganizations();
      onClose();
      setName('');
      setTenantId('');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Error al crear el inquilino');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-bg-panel border border-border-color rounded-xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-border-color">
          <div className="flex items-center gap-2">
            <Globe className="text-accent-blue" size={20} />
            <h2 className="text-lg font-semibold text-text-primary">Nuevo Inquilino</h2>
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

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Nombre del Cliente <span className="text-error">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-bg-deep border border-border-color rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue transition-all"
                placeholder="Ej. Contoso Corp"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Tenant ID <span className="text-error">*</span>
              </label>
              <input
                type="text"
                required
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                className="w-full bg-bg-deep border border-border-color rounded-lg px-3 py-2 text-text-primary font-mono text-sm focus:outline-none focus:border-accent-blue focus:ring-1 focus:ring-accent-blue transition-all"
                placeholder="Ej. d41d8cd9-8f00-3204-a980-0998ecf8427e"
              />
            </div>
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
              disabled={isSubmitting || !name || !tenantId}
              className="btn btn-primary px-4 py-2 bg-accent-blue hover:bg-accent-blue/80 text-white rounded-lg transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting ? 'Guardando...' : 'Crear Inquilino'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
