import api from './client';
import { createAuthApi } from './auth-contract';

export const authApi = createAuthApi(api);
