// ─── Mock accounts for demo — swap for real API calls when backend is ready ────
const MOCK_DELAY = 300;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export const DEMO_USERS = {
  admin: {
    id: 'u-004',
    name: 'Prof. Sara Khan',
    email: 'admin@research.med',
    role: 'Admin',
    department: 'Clinical AI Governance',
    institution: 'City Medical Center',
  },
  clinician: {
    id: 'u-001',
    name: 'Dr. Aisha Patel',
    email: 'aisha.patel@research.med',
    role: 'Clinician',
    department: 'Interventional Cardiology',
    institution: 'City Medical Center',
  },
  datascientist: {
    id: 'u-003',
    name: 'Dr. Liu Wei',
    email: 'liu.wei@research.med',
    role: 'DataScientist',
    department: 'Medical Imaging AI Lab',
    institution: 'Institute for Bioimaging',
  },
  researcher: {
    id: 'u-002',
    name: 'Dr. James Osei',
    email: 'james.osei@research.med',
    role: 'Researcher',
    department: 'Vascular Radiology',
    institution: 'City Medical Center',
  },
};

function resolveUserByEmail(email) {
  const norm = (email || '').toLowerCase();
  if (norm.includes('admin') || norm.includes('sara.khan')) {
    return { ...DEMO_USERS.admin, email };
  }
  if (norm.includes('scientist') || norm.includes('data') || norm.includes('liu.wei')) {
    return { ...DEMO_USERS.datascientist, email };
  }
  if (norm.includes('research') || norm.includes('osei')) {
    return { ...DEMO_USERS.researcher, email };
  }
  return { ...DEMO_USERS.clinician, email };
}

// ─── Auth ──────────────────────────────────────────────────────────
export const authApi = {
  async login(email, password) {
    await delay(MOCK_DELAY);
    if (!email || !password) throw new Error('Invalid credentials');
    const user = resolveUserByEmail(email);
    return { access_token: `mock-jwt-token-${user.role.toLowerCase()}`, user };
  },

  async register(payload) {
    await delay(MOCK_DELAY);
    const role = payload.role || 'Clinician';
    const user = {
      id: `u-${Date.now()}`,
      name: payload.name || 'New User',
      email: payload.email,
      role,
      department: payload.department || 'Cardiology',
      institution: payload.institution || 'Medical Center',
    };
    return { access_token: 'mock-jwt-token', user };
  },

  async me() {
    await delay(150);
    const saved = localStorage.getItem('vascuai_user');
    return saved ? JSON.parse(saved) : DEMO_USERS.clinician;
  },
};

