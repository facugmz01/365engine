import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { apiClient } from '../api/client';
import { CheckCircle, AlertTriangle } from 'lucide-react';

export default function OAuthCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const processCallback = async () => {
      const params = new URLSearchParams(location.search);
      const code = params.get('code');
      const error = params.get('error');
      const errorDescription = params.get('error_description');

      if (error) {
        setStatus('error');
        setErrorMsg(errorDescription || error);
        return;
      }

      if (!code) {
        setStatus('error');
        setErrorMsg('No se recibió el código de autorización.');
        return;
      }

      const orgId = localStorage.getItem('oauth_org_id');
      if (!orgId) {
        setStatus('error');
        setErrorMsg('No se encontró la organización asociada a esta sesión.');
        return;
      }

      try {
        const redirectUri = window.location.origin + '/oauth/callback';
        await apiClient.post(`/organizations/${orgId}/auth/callback`, {
          code,
          redirect_uri: redirectUri
        });
        
        setStatus('success');
        localStorage.removeItem('oauth_org_id');
        setTimeout(() => {
          navigate(`/tenants/${orgId}`);
        }, 2000);
      } catch (err: any) {
        setStatus('error');
        setErrorMsg(err.response?.data?.detail || err.message || 'Error desconocido al autenticar.');
      }
    };

    processCallback();
  }, [location, navigate]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0D1117] p-4 text-center">
      <div className="glass-panel p-8 max-w-md w-full">
        {status === 'processing' && (
          <>
            <div className="w-12 h-12 border-4 border-accent-blue border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <h2 className="text-xl font-semibold text-text-primary mb-2">Completando Autenticación...</h2>
            <p className="text-text-secondary">Conectando con Microsoft de forma segura. Por favor espera.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle className="w-16 h-16 text-[#3FB950] mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-text-primary mb-2">¡Autenticación Exitosa!</h2>
            <p className="text-[#3FB950]">Las credenciales delegadas han sido guardadas.</p>
            <p className="text-text-muted text-sm mt-4">Redirigiendo al inquilino...</p>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertTriangle className="w-16 h-16 text-[#FF7B72] mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-text-primary mb-2">Error de Autenticación</h2>
            <div className="bg-[#FF7B72]/10 border border-[#FF7B72]/20 text-[#FF7B72] p-3 rounded-lg text-sm mb-6 text-left">
              {errorMsg}
            </div>
            <button
              onClick={() => {
                const orgId = localStorage.getItem('oauth_org_id');
                if (orgId) {
                  navigate(`/tenants/${orgId}`);
                } else {
                  navigate('/tenants');
                }
              }}
              className="px-4 py-2 bg-bg-light border border-border-color rounded-lg text-text-primary hover:bg-border-color transition-colors w-full"
            >
              Volver
            </button>
          </>
        )}
      </div>
    </div>
  );
}
