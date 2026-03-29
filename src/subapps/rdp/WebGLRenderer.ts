/**
 * @file WebGLRenderer.ts
 * @description 高性能 RDP 远程桌面 WebGL 渲染器。
 *
 * 核心设计：
 * 1. 单一上下文共享：支持通过单一 WebGL 上下文管理多个 RDP 会话的纹理。
 * 2. 脏矩形局部更新：利用 `texSubImage2D` 仅更新画面变化区域，大幅降低 GPU 上传带宽。
 * 3. 零拷贝渲染：直接将 RDP 二进制像素流上传至 GPU 纹理，并利用着色器直接绘制到屏幕，跳过 2D Canvas 中间层。
 * 4. 坐标对齐：针对 RDP 协议特点，顶点着色器已预设好坐标映射，确保画面方向与原始流一致。
 */

export class RdpWebGLRenderer {
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private currentTexture: WebGLTexture | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", {
      alpha: false, // 禁用透明度以提升渲染性能
      depth: false, // RDP 画面不涉及深度测试
      stencil: false,
      antialias: false, // 像素对齐画面不需要抗锯齿
      preserveDrawingBuffer: true, // 必须保留缓冲区以实现脏矩形累积绘制
    });
    if (!gl) {
      throw new Error("WebGL not supported");
    }
    this.gl = gl;
    this.initShaders();
    this.initBuffers();

    // 全局 WebGL 状态优化
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  /**
   * 初始化着色器程序
   * 使用简单的纹理采样着色器，确保最快的像素传输。
   */
  private initShaders() {
    const gl = this.gl;
    if (!gl) return;
    const vsSource = `
      attribute vec2 aPosition;
      attribute vec2 aTexCoord;
      varying vec2 vTexCoord;
      void main() {
        gl_Position = vec4(aPosition, 0, 1);
        vTexCoord = aTexCoord;
      }
    `;
    const fsSource = `
      precision mediump float;
      varying vec2 vTexCoord;
      uniform sampler2D uSampler;
      void main() {
        gl_FragColor = texture2D(uSampler, vTexCoord);
      }
    `;

    const vs = this.compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSource);
    const program = gl.createProgram();
    if (!program) throw new Error("Failed to create program");
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error("Shader link failed");
    }
    this.program = program;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    if (!gl) {
      throw new Error("WebGL context lost");
    }
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || "Shader compile error");
    }
    return shader;
  }

  /**
   * 初始化顶点缓冲区
   * RDP 坐标映射逻辑：
   * Top-Left (-1, 1) -> (0, 0)
   * Bottom-Left (-1, -1) -> (0, 1)
   */
  private initBuffers() {
    const gl = this.gl;
    if (!gl) return;
    const vertices = new Float32Array([
      -1, 1, 0, 0, -1, -1, 0, 1, 1, 1, 1, 0, 1, -1, 1, 1,
    ]);
    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  }

  /**
   * 为指定会话创建一个 WebGL 纹理
   * @param width 纹理初始宽度
   * @param height 纹理初始高度
   */
  public createTexture(width: number, height: number): WebGLTexture {
    const gl = this.gl;
    if (!gl) throw new Error("WebGL context lost");

    const texture = gl.createTexture();
    if (!texture) throw new Error("Failed to create texture");

    gl.bindTexture(gl.TEXTURE_2D, texture);
    this.currentTexture = texture;

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );

    // 使用 NEAREST 过滤以确保 RDP 字体和线条保持绝对清晰（无模糊插值）
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return texture;
  }

  /**
   * 销毁不再使用的会话纹理
   */
  public deleteTexture(texture: WebGLTexture | null) {
    if (!texture || !this.gl) return;
    if (this.currentTexture === texture) {
      this.currentTexture = null;
    }
    this.gl.deleteTexture(texture);
  }

  /**
   * 脏矩形上传：仅上传像素数据到指定的纹理
   * @param texture 目标纹理
   * @param x 脏矩形左上角 X
   * @param y 脏矩形左上角 Y
   * @param width 脏矩形宽度
   * @param height 脏矩形高度
   * @param pixels RGBA 像素数据
   */
  public uploadRect(
    texture: WebGLTexture,
    x: number,
    y: number,
    width: number,
    height: number,
    pixels: Uint8ClampedArray | Uint8Array,
  ) {
    const gl = this.gl;
    if (!gl) return;

    if (this.currentTexture !== texture) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      this.currentTexture = texture;
    }

    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      x,
      y,
      width,
      height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
  }

  /**
   * 将指定纹理提交到主画布并触发重绘
   * @param texture 要显示的纹理
   * @param width 纹理原始宽度（用于视口对齐）
   * @param height 纹理原始高度
   */
  public commit(texture: WebGLTexture, width: number, height: number) {
    const gl = this.gl;
    if (!gl || !this.program || !this.vertexBuffer) return;

    // 动态同步画布尺寸，确保 object-fit: contain 效果正确
    // 注意：修改 canvas.width 会导致 WebGL 上下文状态部分重置，仅在尺寸变化时执行
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      gl.viewport(0, 0, width, height);
      // 尺寸变化后强制重新绑定纹理和程序状态
      this.currentTexture = null;
    }

    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);

    const aPos = gl.getAttribLocation(this.program, "aPosition");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);

    const aTex = gl.getAttribLocation(this.program, "aTexCoord");
    gl.enableVertexAttribArray(aTex);
    gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 16, 8);

    if (this.currentTexture !== texture) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      this.currentTexture = texture;
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** 清空当前画布，避免会话切换或断开后残留最后一帧。 */
  public clear() {
    const gl = this.gl;
    if (!gl) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}
