const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const infoBox = document.getElementById("infoBox");
const progressBar = document.getElementById("progressBar");
const scanModeSelect = document.getElementById("scanMode");
const commentInput = document.getElementById("commentName");

const VERSION_MAGIC_LEGACY = [0xE2, 0x88, 0x9E];
const RXI_PARSERS = {
  1: parseRXI_V1,
  2: parseRXI_V2,
  3: parseRXI_V3,
};

function readVersion(bytes, pointer) {
  if (bytes[pointer] === 0xE2 && bytes[pointer+1] === 0x88 && bytes[pointer+2] === 0x9E) {
    return { major: 1, minor: 0, patch: 0, isLegacy: true };
  }
  return { major: bytes[pointer], minor: bytes[pointer+1], patch: bytes[pointer+2], isLegacy: false };
}
function writeVersion(major, minor, patch) {
  return [major, minor, patch];
}

document.getElementById("rxiFile").onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => parseRXI(new Uint8Array(r.result));
  r.readAsArrayBuffer(f);
};

async function parseRXI(bytes) {
  let pointer = 0;

  if (bytes.length < 4) return alert("The file is too small!");
  const payload = bytes.slice(0, bytes.length - 4);
  const storedCRC = ((bytes[bytes.length-4] << 24) |
    (bytes[bytes.length-3] << 16) |
    (bytes[bytes.length-2] <<  8) |
    bytes[bytes.length-1]) >>> 0;
  const computed = crc32(payload);
  if (computed !== storedCRC) return alert(`File corrupted! (CRC mismatch)\nExpected : 0x${storedCRC.toString(16).toUpperCase().padStart(8,"0")}\nComputed : 0x${computed.toString(16).toUpperCase().padStart(8,"0")}`);

  bytes = payload;

  // SOF
  if (bytes[pointer++] !== 0x02 || bytes[pointer++] !== 0xD0) return alert("Invalid SOF");
  if (str(bytes, pointer, 3) !== "RXI") return alert("Invalid RXI marker");
  pointer += 3;

  // Read version
  const version = readVersion(bytes, pointer);
  pointer += 3;
  const parserFn = RXI_PARSERS[version.major];

  if (!parserFn) return alert(`Unsupported RXI major version: ${version.major}`);

  await parserFn(bytes, pointer, storedCRC, version);
}
// parsers
async function parseRXI_V1(bytes, pointer, storedCRC, version) {
  const versionStr = `V${version.major}.${version.minor}.${version.patch}${version.isLegacy ? " (legacy ∞)" : ""}`;
  let comment = "N/A";
  let dateStr  = "N/A";

  // FINF
  if (str(bytes, pointer, 4) === "FINF") {
    pointer += 4;
    const len = bytes[pointer++];
    comment = str(bytes, pointer, len);
    pointer += len;

    const day = bytes[pointer++];
    const month = bytes[pointer++];
    const year = (bytes[pointer++] << 8) | bytes[pointer++];
    dateStr = `${String(day).padStart(2,"0")}-${String(month).padStart(2,"0")}-${year}`;
  }
  // HDR
  if (str(bytes, pointer, 3) !== "HDR") return alert("HDR missing");
  pointer += 3;

  const mode = bytes[pointer++];
  const width = (bytes[pointer++] << 8) | bytes[pointer++];
  const height = (bytes[pointer++] << 8) | bytes[pointer++];
  const scanMode = bytes[pointer++];

  canvas.width = width;
  canvas.height = height;

  infoBox.innerHTML = `
    Version: ${versionStr}<br>
    Comment: ${comment}<br>
    Date: ${dateStr}<br>
    Resolution: ${width}×${height}<br>
    Mode: ${mode}<br>
    ScanMode: ${scanMode}<br>
    CRC32: 0x${storedCRC.toString(16).toUpperCase().padStart(8,"0")} ✅
  `;

  const img = ctx.createImageData(width, height);
  img.data.fill(0);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;

  // PDAT
  if (str(bytes, pointer, 4) !== "PDAT") return alert("PDAT missing");
  pointer += 4;

  const compressed = bytes[pointer++];
  const dataLength = (bytes[pointer++] << 24) +
    (bytes[pointer++] << 16) +
    (bytes[pointer++] << 8) +
    bytes[pointer++];
  let pdat = bytes.slice(pointer, pointer + dataLength);
  pointer += dataLength;

  if (compressed === 1) pdat = await inflateData(pdat);

  let pd = pdat, pdPointer = 0;
  const total = width * height;
  progressBar.value = 0;

  if (scanMode === 1) {
    for (let px = 0; px < total; px++) {
      let r = 0, g = 0, b = 0, a = 255;
      if (mode === 1) r = g = b = pd[pdPointer++];
      else if (mode === 2) {
        r = pd[pdPointer++];
        g = pd[pdPointer++];
        b = pd[pdPointer++];
      } else if (mode === 3) {
        r = pd[pdPointer++];
        g = pd[pdPointer++];
        b = pd[pdPointer++];
        a = pd[pdPointer++];
      } else if (mode === 4) {
        r = g = b = pd[pdPointer++];
        a = pd[pdPointer++];
      }
      img.data.set([r, g, b, a], px * 4);
      if (px % 1000 === 0) progressBar.value = (px / total) * 100;
    }
  } else if (scanMode === 2) {
    let px = 0;
    while (pdPointer < pd.length && px < total) {
      let r = 0, g = 0, b = 0, a = 255;
      if (mode === 1) r = g = b = pd[pdPointer++];
      else if (mode === 2) {
        r = pd[pdPointer++];
        g = pd[pdPointer++];
        b = pd[pdPointer++];
      } else if (mode === 3) {
        r = pd[pdPointer++];
        g = pd[pdPointer++];
        b = pd[pdPointer++];
        a = pd[pdPointer++];
      } else if (mode === 4) {
        r = g = b = pd[pdPointer++];
        a = pd[pdPointer++];
      }
      if (pdPointer + 1 >= pd.length) break;

      const byte1 = pd[pdPointer++], byte2 = pd[pdPointer++];
      const isFill = (byte1 & 0x80) !== 0;
      const count = ((byte1 & 0x7F) << 8) | byte2;

      if (isFill) {
        for (let i = 0; i < count && px < total; i++, px++)
          img.data.set([r, g, b, a], px * 4);
      } else {
        px += count;
      }
    }
  } else {
    return alert("Unknown scan mode");
  }
  ctx.putImageData(img, 0, 0);
  progressBar.value = 100;
}
async function parseRXI_V2(bytes, pointer, storedCRC, version) {
  const versionStr = `V${version.major}.${version.minor}.${version.patch}`;
  let comment = "N/A";
  let dateStr  = "N/A";

  if (str(bytes, pointer, 4) === "META") {
    pointer += 4;
    const len = bytes[pointer++];
    comment = str(bytes, pointer, len);
    pointer += len;
    const day = bytes[pointer++];
    const month = bytes[pointer++];
    const year = (bytes[pointer++] << 8) | bytes[pointer++];
    dateStr = `${String(day).padStart(2,"0")}-${String(month).padStart(2,"0")}-${year}`;
  }
  if (str(bytes, pointer, 3) !== "HDR") return alert("HDR missing");
  pointer += 3;

  const mode = bytes[pointer++];
  const width = (bytes[pointer++] << 8) | bytes[pointer++];
  const height = (bytes[pointer++] << 8) | bytes[pointer++];
  const scanMode = bytes[pointer++];

  canvas.width = width;
  canvas.height = height;

  infoBox.innerHTML = `
    Version: ${versionStr}<br>
    Comment: ${comment}<br>
    Date: ${dateStr}<br>
    Resolution: ${width}×${height}<br>
    Mode: ${mode}<br>
    ScanMode: ${scanMode}<br>
    CRC32: 0x${storedCRC.toString(16).toUpperCase().padStart(8,"0")} ✅
  `;

  const img = ctx.createImageData(width, height);
  img.data.fill(0);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;

  if (str(bytes, pointer, 4) !== "PDAT") return alert("PDAT missing");
  pointer += 4;

  const compressed = bytes[pointer++];
  const dataLength = (bytes[pointer++] << 24) +
    (bytes[pointer++] << 16) +
    (bytes[pointer++] << 8) +
    bytes[pointer++];
  let pdat = bytes.slice(pointer, pointer + dataLength);
  pointer += dataLength;

  if (compressed === 1) pdat = await inflateData(pdat);

  let pd = pdat, pdPointer = 0;
  const total = width * height;
  progressBar.value = 0;
  const chPerPx = mode === 1 ? 1 : mode === 2 ? 3 : mode === 3 ? 4 : 2;

  if (scanMode === 1) {
    const filterType = pd[pdPointer++];
    const rawBytes = pd.slice(pdPointer, pdPointer + total * chPerPx);
    const pixels = reconstructFilter(rawBytes, filterType, width, chPerPx);

    for (let px = 0; px < total; px++) {
      const base = px * chPerPx;
      let r = 0, g = 0, b = 0, a = 255;

      if (mode === 1) r = g = b = pixels[base];
      else if (mode === 2) {
        r = pixels[base];
        g = pixels[base+1];
        b = pixels[base+2];
      } else if (mode === 3) {
        r = pixels[base];
        g = pixels[base+1];
        b = pixels[base+2];
        a = pixels[base+3];
      } else if (mode === 4) {
        r = g = b = pixels[base];
        a = pixels[base+1];
      }
      img.data.set([r, g, b, a], px * 4);
      if (px % 1000 === 0) progressBar.value = (px / total) * 100;
    }
  } else if (scanMode === 2) {
    let px = 0;
    while (pdPointer < pd.length && px < total) {
      let r = 0, g = 0, b = 0, a = 255;

      if (mode === 1) r = g = b = pd[pdPointer++];
      else if (mode === 2) {
        r = pd[pdPointer++];
        g = pd[pdPointer++];
        b = pd[pdPointer++];
      } else if (mode === 3) {
        r = pd[pdPointer++];
        g = pd[pdPointer++];
        b = pd[pdPointer++];
        a = pd[pdPointer++];
      } else if (mode === 4) {
        r = g = b = pd[pdPointer++];
        a = pd[pdPointer++];
      }
      if (pdPointer >= pd.length) break;
      const segment = pd[pdPointer++];
      const isFill = (segment & 0x80) !== 0;
      const count = segment & 0x7F;

      if (isFill) {
        for (let i = 0; i < count && px < total; i++, px++)
          img.data.set([r, g, b, a], px * 4);
      } else {
        px += count;
      }
    }
  } else {
    return alert("Unknown scan mode");
  }
  ctx.putImageData(img, 0, 0);
  progressBar.value = 100;
}
async function parseRXI_V3(bytes, pointer, storedCRC, version) {
  const versionStr = `V${version.major}.${version.minor}.${version.patch}`;
  let comment = "N/A";
  let dateStr  = "N/A";

  if (str(bytes, pointer, 4) === "META") {
    pointer += 4;
    const len = bytes[pointer++];
    comment = str(bytes, pointer, len);
    pointer += len;
    const day   = bytes[pointer++];
    const month = bytes[pointer++];
    const year  = (bytes[pointer++] << 8) | bytes[pointer++];
    dateStr = `${String(day).padStart(2,"0")}-${String(month).padStart(2,"0")}-${year}`;
  }

  if (str(bytes, pointer, 3) !== "HDR") return alert("HDR missing");
  pointer += 3;

  const mode     = bytes[pointer++];
  const width    = (bytes[pointer++] << 8) | bytes[pointer++];
  const height   = (bytes[pointer++] << 8) | bytes[pointer++];
  const scanMode = bytes[pointer++];

  canvas.width  = width;
  canvas.height = height;

  infoBox.innerHTML = `
    Version: ${versionStr}<br>
    Comment: ${comment}<br>
    Date: ${dateStr}<br>
    Resolution: ${width}×${height}<br>
    Mode: ${mode}<br>
    ScanMode: ${scanMode}<br>
    CRC32: 0x${storedCRC.toString(16).toUpperCase().padStart(8,"0")} ✅
  `;

  const img = ctx.createImageData(width, height);
  img.data.fill(0);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;

  if (str(bytes, pointer, 4) !== "PDAT") return alert("PDAT missing");
  pointer += 4;

  const compressed  = bytes[pointer++];
  const dataLength  = (bytes[pointer++] << 24) +
    (bytes[pointer++] << 16) +
    (bytes[pointer++] <<  8) +
     bytes[pointer++];
  let pdat = bytes.slice(pointer, pointer + dataLength);
  pointer += dataLength;

  if (compressed === 1) pdat = await inflateData(pdat);

  let pd = pdat, pdPointer = 0;
  const total = width * height;
  progressBar.value = 0;

  let palette = null;
  if (mode === 0) {
    const rawCount   = pd[pdPointer++];
    const paletteCount = rawCount === 0 ? 256 : rawCount;

    if (paletteCount > 256) throw new Error("Invalid palette size");
    palette = [];
    for (let p = 0; p < paletteCount; p++) {
      palette.push({
        r: pd[pdPointer++],
        g: pd[pdPointer++],
        b: pd[pdPointer++],
        a: pd[pdPointer++]
      });
    }
  }

  function writePx(px, r, g, b, a) {
    img.data.set([r, g, b, a], px * 4);
  }
  function readColor() {
    if (mode === 0) {
      const idx = pd[pdPointer++];
      if (!palette[idx]) throw new Error("Invalid palette index");
      const { r, g, b, a } = palette[idx];
      return { r, g, b, a };
    }
    let r = 0, g = 0, b = 0, a = 255;
    if (mode === 1) {
      r = g = b = pd[pdPointer++];
    } else if (mode === 2) {
      r = pd[pdPointer++];
      g = pd[pdPointer++];
      b = pd[pdPointer++];
    } else if (mode === 3) {
      r = pd[pdPointer++];
      g = pd[pdPointer++];
      b = pd[pdPointer++];
      a = pd[pdPointer++];
    } else if (mode === 4) {
      r = g = b = pd[pdPointer++];
      a = pd[pdPointer++];
    }
    return { r, g, b, a };
  }

  if (scanMode === 1) {
    if (mode === 0) {
      for (let px = 0; px < total; px++) {
        const { r, g, b, a } = readColor();
        writePx(px, r, g, b, a);
        if (px % 1000 === 0) progressBar.value = (px / total) * 100;
      }
    } else {
      const chPerPx = mode === 1 ? 1 : mode === 2 ? 3 : mode === 3 ? 4 : 2;
      const filterType = pd[pdPointer++];
      const rawBytes   = pd.slice(pdPointer, pdPointer + total * chPerPx);
      const pixels     = reconstructFilter(rawBytes, filterType, width, chPerPx);
      let pixPtr = 0;

      for (let px = 0; px < total; px++) {
        let r = 0, g = 0, b = 0, a = 255;
        if (mode === 1) {
          r = g = b = pixels[pixPtr++];
        } else if (mode === 2) {
          r = pixels[pixPtr++];
          g = pixels[pixPtr++];
          b = pixels[pixPtr++];
        } else if (mode === 3) {
          r = pixels[pixPtr++];
          g = pixels[pixPtr++];
          b = pixels[pixPtr++];
          a = pixels[pixPtr++];
        } else if (mode === 4) {
          r = g = b = pixels[pixPtr++];
          a = pixels[pixPtr++];
        }
        writePx(px, r, g, b, a);
        if (px % 1000 === 0) progressBar.value = (px / total) * 100;
      }
    }
  } else if (scanMode === 2) {
    let px = 0;
    while (pdPointer < pd.length && px < total) {
      const { r, g, b, a } = readColor();
      const count = pd[pdPointer++];
      for (let i = 0; i < count && px < total; i++, px++)
        writePx(px, r, g, b, a);
      if (px % 1000 === 0) progressBar.value = (px / total) * 100;
    }
  } /* else if (scanMode === 3) {
    const TILE = 8;
    const tilesX = Math.ceil(width  / TILE);
    const tilesY = Math.ceil(height / TILE);
    const tileCache = [];

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const flag = pd[pdPointer++];
        let tileRGBA;

        if (flag === 0x00) {
          tileRGBA = new Uint8Array(TILE * TILE * 4);
          for (let tp = 0; tp < TILE * TILE; tp++) {
            const { r, g, b, a } = readColor();
            tileRGBA[tp * 4]     = r;
            tileRGBA[tp * 4 + 1] = g;
            tileRGBA[tp * 4 + 2] = b;
            tileRGBA[tp * 4 + 3] = a;
          }
          tileCache.push(tileRGBA);
        } else if (flag === 0x01) {
          const cacheIdx = pd[pdPointer++];
          tileRGBA = tileCache[cacheIdx];
          if (!tileCache[cacheIdx]) throw new Error("Invalid tile cache index");
        } else {
          return alert(`Unknown tile flag: 0x${flag.toString(16)}`);
        }
        for (let row = 0; row < TILE; row++) {
          const imgY = ty * TILE + row;
          if (imgY >= height) break;
          for (let col = 0; col < TILE; col++) {
            const imgX = tx * TILE + col;
            if (imgX >= width) break;
            const imgPx = imgY * width + imgX;
            const tp    = row * TILE + col;
            img.data[imgPx * 4]     = tileRGBA[tp * 4];
            img.data[imgPx * 4 + 1] = tileRGBA[tp * 4 + 1];
            img.data[imgPx * 4 + 2] = tileRGBA[tp * 4 + 2];
            img.data[imgPx * 4 + 3] = tileRGBA[tp * 4 + 3];
          }
        }
      }
      progressBar.value = (ty / tilesY) * 100;
    }
  }*/ else {
    return alert("Unknown scan mode");
  }
  ctx.putImageData(img, 0, 0);
  progressBar.value = 100;
}

document.getElementById("convert").onclick = async () => {
  const files = document.getElementById("pngFile").files;
  if (!files.length) return alert("Select an image!");

  const scanMode = parseInt(scanModeSelect.value);
  const comment = commentInput.value.trim();

  if (typeof JSZip === "undefined") await loadJSZip();
  const zip = new JSZip();

  for (let fIndex = 0; fIndex < files.length; fIndex++) {
    const file = files[fIndex];
    await new Promise(resolve => {
      const img = new Image();
      img.onload = async () => {
        const rxiData = await pngToRXI(img, scanMode, comment);
        zip.file(file.name.replace(/\.[^/.]+$/, ".rxi"), rxiData);
        resolve();
      };
      img.src = URL.createObjectURL(file);
    });
    progressBar.value = ((fIndex + 1) / files.length) * 100;
  }
  zip.generateAsync({ type: "blob" }).then(blob => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "batch_rxi.zip";
    a.click();
    progressBar.value = 100;
  });
};

async function pngToRXI(img, scanMode, comment) {
  const offscreen  = document.createElement("canvas");
  offscreen.width  = img.width;
  offscreen.height = img.height;
  const offCtx     = offscreen.getContext("2d");
  offCtx.drawImage(img, 0, 0);
  const data = offCtx.getImageData(0, 0, offscreen.width, offscreen.height).data;
  const total  = data.length / 4;
  const width  = offscreen.width;
  const height = offscreen.height;

  let hasAlpha = false, allGray = true;
  const uniqueColors = new Set();

  for (let i = 0; i < data.length; i += 4) {
    if (data[i+3] !== 255) hasAlpha = true;
    if (!(data[i] === data[i+1] && data[i] === data[i+2])) allGray = false;
    const color = (data[i] << 24) | (data[i+1] << 16) | (data[i+2] << 8) | data[i+3];
    uniqueColors.add(color);
  }

  let mode;
  if (uniqueColors.size <= 256 && total > 256) {
    mode = 0;
  } else if (!hasAlpha && !allGray) {
    mode = 2;
  } else if (!hasAlpha && allGray) {
    mode = 1;
  } else if (hasAlpha && allGray) {
    mode = 4;
  } else {
    mode = 3;
  }
  if (scanMode === 0) scanMode = smartDetectScanMode(data, total, width);

  const RXI_CURRENT_VERSION = { major: 3, minor: 0, patch: 0 };
  const header = [];

  // SOF
  header.push(0x02, 0xD0, ...enc("RXI"),
    ...writeVersion(RXI_CURRENT_VERSION.major, RXI_CURRENT_VERSION.minor, RXI_CURRENT_VERSION.patch));

  // META
  if (comment) {
    header.push(...enc("META"));
    header.push(comment.length);
    header.push(...enc(comment));
    const now  = new Date();
    const year = now.getFullYear();
    header.push(now.getDate(), now.getMonth() + 1, (year >> 8) & 255, year & 255);
  }

  // HDR
  header.push(
    ...enc("HDR"), mode,
    width  >> 8, width  & 255,
    height >> 8, height & 255,
    scanMode
  );

  // PDAT
  header.push(...enc("PDAT"));

  let pdatRaw;
  try {
    pdatRaw = await buildPDAT_V3(data, width, height, mode, scanMode);
  } catch (err) {
    return alert(`Encoding error: ${err.message}`);
  }

  const compressedData = await deflateData(pdatRaw);
  const pdatMeta = [
    1,
    (compressedData.length >>> 24) & 255,
    (compressedData.length >>> 16) & 255,
    (compressedData.length >>>  8) & 255,
     compressedData.length         & 255,
  ];

  const headerArr   = new Uint8Array(header);
  const pdatMetaArr = new Uint8Array(pdatMeta);
  const payloadLen  = headerArr.length + pdatMetaArr.length + compressedData.length;
  const payload     = new Uint8Array(payloadLen);
  let offset = 0;

  payload.set(headerArr,      offset); offset += headerArr.length;
  payload.set(pdatMetaArr,    offset); offset += pdatMetaArr.length;
  payload.set(compressedData, offset);

  const crcBytes = writeCRC32(payload);
  const result   = new Uint8Array(payloadLen + 4);
  result.set(payload,  0);
  result.set(crcBytes, payloadLen);

  return result;
}
async function buildPDAT_V3(data, width, height, mode, scanMode) {
  const total    = width * height;
  const pdatOut  = [];
  const TILE     = 8;
  let palette = null;
  let pixToIdx = null;

  if (mode === 0) {
    pixToIdx = new Map();
    palette  = [];
    for (let i = 0; i < total; i++) {
      const b = i * 4;
      const key = (data[b]<<24)|(data[b+1]<<16)|(data[b+2]<<8)|data[b+3];

      if (!pixToIdx.has(key)) {
        pixToIdx.set(key, palette.length);
        palette.push({ r: data[b], g: data[b+1], b: data[b+2], a: data[b+3] });
      }
    }
    pdatOut.push(palette.length === 256 ? 0 : palette.length);
    for (const { r, g, b, a } of palette) pdatOut.push(r, g, b, a);
  }

  function pushColor(i) {
    const b = i * 4;
    if (mode === 0) {
      const key = (data[b]<<24)|(data[b+1]<<16)|(data[b+2]<<8)|data[b+3];
      const idx = pixToIdx.get(key);
      if (idx === undefined) throw new Error("Palette index missing");
      pdatOut.push(idx);
    } else if (mode === 1) pdatOut.push(data[b]);
    else if (mode === 2) pdatOut.push(data[b], data[b+1], data[b+2]);
    else if (mode === 3) pdatOut.push(data[b], data[b+1], data[b+2], data[b+3]);
    else if (mode === 4) pdatOut.push(data[b], data[b+3]);
  }

  if (scanMode === 1) {
    if (mode === 0) {
      for (let i = 0; i < total; i++) pushColor(i);
    } else {
      const chPerPx  = mode === 1 ? 1 : mode === 2 ? 3 : mode === 3 ? 4 : 2;
      const rawFlat  = buildRawFlat(data, mode, total);
      const { filterType, filtered } = await pickBestFilter(rawFlat, width, chPerPx);
      pdatOut.push(filterType);
      for (const byte of filtered) pdatOut.push(byte);
    }
  } else if (scanMode === 2) {
    let i = 0;
    while (i < total) {
      const bi = i * 4;
      const r = data[bi], g = data[bi+1], b = data[bi+2], a = data[bi+3];
      let count = 0;
      while (i < total && count < 255) {
        const id = i * 4;
        if (data[id] !== r || data[id+1] !== g || data[id+2] !== b || data[id+3] !== a) break;
        count++;
        i++;
      }
      pushColor((i - count));
      pdatOut.push(count);
    }
  } /*else if (scanMode === 3) {
    const tilesX   = Math.ceil(width  / TILE);
    const tilesY   = Math.ceil(height / TILE);
    const tileStore = new Map();
    const tileKeys  = [];
    const tileCache = [];

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const tilePixels = [];
        for (let row = 0; row < TILE; row++) {
          for (let col = 0; col < TILE; col++) {
            const imgX = tx * TILE + col;
            const imgY = ty * TILE + row;
            if (imgX >= width || imgY >= height) {
              tilePixels.push(0, 0, 0, 0);
              continue;
            }
            const pxIdx = (imgY * width + imgX) * 4;
            tilePixels.push(data[pxIdx], data[pxIdx+1], data[pxIdx+2], data[pxIdx+3]);
          }
        }
        const tileKey = hashTile(tilePixels);

        if (tileStore.has(tileKey)) {
          const cacheIdx = tileStore.get(tileKey);
          const existingTile = tileCache[cacheIdx];

          if (tilesEqual(existingTile, tilePixels)) {
            pdatOut.push(0x01, cacheIdx);
            continue;
          }
        } else {
          const cacheIdx = tileKeys.length;
          tileStore.set(tileKey, cacheIdx);
          tileKeys.push(tileKey);
          pdatOut.push(0x00);
          tileCache.push(tilePixels);
          for (let p = 0; p < TILE * TILE; p++) {
            const base = p * 4;
            if (mode === 0) {
              const key = (tilePixels[base]<<24) |
                (tilePixels[base+1]<<16) |
                (tilePixels[base+2]<<8) |
                tilePixels[base+3];
              const idx = pixToIdx.get(key);
              if (idx === undefined) throw new Error("Palette index missing");
              pdatOut.push(idx);
            } else if (mode === 1) {
              pdatOut.push(tilePixels[base]);
            } else if (mode === 2) {
              pdatOut.push(tilePixels[base], tilePixels[base+1], tilePixels[base+2]);
            } else if (mode === 3) {
              pdatOut.push(tilePixels[base], tilePixels[base+1], tilePixels[base+2], tilePixels[base+3]);
            } else if (mode === 4) {
              pdatOut.push(tilePixels[base], tilePixels[base+3]);
            }
          }
        }
      }
    }
  }*/
  return new Uint8Array(pdatOut);
}
// Utils
function enc(string) {
  return [...string].map(char => char.charCodeAt(0));
}
function str(bytes, offset, length) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}
function makeSegment(isFill, count) {
  return [(isFill ? 0x80 : 0x00) | ((count >> 8) & 0x7F), count & 0xFF];
}
async function deflateData(uint8) {
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();

  writer.write(uint8);
  writer.close();

  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
async function inflateData(uint8) {
  const ds = new DecompressionStream("deflate");
  const writer  = ds.writable.getWriter();

  writer.write(uint8);
  writer.close();

  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
function smartDetectScanMode(data, total, sampleSize = 2000) {
  const step = Math.max(1, Math.floor(total / sampleSize));
  let sameAsNext = 0, checked = 0;
  for (let i = 0; i < total - 1; i += step) {
    const index = i * 4, next = (i+1) * 4;
    if (data[index]===data[next] && data[index+1]===data[next+1] && data[index+2]===data[next+2] && data[index+3]===data[next+3])
      sameAsNext++;
    checked++;
  }
  const runRatio = sameAsNext / checked;
  console.log(`[Smart Mode] Run ratio: ${(runRatio*100).toFixed(1)}% → ScanMode ${runRatio>0.4?2:1}`);
  return runRatio > 0.4 ? 2 : 1;
}
/*function smartDetectScanMode(data, total, width) {
  const TILE = 8;
  const sampleSize = 2000;
  const runStep = Math.max(1, Math.floor(total / sampleSize));
  let sameAsNext  = 0, runChecked = 0;

  for (let i = 0; i < total - 1; i += runStep) {
    const idx  = i * 4, next = (i + 1) * 4;
    if (data[idx]   === data[next]   &&
        data[idx+1] === data[next+1] &&
        data[idx+2] === data[next+2] &&
        data[idx+3] === data[next+3]) sameAsNext++;
    runChecked++;
  }
  const runRatio = sameAsNext / runChecked;

  if (runRatio > 0.40) {
    console.log(`[Smart Mode] Run ratio: ${(runRatio*100).toFixed(1)}% → ScanMode 2`);
    return 2;
  }
  if (width >= TILE && total >= TILE * TILE) {
    const height = total / width;
    const tilesX = Math.ceil(width  / TILE);
    const tilesY = Math.ceil(height / TILE);
    const totalTiles = tilesX * tilesY;
    const tileStep = Math.max(1, Math.floor(totalTiles / 300));
    const seenTiles = new Map();
    let reused = 0, tileSampled = 0;

    for (let t = 0; t < totalTiles; t += tileStep) {
      const ty = Math.floor(t / tilesX);
      const tx = t % tilesX;
      const samples = [];
      const points  = [
        [0, 0], [0, 7], [7, 0], [7, 7], [3, 3]
      ];
      for (const [row, col] of points) {
        const imgX = tx * TILE + col;
        const imgY = ty * TILE + row;
        if (imgX >= width || imgY >= height) { samples.push(-1); continue; }
        const pxIdx = (imgY * width + imgX) * 4;
        samples.push(data[pxIdx], data[pxIdx+1], data[pxIdx+2], data[pxIdx+3]);
      }
      const key = samples.join(",");

      if (seenTiles.has(key)) reused++;
      else seenTiles.set(key, t);

      tileSampled++;
    }
    const tileReuseRatio = reused / tileSampled;

    if (tileReuseRatio > 0.30) {
      console.log(`[Smart Mode] Run ratio: ${(runRatio*100).toFixed(1)}%, Tile reuse: ${(tileReuseRatio*100).toFixed(1)}% → ScanMode 3`);
      return 3;
    }
    console.log(`[Smart Mode] Run ratio: ${(runRatio*100).toFixed(1)}%, Tile reuse: ${(tileReuseRatio*100).toFixed(1)}% → ScanMode 1`);
  } else {
    console.log(`[Smart Mode] Run ratio: ${(runRatio*100).toFixed(1)}% → ScanMode 1`);
  }
  return 1;
}*/
function loadJSZip() {
  return new Promise(resolve => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    script.onload = resolve;
    document.head.appendChild(script);
  });
}
function crc32(buf) {
  let crc = 0xFFFFFFFF;

  for (let i = 0; i < buf.length; i++)
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function writeCRC32(buf) {
  const crc = crc32(buf);
  return new Uint8Array([
    (crc >>> 24) & 0xFF,
    (crc >>> 16) & 0xFF,
    (crc >>>  8) & 0xFF,
     crc & 0xFF
  ]);
}
function applyFilter(raw, filterType, width, channel) {
  const out = new Uint8Array(raw.length);
  const rowBytes = width * channel;

  for (let i = 0; i < raw.length; i++) {
    const x = i % rowBytes;
    const left = x >= channel ? raw[i - channel] : 0;
    const up = i >= rowBytes ? raw[i - rowBytes] : 0;

    if (filterType === 0) {
      out[i] = raw[i];
    } else if (filterType === 1) {
      out[i] = (raw[i] - left) & 0xFF;
    } else if (filterType === 2) {
      out[i] = (raw[i] - up) & 0xFF;
    }
  }
  return out;
}
function reconstructFilter(filtered, filterType, width, channel) {
  const out = new Uint8Array(filtered.length);
  const rowBytes = width * channel;

  for (let i = 0; i < filtered.length; i++) {
    const x = i % rowBytes;
    const left = x >= channel ? out[i - channel] : 0;
    const up = i >= rowBytes ? out[i - rowBytes] : 0;

    if (filterType === 0) out[i] = filtered[i];
    else if (filterType === 1) out[i] = (filtered[i] + left) & 0xFF;
    else if (filterType === 2) out[i] = (filtered[i] + up) & 0xFF;
  }
  return out;
}
function makeSegmentV2(isFill, count) {
  return (isFill ? 0x80 : 0x00) | (count & 0x7F);
}
function buildRawFlat(d, mode, total) {
  const out = new Uint8Array(total * (mode === 1 ? 1 : mode === 2 ? 3 : mode === 3 ? 4 : 2));
  let o = 0;

  for (let i = 0; i < total; i++) {
    const b = i * 4;

    if (mode === 1) out[o++] = d[b];
    else if (mode === 2) {
      out[o++] = d[b];
      out[o++] = d[b + 1];
      out[o++] = d[b + 2];
    } else if (mode === 3) {
      out[o++] = d[b];
      out[o++] = d[b + 1];
      out[o++] = d[b + 2];
      out[o++] = d[b + 3];
    } else if (mode === 4) {
      out[o++] = d[b];
      out[o++] = d[b + 3];
    }
  }
  return out;
}
async function pickBestFilter(rawFlat, width, channel) {
  const candidates = [0, 1, 2];
  let best = null, bestScore = Infinity;

  for (const ft of candidates) {
    const filtered = applyFilter(rawFlat, ft, width, channel);
    let score = 0;

    for (let i = 0; i < filtered.length; i++) {
      const v = filtered[i];
      score += v > 127 ? 256 - v : v;
    }
    if (score < bestScore) {
      bestScore = score;
      best = { filterType: ft, filtered };
    }
  }
  return {
    filterType: best.filterType,
    filtered: new Uint8Array(best.filtered)
  };
}
/*function hashTile(arr) {
  let h = 2166136261;
  for (let i = 0; i < arr.length; i++) {
    h ^= arr[i];
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function tilesEqual(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}*/
document.getElementById("downloadPNG").onclick = () => {
  canvas.toBlob(blob => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "image.png";
    a.click();
  }, "image/png");
};
