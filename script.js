const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

/* ================= RVX READER ================= */
document.getElementById("rvxFile").onchange = e => {
  const f = e.target.files[0];
  const r = new FileReader();
  r.onload = () => parseRVX(new Uint8Array(r.result));
  r.readAsArrayBuffer(f);
};

function parseRVX(b) {
  let p = 0;

  // SOF
  if (b[p++] !== 0x02 || b[p++] !== 0xD0) return alert("Invalid SOF");
  if (str(b,p,3) !== "RVX") return alert("Invalid RVX");
  p += 3;
  p += 3; // \n\n\n

  // HDR
  if (str(b,p,3) !== "HDR") return alert("HDR missing");
  p += 3;

  const mode = b[p++];
  const w = (b[p++] << 8) | b[p++];
  const h = (b[p++] << 8) | b[p++];

  canvas.width = w;
  canvas.height = h;

  const img = ctx.createImageData(w, h);
  img.data.fill(0);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;

  // PDAT
  if (str(b,p,4) !== "PDAT") return alert("PDAT missing");
  p += 4;

  const total = w * h;

  while (p < b.length) {
    if (str(b,p,3) === "END") break;

    const start =
      (b[p++] << 24) | (b[p++] << 16) | (b[p++] << 8) | b[p++];
    const end =
      (b[p++] << 24) | (b[p++] << 16) | (b[p++] << 8) | b[p++];

    let r=0,g=0,bb=0,a=255;

    if (mode === 1) {
      r=g=bb=b[p++];
    } else if (mode === 2) {
      r=b[p++]; g=b[p++]; bb=b[p++];
    } else if (mode === 3) {
      r=b[p++]; g=b[p++]; bb=b[p++]; a=b[p++];
    } else if (mode === 4) {
      r=g=bb=b[p++]; a=b[p++];
    } else {
      return alert("Unknown mode");
    }

    for (let px = start; px <= end && px < total; px++) {
      const i = px * 4;
      img.data.set([r,g,bb,a], i);
    }
  }

  ctx.putImageData(img,0,0);
}

/* ================= PNG → RVX ================= */
document.getElementById("convert").onclick = () => {
  const f = document.getElementById("pngFile").files[0];
  if (!f) return alert("PNG belum dipilih");

  const img = new Image();
  img.onload = () => pngToRVX(img);
  img.src = URL.createObjectURL(f);
};

function pngToRVX(img) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const cx = c.getContext("2d");
  cx.drawImage(img,0,0);

  const d = cx.getImageData(0,0,c.width,c.height).data;

  let hasAlpha = false;
  let allGray = true;

  for (let i=0;i<d.length;i+=4) {
    if (d[i+3] !== 255) hasAlpha = true;
    if (!(d[i]===d[i+1] && d[i]===d[i+2])) allGray = false;
  }

  let mode;
  if (!hasAlpha && !allGray) mode = 2;
  else if (!hasAlpha && allGray) mode = 1;
  else if (hasAlpha && allGray) mode = 4;
  else mode = 3;

  const out = [];

  // SOF
  out.push(0x02,0xD0, ...asc("RVX"), 0x0A,0x0A,0x0A);

  // HDR
  out.push(...asc("HDR"), mode);
  out.push(c.width>>8, c.width&255);
  out.push(c.height>>8, c.height&255);

  // PDAT
  out.push(...asc("PDAT"));

  let i = 0;
  while (i < d.length) {
    const start = i / 4;
    const r = d[i], g = d[i+1], b = d[i+2], a = d[i+3];

    let j = i + 4;
    while (j < d.length &&
      d[j]===r && d[j+1]===g &&
      d[j+2]===b && d[j+3]===a
    ) j += 4;

    const end = (j/4)-1;

    out.push(
      start>>24 &255, start>>16 &255, start>>8 &255, start&255,
      end>>24 &255, end>>16 &255, end>>8 &255, end&255
    );

    if (mode === 1) out.push(r);
    else if (mode === 2) out.push(r,g,b);
    else if (mode === 3) out.push(r,g,b,a);
    else if (mode === 4) out.push(r,a);

    i = j;
  }

  // END
  out.push(...asc("END "),0xF0,0x9F,0x97,0xBF);

  download(new Uint8Array(out), "image.rvx");
}

/* ================= Utils ================= */
function asc(s){ return [...s].map(c=>c.charCodeAt(0)); }
function str(b,o,l){ return String.fromCharCode(...b.slice(o,o+l)); }

function download(buf,name){
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([buf]));
  a.download=name;
  a.click();
}

document.getElementById("downloadPNG").onclick = () => {
  canvas.toBlob(blob => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "image.png";
    a.click();
  }, "image/png");
};
