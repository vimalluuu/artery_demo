import { geometryFingerprint, isHash, isUUID, validateGeometry } from '../lib/stenosis-results.js';
import { sameAffine } from '../lib/volume-geometry.js';
import { attributionMethods, MAX_ATTRIBUTION_BYTES } from '../lib/attribution.js';
import { StenosisContractError } from './stenosis-contract.js';

const text=v=>typeof v==='string'&&v.trim().length>0&&v.length<=1000;
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v);
const fail=()=>{throw new StenosisContractError('Explanation metadata or source association could not be verified. No attribution was displayed.');};

export async function validateExplanations(data,root) {
  if(data?.contract_version!=='1.0'||data.case_id!==root.case_id||data.analysis_id!==root.result.analysis_id||data.result_id!==root.result_id
    ||!['available','not_generated','unsupported_geometry'].includes(data.status)||!Array.isArray(data.items)||data.items.length>16
    ||(data.items.length===0)!==(data.status==='not_generated')
    ||(data.status==='not_generated' ? !text(data.unavailable_reason?.message) : data.unavailable_reason!==null)) fail();
  const ids=new Set(), artifacts=new Set();
  for(const item of data.items) {
    if(item.contract_version!=='1.0'||!isUUID(item.explanation_id)||ids.has(item.explanation_id)||!isUUID(item.artifact_id)||artifacts.has(item.artifact_id)
      ||item.result_id!==root.result_id||item.analysis_id!==root.result.analysis_id||item.source_sha256!==root.result.provenance.source.source_sha256
      ||item.geometry_fingerprint!==root.geometry_fingerprint||!isHash(item.content_sha256)||!attributionMethods.includes(item.method_id)||!text(item.method_name)
      ||!identifier(item.method_version)||!identifier(item.model_id)||!identifier(item.model_version)||item.explanation_type!=='attribution'
      ||item.checkpoint_sha256!==(root.result.provenance.checkpoint_sha256??null)||!identifier(item.target?.identifier)||!text(item.target?.description)||!isHash(item.target?.prediction_sha256)
      ||!['volume','slice','lesion','prediction_target'].includes(item.scope)||!['nii','nii.gz'].includes(item.format)||item.dtype!=='float32'
      ||!text(item.limitations)||!Number.isFinite(Date.parse(item.created_at))||!/(Z|[+-]\d{2}:\d{2})$/.test(item.created_at)
      ||(item.lesion_id!=null&&!root.result.lesions.some(lesion=>lesion.lesion_id===item.lesion_id))||(item.scope==='lesion'&&!item.lesion_id)) fail();
    ids.add(item.explanation_id);artifacts.add(item.artifact_id);
    const geometry=validateGeometry(item.geometry);
    if(!Array.isArray(item.shape)||item.shape.length!==3||item.shape.some((n,i)=>n!==root.result.provenance.geometry.shape[i]||n!==geometry.shape[i])
      ||!sameAffine(geometry.affine,root.result.provenance.geometry.affine)||await geometryFingerprint(geometry,item.source_sha256)!==item.geometry_fingerprint
      ||item.visualization?.status!==root.visualization.status||!text(item.visualization?.reason)) fail();
    const values=item.values,range=values?.expected_range;
    if(!['signed','non_negative'].includes(values?.value_type)||!Array.isArray(range)||range.length!==2||range.some(n=>!Number.isFinite(n))||!(-1e12<=range[0]&&range[0]<range[1]&&range[1]<=1e12)
      ||(values.value_type==='signed' ? !(range[0]<0&&range[1]>0) : range[0]<0)||!['none','provider_defined'].includes(values.normalization)||typeof values.normalized_for_visualization!=='boolean'
      ||(values.normalization==='none' ? values.normalized_for_visualization||values.normalization_description!=null : !text(values.normalization_description))
      ||(item.method_id==='integrated_gradients'&&!text(values.baseline))) fail();
    if(item.scope==='slice' ? ![0,1,2].includes(item.slice_axis)||!Number.isSafeInteger(item.slice_index)||item.slice_index<0||item.slice_index>=item.shape[item.slice_axis]||range[0]>0||range[1]<0 : item.slice_axis!=null||item.slice_index!=null) fail();
  }
  if(data.items.length&&(data.status==='unsupported_geometry')!==(root.visualization.status!=='supported')) fail();
  return data;
}

function base(caseId,analysisId) {
  if(!Number.isSafeInteger(Number(caseId))||Number(caseId)<1||!isUUID(analysisId)) throw new Error('Invalid explanation identity.');
  return `/cases/${Number(caseId)}/stenosis/analyses/${analysisId}/explanations`;
}
function decodeError(error) {
  let data=error.response?.data;
  if(data instanceof ArrayBuffer) {try{data=JSON.parse(new TextDecoder().decode(data));}catch{/* retain HTTP error */}}
  if(data?.detail?.contract_version==='1.0'&&text(data.detail.message)){error.code=data.detail.code;error.message=data.detail.message;}
  return error;
}
export function createStenosisExplanationsApi(api) {
  return {
    async explanations(caseId,analysisId,root,{signal}={}) {
      try { const response=await api.get(base(caseId,analysisId),{signal});if(response.status!==200) fail();return await validateExplanations(response.data,root); }
      catch(error){throw decodeError(error);}
    },
    async explanationArtifact(caseId,analysisId,id,{signal}={}) {
      if(!isUUID(id)) throw new Error('Invalid explanation identity.');
      const controller=new AbortController();const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      let exceeded=false;
      try {
        const response=await api.get(`${base(caseId,analysisId)}/${id}/artifact`,{signal:controller.signal,responseType:'arraybuffer',headers:{Accept:'application/gzip, application/octet-stream'},
          onDownloadProgress:event=>{if(event.loaded>MAX_ATTRIBUTION_BYTES||event.total>MAX_ATTRIBUTION_BYTES){exceeded=true;abort();}}});
        if(controller.signal.aborted) throw new DOMException('Attribution cancelled.','AbortError');
        if(response.status!==200||!(response.data instanceof ArrayBuffer)||!response.data.byteLength||response.data.byteLength>MAX_ATTRIBUTION_BYTES||/json|html|text\//i.test(response.headers?.['content-type']||'')) throw new Error('The server did not return a bounded attribution volume.');
        return response.data;
      }catch(error){if(exceeded)throw new Error('Attribution exceeds the browser transfer limit.');throw decodeError(error);}
      finally{signal?.removeEventListener('abort',abort);}
    },
  };
}
