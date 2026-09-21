// 절차적 도시 레이아웃 생성: 도로망(그래프), 블록, 건물, 공원/숲, 강, 지하철
import { fbm2, hash2, mulberry32, smoothstep } from './noise.js';

export const P = 110;            // 블록 피치 (m)
export const N = 34;             // 격자 반경 (셀 수) → ±3740m
export const WIDE_W = 34;        // 대로 폭
export const NARROW_W = 12;      // 골목 폭
export const SIDEWALK = 4;       // 인도 폭
export const RIVER_HALF = 45;    // 강 반폭
export const RIVER_BANK = 40;    // 강둑 경사 폭
export const WORLD = 12000;      // 전체 지형 크기 (m)
export const SLAB_H = 0.35;      // 블록 슬래브 높이
export const RIVER_DEPTH = 14;   // 강바닥 깊이 (지반 대비)
export const WATER_Y = -6;       // 수면 높이
export const BRIDGE_H = 5;       // 교량 상판 높이
export const BRIDGE_RAMP = 40;   // 교량 경사로 길이
// 교량 엣지의 종단 프로파일: 양끝 경사로 → 평탄 상판
export function bridgeY(len, t) {
  const s = (x) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
  return BRIDGE_H * s(t / BRIDGE_RAMP) * s((len - t) / BRIDGE_RAMP);
}

export const isWide = (k) => ((k % 5) + 5) % 5 === 0;
export const roadWidth = (k) => (isWide(k) ? WIDE_W : NARROW_W);

const riverMemo = new Map();
export function riverX(z) {
  let v = riverMemo.get(z);
  if (v !== undefined) return v;
  v = 700 + 520 * Math.sin(z / 1500) + 320 * Math.sin(z / 640 + 1.7) + 900 * (fbm2(z * 0.0004, 3.7, 3, 9) - 0.5);
  if (riverMemo.size < 200000) riverMemo.set(z, v);
  return v;
}
export function riverDist(x, z) {
  const xr = riverX(z);
  const slope = (riverX(z + 10) - riverX(z - 10)) / 20;
  return Math.abs(x - xr) / Math.sqrt(1 + slope * slope);
}
export function cityValue(x, z) {
  const d = Math.hypot(x * 0.95, z * 1.05);
  return 1 - d / 2900 + 0.55 * (fbm2(x * 0.00045 + 10, z * 0.00045 + 10, 3, 5) - 0.5);
}
export const inCity = (x, z) => cityValue(x, z) > 0;
export function downtown(x, z) {
  const dx = (x - 350) / 1300, dz = (z + 250) / 1100;
  const a = Math.exp(-(dx * dx + dz * dz));
  const bx = (x + 1500) / 700, bz = (z - 1400) / 700;
  const b = 0.6 * Math.exp(-(bx * bx + bz * bz));
  return Math.min(1, a + b);
}
export function parkValue(x, z) {
  return fbm2(x * 0.0011 + 50, z * 0.0011 + 50, 3, 21);
}
export function duneHeight(x, z) {
  const big = fbm2(x * 0.00025, z * 0.00025, 4, 31);
  const r = 1 - Math.abs(2 * fbm2(x * 0.0007 + 5, z * 0.0007 + 5, 2, 32) - 1);
  return 48 * big + 20 * r * r;
}
export function cityMask(x, z) { return smoothstep(-0.28, -0.04, cityValue(x, z)); }
// 고속도로 회랑 (지형 평탄화용): 선분 목록
export const highwayLines = [];
export function highwayMask(x, z) {
  let best = 1e9;
  for (const [ax, az, bx, bz] of highwayLines) {
    const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
    const dx = x - (ax + vx * t), dz = z - (az + vz * t);
    best = Math.min(best, dx * dx + dz * dz);
  }
  return 1 - smoothstep(35, 120, Math.sqrt(best));
}
export function riverMask(x, z) { return 1 - smoothstep(RIVER_HALF, RIVER_HALF + RIVER_BANK, riverDist(x, z)); }
export function terrainHeight(x, z) {
  const cm = cityMask(x, z), rm = riverMask(x, z), hm = highwayMask(x, z);
  return duneHeight(x, z) * (1 - cm) * (1 - rm) * (1 - hm) - RIVER_DEPTH * rm;
}
export function vegetation(x, z) {
  const rd = riverDist(x, z);
  const bank = (1 - smoothstep(RIVER_HALF + 30, RIVER_HALF + 170, rd)) * smoothstep(RIVER_HALF - 6, RIVER_HALF + 12, rd);
  const o = fbm2(x * 0.0013 + 7, z * 0.0013 + 7, 3, 88);
  const oasis = smoothstep(0.56, 0.66, o) * (1 - smoothstep(500, 900, rd));
  return Math.min(1, bank * 0.95 + oasis);
}

const PALETTE = [
  [0.82, 0.78, 0.72], [0.75, 0.70, 0.62], [0.86, 0.84, 0.80], [0.60, 0.58, 0.56],
  [0.72, 0.56, 0.46], [0.55, 0.60, 0.66], [0.90, 0.88, 0.85], [0.50, 0.50, 0.55],
  [0.78, 0.66, 0.55], [0.66, 0.62, 0.58],
];
const GLASS = [
  [0.45, 0.60, 0.72], [0.35, 0.50, 0.60], [0.55, 0.62, 0.70], [0.30, 0.40, 0.50], [0.62, 0.70, 0.75], [0.25, 0.32, 0.40],
];

const LINE_DEFS = [
  { name: '1호선', color: 0xe0392b, wps: [[-N, 0], [N, 0]] },
  { name: '2호선', color: 0x2b6fe0, wps: [[0, -N], [0, N]] },
  { name: '3호선', color: 0x2bb04a, wps: [[-N, -10], [10, -10], [10, N]] },
  { name: '4호선', color: 0xe0a52b, wps: [[-15, N], [-15, -5], [N, -5]] },
];

function bHeight(dt, rng, lx, lz) {
  const cluster = fbm2(lx * 0.0025 + 3, lz * 0.0025 + 3, 2, 77);
  let h;
  if (dt < 0.18) h = 6 + rng() * 10 + (rng() < 0.08 ? 20 * rng() : 0);
  else h = 10 + rng() * 18 + dt * dt * (70 + 240 * rng()) * (0.5 + cluster);
  if (dt > 0.5 && rng() < 0.06) h *= 1.6;
  return Math.min(h, 380);
}
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
const jitterColor = (c, rng, a = 0.05) => c.map((v) => Math.min(1, Math.max(0, v + (rng() - 0.5) * a)));

function makeBuildings(block, rng, buildings, parkingLots) {
  const { x0, x1, z0, z1, dt } = block;
  const ix0 = x0 + SIDEWALK, ix1 = x1 - SIDEWALK, iz0 = z0 + SIDEWALK, iz1 = z1 - SIDEWALK;
  const bw = ix1 - ix0, bd = iz1 - iz0;
  let nx, nz;
  if (dt > 0.55) { nx = 1 + (rng() < 0.45 ? 1 : 0); nz = 1 + (rng() < 0.45 ? 1 : 0); }
  else if (dt > 0.28) { nx = 2 + (rng() < 0.5 ? 1 : 0); nz = 2 + (rng() < 0.5 ? 1 : 0); }
  else { nx = 3 + (rng() < 0.5 ? 1 : 0); nz = 3 + (rng() < 0.5 ? 1 : 0); }
  const lw = bw / nx, ld = bd / nz;
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      if (rng() < 0.07) { // 공터 → 주차장
        const pw = lw * 0.9, pd = ld * 0.9;
        if (pw > 14 && pd > 14) parkingLots.push({ x: ix0 + (ix + 0.5) * lw, z: iz0 + (iz + 0.5) * ld, w: pw, d: pd });
        continue;
      }
      const fw = lw * (0.6 + 0.32 * rng()), fd = ld * (0.6 + 0.32 * rng());
      const lx = ix0 + (ix + 0.5) * lw + (rng() - 0.5) * (lw - fw) * 0.8;
      const lz = iz0 + (iz + 0.5) * ld + (rng() - 0.5) * (ld - fd) * 0.8;
      const h = bHeight(dt, rng, lx, lz);
      const glassP = smoothstep(40, 160, h) * 0.8 + 0.05;
      const color = jitterColor(rng() < glassP ? pick(GLASS, rng) : pick(PALETTE, rng), rng);
      const seed = rng();
      // 용도: 0 사무실(고층·도심), 1 주거(저층·외곽), 2 혼합
      const kind = h > 60 || dt > 0.55 ? 0 : dt < 0.3 ? 1 : 2;
      const mainB = { x: lx, z: lz, w: fw, d: fd, h, y: SLAB_H, color, seed, vOff: 0, dt, main: true, cap: null, kind };
      buildings.push(mainB);
      let below = mainB;
      // 위층은 항상 아래층보다 좁고, 아래층 footprint 안에 들어간다 (topW/topD = 현재 최상단 폭)
      let top = h, topW = fw, topD = fd;
      if (h > 100 && rng() < 0.7) {
        // 셋백 상단부: 본체와 같은 시드(층고·창문 폭)와 층 오프셋을 공유해 창문 행이 이어지도록
        const tw = topW * (0.5 + 0.2 * rng()), td = topD * (0.5 + 0.2 * rng()), th = h * (0.25 + 0.2 * rng());
        const tier = { x: lx, z: lz, w: tw, d: td, h: th, y: SLAB_H + top, color, seed, vOff: top, dt, cap: null, kind };
        buildings.push(tier); below.cap = tier; below = tier;
        top += th; topW = tw; topD = td;
        if (h > 220 && rng() < 0.6) {
          const sw = topW * 0.4, sd = topD * 0.4, sh = th * 0.6;
          const spire = { x: lx, z: lz, w: sw, d: sd, h: sh, y: SLAB_H + top, color, seed, vOff: top, dt, cap: null, kind };
          buildings.push(spire); below.cap = spire; below = spire;
          top += sh; topW = sw; topD = sd;
        }
      }
      // 옥상 설비(냉각탑): 최상단 층 폭의 일부 크기로, 최상단 층 안쪽에만 배치
      const rw = Math.min(topW * 0.35, 8), rd = Math.min(topD * 0.35, 8);
      if (h > 25 && rw >= 1.5 && rd >= 1.5 && rng() < 0.8) {
        const mx = (topW - rw) / 2 - 0.5, mz = (topD - rd) / 2 - 0.5;
        const box = {
          x: lx + (rng() - 0.5) * 2 * Math.max(0, mx), z: lz + (rng() - 0.5) * 2 * Math.max(0, mz),
          w: rw, d: rd, h: 1.5 + rng() * 1.5, y: SLAB_H + top,
          color: [0.5, 0.5, 0.52], seed: rng(), vOff: 0, dt, cap: null,
        };
        buildings.push(box); below.cap = box;
      }
    }
  }
}

export function generateCity(seed = 7) {
  const rng = mulberry32(seed);
  const size = 2 * N + 1;
  const nodeGrid = new Array(size * size).fill(null);
  const idx = (i, j) => (i + N) * size + (j + N);
  const getNode = (i, j) => (i < -N || i > N || j < -N || j > N ? null : nodeGrid[idx(i, j)]);
  const nodes = [], edges = [], blocks = [], buildings = [], trees = [], parkingLots = [];
  const riverZone = (x, z) => riverDist(x, z) < RIVER_HALF + RIVER_BANK + 6;
  // 공원 셀: 공원 사이의 골목은 없애고 대로만 남긴다
  const isParkCell = (i, j) => parkValue((i + 0.5) * P, (j + 0.5) * P) > 0.63;

  // 교차점 노드
  for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
    const x = i * P, z = j * P;
    if (inCity(x, z) && !riverZone(x, z)) {
      const node = { id: nodes.length, i, j, x, z, edges: [], signal: false, stations: null };
      nodes.push(node); nodeGrid[idx(i, j)] = node;
    }
  }
  // 도로 엣지
  for (const node of nodes) {
    for (let axis = 0; axis < 2; axis++) {
      const nb = axis === 0 ? getNode(node.i + 1, node.j) : getNode(node.i, node.j + 1);
      if (!nb) continue;
      const wide = axis === 0 ? isWide(node.j) : isWide(node.i);
      if (!wide) {
        const p1 = axis === 0 ? isParkCell(node.i, node.j - 1) : isParkCell(node.i - 1, node.j);
        if (p1 && isParkCell(node.i, node.j)) continue; // 공원 내부: 골목 없음 (산책로 망은 뒤에서 생성)
      }
      let crosses = false;
      for (let s = 0.1; s < 0.95; s += 0.1) {
        const sx = node.x + (axis === 0 ? s * P : 0), sz = node.z + (axis === 1 ? s * P : 0);
        if (riverZone(sx, sz)) { crosses = true; break; }
      }
      if (crosses && !wide) continue;
      const edge = { id: edges.length, a: node, b: nb, axis, wide, width: wide ? WIDE_W : NARROW_W, length: P, bridge: crosses, path: false };
      edges.push(edge); node.edges.push(edge); nb.edges.push(edge);
    }
  }
  // 대로 교량: 강 구역으로 끊긴 대로를 여러 셀 길이의 교량 엣지로 연결
  for (const node of nodes) {
    for (let axis = 0; axis < 2; axis++) {
      const wide = axis === 0 ? isWide(node.j) : isWide(node.i);
      if (!wide) continue;
      if (node.edges.some((e) => e.axis === axis && e.a === node && !e.path)) continue;
      for (let k = 2; k <= 5; k++) {
        const nb = axis === 0 ? getNode(node.i + k, node.j) : getNode(node.i, node.j + k);
        let ok = true;
        for (let m = 1; m < k; m++) {
          const mx = node.x + (axis === 0 ? m * P : 0), mz = node.z + (axis === 1 ? m * P : 0);
          if (!inCity(mx, mz) || !riverZone(mx, mz)) { ok = false; break; }
        }
        if (!ok) break;
        if (!nb) continue;
        const edge = { id: edges.length, a: node, b: nb, axis, wide: true, width: WIDE_W, length: k * P, bridge: true };
        edges.push(edge); node.edges.push(edge); nb.edges.push(edge);
        break;
      }
    }
  }


  // 블록
  const blockGrid = new Map();
  const parkTreeCands = [];
  for (let i = -N; i < N; i++) for (let j = -N; j < N; j++) {
    if (!getNode(i, j) || !getNode(i + 1, j) || !getNode(i, j + 1) || !getNode(i + 1, j + 1)) continue;
    const cx = (i + 0.5) * P, cz = (j + 0.5) * P;
    if (riverZone(cx, cz)) continue;
    let x0 = i * P + roadWidth(i) / 2, x1 = (i + 1) * P - roadWidth(i + 1) / 2;
    let z0 = j * P + roadWidth(j) / 2, z1 = (j + 1) * P - roadWidth(j + 1) / 2;
    const dt = downtown(cx, cz);
    const type = isParkCell(i, j) ? 'park' : rng() < 0.025 ? 'plaza' : 'building';
    if (type === 'park') {
      // 골목이 없는 변은 격자선까지 슬래브를 확장해 이웃 공원과 이어붙인다
      const hasEdge = (a, b) => a.edges.some((e) => !e.path && ((e.a === a && e.b === b) || (e.a === b && e.b === a)));
      if (!hasEdge(getNode(i, j), getNode(i, j + 1))) x0 = i * P;
      if (!hasEdge(getNode(i + 1, j), getNode(i + 1, j + 1))) x1 = (i + 1) * P;
      if (!hasEdge(getNode(i, j), getNode(i + 1, j))) z0 = j * P;
      if (!hasEdge(getNode(i, j + 1), getNode(i + 1, j + 1))) z1 = (j + 1) * P;
    }
    const block = { i, j, x0, x1, z0, z1, cx, cz, type, dt };
    blocks.push(block); blockGrid.set(idx(i, j), block);
    if (type === 'building') {
      makeBuildings(block, rng, buildings, parkingLots);
      if (dt < 0.4) {
        for (let k = 0; k < 4; k++) {
          const side = Math.floor(rng() * 4);
          const u = rng();
          const px = side < 2 ? x0 + 2 + u * (x1 - x0 - 4) : side === 2 ? x0 + 2 : x1 - 2;
          const pz = side >= 2 ? z0 + 2 + u * (z1 - z0 - 4) : side === 0 ? z0 + 2 : z1 - 2;
          trees.push({ x: px, z: pz, y: SLAB_H, s: 0.6 + 0.3 * rng(), kind: 0 });
        }
      }
    } else {
      const n = type === 'park' ? Math.floor((x1 - x0) * (z1 - z0) / 110) : 8;
      for (let k = 0; k < n; k++) {
        const tx = x0 + 3 + rng() * (x1 - x0 - 6), tz = z0 + 3 + rng() * (z1 - z0 - 6);
        const tree = { x: tx, z: tz, y: SLAB_H, s: 0.8 + 0.6 * rng(), kind: type === 'park' && rng() < 0.15 ? 1 : 0 };
        if (type === 'park') parkTreeCands.push([idx(i, j), tree]); else trees.push(tree);
      }
    }
  }

  // ───────── 공원 산책로 망 (곡선 설계) ─────────
  //  - 도로 모서리 → 공원 진입로(직선 stub, 횡단보도와 정렬)
  //  - 이웃 공원 셀 경계선을 따라 부드러운 호(arc) 산책로
  //  - 셀 중앙 원형 광장 루프 + 곡선 스포크
  //  - 잔디 위 자유 보행용 보이지 않는 '잔디 경로'
  const parkChains = [];
  const cellSegs = new Map(); // cell key → [[x0,z0,x1,z1], ...] (나무 배치 회피용)
  const newNode = (x, z) => { const n = { id: nodes.length, i: -999, j: -999, x, z, edges: [], signal: false, stations: null, park: true, wv: 4, wh: 4 }; nodes.push(n); return n; };
  const addPath = (a, b, opts = {}) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.5) return null;
    const axis = Math.abs(b.x - a.x) < 1 ? 1 : Math.abs(b.z - a.z) < 1 ? 0 : 2;
    const edge = { id: edges.length, a, b, axis, wide: false, width: 3, length: len, bridge: false, path: true, grid: !!opts.grid, grass: !!opts.grass };
    edges.push(edge); a.edges.push(edge); b.edges.push(edge);
    return edge;
  };
  const addSeg = (ck, a, b) => { let arr = cellSegs.get(ck); if (!arr) { arr = []; cellSegs.set(ck, arr); } arr.push([a.x, a.z, b.x, b.z]); };
  const quad = (p0, c, p1, segs) => { const pts = []; for (let k = 0; k <= segs; k++) { const t = k / segs, m = 1 - t; pts.push({ x: m * m * p0.x + 2 * t * m * c.x + t * t * p1.x, z: m * m * p0.z + 2 * t * m * c.z + t * t * p1.z }); } return pts; };
  // 점열을 노드/엣지 체인으로 (양 끝은 기존 노드), 리본 등록
  const chain = (startNode, pts, endNode, hw, cks) => {
    const out = [startNode];
    let prev = startNode;
    for (let k = 1; k < pts.length - 1; k++) { const nn = newNode(pts[k].x, pts[k].z); addPath(prev, nn); for (const ck of cks) addSeg(ck, prev, nn); prev = nn; out.push(nn); }
    addPath(prev, endNode); for (const ck of cks) addSeg(ck, prev, endNode); out.push(endNode);
    if (hw > 0) parkChains.push({ pts: [{ x: startNode.x, z: startNode.z }, ...pts.slice(1, -1), { x: endNode.x, z: endNode.z }], hw });
    return out;
  };
  const gates = new Map(); // `${node.id}:${dx},${dz}` → gate node
  const gateOf = (n, dx, dz, ck) => {
    if (!n.edges.some((e) => !e.path)) return n; // 도로 없는 모서리: 그대로 공원 교차점
    const key = `${n.id}:${dx},${dz}`;
    let g = gates.get(key);
    if (g) return g;
    const hc = (dx !== 0 ? n.wvTmp : n.whTmp) / 2;      // 건너야 할 교차 도로 반폭
    const wAlong = dx !== 0 ? n.whTmp : n.wvTmp;         // 진입로 축 방향 도로 폭 (인도 오프셋 기준)
    g = newNode(n.x + dx * (hc + 22), n.z + dz * (hc + 22));
    const st = addPath(n, g, { grid: true }); st.stubW = wAlong; addSeg(ck, n, g);
    if (wAlong <= 4) parkChains.push({ pts: [{ x: n.x + dx * (hc + 0.5), z: n.z + dz * (hc + 0.5) }, { x: g.x, z: g.z }], hw: 5.5 });
    gates.set(key, g);
    return g;
  };
  for (const n of nodes) { n.wvTmp = 4; n.whTmp = 4; for (const e of n.edges) { if (e.path) continue; if (e.axis === 1) n.wvTmp = Math.max(n.wvTmp, e.width); else n.whTmp = Math.max(n.whTmp, e.width); } }
  const cellNodes = new Map(); // cell key → 망 노드들 (잔디 경로 연결용)
  const pushCellNodes = (ck, list) => { let arr = cellNodes.get(ck); if (!arr) { arr = []; cellNodes.set(ck, arr); } for (const n of list) if (n.park) arr.push(n); };
  const sideMid = new Map(); // side key → 호 중간 노드
  const parkBlocks = blocks.filter((b) => b.type === 'park');
  // (1) 경계선 호 산책로
  for (const b of parkBlocks) {
    const ck = idx(b.i, b.j);
    for (const [axis, i0, j0, nbI, nbJ, key] of [[0, b.i, b.j, b.i, b.j - 1, `h:${b.i}:${b.j}`], [1, b.i, b.j, b.i - 1, b.j, `v:${b.i}:${b.j}`]]) {
      // 셀 (b) 의 북쪽 변(axis 0, z=j*P) / 서쪽 변(axis 1, x=i*P): 이웃 셀도 공원일 때만
      if (sideMid.has(key)) continue;
      const nb = blockGrid.get(idx(nbI, nbJ));
      if (!nb || nb.type !== 'park') continue;
      const A = getNode(i0, j0), B = axis === 0 ? getNode(i0 + 1, j0) : getNode(i0, j0 + 1);
      if (!A || !B) continue;
      if (A.edges.some((e) => !e.path && (e.b === B || e.a === B))) continue; // 이 경계선에 (대)로가 있으면 제외
      const dx = axis === 0 ? 1 : 0, dz = axis === 0 ? 0 : 1;
      const ckn = idx(nbI, nbJ);
      const GA = gateOf(A, dx, dz, ck), GB = gateOf(B, -dx, -dz, ck);
      const mid = { x: (GA.x + GB.x) / 2, z: (GA.z + GB.z) / 2 };
      const bul = (rng() < 0.5 ? -1 : 1) * (9 + rng() * 9);
      const ctrl = { x: mid.x + (-dz) * bul, z: mid.z + dx * bul };
      const pts = quad({ x: GA.x, z: GA.z }, ctrl, { x: GB.x, z: GB.z }, 8);
      const cn = chain(GA, pts, GB, 3, [ck, ckn]);
      sideMid.set(key, cn[4]);
      pushCellNodes(ck, cn); pushCellNodes(ckn, cn);
    }
  }
  // (2) 중앙 광장 루프 + 스포크 + 잔디 경로
  for (const b of parkBlocks) {
    const ck = idx(b.i, b.j);
    const mids = [sideMid.get(`h:${b.i}:${b.j}`), sideMid.get(`v:${b.i + 1}:${b.j}`), sideMid.get(`h:${b.i}:${b.j + 1}`), sideMid.get(`v:${b.i}:${b.j}`)].filter(Boolean);
    if (!mids.length) continue;
    const R = 14 + rng() * 8, segs = 12;
    const loop = [];
    for (let k = 0; k < segs; k++) { const a = (k / segs) * Math.PI * 2; loop.push(newNode(b.cx + Math.cos(a) * R, b.cz + Math.sin(a) * R)); }
    const loopPts = loop.map((n) => ({ x: n.x, z: n.z }));
    for (let k = 0; k < segs; k++) { addPath(loop[k], loop[(k + 1) % segs]); addSeg(ck, loop[k], loop[(k + 1) % segs]); }
    parkChains.push({ pts: [...loopPts, loopPts[0]], hw: 2.5 });
    pushCellNodes(ck, loop);
    for (const m of mids) {
      let best = loop[0], bd = Infinity;
      for (const l of loop) { const d = Math.hypot(l.x - m.x, l.z - m.z); if (d < bd) { bd = d; best = l; } }
      const mid = { x: (m.x + best.x) / 2, z: (m.z + best.z) / 2 };
      const dx = best.x - m.x, dz = best.z - m.z, L = Math.hypot(dx, dz) || 1;
      const bul = (rng() < 0.5 ? -1 : 1) * (4 + rng() * 6);
      const ctrl = { x: mid.x + (-dz / L) * bul, z: mid.z + (dx / L) * bul };
      const cn = chain(m, quad({ x: m.x, z: m.z }, ctrl, { x: best.x, z: best.z }, 5), best, 2.5, [ck]);
      pushCellNodes(ck, cn);
    }
    // 잔디 경로: 셀 안 무작위 지점들을 가까운 망 노드와 연결 (리본 없음)
    const pool = cellNodes.get(ck) || [];
    const grass = [];
    for (let k = 0; k < 7; k++) {
      const g = newNode(b.x0 + 8 + rng() * (b.x1 - b.x0 - 16), b.z0 + 8 + rng() * (b.z1 - b.z0 - 16));
      const near = pool.map((n) => [Math.hypot(n.x - g.x, n.z - g.z), n]).sort((p, q) => p[0] - q[0]).slice(0, 2);
      for (const [, n] of near) addPath(g, n, { grass: true });
      for (const g2 of grass) if (Math.hypot(g2.x - g.x, g2.z - g.z) < 45) addPath(g, g2, { grass: true });
      grass.push(g);
    }
  }
  // ───────── 고속도로 ─────────
  //  - 방사형 4개: 도시 가장자리(대로 끝)에서 사막 끝까지 직선
  //  - 강변 고가 고속도로: 강 서안을 따라 굽어지는 폴리라인 (y = 16, 교량 위를 넘는다)
  const highways = [];
  highwayLines.length = 0;
  const addHwEdge = (a, b, elevated) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const axis = Math.abs(b.x - a.x) < 1 ? 1 : Math.abs(b.z - a.z) < 1 ? 0 : 2;
    const edge = { id: edges.length, a, b, axis, wide: true, width: WIDE_W, length: len, bridge: false, path: false, highway: true, elevated };
    edges.push(edge); a.edges.push(edge); b.edges.push(edge);
    return edge;
  };
  const hwNode = (x, z, y) => { const n = { id: nodes.length, i: -999, j: -999, x, z, y, edges: [], signal: false, stations: null, poly: true, wv: 3, wh: 3 }; nodes.push(n); return n; };
  const radial = [];
  { // 동/서: j=0 행의 양끝 노드, 남/북: i=0 열의 양끝 노드
    const row = nodes.filter((n) => !n.park && n.j === 0 && n.edges.some((e) => !e.path)).sort((p, q) => p.i - q.i);
    const col = nodes.filter((n) => !n.park && n.i === 0 && n.edges.some((e) => !e.path)).sort((p, q) => p.j - q.j);
    if (row.length) { radial.push([row[row.length - 1], 1, 0]); radial.push([row[0], -1, 0]); }
    if (col.length) { radial.push([col[col.length - 1], 0, 1]); radial.push([col[0], 0, -1]); }
  }
  for (const [start, dx, dz] of radial) {
    const pts = [{ x: start.x, z: start.z }];
    let prev = start, x = start.x, z = start.z;
    const edgeLimit = WORLD / 2 - 60;
    while (true) {
      const nx = x + dx * P, nz = z + dz * P;
      if (Math.abs(nx) > edgeLimit || Math.abs(nz) > edgeLimit) break;
      const n = hwNode(nx, nz, 0);
      addHwEdge(prev, n, false);
      prev = n; x = nx; z = nz; pts.push({ x, z });
    }
    if (pts.length > 1) { highways.push({ pts, width: WIDE_W, y: 0 }); highwayLines.push([pts[0].x, pts[0].z, pts[pts.length - 1].x, pts[pts.length - 1].z]); }
  }
  { // 강변 고가 고속도로 (서안, 강 중심에서 70 m)
    const pts = [];
    let prev = null;
    for (let z = -WORLD / 2 + 200; z <= WORLD / 2 - 200; z += 50) {
      const xr = riverX(z), slope = (riverX(z + 10) - riverX(z - 10)) / 20;
      const nx = -1 / Math.sqrt(1 + slope * slope), nz = slope / Math.sqrt(1 + slope * slope); // 서쪽 법선
      const x = xr + nx * 70, zz = z + nz * 70;
      const n = hwNode(x, zz, 16);
      if (prev) addHwEdge(prev, n, true);
      prev = n; pts.push({ x, z: zz });
    }
    highways.push({ pts, width: 26, y: 16, elevated: true });
    // 고속도로 폭에 맞춰 폴리라인 노드 폭 기록
    for (const e of edges) if (e.elevated) e.width = 26;

    // 인터체인지: 교량마다 다이아몬드형 일방통행 램프 4개 (남행 진출/진입, 북행 진출/진입)
    const hwNodes = nodes.filter((n) => n.poly && n.y === 16);
    const rampSegs = [];
    // from → to 방향으로만 통행하는 일방통행 램프 (엣지 a=from, b=to)
    const addRamp = (from, to, side) => {
      const segs = 7;
      let prev = from;
      const pts = [{ x: from.x, y: from.y || 0, z: from.z }];
      const dx = to.x - from.x, dz = to.z - from.z, L = Math.hypot(dx, dz) || 1;
      const nx = -dz / L, nz = dx / L;
      const y0 = from.y || 0, y1 = to.y || 0;
      for (let k = 1; k <= segs; k++) {
        const t = k / segs, sm = t * t * (3 - 2 * t);
        const bul = Math.sin(t * Math.PI) * 16 * side;
        const x = from.x + dx * t + nx * bul, z = from.z + dz * t + nz * bul, y = y0 + (y1 - y0) * sm;
        const n = k === segs ? to : hwNode(x, z, y);
        const len = Math.hypot(n.x - prev.x, n.z - prev.z);
        const edge = { id: edges.length, a: prev, b: n, axis: 2, wide: false, width: 8, length: len, bridge: false, path: false, ramp: true, oneWay: true };
        edges.push(edge); prev.edges.push(edge); n.edges.push(edge);
        rampSegs.push([prev.x, prev.z, n.x, n.z]);
        pts.push({ x: n.x, y: n.y || 0, z: n.z });
        prev = n;
      }
      highways.push({ pts, width: 8, y: 0, elevated: true, ramp: true });
    };
    const ENABLE_RAMPS = false; // 진입로·진출로 (요청으로 비활성화, 코드는 유지)
    for (const b of ENABLE_RAMPS ? edges.filter((e) => e.bridge) : []) {
      const west = b.a.x < b.b.x ? b.a : b.b;
      if (west.x > riverX(west.z) - 70) continue; // 서안 노드가 아니면 제외
      const northOf = hwNodes.filter((n) => n.z < west.z - 150).sort((p, q) => q.z - p.z); // 가까운 순
      const southOf = hwNodes.filter((n) => n.z > west.z + 150).sort((p, q) => p.z - q.z);
      const n1 = northOf[0], n2 = northOf[3], s1 = southOf[0], s2 = southOf[3];
      if (n1) addRamp(n1, west, -1);   // 남행 진출 (북쪽 고가 → 지상)
      if (s1) addRamp(west, s1, -1);   // 남행 진입 (지상 → 남쪽 고가)
      if (s2) addRamp(s2, west, 1);    // 북행 진출 (남쪽 고가 → 지상)
      if (n2) addRamp(west, n2, 1);    // 북행 진입 (지상 → 북쪽 고가)
    }
    highwayLines.rampSegs = rampSegs;
  }

  // 공원 나무: 산책로 위는 비워둔다
  const nearSeg = (ck, x, z, r) => {
    const segs = cellSegs.get(ck); if (!segs) return false;
    for (const [ax, az, bx, bz] of segs) {
      const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
      const dx = x - (ax + vx * t), dz = z - (az + vz * t);
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  };
  for (const [ck, tree] of parkTreeCands) if (!nearSeg(ck, tree.x, tree.z, 5)) trees.push(tree);
  // 신호 교차로: 도로 3개 이상, 또는 도로 + 다른 축의 공원 진입로(횡단 필요)
  for (const node of nodes) {
    if (node.park) continue;
    const roads = node.edges.filter((e) => !e.path);
    const stubs = node.edges.filter((e) => e.path && e.grid && e.axis !== 2);
    node.signal = roads.length >= 3 || (roads.length >= 1 && stubs.some((p) => roads.every((r) => r.axis !== p.axis)));
  }
  // 노드별 실제 교차 도로 폭 (도로가 없으면 4 = 산책로/없음)
  for (const n of nodes) {
    if (n.park) continue;
    n.wv = 4; n.wh = 4;
    for (const e of n.edges) { if (e.path) continue; if (e.axis === 1) n.wv = Math.max(n.wv, e.width); else n.wh = Math.max(n.wh, e.width); }
  }

  // 강둑 숲 / 오아시스 숲
  for (let z = -WORLD / 2; z < WORLD / 2; z += 13) {
    const xr = riverX(z);
    for (let x = xr - 900; x < xr + 900; x += 13) {
      const jx = x + (hash2(x, z, 1) - 0.5) * 12, jz = z + (hash2(x, z, 2) - 0.5) * 12;
      if (Math.abs(jx) > WORLD / 2 - 10) continue;
      const rd = riverDist(jx, jz), r = hash2(x, z, 3);
      const cv = cityValue(jx, jz);
      let place = false, kind = 0;
      if (rd > RIVER_HALF + 8 && rd < RIVER_HALF + RIVER_BANK + 80) {
        const dens = 1 - smoothstep(RIVER_HALF + 40, RIVER_HALF + RIVER_BANK + 80, rd);
        if (r < 0.12 + 0.5 * dens) { place = true; kind = hash2(x, z, 4) < 0.5 ? 1 : 0; }
      } else if (cv < -0.12 && rd < 800) {
        const o = fbm2(jx * 0.0013 + 7, jz * 0.0013 + 7, 3, 88);
        if (o > 0.6 && r < 0.45) { place = true; kind = hash2(x, z, 4) < 0.7 ? 1 : 0; }
      }
      if (!place) continue;
      if (Math.abs(jx - (xr - 70)) < 22) continue; // 강변 고가도로 아래
      if (highwayLines.rampSegs && highwayLines.rampSegs.some(([ax, az, bx, bz]) => { const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1; const t = Math.max(0, Math.min(1, ((jx - ax) * vx + (jz - az) * vz) / L2)); const ddx = jx - (ax + vx * t), ddz = jz - (az + vz * t); return ddx * ddx + ddz * ddz < 144; })) continue; // 램프 아래
      if (highwayMask(jx, jz) > 0.3) continue;     // 방사형 고속도로 회랑
      if (cv > -0.05) {
        const bi = Math.floor(jx / P), bj = Math.floor(jz / P);
        if (bi >= -N && bi < N && bj >= -N && bj < N && blockGrid.has(idx(bi, bj))) continue;
        const gx = Math.abs(jx - Math.round(jx / P) * P), gz = Math.abs(jz - Math.round(jz / P) * P);
        if (gx < 8 || gz < 8) continue;
        const mx = Math.abs(jx - Math.round(jx / (5 * P)) * 5 * P), mz = Math.abs(jz - Math.round(jz / (5 * P)) * 5 * P);
        if (mx < 21 || mz < 21) continue;
      }
      trees.push({ x: jx, z: jz, y: terrainHeight(jx, jz) - 0.3, s: 0.8 + 0.5 * hash2(x, z, 5), kind });
    }
  }

  // 지하철
  const connected = (a, b) => a.edges.some((e) => e.a === b || e.b === b);
  const subwayLines = [];
  for (const def of LINE_DEFS) {
    const cells = [];
    for (let k = 0; k < def.wps.length - 1; k++) {
      const [i0, j0] = def.wps[k], [i1, j1] = def.wps[k + 1];
      const di = Math.sign(i1 - i0), dj = Math.sign(j1 - j0);
      let i = i0, j = j0;
      if (k === 0) cells.push([i, j]);
      while (i !== i1 || j !== j1) { i += di; j += dj; cells.push([i, j]); }
    }
    let best = [], cur = [];
    for (const [i, j] of cells) {
      const n = getNode(i, j);
      if (n && (cur.length === 0 || connected(cur[cur.length - 1], n))) cur.push(n);
      else { if (cur.length > best.length) best = cur; cur = n ? [n] : []; }
    }
    if (cur.length > best.length) best = cur;
    if (best.length < 6) continue;
    const stations = best.filter((n) => isWide(n.i) && isWide(n.j));
    const line = { name: def.name, color: def.color, nodes: best, stations, index: subwayLines.length };
    subwayLines.push(line);
    for (const s of stations) (s.stations ||= []).push(line);
  }

  return { nodes, edges, blocks, buildings, trees, subwayLines, getNode, parkChains, parkingLots, highways };
}
