import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import * as satellite from 'satellite.js';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import Sgp4Worker from '../../../workers/sgp4Worker?worker';

const TIME_SLICE_THRESHOLD = 12000;
const FILTER_TYPES = ['PAYLOAD', 'ROCKET BODY', 'DEBRIS'];
const TYPE_COLORS = {
  PAYLOAD: Cesium.Color.fromCssColorString('#7ED957'),
  'ROCKET BODY': Cesium.Color.fromCssColorString('#7A9BB0'),
  DEBRIS: Cesium.Color.fromCssColorString('#D65C5C')
};

/**
 * Normaliza un objeto de debris/satélite con variaciones de nombres de columnas.
 * Devuelve un objeto con campos fijos y tipados.
 */
function normalizeDebris(rawData) {
  if (!rawData || typeof rawData !== 'object') {
    return {
      name: 'Unknown',
      noradId: '00000',
      type: 'DEBRIS',
      country: 'UNKNOWN',
      alt: 0,
      mass: 0,
      year: 1957,
      tle1: '',
      tle2: '',
      raw: rawData
    };
  }

  // Nombre del objeto
  const name = (
    rawData.OBJECT_NAME ||
    rawData.name ||
    rawData.NAME ||
    'Unknown'
  ).toString().trim();

  // NORAD ID
  const noradId = (
    rawData.NORAD_CAT_ID ||
    rawData.norad_cat_id ||
    rawData.id ||
    rawData.NORAD ||
    '00000'
  ).toString().trim();

  // Tipo de objeto
  const rawType = (
    rawData.OBJECT_TYPE ||
    rawData.type ||
    rawData.TYPE ||
    'DEBRIS'
  ).toString().trim().toUpperCase();
  const type = ['PAYLOAD', 'ROCKET BODY'].includes(rawType) ? rawType : 'DEBRIS';

  // País
  const country = (
    rawData.COUNTRY ||
    rawData.country ||
    rawData.COUNTRY_CODE ||
    rawData.country_code ||
    'UNKNOWN'
  ).toString().trim().toUpperCase();

  // Nota: Altitud y Masa se eliminaron para simplificar filtros

  // Año de lanzamiento
  let year = 1957;
  const launchDate = rawData.LAUNCH_DATE || rawData.launch_date || rawData.EPOCH || '';
  if (launchDate) {
    const parsed = parseInt(String(launchDate).slice(0, 4), 10);
    if (Number.isFinite(parsed) && parsed > 1950) {
      year = parsed;
    }
  }

  // TLE Lines
  const tle1 = (rawData.tleLine1 || rawData.TLE_LINE1 || rawData.tle1 || '').toString().trim();
  const tle2 = (rawData.tleLine2 || rawData.TLE_LINE2 || rawData.tle2 || '').toString().trim();

  return {
    name,
    noradId,
    type,
    country,
    year,
    tle1,
    tle2,
    raw: rawData
  };
}

const CesiumGlobe = ({ debrisList, onDebrisSelect }) => {
  const [orbitMode, setOrbitMode] = useState('inertial');
  const [isAstronautMode, setIsAstronautMode] = useState(false);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isolatedSearchIndex, setIsolatedSearchIndex] = useState(null);
  const [yearRange, setYearRange] = useState([1957, 2026]);
  const [filters, setFilters] = useState({
    types: ['PAYLOAD', 'ROCKET BODY', 'DEBRIS'],
    country: ''
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Normalizar toda la lista de debris al inicio
  const normalizedList = useMemo(() => {
    return debrisList.map((item, idx) => ({
      ...normalizeDebris(item),
      rawIndex: idx
    }));
  }, [debrisList]);

  // Generar lista dinámica de países desde datos normalizados
  const countryList = useMemo(() => {
    const unique = [...new Set(normalizedList.map((d) => d.country))]
      .filter((c) => c && c !== 'UNKNOWN')
      .sort();
    return unique;
  }, [normalizedList]);

  const orbitModeRef = useRef('inertial');
  const filtersRef = useRef(filters);
  const filterMaskRef = useRef([]);
  const selectedDebrisRef = useRef(null);
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const pointCollectionRef = useRef(null);
  const pointsRef = useRef([]);
  const positionsBufferRef = useRef(null);
  const frameRef = useRef(0);
  const workerRef = useRef(null);
  const selectedOrbitRef = useRef(null);
  const drawOrbitRef = useRef(null);
  const selectionEntityRef = useRef(null);
  const issEntityRef = useRef(null);
  const issIndexRef = useRef(null);
  const issPrevPositionRef = useRef(null);

  // Función para toggle fullscreen
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error('Error toggling fullscreen:', err);
    }
  };

  const toggleAstronautMode = async () => {
    const viewer = viewerRef.current;
    const issEntity = issEntityRef.current;
    if (!viewer || !issEntity) return;

    if (!isAstronautMode) {
      viewer.trackedEntity = issEntity;
      viewer.selectedEntity = issEntity;
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      try {
        await viewer.flyTo(issEntity, {
          offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-20), 1000),
          duration: 2.0
        });
      } catch {
        // Ignore flyTo cancellation errors.
      }
      setIsAstronautMode(true);
    } else {
      viewer.trackedEntity = undefined;
      viewer.selectedEntity = undefined;
      setIsAstronautMode(false);
    }
  };

  // Escuchar cambios de fullscreen
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const viewer = new Cesium.Viewer(containerRef.current, {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      scene3DOnly: true,
      requestRenderMode: false,
      shouldAnimate: true,
      creditContainer: document.createElement('div')
    });

    viewerRef.current = viewer;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.globe.depthTestAgainstGlobe = false;

    const pointCollection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    pointCollectionRef.current = pointCollection;

    const points = new Array(normalizedList.length);

    for (let i = 0; i < normalizedList.length; i += 1) {
      const normalized = normalizedList[i];
      if (normalized.noradId === '25544') {
        issIndexRef.current = i;
        issEntityRef.current = viewer.entities.add({
          id: 'ISS_MODEL',
          name: 'International Space Station',
          model: {
            uri: 'https://assets.agi.com/models/iss.glb',
            minimumPixelSize: 64,
            maximumScale: 20000
          },
          show: true
        });
        points[i] = null;
        continue;
      }
      const pointColor = TYPE_COLORS[normalized.type] || TYPE_COLORS.DEBRIS;

      points[i] = pointCollection.add({
        id: normalized,
        position: Cesium.Cartesian3.ZERO,
        pixelSize: 3,
        color: pointColor.withAlpha(0.9),
        show: false
      });
    }

    pointsRef.current = points;
    filterMaskRef.current = new Array(normalizedList.length).fill(true);

    const worker = new Sgp4Worker();
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const { type, buffer } = event.data || {};
      if (type !== 'positions' || !buffer) return;
      positionsBufferRef.current = new Float64Array(buffer);
    };

    worker.postMessage({
      type: 'init',
      fps: 15,
      tleArray: normalizedList.map((d) => ({ tle1: d.tle1, tle2: d.tle2 }))
    });

    const scratchPosition = new Cesium.Cartesian3();

    const drawOrbit = (normalized) => {
      if (!normalized || !normalized.tle1 || !normalized.tle2) return;

      if (selectedOrbitRef.current) {
        viewer.entities.remove(selectedOrbitRef.current);
        selectedOrbitRef.current = null;
      }

      try {
        const satrec = satellite.twoline2satrec(normalized.tle1, normalized.tle2);
        if (!(satrec && !satrec.error && Number.isFinite(satrec.no) && satrec.no > 0)) return;

        const periodMinutes = (2 * Math.PI) / satrec.no;
        const numPoints = 180;
        const stepMinutes = periodMinutes / numPoints;
        const orbitPositions = [];
        const now = Date.now();
        const baseGmst = satellite.gstime(new Date(now));

        for (let i = 0; i <= numPoints; i += 1) {
          const offsetMs = i * stepMinutes * 60000;
          const time = new Date(now + offsetMs);
          const pv = satellite.propagate(satrec, time);
          const positionEci = pv?.position;

          if (!positionEci) continue;

          const gmst = orbitModeRef.current === 'inertial' ? baseGmst : satellite.gstime(time);
          const positionGd = satellite.eciToGeodetic(positionEci, gmst);
          if (!positionGd) continue;

          orbitPositions.push(
            Cesium.Cartesian3.fromRadians(
              positionGd.longitude,
              positionGd.latitude,
              positionGd.height * 1000
            )
          );
        }

        if (orbitPositions.length > 1) {
          selectedOrbitRef.current = viewer.entities.add({
            polyline: {
              positions: orbitPositions,
              width: 2,
              material: Cesium.Color.CYAN.withAlpha(0.6)
            }
          });
        }
      } catch (err) {
        console.error('Error dibujando órbita:', err);
      }
    };

    drawOrbitRef.current = drawOrbit;

    const updatePositions = () => {
      const flat = positionsBufferRef.current;
      if (!flat || flat.length < 3) return;

      const pointsLocal = pointsRef.current;
      const total = Math.min(pointsLocal.length, Math.floor(flat.length / 3));
      const useTimeSlice = total > TIME_SLICE_THRESHOLD;
      const pass = frameRef.current & 1;
      frameRef.current += 1;

      const start = useTimeSlice ? pass : 0;
      const step = useTimeSlice ? 2 : 1;

      for (let i = start; i < total; i += step) {
        const j = i * 3;
        const x = flat[j];
        const y = flat[j + 1];
        const z = flat[j + 2];
        const point = pointsLocal[i];
        if (!point) continue;

        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          scratchPosition.x = x;
          scratchPosition.y = y;
          scratchPosition.z = z;
          point.position = scratchPosition;
          point.show = Boolean(filterMaskRef.current[i]);
        } else {
          point.show = false;
        }
      }

      const issIndex = issIndexRef.current;
      const issEntity = issEntityRef.current;
      if (issEntity && Number.isFinite(issIndex) && issIndex < total) {
        const j = issIndex * 3;
        const x = flat[j];
        const y = flat[j + 1];
        const z = flat[j + 2];
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          const current = Cesium.Cartesian3.fromElements(x, y, z);
          issEntity.position = current;

          const previous = issPrevPositionRef.current;
          if (previous) {
            const velocity = Cesium.Cartesian3.subtract(current, previous, new Cesium.Cartesian3());
            const speed = Cesium.Cartesian3.magnitude(velocity);
            if (speed > 0) {
              const heading = Math.atan2(velocity.y, velocity.x);
              const horizontal = Math.hypot(velocity.x, velocity.y);
              const pitch = Math.atan2(velocity.z, horizontal);
              issEntity.orientation = Cesium.Transforms.headingPitchRollQuaternion(
                current,
                new Cesium.HeadingPitchRoll(heading, pitch, 0)
              );
            }
          }
          issPrevPositionRef.current = current;
          issEntity.show = Boolean(filterMaskRef.current[issIndex]);
        } else {
          issEntity.show = false;
        }
      }

      // Actualizar aureola de selección si hay algo seleccionado
      if (selectedDebrisRef.current && selectionEntityRef.current) {
        const selectedIndex = selectedDebrisRef.current.rawIndex;
        if (Number.isFinite(selectedIndex) && selectedIndex < total) {
          const j = selectedIndex * 3;
          const x = flat[j];
          const y = flat[j + 1];
          const z = flat[j + 2];
          if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            selectionEntityRef.current.position = Cesium.Cartesian3.fromElements(x, y, z);
          }
        }
      }
    };

    viewer.scene.preUpdate.addEventListener(updatePositions);

    const pickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    const resolvePickedNormalized = (picked) => {
      const primitiveData = picked?.primitive?.id;
      if (primitiveData && typeof primitiveData === 'object' && primitiveData.rawIndex !== undefined) {
        return primitiveData;
      }

      if (picked?.id?.id === 'ISS_MODEL' && Number.isFinite(issIndexRef.current)) {
        return normalizedList[issIndexRef.current] || null;
      }

      return null;
    };

    pickHandler.setInputAction((movement) => {
      const picked = viewer.scene.pick(movement.endPosition);
      const normalized = resolvePickedNormalized(picked);
      if (normalized) {
        containerRef.current.style.cursor = 'pointer';
        setHoverInfo({
          x: movement.endPosition.x,
          y: movement.endPosition.y,
          data: normalized
        });
      } else {
        containerRef.current.style.cursor = 'default';
        setHoverInfo(null);
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    pickHandler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position);
      const normalized = resolvePickedNormalized(picked);

      if (normalized) {
        selectObject(normalized, { isolate: false, flyTo: false });
      } else {
        if (selectionEntityRef.current) {
          viewer.entities.remove(selectionEntityRef.current);
          selectionEntityRef.current = null;
        }
        if (selectedOrbitRef.current) {
          viewer.entities.remove(selectedOrbitRef.current);
          selectedOrbitRef.current = null;
        }
        setIsolatedSearchIndex(null);
        selectedDebrisRef.current = null;
        if (onDebrisSelect) onDebrisSelect(null);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      // Evita fugas de memoria al cambiar de ruta o desmontar el modulo.
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'stop' });
        workerRef.current.terminate();
        workerRef.current = null;
      }

      pickHandler.destroy();
      viewer.scene.preUpdate.removeEventListener(updatePositions);
      if (selectedOrbitRef.current) {
        viewer.entities.remove(selectedOrbitRef.current);
      }
      if (selectionEntityRef.current) {
        viewer.entities.remove(selectionEntityRef.current);
      }
      if (issEntityRef.current) {
        viewer.entities.remove(issEntityRef.current);
      }
      viewer.trackedEntity = undefined;
      viewer.selectedEntity = undefined;
      drawOrbitRef.current = null;
      selectedDebrisRef.current = null;
      issEntityRef.current = null;
      issIndexRef.current = null;
      issPrevPositionRef.current = null;
      viewer.destroy();

      pointsRef.current = [];
      positionsBufferRef.current = null;
      filterMaskRef.current = [];
    };
  }, [normalizedList, onDebrisSelect]);

  // Motor de filtrado: actualizar visibilidad basándose en normalizedList
  useEffect(() => {
    filtersRef.current = filters;
    const cleanSearch = searchTerm.toLowerCase().trim();

    const points = pointsRef.current;
    const mask = new Array(normalizedList.length).fill(false);

    for (let i = 0; i < normalizedList.length; i += 1) {
      const point = points[i];
      const normalized = normalizedList[i];
      if (!normalized) continue;

      // Lógica de filtrado estricta
      const matchesType =
        filters.types.length === 0 ? false : filters.types.includes(normalized.type);

      const matchesSearch =
        cleanSearch === '' ||
        normalized.name.toLowerCase().includes(cleanSearch) ||
        normalized.noradId.includes(cleanSearch);

      const matchesCountry =
        filters.country === '' || normalized.country === filters.country;

      const matchesDate =
        normalized.year >= yearRange[0] &&
        normalized.year <= yearRange[1];

      let cumpleFiltro =
        matchesType &&
        matchesSearch &&
        matchesCountry &&
        matchesDate;

      if (Number.isFinite(isolatedSearchIndex)) {
        cumpleFiltro = cumpleFiltro && normalized.rawIndex === isolatedSearchIndex;
      }

      mask[i] = cumpleFiltro;
      if (point) {
        point.show = cumpleFiltro;
      }
    }

    filterMaskRef.current = mask;

    const issIndex = issIndexRef.current;
    if (issEntityRef.current && Number.isFinite(issIndex)) {
      issEntityRef.current.show = Boolean(mask[issIndex]);
    }

    // Generar resultados de búsqueda predictiva
    if (searchTerm.trim() === '') {
      setSearchResults([]);
    } else {
      const cleanSearch = searchTerm.toLowerCase().trim();
      const results = normalizedList
        .filter(
          (d) =>
            (d.name.toLowerCase().includes(cleanSearch) ||
              d.noradId.includes(cleanSearch)) &&
            mask[d.rawIndex]
        )
        .slice(0, 15); // Limitar a 15 resultados
      setSearchResults(results);
    }
  }, [filters, searchTerm, yearRange, normalizedList, isolatedSearchIndex]);

  useEffect(() => {
    orbitModeRef.current = orbitMode;
    if (selectedDebrisRef.current && drawOrbitRef.current) {
      drawOrbitRef.current(selectedDebrisRef.current);
    }
  }, [orbitMode]);

  const toggleType = (type) => {
    setFilters((prev) => {
      const exists = prev.types.includes(type);
      return {
        ...prev,
        types: exists ? prev.types.filter((item) => item !== type) : [...prev.types, type]
      };
    });
  };

  // Función maestra para seleccionar un objeto.
  // isolate=true: modo búsqueda (deja visible solo el seleccionado).
  // isolate=false: modo click (mantiene visibles todos los que cumplan filtros).
  // flyTo=true: mueve cámara hacia el objeto (solo búsqueda).
  // flyTo=false: no mueve cámara (click en mapa).
  const selectObject = (normalized, { isolate = false, flyTo = false } = {}) => {
    if (!normalized || !viewerRef.current) return;

    selectedDebrisRef.current = normalized;
    setIsolatedSearchIndex(isolate ? normalized.rawIndex : null);
    if (onDebrisSelect) onDebrisSelect(normalized.raw);
    drawOrbitRef.current?.(normalized);

    // Crear o actualizar aureola de selección
    if (selectionEntityRef.current) {
      viewerRef.current.entities.remove(selectionEntityRef.current);
    }
    selectionEntityRef.current = viewerRef.current.entities.add({
      point: {
        pixelSize: 20,
        color: Cesium.Color.CYAN.withAlpha(0.4),
        outlineColor: Cesium.Color.CYAN.withAlpha(0.8),
        outlineWidth: 2
      }
    });

    // Fly-to opcional: solo para selección desde buscador.
    const flat = positionsBufferRef.current;
    if (flyTo && flat && Number.isFinite(normalized.rawIndex)) {
      const idx = normalized.rawIndex;
      const j = idx * 3;
      const x = flat[j];
      const y = flat[j + 1];
      const z = flat[j + 2];

      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        const target = Cesium.Cartesian3.fromElements(x, y, z);
        const targetMagnitude = Cesium.Cartesian3.magnitude(target);
        const radialDirection = Cesium.Cartesian3.normalize(target, new Cesium.Cartesian3());

        // Deja un tramo entre la camara y el objeto, manteniendo a la Tierra como referencia central.
        const standoffMeters = 900000;
        const destination = Cesium.Cartesian3.multiplyByScalar(
          radialDirection,
          targetMagnitude + standoffMeters,
          new Cesium.Cartesian3()
        );

        const direction = Cesium.Cartesian3.normalize(
          Cesium.Cartesian3.negate(destination, new Cesium.Cartesian3()),
          new Cesium.Cartesian3()
        );
        const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(
          destination,
          new Cesium.Cartesian3()
        );

        viewerRef.current.camera.flyTo({
          destination,
          orientation: {
            direction,
            up
          },
          duration: 2.0
        });
      }
    }

    // Limpiar texto y lista de búsqueda luego de seleccionar desde buscador.
    if (isolate) {
      setSearchTerm('');
      setSearchResults([]);
    }
  };

  const visibleCount = filterMaskRef.current.filter(Boolean).length;
  const totalCount = normalizedList.length;

  return (
    <div className="w-full h-full relative overflow-hidden">
      <div ref={containerRef} className="w-full h-full" style={{ pointerEvents: 'auto' }} />

      {/* Botón Hamburger para Sidebar */}
      {!isSidebarOpen && (
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="absolute left-4 top-4 z-30 w-12 h-12 bg-black/60 backdrop-blur-md border border-white/10 rounded-lg flex items-center justify-center text-white hover:bg-gray-800 transition-colors group"
          title="Abrir Filtros"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      )}

      {/* Sidebar Filtros */}
      <aside className={`absolute left-4 top-4 bottom-4 w-80 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl p-6 z-20 overflow-y-auto text-white transition-all duration-300 ${
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="text-xs text-gray-400 mb-4 pb-4 border-b border-white/10">
          Objetos visibles: <span className="text-cyan-400 font-bold">{visibleCount}</span> / {totalCount}
        </div>

        <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-2">Búsqueda</h3>
        <div className="mb-4 relative">
          <span className="absolute left-3 top-2.5 text-gray-400">🔍</span>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Nombre o NORAD..."
            className="w-full bg-black/40 border border-white/10 rounded-md pl-9 pr-9 py-2 text-sm outline-none focus:border-cyan-400"
          />
          {searchTerm.trim() !== '' && (
            <button
              onClick={() => {
                setSearchTerm('');
                setSearchResults([]);
                setIsolatedSearchIndex(null);
              }}
              className="absolute right-2 top-1.5 h-7 w-7 rounded text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
              title="Limpiar búsqueda"
            >
              ✕
            </button>
          )}
          {searchResults.length > 0 && (
            <div className="mt-2 max-h-60 overflow-y-auto bg-black/40 rounded border border-white/10 custom-scrollbar">
              {searchResults.map((result) => (
                <button
                  key={result.rawIndex}
                  onClick={() => selectObject(result, { isolate: true, flyTo: true })}
                  className="w-full p-2 hover:bg-white/10 cursor-pointer text-xs border-b border-white/5 flex justify-between text-left transition-colors"
                >
                  <span className="text-cyan-400 font-semibold">{result.name}</span>
                  <span className="text-gray-400">{result.noradId}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-white/10 pt-4 mt-4">
          <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-3">País</h3>
        </div>
        <div className="mb-6">
          <select
            value={filters.country}
            onChange={(e) => {
              setFilters((prev) => ({ ...prev, country: e.target.value }));
            }}
            className="w-full bg-black/40 border border-white/10 rounded-md px-3 py-2 text-sm outline-none focus:border-cyan-400"
          >
            <option value="">Todos los países</option>
            {countryList.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
        </div>

        <div className="border-t border-white/10 pt-4 mt-4">
          <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-3">Tipo de Objeto</h3>
        </div>
        <div className="space-y-2 mb-6">
          {FILTER_TYPES.map((type) => {
            const checked = filters.types.includes(type);
            const color = TYPE_COLORS[type] || TYPE_COLORS.DEBRIS;
            return (
              <label key={type} className="flex items-center gap-3 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleType(type)}
                  className="h-4 w-4 rounded border-gray-500 bg-transparent"
                />
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: color.toCssColorString() }}
                />
                <span>{type}</span>
              </label>
            );
          })}
        </div>

        <div className="border-t border-white/10 pt-4 mt-4">
          <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-3">
            Años: {yearRange[0]} - {yearRange[1]}
          </h3>
        </div>
        <div className="relative mb-6">
          <div className="flex justify-between text-xs text-gray-400 mb-3">
            <span>1957</span>
            <span>2026</span>
          </div>
          <style>{`
            .year-range-slider {
              position: relative;
              height: 6px;
              background: #374151;
              border-radius: 4px;
            }
            .year-range-slider input[type='range'] {
              position: absolute;
              width: 100%;
              height: 6px;
              top: 0;
              background: transparent;
              pointer-events: none;
              -webkit-appearance: none;
              appearance: none;
            }
            .year-range-slider input[type='range']::-webkit-slider-thumb {
              -webkit-appearance: none;
              appearance: none;
              width: 18px;
              height: 18px;
              border-radius: 50%;
              background: #06B6D4;
              cursor: pointer;
              pointer-events: auto;
              border: 2px solid #0891B2;
              box-shadow: 0 0 8px rgba(6, 182, 212, 0.4);
            }
            .year-range-slider input[type='range']::-moz-range-thumb {
              width: 18px;
              height: 18px;
              border-radius: 50%;
              background: #06B6D4;
              cursor: pointer;
              pointer-events: auto;
              border: 2px solid #0891B2;
              box-shadow: 0 0 8px rgba(6, 182, 212, 0.4);
            }
          `}</style>
          <div className="year-range-slider">
            <input
              type="range"
              min="1957"
              max="2026"
              value={yearRange[0]}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (value <= yearRange[1]) {
                  setYearRange([value, yearRange[1]]);
                }
              }}
              style={{
                zIndex: yearRange[0] > 1991 ? 5 : 3
              }}
            />
            <input
              type="range"
              min="1957"
              max="2026"
              value={yearRange[1]}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (value >= yearRange[0]) {
                  setYearRange([yearRange[0], value]);
                }
              }}
              style={{
                zIndex: yearRange[1] < 1991 ? 5 : 3
              }}
            />
          </div>
          <div className="mt-2 text-center text-sm font-semibold text-cyan-400">
            {yearRange[0]} - {yearRange[1]}
          </div>
        </div>

        <div className="border-t border-white/10 pt-4 mt-4 flex gap-2">
          <button
            onClick={() => {
              setFilters({
                types: ['PAYLOAD', 'ROCKET BODY', 'DEBRIS'],
                country: ''
              });
              setYearRange([1957, 2026]);
              setSearchTerm('');
              setSearchResults([]);
              setIsolatedSearchIndex(null);
            }}
            className="flex-1 bg-red-900/40 hover:bg-red-900/60 text-red-300 px-3 py-2 rounded-md text-xs font-bold transition-colors"
          >
            Limpiar
          </button>
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="w-10 bg-gray-700/40 hover:bg-gray-700/60 text-gray-300 px-3 py-2 rounded-md text-xs font-bold transition-colors flex items-center justify-center"
            title="Cerrar Filtros"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </aside>

      {/* Botones Maestros - Derecha */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-auto">
        {/* Botón Fullscreen */}
        <button
          onClick={toggleFullscreen}
          className="w-12 h-12 bg-black/60 backdrop-blur-md border border-white/10 rounded-lg flex items-center justify-center text-white hover:bg-gray-800 transition-colors group"
          title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {isFullscreen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6v4m12-4h4v4m0 6v4h-4m-12 0v4h4" />
            )}
          </svg>
        </button>

        {/* Botón Modo Órbita */}
        <button
          onClick={() => setOrbitMode(orbitMode === 'inertial' ? 'fixed' : 'inertial')}
          className="w-12 h-12 bg-black/60 backdrop-blur-md border border-white/10 rounded-lg flex items-center justify-center text-white hover:bg-gray-800 transition-colors group"
          title={orbitMode === 'inertial' ? 'Modo: ECI (Inercial)' : 'Modo: ECEF (Terrestre)'}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="8" strokeWidth={2} />
            <ellipse cx="12" cy="12" rx="12" ry="4" strokeWidth={2} />
          </svg>
          <span className="absolute bottom-14 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
            {orbitMode === 'inertial' ? 'ECI' : 'ECEF'}
          </span>
        </button>

        {/* Boton Modo Astronauta */}
        <button
          onClick={toggleAstronautMode}
          disabled={!issEntityRef.current}
          className="w-12 h-12 bg-black/60 backdrop-blur-md border border-white/10 rounded-lg flex items-center justify-center text-white hover:bg-cyan-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Modo Astronauta"
        >
          <span className="text-base" aria-hidden="true">👩‍🚀</span>
        </button>
      </div>

      {hoverInfo && hoverInfo.data && (
        <div
          className="absolute z-10 bg-black/80 text-white p-3 rounded border border-gray-600 pointer-events-none shadow-lg backdrop-blur-sm"
          style={{
            left: `${hoverInfo.x + 15}px`,
            top: `${hoverInfo.y + 15}px`
          }}
        >
          <p className="font-bold text-cyan-400">{hoverInfo.data.name}</p>
          <p className="text-xs text-gray-300">NORAD: {hoverInfo.data.noradId}</p>
          <p className="text-xs text-gray-300">Tipo: {hoverInfo.data.type}</p>
          <p className="text-xs text-gray-300">País: {hoverInfo.data.country}</p>
          <p className="text-xs text-gray-300">Año: {hoverInfo.data.year}</p>
        </div>
      )}
    </div>
  );
};

export default CesiumGlobe;
