import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../api/client';
import { useStore } from '../store/useStore';
import { Lock, User } from 'lucide-react';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { setCurrentUser } = useStore();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      // Backend expects: { username, password } → returns { access_token, token_type, role, username }
      const response = await apiClient.post('/auth/login', {
        username,
        password,
      });

      const { access_token, role, username: returnedUsername } = response.data;
      localStorage.setItem('token', access_token);

      // Set current user from login response (no separate /me endpoint needed)
      setCurrentUser({
        id: 'me',
        username: returnedUsername || username,
        role: role || 'viewer',
        is_active: true,
      });

      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Credenciales inválidas o error de conexión');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-bg-deep relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-neon-cyan-glow blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[rgba(139,92,246,0.1)] blur-[120px] pointer-events-none"></div>

      <div className="glass-panel w-full max-w-md p-8 z-10 relative">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-neon-cyan flex items-center justify-center text-white mb-4 shadow-lg shadow-neon-cyan/20">
            <i className="fa-solid fa-cloud text-3xl"></i>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">NEXUS</h1>
          <p className="text-text-muted mt-1">Enterprise Sync Platform</p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-error/10 border border-error/20 rounded-lg text-error text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Usuario</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
                <User size={18} />
              </div>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="block w-full pl-10 pr-3 py-2.5 bg-bg-deep border border-border-color rounded-lg text-text-primary placeholder-text-muted focus:ring-1 focus:ring-border-focus focus:border-border-focus sm:text-sm transition-colors"
                placeholder="Ingresa tu usuario"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Contraseña</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
                <Lock size={18} />
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full pl-10 pr-3 py-2.5 bg-bg-deep border border-border-color rounded-lg text-text-primary placeholder-text-muted focus:ring-1 focus:ring-border-focus focus:border-border-focus sm:text-sm transition-colors"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-accent-blue hover:bg-accent-blue/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent-blue focus:ring-offset-bg-deep disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-2"
          >
            {isLoading ? 'Conectando...' : 'Iniciar Sesión'}
          </button>
        </form>
      </div>
    </div>
  );
}
