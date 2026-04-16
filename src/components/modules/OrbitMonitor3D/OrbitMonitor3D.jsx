import React, { useEffect, useState, useCallback } from 'react';
import { loadCsv, toStringSafe } from '../../../utils/csv.js';
import CesiumGlobe from './CesiumGlobe.jsx';

export default function OrbitMonitor3D() {
  const [debrisList, setDebrisList] = useState([]);

  useEffect(() => {
    let mounted = true;
    loadCsv('/data/debris_orbita.csv', { requiredColumns: ['TLE_LINE1', 'TLE_LINE2'] })
      .then((rows) => {
        if (!mounted) return;
        const tleArray = rows
          .map((r) => {
            const tle1 = toStringSafe(r.TLE_LINE1);
            const tle2 = toStringSafe(r.TLE_LINE2);
            if (!tle1 || !tle2) return null;
            // Pasar objeto completo con todos los campos del CSV
            return {
              tle1,
              tle2,
              OBJECT_NAME: toStringSafe(r.OBJECT_NAME),
              NORAD_CAT_ID: toStringSafe(r.NORAD_CAT_ID),
              OBJECT_TYPE: toStringSafe(r.OBJECT_TYPE),
              COUNTRY_CODE: toStringSafe(r.COUNTRY_CODE),
              EPOCH: toStringSafe(r.EPOCH),
              DECAY_DATE: toStringSafe(r.DECAY_DATE),
              RCS_SIZE: toStringSafe(r.RCS_SIZE),
              ...r // Pasar todos los otros campos por si acaso
            };
          })
          .filter(Boolean);
        setDebrisList(tleArray);
      });
    return () => { mounted = false; };
  }, []);

  // Callback para selección de debris
  const handleDebrisSelect = useCallback((debris) => {
    // Aquí puedes despachar a un contexto global, actualizar paneles, etc.
    // Por ahora solo loguea:
    console.log('Debris seleccionado:', debris);
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#02040a' }}>
      <CesiumGlobe debrisList={debrisList} onDebrisSelect={handleDebrisSelect} />
    </div>
  );
}
