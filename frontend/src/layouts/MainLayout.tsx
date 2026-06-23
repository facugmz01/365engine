import { Outlet, Link, useLocation, Navigate, useNavigate } from 'react-router-dom';
import { Building2, LayoutDashboard, History, Settings, LogOut, Users, FileText, Package, Briefcase, Download, Shield } from 'lucide-react';
import { useStore } from '../store/useStore';

export default function MainLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, logout } = useStore();

  // Check auth
  const token = localStorage.getItem('token');
  if (!token) {
    return <Navigate to="/login" replace />;
  }

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Get user initials for avatar
  const initials = currentUser?.username
    ? currentUser.username.substring(0, 2).toUpperCase()
    : 'AD';

  const roleLabel = currentUser?.role
    ? currentUser.role.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
    : 'User';

  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Inquilinos', path: '/tenants', icon: Building2 },
    { name: 'Plantillas', path: '/templates', icon: FileText },
    { name: 'Baselines', path: '/baselines', icon: Package },
    { name: 'Trabajos', path: '/jobs', icon: Briefcase },
    { name: 'Auditoría', path: '/audit', icon: History },
    { name: 'Usuarios', path: '/users', icon: Users },
    { name: 'Importar', path: '/import', icon: Download },
    { name: 'Zero Trust', path: '/assessment', icon: Shield },
    { name: 'Ajustes', path: '/settings', icon: Settings },
  ];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-deep text-text-primary font-sans">
      {/* Sidebar */}
      <aside className="w-[260px] bg-bg-panel border-r border-border-color flex flex-col z-10">
        <div className="p-5 flex items-center gap-3 border-b border-border-color">
          <div className="w-10 h-10 rounded-xl bg-neon-cyan flex items-center justify-center text-white">
            <i className="fa-solid fa-cloud text-xl"></i>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-text-primary">NEXUS</h1>
            <span className="text-[0.65rem] uppercase tracking-wider text-text-secondary font-medium">Enterprise Sync</span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-5 px-3 flex flex-col gap-2">
          <div className="text-xs uppercase tracking-widest text-text-muted font-bold mb-2 px-3">Principal</div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
            return (
              <Link
                key={item.name}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-300 font-medium text-sm
                  ${isActive
                    ? 'bg-[rgba(0,240,255,0.1)] text-neon-cyan shadow-[inset_3px_0_0_var(--color-neon-cyan)]'
                    : 'text-text-secondary hover:bg-[rgba(255,255,255,0.03)] hover:text-text-primary hover:translate-x-1'
                  }`}
              >
                <Icon size={18} className={isActive ? 'text-neon-cyan' : 'opacity-70'} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border-color">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 text-text-secondary hover:text-error transition-colors rounded-lg hover:bg-bg-card-hover text-sm font-medium"
          >
            <LogOut size={18} />
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-bg-deep relative">

        {/* Top Navbar */}
        <header className="h-[70px] flex items-center justify-between px-8 bg-bg-panel border-b border-border-color z-10 sticky top-0">
          <h2 className="text-xl font-semibold text-text-primary capitalize tracking-tight">
            {location.pathname === '/' ? 'Dashboard' : location.pathname.split('/')[1]}
          </h2>
          <div className="flex items-center gap-4">
            <div className="w-9 h-9 rounded-full bg-bg-card flex items-center justify-center text-sm font-semibold border border-border-color text-text-primary">
              {initials}
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium">{currentUser?.username || 'Usuario'}</span>
              <span className="text-xs text-text-muted">{roleLabel}</span>
            </div>
          </div>
        </header>

        {/* Dynamic Content */}
        <div className="flex-1 overflow-auto p-8 z-0 relative">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
