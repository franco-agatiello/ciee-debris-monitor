import * as satellite from 'satellite.js';
import { Cartesian3 } from 'cesium';

// Procesa un par de líneas TLE y retorna el objeto satrec
export function parseTLE(tleLine1, tleLine2) {
  return satellite.twoline2satrec(tleLine1, tleLine2);
}

// Propaga la posición a una fecha dada y retorna Cesium.Cartesian3
export function propagateToCartesian3(satrec, date) {
  // Propagación SGP4
  const positionAndVelocity = satellite.propagate(satrec, date);
  const positionEci = positionAndVelocity.position;
  if (!positionEci) return null; // chequeo agregado

  // Convertir a lat/lon/alt
  const gmst = satellite.gstime(date);
  const geodetic = satellite.eciToGeodetic(positionEci, gmst);

  // Cesium espera radianes y metros
  const lon = geodetic.longitude;
  const lat = geodetic.latitude;
  const alt = geodetic.height * 1000; // km a metros

  return Cartesian3.fromRadians(lon, lat, alt);
}
