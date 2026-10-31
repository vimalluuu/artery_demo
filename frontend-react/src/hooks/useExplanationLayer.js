import { useEffect, useRef, useState } from 'react';
import { stenosisApi } from '../api/stenosis';
import { prepareAttribution } from '../lib/volume-loader';
import { addAttributionVolume } from '../lib/niivue-adapter';
import { attributionBudget, attributionPresentation, validateAttributionBinding } from '../lib/attribution';

export function useExplanationLayer(instance,geometry,{ready,view,localization,item,requested,visible,opacity,caseId,parentId}) {
  const [status,setStatus]=useState({id:null,loading:false,error:''});
  const volume=useRef(null),presentation=useRef({view,visible,opacity});
  useEffect(()=>{presentation.current={view,visible,opacity};},[view,visible,opacity]);
  useEffect(()=>{
    if(!ready||!requested||!item||!localization||!instance.current)return;
    const controller=new AbortController(),viewer=instance.current;let alive=true,owned=null;
    const remove=()=>{try{if(owned&&viewer.volumes.includes(owned))viewer.removeVolume(owned);}finally{if(volume.current===owned)volume.current=null;owned=null;}};
    (async()=>{
      try{
        setStatus({id:item.explanation_id,loading:true,error:''});
        validateAttributionBinding(item,localization,geometry.current,caseId,parentId);
        if(item.visualization.status!=='supported')throw new Error(item.visualization.reason);
        attributionBudget(geometry.current.shape,navigator.deviceMemory||8);
        const bytes=await stenosisApi.explanationArtifact(caseId,item.analysis_id,item.explanation_id,{signal:controller.signal});
        const decoded=await prepareAttribution(bytes,localization.segmentation.metadata,item,controller.signal);
        if(!alive)return;
        owned=await addAttributionVolume(viewer,decoded.attribution,geometry.current.affine,item.values,controller.signal);
        if(!alive){remove();return;}
        volume.current=owned;
        const current=presentation.current;
        viewer.setOpacity(viewer.volumes.indexOf(owned),current.visible&&attributionPresentation(item,current.view).allowed?current.opacity:0);
        setStatus({id:item.explanation_id,loading:false,error:''});
      }catch(failure){try{remove();}catch{/* a lost context is already handled by the CT viewer */}if(alive&&!controller.signal.aborted)setStatus({id:item.explanation_id,loading:false,error:failure.message});}
    })();
    return ()=>{alive=false;controller.abort();try{remove();}catch{/* CT teardown may already have released the context */}};
  },[ready,requested,item,localization,instance,geometry,caseId,parentId]);
  useEffect(()=>{
    if(instance.current&&volume.current&&item){try{instance.current.setOpacity(instance.current.volumes.indexOf(volume.current),visible&&attributionPresentation(item,view).allowed?opacity:0);}catch{/* context loss handled by CT session */}}
  },[visible,opacity,view,item,instance]);
  return status.id===item?.explanation_id?status:{loading:false,error:''};
}
