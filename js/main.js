(() => {
const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setClearColor(0xffffff, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(13, 1, 0.1, 80);
const LOOK_Y = 0.78;

// ---------- lights + env (for the glossy eyes) ----------
scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa48c, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(1.5, 3, 4); scene.add(key);
(() => {
  const pm = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial({ color: 0x9a9a9a, side: THREE.BackSide })));
  const panel = (w, h, x, y, z, c) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); };
  panel(3, 2, -2, 3.5, 3, 0xffffff); panel(5, 1, 0, 4.8, 0, 0xffffff); panel(2, 3, 4.5, 0.5, 1, 0xdddddd);
  scene.environment = pm.fromScene(env, 0.03).texture;
})();

// ---------- strand texture ----------
// R: dense, fine undercoat   A: sparse, long, very thin guard hairs that make the soft halo
// G: low-frequency swirl/clump field   B: per-strand tint
function makeFurTexture() {
  const S = 1024, N = S * S, data = new Uint8Array(N * 4);
  const under = new Float32Array(N), guard = new Float32Array(N), tint = new Float32Array(N).fill(0.5);
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const stamp = (buf, count, rMin, rMax, hMin, hMax, taper, withTint) => {
    for (let i = 0; i < count; i++) {
      const cx = rnd() * S, cy = rnd() * S, r = rMin + rnd() * (rMax - rMin), ht = hMin + (hMax - hMin) * Math.sqrt(rnd()), tn = rnd();
      const R = Math.ceil(r);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const px = Math.floor(cx) + dx, py = Math.floor(cy) + dy;
        const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy) / r; if (d >= 1) continue;
        const idx = ((py + S) % S) * S + ((px + S) % S);
        const v = ht * Math.pow(1 - d, taper); if (v > buf[idx]) { buf[idx] = v; if (withTint) tint[idx] = tn; }
      }
    }
  };
  stamp(under, 190000, 1.0, 2.2, 0.4, 0.74, 1.0, true);   // soft, dense undercoat
  stamp(guard, 34000, 0.85, 1.4, 0.7, 1.0, 0.55, false);     // fine wisps poking out
  const g = new Float32Array(N);
  for (let o = 0; o < 4; o++) {
    const f = 3 << o, amp = 1 / (o + 1);
    const grid = []; for (let i = 0; i < f * f; i++) grid.push(rnd());
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const gx = x / S * f, gy = y / S * f, x0 = Math.floor(gx), y0 = Math.floor(gy), tx = gx - x0, ty = gy - y0;
      const sm = t => t * t * (3 - 2 * t), G = (a, b) => grid[((b % f) * f) + (a % f)];
      const a = G(x0, y0) + (G(x0 + 1, y0) - G(x0, y0)) * sm(tx), b = G(x0, y0 + 1) + (G(x0 + 1, y0 + 1) - G(x0, y0 + 1)) * sm(tx);
      g[y * S + x] += (a + (b - a) * sm(ty)) * amp;
    }
  }
  for (let i = 0; i < N; i++) { data[i * 4] = under[i] * 255; data[i * 4 + 1] = Math.min(255, g[i] / 2.08 * 255); data[i * 4 + 2] = tint[i] * 255; data[i * 4 + 3] = guard[i] * 255; }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.needsUpdate = true;
  return t;
}
const furTex = makeFurTexture();

// ---------- fur shader: instanced shells, triplanar strands (no UV seams or poles) ----------
const furVS = `
  attribute float layer;
  uniform float furLen; uniform vec3 force; uniform float spin; uniform vec3 eyeA; uniform vec3 eyeB; uniform float eyeR;
  varying float vEye;
  varying float vH; varying vec3 vN; varying vec3 vV; varying vec3 vObjN; varying vec3 vPos; varying float vWorldY;
  void main(){
    vec3 n = normalize(normal);
    float h = layer;
    vec3 p = position + n * furLen * h + force * furLen * h * h;
    p -= spin * vec3(position.z, 0.0, -position.x) * furLen * h * h;
    vH = h; vObjN = n; vPos = position;
    float de = min(length(position - eyeA), length(position - eyeB));
    vEye = smoothstep(eyeR * 0.92, eyeR * 1.22, de);
    vN = normalize(normalMatrix * normalize(n + force * h * 0.5));
    vec4 wp = modelMatrix * vec4(p, 1.0); vWorldY = wp.y;
    vec4 mv = viewMatrix * wp;
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }`;
const furFS = `
  uniform sampler2D tex; uniform vec3 albedo; uniform vec3 rimCol; uniform float density; uniform float slant;
  uniform float groundY;
  varying float vEye;
  varying float vH; varying vec3 vN; varying vec3 vV; varying vec3 vObjN; varying vec3 vPos; varying float vWorldY;
  vec4 tri(vec3 p, vec3 w, vec2 off){
    return texture2D(tex, p.yz + off) * w.x + texture2D(tex, p.xz + off.yx) * w.y + texture2D(tex, p.xy + off) * w.z;
  }
  void main(){
    float h = vH;
    vec3 w = pow(abs(vObjN), vec3(8.0)); w /= (w.x + w.y + w.z);
    vec3 p = vPos * density;
    // swirl: strands lean in a slowly varying direction, so the coat looks combed and wispy
    float sw = (texture2D(tex, p.xy * 0.3 + p.z * 0.2).g + texture2D(tex, p.zy * 0.3 + 0.5).g) * 9.42;
    vec2 dir = vec2(cos(sw), sin(sw));
    vec2 off = dir * slant * h;
    vec4 t = tri(p, w, off);
    // guard hairs lean further and wave a little, so the outer layer reads as loose, soft wisps
    vec2 wave = vec2(sin(h * 7.0 + sw * 3.0), cos(h * 6.0 + sw * 2.0)) * 0.004 * h;
    float gA = tri(p * 1.0, w, dir * slant * 1.7 * h + wave).a;
    #ifdef BASE
      float a = 1.0;
    #else
      float tuft = texture2D(tex, (vPos.xy + vPos.zx * 0.7) * density * 0.9).g;
      float eyeK = mix(0.22, 1.0, vEye);
      float under = smoothstep(h - 0.03, h + 0.11, t.r * (0.8 + 0.34 * tuft) * eyeK);
      float wisp = smoothstep(h - 0.02, h + 0.06, gA * eyeK) * 0.7;
      float a = max(under, wisp);
      a *= 1.0 - smoothstep(0.45, 1.0, h) * 0.7;   // tips thin out into a soft haze
      if (a < 0.02) discard;
    #endif
    vec3 N = normalize(vN), V = normalize(vV);
    vec3 L = normalize(vec3(0.55, 0.75, 0.5));
    float key = clamp((dot(N, L) + 0.7) / 1.7, 0.0, 1.0);
    float sky = clamp(vObjN.y * 0.5 + 0.5, 0.0, 1.0);
    float ao = mix(0.8, 1.0, pow(h, 0.5));
    ao = mix(0.93, ao, vEye);   // no shadowy ring around the eyes: keep the fur there bright and clean
    float contact = mix(0.7, 1.0, smoothstep(groundY + 0.02, groundY + 0.5, vWorldY));
    vec3 col = albedo * (0.68 + 0.36 * key + 0.06 * sky) * ao * contact;
    col *= 0.95 + 0.1 * t.b;
    #ifndef BASE
    col *= mix(0.93, 1.07, clamp(max(t.r, gA) * 1.3, 0.0, 1.0));   // strand cores catch light, gaps fall into shade
    col = mix(col, rimCol, smoothstep(0.55, 1.0, h) * 0.22);           // lighter, translucent tips
    #endif
    // bright rim from the right/back, like the studio fill in the reference
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.2);
    float side = clamp(dot(N, normalize(vec3(1.0, 0.15, -0.1))) * 0.5 + 0.5, 0.0, 1.0);
    col += rimCol * fres * (0.3 + 0.7 * side) * h;
    col += vec3(0.9, 1.0, 0.7) * pow(max(dot(N, normalize(L + V)), 0.0), 10.0) * 0.06 * h;
    // light scattering through the thin tips: a soft velvet glow
    col += albedo * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 1.4) * 0.16 * smoothstep(0.3, 1.0, h);
    gl_FragColor = vec4(col, a);
  }`;

const ALBEDO = 0xb8f42c, RIM = 0xe6ff8c;
function furred(geo, { len, shells, density = 1.7, slant = 0.03 }) {
  const uniforms = {
    tex: { value: furTex }, furLen: { value: len }, force: { value: new THREE.Vector3(0, -0.3, 0) },
    density: { value: density }, slant: { value: slant }, groundY: { value: 0 }, spin: { value: 0 },
    eyeA: { value: new THREE.Vector3(99, 99, 99) }, eyeB: { value: new THREE.Vector3(99, 99, 99) }, eyeR: { value: 0.1 },
    albedo: { value: new THREE.Color(ALBEDO) }, rimCol: { value: new THREE.Color(RIM) },
  };
  const mk = (layers, isBase) => {
    const ig = new THREE.InstancedBufferGeometry();
    ig.index = geo.index;
    ['position', 'normal'].forEach(k => ig.setAttribute(k, geo.getAttribute(k)));
    ig.setAttribute('layer', new THREE.InstancedBufferAttribute(new Float32Array(layers), 1));
    ig.instanceCount = layers.length;
    const mat = new THREE.ShaderMaterial({
      uniforms, vertexShader: furVS, fragmentShader: furFS,
      defines: isBase ? { BASE: 1 } : {}, transparent: !isBase, depthWrite: isBase,
    });
    const m = new THREE.Mesh(ig, mat); m.frustumCulled = false; m.renderOrder = isBase ? 0 : 10;
    return m;
  };
  const g = new THREE.Group();
  const layers = []; for (let i = 1; i <= shells; i++) layers.push(i / shells);
  g.add(mk([0], true)); g.add(mk(layers, false));
  g.userData.uniforms = uniforms;
  return g;
}

// ---------- body: rebuilt from the reference silhouette ----------
// Rows traced from the source image: [pixelY, leftX, rightX]. 500px = 1 world unit.
const PX = 500, CX = 655, GY = 1060, DEPTH = 0.82;
// Silhouette traced from the reference image, eroded by the fur depth: [pixelY, leftX, rightX]. 500px = 1 world unit.
const ctrl = [[363,615,642],[367,595,665],[371,571,691],[375,563,699],[379,557,710],[383,557,724],[387,555,728],[391,553,738],[395,550,744],[399,548,749],[403,545,754],[407,543,759],[411,540,764],[415,488,771],[419,484,776],[423,481,778],[427,479,781],[431,475,785],[435,469,788],[439,466,793],[443,463,796],[447,459,799],[451,456,802],[455,453,803],[459,449,805],[463,447,808],[467,444,812],[471,439,813],[475,436,816],[479,434,818],[483,432,820],[487,429,821],[491,426,822],[495,424,824],[499,423,827],[503,421,829],[507,418,830],[511,415,831],[515,412,832],[519,410,834],[523,409,835],[527,408,837],[531,405,839],[535,404,840],[539,401,841],[543,400,840],[547,399,841],[551,398,842],[555,396,845],[559,393,847],[563,392,847],[567,391,847],[571,389,849],[575,387,851],[579,385,852],[583,385,853],[587,383,853],[591,382,855],[595,380,857],[599,379,859],[603,377,861],[607,375,862],[611,375,865],[615,374,867],[619,373,869],[623,372,872],[627,370,875],[631,369,879],[635,368,882],[639,366,887],[643,364,894],[647,363,898],[651,362,903],[655,360,909],[659,358,913],[663,357,921],[667,357,926],[671,355,930],[675,353,936],[679,352,939],[683,351,942],[687,349,947],[691,348,953],[695,346,955],[699,345,957],[703,344,960],[707,342,964],[711,340,965],[715,339,966],[719,339,968],[723,338,971],[727,337,975],[731,335,976],[735,333,979],[739,331,979],[743,330,980],[747,329,981],[751,328,983],[755,326,986],[759,325,989],[763,324,988],[767,322,989],[771,321,989],[775,321,991],[779,321,993],[783,320,992],[787,319,992],[791,318,992],[795,317,993],[799,316,994],[803,315,994],[807,316,994],[811,315,994],[815,314,995],[819,315,995],[823,315,994],[827,314,993],[831,313,993],[835,315,993],[839,315,992],[843,315,991],[847,315,991],[851,315,990],[855,315,988],[859,315,987],[863,316,984],[867,317,983],[871,316,982],[875,317,982],[879,318,980],[883,318,979],[887,319,976],[891,320,973],[895,322,970],[899,323,969],[903,325,967],[907,326,964],[911,327,962],[915,330,962],[919,331,959],[923,332,956],[927,335,953],[931,338,951],[935,339,947],[939,340,943],[943,342,940],[947,345,938],[951,348,934],[955,352,931],[959,355,928],[963,357,924],[967,358,920],[971,365,916],[975,369,914],[979,371,909],[983,377,906],[987,383,900],[991,388,897],[995,395,893],[999,400,888],[1003,407,884],[1007,417,881],[1011,422,876],[1015,432,869],[1019,441,865],[1023,449,857],[1027,462,853],[1031,713,845],[1035,725,838],[1039,731,827],[1042,767,798]];
const lerpCtrl = (y, k) => { for (let i = 0; i < ctrl.length - 1; i++) { const A = ctrl[i], B = ctrl[i + 1]; if (y >= A[0] && y <= B[0]) { const t = (y - A[0]) / (B[0] - A[0] || 1); return A[k] + (B[k] - A[k]) * t; } } return y < ctrl[0][0] ? ctrl[0][k] : ctrl[ctrl.length - 1][k]; };
const rows = [];
{
  const y0 = ctrl[0][0], y1 = ctrl[ctrl.length - 1][0], STEP = 3;
  const ys = []; for (let y = y0; y <= y1; y += STEP) ys.push(y);
  const raw = ys.map(y => [lerpCtrl(y, 1), lerpCtrl(y, 2)]);
  const smooth = (f, sig) => ys.map((_, i) => { let v = 0, W = 0; const R = Math.ceil(3 * sig / STEP);
    for (let j = -R; j <= R; j++) { const k = Math.min(ys.length - 1, Math.max(0, i + j)); const w = Math.exp(-((j * STEP) ** 2) / (2 * sig * sig)); v += f(k) * w; W += w; } return v / W; });
  const Ls = smooth(k => raw[k][0], 4), Rs = smooth(k => raw[k][1], 4), Lsoft = smooth(k => raw[k][0], 14);
  const Rsoft = smooth(k => raw[k][1], 14);
  ys.forEach((y, i) => { const w = 1 - sstep(430, 500, y); Ls[i] += (Lsoft[i] - Ls[i]) * w; Rs[i] += (Rsoft[i] - Rs[i]) * w; });
  // the depth and the core axis follow a much smoother profile, so the side lobe only bulges sideways
  const coreC = smooth(k => (raw[k][0] + raw[k][1]) / 2, 45);
  const coreH = smooth(k => (raw[k][1] - raw[k][0]) / 2, 28);
  ys.forEach((y, i) => {
    const edge = (i === 0 || i === ys.length - 1) ? 0 : Math.sqrt(Math.min(1, Math.min(i, ys.length - 1 - i) / 6));
    const mid = (Ls[i] + Rs[i]) / 2, hw = Math.max(0.5, (Rs[i] - Ls[i]) / 2) * edge;
    const L = mid - hw, R = mid + hw;
    const c = Math.min(R - 0.3 * hw, Math.max(L + 0.3 * hw, coreC[i]));
    rows.push({ y: (GY - y) / PX, L: (L - CX) / PX, R: (R - CX) / PX, c: (c - CX) / PX, b: Math.max(0.0005, Math.min(coreH[i], hw * 1.15 + 2) * DEPTH / PX) });
  });
}
const ringAt = (y) => { // rows run top→bottom (y descending)
  for (let i = 0; i < rows.length - 1; i++) {
    const A = rows[i], B = rows[i + 1];
    if (y <= A.y && y >= B.y) { const t = (A.y - y) / (A.y - B.y || 1); const m = k => A[k] + (B[k] - A[k]) * t; return { L: m('L'), R: m('R'), c: m('c'), b: m('b') }; }
  }
  return rows[0];
};
const ringU = (r, x) => x >= r.c ? (x - r.c) / Math.max(1e-4, r.R - r.c) : (x - r.c) / Math.max(1e-4, r.c - r.L);
const surfaceZ = (x, y) => { const r = ringAt(y); const u = ringU(r, x); return r.b * Math.sqrt(Math.max(0, 1 - u * u)); };
// lower-right lobe sits a touch lower than the middle of the base (bean silhouette)
const lobeDrop = () => 0;
function sstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

const SEG = 128;
const bodyGeo = (() => {
  const pos = [], idx = [];
  pos.push(rows[0].c, rows[0].y + 0.002, 0); // top pole
  rows.forEach(r => { for (let j = 0; j < SEG; j++) { const th = j / SEG * Math.PI * 2, sn = Math.sin(th); const x = r.c + sn * (sn >= 0 ? r.R - r.c : r.c - r.L); pos.push(x, r.y - lobeDrop(x, r.y), Math.cos(th) * r.b); } });
  const last = rows[rows.length - 1]; pos.push(last.c, last.y - 0.002, 0); // bottom pole
  const ring = i => 1 + i * SEG, nR = rows.length, bottom = 1 + nR * SEG;
  for (let j = 0; j < SEG; j++) idx.push(0, ring(0) + j, ring(0) + (j + 1) % SEG);
  for (let i = 0; i < nR - 1; i++) for (let j = 0; j < SEG; j++) {
    const a = ring(i) + j, b = ring(i) + (j + 1) % SEG, c = ring(i + 1) + j, d = ring(i + 1) + (j + 1) % SEG;
    idx.push(a, c, b, b, c, d);
  }
  for (let j = 0; j < SEG; j++) idx.push(ring(nR - 1) + j, bottom, ring(nR - 1) + (j + 1) % SEG);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
})();
const toW = (px, py) => new THREE.Vector2((px - CX) / PX, (GY - py) / PX);

const root = new THREE.Group(); scene.add(root);
const squash = new THREE.Group(); root.add(squash);
const body = furred(bodyGeo, { len: 0.085, shells: 72, density: 0.68, slant: 0.018 });
squash.add(body);

// ---------- antenna: thick fuzzy stalk + pom-pom (traced from the reference) ----------
const aBase = toW(522, 412), aMid = toW(500, 372), aTop = toW(474, 338), aBall = toW(458, 310);
const zBase = surfaceZ(aBase.x, aBase.y) * 0.85;
const antenna = new THREE.Group();
antenna.position.set(aBase.x, aBase.y, zBase);
squash.add(antenna);
const rel = (v, z) => new THREE.Vector3(v.x - aBase.x, v.y - aBase.y, z - zBase);
const curve = new THREE.CatmullRomCurve3([rel(aBase, zBase) .add(new THREE.Vector3(0.02, -0.05, -0.02)), rel(aBase, zBase), rel(aMid, zBase * 0.95), rel(aTop, zBase * 0.9)]);
const stalk = furred(new THREE.TubeGeometry(curve, 40, 0.025, 18, false), { len: 0.036, shells: 28, density: 0.85, slant: 0.012 });
antenna.add(stalk);
const ball = furred(new THREE.SphereGeometry(0.088, 64, 40), { len: 0.055, shells: 40, density: 0.85, slant: 0.016 });
ball.position.copy(rel(aBall, zBase * 0.85));
antenna.add(ball);

// ---------- eyes (positions and sizes traced from the reference) ----------
const scleraMat = new THREE.ShaderMaterial({
  vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying vec3 vN; varying vec3 vV; void main(){
    vec3 N = normalize(vN), V = normalize(vV), L = normalize(vec3(0.45, 0.7, 0.6));
    float facing = clamp(dot(N, V), 0.0, 1.0);
    float diff = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = vec3(0.985) * mix(0.72, 1.0, pow(facing, 0.55)) * mix(0.86, 1.02, diff);
    col += vec3(1.0) * pow(max(dot(N, normalize(L + V)), 0.0), 60.0) * 0.25;
    gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
  }`,
});
const pupilMat = new THREE.MeshPhysicalMaterial({ color: 0x030303, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4 });
const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const eyes = [];
[
  { c: toW(573, 643), rx: 0.09, ry: 0.11, rest: [0.0, 0.16] },
  { c: toW(725, 628), rx: 0.086, ry: 0.106, rest: [0.0, -0.02] },
].forEach(({ c, rx, ry, rest }) => {
  const z = surfaceZ(c.x, c.y);
  const r = ringAt(c.y), u = ringU(r, c.x), hw = c.x >= r.c ? r.R - r.c : r.c - r.L;
  const n = new THREE.Vector3(u / hw, 0.15, (z / r.b) / r.b).normalize();
  const socket = new THREE.Group();
  socket.position.set(c.x, c.y, z + 0.008);
  socket.lookAt(socket.position.clone().add(n.clone().lerp(new THREE.Vector3(0, 0, 1), 0.65)));
  const shapeG = new THREE.Group(); shapeG.scale.set(rx, ry, 0.06); socket.add(shapeG);
  const ballG = new THREE.Group(); shapeG.add(ballG);
  const sclera = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), scleraMat);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), pupilMat);
  pupil.scale.set(0.5, 0.66, 0.36); pupil.position.z = 0.78;
  ballG.add(sclera, pupil);
  const glint = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), glintMat);
  glint.scale.set(0.017, 0.02, 0.006);
  glint.position.set(0.016, 0.03, 0.062);
  socket.add(glint);
  squash.add(socket);
  eyes.push({ socket, ball: ballG, yaw: rest[1], pitch: rest[0], rest });
});
body.userData.uniforms.eyeA.value.copy(eyes[0].socket.position);
body.userData.uniforms.eyeB.value.copy(eyes[1].socket.position);
body.userData.uniforms.eyeR.value = 0.112;

// ---------- contact shadow ----------
function shadowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(40,52,30,0.7)'); gr.addColorStop(0.35, 'rgba(40,52,30,0.34)');
  gr.addColorStop(0.7, 'rgba(40,52,30,0.07)'); gr.addColorStop(1, 'rgba(40,52,30,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}
const st = shadowTex();
const mkShadow = (w, d, o) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false, opacity: o }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.001; m.renderOrder = -1; scene.add(m); return m;
};
const softShadow = mkShadow(2.4, 1.1, 0.7);
const coreShadow = mkShadow(1.45, 0.5, 0.75);
softShadow.position.x = coreShadow.position.x = 0.1;

// ---------- pointer: eyes follow it, dragging spins the character ----------
const pointer = new THREE.Vector2(0, 0.1);
let pointerActive = false, lastMove = 0;
let dragging = false, dragId = null, lastX = 0, lastY = 0, lastT = 0;
let rotY = 0, rotV = 0;            // spin around the vertical axis (rad, rad/s)
let elev = 0.02, elevTarget = 0.02; // camera height angle for vertical drag
const ndc = (e) => {
  const r = canvas.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  pointerActive = true; lastMove = performance.now();
};
canvas.addEventListener('pointerdown', (e) => {
  ndc(e); dragging = true; dragId = e.pointerId; lastX = e.clientX; lastY = e.clientY; lastT = performance.now();
  rotV = 0; canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging');
});
window.addEventListener('pointermove', (e) => {
  ndc(e);
  if (!dragging || e.pointerId !== dragId) return;
  const now = performance.now(), dts = Math.max(1, now - lastT) / 1000;
  const unit = 2 * Math.PI / Math.max(320, Math.min(window.innerWidth, 900)); // one screen-width drag ≈ one turn
  const dRot = (e.clientX - lastX) * unit;
  rotY += dRot;
  rotV = rotV * 0.6 + (dRot / dts) * 0.4;
  elevTarget = THREE.MathUtils.clamp(elevTarget + (e.clientY - lastY) * 0.004, -0.08, 0.6);
  lastX = e.clientX; lastY = e.clientY; lastT = now;
}, { passive: true });
const endDrag = (e) => {
  if (!dragging || (e && e.pointerId !== dragId)) return;
  dragging = false; canvas.classList.remove('dragging');
  if (performance.now() - lastT > 80) rotV = 0; // held still before letting go: no fling
};
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
document.addEventListener('pointerleave', () => { pointerActive = false; });
window.addEventListener('keydown', (e) => { // keyboard: arrow keys spin it too
  if (e.key === 'ArrowLeft') rotV -= 3; if (e.key === 'ArrowRight') rotV += 3;
  if (e.key === 'ArrowUp') elevTarget = Math.max(-0.08, elevTarget - 0.1); if (e.key === 'ArrowDown') elevTarget = Math.min(0.6, elevTarget + 0.1);
});

// ---------- motion state ----------
let sq = 0, sqV = 0;                          // gentle breathing
let furSpin = 0, furSpinV = 0;                // fur lag while spinning
let antX = 0, antXV = 0, antZ = 0, antZV = 0;  // antenna spring
let blinkT = 2.5, blink = 0;

const ray = new THREE.Raycaster(), lookPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -1.6);
const target = new THREE.Vector3(), tmp = new THREE.Vector3();
let camDist = 10;

function placeCamera() {
  camera.position.set(0, LOOK_Y + Math.sin(elev) * camDist, Math.cos(elev) * camDist);
  camera.lookAt(0, LOOK_Y, 0);
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const fitH = 2.5, fitW = 2.15;                       // world units to keep in frame
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const distH = fitH / 2 / Math.tan(vFov / 2);
  const distW = fitW / 2 / (Math.tan(vFov / 2) * camera.aspect);
  camDist = Math.max(distH, distW);
  placeCamera();
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

const clock = new THREE.Clock();
let time = 0;
function step(dt) {
  time += dt;
  // --- spin with inertia ---
  if (!dragging) { rotY += rotV * dt; rotV *= Math.exp(-dt * 2.2); if (Math.abs(rotV) < 0.01) rotV = 0; }
  rotV = THREE.MathUtils.clamp(rotV, -14, 14);
  root.rotation.y = rotY;
  elev += (elevTarget - elev) * Math.min(1, dt * 8);
  placeCamera();
  const w = dragging ? rotV * Math.exp(-(performance.now() - lastT) / 120) : rotV; // angular speed now

  // breathing
  const sqTarget = Math.sin(time * 2.4) * 0.018;
  sqV += (-(sq - sqTarget) * 300 - sqV * 13) * dt; sq += sqV * dt;
  squash.scale.set(1 - sq * 0.55, 1 + sq, 1 - sq * 0.55);

  // fur lags behind the spin and settles with a little overshoot when it stops
  furSpinV += (-(furSpin - THREE.MathUtils.clamp(w, -9, 9) * 0.09) * 70 - furSpinV * 9) * dt; furSpin += furSpinV * dt;
  body.userData.uniforms.spin.value = furSpin;
  body.userData.uniforms.force.value.set(0, -0.32, 0);
  stalk.userData.uniforms.force.value.set(0, -0.2, 0);
  // antenna swings outward and trails when spun
  const aTarget = THREE.MathUtils.clamp(w, -10, 10);
  antXV += (-(antX - aTarget * 0.028) * 110 - antXV * 7) * dt; antX += antXV * dt;
  const swayTarget = Math.sin(time * 1.7) * 0.04 + aTarget * 0.012;
  antZV += (-(antZ - swayTarget) * 80 - antZV * 6) * dt; antZ += antZV * dt;
  antenna.rotation.set(antX, 0, antZ);
  ball.userData.uniforms.force.value.set(-antZ, -0.32, -antX * 0.6);

  // --- where to look ---
  if (!pointerActive || performance.now() - lastMove > 4000) {
    const t = time * 0.35;
    pointer.x += ((Math.sin(t * 1.3) * 0.55) - pointer.x) * dt * 1.2;
    pointer.y += ((Math.sin(t * 0.9 + 1.2) * 0.25 + 0.1) - pointer.y) * dt * 1.2;
  }
  camera.updateMatrixWorld();
  ray.setFromCamera(pointer, camera);
  ray.ray.intersectPlane(lookPlane, target);
  root.updateMatrixWorld(true);
  eyes.forEach(e => {
    tmp.copy(target); e.socket.worldToLocal(tmp);
    const facing = tmp.z > 0; // when it faces away, eyes relax to center
    const yaw = facing ? THREE.MathUtils.clamp(Math.atan2(tmp.x, tmp.z), -0.62, 0.62) : 0;
    const pitch = facing ? THREE.MathUtils.clamp(Math.atan2(-tmp.y, Math.hypot(tmp.x, tmp.z)), -0.5, 0.5) : 0;
    const k = Math.min(1, dt * 14);
    e.yaw += (yaw - e.yaw) * k; e.pitch += (pitch - e.pitch) * k;
    e.ball.rotation.set(e.pitch, e.yaw, 0);
  });
  // blink
  blinkT -= dt;
  if (blinkT <= 0) { blink = 0.16; blinkT = 2.4 + Math.random() * 3.2; if (Math.random() < 0.25) blinkT = 0.28; }
  let lid = 1;
  if (blink > 0) { blink -= dt; const b = 1 - Math.abs(blink / 0.16 * 2 - 1); lid = 1 - b * 0.9; }
  eyes.forEach(e => e.socket.scale.set(1, lid, 1));

  // shadow stays under the body as it turns
  softShadow.position.x = coreShadow.position.x = 0.1 * Math.cos(rotY);
  softShadow.position.z = coreShadow.position.z = -0.1 * Math.sin(rotY);
}

function loop() {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  // sub-step the springs for stability on low frame rates
  const n = 2; for (let i = 0; i < n; i++) step(dt / n);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
// debug hook
window.__fuzzy = { step, render: () => renderer.render(scene, camera), state: () => ({ rotY, rotV, elev }) };
loop();
})();
