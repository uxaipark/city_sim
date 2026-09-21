// 창문 내부 장면 아틀라스
// 실제 야간 오피스/주거 창문 사진의 특징을 따른다:
//  - 밖에서 보면 천장 조명(형광 패널·다운라이트)이 가장 밝고, 그 아래 뒷벽·가구가 원근으로 보인다
//  - 블라인드/커튼이 절반쯤 가린 창이 많고, 가구는 실루엣+상판 하이라이트 정도로 인식된다
//  - 주거는 전구색, 사무실은 냉백색. TV/모니터는 벽에 푸른 빛을 뿌린다
// 각 타일은 간이 3D 상자 원근(소실점)으로 방을 그리고, 가구는 박스 프리미티브(앞면·윗면·옆면 음영)로 그린다.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

export const ATLAS_N = 16;          // 16 x 16 = 256 타일
export const TILE = 160;
// 타일 인덱스 범위 (셰이더에서 건물 종류별로 선택) — 사무실 100, 주거 100, 상점 24, 소등 32
export const RANGE = { office: [0, 100], home: [100, 200], shop: [200, 224], dark: [224, 256] };

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const rgb = (c, m = 1) => `rgb(${clamp01(c[0] * m / 255) * 255 | 0},${clamp01(c[1] * m / 255) * 255 | 0},${clamp01(c[2] * m / 255) * 255 | 0})`;
const rgba = (c, a, m = 1) => `rgba(${clamp01(c[0] * m / 255) * 255 | 0},${clamp01(c[1] * m / 255) * 255 | 0},${clamp01(c[2] * m / 255) * 255 | 0},${a})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (c, m) => [c[0] * m, c[1] * m, c[2] * m];

// ── 간이 원근 방 ──────────────────────────────────────────────────────────
// 창 평면 = 타일 전체. 소실점 (vx, vy). 깊이 z(0=창, 1=뒷벽)에서의 축소 s(z) = 1 - z * (1 - back)
class Room {
  constructor(ctx, S, r, opt) {
    this.ctx = ctx; this.S = S; this.r = r;
    this.back = opt.back ?? 0.42 + r() * 0.2;        // 뒷벽 축소 비율
    this.vx = S * (0.5 + (r() - 0.5) * 0.25);
    this.vy = S * (0.5 + (r() - 0.5) * 0.12);
    this.wall = opt.wall; this.floor = opt.floor; this.ceil = opt.ceil ?? [235, 235, 235];
    this.light = opt.light;                             // 조명 색
    this.bright = opt.bright ?? 1;                      // 전체 밝기
  }
  s(z) { return 1 - z * (1 - this.back); }
  // 창 좌표(0..1, y 아래로 증가) + 깊이 → 화면
  p(x, y, z) { const s = this.s(z); return [this.vx + (x * this.S - this.vx) * s, this.vy + (y * this.S - this.vy) * s]; }
  poly(pts, style) { const c = this.ctx; c.fillStyle = style; c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.fill(); }
  shell() {
    const { ctx: c, S, wall, floor, ceil, bright } = this;
    const L = this.light;
    // 뒷벽: 위쪽(조명 가까움) 밝고 아래 어둡다
    const [bx0, by0] = this.p(0, 0, 1), [bx1, by1] = this.p(1, 1, 1);
    const g = c.createLinearGradient(0, by0, 0, by1);
    g.addColorStop(0, rgb(mix(wall, L, 0.25), 1.05 * bright)); g.addColorStop(1, rgb(wall, 0.55 * bright));
    c.fillStyle = g; c.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
    // 옆벽 (창 쪽으로 갈수록 어둡다)
    const gl = c.createLinearGradient(0, 0, bx0, 0); gl.addColorStop(0, rgb(wall, 0.35 * bright)); gl.addColorStop(1, rgb(wall, 0.85 * bright));
    this.poly([[0, 0], [bx0, by0], [bx0, by1], [0, S]], gl);
    const gr = c.createLinearGradient(S, 0, bx1, 0); gr.addColorStop(0, rgb(wall, 0.35 * bright)); gr.addColorStop(1, rgb(wall, 0.85 * bright));
    this.poly([[S, 0], [bx1, by0], [bx1, by1], [S, S]], gr);
    // 천장
    const gc = c.createLinearGradient(0, 0, 0, by0); gc.addColorStop(0, rgb(ceil, 0.5 * bright)); gc.addColorStop(1, rgb(mix(ceil, L, 0.2), 0.95 * bright));
    this.poly([[0, 0], [S, 0], [bx1, by0], [bx0, by0]], gc);
    // 바닥 (조명 반사로 뒷쪽이 살짝 밝다)
    const gf = c.createLinearGradient(0, by1, 0, S); gf.addColorStop(0, rgb(floor, 0.9 * bright)); gf.addColorStop(1, rgb(floor, 0.45 * bright));
    this.poly([[bx0, by1], [bx1, by1], [S, S], [0, S]], gf);
    // 모서리 AO
    const ao = c.createRadialGradient(this.vx, this.vy, S * 0.15, this.vx, this.vy, S * 0.8); ao.addColorStop(0, 'rgba(0,0,0,0)'); ao.addColorStop(1, 'rgba(0,0,0,0.35)');
    c.fillStyle = ao; c.fillRect(0, 0, S, S);
  }
  // 천장 조명 패널 (원근 사각형) + 글로우
  ceilPanels(cols, rows, w, h, color = this.light, strength = 1) {
    const c = this.ctx;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x = (i + 0.5) / cols, z = 0.15 + (j + 0.5) / rows * 0.7;
      const q = [this.p(x - w / 2, 0, z - h / 2), this.p(x + w / 2, 0, z - h / 2), this.p(x + w / 2, 0, z + h / 2), this.p(x - w / 2, 0, z + h / 2)];
      // 글로우
      const cx = (q[0][0] + q[2][0]) / 2, cy = (q[0][1] + q[2][1]) / 2;
      const gg = c.createRadialGradient(cx, cy, 0, cx, cy, this.S * 0.28 * this.s(z));
      gg.addColorStop(0, rgba(color, 0.55 * strength)); gg.addColorStop(1, rgba(color, 0));
      c.fillStyle = gg; c.fillRect(cx - this.S * 0.3, cy - this.S * 0.3, this.S * 0.6, this.S * 0.6);
      this.poly(q, rgb(mix(color, [255, 255, 255], 0.5), 1.15 * strength));
    }
  }
  downlights(n, color = this.light) {
    const c = this.ctx;
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) / n, z = 0.3 + this.r() * 0.5;
      const [cx, cy] = this.p(x, 0, z), rr = this.S * 0.02 * this.s(z);
      const gg = c.createRadialGradient(cx, cy, 0, cx, cy, this.S * 0.2 * this.s(z)); gg.addColorStop(0, rgba(color, 0.5)); gg.addColorStop(1, rgba(color, 0));
      c.fillStyle = gg; c.fillRect(cx - this.S * 0.2, cy - this.S * 0.2, this.S * 0.4, this.S * 0.4);
      c.fillStyle = rgb(mix(color, [255, 255, 255], 0.6), 1.2); c.beginPath(); c.ellipse(cx, cy, rr * 1.6, rr, 0, 0, 7); c.fill();
    }
  }
  // 펜던트/플로어 램프: 전구 위치에 따뜻한 글로우
  lamp(x, y, z, color, size = 0.22, a = 0.7) {
    const c = this.ctx; const [cx, cy] = this.p(x, y, z); const R = this.S * size * this.s(z);
    const gg = c.createRadialGradient(cx, cy, 0, cx, cy, R); gg.addColorStop(0, rgba(color, a)); gg.addColorStop(0.35, rgba(color, a * 0.35)); gg.addColorStop(1, rgba(color, 0));
    c.fillStyle = gg; c.fillRect(cx - R, cy - R, R * 2, R * 2);
  }
  // 박스 가구: (x, yTop, z) 크기 (w, h, d). 앞면·윗면·옆면 3면 음영
  box(x, yTop, z, w, h, d, color, opt = {}) {
    const front = [this.p(x, yTop, z), this.p(x + w, yTop, z), this.p(x + w, yTop + h, z), this.p(x, yTop + h, z)];
    const backT = [this.p(x, yTop, z + d), this.p(x + w, yTop, z + d)];
    // 그림자 (바닥에 드리움)
    if (opt.shadow !== false) {
      const c = this.ctx; const [sx, sy] = this.p(x + w / 2, yTop + h, z + d * 0.4); const rw = this.S * w * 0.7 * this.s(z), rh = this.S * d * 0.18 * this.s(z);
      const g = c.createRadialGradient(sx, sy + rh * 0.2, 0, sx, sy + rh * 0.2, rw); g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.save(); c.translate(sx, sy); c.scale(1, rh / rw); c.translate(-sx, -sy); c.fillRect(sx - rw, sy - rw, rw * 2, rw * 2); c.restore();
    }
    // 윗면 (조명을 받아 가장 밝음)
    this.poly([front[0], front[1], backT[1], backT[0]], rgb(color, 1.25 * this.bright));
    // 옆면 (소실점 방향으로 보이는 쪽)
    const side = x + w / 2 < this.vx / this.S ? [front[1], backT[1], this.p(x + w, yTop + h, z + d), front[2]] : [front[0], backT[0], this.p(x, yTop + h, z + d), front[3]];
    this.poly(side, rgb(color, 0.7 * this.bright));
    // 앞면
    const c = this.ctx; const g = c.createLinearGradient(0, front[0][1], 0, front[3][1]); g.addColorStop(0, rgb(color, 1.0 * this.bright)); g.addColorStop(1, rgb(color, 0.75 * this.bright));
    this.poly(front, g);
    return front;
  }
  // 얇은 판(모니터·TV·액자·화이트보드) — 뒷벽 또는 지정 깊이에 세워짐
  panel(x, y, z, w, h, color, glow) {
    const q = [this.p(x, y, z), this.p(x + w, y, z), this.p(x + w, y + h, z), this.p(x, y + h, z)];
    if (glow) { const [cx, cy] = this.p(x + w / 2, y + h / 2, z); const R = this.S * Math.max(w, h) * 1.3 * this.s(z); const g = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, R); g.addColorStop(0, rgba(glow, 0.45)); g.addColorStop(1, rgba(glow, 0)); this.ctx.fillStyle = g; this.ctx.fillRect(cx - R, cy - R, R * 2, R * 2); }
    this.poly(q, typeof color === 'string' ? color : rgb(color));
    return q;
  }
  // 사람 실루엣 (앉음/서 있음)
  person(x, yFeet, z, sitting, color = [40, 42, 50]) {
    const c = this.ctx; const s = this.s(z); const H = (sitting ? 0.30 : 0.42) * s * this.S; const W = 0.09 * s * this.S;
    const [px, py] = this.p(x, yFeet, z);
    c.fillStyle = rgb(color, this.bright);
    c.beginPath(); c.ellipse(px, py - H * 0.55, W * 0.55, H * 0.45, 0, 0, 7); c.fill();      // 몸통
    c.beginPath(); c.arc(px, py - H * 0.9, W * 0.32, 0, 7); c.fill();                            // 머리
  }
  // 블라인드: 아래쪽 일부/위쪽 일부를 슬랫으로 가림
  blinds(cover, fromTop = true, tint = [225, 225, 220]) {
    const c = this.ctx, S = this.S; const h = S * cover; const y0 = fromTop ? 0 : S - h;
    c.fillStyle = rgba(tint, 0.82, this.bright * 0.8); c.fillRect(0, y0, S, h);
    c.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = y0 + 2; y < y0 + h; y += 5) c.fillRect(0, y, S, 1.4);
    const g = c.createLinearGradient(0, 0, S, 0); g.addColorStop(0, 'rgba(0,0,0,0.25)'); g.addColorStop(0.5, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(0,0,0,0.25)'); c.fillStyle = g; c.fillRect(0, y0, S, h);
  }
  // 커튼: 주름 있는 천. open=열린 폭 비율(가운데)
  curtains(color, open, sheer = false) {
    const c = this.ctx, S = this.S; const w = S * (1 - open) / 2;
    for (const side of [0, 1]) {
      const x0 = side ? S - w : 0;
      c.fillStyle = rgba(color, sheer ? 0.55 : 0.97, this.bright); c.fillRect(x0, 0, w, S);
      const folds = 5 + Math.floor(this.r() * 4);
      for (let i = 0; i < folds; i++) {
        const fx = x0 + (i + 0.5) / folds * w; const g = c.createLinearGradient(fx - w / folds / 2, 0, fx + w / folds / 2, 0);
        g.addColorStop(0, 'rgba(0,0,0,0.28)'); g.addColorStop(0.45, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0.28)');
        c.fillStyle = g; c.fillRect(fx - w / folds / 2, 0, w / folds, S);
      }
      // 커튼 봉 그림자
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(x0, 0, w, S * 0.03);
    }
  }
  plant(x, yFeet, z, size = 0.16) {
    const c = this.ctx; const s = this.s(z); const [px, py] = this.p(x, yFeet, z); const R = this.S * size * s;
    c.fillStyle = rgb([95, 80, 70], this.bright); c.fillRect(px - R * 0.22, py - R * 0.35, R * 0.44, R * 0.35);
    for (let i = 0; i < 7; i++) { const a = this.r() * 6.28, d = R * (0.2 + this.r() * 0.35); c.fillStyle = rgb([40 + this.r() * 40, 95 + this.r() * 50, 50 + this.r() * 30], this.bright); c.beginPath(); c.ellipse(px + Math.cos(a) * d, py - R * 0.5 + Math.sin(a) * d * 0.6, R * 0.3, R * 0.18, a, 0, 7); c.fill(); }
  }
  bookshelf(x, yTop, z, w, h, d, color) {
    this.box(x, yTop, z, w, h, d, color);
    const rows = Math.max(2, Math.round(h / 0.11));
    for (let j = 0; j < rows; j++) {
      const y = yTop + (j + 0.12) * (h / rows), rh = h / rows * 0.78; let cx = x + 0.015;
      while (cx < x + w - 0.02) {
        const bw = 0.012 + this.r() * 0.02, bh = rh * (0.7 + this.r() * 0.3);
        const col = [[140, 50, 45], [45, 70, 120], [60, 100, 70], [180, 160, 120], [70, 60, 60], [200, 190, 180], [150, 110, 50]][Math.floor(this.r() * 7)];
        this.panel(cx, y + rh - bh, z + 0.005, bw, bh, rgb(col, 0.9 * this.bright)); cx += bw + 0.004;
        if (this.r() < 0.12) cx += 0.02;
      }
      this.panel(x, y + rh, z, w, 0.008, rgb(mul(color, 0.6), this.bright));  // 선반 판
    }
  }
}

// ── 팔레트 ────────────────────────────────────────────────────────────────
const COOL = [255, 238, 205], NEUTRAL = [255, 228, 190], WARM = [255, 205, 145], WARM2 = [255, 185, 115]; // 할로겐/백열 계열
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

// ── 사무실 테마 ─────────────────────────────────────────────────────────────
function officeOpen(R, r) {           // 개방형 사무실: 책상 열, 모니터, 의자, 일부 사람
  R.shell(); R.ceilPanels(2 + Math.floor(r() * 2), 2, 0.28, 0.16);
  const rows = 1 + Math.floor(r() * 2);
  for (let j = 0; j < rows; j++) {
    const z = 0.35 + j * 0.3; const n = 2 + Math.floor(r() * 2); const late = r() < 0.5;
    for (let i = 0; i < n; i++) {
      const x = 0.06 + i * (0.88 / n) + r() * 0.04, w = 0.88 / n - 0.06;
      const deskY = 0.66;
      R.box(x, deskY, z, w, 0.03, 0.14, pick(r, [[210, 200, 185], [190, 180, 170], [150, 130, 110], [230, 230, 228]]));
      // 모니터 (밤이면 대부분 꺼짐, 일부 켜짐)
      const on = r() < (late ? 0.35 : 0.15);
      const mw = w * 0.42, mh = 0.075; const mx = x + w * 0.5 - mw / 2;
      R.panel(mx, deskY - mh - 0.03, z + 0.09, mw, mh, on ? rgb(pick(r, [[120, 170, 250], [180, 200, 230], [90, 200, 160]]), 1.1) : rgb([28, 30, 36]), on ? [120, 170, 250] : null);
      R.panel(mx + mw * 0.45, deskY - 0.03, z + 0.09, mw * 0.1, 0.03, rgb([40, 40, 46]));
      // 의자 (책상 앞, 등받이만 보임)
      if (r() < 0.8) R.box(x + w * 0.3, deskY + 0.02, z - 0.12, w * 0.35, 0.12, 0.04, [45, 45, 52], { shadow: false });
      if (r() < 0.2) R.person(x + w * 0.5, deskY + 0.14, z - 0.1, true);
    }
  }
  if (r() < 0.4) R.plant(r() < 0.5 ? 0.08 : 0.92, 0.9, 0.85);
  if (r() < 0.35) R.panel(0.25 + r() * 0.3, 0.2, 1, 0.3, 0.16, rgb([250, 250, 250], 0.95 * R.bright)); // 화이트보드
  if (r() < 0.35) R.blinds(0.25 + r() * 0.35, true);
}
function officeMeeting(R, r) {        // 회의실: 긴 테이블, 의자, 벽걸이 TV
  R.shell(); R.ceilPanels(1, 2, 0.5, 0.2);
  R.panel(0.32, 0.22, 1, 0.36, 0.2, r() < 0.4 ? rgb([60, 120, 200]) : rgb([18, 18, 22]), r() < 0.4 ? [70, 130, 220] : null);
  R.box(0.18, 0.62, 0.3, 0.64, 0.035, 0.5, pick(r, [[200, 185, 160], [120, 95, 75], [235, 235, 235], [60, 55, 55]]));
  for (let i = 0; i < 4; i++) { R.box(0.1, 0.6, 0.38 + i * 0.13, 0.07, 0.14, 0.06, [50, 50, 58], { shadow: false }); R.box(0.83, 0.6, 0.38 + i * 0.13, 0.07, 0.14, 0.06, [50, 50, 58], { shadow: false }); }
  const ppl = r() < 0.3 ? 2 + Math.floor(r() * 4) : 0;
  for (let i = 0; i < ppl; i++) R.person(r() < 0.5 ? 0.12 : 0.88, 0.76, 0.35 + r() * 0.5, true);
  if (r() < 0.5) R.blinds(0.2 + r() * 0.5, r() < 0.5);
}
function officePrivate(R, r) {        // 임원실/개인 사무실: 큰 책상, 책장, 화분, 액자
  R.shell(); R.downlights(3);
  R.bookshelf(0.05 + r() * 0.1, 0.25, 0.98, 0.3, 0.55, 0.06, [120, 90, 65]);
  R.panel(0.6, 0.22, 1, 0.22, 0.16, rgb(pick(r, [[90, 110, 150], [160, 120, 90], [80, 130, 110]])));
  R.box(0.35, 0.64, 0.4, 0.42, 0.04, 0.22, pick(r, [[110, 80, 60], [60, 55, 50], [200, 190, 175]]));
  R.panel(0.5, 0.57, 0.5, 0.14, 0.07, rgb([30, 32, 38]));
  R.box(0.45, 0.6, 0.72, 0.16, 0.2, 0.06, [40, 40, 46], { shadow: false });
  if (r() < 0.6) { R.lamp(0.42, 0.55, 0.42, WARM, 0.18, 0.6); }
  R.plant(0.9, 0.9, 0.8, 0.2);
  if (r() < 0.4) R.blinds(0.3 + r() * 0.3, true);
}
function officeEmpty(R, r) {          // 빈 층/공사중/조명만: 기둥, 케이블, 박스
  R.shell(); R.ceilPanels(3, 2, 0.24, 0.12, R.light, 0.9);
  for (let i = 0; i < 2; i++) R.box(0.15 + i * 0.6, 0.1, 0.5 + r() * 0.3, 0.06, 0.8, 0.06, [200, 200, 200], { shadow: false });
  if (r() < 0.5) for (let i = 0; i < 3; i++) R.box(0.2 + r() * 0.6, 0.8, 0.5 + r() * 0.4, 0.1, 0.1, 0.1, [170, 140, 100]);
}
function officeLounge(R, r) {         // 휴게실/탕비실: 소파, 테이블, 냉장고, 커피머신
  R.shell(); R.downlights(4, mix(R.light, WARM, 0.4));
  R.box(0.05, 0.4, 0.95, 0.35, 0.3, 0.06, [220, 220, 215]);            // 상부장
  R.box(0.05, 0.68, 0.85, 0.35, 0.22, 0.15, pick(r, [[90, 90, 95], [200, 195, 185]])); // 하부장
  R.box(0.42, 0.3, 0.85, 0.14, 0.6, 0.15, [210, 212, 215]);             // 냉장고
  R.box(0.6, 0.62, 0.45, 0.32, 0.12, 0.2, pick(r, [[110, 90, 130], [70, 100, 120], [150, 120, 90]])); // 소파
  R.box(0.62, 0.6, 0.45, 0.28, 0.06, 0.04, [80, 70, 90], { shadow: false });
  if (r() < 0.5) R.box(0.6, 0.72, 0.28, 0.2, 0.02, 0.1, [230, 225, 215]);
  if (r() < 0.3) R.person(0.75, 0.83, 0.4, true);
  R.plant(0.95, 0.9, 0.7, 0.14);
}
function officeCorridor(R, r) {       // 복도/리셉션: 카운터, 로고 패널, 유리 파티션
  R.shell(); R.ceilPanels(1, 3, 0.2, 0.12);
  R.panel(0.3, 0.2, 1, 0.4, 0.1, rgb(pick(r, [[40, 60, 90], [120, 40, 40], [40, 40, 44]])), null);
  R.panel(0.36, 0.23, 0.999, 0.28, 0.04, rgb([230, 230, 230]));
  R.box(0.25, 0.6, 0.6, 0.5, 0.3, 0.2, pick(r, [[230, 230, 228], [70, 65, 60], [140, 110, 80]]));
  if (r() < 0.4) R.person(0.5, 0.78, 0.55, true);
  if (r() < 0.5) R.plant(0.1, 0.9, 0.9, 0.18);
}
function officeServer(R, r) {         // 서버실: 랙, 작은 LED
  R.shell(); R.ceilPanels(2, 1, 0.3, 0.14, [200, 220, 255], 0.8);
  for (let i = 0; i < 4; i++) { const x = 0.08 + i * 0.22; R.box(x, 0.25, 0.7, 0.16, 0.65, 0.2, [40, 42, 48]); for (let k = 0; k < 8; k++) { R.ctx.fillStyle = r() < 0.5 ? 'rgb(80,255,120)' : 'rgb(80,140,255)'; const [px, py] = R.p(x + 0.02 + r() * 0.12, 0.3 + k * 0.075, 0.7); R.ctx.fillRect(px, py, 2, 2); } }
}

// ── 주거 테마 ──────────────────────────────────────────────────────────────
function living(R, r) {               // 거실: 소파, TV(켜짐/꺼짐), 플로어 램프, 러그, 액자, 커튼
  R.shell();
  const tvOn = r() < 0.55;
  R.panel(0.33, 0.3, 1, 0.34, 0.2, tvOn ? rgb(pick(r, [[90, 140, 220], [220, 160, 90], [150, 150, 170], [60, 180, 120]]), 1.2) : rgb([14, 14, 18]), tvOn ? [110, 150, 230] : null);
  R.box(0.28, 0.62, 0.95, 0.44, 0.1, 0.1, pick(r, [[120, 85, 60], [240, 240, 238], [50, 48, 48]]));  // TV장
  if (r() < 0.6) { const rug = pick(r, [[150, 60, 60], [80, 90, 130], [200, 180, 150]]); R.poly([R.p(0.15, 0.95, 0.4), R.p(0.85, 0.95, 0.4), R.p(0.85, 0.95, 0.85), R.p(0.15, 0.95, 0.85)], rgb(rug, 0.8 * R.bright)); }
  R.box(0.2, 0.6, 0.35, 0.6, 0.15, 0.25, pick(r, [[150, 130, 110], [90, 100, 120], [180, 170, 160], [110, 90, 130]])); // 소파
  R.box(0.2, 0.55, 0.58, 0.6, 0.07, 0.03, pick(r, [[130, 110, 90], [70, 80, 100], [160, 150, 140]]), { shadow: false });     // 등받이
  R.lamp(r() < 0.5 ? 0.12 : 0.9, 0.42, 0.7, WARM, 0.22, 0.75);
  R.box(0.86, 0.43, 0.7, 0.08, 0.06, 0.08, [240, 225, 190], { shadow: false });   // 램프 갓
  if (r() < 0.6) R.panel(0.08, 0.25, 1, 0.14, 0.12, rgb(pick(r, [[120, 100, 140], [160, 130, 90], [80, 120, 110]])));
  if (r() < 0.4) R.plant(0.9, 0.92, 0.9, 0.18);
  if (r() < 0.25) R.person(0.5, 0.75, 0.4, true);
  if (r() < 0.45) R.curtains(pick(r, [[200, 185, 160], [170, 150, 140], [230, 230, 225], [120, 100, 90]]), 0.55 + r() * 0.35, r() < 0.3);
}
function bedroom(R, r) {              // 침실: 침대, 헤드보드, 협탁 램프, 어두운 조명
  R.shell(); if (r() < 0.5) R.downlights(1, WARM2);
  const bedC = pick(r, [[230, 225, 215], [180, 170, 200], [200, 180, 160], [150, 160, 180]]);
  R.box(0.2, 0.7, 0.5, 0.6, 0.12, 0.45, bedC);
  R.box(0.2, 0.42, 0.95, 0.6, 0.3, 0.04, pick(r, [[110, 80, 60], [90, 90, 100], [200, 190, 180]]), { shadow: false }); // 헤드보드
  R.box(0.28, 0.66, 0.9, 0.18, 0.06, 0.08, [245, 245, 245], { shadow: false }); R.box(0.54, 0.66, 0.9, 0.18, 0.06, 0.08, [245, 245, 245], { shadow: false }); // 베개
  for (const x of [0.08, 0.86]) if (r() < 0.8) { R.box(x, 0.72, 0.85, 0.09, 0.15, 0.12, [120, 90, 70]); R.lamp(x + 0.045, 0.62, 0.85, WARM2, 0.2, 0.8); R.box(x + 0.01, 0.6, 0.85, 0.07, 0.06, 0.07, [240, 220, 180], { shadow: false }); }
  if (r() < 0.5) R.panel(0.35, 0.18, 1, 0.3, 0.14, rgb(pick(r, [[100, 120, 150], [150, 120, 100], [90, 100, 90]])));
  if (r() < 0.5) R.curtains(pick(r, [[90, 80, 90], [160, 140, 120], [60, 70, 90], [200, 190, 170]]), 0.4 + r() * 0.4, r() < 0.4);
}
function study(R, r) {                // 서재: 책상 + 스탠드, 책장, 의자, 모니터
  R.shell(); if (r() < 0.6) R.downlights(2, mix(R.light, WARM, 0.5));
  R.bookshelf(0.05, 0.2, 0.98, 0.45 + r() * 0.2, 0.62, 0.06, pick(r, [[120, 90, 65], [240, 240, 238], [60, 55, 50]]));
  R.box(0.5, 0.64, 0.5, 0.42, 0.03, 0.2, pick(r, [[190, 170, 140], [230, 230, 230], [100, 75, 55]]));
  const on = r() < 0.5;
  R.panel(0.6, 0.56, 0.62, 0.18, 0.08, on ? rgb([140, 180, 240], 1.1) : rgb([30, 30, 36]), on ? [140, 180, 240] : null);
  R.lamp(0.84, 0.56, 0.55, WARM, 0.16, 0.7); R.box(0.82, 0.55, 0.55, 0.05, 0.03, 0.04, [60, 60, 60], { shadow: false });
  R.box(0.6, 0.62, 0.3, 0.18, 0.18, 0.05, [50, 50, 58], { shadow: false });
  if (r() < 0.3) R.person(0.69, 0.8, 0.32, true);
  if (r() < 0.35) R.curtains([200, 190, 170], 0.7, true);
}
function kitchen(R, r) {              // 주방: 상·하부장, 후드, 냉장고, 아일랜드, 펜던트
  R.shell(); R.downlights(3, mix(R.light, NEUTRAL, 0.5));
  const cab = pick(r, [[240, 240, 236], [110, 80, 60], [70, 80, 90], [200, 200, 195]]);
  R.box(0.05, 0.28, 0.95, 0.7, 0.24, 0.06, cab);                                    // 상부장
  R.box(0.05, 0.68, 0.85, 0.7, 0.25, 0.15, cab);                                    // 하부장
  R.panel(0.05, 0.67, 0.85, 0.7, 0.015, rgb(pick(r, [[230, 230, 225], [60, 60, 65], [180, 170, 150]])));  // 상판
  R.box(0.32, 0.22, 0.9, 0.18, 0.1, 0.1, [200, 200, 205]);                           // 후드
  R.box(0.78, 0.32, 0.85, 0.17, 0.6, 0.15, pick(r, [[215, 215, 220], [50, 50, 55]]));  // 냉장고
  if (r() < 0.5) { R.box(0.25, 0.72, 0.35, 0.5, 0.2, 0.18, cab); R.lamp(0.5, 0.35, 0.4, WARM, 0.16, 0.7); R.box(0.46, 0.33, 0.4, 0.08, 0.05, 0.08, [60, 60, 60], { shadow: false }); }
  for (let i = 0; i < 3; i++) if (r() < 0.6) R.box(0.1 + i * 0.2, 0.6, 0.9, 0.05, 0.07, 0.04, pick(r, [[200, 60, 50], [240, 240, 240], [60, 120, 80], [230, 200, 80]]), { shadow: false }); // 소품
  if (r() < 0.25) R.person(0.5, 0.92, 0.55, false);
}
function dining(R, r) {               // 식당: 테이블 + 의자 + 펜던트 램프
  R.shell(); R.lamp(0.5, 0.3, 0.55, WARM, 0.3, 0.85); R.box(0.42, 0.26, 0.55, 0.16, 0.07, 0.16, [70, 60, 55], { shadow: false });
  R.box(0.25, 0.62, 0.4, 0.5, 0.03, 0.35, pick(r, [[130, 95, 70], [230, 228, 222], [60, 55, 55]]));
  for (const [x, z] of [[0.15, 0.45], [0.78, 0.45], [0.3, 0.3], [0.6, 0.3]]) R.box(x, 0.6, z, 0.09, 0.17, 0.08, [70, 60, 60], { shadow: false });
  if (r() < 0.6) R.panel(0.3 + r() * 0.3, 0.2, 1, 0.2, 0.15, rgb(pick(r, [[110, 100, 140], [150, 110, 80], [90, 130, 120]])));
  if (r() < 0.3) for (let i = 0; i < 2; i++) R.person(0.3 + i * 0.4, 0.78, 0.35, true);
  if (r() < 0.4) R.curtains([210, 200, 180], 0.6 + r() * 0.3, r() < 0.5);
}
function curtainOnly(R, r) {          // 커튼이 거의 닫힘: 은은한 불빛만 새어나옴
  R.shell(); R.lamp(0.5, 0.45, 0.6, WARM, 0.5, 0.5);
  R.curtains(pick(r, [[220, 200, 170], [180, 160, 150], [235, 235, 230], [140, 120, 110], [90, 90, 110]]), 0.05 + r() * 0.2, r() < 0.5);
}

// ── 상점 (1층) ────────────────────────────────────────────────────────────
function shop(R, r) {
  R.shell(); R.ceilPanels(3, 1, 0.22, 0.14, [255, 245, 225], 1.1);
  const t = r();
  if (t < 0.35) {           // 카페/식당
    R.box(0.05, 0.6, 0.85, 0.45, 0.3, 0.2, pick(r, [[110, 80, 60], [60, 60, 65]])); R.box(0.05, 0.3, 0.98, 0.45, 0.14, 0.03, [30, 30, 34], { shadow: false });
    for (let i = 0; i < 3; i++) { R.box(0.58 + i * 0.13, 0.7, 0.4 + i * 0.1, 0.1, 0.02, 0.1, [200, 180, 150]); if (r() < 0.5) R.person(0.63 + i * 0.13, 0.85, 0.35 + i * 0.1, true); }
    R.lamp(0.3, 0.35, 0.6, WARM2, 0.25, 0.7);
  } else if (t < 0.65) {    // 의류/잡화: 진열대 + 마네킹
    for (let i = 0; i < 3; i++) R.box(0.08 + i * 0.3, 0.45, 0.9, 0.22, 0.45, 0.08, pick(r, [[230, 230, 228], [150, 130, 110]]));
    for (let i = 0; i < 4; i++) { R.panel(0.1 + i * 0.22, 0.5, 0.88, 0.06, 0.25, rgb(pick(r, [[200, 60, 60], [40, 60, 120], [240, 240, 240], [40, 40, 40], [220, 190, 120]]))); }
    if (r() < 0.6) R.person(0.3 + r() * 0.4, 0.9, 0.45, false, [235, 230, 225]);
  } else {                  // 편의점/약국: 냉장고 진열, 계산대
    for (let i = 0; i < 3; i++) { R.box(0.05 + i * 0.32, 0.3, 0.9, 0.28, 0.6, 0.1, [225, 228, 232]); for (let k = 0; k < 4; k++) R.panel(0.07 + i * 0.32, 0.36 + k * 0.13, 0.89, 0.24, 0.02, rgb([180, 190, 200])); }
    R.box(0.55, 0.65, 0.35, 0.35, 0.25, 0.15, [200, 200, 205]); if (r() < 0.5) R.person(0.72, 0.9, 0.5, false);
  }
}
function dark(R, r) {                 // 소등: 거의 검정, 바깥 불빛의 희미한 반사·비상등
  const c = R.ctx, S = R.S;
  c.fillStyle = rgb([10 + r() * 8, 11 + r() * 8, 16 + r() * 8]); c.fillRect(0, 0, S, S);
  if (r() < 0.5) { R.bright = 0.12; R.shell(); }
  if (r() < 0.3) { c.fillStyle = 'rgba(255,60,50,0.5)'; c.fillRect(S * (0.2 + r() * 0.6), S * (0.2 + r() * 0.3), 3, 2); }
  if (r() < 0.35) { R.bright = 0.25; R.blinds(0.4 + r() * 0.5, r() < 0.5, [120, 120, 125]); }
}

const OFFICE = [officeOpen, officeOpen, officeOpen, officeOpen, officeMeeting, officeMeeting, officePrivate, officePrivate, officeEmpty, officeLounge, officeCorridor, officeServer];
const HOME = [living, living, living, bedroom, bedroom, study, study, kitchen, kitchen, dining, curtainOnly, curtainOnly];

export function buildInteriorAtlas() {
  const size = ATLAS_N * TILE;
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(2024);
  for (let i = 0; i < ATLAS_N * ATLAS_N; i++) {
    let fn, opt;
    if (i < RANGE.office[1]) {
      fn = OFFICE[i % OFFICE.length];
      const cool = rng();
      opt = { light: cool < 0.7 ? COOL : NEUTRAL, wall: pick(rng, [[235, 235, 232], [225, 228, 232], [210, 205, 195], [200, 200, 205]]), floor: pick(rng, [[110, 110, 115], [140, 125, 105], [90, 95, 105], [160, 155, 150]]), back: 0.4 + rng() * 0.22 };
    } else if (i < RANGE.home[1]) {
      fn = HOME[(i - RANGE.office[1]) % HOME.length];
      opt = { light: rng() < 0.75 ? WARM : NEUTRAL, wall: pick(rng, [[240, 232, 215], [225, 210, 190], [230, 225, 220], [200, 190, 175], [190, 200, 205]]), floor: pick(rng, [[150, 110, 75], [120, 90, 65], [180, 160, 130], [100, 100, 105]]), back: 0.45 + rng() * 0.2, bright: 0.85 + rng() * 0.2 };
    } else if (i < RANGE.shop[1]) {
      fn = shop; opt = { light: NEUTRAL, wall: pick(rng, [[240, 238, 230], [200, 200, 200], [120, 90, 70]]), floor: [170, 165, 155], back: 0.5 };
    } else { fn = dark; opt = { light: [40, 45, 60], wall: [40, 42, 48], floor: [25, 26, 30], back: 0.5, bright: 0.15 }; }
    // 텍스처 flipY 때문에 셰이더의 행 j 는 캔버스의 아래에서 j 번째 행 → 캔버스 y 를 뒤집어 배치
    const x = (i % ATLAS_N) * TILE, y = (ATLAS_N - 1 - Math.floor(i / ATLAS_N)) * TILE;
    ctx.save(); ctx.translate(x, y); ctx.beginPath(); ctx.rect(0, 0, TILE, TILE); ctx.clip();
    const R = new Room(ctx, TILE, rng, opt);
    fn(R, rng);
    // 창틀 안쪽: 유리 뒤 살짝 어두운 가장자리
    const g = ctx.createRadialGradient(TILE / 2, TILE / 2, TILE * 0.4, TILE / 2, TILE / 2, TILE * 0.8); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.4)'); ctx.fillStyle = g; ctx.fillRect(0, 0, TILE, TILE);
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 4;
  tex.userData.canvas = canvas;
  return tex;
}

// ── 원거리용 창불빛 텍스처 ────────────────────────────────────────────────
// 64×64 창 격자에 켜진 창(밝기 다양)을 흰색 강도로 그린다. 셰이더가 (창 인덱스 + 창 내부 좌표)/64 로 샘플하므로
// 하드웨어 밉맵이 거리별 평균을 정확히 내준다 → 멀리서도 얼룩/깜빡임 없이 실제 야경처럼 점묘로 보인다.
export function buildFarTexture() {
  const N = 64, C = 16, size = N * C;
  const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
  const c = cv.getContext('2d'); const r = mulberry32(4711);
  c.fillStyle = 'rgb(0,0,0)'; c.fillRect(0, 0, size, size);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (r() > 0.4) continue;
    // 밝기 분포: 대부분 은은(0.2~0.55), 일부 밝음. 색은 전구색/형광 냉백색/중성 섞임 (실제 야경의 색 편차)
    const b = r() < 0.15 ? 0.85 + r() * 0.15 : 0.2 + r() * 0.35;
    const col = r() < 0.65 ? [1.0, 0.78, 0.55] : r() < 0.9 ? [1.0, 0.88, 0.72] : [0.85, 0.9, 1.0]; // 백열 65%, 할로겐 25%, 냉백색 10%
    c.fillStyle = `rgb(${Math.round(255 * b * col[0])},${Math.round(255 * b * col[1])},${Math.round(255 * b * col[2])})`;
    // 창 영역: 셀의 x 14~86 %, y 22~84 % (셰이더의 창틀 비율과 동일). 캔버스 y 는 아래로 증가하므로 뒤집는다
    c.fillRect(i * C + C * 0.14, j * C + C * 0.16, C * 0.72, C * 0.62);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 8; tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
