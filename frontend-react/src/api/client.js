import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env?.VITE_API_URL || '/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('vascuai_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const detail = err.response?.data?.detail;
    if (typeof detail === 'string') err.message = detail;
    if (Array.isArray(detail)) err.message = detail.map((item) => item.msg).join('; ');
    const currentToken = localStorage.getItem('vascuai_token');
    if (err.response?.status === 401 && currentToken
        && err.config?.headers?.Authorization === `Bearer ${currentToken}`
        && !['/auth/login', '/auth/register'].includes(err.config?.url)) {
      localStorage.removeItem('vascuai_token');
      localStorage.removeItem('vascuai_user');
      window.dispatchEvent(new Event('vascuai:unauthorized'));
    }
    return Promise.reject(err);
  },
);
export default api;
