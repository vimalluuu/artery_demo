import { useCallback, useEffect, useState } from 'react';
import { stenosisApi } from '../api/stenosis';
import { useAnalysisTracker } from '../hooks/useAnalysisTracker';
import { interpretationNote } from '../lib/attribution';
import { ErrorState, Loading, Metadata, Panel } from './ui';

const neverPoll=()=>false;
export default function ExplanationPanel({root,selectedLesionId,onSelect}) {
  const load=useCallback(signal=>stenosisApi.explanations(root.case_id,root.result.analysis_id,root,{signal}),[root]);
  const state=useAnalysisTracker(load,neverPoll);
  const [selectedId,setSelectedId]=useState('');
  const items=state.data?.items.filter(item=>!item.lesion_id||item.lesion_id===selectedLesionId)||[];
  const selected=!state.error?items.find(item=>item.explanation_id===selectedId)||null:null;
  useEffect(()=>{onSelect(selected);return ()=>onSelect(null);},[selected,onSelect]);
  return <Panel title="Model attribution" description="Research visualization infrastructure; no explanation generator is enabled">
    <p className="notice">An attribution map is method-specific, not diagnostic proof, a lesion boundary, a probability of stenosis or a calibrated confidence estimate.</p>
    {state.loading&&!state.data&&<Loading label="Loading explanation metadata…"/>}
    {state.error&&<ErrorState error={state.error} retry={()=>state.refresh()}/>}
    {state.data&&!state.error&&<>
      {!state.data.items.length?<p className="notice">{state.data.unavailable_reason.message}</p>:<>
        {!items.length&&<p className="notice">No explanation was supplied for the selected candidate. Other candidates may have separate explanations.</p>}
        <label className="form-label">Explanation method and target<select className="form-input" aria-label="Explanation method and target" value={selected?.explanation_id||''} onChange={event=>setSelectedId(event.target.value)}>
          <option value="">No explanation selected</option>
          {items.map(item=><option key={item.explanation_id} value={item.explanation_id}>{item.method_name} / {item.method_version} · {item.target.identifier} · {item.model_id} / {item.model_version} · {item.scope}</option>)}
        </select></label>
        <button className="btn btn-ghost btn-sm" onClick={()=>setSelectedId('')} disabled={!selected}>Clear explanation selection</button>
        {selected&&<section aria-label="Selected explanation metadata">
          <Metadata items={[["Method",`${selected.method_name} / ${selected.method_version}`],["Target",`${selected.target.identifier}: ${selected.target.description}`],["Model",`${selected.model_id} / ${selected.model_version}`],["Checkpoint",selected.checkpoint_sha256],["Scope",selected.scope],["Values",selected.values.value_type==='signed'?'Signed attribution':'Non-negative activation'],["Declared range",selected.values.expected_range.join(' to ')],["Normalization",selected.values.normalization_description||'None; original values retained'],["Normalized for visualization",selected.values.normalized_for_visualization?'Yes, by provider':'No'],["Baseline/reference",selected.values.baseline],["Source SHA-256",selected.source_sha256],["Prediction record SHA-256",selected.target.prediction_sha256],["Artifact SHA-256",selected.content_sha256]]}/>
          <p className="notice">{interpretationNote(selected.method_id)} {selected.limitations}</p>
          {selected.visualization.status!=='supported'&&<p className="notice" role="alert">{selected.visualization.reason}</p>}
          <p className="text-sm">Open the existing CT viewer below and enable its attribution layer. Each artifact uses its own declared scale; different methods are not directly comparable.</p>
        </section>}
      </>}
    </>}
  </Panel>;
}
