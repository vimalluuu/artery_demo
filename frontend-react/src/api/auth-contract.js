export const toUser = (user) => ({ ...user, name: user.full_name });

export function createAuthApi(api) {
  const session = (data) => ({ ...data, user: toUser(data.user) });
  return {
    async login(email, password) {
      return session((await api.post('/auth/login', { email, password })).data);
    },
    async register(payload) {
      await api.post('/auth/register', {
        full_name: payload.name, email: payload.email, password: payload.password,
        role: payload.role || 'Clinician', institution: payload.institution || '',
      });
      return this.login(payload.email, payload.password);
    },
    async me() { return toUser((await api.get('/auth/me')).data); },
    async logout() { await api.post('/auth/logout'); },
    async updateProfile(payload) {
      return toUser((await api.patch('/auth/me', {
        full_name: payload.name, institution: payload.institution, department: payload.department,
      })).data);
    },
    async changePassword(current, password) {
      return session((await api.post('/auth/password', {
        current_password: current, new_password: password,
      })).data);
    },
  };
}
