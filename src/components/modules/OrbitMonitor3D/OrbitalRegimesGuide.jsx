import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Cesium from 'cesium';
import { useI18n } from '../../../i18n/I18nProvider.jsx';

const EARTH_RADIUS_KM = 6371;
const STAGE_DURATION_MS = 14000;
const AUTO_ROTATE_RAD_PER_SEC = Cesium.Math.toRadians(2.2);
const MOLNIYA_ROTATE_MULTIPLIER = 2.1;

function pickNarratorVoice(voices, isSpanish) {
  if (!Array.isArray(voices) || voices.length === 0) return null;

  const byName = isSpanish
    ? [
        /google\s+espa[nñ]ol/i,
        /google.*spanish/i,
        /google.*español/i,
        /microsoft.*es-/i,
        /es-/i
      ]
    : [
        /google\s+uk\s+english\s+female/i,
        /google.*uk.*female/i,
        /google.*en-gb/i,
        /microsoft.*en-gb/i,
        /en-gb/i
      ];

  for (const pattern of byName) {
    const hit = voices.find((v) => pattern.test(`${v.name} ${v.voiceURI} ${v.lang}`));
    if (hit) return hit;
  }

  const langPrefix = isSpanish ? 'es' : 'en';
  return voices.find((v) => String(v?.lang || '').toLowerCase().startsWith(langPrefix)) || voices[0] || null;
}

function getNarration(stageId) {
  switch (stageId) {
    case 'LEO':
      return {
        teachEs: 'Bienvenido a LEO, el carril rápido del espacio: aquí viven estaciones, observación terrestre y muchas constelaciones.',
        teachEn: 'Welcome to LEO, the fast lane of space: this is home to stations, Earth observation, and many constellations.',
        askEs: 'Mira el ritmo: estas órbitas completan vueltas rápidas y pasan seguido sobre una misma zona.',
        askEn: 'Watch the pace: these orbits complete quick revolutions and revisit the same regions often.',
        hintEs: 'Cuanto más bajo orbitas, mayor velocidad orbital media necesitas para no caer.',
        hintEn: 'The lower you orbit, the higher average orbital speed you need to avoid falling.',
        funEs: 'Dato curioso: la ISS da una vuelta aproximadamente cada 90 minutos.',
        funEn: 'Fun fact: the ISS circles Earth roughly every 90 minutes.'
      };
    case 'MEO':
      return {
        teachEs: 'Subimos a MEO, la autopista de la navegación global: aquí trabajan GPS, Galileo y compañía.',
        teachEn: 'Now we climb to MEO, the global navigation highway: this is where GPS, Galileo, and similar systems operate.',
        askEs: 'Compara cobertura y tiempo: hay menos satélites, pero cada uno “ve” una región más amplia.',
        askEn: 'Compare coverage and timing: there are fewer satellites, but each one “sees” a broader region.',
        hintEs: 'En MEO se equilibra bien precisión, cobertura y cantidad de satélites.',
        hintEn: 'MEO balances precision, coverage, and satellite count very well.',
        funEs: 'Dato curioso: las señales GNSS tardan una fracción de segundo, pero ese tiempo define tu ubicación.',
        funEn: 'Fun fact: GNSS signals take just a fraction of a second, but that timing defines your position.'
      };
    case 'GEO':
      return {
        teachEs: 'Ahora estamos en GEO: desde la Tierra parece que el satélite se queda “clavado” en el cielo.',
        teachEn: 'Now we are in GEO: from Earth, the satellite appears “fixed” in the sky.',
        askEs: 'Fíjate en la altura y en lo ecuatorial de la trayectoria: esa geometría es la clave.',
        askEn: 'Notice the altitude and equatorial path: that geometry is the key.',
        hintEs: 'Para ser geoestacionario, el período orbital debe coincidir con la rotación terrestre.',
        hintEn: 'To be geostationary, orbital period must match Earth’s rotation.',
        funEs: 'Dato curioso: muchas antenas de TV satelital apuntan siempre al mismo punto GEO.',
        funEn: 'Fun fact: many satellite TV dishes always point to the same GEO point.'
      };
    case 'HEO':
      return {
        teachEs: 'Bien, mira esta órbita HEO: súper elíptica. Se acerca mucho y luego se dispara lejos.',
        teachEn: 'Great, now look at this HEO orbit: highly elliptical. It gets close, then swings far away.',
        askEs: 'Observa el contraste perigeo-apogeo: esa diferencia es lo que le da su personalidad.',
        askEn: 'Observe the perigee-apogee contrast: that difference gives this orbit its personality.',
        hintEs: 'Molniya está diseñada para pasar más tiempo “útil” sobre altas latitudes.',
        hintEn: 'Molniya is designed to spend more “useful” time over high latitudes.',
        funEs: 'Dato curioso: en algunas órbitas el satélite parece “quedarse” un rato y luego acelerar.',
        funEn: 'Fun fact: in some orbits the satellite seems to “linger” and then speed up.'
      };
    case 'INC':
      return {
        teachEs: 'Ahora hablamos de inclinación: es el “ángulo de ataque” del plano orbital.',
        teachEn: 'Now let’s talk inclination: it is the orbital plane “attack angle.”',
        askEs: 'Compara una órbita casi ecuatorial con una casi polar y verás rutas totalmente distintas.',
        askEn: 'Compare a nearly equatorial orbit with a nearly polar one and you will see very different ground tracks.',
        hintEs: 'Cerca de 0°: más ecuatorial. Cerca de 90°: más cobertura en polos.',
        hintEn: 'Near 0°: more equatorial. Near 90°: better polar coverage.',
        funEs: 'Dato curioso: muchas misiones de observación usan inclinaciones altas para cubrir más planeta.',
        funEn: 'Fun fact: many Earth observation missions use high inclinations for broader coverage.'
      };
    case 'ECC':
      return {
        teachEs: 'Excentricidad es “qué tan ovalada” es la órbita: de círculo suave a elipse marcada.',
        teachEn: 'Eccentricity is how “oval” an orbit is: from near-circular to strongly elongated.',
        askEs: 'Compara ambas curvas: una casi redonda y otra estirada, con comportamientos distintos.',
        askEn: 'Compare both curves: one nearly round and one stretched, each with different behavior.',
        hintEs: 'e≈0 implica órbita casi circular; e alta implica grandes cambios de distancia.',
        hintEn: 'e≈0 means nearly circular orbit; high e means large distance changes.',
        funEs: 'Dato curioso: cambiar un poco la excentricidad puede cambiar mucho dónde y cuánto tiempo observa un satélite.',
        funEn: 'Fun fact: small eccentricity changes can strongly affect where and how long a satellite observes.'
      };
    default:
      return {
        teachEs: 'Vamos paso a paso observando la geometría orbital.',
        teachEn: 'We will go step by step observing orbital geometry.',
        askEs: 'Mira forma, altura e inclinación.',
        askEn: 'Look at shape, altitude, and inclination.',
        hintEs: 'Cada etapa destaca una idea diferente.',
        hintEn: 'Each stage highlights a different concept.',
        funEs: 'Dato curioso: el espacio orbital es como una ciudad con carriles de distinta función.',
        funEn: 'Fun fact: orbital space is like a city with lanes for different missions.'
      };
  }
}

const STAGES = [
  {
    id: 'LEO',
    titleEs: 'Órbita baja (LEO)',
    titleEn: 'Low Earth Orbit (LEO)',
    textEs:
      'Esta es la órbita baja terrestre. Aquí se encuentra la mayor parte de los satélites de observación y muchas constelaciones de internet. Altitud típica: 160 a 2.000 km.',
    textEn:
      'This is Low Earth Orbit. Most observation satellites and many internet constellations are here. Typical altitude: 160 to 2,000 km.',
    cameraHeightM: 12000000,
    orbits: [
      { key: 'leo-main', label: 'ISS', color: '#22c55e', altitudeKm: 420, inclinationDeg: 51.6, eccentricity: 0.0008, speed: 2.2 },
      { key: 'leo-2', label: 'SAOCOM 1A', color: '#4ade80', altitudeKm: 620, inclinationDeg: 97.9, eccentricity: 0.001, speed: 1.95 }
    ]
  },
  {
    id: 'MEO',
    titleEs: 'Órbita media (MEO)',
    titleEn: 'Medium Earth Orbit (MEO)',
    textEs:
      'La órbita media se usa mucho para navegación global (GNSS). Altitud típica: 2.000 a 35.786 km. Tiene buena cobertura con menos satélites que LEO.',
    textEn:
      'Medium Earth Orbit is widely used for global navigation (GNSS). Typical altitude: 2,000 to 35,786 km. It provides broad coverage with fewer satellites than LEO.',
    cameraHeightM: 18000000,
    orbits: [
      { key: 'meo-main', label: 'GPS', color: '#38bdf8', altitudeKm: 20200, inclinationDeg: 55, eccentricity: 0.01, speed: 0.95 }
    ]
  },
  {
    id: 'GEO',
    titleEs: 'Órbita geoestacionaria (GEO)',
    titleEn: 'Geostationary Orbit (GEO)',
    textEs:
      'En GEO el satélite parece fijo respecto a la Tierra. Esto es ideal para comunicaciones y meteorología. Altitud característica: 35.786 km sobre el ecuador.',
    textEn:
      'In GEO, a satellite appears fixed relative to Earth. This is ideal for communications and weather monitoring. Characteristic altitude: 35,786 km over the equator.',
    cameraHeightM: 42000000,
    cameraLon: -63,
    cameraLat: -28,
    orbits: [
      { key: 'geo-main', label: 'ARSAT-1', color: '#f59e0b', altitudeKm: 35786, inclinationDeg: 0.1, eccentricity: 0.0002, speed: 0.05, phaseDeg: -72 }
    ]
  },
  {
    id: 'HEO',
    titleEs: 'Órbita altamente elíptica (HEO)',
    titleEn: 'Highly Elliptical Orbit (HEO)',
    textEs:
      'HEO usa trayectorias muy elípticas. Permite largas coberturas sobre latitudes altas. Ejemplo clásico: órbitas Molniya.',
    textEn:
      'HEO uses very elliptical trajectories. It enables long coverage over high latitudes. Classic example: Molniya orbits.',
    cameraHeightM: 60000000,
    orbits: [
      { key: 'heo-main', label: 'Molniya', color: '#ef4444', altitudeKm: 26500, inclinationDeg: 63.4, eccentricity: 0.72, speed: 0.8 }
    ]
  },
  {
    id: 'INC',
    titleEs: 'Qué es la inclinación orbital',
    titleEn: 'What orbital inclination means',
    textEs:
      'La inclinación es el ángulo del plano orbital respecto al ecuador. 0° es ecuatorial, 90° es polar. Define por dónde pasa el satélite sobre la Tierra.',
    textEn:
      'Inclination is the angle between the orbital plane and the equator. 0° is equatorial, 90° is polar. It defines where the satellite passes over Earth.',
    cameraHeightM: 22000000,
    orbits: [
      { key: 'inc-equatorial', label: 'GEO eq.', color: '#22c55e', altitudeKm: 1500, inclinationDeg: 0, eccentricity: 0.001, speed: 1.2 },
      { key: 'inc-polar', label: 'NOAA-20', color: '#60a5fa', altitudeKm: 830, inclinationDeg: 98.7, eccentricity: 0.001, speed: 1.25 }
    ]
  },
  {
    id: 'ECC',
    titleEs: 'Qué es la excentricidad orbital',
    titleEn: 'What orbital eccentricity means',
    textEs:
      'La excentricidad indica qué tan circular o elíptica es una órbita. e≈0 es casi circular. Valores altos significan órbita muy alargada.',
    textEn:
      'Eccentricity tells how circular or elliptical an orbit is. e≈0 means nearly circular. Higher values mean a more elongated orbit.',
    cameraHeightM: 26000000,
    orbits: [
      { key: 'ecc-circular', label: 'Circular', color: '#34d399', altitudeKm: 10000, inclinationDeg: 30, eccentricity: 0.01, speed: 1.0 },
      { key: 'ecc-elliptic', label: 'Molniya e~0.7', color: '#f87171', altitudeKm: 20000, inclinationDeg: 63.4, eccentricity: 0.7, speed: 0.8 }
    ]
  }
];

function orbitPositions(altitudeKm, inclinationDeg, eccentricity, samples = 280) {
  const semiMajor = EARTH_RADIUS_KM + altitudeKm;
  const inc = Cesium.Math.toRadians(inclinationDeg);
  const points = [];

  for (let i = 0; i <= samples; i += 1) {
    const nu = (i / samples) * Math.PI * 2;
    const r = (semiMajor * (1 - eccentricity * eccentricity)) / (1 + eccentricity * Math.cos(nu));
    const x = r * Math.cos(nu);
    const y = r * Math.sin(nu);

    const yi = y * Math.cos(inc);
    const zi = y * Math.sin(inc);

    points.push(new Cesium.Cartesian3(x * 1000, yi * 1000, zi * 1000));
  }

  return points;
}

function createOrbitEntities(viewer, orbit) {
  const color = Cesium.Color.fromCssColorString(orbit.color);
  const pathPositions = orbitPositions(orbit.altitudeKm, orbit.inclinationDeg, orbit.eccentricity);
  const phaseDeg = Number.isFinite(Number(orbit.phaseDeg)) ? Number(orbit.phaseDeg) : 0;
  const normalizedPhase = ((phaseDeg % 360) + 360) % 360;
  const phaseIndex = Math.round((normalizedPhase / 360) * (pathPositions.length - 1));

  const orbitEntity = viewer.entities.add({
    name: orbit.label,
    polyline: {
      positions: pathPositions,
      width: 2,
      material: color.withAlpha(0.95)
    }
  });

  const start = Cesium.JulianDate.now();
  const satEntity = viewer.entities.add({
    position: new Cesium.CallbackProperty((time) => {
      const elapsed = Cesium.JulianDate.secondsDifference(time, start);
      const idx = Math.floor((elapsed * orbit.speed + phaseIndex) % pathPositions.length);
      return pathPositions[(idx + pathPositions.length) % pathPositions.length];
    }, false),
    point: {
      pixelSize: 8,
      color,
      outlineColor: Cesium.Color.WHITE.withAlpha(0.9),
      outlineWidth: 1
    },
    label: {
      text: orbit.label,
      font: '12px sans-serif',
      fillColor: Cesium.Color.WHITE,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      pixelOffset: new Cesium.Cartesian2(0, -14),
      showBackground: true,
      backgroundColor: Cesium.Color.BLACK.withAlpha(0.5)
    }
  });

  return [orbitEntity, satEntity];
}

function recommendedCameraHeight(orbits, fallbackHeightM) {
  if (!Array.isArray(orbits) || orbits.length === 0) return fallbackHeightM;

  let maxRadiusKm = EARTH_RADIUS_KM;
  for (const orbit of orbits) {
    const altitudeKm = Number(orbit?.altitudeKm) || 0;
    const eccentricity = Math.max(0, Math.min(0.95, Number(orbit?.eccentricity) || 0));
    const semiMajorKm = EARTH_RADIUS_KM + altitudeKm;
    const apogeeRadiusKm = semiMajorKm * (1 + eccentricity);
    if (apogeeRadiusKm > maxRadiusKm) maxRadiusKm = apogeeRadiusKm;
  }

  // Framing factor tuned to keep very elongated/compared orbits comfortably in view.
  const dynamicHeightM = maxRadiusKm * 1000 * 3.2;
  return Math.max(fallbackHeightM, dynamicHeightM);
}

export default function OrbitalRegimesGuide() {
  const { tr } = useI18n();
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const stageEntitiesRef = useRef([]);
  const autoRotateTickRef = useRef(null);
  const lastTickSecondsRef = useRef(null);
  const autoRotateSpeedRef = useRef(AUTO_ROTATE_RAD_PER_SEC);
  const [stageIndex, setStageIndex] = useState(0);
  const [isAutoPlay, setIsAutoPlay] = useState(true);
  const [isVoiceOn, setIsVoiceOn] = useState(true);
  const [typedNarration, setTypedNarration] = useState('');
  const [availableVoices, setAvailableVoices] = useState([]);
  const [hasAudioUnlock, setHasAudioUnlock] = useState(false);
  const fallbackAdvanceTimerRef = useRef(null);

  const stages = useMemo(() => STAGES, []);
  const stage = stages[stageIndex] || stages[0];
  const narration = getNarration(stage?.id);
  const isSpanish = tr('es', 'en') === 'es';
  const announcerText = tr(
    `${narration.teachEs} ${narration.askEs} ${narration.funEs}`,
    `${narration.teachEn} ${narration.askEn} ${narration.funEn}`
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return undefined;

    const synth = window.speechSynthesis;
    const loadVoices = () => {
      const voices = synth.getVoices() || [];
      setAvailableVoices(voices);
    };

    loadVoices();
    synth.addEventListener('voiceschanged', loadVoices);
    return () => synth.removeEventListener('voiceschanged', loadVoices);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const unlockAudio = () => {
      setHasAudioUnlock(true);
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };

    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const viewer = new Cesium.Viewer(containerRef.current, {
      animation: false,
      timeline: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      baseLayerPicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: true,
      creditContainer: document.createElement('div')
    });

    viewerRef.current = viewer;
    viewer.scene.globe.enableLighting = false;
    viewer.scene.globe.showGroundAtmosphere = false;
    viewer.scene.skyAtmosphere.hueShift = 0.05;

    const onTick = (clock) => {
      if (viewer.scene.mode !== Cesium.SceneMode.SCENE3D) return;
      const nowSeconds = Cesium.JulianDate.toDate(clock.currentTime).getTime() / 1000;
      const lastSeconds = lastTickSecondsRef.current ?? nowSeconds;
      const dt = Math.max(0, Math.min(0.25, nowSeconds - lastSeconds));
      lastTickSecondsRef.current = nowSeconds;

      // Positive angle rotates in the opposite direction to the previous setup.
      viewer.camera.rotate(Cesium.Cartesian3.UNIT_Z, autoRotateSpeedRef.current * dt);
    };

    viewer.clock.onTick.addEventListener(onTick);
    autoRotateTickRef.current = onTick;

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(0, 18, 18000000),
      duration: 1.2
    });

    return () => {
      if (autoRotateTickRef.current) {
        viewer.clock.onTick.removeEventListener(autoRotateTickRef.current);
        autoRotateTickRef.current = null;
      }
      lastTickSecondsRef.current = null;
      stageEntitiesRef.current.forEach((entity) => viewer.entities.remove(entity));
      stageEntitiesRef.current = [];
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    let charIndex = 0;
    setTypedNarration('');

    const timer = window.setInterval(() => {
      charIndex += 1;
      setTypedNarration(announcerText.slice(0, charIndex));
      if (charIndex >= announcerText.length) {
        window.clearInterval(timer);
      }
    }, 16);

    return () => window.clearInterval(timer);
  }, [announcerText, stageIndex]);

  useEffect(() => {
    if (fallbackAdvanceTimerRef.current) {
      window.clearTimeout(fallbackAdvanceTimerRef.current);
      fallbackAdvanceTimerRef.current = null;
    }

    if (typeof window === 'undefined' || !window.speechSynthesis) {
      if (isAutoPlay) {
        fallbackAdvanceTimerRef.current = window.setTimeout(() => {
          setStageIndex((prev) => (prev + 1) % stages.length);
        }, STAGE_DURATION_MS);
      }
      return undefined;
    }

    const synth = window.speechSynthesis;

    if (!isVoiceOn) {
      synth.cancel();
      if (isAutoPlay) {
        fallbackAdvanceTimerRef.current = window.setTimeout(() => {
          setStageIndex((prev) => (prev + 1) % stages.length);
        }, STAGE_DURATION_MS);
      }
      return undefined;
    }

    if (!hasAudioUnlock) {
      synth.cancel();
      return undefined;
    }

    synth.cancel();
    const selectedVoice = pickNarratorVoice(availableVoices, isSpanish);
    const utterance = new SpeechSynthesisUtterance(announcerText);
    utterance.voice = selectedVoice || null;
    utterance.lang = selectedVoice?.lang || (isSpanish ? 'es-ES' : 'en-US');
    utterance.rate = 1.02;
    utterance.pitch = 1.02;
    utterance.volume = 1;
    utterance.onend = () => {
      if (isAutoPlay) {
        setStageIndex((prev) => (prev + 1) % stages.length);
      }
    };
    utterance.onerror = () => {
      if (isAutoPlay) {
        fallbackAdvanceTimerRef.current = window.setTimeout(() => {
          setStageIndex((prev) => (prev + 1) % stages.length);
        }, STAGE_DURATION_MS);
      }
    };

    synth.speak(utterance);

    return () => {
      synth.cancel();
      if (fallbackAdvanceTimerRef.current) {
        window.clearTimeout(fallbackAdvanceTimerRef.current);
        fallbackAdvanceTimerRef.current = null;
      }
    };
  }, [announcerText, availableVoices, hasAudioUnlock, isAutoPlay, isSpanish, isVoiceOn, stageIndex, stages.length]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !stage) return;

    stageEntitiesRef.current.forEach((entity) => viewer.entities.remove(entity));
    stageEntitiesRef.current = [];

    stage.orbits.forEach((orbit) => {
      stageEntitiesRef.current.push(...createOrbitEntities(viewer, orbit));
    });

    const cameraHeightM = recommendedCameraHeight(stage.orbits, stage.cameraHeightM);
    const hasMolniya = stage.orbits.some((orbit) => /molniya/i.test(orbit.label));
    autoRotateSpeedRef.current = hasMolniya
      ? AUTO_ROTATE_RAD_PER_SEC * MOLNIYA_ROTATE_MULTIPLIER
      : AUTO_ROTATE_RAD_PER_SEC;

    const cameraLon = Number.isFinite(Number(stage.cameraLon)) ? Number(stage.cameraLon) : -20;
    const cameraLat = Number.isFinite(Number(stage.cameraLat)) ? Number(stage.cameraLat) : 22;

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(cameraLon, cameraLat, cameraHeightM),
      duration: 2.2
    });
  }, [stage]);

  return (
    <div className="h-full w-full overflow-hidden bg-[#02040a] text-white">
      <div className="w-full h-[94dvh] px-2 md:px-3 lg:px-4 py-3 md:py-4">
        <div className="grid h-full grid-cols-1 xl:grid-cols-[minmax(0,1fr)_290px] gap-3">
          <div className="rounded-2xl border border-white/10 bg-black/35 p-1.5 md:p-2">
            <div className="relative h-[560px] md:h-full rounded-xl overflow-hidden border border-white/10">
              <div ref={containerRef} className="h-full w-full" />

              <button
                type="button"
                onClick={() => navigate('/dashboard/orbit')}
                className="absolute right-3 top-3 z-20 px-2.5 py-1 rounded-lg border border-white/20 bg-black/55 hover:bg-black/70 text-[11px] font-bold"
              >
                {tr('Volver', 'Back')}
              </button>

              <div className="absolute left-3 top-3 max-w-[75%] rounded-lg border border-cyan-400/35 bg-[#02111d]/86 backdrop-blur-sm px-2.5 py-2 transition-all duration-500">
                <div className="text-[10px] uppercase tracking-wider text-cyan-200/80 mb-0.5">
                  {tr('Guía en vivo', 'Live guide')}
                </div>
                <div className="text-sm md:text-base font-extrabold text-white leading-tight">{tr(stage.titleEs, stage.titleEn)}</div>
                <p className="text-[11px] md:text-xs text-cyan-50/90 mt-1.5 leading-snug line-clamp-3">{tr(stage.textEs, stage.textEn)}</p>
              </div>

              <div className="absolute left-3 bottom-3 flex items-center gap-2 rounded-lg border border-white/15 bg-black/55 px-2 py-1">
                <button
                  type="button"
                  onClick={() => setStageIndex((prev) => (prev - 1 + stages.length) % stages.length)}
                  className="px-2 py-1 text-xs font-bold rounded bg-white/10 hover:bg-white/20"
                >
                  {tr('Anterior', 'Prev')}
                </button>
                <div className="text-[11px] text-gray-200">
                  {stageIndex + 1}/{stages.length}
                </div>
                <button
                  type="button"
                  onClick={() => setIsAutoPlay((prev) => !prev)}
                  className="px-2 py-1 text-xs font-bold rounded bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-100"
                >
                  {isAutoPlay ? tr('Pausar', 'Pause') : tr('Reanudar', 'Resume')}
                </button>
                <button
                  type="button"
                  onClick={() => setStageIndex((prev) => (prev + 1) % stages.length)}
                  className="px-2 py-1 text-xs font-bold rounded bg-white/10 hover:bg-white/20"
                >
                  {tr('Siguiente', 'Next')}
                </button>
              </div>

              <div className="absolute right-3 bottom-3 max-w-[300px] rounded-xl border border-amber-300/35 bg-[#1a1306]/90 backdrop-blur-sm p-2.5">
                <div className="flex items-start gap-2">
                  <div className="relative shrink-0 mt-0.5">
                    <div className="h-9 w-9 rounded-full bg-slate-100 border-2 border-amber-300/70" />
                    <div className="absolute left-1.5 top-2 h-4 w-6 rounded-full border border-slate-400/70 bg-sky-100/90" />
                    <div className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-amber-200/85 font-bold">
                      {tr('Astronauta', 'Astronaut')} · {tr('Guía', 'Guide')}
                    </div>
                    <p className="text-[11px] text-amber-50/95 leading-snug mt-1 min-h-[44px]">
                      {typedNarration}
                      <span className="opacity-70">{typedNarration.length < announcerText.length ? '|' : ''}</span>
                    </p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {!hasAudioUnlock && isVoiceOn ? (
                        <button
                          type="button"
                          onClick={() => setHasAudioUnlock(true)}
                          className="text-[10px] font-bold px-2 py-0.5 rounded border border-amber-200/35 bg-emerald-500/20 hover:bg-emerald-500/35"
                        >
                          {tr('Tocar para activar narrador', 'Tap to enable narrator')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setIsVoiceOn((prev) => !prev)}
                        className="text-[10px] font-bold px-2 py-0.5 rounded border border-amber-200/35 bg-amber-500/10 hover:bg-amber-500/20"
                      >
                        {isVoiceOn ? tr('Silenciar voz', 'Mute voice') : tr('Activar voz', 'Enable voice')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setStageIndex((prev) => (prev + 1) % stages.length)}
                        className="text-[10px] font-bold px-2 py-0.5 rounded border border-amber-200/35 bg-black/35 hover:bg-black/55"
                      >
                        {tr('Saltar línea', 'Skip line')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/35 p-2.5 space-y-2.5 h-full overflow-auto">
            {stage.orbits.map((r) => (
              <div key={r.key} className="rounded-lg border border-white/10 bg-black/40 p-2.5">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                  <span className="font-extrabold text-sm">{r.label}</span>
                </div>
                <p className="text-[11px] text-gray-200 leading-snug">
                  {tr('Altitud aprox.', 'Approx. altitude')}: {Math.round(r.altitudeKm).toLocaleString()} km
                </p>
                <p className="text-[11px] text-gray-300 leading-snug">
                  {tr('Inclinación', 'Inclination')}: {r.inclinationDeg.toFixed(1)}° · {tr('Excentricidad', 'Eccentricity')}: {r.eccentricity.toFixed(3)}
                </p>
              </div>
            ))}

            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-2.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-cyan-200">
                {tr('Cómo leer esta animación', 'How to read this animation')}
              </div>
              <p className="text-[11px] text-cyan-100/90 mt-1 leading-snug">
                {tr(
                  'Cada curva muestra una órbita. Mira altura, inclinación y forma para distinguirla.',
                  'Each curve shows one orbit. Use height, inclination and shape to distinguish it.'
                )}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}