import api from "./client.js";
import { createCasesApi } from "./cases-contract.js";

export const casesApi = createCasesApi(api);
