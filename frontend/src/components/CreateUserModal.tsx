import React, { useState } from 'react';
import { X, UserPlus } from 'lucide-react';
import { apiClient } from '../api/client';

interface CreateUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateUserModal({ isOpen, onClose, onSuccess }: CreateUserModalProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('reader');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await apiClient.post('/users', {
        username,
        password,
        role,
      });
      onSuccess();
      onClose();
      setUsername('');
      setPassword('');
      setRole('reader');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Error al crear usuario');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-bg-panel border border-border-color rounded-xl w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-border-color">
          <div className="flex items-center gap-2">
            <UserPlus className="text-accent-blue" size={20} />
            <h2 className="text-lg font-semibold text-text-primary">Invitar Usuario</h2>
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
                Nombre de Usuario <span className="text-error">*</span>
              </label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-bg-deep border border-border-color rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent-blue transition-all"
                placeholder="Ej. admin@miempresa.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Contraseña Temporal <span className="text-error">*</span>
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-bg-deep border border-border-color rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent-blue transition-all"
                placeholder="Contraseña inicial"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Rol <span className="text-error">*</span>
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full bg-bg-deep border border-border-color rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent-blue transition-all"
              >
                <option value="reader">Lector (Solo vista)</option>
                <option value="deployer">Desplegador (Envía simulación)</option>
                <option value="approver">Aprobador (Aprueba Jobs)</option>
                <option value="super_admin">Super Administrador</option>
              </select>
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
              disabled={isSubmitting || !username || !password}
              className="btn btn-primary px-4 py-2 bg-accent-blue hover:bg-accent-blue/80 text-white rounded-lg transition-colors font-medium text-sm disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting ? 'Guardando...' : 'Crear Usuario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
