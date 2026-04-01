import * as satellite from 'satellite.js';

let satrecs = [];
let timer = null;
let tickMs = 67;
let baseGmst = null;

function stopLoop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function toCartesianEcfMeters(satrec, now) {
  const pv = satellite.propagate(satrec, now);
  const eci = pv?.position;
  if (!eci) return null;

  const gmst = Number.isFinite(baseGmst) ? baseGmst : satellite.gstime(now);
  const ecf = satellite.eciToEcf(eci, gmst);
  if (!ecf) return null;

  // satellite.js returns km in ECF. Cesium.Cartesian3 expects meters.
  return {
    x: ecf.x * 1000,
    y: ecf.y * 1000,
    z: ecf.z * 1000
  };
}

function runTick() {
  if (!satrecs.length) return;

  const now = new Date(Date.now());
  const out = new Float64Array(satrecs.length * 3);

  for (let i = 0; i < satrecs.length; i += 1) {
    const satrec = satrecs[i];
    const offset = i * 3;

    if (!satrec) {
      out[offset] = NaN;
      out[offset + 1] = NaN;
      out[offset + 2] = NaN;
      continue;
    }

    try {
      const p = toCartesianEcfMeters(satrec, now);
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
        out[offset] = p.x;
        out[offset + 1] = p.y;
        out[offset + 2] = p.z;
      } else {
        out[offset] = NaN;
        out[offset + 1] = NaN;
        out[offset + 2] = NaN;
      }
    } catch {
      out[offset] = NaN;
      out[offset + 1] = NaN;
      out[offset + 2] = NaN;
    }
  }

  // Transferable object to avoid copying large buffers in main thread.
  self.postMessage(
    {
      type: 'positions',
      timestamp: now.getTime(),
      count: satrecs.length,
      buffer: out.buffer
    },
    [out.buffer]
  );
}

self.onmessage = (event) => {
  const data = event.data || {};

  if (data.type === 'init') {
    const tleArray = Array.isArray(data.tleArray) ? data.tleArray : [];
    const fps = Number.isFinite(data.fps) ? data.fps : 15;
    tickMs = Math.max(50, Math.floor(1000 / Math.max(1, fps)));
    baseGmst = satellite.gstime(new Date(Date.now()));

    satrecs = tleArray.map((item) => {
      const tle1 = item?.tle1 || item?.tleLine1 || item?.TLE_LINE1;
      const tle2 = item?.tle2 || item?.tleLine2 || item?.TLE_LINE2;
      if (!tle1 || !tle2) return null;

      try {
        const satrec = satellite.twoline2satrec(tle1, tle2);
        if (!satrec || satrec.error) return null;
        return satrec;
      } catch {
        return null;
      }
    });

    stopLoop();
    timer = setInterval(runTick, tickMs);
    runTick();
    return;
  }

  if (data.type === 'stop') {
    stopLoop();
    satrecs = [];
    baseGmst = null;
  }
};
