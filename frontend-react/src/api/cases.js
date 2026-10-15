// ─── Cases API — real backend integration (Phase 2) ─────────────────────────
// casesApi is now the real implementation backed by /api/v1/cases endpoints.
// MOCK_CASES and MOCK_ANALYSIS_RESULT are kept as labelled empty stubs so that
// AnalysisResult.jsx (which still uses mock inference data) continues to compile.
// They will be removed when inference is implemented.
import api from './client.js';
import { createCasesApi } from './cases-contract.js';

export const casesApi = createCasesApi(api);

// ── Inference stubs — NOT real data. Kept only so AnalysisResult.jsx compiles.
// These will be removed once a real model inference backend exists. ─────────
export const MOCK_CASES = [];

export const MOCK_ANALYSIS_RESULT = {
  caseId: null,
  analysisId: null,
  model: 'VascuNet v2.1 (not yet available)',
  date: null,
  totalSlices: 0,
  findings: [],
  diameterProfile: [],
  qualityFlag: 'INFERENCE_NOT_IMPLEMENTED',
  uncertaintyFlag: true,
};

