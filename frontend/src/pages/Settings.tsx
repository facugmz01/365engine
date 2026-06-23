import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, RefreshCw } from 'lucide-react';
import { apiClient } from '../api/client';

export default function Settings() {
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await apiClient.get('/auth/sso/config');
      setSsoEnabled(response.data.enabled);
    } catch (error) {
      console.error("Failed to load settings");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-text-primary flex items-center gap-3">
            <SettingsIcon className="text-accent-blue" size={32} />
            Configuración Global
          </h1>
          <p className="text-text-secondary mt-1">
            Administra las configuraciones maestras de la plataforma.
          </p>
        </div>
        <button 
          onClick={fetchSettings}
          className="btn btn-secondary flex items-center gap-2"
        >
          <RefreshCw size={18} className={isLoading ? "animate-spin" : ""} />
          Refrescar
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2 text-text-primary">
            <SettingsIcon size={20} className="text-accent-blue" />
            Configuración de Seguridad (SSO)
          </h2>
          
          {isLoading ? (
            <div className="flex justify-center p-8"><RefreshCw className="animate-spin text-accent-blue" /></div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 bg-bg-deep rounded-lg border border-border-color">
                <div>
                  <h3 className="font-medium text-text-primary">Single Sign-On (Entra ID)</h3>
                  <p className="text-sm text-text-secondary">Permite a los usuarios iniciar sesión con su cuenta corporativa.</p>
                </div>
                <div>
                  <span className={`px-3 py-1 text-xs font-semibold rounded-full ${ssoEnabled ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-bg-light text-text-secondary border border-border-color'}`}>
                    {ssoEnabled ? 'ACTIVADO' : 'DESACTIVADO'}
                  </span>
                </div>
              </div>
              <p className="text-xs text-text-secondary italic">
                Nota: Las configuraciones de SSO se manejan a nivel de variables de entorno en el servidor FastAPI.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
