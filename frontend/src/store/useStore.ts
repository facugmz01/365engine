import { create } from 'zustand';
import { apiClient } from '../api/client';

export interface Organization {
  id: string;
  name: string;
  tenant_id: string;
  // Computed from the backend: OrganizationRead doesn't have has_credentials,
  // but the list endpoint loads credentials via selectinload so we derive it.
  has_credentials: boolean;
  auto_drift_enabled: boolean;
  drift_scan_schedule: string | null;
  created_at: string;
}

export interface User {
  id: string;
  username: string;
  role: string;
  is_active: boolean;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  endpoint: string;
  created_at: string;
}

export interface Package {
  id: string;
  name: string;
  description: string;
  created_at: string;
  templates: Template[];
}

// Matches backend DeploymentJobRead
export interface Job {
  id: string;
  organization_id: string;
  status: string;
  parameters: Record<string, any> | null;
  logs: any[];
  created_at: string;
  completed_at: string | null;
  templates: Template[];
}

interface AppState {
  organizations: Organization[];
  templates: Template[];
  packages: Package[];
  jobs: Job[];
  isLoading: boolean;
  error: string | null;
  currentUser: User | null;

  // Actions
  fetchOrganizations: () => Promise<void>;
  fetchTemplates: () => Promise<void>;
  createTemplate: (data: any) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  fetchPackages: () => Promise<void>;
  fetchJobs: () => Promise<void>;
  setCurrentUser: (user: User | null) => void;
  logout: () => void;
}

/**
 * The backend's OrganizationRead schema doesn't include `has_credentials`.
 * However the list endpoint eagerly loads credentials. We map by checking
 * the raw response (which may include a `credentials` array) and derive the flag.
 */
function mapOrganization(raw: any): Organization {
  return {
    id: String(raw.id),
    name: raw.name,
    tenant_id: raw.tenant_id,
    has_credentials: Array.isArray(raw.credentials)
      ? raw.credentials.length > 0
      : Boolean(raw.has_credentials),
    auto_drift_enabled: raw.auto_drift_enabled ?? false,
    drift_scan_schedule: raw.drift_scan_schedule ?? null,
    created_at: raw.created_at,
  };
}

// Restore currentUser from localStorage on startup
function getStoredUser(): User | null {
  try {
    const raw = localStorage.getItem('currentUser');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const useStore = create<AppState>((set, get) => ({
  organizations: [],
  templates: [],
  packages: [],
  jobs: [],
  isLoading: false,
  error: null,
  currentUser: getStoredUser(),

  fetchOrganizations: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiClient.get('/organizations');
      const orgs: Organization[] = (response.data as any[]).map(mapOrganization);
      set({ organizations: orgs, isLoading: false });
    } catch (error: any) {
      set({
        error: error.response?.data?.detail || 'Failed to fetch organizations',
        isLoading: false,
      });
    }
  },

  fetchTemplates: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiClient.get('/templates');
      set({ templates: response.data, isLoading: false });
    } catch (error: any) {
      set({ error: error.response?.data?.detail || 'Failed to fetch templates', isLoading: false });
    }
  },

  createTemplate: async (data: any) => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiClient.post('/templates', data);
      set({ templates: [...get().templates, response.data] });
    } catch (error: any) {
      set({ error: error.response?.data?.detail || error.message });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  deleteTemplate: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await apiClient.delete(`/templates/${id}`);
      set({ templates: get().templates.filter(t => t.id !== id) });
    } catch (error: any) {
      set({ error: error.response?.data?.detail || error.message });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  fetchPackages: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiClient.get('/packages');
      set({ packages: response.data, isLoading: false });
    } catch (error: any) {
      set({ error: error.response?.data?.detail || 'Failed to fetch packages', isLoading: false });
    }
  },

  // Backend endpoint: GET /api/v1/deployments
  fetchJobs: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiClient.get('/deployments');
      set({ jobs: response.data, isLoading: false });
    } catch (error: any) {
      set({ error: error.response?.data?.detail || 'Failed to fetch deployments', isLoading: false });
    }
  },

  setCurrentUser: (user) => {
    if (user) {
      localStorage.setItem('currentUser', JSON.stringify(user));
    } else {
      localStorage.removeItem('currentUser');
    }
    set({ currentUser: user });
  },

  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
    set({ currentUser: null, organizations: [], templates: [], packages: [], jobs: [] });
  },
}));
