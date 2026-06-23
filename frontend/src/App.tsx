import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import Dashboard from './pages/Dashboard';
import Tenants from './pages/Tenants';
import TenantDetail from './pages/TenantDetail';
import Templates from './pages/Templates';
import Baselines from './pages/Baselines';
import Jobs from './pages/Jobs';
import Import from './pages/Import';
import Audit from './pages/Audit';
import Users from './pages/Users';
import Login from './pages/Login';
import Settings from './pages/Settings';
import Assessment from './pages/Assessment';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="tenants" element={<Tenants />} />
          <Route path="tenants/:id" element={<TenantDetail />} />
          <Route path="templates" element={<Templates />} />
          <Route path="baselines" element={<Baselines />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="audit" element={<Audit />} />
          <Route path="users" element={<Users />} />
          <Route path="import" element={<Import />} />
          <Route path="assessment" element={<Assessment />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
