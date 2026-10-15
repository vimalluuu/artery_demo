import api from './client.js';
import { createPatientsApi } from './patients-contract.js';

export const patientsApi = createPatientsApi(api);
