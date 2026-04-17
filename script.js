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
const creatorInput = document.getElementById("creatorName");

const VERSION_MAGIC_LEGACY = [0xE2, 0x88, 0x9E];

function readVersion(b, p) {
  if (b[p] === 0xE2 && b[p+1] === 0x88 && b[p+2] === 0x9E) {
    return { major: 1, minor: 0, patch: 0, isLegacy: true };
  }
  return { major: b[p], minor: b[p+1], patch: b[p+2], isLegacy: false };
}

function writeVersion(major, minor, patch) {
  return [major, minor, patch];
}

const RXI_PARSERS = {
  1: parseRXI_V1,
  2: parseRXI_V2,
};

document.getElementById("rxiFile").onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => parseRXI(new Uint8Array(r.result));
  r.readAsArrayBuffer(f);
};

async function parseRXI(b) {
  let p = 0;

  if (b.length < 4) return alert("File terlalu kecil");
  const payload   = b.slice(0, b.length - 4);
  const storedCRC = ((b[b.length-4] << 24) | (b[b.length-3] << 16) |
                     (b[b.length-2] <<  8) |  b[b.length-1]) >>> 0;
  const computed  = crc32(payload);
  if (computed !== storedCRC)
    return alert(`File corrupted! (CRC mismatch)\nExpected : 0x${storedCRC.toString(16).toUpperCase().padStart(8,"0")}\nComputed : 0x${computed.toString(16).toUpperCase().padStart(8,"0")}`);

  b = payload;

  // SOF
  if (b[p++] !== 0x02 || b[p++] !== 0xD0) return alert("Invalid SOF");
  if (str(b, p, 3) !== "RXI") return alert("Invalid RXI marker");
  p += 3;

  // Read version
  const version = readVersion(b, p);
  p += 3;

  const parserFn = RXI_PARSERS[version.major];
  if (!parserFn) return alert(`Unsupported RXI major version: ${version.major}`);

  await parserFn(b, p, storedCRC, version);
}

// parsers
async function parseRXI_V1(b, p, storedCRC, version) {
  const versionStr = `V${version.major}.${version.minor}.${version.patch}${version.isLegacy ? " (legacy ∞)" : ""}`;

  let creator = "N/A";
  let dateStr  = "N/A";

  // FINF
  if (str(b, p, 4) === "FINF") {
    p += 4;
    const len = b[p++];
    creator = str(b, p, len);
    p += len;

    const day   = b[p++];
    const month = b[p++];
    const year  = (b[p++] << 8) | b[p++];
    dateStr = `${String(day).padStart(2,"0")}-${String(month).padStart(2,"0")}-${year}`;
  }

  // HDR
  if (str(b, p, 3) !== "HDR") return alert("HDR missing");
  p += 3;

  const mode     = b[p++];
  const w        = (b[p++] << 8) | b[p++];
  const h        = (b[p++] << 8) | b[p++];
  const scanMode = b[p++];

  canvas.width  = w;
  canvas.height = h;

  infoBox.innerHTML = `
    Version: ${versionStr}<br>
    Creator: ${creator}<br>
    Date: ${dateStr}<br>
    Resolution: ${w}×${h}<br>
    Mode: ${mode}<br>
    ScanMode: ${scanMode}<br>
    CRC32: 0x${storedCRC.toString(16).toUpperCase().padStart(8,"0")} ✅
  `;

  const img = ctx.createImageData(w, h);
  img.data.fill(0);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;

  // PDAT
  if (str(b, p, 4) !== "PDAT") return alert("PDAT missing");
  p += 4;

  const compressed = b[p++];
  const dataLength =
    (b[p++] * 16777216) + (b[p++] << 16) + (b[p++] << 8) + b[p++];

  let pdat = b.slice(p, p + dataLength);
  p += dataLength;

  if (compressed === 1) pdat = await inflateData(pdat);

  let pd = pdat, pdp = 0;
  const total = w * h;
  progressBar.value = 0;

  if (scanMode === 1) {
    for (let px = 0; px < total; px++) {
      let r = 0, g = 0, bv = 0, a = 255;
      if      (mode === 1) r = g = bv = pd[pdp++];
      else if (mode === 2) { r = pd[pdp++]; g = pd[pdp++]; bv = pd[pdp++]; }
      else if (mode === 3) { r = pd[pdp++]; g = pd[pdp++]; bv = pd[pdp++]; a = pd[pdp++]; }
      else if (mode === 4) { r = g = bv = pd[pdp++]; a = pd[pdp++]; }
      img.data.set([r, g, bv, a], px * 4);
      if (px % 1000 === 0) progressBar.value = (px / total) * 100;
    }
  } else if (scanMode === 2) {
    let px = 0;
    while (pdp < pd.length && px < total) {
      let r = 0, g = 0, bv = 0, a = 255;
      if      (mode === 1) r = g = bv = pd[pdp++];
      else if (mode === 2) { r = pd[pdp++]; g = pd[pdp++]; bv = pd[pdp++]; }
      else if (mode === 3) { r = pd[pdp++]; g = pd[pdp++]; bv = pd[pdp++]; a = pd[pdp++]; }
      else if (mode === 4) { r = g = bv = pd[pdp++]; a = pd[pdp++]; }

      if (pdp + 1 >= pd.length) break;
      const byte1 = pd[pdp++], byte2 = pd[pdp++];
      const isFill = (byte1 & 0x80) !== 0;
      const count  = ((byte1 & 0x7F) << 8) | byte2;

      if (isFill) {
        for (let i = 0; i < count && px < total; i++, px++)
          img.data.set([r, g, bv, a], px * 4);
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

async function parseRXI_V2(b, p, storedCRC, version) {
  const versionStr = `V${version.major}.${version.minor}.${version.patch}`;

  let creator = "N/A";
  let dateStr  = "N/A";

  if (str(b, p, 4) === "META") {
    p += 4;
    const len = b[p++];
    creator = str(b, p, len);
    p += len;
    const day   = b[p++];
    const month = b[p++];
    const year  = (b[p++] << 8) | b[p++];
    dateStr = `${String(day).padStart(2,"0")}-${String(month).padStart(2,"0")}-${year}`;
  }

  if (str(b, p, 3) !== "HDR") return alert("HDR missing");
  p += 3;

  const mode     = b[p++];
  const w        = (b[p++] << 8) | b[p++];
  const h        = (b[p++] << 8) | b[p++];
  const scanMode = b[p++];

  canvas.width  = w;
  canvas.height = h;

  infoBox.innerHTML = `
    Version: ${versionStr}<br>
    Creator: ${creator}<br>
    Date: ${dateStr}<br>
    Resolution: ${w}×${h}<br>
    Mode: ${mode}<br>
    ScanMode: ${scanMode}<br>
    CRC32: 0x${storedCRC.toString(16).toUpperCase().padStart(8,"0")} ✅
  `;

  const img = ctx.createImageData(w, h);
  img.data.fill(0);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;

  if (str(b, p, 4) !== "PDAT") return alert("PDAT missing");
  p += 4;

  const compressed = b[p++];
  const dataLength =
    (b[p++] * 16777216) + (b[p++] << 16) + (b[p++] << 8) + b[p++];

  let pdat = b.slice(p, p + dataLength);
  p += dataLength;

  if (compressed === 1) pdat = await inflateData(pdat);

  let pd = pdat, pdp = 0;
  const total = w * h;
  progressBar.value = 0;

  const chPerPx = mode === 1 ? 1 : mode === 2 ? 3 : mode === 3 ? 4 : 2;

  if (scanMode === 1) {
    const filterType = pd[pdp++];
    const rawBytes = pd.slice(pdp, pdp + total * chPerPx);
    const pixels = reconstructFilter(rawBytes, filterType, w, chPerPx);

    for (let px = 0; px < total; px++) {
      const base = px * chPerPx;
      let r = 0, g = 0, bv = 0, a = 255;
      if      (mode === 1) { r = g = bv = pixels[base]; }
      else if (mode === 2) { r = pixels[base]; g = pixels[base+1]; bv = pixels[base+2]; }
      else if (mode === 3) { r = pixels[base]; g = pixels[base+1]; bv = pixels[base+2]; a = pixels[base+3]; }
      else if (mode === 4) { r = g = bv = pixels[base]; a = pixels[base+1]; }
      img.data.set([r, g, bv, a], px * 4);
      if (px % 1000 === 0) progressBar.value = (px / total) * 100;
    }

  } else if (scanMode === 2) {
    let px = 0;
    while (pdp < pd.length && px < total) {
      let r = 0, g = 0, bv = 0, a = 255;
      if      (mode === 1) r = g = bv = pd[pdp++];
      else if (mode === 2) { r = pd[pdp++]; g = pd[pdp++]; bv = pd[pdp++]; }
      else if (mode === 3) { r = pd[pdp++]; g = pd[pdp++]; bv = pd[pdp++]; a = pd[pdp++]; }
      else if (mode === 4) { r = g = bv = pd[pdp++]; a = pd[pdp++]; }

      if (pdp >= pd.length) break;
      const seg    = pd[pdp++];
      const isFill = (seg & 0x80) !== 0;
      const count  = seg & 0x7F;

      if (isFill) {
        for (let i = 0; i < count && px < total; i++, px++)
          img.data.set([r, g, bv, a], px * 4);
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

document.getElementById("convert").onclick = async () => {
  const files = document.getElementById("pngFile").files;
  if (!files.length) return alert("PNG belum dipilih");

  const scanMode = parseInt(scanModeSelect.value);
  const creator  = creatorInput.value.trim();

  if (typeof JSZip === "undefined") await loadJSZip();
  const zip = new JSZip();

  for (let fIndex = 0; fIndex < files.length; fIndex++) {
    const f = files[fIndex];
    await new Promise(resolve => {
      const img = new Image();
      img.onload = async () => {
        const rxiData = await pngToRXI(img, scanMode, creator);
        zip.file(f.name.replace(/\.[^/.]+$/, ".rxi"), rxiData);
        resolve();
      };
      img.src = URL.createObjectURL(f);
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

async function pngToRXI(img, scanMode, creator) {
  console.log("conversion started...");
  const c  = document.createElement("canvas");
  c.width  = img.width;
  c.height = img.height;
  const cx = c.getContext("2d");
  cx.drawImage(img, 0, 0);

  const d = cx.getImageData(0, 0, c.width, c.height).data;

  let hasAlpha = false, allGray = true;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i+3] !== 255) hasAlpha = true;
    if (!(d[i] === d[i+1] && d[i] === d[i+2])) allGray = false;
  }

  let mode;
  if      (!hasAlpha && !allGray) mode = 2;
  else if (!hasAlpha &&  allGray) mode = 1;
  else if ( hasAlpha &&  allGray) mode = 4;
  else                             mode = 3;

  const total = d.length / 4;
  if (scanMode === 0) scanMode = smartDetectScanMode(d, total);

  const header = [];

  // SOF
  const RXI_CURRENT_VERSION = { major: 2, minor: 0, patch: 0 };
  header.push(0x02, 0xD0, ...asc("RXI"), ...writeVersion(
    RXI_CURRENT_VERSION.major,
    RXI_CURRENT_VERSION.minor,
    RXI_CURRENT_VERSION.patch
  ));

  // META
  if (creator) {
    header.push(...asc("META"));
    header.push(creator.length);
    header.push(...asc(creator));
    const now  = new Date();
    const year = now.getFullYear();
    header.push(now.getDate(), now.getMonth()+1, (year >> 8) & 255, year & 255);
  }

  // HDR
  header.push(
    ...asc("HDR"), mode,
    c.width >> 8, c.width & 255,
    c.height >> 8, c.height & 255,
    scanMode
  );

  // PDAT
  header.push(...asc("PDAT"));

  const pdatOut = [];

  const chPerPx = mode === 1 ? 1 : mode === 2 ? 3 : mode === 3 ? 4 : 2;

  if (scanMode === 1) {
    const rawFlat = buildRawFlat(d, mode, total);
    const { filterType, filtered } =
  await pickBestFilter(rawFlat, c.width, chPerPx);

  pdatOut.push(filterType);
  for (const byte of filtered) {
    pdatOut.push(byte);
  }

  } else if (scanMode === 2) {
    let i = 0;
    while (i < total) {
      const idx = i * 4;
      const r = d[idx], g = d[idx+1], bv = d[idx+2], a = d[idx+3];
      let fillCount = 0;

      while (i < total) {
        const id = i * 4;
        if (d[id] !== r || d[id+1] !== g || d[id+2] !== bv || d[id+3] !== a
            || fillCount >= 127) break;
        fillCount++;
        i++;
      }

      if      (mode === 1) pdatOut.push(r);
      else if (mode === 2) pdatOut.push(r, g, bv);
      else if (mode === 3) pdatOut.push(r, g, bv, a);
      else if (mode === 4) pdatOut.push(r, a);

      pdatOut.push(makeSegmentV2(true, fillCount));
    }
  }

  const compressedData = await deflateData(new Uint8Array(pdatOut));

  const pdatMeta = [
    1,
    (compressedData.length >>> 24) & 255,
    (compressedData.length >>> 16) & 255,
    (compressedData.length >>>  8) & 255,
     compressedData.length         & 255
  ];

  const headerArr    = new Uint8Array(header);
  const pdatMetaArr  = new Uint8Array(pdatMeta);

  const payloadLen = headerArr.length + pdatMetaArr.length + compressedData.length;
  const payload    = new Uint8Array(payloadLen);
  let offset = 0;
  payload.set(headerArr,      offset); offset += headerArr.length;
  payload.set(pdatMetaArr,    offset); offset += pdatMetaArr.length;
  payload.set(compressedData, offset);

  const crcBytes = writeCRC32(payload);

  const result = new Uint8Array(payloadLen + 4);
  result.set(payload,   0);
  result.set(crcBytes,  payloadLen);

  console.log(`CRC32: 0x${crc32(payload).toString(16).toUpperCase().padStart(8,"0")}`);
  return result;
}

// Utils
function asc(s) { return [...s].map(c => c.charCodeAt(0)); }
function str(b, o, l) { return String.fromCharCode(...b.slice(o, o + l)); }
function makeSegment(isFill, count) {
  return [(isFill ? 0x80 : 0x00) | ((count >> 8) & 0x7F), count & 0xFF];
}
async function deflateData(uint8) {
  const cs = new CompressionStream("deflate");
  const w  = cs.writable.getWriter();
  w.write(uint8); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
async function inflateData(uint8) {
  const ds = new DecompressionStream("deflate");
  const w  = ds.writable.getWriter();
  w.write(uint8); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
function smartDetectScanMode(d, total, sampleSize = 2000) {
  const step = Math.max(1, Math.floor(total / sampleSize));
  let sameAsNext = 0, checked = 0;
  for (let i = 0; i < total - 1; i += step) {
    const idx = i * 4, nxt = (i+1) * 4;
    if (d[idx]===d[nxt] && d[idx+1]===d[nxt+1] && d[idx+2]===d[nxt+2] && d[idx+3]===d[nxt+3])
      sameAsNext++;
    checked++;
  }
  const runRatio = sameAsNext / checked;
  console.log(`[Smart Mode] Run ratio: ${(runRatio*100).toFixed(1)}% → ScanMode ${runRatio>0.4?2:1}`);
  return runRatio > 0.4 ? 2 : 1;
}
function loadJSZip() {
  return new Promise(resolve => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    s.onload = resolve;
    document.head.appendChild(s);
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
     crc         & 0xFF
  ]);
}
function applyFilter(raw, filterType, width, ch) {
  const out = new Uint8Array(raw.length);

  const rowBytes = width * ch;

  for (let i = 0; i < raw.length; i++) {
    const x = i % rowBytes;

    const left = x >= ch ? raw[i - ch] : 0;
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
function reconstructFilter(filtered, filterType, width, ch) {
  const out = new Uint8Array(filtered.length);
  const rowBytes = width * ch;

  for (let i = 0; i < filtered.length; i++) {
    const x = i % rowBytes;

    const left = x >= ch ? out[i - ch] : 0;
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
  const ch = 4;
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
async function pickBestFilter(rawFlat, width, ch) {
  const candidates = [0, 1, 2];
  let best = null, bestScore = Infinity;

  for (const ft of candidates) {
    const filtered = applyFilter(rawFlat, ft, width, ch);

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

document.getElementById("downloadPNG").onclick = () => {
  canvas.toBlob(blob => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "image.png";
    a.click();
  }, "image/png");
};
