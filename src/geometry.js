function positionPart(token, space) {
  const anchors = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };
  if (token in anchors) return space * anchors[token] || 0;
  if (/^-?[\d.]+%$/.test(token)) return space * parseFloat(token) / 100;
  if (/^-?[\d.]+px$/.test(token)) return parseFloat(token);
  return space * 0.5;
}

export function imagePlacement(width, height, naturalWidth, naturalHeight, fit = 'fill', position = '50% 50%') {
  let sx = width / naturalWidth, sy = height / naturalHeight;
  if (fit !== 'fill') {
    let s = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
    if (fit === 'none') s = 1;
    if (fit === 'scale-down') s = Math.min(1, s);
    sx = sy = s;
  }
  const w = naturalWidth * sx, h = naturalHeight * sy;
  let parts = position.trim().split(/\s+/);
  if (parts.length === 1) parts = /^(top|bottom)$/.test(parts[0]) ? ['center', parts[0]] : [parts[0], 'center'];
  if (/^(top|bottom)$/.test(parts[0]) || /^(left|right)$/.test(parts[1])) parts.reverse();
  // Chrome normally reports two computed components. Handle edge-offset syntax too.
  const offset = (axis, space) => {
    const start = axis === 0 ? 'left' : 'top', end = axis === 0 ? 'right' : 'bottom';
    if (parts.length >= 3) {
      const i = parts.findIndex(x => x === start || x === end);
      if (i >= 0) {
        const extra = parts[i + 1] && !/^(left|right|top|bottom|center)$/.test(parts[i + 1]) ? positionPart(parts[i + 1], space, axis) : 0;
        return parts[i] === end ? space - extra : extra;
      }
    }
    return positionPart(parts[axis] || '50%', space, axis);
  };
  return { x: offset(0, width - w) || 0, y: offset(1, height - h) || 0, width: w, height: h };
}

/** One non-repeating CSS background, in its positioning area. */
export function backgroundPlacement(width, height, naturalWidth, naturalHeight, size = 'auto', position = '50% 50%') {
  if (size === 'cover' || size === 'contain') return imagePlacement(width, height, naturalWidth, naturalHeight, size, position);
  const values = size.split(/\s+/);
  const dimension = (value, total) => !value || value === 'auto' ? null : value.endsWith('%') ? parseFloat(value) * total / 100 : parseFloat(value);
  let w = dimension(values[0], width), h = dimension(values[1], height);
  if (w === null && h === null) { w = naturalWidth; h = naturalHeight; }
  else if (w === null) w = h * naturalWidth / naturalHeight;
  else if (h === null) h = w * naturalHeight / naturalWidth;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return imagePlacement(width, height, w, h, 'none', position);
}

export function intersect(a, b) {
  const left = Math.max(a.left, b.left), top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right), bottom = Math.min(a.bottom, b.bottom);
  return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function faceBounds(points) {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}
