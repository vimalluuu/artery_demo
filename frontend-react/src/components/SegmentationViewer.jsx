import { useEffect, useRef, useState } from 'react';
import { segmentationApi } from '../api/segmentation';
import { loadViewerPair } from '../lib/volume-loader';
import { createVolumeViewer, graphicsCapabilities, releaseViewer } from '../lib/niivue-adapter';
import { useLesionLayer } from '../hooks/useLesionLayer';
import { useCandidateRegion } from '../hooks/useCandidateRegion';
import { useExplanationLayer } from '../hooks/useExplanationLayer';
import { attributionLegend, attributionPresentation, navigateToAttributionSlice } from '../lib/attribution';

export default function SegmentationViewer(props) {
  const [attempt, setAttempt] = useState(0);
  return <ViewerSession key={attempt} {...props} onRetry={() => setAttempt(v => v + 1)} />;
}

function ViewerSession({ caseId, result, onClose, onRetry, localization = null, explanation = null, selectedLesionId = null, onLesionSelect }) {
  const canvas = useRef(null);
  const heading = useRef(null);
  const instance = useRef(null);
  const sourceGeometry = useRef(null);
  const imageUpdate = useRef(null);
  const [phase, setPhase] = useState('Checking browser and source provenance…');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({});
  const [ready, setReady] = useState(false);
  const [location, setLocation] = useState(null);
  const [windowWidth, setWindowWidth] = useState(1000);
  const [level, setLevel] = useState(300);
  const [opacity, setOpacity] = useState(.55);
  const [visible, setVisible] = useState(true);
  const [view, setView] = useState('slices');
  const [camera, setCamera] = useState({ azimuth: 110, elevation: 10, zoom: 1 });
  const [showRegion, setShowRegion] = useState(false);
  const lesionLayer = useLesionLayer(instance, canvas, sourceGeometry, {
    ready, view, location, caseId, parentId: result.id, localization, selectedId: selectedLesionId,
    onSelect: onLesionSelect, onSlices: () => { if (view === 'mask3d') changeView('slices'); },
  });
  const lesionLocation = lesionLayer.onLocation;
  const candidate = useCandidateRegion(instance, sourceGeometry, { ready, view, localization,
    selectedId: selectedLesionId, caseId, enabled: showRegion && !lesionLayer.error });
  const hasRegion = Boolean(localization?.result.lesions.find(item => item.lesion_id === selectedLesionId)?.candidate_region);
  const [explanationSettings,setExplanationSettings]=useState({id:null,requested:false,visible:false,opacity:.35});
  const settings=explanationSettings.id===explanation?.explanation_id?explanationSettings:{requested:false,visible:false,opacity:.35};
  const setAttribution=value=>setExplanationSettings(current=>({...(current.id===explanation?.explanation_id?current:{requested:false,visible:false,opacity:.35}),id:explanation?.explanation_id,...value}));
  const attribution=useExplanationLayer(instance,sourceGeometry,{ready,view,localization,item:explanation,...settings,caseId,parentId:result.id});

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let viewer;
    let alive = true;
    const token = localStorage.getItem('vascuai_token');
    const fail = message => {
      if (!alive) return;
      controller.abort();
      releaseViewer(viewer);
      instance.current = null;
      setReady(false); setError(message);
    };
    const checkSession = () => { if (token !== localStorage.getItem('vascuai_token')) fail('Your session changed. Close the viewer and sign in again.'); };
    const checkFreshness = async () => {
      try {
        checkSession();
        const runs = await segmentationApi.list(caseId, { signal: controller.signal });
        const current = runs.find(r => r.id === result.id && r.case_id === Number(caseId));
        if (!current || current.stale || current.metadata?.source_sha256 !== result.metadata.source_sha256) fail('The source changed or cannot be verified. Close the viewer, refresh history and use a current result.');
      } catch { fail('Input freshness could not be verified. Close and reopen the viewer.'); }
    };
    const contextLost = event => { event.preventDefault(); if (!controller.signal.aborted) fail('The GPU context was lost. Reopen the viewer or use the downloads.'); };
    const element = canvas.current;
    element.addEventListener('webglcontextlost', contextLost);
    (async () => {
      try {
        graphicsCapabilities(result.metadata?.shape || []);
        const pair = await loadViewerPair(segmentationApi, caseId, result, {
          signal: controller.signal,
          onPhase: message => { if (alive) setPhase(message); },
          onProgress: (artifact, value) => { if (alive) setProgress(current => ({ ...current, [artifact]: value })); },
        });
        if (!alive || controller.signal.aborted) return;
        setPhase('Preparing GPU textures and rendering slices…');
        sourceGeometry.current = pair.geometry;
        viewer = await createVolumeViewer(element, pair, value => { if (alive) { setLocation(value); lesionLocation(value); } }, controller.signal);
        if (!alive || controller.signal.aborted) { releaseViewer(viewer); return; }
        instance.current = viewer;
        const syncCamera = () => {
          if (alive && !controller.signal.aborted) setCamera({
            azimuth: viewer.scene.renderAzimuth,
            elevation: viewer.scene.renderElevation,
            zoom: viewer.scene.volScaleMultiplier,
          });
        };
        viewer.onAzimuthElevationChange = syncCamera;
        viewer.onZoom3DChange = syncCamera;
        syncCamera();
        setReady(true); setPhase('');
      } catch (failure) {
        if (alive && !controller.signal.aborted) fail(failure.message || 'The medical volumes could not be displayed.');
      }
    })();
    window.addEventListener('storage', checkSession);
    window.addEventListener('vascuai:unauthorized', checkSession);
    window.addEventListener('focus', checkFreshness);
    const interval = setInterval(checkFreshness, 60_000);
    return () => {
      alive = false; controller.abort();
      clearTimeout(imageUpdate.current);
      clearInterval(interval);
      window.removeEventListener('storage', checkSession);
      window.removeEventListener('vascuai:unauthorized', checkSession);
      window.removeEventListener('focus', checkFreshness);
      element.removeEventListener('webglcontextlost', contextLost);
      releaseViewer(viewer); instance.current = null;
    };
  }, [caseId, result, lesionLocation]);

  function setSlice(axis, index) {
    const viewer = instance.current;
    if (!viewer || !location) return;
    const next = [...viewer.scene.crosshairPos];
    next[axis] = (Number(index) + .5) / location.dimensions[axis];
    viewer.scene.crosshairPos = next;
    viewer.drawScene();
    setLocation(current => ({ ...current, fraction: next, world: Array.from(viewer.frac2mm(next)).slice(0, 3) }));
    lesionLocation({ world: Array.from(viewer.frac2mm(next)).slice(0, 3) });
  }
  function changeWindow(width, center) {
    setWindowWidth(width); setLevel(center);
    clearTimeout(imageUpdate.current);
    imageUpdate.current = setTimeout(() => {
      if (instance.current) {
        try {
          instance.current.volumes[0].cal_min = center - width / 2;
          instance.current.volumes[0].cal_max = center + width / 2;
          instance.current.updateGLVolume();
        } catch { stopRendering(); }
      }
    }, 150);
  }
  function changeOverlay(show, amount) {
    setVisible(show); setOpacity(amount);
    try { instance.current?.setOpacity(1, show ? amount : 0); }
    catch { stopRendering(); }
  }
  function changeView(mode) {
    setView(mode);
    const viewer = instance.current;
    if (viewer) {
      // Render the real label volume in 3D; hide CT density in this mode.
      try {
        viewer.setOpacity(0, mode === 'mask3d' ? 0 : 1);
        viewer.setSliceType({ slices: viewer.sliceTypeMultiplanar, axial: viewer.sliceTypeAxial, coronal: viewer.sliceTypeCoronal, sagittal: viewer.sliceTypeSagittal, mask3d: viewer.sliceTypeRender }[mode]);
      } catch { stopRendering(); }
    }
  }
  function rotate(amount) {
    const viewer = instance.current;
    if (!viewer) return;
    try { viewer.setRenderAzimuthElevation(viewer.scene.renderAzimuth + amount, viewer.scene.renderElevation); }
    catch { stopRendering(); }
  }
  function tilt(amount) {
    const viewer = instance.current;
    if (!viewer) return;
    try { viewer.setRenderAzimuthElevation(viewer.scene.renderAzimuth, Math.max(-90, Math.min(90, viewer.scene.renderElevation + amount))); }
    catch { stopRendering(); }
  }
  function zoom(direction) {
    const viewer = instance.current;
    if (!viewer) return;
    const current = viewer.scene.volScaleMultiplier;
    try { viewer.setScale(direction > 0 ? Math.min(2, current * 1.25) : Math.max(.5, current / 1.25)); }
    catch { stopRendering(); }
  }
  function resetCamera() {
    const viewer = instance.current;
    if (!viewer) return;
    try {
      viewer.setScale(1);
      viewer.setRenderAzimuthElevation(110, 10);
    } catch { stopRendering(); }
  }
  function stopRendering() {
    releaseViewer(instance.current); instance.current = null;
    setReady(false); setError('Rendering failed or GPU resources were exhausted. Retry the viewer or use the authenticated downloads.');
  }
  const shape = result.metadata.shape || [];
  return (
    <section className="volume-viewer" aria-label={`CT and segmentation viewer for run ${result.id}`}>
      <div className="volume-viewer-heading"><div><h2 ref={heading} tabIndex={-1}>CT + predicted segmentation</h2><p className="text-xs text-muted">Case {caseId} · Run {result.id.slice(0, 8)}</p></div><button className="btn btn-ghost btn-sm" onClick={onClose}>Close viewer</button></div>
      <p className="notice">Experimental research visualization — not for diagnostic use. This baseline has substantial segmentation limitations. Magenta indicates predicted foreground; no clinical accuracy is implied.</p>
      {phase && !error && <div role="status"><p>{phase}</p>{Object.entries(progress).map(([artifact, value]) => <p className="text-xs" key={artifact}>{artifact === 'source' ? 'CT' : 'Mask'}: {(value.loaded / 1024 ** 2).toFixed(1)} MiB{value.total ? ` / ${(value.total / 1024 ** 2).toFixed(1)} MiB` : ' received'}</p>)}</div>}
      {error && <div className="notice error" role="alert"><p>{error}</p><p>Original authenticated downloads remain available in history.</p><button className="btn btn-ghost btn-sm" onClick={onRetry}>Retry viewer</button></div>}
      <div className={`volume-canvas-container${!ready ? ' volume-canvas-loading' : ''}`}>
        <canvas ref={canvas} aria-label="CT slices with the matching binary segmentation overlay" tabIndex={0} role="img">Use the labelled slice controls to navigate. A WebGL2-capable browser is required.</canvas>
        {ready && localization && <div className="lesion-marker-layer" aria-label="Validated candidate locations">
          {lesionLayer.markers.map(marker => <button key={`${marker.id}-${marker.plane}`} className={`lesion-marker${marker.selected ? ' lesion-marker-selected' : ''}`} style={{ left: `${marker.x}%`, top: `${marker.y}%` }} title={`${marker.plane} · Candidate ${marker.id}`} aria-label={`Select ${marker.plane} candidate ${marker.id}`} aria-pressed={marker.selected} onClick={() => onLesionSelect?.(marker.id)} />)}
        </div>}
      </div>
      {localization && <>
        <p className="text-xs">Point legend: cyan circle = supplied candidate; yellow ring = selected candidate. Magenta remains predicted artery, not stenosis. Points are shown only on their current 2D slices.</p>
        {lesionLayer.error && <p className="notice error" role="alert">{lesionLayer.error} The original CT display is retained.</p>}
        {lesionLayer.ambiguous && <p className="notice">Multiple candidates share this position. Use the candidate list to choose; no ambiguous reverse selection was made.</p>}
        {hasRegion ? <label className="volume-checkbox"><input type="checkbox" checked={showRegion} onChange={event => setShowRegion(event.target.checked)} disabled={!ready || Boolean(lesionLayer.error)} />Show supplied candidate region (green, 2D slices only)</label> : <p className="text-xs text-muted">No candidate-region artifact was supplied for this selection.</p>}
        {candidate.loading && <p role="status">Loading and verifying supplied candidate region…</p>}
        {candidate.error && <p className="notice error" role="alert">{candidate.error} The CT and artery overlay are retained.</p>}
      </>}
      {explanation&&<fieldset className="volume-controls attribution-controls" disabled={!ready}><legend>Model attribution visualization — research use only</legend>
        <p className="attribution-wide">{explanation.method_name} / {explanation.method_version} · Target {explanation.target.identifier} · {explanation.model_id} / {explanation.model_version} · {explanation.scope}</p>
        <label className="volume-checkbox"><input type="checkbox" checked={settings.visible} onChange={event=>setAttribution({visible:event.target.checked,requested:true})}/>Show attribution overlay</label>
        <label>Attribution opacity<input type="range" min="0" max="1" step="0.05" value={settings.opacity} onChange={event=>setAttribution({opacity:Number(event.target.value)})}/><output>{Math.round(settings.opacity*100)}%</output></label>
        <button className="btn btn-ghost btn-sm" onClick={()=>setAttribution({visible:false,opacity:.35})}>Reset attribution visualization</button>
        {explanation.scope==='slice'&&<button className="btn btn-ghost btn-sm" onClick={()=>navigateToAttributionSlice(instance.current,explanation,changeView)}>Navigate to explanation slice</button>}
        <div className="attribution-wide" role="img" aria-label={`${explanation.values.value_type==='signed'?'Signed attribution: blue negative, transparent zero, orange positive':'Non-negative activation: transparent minimum to orange maximum'}; range ${explanation.values.expected_range.join(' to ')}`}>
          <div className="attribution-scale" style={{background:attributionLegend(explanation.values)}}/>
          <p className="text-xs">{explanation.values.value_type==='signed'?`${explanation.values.expected_range[0]} negative (blue) · 0 transparent · ${explanation.values.expected_range[1]} positive (orange)`:`${explanation.values.expected_range[0]} minimum (transparent) → ${explanation.values.expected_range[1]} maximum (orange)`}. Fixed declared value scale; no automatic normalization. Values are not probabilities or confidence.</p>
        </div>
        {settings.visible&&!attributionPresentation(explanation,view).allowed&&<p className="notice attribution-wide">{attributionPresentation(explanation,view).reason}</p>}
        {attribution.loading&&<p role="status" className="attribution-wide">Loading and verifying attribution…</p>}
        {attribution.error&&<p role="alert" className="notice error attribution-wide">{attribution.error} The original CT is retained. Clear and reselect the explanation to retry.</p>}
      </fieldset>}
      <fieldset disabled={!ready} className="volume-controls"><legend>Image controls</legend>
        <label>View<select aria-label="View" value={view} onChange={e => changeView(e.target.value)}>{[['slices','All three planes'], ['axial','Axial'], ['coronal','Coronal'], ['sagittal','Sagittal'], ['mask3d','3D binary mask']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Window width<input type="range" min="1" max="3000" step="1" value={windowWidth} disabled={view === 'mask3d'} onChange={e => changeWindow(Number(e.target.value), level)} /><output>{windowWidth}</output></label>
        <label>Window level<input type="range" min="-1000" max="1500" step="1" value={level} disabled={view === 'mask3d'} onChange={e => changeWindow(windowWidth, Number(e.target.value))} /><output>{level}</output></label>
        <label className="volume-checkbox"><input type="checkbox" checked={visible} onChange={e => changeOverlay(e.target.checked, opacity)} />Show segmentation</label>
        <label>Overlay opacity<input type="range" min="0" max="1" step="0.05" value={opacity} onChange={e => changeOverlay(visible, Number(e.target.value))} /><output>{Math.round(opacity * 100)}%</output></label>
        {[[2,'Axial'], [1,'Coronal'], [0,'Sagittal']].map(([axis, name]) => {
          const dimensions = location?.dimensions || [1,1,1];
          const index = Math.min(dimensions[axis] - 1, Math.max(0, Math.floor((location?.fraction[axis] || 0) * dimensions[axis])));
          return <label key={axis}>{name} slice<input type="range" min="0" max={dimensions[axis] - 1} step="1" value={index} disabled={view === 'mask3d'} onChange={e => setSlice(axis, e.target.value)} /><output>{index + 1} / {dimensions[axis]}</output></label>;
        })}
      </fieldset>
      {ready && view === 'mask3d' && <>
        <div className="segmentation-downloads" role="group" aria-label="3D view controls">
          <button className="btn btn-ghost btn-sm" onClick={() => rotate(-30)}>Rotate 3D left</button>
          <button className="btn btn-ghost btn-sm" onClick={() => rotate(30)}>Rotate 3D right</button>
          <button className="btn btn-ghost btn-sm" disabled={camera.elevation >= 90} onClick={() => tilt(15)}>Tilt 3D up</button>
          <button className="btn btn-ghost btn-sm" disabled={camera.elevation <= -90} onClick={() => tilt(-15)}>Tilt 3D down</button>
          <button className="btn btn-ghost btn-sm" disabled={camera.zoom >= 2} onClick={() => zoom(1)}>Zoom 3D in</button>
          <button className="btn btn-ghost btn-sm" disabled={camera.zoom <= .5} onClick={() => zoom(-1)}>Zoom 3D out</button>
          <button className="btn btn-ghost btn-sm" onClick={resetCamera}>Reset 3D view</button>
        </div>
        <p className="text-xs"><output aria-label="3D camera" aria-live="polite">Azimuth {camera.azimuth.toFixed(0)}°, elevation {camera.elevation.toFixed(0)}°, zoom {Math.round(camera.zoom * 100)}%</output></p>
        <p className="text-xs">3D volume rendering of the saved binary prediction only. Camera controls change presentation only; voxel boundaries and disconnected regions are preserved. No surface smoothing, invented vessels, or clinical findings.</p>
      </>}
      <p className="text-xs text-muted">Original dimensions: {shape.join(' × ')}. Neurological convention: L/R, A/P, S/I labels follow world geometry. Slice controls use anatomical RAS axes, not original array ordering.</p>
      {location && <p className="text-xs text-muted">Crosshair RAS: {location.world.map(n => n.toFixed(2)).join(', ')} mm. CT window/level uses source intensity units.</p>}
      {ready && location && <p className="text-xs text-muted">Voxel spacing (original axes): {location.spacing.map(n => n.toFixed(4)).join(' × ')} mm.</p>}
    </section>
  );
}
