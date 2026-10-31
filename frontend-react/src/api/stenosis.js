import api from "./client.js";
import { createStenosisApi } from "./stenosis-contract.js";
import { createStenosisJobsApi } from "./stenosis-jobs-contract.js";
import { createStenosisResultsApi } from "./stenosis-results-contract.js";
import { createStenosisExplanationsApi } from "./stenosis-explanations-contract.js";
import { createStenosisReportingApi } from "./stenosis-reporting-contract.js";

export const stenosisApi = { ...createStenosisApi(api), ...createStenosisJobsApi(api), ...createStenosisResultsApi(api), ...createStenosisExplanationsApi(api), ...createStenosisReportingApi(api) };
