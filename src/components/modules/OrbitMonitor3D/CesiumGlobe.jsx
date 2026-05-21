import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Cesium from 'cesium';
import * as satellite from 'satellite.js';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import Sgp4Worker from '../../../workers/sgp4Worker?worker';
import { useI18n } from '../../../i18n/I18nProvider.jsx';
import { COUNTRY_NAMES } from '../../../utils/countryNames.js';

const TIME_SLICE_THRESHOLD = 12000;
const FILTER_TYPES = ['PAYLOAD', 'ROCKET BODY', 'DEBRIS'];
const ORBITAL_REGIMES = ['LEO', 'MEO', 'GEO', 'HEO'];
const TYPE_COLORS = {
  PAYLOAD: Cesium.Color.fromCssColorString('#7ED957'),
  'ROCKET BODY': Cesium.Color.fromCssColorString('#7A9BB0'),
  DEBRIS: Cesium.Color.fromCssColorString('#D65C5C')
};

function getCountryFullName(code) {
  if (!code) return 'UNKNOWN';
  return COUNTRY_NAMES[code] || code;
}

function getCountryDisplayLabel(code) {
  return code || 'UNKNOWN';
}

function parseOrbitNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().replace(',', '.');
  if (normalized === '') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function classifyOrbitRegime(rawData) {
  const apogee = parseOrbitNumber(rawData.APOAPSIS ?? rawData.APOGEE ?? rawData.apoapsis ?? rawData.apogee);
  const perigee = parseOrbitNumber(rawData.PERIAPSIS ?? rawData.PERIGEE ?? rawData.periapsis ?? rawData.perigee);

  if (!Number.isFinite(apogee) || !Number.isFinite(perigee)) return 'UNKNOWN';

  if (perigee >= 30000 && apogee >= 33000 && apogee <= 39000) return 'GEO';
  if (apogee > 35786) return 'HEO';
  if (apogee >= 2000) return 'MEO';
  return 'LEO';
}

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
      regime: 'UNKNOWN',
      inclination: null,
      eccentricity: null,
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

  const regime = classifyOrbitRegime(rawData);
  const inclination = parseOrbitNumber(rawData.INCLINATION ?? rawData.inclination);
  const eccentricity = parseOrbitNumber(rawData.ECCENTRICITY ?? rawData.eccentricity);

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
    regime,
    inclination,
    eccentricity,
    year,
    tle1,
    tle2,
    raw: rawData
  };
}

function FilterAccordion({ id, title, openId, setOpenId, children, onHelpClick, helpTitle }) {
  const open = openId === id;
  return (
    <div className="border-b border-white/10 last:border-b-0">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setOpenId((prev) => (prev === id ? '' : id))}
          className="w-full flex items-center justify-between gap-3 px-4 py-4 text-left bg-transparent hover:bg-white/5 transition"
        >
          <div className="text-sm font-extrabold text-white">{title}</div>
          <div className="flex items-center gap-2">
            {onHelpClick ? (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onHelpClick();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onHelpClick();
                  }
                }}
                className="w-6 h-6 rounded-full border border-white/20 text-[11px] font-extrabold text-cyan-200 hover:bg-white/10 transition-colors shrink-0 inline-flex items-center justify-center"
                title={helpTitle || 'Help'}
                aria-label={helpTitle || 'Help'}
              >
                ?
              </span>
            ) : null}
            <div className="text-gray-200 text-sm">{open ? '▾' : '▸'}</div>
          </div>
        </button>
      </div>
      {open ? <div className="px-4 pb-4 text-gray-200">{children}</div> : null}
    </div>
  );
}

const CesiumGlobe = ({ debrisList, onDebrisSelect }) => {
  const { tr } = useI18n();
  const navigate = useNavigate();
  const [orbitMode, setOrbitMode] = useState('inertial');
  const [hoverInfo, setHoverInfo] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isolatedSearchIndex, setIsolatedSearchIndex] = useState(null);
  const [yearRange, setYearRange] = useState([1957, 2026]);
  const [filters, setFilters] = useState({
    types: ['PAYLOAD', 'ROCKET BODY', 'DEBRIS'],
    country: '',
    regime: ''
  });
  const [inclinationRange, setInclinationRange] = useState([0, 180]);
  const [eccentricityRange, setEccentricityRange] = useState([0, 1]);
  const [openFilterId, setOpenFilterId] = useState(() => (window.innerWidth >= 768 ? 'search' : ''));
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => window.innerWidth >= 768);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);

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

    // Quitar todas las capas base
    viewer.imageryLayers.removeAll();
    // Agregar la textura local como capa base
    viewer.imageryLayers.addImageryProvider(
      new Cesium.SingleTileImageryProvider({
        url: `${import.meta.env.BASE_URL}img/earthmap1k.jpg`,
        rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
        tileWidth: 5400,
        tileHeight: 2700
      })
    );

    viewerRef.current = viewer;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.globe.depthTestAgainstGlobe = false;
    // Activar sombra día/noche en tiempo real
    viewer.scene.globe.enableLighting = true;

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

      const matchesRegime =
        filters.regime === '' || normalized.regime === filters.regime;

      const hasInclination = Number.isFinite(normalized.inclination);
      const matchesInclination = hasInclination
        ? normalized.inclination >= inclinationRange[0] && normalized.inclination <= inclinationRange[1]
        : inclinationRange[0] <= 0 && inclinationRange[1] >= 180;

      const hasEccentricity = Number.isFinite(normalized.eccentricity);
      const matchesEccentricity = hasEccentricity
        ? normalized.eccentricity >= eccentricityRange[0] && normalized.eccentricity <= eccentricityRange[1]
        : eccentricityRange[0] <= 0 && eccentricityRange[1] >= 1;

      const matchesDate =
        normalized.year >= yearRange[0] &&
        normalized.year <= yearRange[1];

      let cumpleFiltro =
        matchesType &&
        matchesSearch &&
        matchesCountry &&
        matchesRegime &&
        matchesInclination &&
        matchesEccentricity &&
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
  }, [filters, searchTerm, yearRange, normalizedList, isolatedSearchIndex, inclinationRange, eccentricityRange]);

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

  const visibleFilteredList = useMemo(() => {
    const cleanSearch = searchTerm.toLowerCase().trim();
    return normalizedList.filter((normalized) => {
      const matchesType = filters.types.length > 0 && filters.types.includes(normalized.type);
      const matchesSearch =
        cleanSearch === '' ||
        normalized.name.toLowerCase().includes(cleanSearch) ||
        normalized.noradId.includes(cleanSearch);
      const matchesCountry = filters.country === '' || normalized.country === filters.country;
      const matchesRegime = filters.regime === '' || normalized.regime === filters.regime;
      const hasInclination = Number.isFinite(normalized.inclination);
      const matchesInclination = hasInclination
        ? normalized.inclination >= inclinationRange[0] && normalized.inclination <= inclinationRange[1]
        : inclinationRange[0] <= 0 && inclinationRange[1] >= 180;
      const hasEccentricity = Number.isFinite(normalized.eccentricity);
      const matchesEccentricity = hasEccentricity
        ? normalized.eccentricity >= eccentricityRange[0] && normalized.eccentricity <= eccentricityRange[1]
        : eccentricityRange[0] <= 0 && eccentricityRange[1] >= 1;
      const matchesDate = normalized.year >= yearRange[0] && normalized.year <= yearRange[1];
      const matchesIsolated = Number.isFinite(isolatedSearchIndex)
        ? normalized.rawIndex === isolatedSearchIndex
        : true;
      return (
        matchesType &&
        matchesSearch &&
        matchesCountry &&
        matchesRegime &&
        matchesInclination &&
        matchesEccentricity &&
        matchesDate &&
        matchesIsolated
      );
    });
  }, [
    normalizedList,
    filters,
    searchTerm,
    yearRange,
    isolatedSearchIndex,
    inclinationRange,
    eccentricityRange
  ]);

  const reportData = useMemo(() => {
    const rows = visibleFilteredList;
    const visible = rows.length;
    const total = normalizedList.length || 1;
    const visiblePercent = (visible / total) * 100;

    const years = rows.map((r) => r.year).filter((v) => Number.isFinite(v));
    const inclinations = rows.map((r) => r.inclination).filter((v) => Number.isFinite(v));
    const eccentricities = rows.map((r) => r.eccentricity).filter((v) => Number.isFinite(v));

    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

    const typeCounts = FILTER_TYPES.map((type) => ({
      name: type,
      count: rows.filter((r) => r.type === type).length
    }));

    const regimeCounts = ORBITAL_REGIMES.map((regime) => ({
      name: regime,
      count: rows.filter((r) => r.regime === regime).length
    }));

    const countryMap = new Map();
    rows.forEach((r) => {
      const key = r.country || 'UNKNOWN';
      countryMap.set(key, (countryMap.get(key) || 0) + 1);
    });
    const topCountries = Array.from(countryMap.entries())
      .map(([name, count]) => ({ name, fullName: getCountryFullName(name), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const yearMap = new Map();
    years.forEach((y) => {
      yearMap.set(y, (yearMap.get(y) || 0) + 1);
    });
    const launchHistogram = Array.from(yearMap.entries())
      .map(([year, count]) => ({ year: Number(year), count }))
      .sort((a, b) => a.year - b.year);

    const inclinationBins = Array.from({ length: 18 }, (_, i) => ({
      bin: `${i * 10}-${i * 10 + 10}`,
      count: 0
    }));
    inclinations.forEach((v) => {
      const idx = Math.min(17, Math.max(0, Math.floor(v / 10)));
      inclinationBins[idx].count += 1;
    });

    const eccentricityBins = Array.from({ length: 20 }, (_, i) => ({
      bin: `${(i * 0.05).toFixed(2)}-${((i + 1) * 0.05).toFixed(2)}`,
      count: 0
    }));
    eccentricities.forEach((v) => {
      const idx = Math.min(19, Math.max(0, Math.floor(v / 0.05)));
      eccentricityBins[idx].count += 1;
    });

    const scatterPoints = rows
      .filter((r) => Number.isFinite(r.inclination) && Number.isFinite(r.eccentricity))
      .slice(0, 3000)
      .map((r) => ({
        x: r.inclination,
        y: r.eccentricity,
        z: 1
      }));

    return {
      kpis: {
        visible,
        visiblePercent,
        avgYear: avg(years),
        avgInclination: avg(inclinations),
        avgEccentricity: avg(eccentricities)
      },
      typeCounts,
      regimeCounts,
      topCountries,
      launchHistogram,
      inclinationBins,
      eccentricityBins,
      scatterPoints
    };
  }, [visibleFilteredList, normalizedList.length]);

  return (
    <div className="w-full h-full relative overflow-hidden">
      <div ref={containerRef} className="w-full h-full" style={{ pointerEvents: 'auto' }} />

      {/* Botón Hamburger para Sidebar */}
      {!isSidebarOpen && (
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="absolute left-4 top-4 z-30 w-12 h-12 bg-black/60 backdrop-blur-md border border-white/10 rounded-lg flex items-center justify-center text-white hover:bg-gray-800 transition-colors group"
          title={tr('Abrir filtros', 'Open filters')}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      )}

      {/* Sidebar Filtros */}
      <div
        className={`absolute left-4 top-4 bottom-4 h-auto max-h-[calc(100%-2rem)] w-[320px] max-w-[80vw] pointer-events-auto z-20 transition-all duration-300 ${
          isSidebarOpen ? 'translate-x-0 opacity-100' : '-translate-x-[120%] opacity-0'
        }`}
      >
        <aside className="h-full min-h-0 flex flex-col rounded-2xl overflow-hidden bg-[#02040a]/95 backdrop-blur-md border border-white/10 shadow-2xl text-gray-200">
          <div className="px-4 py-4 border-b border-white/10 flex items-start justify-between gap-3 shrink-0">
            <div>
              <div className="text-xs text-gray-300 mt-1">
                {tr('Objetos visibles', 'Visible objects')}: <span className="text-cyan-400 font-bold">{visibleCount}</span> / {totalCount}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="w-9 h-9 bg-black/40 hover:bg-black/55 border border-white/10 rounded-lg flex items-center justify-center text-white/85 transition-colors"
              title={tr('Cerrar filtros', 'Close filters')}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            <FilterAccordion id="search" title={tr('Buscar', 'Search')} openId={openFilterId} setOpenId={setOpenFilterId}>
              <div className="relative">
                <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />
                </svg>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={tr('Nombre o NORAD...', 'Name or NORAD...')}
                  className="w-full bg-black/50 border border-white/10 rounded-xl pl-9 pr-9 py-2 text-sm outline-none focus:border-cyan-400"
                />
                {searchTerm.trim() !== '' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchTerm('');
                      setSearchResults([]);
                      setIsolatedSearchIndex(null);
                    }}
                    className="absolute right-2 top-1.5 h-7 w-7 rounded text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                    title={tr('Limpiar búsqueda', 'Clear search')}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
              {searchResults.length > 0 ? (
                <div className="mt-2 max-h-60 overflow-y-auto bg-black/40 rounded-xl border border-white/10 custom-scrollbar">
                  {searchResults.map((result) => (
                    <button
                      key={result.rawIndex}
                      type="button"
                      onClick={() => selectObject(result, { isolate: true, flyTo: true })}
                      className="w-full p-2 hover:bg-white/10 cursor-pointer text-xs border-b border-white/5 flex justify-between text-left transition-colors"
                    >
                      <span className="text-cyan-400 font-semibold">{result.name}</span>
                      <span className="text-gray-400">{result.noradId}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </FilterAccordion>

            <FilterAccordion id="country" title={tr('País', 'Country')} openId={openFilterId} setOpenId={setOpenFilterId}>
              <select
                value={filters.country}
                onChange={(e) => setFilters((prev) => ({ ...prev, country: e.target.value }))}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-cyan-400"
                title={
                  filters.country
                    ? getCountryDisplayLabel(filters.country)
                    : tr('Todos los países', 'All countries')
                }
              >
                <option value="">{tr('Todos los países', 'All countries')}</option>
                {countryList.map((country) => (
                  <option key={country} value={country} title={getCountryFullName(country)}>
                    {getCountryDisplayLabel(country)}
                  </option>
                ))}
              </select>
            </FilterAccordion>

            <FilterAccordion
              id="regime"
              title={tr('Régimen orbital', 'Orbital regime')}
              openId={openFilterId}
              setOpenId={setOpenFilterId}
              onHelpClick={() => navigate('/dashboard/orbit/guide')}
              helpTitle={tr('Aprender tipos de órbita', 'Learn orbit types')}
            >
              <div className="text-xs text-gray-300 mb-2">{tr('Tipo de órbita', 'Orbit type')}</div>
              <select
                value={filters.regime}
                onChange={(e) => setFilters((prev) => ({ ...prev, regime: e.target.value }))}
                className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-cyan-400"
              >
                <option value="">{tr('Todos', 'All')}</option>
                {ORBITAL_REGIMES.map((regime) => (
                  <option key={regime} value={regime}>
                    {regime}
                  </option>
                ))}
              </select>

              <div className="mt-4">
                <style>{`
                  .orbit-range-slider {
                    position: relative;
                    height: 4px;
                    background: #374151;
                    border-radius: 4px;
                  }
                  .orbit-range-slider input[type='range'] {
                    position: absolute;
                    width: 100%;
                    height: 4px;
                    top: 0;
                    background: transparent;
                    pointer-events: none;
                    -webkit-appearance: none;
                    appearance: none;
                  }
                  .orbit-range-slider input[type='range']::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 14px;
                    height: 14px;
                    border-radius: 50%;
                    background: #06B6D4;
                    cursor: pointer;
                    pointer-events: auto;
                    border: 2px solid #0891B2;
                    box-shadow: 0 0 6px rgba(6, 182, 212, 0.35);
                  }
                  .orbit-range-slider input[type='range']::-moz-range-thumb {
                    width: 14px;
                    height: 14px;
                    border-radius: 50%;
                    background: #06B6D4;
                    cursor: pointer;
                    pointer-events: auto;
                    border: 2px solid #0891B2;
                    box-shadow: 0 0 6px rgba(6, 182, 212, 0.35);
                  }
                `}</style>
                <div className="text-xs text-gray-300 mb-2">
                  {tr('Inclinación (grados)', 'Inclination (degrees)')}: {inclinationRange[0]} - {inclinationRange[1]}
                </div>
                <div className="orbit-range-slider">
                  <input
                    type="range"
                    min="0"
                    max="180"
                    value={inclinationRange[0]}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (value <= inclinationRange[1]) {
                        setInclinationRange([value, inclinationRange[1]]);
                      }
                    }}
                    style={{ zIndex: inclinationRange[0] > 90 ? 5 : 3 }}
                  />
                  <input
                    type="range"
                    min="0"
                    max="180"
                    value={inclinationRange[1]}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (value >= inclinationRange[0]) {
                        setInclinationRange([inclinationRange[0], value]);
                      }
                    }}
                    style={{ zIndex: inclinationRange[1] < 90 ? 5 : 3 }}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
                  <span>0</span>
                  <span>180</span>
                </div>
              </div>

              <div className="mt-4">
                <div className="text-xs text-gray-300 mb-2">
                  {tr('Excentricidad', 'Eccentricity')}: {eccentricityRange[0].toFixed(2)} - {eccentricityRange[1].toFixed(2)}
                </div>
                <div className="orbit-range-slider">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={eccentricityRange[0]}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (value <= eccentricityRange[1]) {
                        setEccentricityRange([value, eccentricityRange[1]]);
                      }
                    }}
                    style={{ zIndex: eccentricityRange[0] > 0.5 ? 5 : 3 }}
                  />
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={eccentricityRange[1]}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (value >= eccentricityRange[0]) {
                        setEccentricityRange([eccentricityRange[0], value]);
                      }
                    }}
                    style={{ zIndex: eccentricityRange[1] < 0.5 ? 5 : 3 }}
                  />
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
                  <span>0.00</span>
                  <span>1.00</span>
                </div>
              </div>
            </FilterAccordion>

            <FilterAccordion id="type" title={tr('Tipo de objeto', 'Object type')} openId={openFilterId} setOpenId={setOpenFilterId}>
              <div className="grid grid-cols-1 gap-2">
                {FILTER_TYPES.map((type) => {
                  const checked = filters.types.includes(type);
                  const color = TYPE_COLORS[type] || TYPE_COLORS.DEBRIS;
                  return (
                    <label key={type} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-black/40 hover:bg-black/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleType(type)}
                        className="h-4 w-4 rounded border-gray-500 bg-transparent"
                      />
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color.toCssColorString() }} />
                      <span className="text-sm text-gray-200">{type}</span>
                    </label>
                  );
                })}
              </div>
            </FilterAccordion>

            <FilterAccordion id="year" title={tr('Rango de lanzamiento', 'Launch range')} openId={openFilterId} setOpenId={setOpenFilterId}>
              <div className="text-xs text-gray-200">{tr('Rango de años', 'Year range')}</div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="font-mono">{yearRange[0]}</span>
                <span className="text-gray-300">→</span>
                <span className="font-mono">{yearRange[1]}</span>
              </div>
              <div className="relative mt-3">
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
                    style={{ zIndex: yearRange[0] > 1991 ? 5 : 3 }}
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
                    style={{ zIndex: yearRange[1] < 1991 ? 5 : 3 }}
                  />
                </div>
              </div>
            </FilterAccordion>
          </div>

          <div className="px-4 py-3 border-t border-white/10 flex flex-col gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsReportOpen(true)}
              className="w-full px-3 py-2 rounded-xl border text-xs font-extrabold transition bg-cyan-500/15 border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/20"
            >
              {tr('Generar informe', 'Generate report')}
            </button>
            <button
              type="button"
              onClick={() => {
                setFilters({
                  types: ['PAYLOAD', 'ROCKET BODY', 'DEBRIS'],
                  country: '',
                  regime: ''
                });
                setInclinationRange([0, 180]);
                setEccentricityRange([0, 1]);
                setYearRange([1957, 2026]);
                setSearchTerm('');
                setSearchResults([]);
                setIsolatedSearchIndex(null);
              }}
              className="flex-1 px-3 py-2 rounded-xl border text-xs font-extrabold transition bg-white/10 border-white/10 hover:bg-white/15"
            >
              {tr('Limpiar', 'Reset')}
            </button>
          </div>
        </aside>
      </div>

      {/* Botones Maestros - Derecha */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-auto">
        {/* Botón Fullscreen */}
        <button
          onClick={toggleFullscreen}
          className="w-12 h-12 bg-black/60 backdrop-blur-md border border-white/10 rounded-lg flex items-center justify-center text-white hover:bg-gray-800 transition-colors group"
          title={isFullscreen ? tr('Salir de pantalla completa', 'Exit fullscreen') : tr('Pantalla completa', 'Fullscreen')}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {isFullscreen ? (
              <>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4l5 5" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 9h3V6" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 4l-5 5" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9h-3V6" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 20l5-5" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 15h3v3" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 20l-5-5" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 15h-3v3" />
              </>
            ) : (
              <>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9L4 4" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4H4v3" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 9l5-5" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 4h3v3" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 15l-5 5" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 17v3h3" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l5 5" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h3v-3" />
              </>
            )}
          </svg>
        </button>

        {/* Botón Modo Órbita */}
        <button
          onClick={() => setOrbitMode(orbitMode === 'inertial' ? 'fixed' : 'inertial')}
          className="relative w-12 h-12 bg-black/60 backdrop-blur-md border border-white/10 rounded-lg flex items-center justify-center text-white hover:bg-gray-800 transition-colors group"
          title={orbitMode === 'inertial' ? tr('Modo: ECI (Inercial)', 'Mode: ECI (Inertial)') : tr('Modo: ECEF (Terrestre)', 'Mode: ECEF (Earth-fixed)')}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="8" strokeWidth={2} />
            <ellipse cx="12" cy="12" rx="12" ry="4" strokeWidth={2} />
          </svg>
          <span className="pointer-events-none absolute left-1/2 top-[calc(100%+8px)] -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
            {orbitMode === 'inertial' ? 'ECI' : 'ECEF'}
          </span>
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
          <p className="text-xs text-gray-300">{tr('Tipo', 'Type')}: {hoverInfo.data.type}</p>
          <p className="text-xs text-gray-300" title={getCountryFullName(hoverInfo.data.country)}>
            {tr('País', 'Country')}: {getCountryDisplayLabel(hoverInfo.data.country)}
          </p>
          {hoverInfo.data.country && getCountryFullName(hoverInfo.data.country) !== hoverInfo.data.country ? (
            <p className="text-xs text-gray-400">{getCountryFullName(hoverInfo.data.country)}</p>
          ) : null}
          <p className="text-xs text-gray-300">{tr('Año', 'Year')}: {hoverInfo.data.year}</p>
        </div>
      )}

      {isReportOpen ? (
        <div className="fixed inset-0 z-[130] bg-black/75 backdrop-blur-sm p-4 overflow-auto">
          <div className="max-w-6xl mx-auto bg-[#02040a]/95 border border-white/10 rounded-2xl shadow-2xl">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <div className="text-white text-lg font-extrabold">{tr('Informe orbital', 'Orbital report')}</div>
                <div className="text-xs text-gray-300 mt-1">
                  {tr('Métricas y gráficos sobre objetos visibles con filtros activos', 'Metrics and charts for currently visible filtered objects')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsReportOpen(false)}
                className="w-10 h-10 rounded-lg border border-white/10 bg-black/40 hover:bg-black/55 text-white/90"
                title={tr('Cerrar informe', 'Close report')}
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                  <div className="text-xs text-gray-300">{tr('Objetos visibles', 'Visible objects')}</div>
                  <div className="text-xl font-extrabold text-cyan-300">{reportData.kpis.visible.toLocaleString()}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                  <div className="text-xs text-gray-300">{tr('Porcentaje sobre total', 'Share of total')}</div>
                  <div className="text-xl font-extrabold text-cyan-300">{reportData.kpis.visiblePercent.toFixed(2)}%</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                  <div className="text-xs text-gray-300">{tr('Año promedio', 'Average launch year')}</div>
                  <div className="text-xl font-extrabold text-cyan-300">{reportData.kpis.avgYear ? reportData.kpis.avgYear.toFixed(1) : '—'}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                  <div className="text-xs text-gray-300">{tr('Inclinación promedio', 'Average inclination')}</div>
                  <div className="text-xl font-extrabold text-cyan-300">{reportData.kpis.avgInclination ? reportData.kpis.avgInclination.toFixed(2) : '—'}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                  <div className="text-xs text-gray-300">{tr('Excentricidad promedio', 'Average eccentricity')}</div>
                  <div className="text-xl font-extrabold text-cyan-300">{reportData.kpis.avgEccentricity ? reportData.kpis.avgEccentricity.toFixed(4) : '—'}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-xl border border-white/10 bg-black/40 p-3 h-72">
                  <div className="text-sm font-bold text-white mb-2">{tr('Objetos por tipo', 'Objects by type')}</div>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportData.typeCounts}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="name" stroke="#9ca3af" tick={{ fontSize: 11 }} />
                      <YAxis stroke="#9ca3af" tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#22d3ee" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/40 p-3 h-72">
                  <div className="text-sm font-bold text-white mb-2">{tr('Objetos por régimen orbital', 'Objects by orbital regime')}</div>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportData.regimeCounts}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="name" stroke="#9ca3af" tick={{ fontSize: 11 }} />
                      <YAxis stroke="#9ca3af" tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#38bdf8" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/40 p-3 h-72">
                  <div className="text-sm font-bold text-white mb-2">{tr('Top países (10)', 'Top countries (10)')}</div>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportData.topCountries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="name" stroke="#9ca3af" tick={{ fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={60} />
                      <YAxis stroke="#9ca3af" tick={{ fontSize: 11 }} />
                      <Tooltip
                        labelFormatter={(label, payload) => {
                          const fullName = payload?.[0]?.payload?.fullName;
                          return fullName && fullName !== label ? `${label} - ${fullName}` : label;
                        }}
                      />
                      <Bar dataKey="count" fill="#2dd4bf" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/40 p-3 h-72">
                  <div className="text-sm font-bold text-white mb-2">{tr('Histograma de lanzamientos', 'Launch year histogram')}</div>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportData.launchHistogram}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="year" stroke="#9ca3af" tick={{ fontSize: 11 }} />
                      <YAxis stroke="#9ca3af" tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#34d399" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="rounded-xl border border-white/10 bg-black/40 p-3 h-72">
                  <div className="text-sm font-bold text-white mb-2">{tr('Histograma de inclinación', 'Inclination histogram')}</div>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportData.inclinationBins}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="bin" stroke="#9ca3af" tick={{ fontSize: 10 }} interval={2} />
                      <YAxis stroke="#9ca3af" tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#06b6d4" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/40 p-3 h-72">
                  <div className="text-sm font-bold text-white mb-2">{tr('Histograma de excentricidad', 'Eccentricity histogram')}</div>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportData.eccentricityBins}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="bin" stroke="#9ca3af" tick={{ fontSize: 10 }} interval={3} />
                      <YAxis stroke="#9ca3af" tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#0891b2" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/40 p-3 h-72">
                  <div className="text-sm font-bold text-white mb-2">{tr('Inclinación vs excentricidad', 'Inclination vs eccentricity')}</div>
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart>
                      <CartesianGrid stroke="#1f2937" />
                      <XAxis type="number" dataKey="x" name="Inclination" stroke="#9ca3af" tick={{ fontSize: 11 }} domain={[0, 180]} />
                      <YAxis type="number" dataKey="y" name="Eccentricity" stroke="#9ca3af" tick={{ fontSize: 11 }} domain={[0, 1]} />
                      <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                      <Scatter data={reportData.scatterPoints} fill="#22d3ee" opacity={0.55} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default CesiumGlobe;

