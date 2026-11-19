/**
 * 极简 WebGL2 三维场景查看器：筒体/平板线框 + 射线源 + 探测器 + 束锥。
 * 支持鼠标轨道旋转、滚轮缩放、拖拽源/探测器沿主轴移动。
 * 无第三方依赖，矩阵手写，便于内网离线。
 */
export interface Scene3D {
  source: [number, number, number];
  detector: [number, number, number];
  detectorSize: [number, number];
  cylinder?: { radius: number; length: number };
  plate?: { sx: number; sy: number; sz: number };
}

const VERT = `#version 300 es
in vec3 aPos; in vec3 aColor;
uniform mat4 uMVP;
out vec3 vColor;
void main(){ gl_Position=uMVP*vec4(aPos,1.0); vColor=aColor; }`;

const FRAG = `#version 300 es
precision mediump float;
in vec3 vColor; out vec4 outColor;
void main(){ outColor=vec4(vColor,1.0); }`;

type Mat4 = Float32Array;

function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function lookAt(eye: number[], center: number[], up: number[]): Mat4 {
  const z = norm3(sub3(eye, center));
  const x = norm3(cross3(up, z));
  const y = cross3(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
  ]);
}
function multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function sub3(a: number[], b: number[]) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross3(a: number[], b: number[]) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot3(a: number[], b: number[]) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm3(a: number[]) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

export class GLViewer {
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  yaw = 0.6;
  pitch = 0.35;
  dist = 1400;
  vertices: number[] = [];
  onDrag?: (which: 'source' | 'detector', z: number) => void;
  private dragging: 'source' | 'detector' | null = null;
  scene: Scene3D;

  constructor(canvas: HTMLCanvasElement, scene: Scene3D) {
    this.scene = scene;
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.prog = buildProgram(gl, VERT, FRAG);
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const stride = 6 * 4;
    const locPos = gl.getAttribLocation(this.prog, 'aPos');
    const locColor = gl.getAttribLocation(this.prog, 'aColor');
    gl.enableVertexAttribArray(locPos);
    gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(locColor);
    gl.vertexAttribPointer(locColor, 3, gl.FLOAT, false, stride, 12);
    gl.enable(gl.DEPTH_TEST);

    let lastX = 0;
    let lastY = 0;
    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const hit = this.pick(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
      if (hit) this.dragging = hit;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.dragging) {
        const dz = (e.clientY - lastY) * 3;
        const cur = this.dragging === 'source' ? scene.source[2] : scene.detector[2];
        this.onDrag?.(this.dragging, cur + dz);
      } else if (e.buttons === 1) {
        this.yaw += (e.clientX - lastX) * 0.01;
        this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + (e.clientY - lastY) * 0.01));
      }
      lastX = e.clientX;
      lastY = e.clientY;
    });
    window.addEventListener('mouseup', () => (this.dragging = null));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist = Math.max(300, Math.min(4000, this.dist + e.deltaY));
    }, { passive: false });
  }

  private line(a: number[], b: number[], c: number[]) {
    this.vertices.push(...a, ...c, ...b, ...c);
  }

  private box(center: number[], size: number[], color: number[]) {
    const [x, y, z] = center;
    const [sx, sy, sz] = size.map((v) => v / 2);
    const p = [
      [x - sx, y - sy, z - sz], [x + sx, y - sy, z - sz], [x + sx, y + sy, z - sz], [x - sx, y + sy, z - sz],
      [x - sx, y - sy, z + sz], [x + sx, y - sy, z + sz], [x + sx, y + sy, z + sz], [x - sx, y + sy, z + sz],
    ];
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    edges.forEach(([i, j]) => this.line(p[i], p[j], color));
  }

  private sphere(center: number[], r: number, color: number[]) {
    const seg = 14;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      this.line([center[0] + r * Math.cos(a0), center[1] + r * Math.sin(a0), center[2]],
        [center[0] + r * Math.cos(a1), center[1] + r * Math.sin(a1), center[2]], color);
      this.line([center[0], center[1] + r * Math.cos(a0), center[2] + r * Math.sin(a0)],
        [center[0], center[1] + r * Math.cos(a1), center[2] + r * Math.sin(a1)], color);
    }
  }

  private buildGeometry() {
    this.vertices = [];
    const gray = [0.55, 0.65, 0.78];
    const accent = [0.3, 0.64, 1];
    const green = [0.21, 0.78, 0.63];
    const warn = [0.94, 0.66, 0.28];
    if (this.scene.cylinder) {
      const { radius, length } = this.scene.cylinder;
      const rings = 6;
      const seg = 28;
      for (let r = 0; r <= rings; r++) {
        const z = -length / 2 + (r / rings) * length;
        for (let i = 0; i < seg; i++) {
          const a0 = (i / seg) * Math.PI * 2;
          const a1 = ((i + 1) / seg) * Math.PI * 2;
          this.line([radius * Math.cos(a0), radius * Math.sin(a0), z], [radius * Math.cos(a1), radius * Math.sin(a1), z], gray);
        }
      }
      for (let i = 0; i < seg; i += 4) {
        const a = (i / seg) * Math.PI * 2;
        this.line([radius * Math.cos(a), radius * Math.sin(a), -length / 2], [radius * Math.cos(a), radius * Math.sin(a), length / 2], [0.35, 0.42, 0.52]);
      }
    }
    if (this.scene.plate) this.box([0, 0, 0], [this.scene.plate.sx, this.scene.plate.sy, this.scene.plate.sz], gray);
    // 源（橙球）与探测器（绿框）
    this.sphere(this.scene.source, 18, warn);
    this.box(this.scene.detector, [this.scene.detectorSize[0], this.scene.detectorSize[1], 12], green);
    // 束锥：源到探测器四角
    const [dx, dy, dz] = this.scene.detector;
    const [sw, sh] = this.scene.detectorSize;
    [[-sw / 2, -sh / 2], [sw / 2, -sh / 2], [sw / 2, sh / 2], [-sw / 2, sh / 2]].forEach(([ox, oy]) =>
      this.line(this.scene.source, [dx + ox, dy + oy, dz], accent));
    // 主束
    this.line(this.scene.source, this.scene.detector, [1, 0.4, 0.4]);
  }

  private pick(px: number, py: number, w: number, h: number): 'source' | 'detector' | null {
    // 简化拾取：把源/探测器投影到屏幕，命中半径 24px
    const mvp = this.mvp(w, h);
    for (const [name, pt] of [['source', this.scene.source], ['detector', this.scene.detector]] as const) {
      const clip = project(pt, mvp);
      const sx = (clip[0] * 0.5 + 0.5) * w;
      const sy = (1 - (clip[1] * 0.5 + 0.5)) * h;
      if (Math.hypot(sx - px, sy - py) < 26) return name;
    }
    return null;
  }

  private mvp(w: number, h: number): Mat4 {
    const eye = [
      Math.cos(this.pitch) * Math.sin(this.yaw) * this.dist,
      Math.sin(this.pitch) * this.dist,
      Math.cos(this.pitch) * Math.cos(this.yaw) * this.dist,
    ];
    const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
    const proj = perspective((45 * Math.PI) / 180, w / h, 10, 8000);
    return multiply(proj, view);
  }

  render() {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * devicePixelRatio) {
      canvas.width = w * devicePixelRatio;
      canvas.height = h * devicePixelRatio;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.02, 0.04, 0.07, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.buildGeometry();
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.vertices), gl.DYNAMIC_DRAW);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.prog, 'uMVP'), false, this.mvp(canvas.width, canvas.height));
    gl.drawArrays(gl.LINES, 0, this.vertices.length / 6);
  }
}

function project(p: number[], m: Mat4): number[] {
  const x = p[0], y = p[1], z = p[2];
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [cx / cw, cy / cw];
}

function buildProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const v = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(v, vs);
  gl.compileShader(v);
  const f = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(f, fs);
  gl.compileShader(f);
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  return p;
}
