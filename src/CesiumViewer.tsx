import React, { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import useViewerInit from './hooks/useViewerInit';
import { useRoute } from './hooks/useRoute';
import useCesiumAnimation from './hooks/useCesiumAnimation';
import useCesiumCamera from './hooks/useCesiumCamera';
import constants from '../config/constants';
import FpsCounter from './components/FpsCounter';
import RecordButton from './components/RecordButton';

export default function CesiumViewer(): JSX.Element {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const viewerRef = useRef<Cesium.Viewer | null>(null);
	const entityRef = useRef<Cesium.Entity | null>(null);

	const [menuVisible, setMenuVisible] = useState(true);
	const [currentRoute, setCurrentRoute] = useState<string | null>(null);
	const [showRouteSelector, setShowRouteSelector] = useState(false);
	const [isIntroComplete, setIsIntroComplete] = useState(false);
	const [routeValidated, setRouteValidated] = useState(false);
	const [isDockerMode, setIsDockerMode] = useState(false);

	// Detect Docker mode / URL-supplied route
	useEffect(() => {
		const urlParams = new URLSearchParams(window.location.search);
		const gpxFromUrl = urlParams.get('gpx');
		const animationSpeedParam = urlParams.get('animationSpeed');
		const gpxFromEnv = (import.meta as any).env?.VITE_GPX_ROUTE as string | undefined;

		const dockerRoute = gpxFromUrl || gpxFromEnv;
		if (dockerRoute && typeof dockerRoute === 'string' && dockerRoute.trim()) {
			console.log('Running in Docker mode with route:', dockerRoute, 'animation speed:', animationSpeedParam || 'default');
			setIsDockerMode(true);
			setCurrentRoute(dockerRoute);
			setRouteValidated(true);
		} else {
			setShowRouteSelector(true);
		}
	}, []);

	// Initialize Cesium viewer
	useViewerInit(containerRef, viewerRef);

	// Load route when validated
	const { trackPoints, timeRange, isLoading, error } = useRoute(routeValidated ? currentRoute : null);

	// animationSpeed from URL (used only for deciding compression in web/manual modes)
	const animationSpeed = React.useMemo(() => {
		const urlParams = new URLSearchParams(window.location.search);
		const speedParam = urlParams.get('animationSpeed');
		return speedParam ? Math.max(1, parseInt(speedParam, 10) || 1) : constants.ANIMATION.DEFAULT_SPEED;
	}, []);

	// Allow disabling frontend compression via global toggle
	const disableCompression = typeof window !== 'undefined' && !!(window as any).__DISABLE_COMPRESSION;

	// Compute compressed time range (if applicable)
	const compressedTimeRange = React.useMemo(() => {
		if (!timeRange || !animationSpeed || animationSpeed <= 1 || disableCompression) return timeRange;
		const originalDuration = Cesium.JulianDate.secondsDifference(timeRange.stopTime, timeRange.startTime);
		const compressedDuration = originalDuration / animationSpeed;
		const newStopTime = Cesium.JulianDate.addSeconds(timeRange.startTime, compressedDuration, new Cesium.JulianDate());
		try { (window as any).__TIMESTAMPS_COMPRESSED = true; } catch (e) { }
		console.log(`Time compression: ${originalDuration}s → ${compressedDuration}s (${animationSpeed}x)`);
		return { startTime: timeRange.startTime, stopTime: newStopTime };
	}, [timeRange, animationSpeed, disableCompression]);

	// Compress per-point timestamps if needed
	const compressedTrackPoints = React.useMemo(() => {
		if (!timeRange || !animationSpeed || animationSpeed <= 1 || !trackPoints || trackPoints.length === 0 || disableCompression) return trackPoints;
		return trackPoints.map(point => {
			try {
				const originalTime = Cesium.JulianDate.fromIso8601(point.time);
				const elapsed = Cesium.JulianDate.secondsDifference(originalTime, timeRange.startTime);
				const compressedElapsed = elapsed / animationSpeed;
				const newTime = Cesium.JulianDate.addSeconds(timeRange.startTime, compressedElapsed, new Cesium.JulianDate());
				return { ...point, time: Cesium.JulianDate.toIso8601(newTime) };
			} catch (e) {
				return point;
			}
		});
	}, [trackPoints, timeRange, animationSpeed, disableCompression]);

	// Wire animation and camera
	const entity = useCesiumAnimation({
		viewer: viewerRef.current,
		trackPoints: compressedTrackPoints || [],
		startTime: compressedTimeRange?.startTime,
		stopTime: compressedTimeRange?.stopTime,
		animationSpeed: animationSpeed
	});

	// Camera is now fully controlled by useCesiumAnimation's postRender listener
	// Disabling useCesiumCamera to prevent conflicting camera updates
	// useCesiumCamera({
	// 	viewer: viewerRef.current,
	// 	targetEntity: entity,
	// 	hikerEntity: entity,
	// 	isIntroComplete: isIntroComplete,
	// 	enableCollisionDetection: false,
	// 	smoothFactor: 0.9
	// });

	// Track entity ref and intro completion
	useEffect(() => {
		if (entity) {
			entityRef.current = entity;
			const checkIntro = () => {
				try {
					if ((window as any).CESIUM_INTRO_COMPLETE === true) {
						setIsIntroComplete(true);
						return true;
					}
				} catch (e) { }
				return false;
			};
			if (!checkIntro()) {
				const interval = setInterval(() => { if (checkIntro()) clearInterval(interval); }, 250);
				return () => clearInterval(interval);
			}
		}
		return () => { entityRef.current = null; };
	}, [entity]);

	// Hide/show Cesium UI widgets based on menuVisible
	useEffect(() => {
		if (!viewerRef.current) return;
		const viewer = viewerRef.current;
		const animationContainer = (viewer.animation?.container) as HTMLElement | undefined;
		const timelineContainer = (viewer.timeline?.container) as HTMLElement | undefined;
		if (animationContainer) animationContainer.style.display = menuVisible ? 'block' : 'none';
		if (timelineContainer) timelineContainer.style.display = menuVisible ? 'block' : 'none';
	}, [menuVisible]);

	const handleRouteChange = (route: string) => { setCurrentRoute(route); setRouteValidated(true); setShowRouteSelector(false); };

	// File upload handler — persist last uploaded content to localStorage
	const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;
		try {
			const reader = new FileReader();
			reader.onload = (e) => {
				const content = e.target?.result;
				if (typeof content !== 'string') return;
				const isGPX = content.includes('<?xml') && content.includes('<gpx');
				const isKML = content.includes('<?xml') && content.includes('<kml');
				if (!isGPX && !isKML) { alert('Invalid file format. Please upload a GPX or KML file.'); return; }
				const mimeType = isKML ? 'application/vnd.google-earth.kml+xml' : 'application/gpx+xml';
				const blob = new Blob([content], { type: mimeType });
				const blobUrl = URL.createObjectURL(blob);
				try { localStorage.setItem('lastDroppedRouteContent', content); localStorage.setItem('lastDroppedRouteName', file.name); } catch (e) { }
				setCurrentRoute(blobUrl); setRouteValidated(true); setShowRouteSelector(false);
			};
			reader.readAsText(file);
		} catch (error) { console.error('Error uploading file:', error); alert('Error uploading file'); }
	};

	// Drag-and-drop support
	useEffect(() => {
		const onDrop = (ev: DragEvent) => {
			ev.preventDefault(); ev.stopPropagation();
			const files = ev.dataTransfer?.files; if (!files || files.length === 0) return;
			const file = files[0];
			const reader = new FileReader();
			reader.onload = () => {
				const text = String(reader.result || '');
				const isKML = text.includes('<kml') || text.includes('<kml:');
				const mimeType = isKML ? 'application/vnd.google-earth.kml+xml' : 'application/gpx+xml';
				const blob = new Blob([text], { type: mimeType });
				const blobUrl = URL.createObjectURL(blob);
				try { localStorage.setItem('lastDroppedRouteContent', text); localStorage.setItem('lastDroppedRouteName', file.name); } catch (e) { }
				setCurrentRoute(blobUrl); setRouteValidated(true); setShowRouteSelector(false);
			};
			reader.readAsText(file);
		};
		const onDragOver = (ev: DragEvent) => { ev.preventDefault(); if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'; };
		window.addEventListener('drop', onDrop);
		window.addEventListener('dragover', onDragOver);
		return () => { window.removeEventListener('drop', onDrop); window.removeEventListener('dragover', onDragOver); };
	}, []);

	// Restore last dropped route from localStorage if present
	useEffect(() => {
		try {
			const last = localStorage.getItem('lastDroppedRouteContent');
			const name = localStorage.getItem('lastDroppedRouteName') || 'route.gpx';
			if (last && !currentRoute) {
				const isKML = last.includes('<kml') || last.includes('<kml:');
				const mimeType = isKML ? 'application/vnd.google-earth.kml+xml' : 'application/gpx+xml';
				const blob = new Blob([last], { type: mimeType });
				const blobUrl = URL.createObjectURL(blob);
				console.log('Restored last dropped route from localStorage:', name);
				setCurrentRoute(blobUrl); setRouteValidated(true); setShowRouteSelector(false);
			}
		} catch (e) { }
	}, []);

	return (
		<div style={{ position: 'relative', width: '100%', height: '100%' }}>
		<div ref={containerRef} className="cesium-container" style={{ width: '100%', height: '100%' }} />

		<FpsCounter viewer={viewerRef.current} />

		<RecordButton viewer={viewerRef.current} startTime={timeRange?.startTime} stopTime={timeRange?.stopTime} animationSpeed={animationSpeed} />			{/* Welcome / Load Route */}
			{!isDockerMode && !routeValidated && (
				<div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
					<div style={{ textAlign: 'center', color: 'white' }}>
						<h1 style={{ fontSize: 28, marginBottom: 8 }}>Drop a GPX/KML file</h1>
						<p style={{ opacity: 0.9, marginBottom: 16 }}>Drag & drop a GPX or KML file anywhere on the page, or upload one below. The last dropped file is remembered.</p>
						<div>
							<label htmlFor="gpx-upload" style={{ display: 'inline-block', padding: '12px 16px', backgroundColor: 'rgba(34,139,34,0.4)', borderRadius: 6, cursor: 'pointer', color: 'white' }}>📁 Upload GPX/KML</label>
							<input id="gpx-upload" type="file" accept=".gpx,.kml" onChange={handleFileUpload} style={{ display: 'none' }} />
						</div>
					</div>
				</div>
			)}

			{error && (
				<div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', backgroundColor: 'rgba(255,0,0,0.8)', color: 'white', padding: 12, borderRadius: 6, zIndex: 1500 }}>{error}</div>
			)}

			{isLoading && (
				<div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', backgroundColor: 'rgba(0,0,0,0.8)', color: 'white', padding: 16, borderRadius: 6, zIndex: 1500 }}>
					<div style={{ marginBottom: 8 }}>Loading and validating route...</div>
				</div>
			)}
		</div>
	);
}
