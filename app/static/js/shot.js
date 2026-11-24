/* Screenshot editor: crop, annotations, export. */
const Shot = {
  base: null, original: null, shapes: [], selected: null, tool: "move",
  stage: "crop", crop: null, zoom: 1, drag: null,
  start: null, preview: null, color: "#ff4d4f", width: 3,
  name: "ogranka-shot", title: "Скриншот", subtitle: "",
  history: [], future: [], textEdit: null,
};

function shotHint(text) {
  const hint = $("shotHint");
  if (hint) hint.textContent = text;
}

function shotTextLines(shape) {
  return String(shape.text || "").split("\n");
}

function shotTextMetrics(shape) {
  const canvas = $("shotCanvas");
  const ctx = canvas ? canvas.getContext("2d") : null;
  const fontSize = Math.max(10, shape.fontSize || 18);
  const lines = shotTextLines(shape);
  const widths = lines.map((line) => {
    if (!ctx) return Math.max(1, line.length) * fontSize * 0.55;
    ctx.font = `${fontSize}px system-ui, sans-serif`;
    return ctx.measureText(line || " ").width;
  });
  return {
    w: Math.max(1, ...widths),
    h: Math.max(1, lines.length * fontSize * 1.25),
    fontSize,
  };
}

function shotShapeBounds(shape) {
  if (!shape) return null;
  if (shape.tool === "text") {
    const metrics = shotTextMetrics(shape);
    return { x: shape.start.x, y: shape.start.y, w: metrics.w, h: metrics.h };
  }
  if (shape.tool === "marker" && shape.points && shape.points.length) {
    const xs = shape.points.map((point) => point.x);
    const ys = shape.points.map((point) => point.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return { x: left, y: top, w: Math.max(1, Math.max(...xs) - left), h: Math.max(1, Math.max(...ys) - top) };
  }
  const x = Math.min(shape.start.x, shape.end.x);
  const y = Math.min(shape.start.y, shape.end.y);
  return {
    x, y,
    w: Math.max(1, Math.abs(shape.end.x - shape.start.x)),
    h: Math.max(1, Math.abs(shape.end.y - shape.start.y)),
  };
}

function shotShapeCenter(shape) {
  const b = shotShapeBounds(shape);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

function shotRotatePoint(point, center, angle) {
  if (!angle) return { x: point.x, y: point.y };
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

function shotRotateVector(vector, angle) {
  if (!angle) return { x: vector.x, y: vector.y };
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: vector.x * cos - vector.y * sin, y: vector.x * sin + vector.y * cos };
}

const SHOT_ROTATE_CURSOR = (() => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">'
    + '<path d="M9 11a8 8 0 1 1-1.4 7.2" fill="none" stroke="#ffffff" stroke-width="4.5"/>'
    + '<path d="M9 11a8 8 0 1 1-1.4 7.2" fill="none" stroke="#141414" stroke-width="2"/>'
    + '<path d="M9 6.4 9 11 4.4 11" fill="none" stroke="#ffffff" stroke-width="4.5"/>'
    + '<path d="M9 6.4 9 11 4.4 11" fill="none" stroke="#141414" stroke-width="2"/></svg>';
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 15 15, crosshair`;
})();

function shotCursorForHandle(handle, rotation = 0) {
  if (handle === "rot") return SHOT_ROTATE_CURSOR;
  const base = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
  const angle = ((base[handle] || 0) + rotation * 180 / Math.PI + 360) % 360;
  return ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][Math.round(angle / 45) % 4];
}

function shotCursorAt(point) {
  if (Shot.tool === "text") return "text";
  if (Shot.tool !== "move") return "crosshair";
  const handle = shotShapeHandleAt(point);
  if (handle) return shotCursorForHandle(handle, Shot.selected?.rotation || 0);
  return shotHitShape(point) ? "move" : "grab";
}

function shotDrawShape(ctx, shape) {
  const { tool, start, end, color, width, text } = shape;
  const b = shotShapeBounds(shape);
  const center = shotShapeCenter(shape);
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(shape.rotation || 0);
  ctx.translate(-center.x, -center.y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, width || 1);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (tool === "circle") {
    ctx.beginPath();
    ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (tool === "line" || tool === "arrow") {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    if (tool === "arrow") {
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const size = Math.max(12, width * 4);
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - size * Math.cos(angle - 0.45), end.y - size * Math.sin(angle - 0.45));
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - size * Math.cos(angle + 0.45), end.y - size * Math.sin(angle + 0.45));
      ctx.stroke();
    }
  } else if (tool === "text" && text) {
    const fontSize = Math.max(10, shape.fontSize || 18);
    ctx.font = `${fontSize}px system-ui, sans-serif`;
    ctx.textBaseline = "top";
    shotTextLines(shape).forEach((line, index) => {
      ctx.fillText(line, start.x, start.y + index * fontSize * 1.25);
    });
  } else if (tool === "marker" && shape.points && shape.points.length) {
    ctx.globalAlpha = 0.58;
    ctx.lineWidth = Math.max(6, width * 2.5);
    ctx.beginPath();
    ctx.moveTo(shape.points[0].x, shape.points[0].y);
    shape.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.stroke();
  }
  ctx.restore();
}

function shotDrawCropFrame(ctx, width, height) {
  const crop = shotNormalizeCrop(Shot.crop || { x: 0, y: 0, w: width, h: height });
  ctx.save();
  ctx.fillStyle = "rgba(4, 8, 14, 0.64)";
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.rect(crop.x, crop.y, crop.w, crop.h);
  ctx.fill("evenodd");

  ctx.strokeStyle = "#4f8cff";
  ctx.lineWidth = Math.max(2, Math.round(Math.min(width, height) / 500));
  ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);

  ctx.strokeStyle = "rgba(188, 215, 255, 0.38)";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 2; i += 1) {
    const x = crop.x + crop.w * i / 3;
    const y = crop.y + crop.h * i / 3;
    ctx.beginPath();
    ctx.moveTo(x, crop.y);
    ctx.lineTo(x, crop.y + crop.h);
    ctx.moveTo(crop.x, y);
    ctx.lineTo(crop.x + crop.w, y);
    ctx.stroke();
  }

  const size = Math.max(9, Math.min(14, Math.round(Math.min(width, height) / 70)));
  const points = [
    [crop.x, crop.y], [crop.x + crop.w / 2, crop.y], [crop.x + crop.w, crop.y],
    [crop.x, crop.y + crop.h / 2], [crop.x + crop.w, crop.y + crop.h / 2],
    [crop.x, crop.y + crop.h], [crop.x + crop.w / 2, crop.y + crop.h], [crop.x + crop.w, crop.y + crop.h],
  ];
  ctx.fillStyle = "#e4efff";
  ctx.strokeStyle = "#2f6fd0";
  ctx.lineWidth = 1.5;
  points.forEach(([x, y]) => {
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
    ctx.strokeRect(x - size / 2, y - size / 2, size, size);
  });

  const label = `${Math.round(crop.w)} × ${Math.round(crop.h)}`;
  ctx.font = "600 14px system-ui, sans-serif";
  const textWidth = ctx.measureText(label).width;
  let labelY = crop.y - 8;
  if (labelY < 20) labelY = crop.y + 23;
  const labelX = Math.min(width - textWidth - 18, Math.max(8, crop.x + 4));
  ctx.fillStyle = "rgba(8, 14, 24, 0.82)";
  ctx.fillRect(labelX - 6, labelY - 14, textWidth + 12, 20);
  ctx.fillStyle = "#dce9ff";
  ctx.textBaseline = "middle";
  ctx.fillText(label, labelX, labelY);
  ctx.restore();
}

function shotDrawSelection(ctx) {
  const shape = Shot.selected;
  if (!shape) return;
  const b = shotShapeBounds(shape);
  const center = shotShapeCenter(shape);
  const size = Math.max(8, Math.min(12, Math.round(Math.min(b.w, b.h) / 5)));
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(shape.rotation || 0);
  ctx.translate(-center.x, -center.y);
  ctx.strokeStyle = "#65a3ff";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.setLineDash([]);
  const points = [
    [b.x, b.y], [b.x + b.w / 2, b.y], [b.x + b.w, b.y],
    [b.x, b.y + b.h / 2], [b.x + b.w, b.y + b.h / 2],
    [b.x, b.y + b.h], [b.x + b.w / 2, b.y + b.h], [b.x + b.w, b.y + b.h],
  ];
  ctx.fillStyle = "#f4f9ff";
  ctx.strokeStyle = "#2f6fd0";
  ctx.lineWidth = 1.5;
  points.forEach(([x, y]) => {
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
    ctx.strokeRect(x - size / 2, y - size / 2, size, size);
  });
  const rotY = b.y - 28;
  ctx.beginPath();
  ctx.moveTo(center.x, b.y);
  ctx.lineTo(center.x, rotY);
  ctx.strokeStyle = "#65a3ff";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(center.x, rotY, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#4f8cff";
  ctx.fill();
  ctx.strokeStyle = "#dce9ff";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function shotDraw() {
  const canvas = $("shotCanvas");
  if (!canvas || !Shot.base) return;
  const width = Shot.base.width || Shot.base.naturalWidth;
  const height = Shot.base.height || Shot.base.naturalHeight;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(Shot.base, 0, 0);
  if (Shot.stage === "crop") {
    shotDrawCropFrame(ctx, canvas.width, canvas.height);
    return;
  }
  Shot.shapes.forEach((shape) => {
    if (Shot.textEdit && shape === Shot.textEdit.shape) return;
    shotDrawShape(ctx, shape);
  });
  if (Shot.preview) shotDrawShape(ctx, Shot.preview);
  shotDrawSelection(ctx);
}

function shotSetZoom(value) {
  const canvas = $("shotCanvas");
  if (!canvas || !Shot.base) return;
  const stage = $("shotStage");
  const oldWidth = canvas.getBoundingClientRect().width || 1;
  const oldHeight = canvas.getBoundingClientRect().height || 1;
  const ratioX = (stage.scrollLeft + stage.clientWidth / 2) / oldWidth;
  const ratioY = (stage.scrollTop + stage.clientHeight / 2) / oldHeight;
  const availW = Math.max(220, stage.clientWidth - 44);
  const panelHeight = $("shotPanel")?.offsetHeight || 142;
  const availH = Math.max(180, stage.clientHeight - panelHeight - 34);
  const fit = Math.min(canvas.width, availW, availH * canvas.width / Math.max(1, canvas.height));
  Shot.zoom = Math.max(0.25, Math.min(4, value));
  canvas.style.width = `${Math.max(80, Math.round(fit * Shot.zoom))}px`;
  canvas.style.height = "auto";
  canvas.style.maxWidth = "none";
  const label = $("shotZoomValue");
  if (label) label.textContent = `${Math.round(Shot.zoom * 100)}%`;
  requestAnimationFrame(() => {
    stage.scrollLeft = ratioX * canvas.getBoundingClientRect().width - stage.clientWidth / 2;
    stage.scrollTop = ratioY * canvas.getBoundingClientRect().height - stage.clientHeight / 2;
  });
}

function shotZoomBy(factor) {
  shotSetZoom(Shot.zoom * factor);
}

function shotSetTool(tool) {
  Shot.tool = tool;
  document.querySelectorAll(".shot-tool").forEach((button) => {
    button.classList.toggle("active", button.dataset.shotTool === tool);
  });
  if (tool !== "move") {
    Shot.selected = null;
    shotDraw();
  }
  const canvas = $("shotCanvas");
  if (canvas) canvas.style.cursor = tool === "move" ? "grab" : tool === "text" ? "text" : "crosshair";
}

function shotSetStage(stage) {
  Shot.stage = stage;
  $("shotCropTools").classList.toggle("hidden", stage !== "crop");
  $("shotEditTools").classList.toggle("hidden", stage !== "edit");
  const subtitle = $("shotSubtitle");
  if (subtitle) subtitle.textContent = stage === "crop" ? "Выберите область" : "Пометки: перетаскивание, ресайз, поворот";
  shotHint(stage === "crop"
    ? "Потяните за рамку или углы. «Всё окно» — без обрезки."
    : "Кликните по пометке, чтобы выбрать. Enter — сохранить, Esc — закрыть.");
  if (stage === "edit") shotSetTool("move");
  const canvas = $("shotCanvas");
  if (canvas) canvas.style.cursor = stage === "crop" ? "crosshair" : "default";
  requestAnimationFrame(() => shotSetZoom(Shot.zoom));
}

function shotPoint(event) {
  const canvas = $("shotCanvas");
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * canvas.width / rect.width,
    y: (event.clientY - rect.top) * canvas.height / rect.height,
  };
}

function shotNormalizeCrop(rect) {
  const maxW = Shot.base?.width || 1;
  const maxH = Shot.base?.height || 1;
  let left = Math.min(rect.x, rect.x + rect.w);
  let top = Math.min(rect.y, rect.y + rect.h);
  let right = Math.max(rect.x, rect.x + rect.w);
  let bottom = Math.max(rect.y, rect.y + rect.h);
  left = Math.max(0, Math.min(left, maxW));
  top = Math.max(0, Math.min(top, maxH));
  right = Math.max(0, Math.min(right, maxW));
  bottom = Math.max(0, Math.min(bottom, maxH));
  return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
}

function shotApplyCrop() {
  if (!Shot.base) return;
  const crop = shotNormalizeCrop(Shot.crop || { x: 0, y: 0, w: Shot.base.width, h: Shot.base.height });
  if (crop.w < 8 || crop.h < 8) {
    shotHint("Слишком маленькая область: выделите кроп заново.");
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.w));
  canvas.height = Math.max(1, Math.round(crop.h));
  canvas.getContext("2d").drawImage(
    Shot.base, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height,
  );
  Shot.base = canvas;
  Shot.original = canvas;
  Shot.shapes = [];
  Shot.selected = null;
  Shot.preview = null;
  Shot.start = null;
  Shot.drag = null;
  Shot.crop = null;
  Shot.zoom = 1;
  shotSetStage("edit");
  shotDraw();
}

function shotUseFull() {
  if (!Shot.base) return;
  Shot.crop = { x: 0, y: 0, w: Shot.base.width, h: Shot.base.height };
  shotApplyCrop();
}

function shotCropHandleAt(point) {
  if (!Shot.base) return "";
  const crop = shotNormalizeCrop(Shot.crop || { x: 0, y: 0, w: Shot.base.width, h: Shot.base.height });
  const canvas = $("shotCanvas");
  const tolerance = Math.max(10, 16 * canvas.width / Math.max(1, canvas.getBoundingClientRect().width));
  const midX = crop.x + crop.w / 2;
  const midY = crop.y + crop.h / 2;
  const handles = [
    ["nw", crop.x, crop.y], ["n", midX, crop.y], ["ne", crop.x + crop.w, crop.y],
    ["w", crop.x, midY], ["e", crop.x + crop.w, midY],
    ["sw", crop.x, crop.y + crop.h], ["s", midX, crop.y + crop.h], ["se", crop.x + crop.w, crop.y + crop.h],
  ];
  for (const [name, x, y] of handles) {
    if (Math.abs(point.x - x) <= tolerance && Math.abs(point.y - y) <= tolerance) return name;
  }
  return "";
}

function shotUpdateCrop(point) {
  const drag = Shot.drag;
  if (!drag) return;
  if (drag.mode === "crop-new") {
    const left = Math.min(drag.start.x, point.x);
    const top = Math.min(drag.start.y, point.y);
    Shot.crop = shotNormalizeCrop({
      x: left, y: top, w: Math.abs(point.x - drag.start.x), h: Math.abs(point.y - drag.start.y),
    });
    return;
  }
  const start = drag.crop;
  if (drag.mode === "crop-move") {
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    const x = Math.max(0, Math.min(start.x + dx, Shot.base.width - start.w));
    const y = Math.max(0, Math.min(start.y + dy, Shot.base.height - start.h));
    Shot.crop = { x, y, w: start.w, h: start.h };
    return;
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (drag.handle.includes("w")) left = point.x;
  if (drag.handle.includes("e")) right = point.x;
  if (drag.handle.includes("n")) top = point.y;
  if (drag.handle.includes("s")) bottom = point.y;
  left = Math.max(0, Math.min(left, Shot.base.width));
  right = Math.max(0, Math.min(right, Shot.base.width));
  top = Math.max(0, Math.min(top, Shot.base.height));
  bottom = Math.max(0, Math.min(bottom, Shot.base.height));
  if (right - left < 8) {
    if (drag.handle.includes("w")) left = Math.max(0, right - 8);
    else right = Math.min(Shot.base.width, left + 8);
  }
  if (bottom - top < 8) {
    if (drag.handle.includes("n")) top = Math.max(0, bottom - 8);
    else bottom = Math.min(Shot.base.height, top + 8);
  }
  Shot.crop = { x: left, y: top, w: right - left, h: bottom - top };
}

function shotShapeHandleAt(point) {
  const shape = Shot.selected;
  if (!shape) return "";
  const b = shotShapeBounds(shape);
  const center = shotShapeCenter(shape);
  const local = shotRotatePoint(point, center, -(shape.rotation || 0));
  const canvas = $("shotCanvas");
  const tolerance = Math.max(9, 14 * canvas.width / Math.max(1, canvas.getBoundingClientRect().width));
  const handles = [
    ["nw", b.x, b.y], ["n", b.x + b.w / 2, b.y], ["ne", b.x + b.w, b.y],
    ["w", b.x, b.y + b.h / 2], ["e", b.x + b.w, b.y + b.h / 2],
    ["sw", b.x, b.y + b.h], ["s", b.x + b.w / 2, b.y + b.h], ["se", b.x + b.w, b.y + b.h],
    ["rot", b.x + b.w / 2, b.y - 28],
  ];
  for (const [name, x, y] of handles) {
    if (Math.abs(local.x - x) <= tolerance && Math.abs(local.y - y) <= tolerance) return name;
  }
  return "";
}

function shotHitShape(point) {
  for (let i = Shot.shapes.length - 1; i >= 0; i -= 1) {
    const shape = Shot.shapes[i];
    const b = shotShapeBounds(shape);
    const center = shotShapeCenter(shape);
    const local = shotRotatePoint(point, center, -(shape.rotation || 0));
    if (local.x >= b.x - 5 && local.x <= b.x + b.w + 5
      && local.y >= b.y - 5 && local.y <= b.y + b.h + 5) {
      return shape;
    }
  }
  return null;
}

function shotResizeShape(point) {
  const drag = Shot.drag;
  const shape = drag.shape;
  const old = drag.bounds;
  const rotation = shape.rotation || 0;
  const anchor = drag.anchorWorld;
  const handle = drag.handle;
  const rel = shotRotateVector({ x: point.x - anchor.x, y: point.y - anchor.y }, -rotation);
  let width = old.w;
  let height = old.h;
  if (handle.includes("e")) width = Math.max(8, rel.x);
  if (handle.includes("w")) width = Math.max(8, -rel.x);
  if (handle.includes("s")) height = Math.max(8, rel.y);
  if (handle.includes("n")) height = Math.max(8, -rel.y);
  const localX = handle.includes("w") ? -width : 0;
  const localY = handle.includes("n") ? -height : 0;
  const localCenter = { x: localX + width / 2, y: localY + height / 2 };
  const centerWorld = {
    x: anchor.x + shotRotateVector(localCenter, rotation).x,
    y: anchor.y + shotRotateVector(localCenter, rotation).y,
  };
  if (shape.tool === "text") {
    const ratio = handle.includes("e") || handle.includes("w")
      ? (old.w ? width / old.w : 1)
      : (old.h ? height / old.h : 1);
    const fontSize = Math.max(10, (drag.fontSize || 18) * ratio);
    const metrics = shotTextMetrics({ ...shape, fontSize });
    shape.fontSize = fontSize;
    shape.w = metrics.w;
    shape.h = metrics.h;
    shape.start = { x: centerWorld.x - metrics.w / 2, y: centerWorld.y - metrics.h / 2 };
    shape.end = { x: shape.start.x + metrics.w, y: shape.start.y + metrics.h };
    return;
  }
  const sx = old.w ? width / old.w : 1;
  const sy = old.h ? height / old.h : 1;
  const place = (p) => {
    const lx = localX + (p.x - old.x) * sx;
    const ly = localY + (p.y - old.y) * sy;
    return { x: centerWorld.x + lx - localCenter.x, y: centerWorld.y + ly - localCenter.y };
  };
  if (shape.tool === "marker") {
    shape.points = drag.startShape.points.map(place);
  } else {
    shape.start = place(drag.startShape.start);
    shape.end = place(drag.startShape.end);
  }
}

function shotUpdateShapeDrag(point, event) {
  const drag = Shot.drag;
  if (!drag || !drag.shape) return;
  const shape = drag.shape;
  if (drag.mode === "shape-move") {
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    shape.start = { x: drag.startShape.start.x + dx, y: drag.startShape.start.y + dy };
    if (shape.tool === "text") {
      shape.w = drag.startShape.w;
      shape.h = drag.startShape.h;
    } else if (shape.tool === "marker") {
      shape.points = drag.startShape.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    } else {
      shape.end = { x: drag.startShape.end.x + dx, y: drag.startShape.end.y + dy };
    }
    return;
  }
  if (drag.mode === "shape-rotate") {
    const center = shotShapeCenter(shape);
    const angle = Math.atan2(point.y - center.y, point.x - center.x);
    let rotation = drag.rotation + angle - drag.startAngle;
    if (event.shiftKey) rotation = Math.round(rotation / (Math.PI / 12)) * (Math.PI / 12);
    shape.rotation = rotation;
    return;
  }
  if (drag.mode === "shape-resize") shotResizeShape(point);
}

function shotDeleteSelected() {
  if (!Shot.selected) {
    shotHint("Сначала выберите пометку.");
    return;
  }
  shotRemember();
  Shot.shapes = Shot.shapes.filter((shape) => shape !== Shot.selected);
  Shot.selected = null;
  shotDraw();
}

function shotApplyColor(color) {
  Shot.color = color;
  const picker = $("shotColor");
  if (picker) picker.value = color;
  document.querySelectorAll(".shot-swatch").forEach((swatch) => {
    swatch.classList.toggle("active", swatch.dataset.shotColor.toLowerCase() === color.toLowerCase());
  });
  if (Shot.selected) {
    shotRemember();
    Shot.selected.color = color;
    shotDraw();
  }
}

function shotShapeSnapshot(shape) {
  return {
    start: { ...shape.start },
    end: shape.end ? { ...shape.end } : { ...shape.start },
    points: shape.points ? shape.points.map((p) => ({ ...p })) : null,
    w: shape.w, h: shape.h, fontSize: shape.fontSize,
    text: shape.text, rotation: shape.rotation || 0,
  };
}

function shotSnapshot() {
  return Shot.shapes.map((shape) => JSON.parse(JSON.stringify(shape)));
}

function shotSyncHistory() {
  const undo = $("shotUndo");
  const redo = $("shotRedo");
  if (undo) undo.disabled = Shot.history.length === 0;
  if (redo) redo.disabled = Shot.future.length === 0;
}

function shotPushSnapshot(snapshot) {
  if (!snapshot) return;
  Shot.history.push(snapshot);
  if (Shot.history.length > 60) Shot.history.shift();
  Shot.future = [];
  shotSyncHistory();
}

function shotRemember() {
  shotPushSnapshot(shotSnapshot());
}

function shotRestore(snapshot) {
  Shot.shapes = snapshot.map((shape) => JSON.parse(JSON.stringify(shape)));
  Shot.selected = null;
  Shot.preview = null;
  Shot.drag = null;
  shotDraw();
  shotSyncHistory();
}

function shotUndo() {
  if (Shot.textEdit) shotCommitText();
  if (!Shot.history.length) return;
  Shot.future.push(shotSnapshot());
  shotRestore(Shot.history.pop());
}

function shotRedo() {
  if (Shot.textEdit) shotCommitText();
  if (!Shot.future.length) return;
  Shot.history.push(shotSnapshot());
  shotRestore(Shot.future.pop());
}

function shotTextEditorPosition(shape) {
  const canvas = $("shotCanvas");
  const input = $("shotTextInput");
  if (!canvas || !input) return;
  const rect = canvas.getBoundingClientRect();
  const scale = rect.width / Math.max(1, canvas.width);
  const bounds = shotShapeBounds(shape);
  input.style.left = `${rect.left + bounds.x * scale}px`;
  input.style.top = `${rect.top + bounds.y * scale}px`;
  input.style.fontSize = `${Math.max(10, shape.fontSize || 18) * scale}px`;
  input.style.color = shape.color || "#ffffff";
  input.style.width = "0px";
  input.style.height = "0px";
  input.style.width = `${Math.max(26, input.scrollWidth + 8)}px`;
  input.style.height = `${Math.max(input.scrollHeight + 4, (shape.fontSize || 18) * scale * 1.25)}px`;
}

function shotStartText(point, shape = null) {
  shotCommitText();
  const fontSize = Math.max(20, Math.round((Shot.base?.width || 960) / 40));
  const target = shape || {
    tool: "text", start: { ...point }, end: { ...point }, w: 24, h: fontSize * 1.25,
    fontSize, color: Shot.color, width: Shot.width, text: "", rotation: 0,
  };
  shotRemember();
  if (!shape) Shot.shapes.push(target);
  Shot.selected = target;
  const input = $("shotTextInput");
  if (!input) return;
  Shot.textEdit = { shape: target, isNew: !shape };
  input.value = target.text || "";
  input.classList.remove("hidden");
  shotTextEditorPosition(target);
  shotDraw();
  requestAnimationFrame(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

function shotUpdateText(value) {
  const edit = Shot.textEdit;
  if (!edit) return;
  edit.shape.text = value;
  const metrics = shotTextMetrics(edit.shape);
  edit.shape.w = metrics.w;
  edit.shape.h = metrics.h;
  edit.shape.end = { x: edit.shape.start.x + metrics.w, y: edit.shape.start.y + metrics.h };
  shotTextEditorPosition(edit.shape);
  shotDraw();
}

function shotCommitText(cancel = false) {
  const edit = Shot.textEdit;
  if (!edit) return;
  const input = $("shotTextInput");
  const shape = edit.shape;
  Shot.textEdit = null;
  if (input) {
    input.classList.add("hidden");
    input.value = "";
  }
  const blank = !String(shape.text || "").trim();
  if (cancel || blank) {
    Shot.shapes = Shot.shapes.filter((item) => item !== shape);
    Shot.selected = null;
    if (edit.isNew) {
      Shot.history.pop();
      shotSyncHistory();
    } else if (!blank) {
      shotRestore(Shot.history.pop());
    }
  } else {
    const metrics = shotTextMetrics(shape);
    shape.w = metrics.w;
    shape.h = metrics.h;
    shape.end = { x: shape.start.x + metrics.w, y: shape.start.y + metrics.h };
  }
  shotDraw();
}

function loadShotImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function shotScreenData() {
  if (window.pywebview?.api?.capture_screen) {
    const result = await window.pywebview.api.capture_screen();
    if (result?.data) return result.data;
    if (result?.error) throw new Error(result.error);
  }
  if (navigator.mediaDevices?.getDisplayMedia) {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    try {
      const video = document.createElement("video");
      video.srcObject = stream;
      await new Promise((resolve) => {
        video.onloadedmetadata = resolve;
        setTimeout(resolve, 1500);
      });
      await video.play();
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      canvas.getContext("2d").drawImage(video, 0, 0);
      return canvas.toDataURL("image/png");
    } finally {
      stream.getTracks().forEach((track) => track.stop());
    }
  }
  throw new Error("Захват экрана недоступен.");
}

function shotAppRect(image, rect = null) {
  const dpr = window.devicePixelRatio || 1;
  let x;
  let y;
  let w;
  let h;
  if (rect && Number(rect.width) > 0 && Number(rect.height) > 0) {
    x = Math.round(Number(rect.x) * dpr);
    y = Math.round(Number(rect.y) * dpr);
    w = Math.round(Number(rect.width) * dpr);
    h = Math.round(Number(rect.height) * dpr);
  } else {
    const screenX = Number(window.screenX ?? window.screenLeft ?? 0) || 0;
    const screenY = Number(window.screenY ?? window.screenTop ?? 0) || 0;
    const chrome = Math.max(0, (window.outerHeight || window.innerHeight) - window.innerHeight);
    x = Math.round(screenX * dpr);
    y = Math.round((screenY + chrome) * dpr);
    w = Math.round(window.innerWidth * dpr);
    h = Math.round(window.innerHeight * dpr);
  }
  if (w < 100 || h < 100 || x < 0 || y < 0 || x >= image.naturalWidth || y >= image.naturalHeight) {
    return { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight };
  }
  w = Math.min(w, image.naturalWidth - x);
  h = Math.min(h, image.naturalHeight - y);
  return { x, y, w, h };
}

async function startAppShot() {
  if (!$("shotLayer").classList.contains("hidden")) return;
  if (typeof closeViewerShotMenus === "function") closeViewerShotMenus();
  $("statusText").textContent = "Готовлю скриншот приложения…";
  try {
    const api = window.pywebview?.api;
    const isMac = /Mac/i.test(navigator.platform || navigator.userAgent || "");
    let native = null;
    if (api?.capture_app) {
      native = await api.capture_app();
      if (native?.data) {
        const image = await loadShotImage(native.data);
        openShotEditor(image, {
          title: "Скриншот приложения",
          subtitle: "Окно Огранки",
          name: "ogranka-app",
        });
        $("statusText").textContent = "Скриншот готов";
        return;
      }
      if (native?.error) throw new Error(native.error);
    }
    if (isMac) {
      throw new Error("Нативный захват окна недоступен.");
    }
    let windowRect = null;
    if (api?.window_rect) {
      try {
        windowRect = await api.window_rect();
      } catch (error) {
        windowRect = null;
      }
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const image = await loadShotImage(await shotScreenData());
    const rect = shotAppRect(image, windowRect);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rect.w));
    canvas.height = Math.max(1, Math.round(rect.h));
    canvas.getContext("2d").drawImage(
      image, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height,
    );
    openShotEditor(canvas, {
      title: "Скриншот приложения",
      subtitle: "Окно Огранки",
      name: "ogranka-app",
    });
    $("statusText").textContent = "Скриншот готов";
  } catch (error) {
    $("statusText").textContent = "Не удалось сделать скриншот";
    alert("Не удалось сделать скриншот: " + String(error.message || error));
  }
}

async function startViewportShot(viewer = activeViewer()) {
  if (!$("shotLayer").classList.contains("hidden")) return;
  if (!viewer || !viewer.renderer) return;
  if (typeof closeViewerShotMenus === "function") closeViewerShotMenus();
  setActiveViewer(viewer);
  $("statusText").textContent = "Готовлю скриншот вьюпорта…";
  try {
    const image = await loadShotImage(viewer.snapshot());
    openShotEditor(image, {
      title: "Скриншот вьюпорта",
      subtitle: "3D-область",
      name: exportBase(viewer),
    });
    $("statusText").textContent = "Скриншот готов";
  } catch (error) {
    $("statusText").textContent = "Не удалось сделать скриншот";
    alert("Не удалось сделать скриншот: " + String(error.message || error));
  }
}

function openShotEditor(image, meta = {}) {
  Shot.base = image;
  Shot.original = image;
  Shot.shapes = [];
  Shot.history = [];
  Shot.future = [];
  Shot.textEdit = null;
  $("shotTextInput")?.classList.add("hidden");
  Shot.selected = null;
  Shot.preview = null;
  Shot.start = null;
  Shot.drag = null;
  Shot.zoom = 1;
  Shot.crop = { x: 0, y: 0, w: image.naturalWidth || image.width, h: image.naturalHeight || image.height };
  Shot.name = meta.name || "ogranka-shot";
  Shot.title = meta.title || "Скриншот";
  $("shotTitle").textContent = Shot.title;
  $("shotLayer").classList.remove("hidden");
  document.body.classList.add("shot-open");
  shotSetStage("crop");
  shotDraw();
  requestAnimationFrame(() => shotSetZoom(1));
}

function closeShot() {
  if (Shot.textEdit) shotCommitText();
  $("shotLayer").classList.add("hidden");
  document.body.classList.remove("shot-open");
  Shot.drag = null;
  Shot.start = null;
  Shot.preview = null;
}

async function saveShot() {
  if (Shot.textEdit) shotCommitText();
  const canvas = $("shotCanvas");
  if (!canvas || !Shot.base) return;
  if (Shot.stage === "crop") {
    shotApplyCrop();
    if (Shot.stage === "crop") return;
  }
  const dataUrl = canvas.toDataURL("image/png");
  const name = Shot.name + "-" + Date.now() + ".png";
  shotHint("Сохраняю…");
  try {
    if (window.pywebview?.api?.save_png) {
      const result = await window.pywebview.api.save_png(dataUrl, name);
      if (result?.path) {
        $("statusText").textContent = "PNG сохранён";
        $("statusText").title = result.path;
        closeShot();
        return;
      }
      if (result?.cancelled) {
        shotHint("Сохранение отменено.");
        return;
      }
      if (result?.error) throw new Error(result.error);
    }
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = name;
    link.click();
    $("statusText").textContent = "PNG скачан в загрузки";
    closeShot();
  } catch (error) {
    shotHint("Не удалось сохранить PNG: " + String(error.message || error));
  }
}

function initShotEditor() {
  $("shotClose").onclick = () => closeShot();
  $("shotColor").oninput = () => shotApplyColor($("shotColor").value);
  document.querySelectorAll(".shot-swatch").forEach((swatch) => {
    swatch.onclick = () => shotApplyColor(swatch.dataset.shotColor);
  });
  document.querySelectorAll(".shot-tool").forEach((button) => {
    button.onclick = () => shotSetTool(button.dataset.shotTool);
  });
  $("shotWidth").oninput = () => {
    Shot.width = Number($("shotWidth").value) || 3;
    if (Shot.selected) {
      shotRemember();
      Shot.selected.width = Shot.width;
      shotDraw();
    }
  };
  $("shotUndo").onclick = () => shotUndo();
  $("shotRedo").onclick = () => shotRedo();
  $("shotDelete").onclick = () => shotDeleteSelected();
  const textInput = $("shotTextInput");
  if (textInput) {
    textInput.addEventListener("input", () => shotUpdateText(textInput.value));
    textInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        shotCommitText(true);
      } else if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        shotCommitText();
      } else if (event.key === "Enter") {
        event.stopPropagation();
      }
    });
    textInput.addEventListener("blur", () => shotCommitText());
  }
  $("shotSave").onclick = () => saveShot();
  $("shotCropAll").onclick = () => shotUseFull();
  $("shotCropApply").onclick = () => shotApplyCrop();
  $("shotZoomOut").onclick = () => shotZoomBy(1 / 1.15);
  $("shotZoomIn").onclick = () => shotZoomBy(1.15);
  const canvas = $("shotCanvas");
  canvas.addEventListener("wheel", (event) => {
    if (!Shot.base) return;
    event.preventDefault();
    shotZoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });
  canvas.onpointerdown = (event) => {
    if (!Shot.base) return;
    const point = shotPoint(event);
    if (Shot.stage === "crop") {
      const crop = shotNormalizeCrop(Shot.crop || { x: 0, y: 0, w: Shot.base.width, h: Shot.base.height });
      const handle = shotCropHandleAt(point);
      const isFull = crop.w >= Shot.base.width - 1 && crop.h >= Shot.base.height - 1;
      if (handle) {
        Shot.drag = { mode: "crop-resize", handle, start: point, crop };
      } else if (!isFull && point.x >= crop.x && point.x <= crop.x + crop.w
        && point.y >= crop.y && point.y <= crop.y + crop.h) {
        Shot.drag = { mode: "crop-move", start: point, crop };
      } else {
        Shot.crop = { x: point.x, y: point.y, w: 0, h: 0 };
        Shot.drag = { mode: "crop-new", start: point };
      }
      canvas.setPointerCapture(event.pointerId);
      shotDraw();
      return;
    }
    if (Shot.tool === "move") {
      const handle = shotShapeHandleAt(point);
      if (handle && Shot.selected) {
        const shape = Shot.selected;
        const center = shotShapeCenter(shape);
        if (handle === "rot") {
          Shot.drag = {
            mode: "shape-rotate", shape, start: point,
            rotation: shape.rotation || 0,
            startAngle: Math.atan2(point.y - center.y, point.x - center.x),
            before: shotSnapshot(), moved: false,
          };
          canvas.style.cursor = SHOT_ROTATE_CURSOR;
        } else {
          const bounds = shotShapeBounds(shape);
          const anchorLocal = {
            x: handle.includes("w") ? bounds.x + bounds.w : bounds.x,
            y: handle.includes("n") ? bounds.y + bounds.h : bounds.y,
          };
          Shot.drag = {
            mode: "shape-resize", shape, handle, bounds,
            fontSize: shape.fontSize,
            startShape: shotShapeSnapshot(shape),
            before: shotSnapshot(), moved: false,
            anchorWorld: shotRotatePoint(anchorLocal, center, shape.rotation || 0),
          };
          canvas.style.cursor = shotCursorForHandle(handle, shape.rotation || 0);
        }
        canvas.setPointerCapture(event.pointerId);
        return;
      }
      const shape = shotHitShape(point);
      if (shape) {
        Shot.selected = shape;
        Shot.drag = {
          mode: "shape-move", shape, start: point,
          startShape: shotShapeSnapshot(shape),
          before: shotSnapshot(), moved: false,
        };
        canvas.style.cursor = "grabbing";
        canvas.setPointerCapture(event.pointerId);
        shotDraw();
        return;
      }
      Shot.selected = null;
      const stage = $("shotStage");
      Shot.drag = {
        mode: "pan",
        start: { x: event.clientX, y: event.clientY },
        left: stage.scrollLeft,
        top: stage.scrollTop,
      };
      canvas.style.cursor = "grabbing";
      canvas.setPointerCapture(event.pointerId);
      shotDraw();
      return;
    }
    if (Shot.tool === "text") {
      const existing = shotHitShape(point);
      shotStartText(point, existing && existing.tool === "text" ? existing : null);
      return;
    }
    Shot.start = point;
    Shot.preview = {
      tool: Shot.tool, start: point, end: point,
      points: Shot.tool === "marker" ? [{ ...point }] : null,
      color: Shot.color, width: Shot.width, rotation: 0,
    };
    Shot.drag = { mode: "shape-draw" };
    canvas.setPointerCapture(event.pointerId);
    shotDraw();
  };
  canvas.onpointermove = (event) => {
    if (!Shot.base) return;
    const point = shotPoint(event);
    if (Shot.stage === "crop") {
      if (!Shot.drag || !Shot.drag.mode.startsWith("crop-")) return;
      shotUpdateCrop(point);
      shotDraw();
      return;
    }
    if (Shot.drag?.mode === "shape-draw" && Shot.preview) {
      if (Shot.preview.tool === "marker") {
        const points = Shot.preview.points;
        const last = points[points.length - 1];
        if (!last || Math.hypot(point.x - last.x, point.y - last.y) > 1.2) {
          points.push({ ...point });
        }
      } else {
        Shot.preview.end = point;
      }
      shotDraw();
      return;
    }
    if (Shot.drag?.mode === "pan") {
      const stage = $("shotStage");
      stage.scrollLeft = Shot.drag.left - (event.clientX - Shot.drag.start.x);
      stage.scrollTop = Shot.drag.top - (event.clientY - Shot.drag.start.y);
      return;
    }
    if (Shot.drag?.shape) {
      Shot.drag.moved = true;
      if (Shot.drag.mode === "shape-resize") {
        canvas.style.cursor = shotCursorForHandle(Shot.drag.handle, Shot.drag.shape.rotation || 0);
      } else if (Shot.drag.mode === "shape-rotate") {
        canvas.style.cursor = SHOT_ROTATE_CURSOR;
      } else {
        canvas.style.cursor = "grabbing";
      }
      shotUpdateShapeDrag(point, event);
      shotDraw();
      return;
    }
    canvas.style.cursor = shotCursorAt(point);
  };
  canvas.onpointerup = (event) => {
    if (!Shot.base) return;
    if (Shot.stage === "crop") {
      if (!Shot.drag) return;
      const crop = shotNormalizeCrop(Shot.crop || { x: 0, y: 0, w: Shot.base.width, h: Shot.base.height });
      if (crop.w < 8 || crop.h < 8) {
        Shot.crop = { x: 0, y: 0, w: Shot.base.width, h: Shot.base.height };
      }
      Shot.drag = null;
      shotDraw();
      return;
    }
    if (Shot.drag?.mode === "pan") {
      Shot.drag = null;
      canvas.style.cursor = "grab";
      return;
    }
    if (Shot.drag?.mode === "shape-draw" && Shot.preview) {
      const shape = Shot.preview;
      const b = shotShapeBounds(shape);
      Shot.preview = null;
      Shot.drag = null;
      if (b.w > 3 || b.h > 3) {
        shotRemember();
        Shot.shapes.push(shape);
        Shot.selected = shape;
        shotSetTool("move");
      }
      shotDraw();
      return;
    }
    if (Shot.drag?.before && Shot.drag.moved) shotPushSnapshot(Shot.drag.before);
    if (Shot.drag?.shape && Shot.drag.moved) Shot.selected = Shot.drag.shape;
    Shot.drag = null;
    canvas.style.cursor = shotCursorAt(shotPoint(event));
    shotDraw();
  };
  canvas.onpointercancel = () => {
    Shot.start = null;
    Shot.preview = null;
    Shot.drag = null;
    canvas.style.cursor = shotCursorAt(shotPoint({ clientX: 0, clientY: 0 }));
    shotDraw();
  };
  document.addEventListener("keydown", (event) => {
    if ($("shotLayer").classList.contains("hidden")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeShot();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      saveShot();
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && Shot.selected) {
      event.preventDefault();
      shotDeleteSelected();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) shotRedo();
      else shotUndo();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      shotRedo();
    }
  });
  shotSetTool("move");
  shotSyncHistory();
}
