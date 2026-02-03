import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.heat'

export default function HeatLayer({ points, radius = 28, blur = 18, maxZoom = 7 }) {
  const map = useMap()

  useEffect(() => {
    const layer = L.heatLayer(points, {
      radius,
      blur,
      maxZoom,
      minOpacity: 0.35,
    })

    layer.addTo(map)
    return () => {
      try {
        map.removeLayer(layer)
      } catch {
        // ignore
      }
    }
  }, [map, points, radius, blur, maxZoom])

  return null
}
