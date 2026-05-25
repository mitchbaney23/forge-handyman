// Client-side image compression. Resizes oversized images down to a max
// dimension on the long edge and re-encodes as JPEG at the given quality.
// HEIC files are passed through unchanged because browsers can't decode them
// in <img>; they'll upload as-is and the server-side max-size check applies.

const MAX_DIMENSION = 1920
const JPEG_QUALITY = 0.82

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode image'))
    img.src = URL.createObjectURL(file)
  })
}

function scaleToFit(
  w: number,
  h: number,
  max: number,
): { width: number; height: number } {
  if (w <= max && h <= max) return { width: w, height: h }
  const scale = max / Math.max(w, h)
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

export async function compressIfNeeded(file: File): Promise<File> {
  // Skip HEIC/HEIF — browsers can't decode them in <img>.
  if (/^image\/(heic|heif)$/i.test(file.type)) return file
  // Tiny files: skip the round-trip.
  if (file.size < 200 * 1024) return file

  try {
    const img = await loadImage(file)
    const { width, height } = scaleToFit(
      img.naturalWidth,
      img.naturalHeight,
      MAX_DIMENSION,
    )
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, width, height)
    URL.revokeObjectURL(img.src)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    )
    if (!blob) return file
    // Only use the compressed version if it's actually smaller.
    if (blob.size >= file.size) return file

    const baseName = file.name.replace(/\.(png|webp|heic|heif|gif|bmp|tiff?)$/i, '')
    return new File([blob], `${baseName || 'photo'}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    })
  } catch {
    // Any decode/resize failure: just upload the original.
    return file
  }
}
