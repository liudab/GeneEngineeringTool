/**
 * Serialize an SVG element to a string suitable for export
 */
export function serializeSvg(svgEl: SVGSVGElement): string {
  const serializer = new XMLSerializer()
  let svgStr = serializer.serializeToString(svgEl)

  // Ensure xmlns is present
  if (!svgStr.includes('xmlns=')) {
    svgStr = svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
  }

  return svgStr
}

/**
 * Convert an SVG element to a PNG data URL using canvas
 * @param svgEl The SVG element to convert
 * @param dpi DPI multiplier (1 = 96dpi, 2 = 192dpi, 3 = 288dpi)
 * @returns Base64 data URL of the PNG
 */
export async function svgToPngDataUrl(svgEl: SVGSVGElement, dpi = 2): Promise<string> {
  const svgStr = serializeSvg(svgEl)
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  return new Promise<string>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const w = (svgEl.viewBox.baseVal.width || svgEl.clientWidth || 960) * dpi
      const h = (svgEl.viewBox.baseVal.height || svgEl.clientHeight || 600) * dpi

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)

      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = (e) => {
      URL.revokeObjectURL(url)
      reject(e)
    }
    img.src = url
  })
}

/**
 * Convert PNG data URL to JPEG format
 */
export async function pngToJpegDataUrl(pngDataUrl: string, quality = 0.92): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = reject
    img.src = pngDataUrl
  })
}

/**
 * Convert PNG data URL to BMP format (via canvas)
 */
export async function pngToBmpDataUrl(pngDataUrl: string): Promise<string> {
  // Canvas doesn't support BMP natively, so we just return PNG
  // The main process will save it as-is with .bmp extension
  return pngDataUrl
}
