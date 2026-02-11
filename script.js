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
  p += 3;

  // HDR
  if (str(b,p,3) !== "HDR") return alert("HDR missing");
  p += 3;

  const mode = b[p++];
  const w = (b[p++] << 8) | b[p++];
  const h = (b[p++] << 8) | b[p++];
  const scanMode = b[p++]; // 01=all pixel, 02=multi-range

  canvas.width = w;
  canvas.height = h;

  const img = ctx.createImageData(w,h);
  img.data.fill(0);
  for(let i=3;i<img.data.length;i+=4) img.data[i]=255;

  // PDAT
  if(str(b,p,4)!=="PDAT") return alert("PDAT missing");
  p+=4;

  const total = w*h;

  if(scanMode===1){
    for(let px=0;px<total;px++){
      let r=0,g=0,bb=0,a=255;
      if(mode===1){ r=g=bb=b[p++]; }
      else if(mode===2){ r=b[p++]; g=b[p++]; bb=b[p++]; }
      else if(mode===3){ r=b[p++]; g=b[p++]; bb=b[p++]; a=b[p++]; }
      else if(mode===4){ r=g=bb=b[p++]; a=b[p++]; }
      const i = px*4;
      img.data.set([r,g,bb,a],i);
    }
  } else if(scanMode===2){
    while(p<b.length){
      if(str(b,p,3)==="END") break;
      if(b[p++]!==0x52 || b[p++]!==0x4E) return alert("RN missing");

      const rangeCount = (b[p++]<<8)|b[p++];
      const ranges=[];
      for(let r=0;r<rangeCount;r++){
        const start=(b[p++]<<24)|(b[p++]<<16)|(b[p++]<<8)|b[p++];
        const end  =(b[p++]<<24)|(b[p++]<<16)|(b[p++]<<8)|b[p++];
        ranges.push([start,end]);
      }

      let r=0,g=0,bb=0,a=255;
      if(mode===1){ r=g=bb=b[p++]; }
      else if(mode===2){ r=b[p++]; g=b[p++]; bb=b[p++]; }
      else if(mode===3){ r=b[p++]; g=b[p++]; bb=b[p++]; a=b[p++]; }
      else if(mode===4){ r=g=bb=b[p++]; a=b[p++]; }

      for(const [start,end] of ranges){
        for(let px=start; px<=end && px<total; px++){
          const i=px*4;
          img.data.set([r,g,bb,a],i);
        }
      }
    }
  } else return alert("Unknown scan mode");

  ctx.putImageData(img,0,0);
}

/* ================= PNG → RVX ================= */
document.getElementById("convert").onclick = () => {
  const f = document.getElementById("pngFile").files[0];
  if(!f) return alert("PNG belum dipilih");

  const scanMode = parseInt(document.getElementById("scanMode").value);

  const img = new Image();
  img.onload = ()=>pngToRVX(img, scanMode);
  img.src = URL.createObjectURL(f);
};

function pngToRVX(img, scanMode){
  const c=document.createElement("canvas");
  c.width=img.width;
  c.height=img.height;
  const cx=c.getContext("2d");
  cx.drawImage(img,0,0);

  const d=cx.getImageData(0,0,c.width,c.height).data;

  let hasAlpha=false, allGray=true;
  for(let i=0;i<d.length;i+=4){
    if(d[i+3]!==255) hasAlpha=true;
    if(!(d[i]===d[i+1] && d[i]===d[i+2])) allGray=false;
  }

  let mode;
  if(!hasAlpha && !allGray) mode=2;
  else if(!hasAlpha && allGray) mode=1;
  else if(hasAlpha && allGray) mode=4;
  else mode=3;

  const out=[];
  // SOF
  out.push(0x02,0xD0,...asc("RVX"),0x0A,0x0A,0x0A);
  // HDR
  out.push(...asc("HDR"), mode, c.width>>8,c.width&255, c.height>>8,c.height&255, scanMode);
  // PDAT
  out.push(...asc("PDAT"));

  const total=d.length/4;

  if(scanMode===1){
    for(let i=0;i<d.length;i+=4){
      const r=d[i],g=d[i+1],bb=d[i+2],a=d[i+3];
      if(mode===1) out.push(r);
      else if(mode===2) out.push(r,g,bb);
      else if(mode===3) out.push(r,g,bb,a);
      else if(mode===4) out.push(r,a);
    }
  } else if(scanMode===2){
    const visited = new Map();

    for(let i=0;i<total;i++){
      const idx=i*4;
      const key = `${d[idx]}_${d[idx+1]}_${d[idx+2]}_${d[idx+3]}`;
      if(!visited.has(key)) visited.set(key,[]);
      visited.get(key).push(i);
    }

    for(const [key, pixels] of visited){
      const ranges=[];
      let start=pixels[0], prev=start;
      for(let k=1;k<pixels.length;k++){
        if(pixels[k]===prev+1){
          prev=pixels[k];
        } else {
          ranges.push([start,prev]);
          start=prev=pixels[k];
        }
      }
      ranges.push([start,prev]);

      const [r,g,bb,a] = key.split("_").map(Number);

      // push RN block
      out.push(0x52,0x4E);
      out.push(ranges.length>>8 &0xFF, ranges.length&0xFF);
      for(const [s,e] of ranges){
        out.push(s>>24&255,s>>16&255,s>>8&255,s&255);
        out.push(e>>24&255,e>>16&255,e>>8&255,e&255);
      }

      if(mode===1) out.push(r);
      else if(mode===2) out.push(r,g,bb);
      else if(mode===3) out.push(r,g,bb,a);
      else if(mode===4) out.push(r,a);
    }
  }

  // END
  out.push(...asc("END "),0xF0,0x9F,0x97,0xBF);
  download(new Uint8Array(out),"image.rvx");
}

/* ================= Utils ================= */
function asc(s){return [...s].map(c=>c.charCodeAt(0));}
function str(b,o,l){return String.fromCharCode(...b.slice(o,o+l));}

function download(buf,name){
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([buf]));
  a.download=name;
  a.click();
}

document.getElementById("downloadPNG").onclick = ()=>{
  canvas.toBlob(blob=>{
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download="image.png";
    a.click();
  },"image/png");
};
