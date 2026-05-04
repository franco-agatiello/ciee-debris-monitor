
import React, { useEffect, useState, useCallback } from 'react';
import { loadCsv, toStringSafe } from '../../../utils/csv.js';
import CesiumGlobe from './CesiumGlobe.jsx';
import { AnimatePresence, motion } from 'framer-motion';
import { useI18n } from '../../../i18n/I18nProvider.jsx';


export default function OrbitMonitor3D() {
  const [debrisList, setDebrisList] = useState([]);
  const [legalAck, setLegalAck] = useState(false);
  const { tr } = useI18n();

  useEffect(() => {
    let mounted = true;
    loadCsv('/data/debris_orbita.csv', {
      requiredColumns: ['TLE_LINE1', 'TLE_LINE2'],
      forceReload: true
    })
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

      {/* Modal de aviso legal */}
      <AnimatePresence>
        {!legalAck && (
          <motion.div
            className="fixed z-[99999] flex justify-center items-center inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.button
              type="button"
              aria-label={tr('Cerrar', 'Close')}
              className="absolute inset-0 bg-black/70"
              onClick={() => setLegalAck(true)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              className="relative w-full max-w-2xl bg-neutral-800/80 backdrop-blur-xl border border-white/10 rounded-2xl p-5 shadow-2xl"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-xs font-bold uppercase tracking-widest text-gray-300">
                  {tr('AVISO LEGAL', 'LEGAL NOTICE')}
                </div>
              </div>
              <div className="mt-4">
                <div className="text-lg font-extrabold text-white/90 mb-2">{tr('ADVERTENCIA', 'WARNING')}</div>
                <div className="text-sm text-white/80 leading-relaxed text-justify">
                  {tr(
                    'La información provista por MIRA se basa en modelos de predicción, análisis orbital y procesamiento de datos abiertos como ESA, Space-Track, NASA y CelesTrak. En consecuencia, puede contener márgenes de error, incertidumbre o variaciones propias de la dinámica del entorno espacial.\nEste sitio no constituye un sistema oficial de alerta ni reemplaza comunicaciones de autoridades competentes. En ningún caso la información aquí contenida debe interpretarse como asesoramiento técnico, legal u operativo.',
                    'The information provided by MIRA is based on prediction models, orbital analysis, and processing of open data such as ESA, Space-Track, NASA, and CelesTrak. As a result, it may contain margins of error, uncertainty, or variations inherent to the dynamics of the space environment.\nThis site does not constitute an official alert system nor does it replace communications from competent authorities. Under no circumstances should the information contained herein be interpreted as technical, legal, or operational advice.'
                  )}
                </div>
                <div className="mt-5 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => setLegalAck(true)}
                    className="px-4 py-2 rounded-xl border text-sm font-extrabold transition bg-white/10 border-white/20 hover:bg-white/15"
                  >
                    {tr('Entendido', 'Acknowledge')}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
