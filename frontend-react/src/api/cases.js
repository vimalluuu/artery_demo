// ─── Cases API — mock data, swap in real endpoints when backend ready ───
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export const MOCK_CASES = [
  {
    id: 'CASE-1043',
    modality: 'CT Angiography',
    region: 'Coronary',
    scanDate: '2026-10-10',
    status: 'Complete',
    severity: 'Moderate',
    confidence: 91.3,
    createdBy: 'Dr. Aisha Patel',
    notes: 'Patient with prior history of CAD. De-identified.',
    age: 58,
    gender: 'M',
    riskFactors: ['Hypertension', 'Diabetes'],
    analyses: [
      { id: 'a-001', date: '2026-10-10T14:30:00Z', model: 'VascuNet v2.1', severity: 'Moderate', confidence: 91.3 },
    ],
  },
  {
    id: 'CASE-1042',
    modality: 'MRA',
    region: 'Carotid',
    scanDate: '2026-10-09',
    status: 'Processing',
    severity: null,
    confidence: null,
    createdBy: 'Dr. James Osei',
    notes: '',
    age: 67,
    gender: 'F',
    riskFactors: ['Smoking'],
    analyses: [],
  },
  {
    id: 'CASE-1041',
    modality: 'CT Angiography',
    region: 'Renal',
    scanDate: '2026-10-08',
    status: 'Complete',
    severity: 'Mild',
    confidence: 88.7,
    createdBy: 'Dr. Aisha Patel',
    notes: 'Routine screening.',
    age: 52,
    gender: 'M',
    riskFactors: [],
    analyses: [
      { id: 'a-002', date: '2026-10-08T10:15:00Z', model: 'VascuNet v2.1', severity: 'Mild', confidence: 88.7 },
    ],
  },
  {
    id: 'CASE-1040',
    modality: 'CT Angiography',
    region: 'Coronary',
    scanDate: '2026-10-07',
    status: 'Complete',
    severity: 'Severe',
    confidence: 94.1,
    createdBy: 'Dr. Liu Wei',
    notes: 'Urgent review requested.',
    age: 71,
    gender: 'F',
    riskFactors: ['Hypertension', 'Hyperlipidaemia'],
    analyses: [
      { id: 'a-003', date: '2026-10-07T09:00:00Z', model: 'VascuNet v2.1', severity: 'Severe', confidence: 94.1 },
    ],
  },
  {
    id: 'CASE-1039',
    modality: 'MRA',
    region: 'Peripheral',
    scanDate: '2026-10-06',
    status: 'Pending',
    severity: null,
    confidence: null,
    createdBy: 'Dr. James Osei',
    notes: 'Awaiting upload.',
    age: 44,
    gender: 'M',
    riskFactors: [],
    analyses: [],
  },
  {
    id: 'CASE-1038',
    modality: 'CT Angiography',
    region: 'Coronary',
    scanDate: '2026-10-05',
    status: 'Failed',
    severity: null,
    confidence: null,
    createdBy: 'Dr. Liu Wei',
    notes: 'Poor image quality — reupload needed.',
    age: 63,
    gender: 'F',
    riskFactors: ['Obesity'],
    analyses: [],
  },
];

export const MOCK_ANALYSIS_RESULT = {
  caseId: 'CASE-1043',
  analysisId: 'a-001',
  model: 'VascuNet v2.1',
  date: '2026-10-10T14:30:00Z',
  totalSlices: 48,
  findings: [
    {
      id: 'f-001',
      vessel: 'LAD (Proximal)',
      minDiameter: 1.8,
      refDiameter: 3.2,
      narrowing: 43.8,
      severity: 'Moderate',
      confidence: 91.3,
      slice: 22,
    },
    {
      id: 'f-002',
      vessel: 'RCA (Mid)',
      minDiameter: 2.1,
      refDiameter: 3.0,
      narrowing: 30.0,
      severity: 'Mild',
      confidence: 88.2,
      slice: 31,
    },
  ],
  diameterProfile: Array.from({ length: 50 }, (_, i) => ({
    x: i,
    measured: 3.2 - (i > 18 && i < 28 ? 1.4 * Math.sin(((i - 18) * Math.PI) / 10) : 0) + (Math.random() * 0.15 - 0.075),
    reference: 3.2,
  })),
  qualityFlag: null,
  uncertaintyFlag: false,
};

export const casesApi = {
  async list() {
    await delay(500);
    return [...MOCK_CASES];
  },

  async get(id) {
    await delay(400);
    const c = MOCK_CASES.find((x) => x.id === id);
    if (!c) throw new Error('Case not found');
    return c;
  },

  async create(payload) {
    await delay(600);
    const newCase = {
      id: `CASE-${Math.floor(1000 + Math.random() * 9000)}`,
      status: 'Pending',
      severity: null,
      confidence: null,
      createdBy: 'Dr. Aisha Patel',
      analyses: [],
      ...payload,
    };
    MOCK_CASES.unshift(newCase);
    return newCase;
  },

  async upload(id, formData) {
    await delay(1500);
    const c = MOCK_CASES.find((x) => x.id === id);
    if (c) c.status = 'Processing';
    return { message: 'Upload successful' };
  },

  async analyze(id) {
    await delay(2000);
    const c = MOCK_CASES.find((x) => x.id === id);
    if (c) { c.status = 'Complete'; c.severity = 'Moderate'; c.confidence = 91.3; }
    return MOCK_ANALYSIS_RESULT;
  },

  async getAnalysis(caseId, analysisId) {
    await delay(400);
    return MOCK_ANALYSIS_RESULT;
  },
};
