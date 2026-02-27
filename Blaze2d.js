/**
 * Blaze2D - High-Performance WebGL 2D Renderer v1.0
 * A drop-in replacement for Canvas 2D tailored for games with massive sprite counts.
 */
export class Blaze2D {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl2', {
            alpha: true, depth: false, antialias: true,
            premultipliedAlpha: true, preserveDrawingBuffer: false,
            powerPreference: 'high-performance', desynchronized: true,
            ...options
        });

        if (!this.gl) {
            console.warn('WebGL2 not available, falling back to WebGL1');
            this.gl = canvas.getContext('webgl', {
                alpha: true, depth: false, antialias: true,
                premultipliedAlpha: true, powerPreference: 'high-performance',
                ...options
            });
        }

        if (!this.gl) throw new Error('WebGL is not supported in this browser.');

        const gl = this.gl;
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

        this.currentTime = 0;
        this.cameraX     = 0;
        this.cameraY     = 0;

        this.maxBatchSize        = 8192;
        this.verticesPerSprite   = 4;
        this.indicesPerSprite    = 6;
        this.vertexStride        = 9;
        this.vertexCountPerSprite = this.verticesPerSprite * this.vertexStride;
        this.WHITE_RGBA          = new Float32Array([1, 1, 1, 1]);

        this.dnVertexStride  = 17;
        this.dnMaxBatchSize  = 4000;
        this.dnBatchCount    = 0;
        this.dnVertexData    = new Float32Array(this.dnMaxBatchSize * 4 * this.dnVertexStride);
        this.dnVertexBuffer  = null;
        this.dnIndexBuffer   = null;
        this.dnCurrentTexture = null;

        this.initShaders();
        this.initGravityShader();
        this.initIceFieldShader();
        this.initDamageNumberShader();
        this.initBuffers();

        this.textureCache      = new Map();
        this.textureUsage      = new Map();
        this.gradientCache     = new Map();
        this.textCache         = new Map();
        this.colorCache        = new Map();
        this.statePool         = [];
        this.atlasCache        = new Map();
        this.currentTexture    = null;
        this.batchCount        = 0;
        this.drawCallCount     = 0;
        this.triangleCount     = 0;
        this.maxTextureCacheSize = 200;
        this.maxTextCacheSize    = 1000;

        this.textCanvas = document.createElement('canvas');
        this.textCtx    = this.textCanvas.getContext('2d');

        this.whiteTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.whiteTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
        gl.bindTexture(gl.TEXTURE_2D, null);

        this.stateStack  = [this._createDefaultState()];
        this.width       = canvas.width;
        this.height      = canvas.height;
        this.dpr         = 1;
        this.currentPath = [];

        this._effectQuadVerts = new Float32Array([
            0, 0, 0, 0,
            0, 0, 1, 0,
            0, 0, 1, 1,
            0, 0, 0, 1
        ]);

        this.initBitmapFont();

        const maxTex    = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048;
        this.atlasSize  = Math.min(maxTex, 4096);
        this.atlasTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.atlasSize, this.atlasSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        this.atlasX         = 0;
        this.atlasY         = 0;
        this.atlasRowHeight = 0;
        this.atlasPadding   = 2;
    }

    setTime(time)      { this.currentTime = time; }
    setCamera(x, y)    { this.cameraX = x; this.cameraY = y; }
    resetFrameStats()  { this.drawCallCount = 0; this.triangleCount = 0; }

    initBitmapFont() {
        const chars    = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~✨⭐❤⚡🔥❄💧🍀👾💀👻🧟🧙👹💣☠️👿🐉🔪💨➬➪🔹💠🤝🗡️🎁💖🧲🧄🟢🦇❄️👼🐕👁️";
        this.bitmapFont = new Map();
        const fontSize  = 64;
        const padding   = 8;
        this.textCtx.font = `bold ${fontSize}px Arial`;

        const charInfos = [];
        let maxHeight   = 0;
        for (const char of chars) {
            const charWidth   = Math.ceil(this.textCtx.measureText(char).width);
            const charHeight  = Math.ceil(fontSize * 1.2);
            const renderWidth = charWidth + padding * 2;
            const renderHeight = charHeight + padding * 2;
            charInfos.push({ char, charWidth, charHeight, renderWidth, renderHeight });
            maxHeight = Math.max(maxHeight, renderHeight);
        }

        const atlasWidth = 1024;
        let atlasHeight  = maxHeight;
        let curX = 0, curY = 0;
        for (const info of charInfos) {
            if (curX + info.renderWidth > atlasWidth) { curX = 0; curY += maxHeight; atlasHeight += maxHeight; }
            info.x = curX; info.y = curY;
            curX += info.renderWidth;
        }

        const finalH = Math.pow(2, Math.ceil(Math.log2(atlasHeight)));
        this.textCanvas.width  = atlasWidth;
        this.textCanvas.height = finalH;

        this.textCtx.font        = `bold ${fontSize}px Arial`;
        this.textCtx.textAlign   = 'left';
        this.textCtx.textBaseline = 'middle';
        this.textCtx.strokeStyle = '#000000';
        this.textCtx.lineWidth   = fontSize / 6;
        this.textCtx.lineJoin    = 'round';
        this.textCtx.fillStyle   = '#ffffff';
        this.textCtx.clearRect(0, 0, atlasWidth, finalH);

        for (const info of charInfos) {
            const dx = info.x + padding, dy = info.y + info.renderHeight / 2;
            this.textCtx.strokeText(info.char, dx, dy);
            this.textCtx.fillText(info.char, dx, dy);
        }

        const gl      = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.textCanvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        for (const info of charInfos) {
            this.bitmapFont.set(info.char, {
                texture, padding, fontSize,
                width: info.charWidth, height: info.charHeight,
                renderWidth: info.renderWidth, renderHeight: info.renderHeight,
                u0: info.x / atlasWidth,          v0: info.y / finalH,
                u1: (info.x + info.renderWidth) / atlasWidth,
                v1: (info.y + info.renderHeight) / finalH
            });
        }
    }

    initShaders() {
        const gl = this.gl;
        this.program = this.createProgram(`
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            attribute float a_alpha;
            attribute vec4 a_color;
            uniform vec2 u_resolution;
            varying vec2 v_texCoord;
            varying float v_alpha;
            varying vec4 v_color;
            void main() {
                vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
                gl_Position = vec4(clip * vec2(1, -1), 0, 1);
                v_texCoord = a_texCoord; v_alpha = a_alpha; v_color = a_color;
            }
        `, `
            precision mediump float;
            uniform sampler2D u_image;
            varying vec2 v_texCoord;
            varying float v_alpha;
            varying vec4 v_color;
            void main() {
                vec4 texColor = texture2D(u_image, v_texCoord);
                float isFlash = step(1.5, v_color.a);
                vec3 rgb = mix(texColor.rgb * v_color.rgb, vec3(1.0, 0.0, 0.0), isFlash);
                float a = texColor.a * v_alpha;
                gl_FragColor = vec4(rgb * a, a);
            }
        `);
        this.locations = {
            position:   gl.getAttribLocation(this.program, 'a_position'),
            texCoord:   gl.getAttribLocation(this.program, 'a_texCoord'),
            alpha:      gl.getAttribLocation(this.program, 'a_alpha'),
            color:      gl.getAttribLocation(this.program, 'a_color'),
            resolution: gl.getUniformLocation(this.program, 'u_resolution'),
            image:      gl.getUniformLocation(this.program, 'u_image')
        };
    }

    initDamageNumberShader() {
        const gl = this.gl;
        this.dnProgram = this.createProgram(`
            attribute vec2 a_posOffset;
            attribute vec2 a_texCoord;
            attribute vec2 a_startPos;
            attribute vec2 a_charOffset;
            attribute vec2 a_velocity;
            attribute vec3 a_timeParams;
            attribute vec3 a_color;
            attribute float a_alpha;
            uniform vec2 u_resolution;
            uniform float u_dpr;
            uniform float u_currentTime;
            uniform vec2 u_cameraPos;
            uniform float u_gravity;
            varying vec2 v_texCoord;
            varying float v_alpha;
            varying vec3 v_color;
            varying float v_flash;
            void main() {
                float t = u_currentTime - a_timeParams.x;
                if (t < -0.05 || t > a_timeParams.y + 0.1) {
                    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0); return;
                }
                t = max(0.0, t);
                float progress = t / a_timeParams.y;
                float scale = a_timeParams.z;
                if (progress < 0.2)      scale *= mix(0.3, 1.0, progress / 0.2);
                else if (progress > 0.7) scale *= (1.0 - (progress - 0.7) / 0.3);
                if (t < 0.1) scale *= (1.0 + sin(t * 10.0 * 1.57) * 0.1);
                float resistance = exp(-3.0 * t);
                float x = a_startPos.x + (a_charOffset.x * scale) + a_velocity.x * t * resistance;
                float y = a_startPos.y + (a_charOffset.y * scale) + a_velocity.y * t + 0.5 * u_gravity * t * t;
                vec2 screenPos = (vec2(x, y) - u_cameraPos) * u_dpr + u_resolution / 2.0 + a_posOffset * scale * u_dpr;
                vec2 clip = (screenPos / u_resolution) * 2.0 - 1.0;
                gl_Position = vec4(clip * vec2(1, -1), 0, 1);
                v_texCoord = a_texCoord;
                v_color    = a_color;
                float alpha = 1.0;
                if (progress > 0.7) alpha = 1.0 - (progress - 0.7) / 0.3;
                v_alpha = alpha * a_alpha;
                v_flash = (progress < 0.2) ? (0.6 * (1.0 - progress / 0.2)) : 0.0;
            }
        `, `
            precision mediump float;
            uniform sampler2D u_image;
            varying vec2 v_texCoord;
            varying float v_alpha;
            varying vec3 v_color;
            varying float v_flash;
            void main() {
                vec4 texColor = texture2D(u_image, v_texCoord);
                if (texColor.a < 0.01) discard;
                vec3 rgb = mix(texColor.rgb * v_color, vec3(1.0), v_flash * 0.7);
                float a = texColor.a * v_alpha;
                gl_FragColor = vec4(rgb * a, a);
            }
        `);
        this.dnLocations = {
            posOffset:   gl.getAttribLocation(this.dnProgram, 'a_posOffset'),
            texCoord:    gl.getAttribLocation(this.dnProgram, 'a_texCoord'),
            startPos:    gl.getAttribLocation(this.dnProgram, 'a_startPos'),
            charOffset:  gl.getAttribLocation(this.dnProgram, 'a_charOffset'),
            velocity:    gl.getAttribLocation(this.dnProgram, 'a_velocity'),
            timeParams:  gl.getAttribLocation(this.dnProgram, 'a_timeParams'),
            color:       gl.getAttribLocation(this.dnProgram, 'a_color'),
            alpha:       gl.getAttribLocation(this.dnProgram, 'a_alpha'),
            resolution:  gl.getUniformLocation(this.dnProgram, 'u_resolution'),
            dpr:         gl.getUniformLocation(this.dnProgram, 'u_dpr'),
            currentTime: gl.getUniformLocation(this.dnProgram, 'u_currentTime'),
            cameraPos:   gl.getUniformLocation(this.dnProgram, 'u_cameraPos'),
            gravity:     gl.getUniformLocation(this.dnProgram, 'u_gravity'),
            image:       gl.getUniformLocation(this.dnProgram, 'u_image')
        };
    }

    initGravityShader() {
        const gl = this.gl;
        const effectVS = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            uniform vec2 u_resolution;
            uniform mat3 u_matrix;
            varying vec2 v_texCoord;
            void main() {
                vec3 pos = u_matrix * vec3(a_position, 1.0);
                vec2 clip = (pos.xy / u_resolution) * 2.0 - 1.0;
                gl_Position = vec4(clip * vec2(1, -1), 0, 1);
                v_texCoord = a_texCoord;
            }
        `;
        this.gravityProgram = this.createProgram(effectVS, `
            precision mediump float;
            varying vec2 v_texCoord;
            uniform float u_time;
            uniform vec4 u_colorInner;
            uniform vec4 u_colorOuter;
            uniform float u_distortion;
            float noise(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
            float smoothNoise(vec2 p) {
                vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
                return mix(mix(noise(i),noise(i+vec2(1,0)),f.x),mix(noise(i+vec2(0,1)),noise(i+vec2(1,1)),f.x),f.y);
            }
            void main() {
                vec2 uv = v_texCoord * 2.0 - 1.0;
                float dist = length(uv), angle = atan(uv.y, uv.x);
                float n1 = smoothNoise(vec2(angle*3.0, u_time*1.5));
                float n2 = smoothNoise(vec2(uv.x*5.0+u_time, uv.y*5.0-u_time));
                float distort = (n1*0.7+n2*0.3)*u_distortion;
                float jitter = sin(angle*20.0-u_time*25.0)*0.01*u_distortion + cos(angle*40.0+u_time*30.0)*0.005*u_distortion;
                float d = dist + distort*0.1 + jitter;
                if (d > 1.0) discard;
                vec4 col; float alpha;
                if (d < 0.94)      { alpha = (d/0.94)*0.35; col = u_colorInner; }
                else if (d < 0.98) { float t=(d-0.94)/0.04; alpha=mix(0.35,0.95,t); col=mix(u_colorInner,u_colorOuter,t); }
                else               { float t=(d-0.98)/0.02; alpha=mix(0.95,0.0,t);  col=u_colorOuter; }
                float r1=abs(d-(0.6+sin(u_time*0.8)*0.05)), r2=abs(d-(0.4+cos(u_time*1.2)*0.03));
                if (r1<0.015) alpha+=(0.015-r1)*15.0*0.3;
                if (r2<0.012) alpha+=(0.012-r2)*20.0*0.2;
                vec2 gUV=(v_texCoord-0.5)*10.0+distort*0.5;
                float grid=abs(sin(gUV.x*2.0+u_time))+abs(sin(gUV.y*2.0-u_time));
                if (grid<0.1) alpha+=(0.1-grid)*2.0*0.1;
                gl_FragColor = col * alpha;
            }
        `);
        this.gravityLocations = {
            position:   gl.getAttribLocation(this.gravityProgram, 'a_position'),
            texCoord:   gl.getAttribLocation(this.gravityProgram, 'a_texCoord'),
            resolution: gl.getUniformLocation(this.gravityProgram, 'u_resolution'),
            matrix:     gl.getUniformLocation(this.gravityProgram, 'u_matrix'),
            time:       gl.getUniformLocation(this.gravityProgram, 'u_time'),
            colorInner: gl.getUniformLocation(this.gravityProgram, 'u_colorInner'),
            colorOuter: gl.getUniformLocation(this.gravityProgram, 'u_colorOuter'),
            distortion: gl.getUniformLocation(this.gravityProgram, 'u_distortion')
        };
    }

    initIceFieldShader() {
        const gl = this.gl;
        const effectVS = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            uniform vec2 u_resolution;
            uniform mat3 u_matrix;
            varying vec2 v_texCoord;
            void main() {
                vec3 pos = u_matrix * vec3(a_position, 1.0);
                vec2 clip = (pos.xy / u_resolution) * 2.0 - 1.0;
                gl_Position = vec4(clip * vec2(1, -1), 0, 1);
                v_texCoord = a_texCoord;
            }
        `;
        this.iceProgram = this.createProgram(effectVS, `
            precision mediump float;
            varying vec2 v_texCoord;
            uniform float u_time;
            uniform vec4 u_colorInner;
            uniform vec4 u_colorOuter;
            uniform float u_alpha;
            float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123); }
            float noise(vec2 p) {
                vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
                return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
            }
            void main() {
                vec2 uv = v_texCoord*2.0-1.0;
                float dist = length(uv);
                float nE = noise(uv*3.0+u_time*0.2), nE2 = noise(uv*6.0-u_time*0.1);
                float dd = dist+(nE*0.1+nE2*0.05);
                if (dd > 1.0) discard;
                vec4 color = mix(u_colorInner, u_colorOuter, pow(dd,1.4));
                color += vec4(0.5,0.8,1.0,0.0)*smoothstep(0.7,1.0,dd)*0.3;
                vec2 cUV=uv*2.2;
                float n1=noise(cUV+u_time*0.04), n2=noise(cUV*2.5-u_time*0.07);
                float crack=smoothstep(0.44,0.5,n1)*smoothstep(0.56,0.5,n1)+smoothstep(0.47,0.5,n2)*smoothstep(0.53,0.5,n2)*0.8;
                color += crack*vec4(0.8,0.95,1.0,0.0)*(1.2-dist);
                color -= crack*0.2;
                color.rgb += hash(uv*60.0+nE*0.1)*0.1;
                float glitter=hash(uv*35.0+floor(u_time*8.0));
                if (glitter>0.982) color.rgb += (vec3(0.8,0.9,1.0)+vec3(hash(uv),hash(uv+1.0),hash(uv+2.0))*0.2)*(1.1-dist);
                float angle=u_time*0.3;
                mat2 rot=mat2(cos(angle),-sin(angle),sin(angle),cos(angle));
                vec2 sUV=(rot*uv)*5.0;
                vec2 id=floor(sUV); float h=hash(id);
                if (h>0.92) {
                    float p=sin(u_time*2.0+h*6.28)*0.5+0.5;
                    float shape=smoothstep(0.18*p,0.0,length(fract(sUV)-0.5));
                    color+=vec4(0.95,0.98,1.0,0.0)*shape;
                }
                gl_FragColor = color*u_alpha*smoothstep(1.0,0.9,dd);
            }
        `);
        this.iceLocations = {
            position:   gl.getAttribLocation(this.iceProgram, 'a_position'),
            texCoord:   gl.getAttribLocation(this.iceProgram, 'a_texCoord'),
            resolution: gl.getUniformLocation(this.iceProgram, 'u_resolution'),
            matrix:     gl.getUniformLocation(this.iceProgram, 'u_matrix'),
            time:       gl.getUniformLocation(this.iceProgram, 'u_time'),
            colorInner: gl.getUniformLocation(this.iceProgram, 'u_colorInner'),
            colorOuter: gl.getUniformLocation(this.iceProgram, 'u_colorOuter'),
            alpha:      gl.getUniformLocation(this.iceProgram, 'u_alpha')
        };
    }

    initBuffers() {
        const gl = this.gl;

        this.vertexData   = new Float32Array(this.maxBatchSize * this.verticesPerSprite * this.vertexStride);
        this.vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData.byteLength, gl.DYNAMIC_DRAW);

        const indices = new Uint16Array(this.maxBatchSize * this.indicesPerSprite);
        for (let i = 0; i < this.maxBatchSize; i++) {
            const v = i * 4, idx = i * 6;
            indices[idx]=v; indices[idx+1]=v+1; indices[idx+2]=v+2;
            indices[idx+3]=v; indices[idx+4]=v+2; indices[idx+5]=v+3;
        }
        this.indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

        this.dnVertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dnVertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.dnVertexData.byteLength, gl.DYNAMIC_DRAW);

        const dnIndices = new Uint16Array(this.dnMaxBatchSize * 6);
        for (let i = 0; i < this.dnMaxBatchSize; i++) {
            const v = i * 4, idx = i * 6;
            dnIndices[idx]=v; dnIndices[idx+1]=v+1; dnIndices[idx+2]=v+2;
            dnIndices[idx+3]=v; dnIndices[idx+4]=v+2; dnIndices[idx+5]=v+3;
        }
        this.dnIndexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.dnIndexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, dnIndices, gl.STATIC_DRAW);

        this.effectQuadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.effectQuadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, 64, gl.DYNAMIC_DRAW);
    }

    createShader(type, source) {
        const gl     = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error(gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    createProgram(vsSource, fsSource) {
        const gl      = this.gl;
        const program = gl.createProgram();
        gl.attachShader(program, this.createShader(gl.VERTEX_SHADER, vsSource));
        gl.attachShader(program, this.createShader(gl.FRAGMENT_SHADER, fsSource));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error(gl.getProgramInfoLog(program));
            gl.deleteProgram(program);
            return null;
        }
        return program;
    }

    _createDefaultState() {
        return {
            matrix: new Float32Array([1, 0, 0, 1, 0, 0]),
            alpha: 1.0, flash: 0,
            fillStyle: '#ffffff',   fillStyleRGBA: new Float32Array([1, 1, 1, 1]),
            strokeStyle: '#000000', strokeStyleRGBA: new Float32Array([0, 0, 0, 1]),
            lineWidth: 1, font: '20px Arial',
            textAlign: 'left', textBaseline: 'alphabetic',
            globalCompositeOperation: 'source-over',
            shadowBlur: 0, shadowColor: 'transparent'
        };
    }

    _copyState(from, to) {
        to.matrix.set(from.matrix);
        to.alpha = from.alpha; to.flash = from.flash;
        to.fillStyle = from.fillStyle;
        if (from.fillStyleRGBA?.isGradient) {
            to.fillStyleRGBA = from.fillStyleRGBA;
        } else if (from.fillStyleRGBA) {
            if (!to.fillStyleRGBA || to.fillStyleRGBA.isGradient || to.fillStyleRGBA.length !== 4) to.fillStyleRGBA = new Float32Array(4);
            to.fillStyleRGBA.set(from.fillStyleRGBA);
        }
        to.strokeStyle = from.strokeStyle;
        if (from.strokeStyleRGBA?.isGradient) {
            to.strokeStyleRGBA = from.strokeStyleRGBA;
        } else if (from.strokeStyleRGBA) {
            if (!to.strokeStyleRGBA || to.strokeStyleRGBA.isGradient || to.strokeStyleRGBA.length !== 4) to.strokeStyleRGBA = new Float32Array(4);
            to.strokeStyleRGBA.set(from.strokeStyleRGBA);
        }
        to.lineWidth = from.lineWidth; to.font = from.font;
        to.textAlign = from.textAlign; to.textBaseline = from.textBaseline;
        to.globalCompositeOperation = from.globalCompositeOperation;
        to.shadowBlur = from.shadowBlur; to.shadowColor = from.shadowColor;
    }

    save() {
        const current = this.stateStack[this.stateStack.length - 1];
        const next    = this.statePool.pop() || this._createDefaultState();
        this._copyState(current, next);
        this.stateStack.push(next);
    }

    restore() {
        if (this.stateStack.length <= 1) return;
        const oldMode  = this.globalCompositeOperation;
        const discarded = this.stateStack.pop();
        this.statePool.push(discarded);
        if (oldMode !== this.globalCompositeOperation) { this.flush(); this._updateBlendMode(); }
    }

    _updateBlendMode() {
        const gl   = this.gl;
        const mode = this.globalCompositeOperation;
        if (mode === 'source-atop')                                    gl.blendFunc(gl.DST_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        else if (mode === 'lighter' || mode === 'screen' || mode === 'additive') gl.blendFunc(gl.ONE, gl.ONE);
        else                                                           gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    get _state() { return this.stateStack[this.stateStack.length - 1]; }

    set fillStyle(v) {
        const s = this._state; if (s.fillStyle === v) return; s.fillStyle = v;
        if (typeof v === 'object' && v !== null) { s.fillStyleRGBA = v; return; }
        const rgba = this._parseColor(v);
        if (!s.fillStyleRGBA || s.fillStyleRGBA.isGradient || !s.fillStyleRGBA.set) s.fillStyleRGBA = new Float32Array(4);
        s.fillStyleRGBA.set(rgba);
    }
    get fillStyle() { return this._state.fillStyle; }

    set strokeStyle(v) {
        const s = this._state; if (s.strokeStyle === v) return; s.strokeStyle = v;
        const rgba = this._parseColor(v);
        if (!s.strokeStyleRGBA || s.strokeStyleRGBA.isGradient || !s.strokeStyleRGBA.set) s.strokeStyleRGBA = new Float32Array(4);
        s.strokeStyleRGBA.set(rgba);
    }
    get strokeStyle() { return this._state.strokeStyle; }

    set globalAlpha(v)  { this._state.alpha = v; }
    get globalAlpha()   { return this._state.alpha; }
    set flash(v)        { this._state.flash = v ? 1 : 0; }
    get flash()         { return this._state.flash; }
    set lineWidth(v)    { this._state.lineWidth = v; }
    get lineWidth()     { return this._state.lineWidth; }
    set shadowBlur(v)   { this._state.shadowBlur = v; }
    get shadowBlur()    { return this._state.shadowBlur; }
    set shadowColor(v)  { this._state.shadowColor = v; }
    get shadowColor()   { return this._state.shadowColor; }
    set font(v)         { this._state.font = v; }
    get font()          { return this._state.font; }
    set textAlign(v)    { this._state.textAlign = v; }
    get textAlign()     { return this._state.textAlign; }
    set textBaseline(v) { this._state.textBaseline = v; }
    get textBaseline()  { return this._state.textBaseline; }
    set lineCap(v)      { this._state.lineCap = v; }
    get lineCap()       { return this._state.lineCap || 'butt'; }
    set lineJoin(v)     { this._state.lineJoin = v; }
    get lineJoin()      { return this._state.lineJoin || 'miter'; }
    set globalCompositeOperation(v) {
        const s = this._state; if (s.globalCompositeOperation === v) return;
        this.flush(); s.globalCompositeOperation = v; this._updateBlendMode();
    }
    get globalCompositeOperation() { return this._state.globalCompositeOperation || 'source-over'; }
    set lineDash(v)       { this._lineDash = v; }
    get lineDash()        { return this._lineDash || []; }
    set lineDashOffset(v) { this._lineDashOffset = v; }
    get lineDashOffset()  { return this._lineDashOffset || 0; }
    setLineDash(v)        { this._lineDash = v; }

    translate(x, y) {
        const m = this._state.matrix;
        m[4] += m[0]*x + m[2]*y; m[5] += m[1]*x + m[3]*y;
    }
    scale(sx, sy) {
        const m = this._state.matrix;
        m[0]*=sx; m[1]*=sx; m[2]*=sy; m[3]*=sy;
    }
    rotate(angle) {
        const m = this._state.matrix, c = Math.cos(angle), s = Math.sin(angle);
        const m0=m[0],m1=m[1],m2=m[2],m3=m[3];
        m[0]=m0*c+m2*s; m[1]=m1*c+m3*s; m[2]=m0*-s+m2*c; m[3]=m1*-s+m3*c;
    }
    setTransform(a, b, c, d, e, f) {
        const m = this._state.matrix;
        m[0]=a; m[1]=b; m[2]=c; m[3]=d; m[4]=e; m[5]=f;
    }

    clearRect(x, y, w, h) {
        const t = 1.0;
        if (x<=t && y<=t && w>=(this.width/this.dpr)-t && h>=(this.height/this.dpr)-t) this.clear();
    }

    clear() {
        this.flush();
        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.resetState();
    }

    resetState() {
        this.batchCount = 0; this.currentTexture = null;
        while (this.stateStack.length > 1) this.statePool.push(this.stateStack.pop());
        const root = this.stateStack[0];
        this._copyState(this._createDefaultState(), root);
        root.matrix[0] = root.matrix[3] = this.dpr || 1;
        this.globalCompositeOperation = 'source-over';
        this._updateBlendMode();
    }

    resize(width, height, dpr = 1) {
        this.width = width * dpr; this.height = height * dpr; this.dpr = dpr;
        this.canvas.width = this.width; this.canvas.height = this.height;
        this.gl.viewport(0, 0, this.width, this.height);
        this.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    fillRect(x, y, w, h) {
        const s = this._state;
        if (typeof s.fillStyle === 'object' && s.fillStyle?.isGradient) { this.beginPath(); this.rect(x,y,w,h); this.fill(); return; }
        const rgba = typeof s.fillStyle === 'string' ? this._parseColor(s.fillStyle) : (Array.isArray(s.fillStyle) ? s.fillStyle : this.WHITE_RGBA);
        this._drawRect(x, y, w, h, rgba, s.alpha);
    }

    drawRect(x, y, w, h, color = [1,1,1,1], alpha = 1.0) {
        this._drawTextureDirect(this.whiteTexture, x, y, w, h, alpha, typeof color === 'string' ? this._parseColor(color) : color);
    }

    drawCircle(x, y, radius, color = [1,1,1,1], alpha = 1.0, isStroke = false, lineWidth = 1) {
        this._drawCircle(x, y, radius, color, alpha, isStroke, lineWidth);
    }

    drawLine(x1, y1, x2, y2, width, color = [1,1,1,1], alpha = 1.0) {
        this._drawLine(x1, y1, x2, y2, width, typeof color === 'string' ? this._parseColor(color) : color, alpha, this._state.matrix);
    }

    drawShadow(shadowTexture, x, y, w, h, alpha = 0.3) {
        if (!shadowTexture) return;
        if (shadowTexture._needsUpdate === undefined) shadowTexture._needsUpdate = true;
        const info = this.getTexture(shadowTexture);
        if (!info) return;
        this._drawTextureDirect(info, x, y, w, h, alpha, [1,1,1,1], 0, 0, 1, 1);
    }

    drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh) {
        if (!image) return;
        if (arguments.length <= 5) {
            dx=sx; dy=sy;
            if (arguments.length===5) { dw=sw; dh=sh; } else { dw=image.width; dh=image.height; }
            sx=0; sy=0; sw=image.width; sh=image.height;
        }
        const info    = this.getTexture(image);
        const texture = info.texture ? info.texture : info;
        if (this.currentTexture !== texture || this.batchCount >= this.maxBatchSize) {
            if (this.batchCount > 0) this.flush();
            this.currentTexture = (texture instanceof WebGLTexture) ? texture : this.whiteTexture;
        }
        const s = this._state, m = s.matrix;
        const m0=m[0],m1=m[1],m2=m[2],m3=m[3],m4=m[4],m5=m[5];
        let u0,v0,u1,v1;
        if (info.uv) {
            const iW=1/info.width, iH=1/info.height, aW=info.uv.u1-info.uv.u0, aH=info.uv.v1-info.uv.v0;
            u0=info.uv.u0+(sx*iW)*aW; v0=info.uv.v0+(sy*iH)*aH;
            u1=info.uv.u0+((sx+sw)*iW)*aW; v1=info.uv.v0+((sy+sh)*iH)*aH;
        } else {
            u0=sx/image.width; v0=sy/image.height; u1=(sx+sw)/image.width; v1=(sy+sh)/image.height;
        }
        if (s.shadowBlur>0 && s.shadowColor!=='transparent' && s.shadowColor!=='rgba(0,0,0,0)') {
            const sRGBA=this._parseColor(s.shadowColor), glow=s.shadowBlur*0.5, sA=s.alpha*0.5;
            const sx0=dx-glow,sy0=dy-glow,x1=sx0+dw+glow*2,y1=sy0+dh+glow*2;
            const o=this.batchCount*this.vertexCountPerSprite;
            this.addVertex(o+0, m0*sx0+m2*sy0+m4, m1*sx0+m3*sy0+m5, u0,v0,sA,sRGBA);
            this.addVertex(o+9, m0*x1+m2*sy0+m4,  m1*x1+m3*sy0+m5,  u1,v0,sA,sRGBA);
            this.addVertex(o+18,m0*x1+m2*y1+m4,   m1*x1+m3*y1+m5,   u1,v1,sA,sRGBA);
            this.addVertex(o+27,m0*sx0+m2*y1+m4,  m1*sx0+m3*y1+m5,  u0,v1,sA,sRGBA);
            if (++this.batchCount >= this.maxBatchSize) this.flush();
        }
        const rgba = s.flash > 0 ? [1,1,1,10] : this.WHITE_RGBA;
        const x1=dx+dw, y1=dy+dh, o=this.batchCount*this.vertexCountPerSprite;
        this.addVertex(o+0, m0*dx+m2*dy+m4, m1*dx+m3*dy+m5, u0,v0,s.alpha,rgba);
        this.addVertex(o+9, m0*x1+m2*dy+m4, m1*x1+m3*dy+m5, u1,v0,s.alpha,rgba);
        this.addVertex(o+18,m0*x1+m2*y1+m4, m1*x1+m3*y1+m5, u1,v1,s.alpha,rgba);
        this.addVertex(o+27,m0*dx+m2*y1+m4, m1*dx+m3*y1+m5, u0,v1,s.alpha,rgba);
        this.batchCount++;
    }

    drawTexture(info, x, y, w, h, u0=0, v0=0, u1=1, v1=1, rotation=0, alpha=1.0, flipX=false, flipY=false, tintR=1, tintG=1, tintB=1, flash=0) {
        if (!info) return;
        let texture = info, fU0=u0, fV0=v0, fU1=u1, fV1=v1;
        if (!(info instanceof WebGLTexture) && !info.texture) {
            const ti = this.getTexture(info); texture = ti.texture || ti;
            if (ti.uv) { const uw=ti.uv.u1-ti.uv.u0,vh=ti.uv.v1-ti.uv.v0; fU0=ti.uv.u0+u0*uw; fV0=ti.uv.v0+v0*vh; fU1=ti.uv.u0+u1*uw; fV1=ti.uv.v0+v1*vh; }
        } else if (info.texture) {
            texture = info.texture;
            if (info.uv) { const uw=info.uv.u1-info.uv.u0,vh=info.uv.v1-info.uv.v0; fU0=info.uv.u0+u0*uw; fV0=info.uv.v0+v0*vh; fU1=info.uv.u0+u1*uw; fV1=info.uv.v0+v1*vh; }
        }
        if (this.currentTexture !== texture || this.batchCount >= this.maxBatchSize) {
            if (this.batchCount > 0) this.flush();
            this.currentTexture = (texture instanceof WebGLTexture) ? texture : this.whiteTexture;
        }
        if (flipX) { let t=fU0; fU0=fU1; fU1=t; }
        if (flipY) { let t=fV0; fV0=fV1; fV1=t; }
        const s=this._state, m=s.matrix, m0=m[0],m1=m[1],m2=m[2],m3=m[3],m4=m[4],m5=m[5];
        const fA=alpha*s.alpha, rgba=[tintR,tintG,tintB,flash>0?10:1];
        const o=this.batchCount*this.vertexCountPerSprite;
        if (rotation===0) {
            const x1=x+w,y1=y+h;
            this.addVertex(o+0, m0*x+m2*y+m4,   m1*x+m3*y+m5,   fU0,fV0,fA,rgba);
            this.addVertex(o+9, m0*x1+m2*y+m4,  m1*x1+m3*y+m5,  fU1,fV0,fA,rgba);
            this.addVertex(o+18,m0*x1+m2*y1+m4, m1*x1+m3*y1+m5, fU1,fV1,fA,rgba);
            this.addVertex(o+27,m0*x+m2*y1+m4,  m1*x+m3*y1+m5,  fU0,fV1,fA,rgba);
        } else {
            const cos=Math.cos(rotation),sin=Math.sin(rotation),hw=w/2,hh=h/2,cx=x+hw,cy=y+hh;
            const rx0=-hw*cos+hh*sin+cx, ry0=-hw*sin-hh*cos+cy;
            const rx1= hw*cos+hh*sin+cx, ry1= hw*sin-hh*cos+cy;
            const rx2= hw*cos-hh*sin+cx, ry2= hw*sin+hh*cos+cy;
            const rx3=-hw*cos-hh*sin+cx, ry3=-hw*sin+hh*cos+cy;
            this.addVertex(o+0, m0*rx0+m2*ry0+m4, m1*rx0+m3*ry0+m5, fU0,fV0,fA,rgba);
            this.addVertex(o+9, m0*rx1+m2*ry1+m4, m1*rx1+m3*ry1+m5, fU1,fV0,fA,rgba);
            this.addVertex(o+18,m0*rx2+m2*ry2+m4, m1*rx2+m3*ry2+m5, fU1,fV1,fA,rgba);
            this.addVertex(o+27,m0*rx3+m2*ry3+m4, m1*rx3+m3*ry3+m5, fU0,fV1,fA,rgba);
        }
        this.batchCount++;
    }

    drawSpriteFast(image, x, y, w, h, rotation=0, alpha=1.0, tint=null) {
        if (!image) return;
        const texInfo = this.getTexture(image);
        let texture, uv;
        if (texInfo?.texture) { texture=texInfo.texture; uv=texInfo.uv||{u0:0,v0:0,u1:1,v1:1}; }
        else { texture=(texInfo instanceof WebGLTexture)?texInfo:this.whiteTexture; uv={u0:0,v0:0,u1:1,v1:1}; }
        if (this.currentTexture!==texture || this.batchCount>=this.maxBatchSize) {
            if (this.batchCount>0) this.flush();
            this.currentTexture=(texture instanceof WebGLTexture)?texture:this.whiteTexture;
        }
        const hw=w*0.5, hh=h*0.5, cos=Math.cos(rotation), sin=Math.sin(rotation);
        const lx0=-hw*cos+hh*sin+x, ly0=-hw*sin-hh*cos+y;
        const lx1= hw*cos+hh*sin+x, ly1= hw*sin-hh*cos+y;
        const lx2= hw*cos-hh*sin+x, ly2= hw*sin+hh*cos+y;
        const lx3=-hw*cos-hh*sin+x, ly3=-hw*sin+hh*cos+y;
        const s=this._state, m=s.matrix, m0=m[0],m1=m[1],m2=m[2],m3=m[3],m4=m[4],m5=m[5];
        const r0x=m0*lx0+m2*ly0+m4, r0y=m1*lx0+m3*ly0+m5;
        const r1x=m0*lx1+m2*ly1+m4, r1y=m1*lx1+m3*ly1+m5;
        const r2x=m0*lx2+m2*ly2+m4, r2y=m1*lx2+m3*ly2+m5;
        const r3x=m0*lx3+m2*ly3+m4, r3y=m1*lx3+m3*ly3+m5;
        let rgba = (tint && tint.length>=4 && !tint.isGradient) ? tint : this.WHITE_RGBA;
        const fA=alpha*s.alpha, isFlash=rgba[3]>5, cA=isFlash?1:Math.min(1,rgba[3]), ca=fA*cA, ff=isFlash?2:Math.min(1,ca);
        const o=this.batchCount*this.vertexCountPerSprite, d=this.vertexData;
        d[o+0]=r0x;d[o+1]=r0y;d[o+2]=uv.u0;d[o+3]=uv.v0;d[o+4]=ca;d[o+5]=rgba[0];d[o+6]=rgba[1];d[o+7]=rgba[2];d[o+8]=ff;
        d[o+9]=r1x;d[o+10]=r1y;d[o+11]=uv.u1;d[o+12]=uv.v0;d[o+13]=ca;d[o+14]=rgba[0];d[o+15]=rgba[1];d[o+16]=rgba[2];d[o+17]=ff;
        d[o+18]=r2x;d[o+19]=r2y;d[o+20]=uv.u1;d[o+21]=uv.v1;d[o+22]=ca;d[o+23]=rgba[0];d[o+24]=rgba[1];d[o+25]=rgba[2];d[o+26]=ff;
        d[o+27]=r3x;d[o+28]=r3y;d[o+29]=uv.u0;d[o+30]=uv.v1;d[o+31]=ca;d[o+32]=rgba[0];d[o+33]=rgba[1];d[o+34]=rgba[2];d[o+35]=ff;
        this.batchCount++;
    }

    drawGravityField(x, y, radius, time, colorInner, colorOuter, distortion=0.15) {
        this.flush();
        const gl=this.gl, s=this._state, m=s.matrix;
        gl.useProgram(this.gravityProgram);
        gl.uniform2f(this.gravityLocations.resolution, this.width, this.height);
        gl.uniformMatrix3fv(this.gravityLocations.matrix, false, new Float32Array([m[0],m[1],0,m[2],m[3],0,m[4],m[5],1]));
        gl.uniform1f(this.gravityLocations.time, time);
        gl.uniform4fv(this.gravityLocations.colorInner, colorInner);
        gl.uniform4fv(this.gravityLocations.colorOuter, colorOuter);
        gl.uniform1f(this.gravityLocations.distortion, distortion);
        this._drawEffectQuad(x, y, radius, this.gravityLocations);
        gl.useProgram(this.program);
    }

    drawIceField(x, y, radius, time, alpha, colorInner, colorOuter) {
        this.flush();
        const gl=this.gl, s=this._state, m=s.matrix;
        gl.useProgram(this.iceProgram);
        gl.uniform2f(this.iceLocations.resolution, this.width, this.height);
        gl.uniformMatrix3fv(this.iceLocations.matrix, false, new Float32Array([m[0],m[1],0,m[2],m[3],0,m[4],m[5],1]));
        gl.uniform1f(this.iceLocations.time, time);
        gl.uniform1f(this.iceLocations.alpha, alpha);
        gl.uniform4fv(this.iceLocations.colorInner, colorInner);
        gl.uniform4fv(this.iceLocations.colorOuter, colorOuter);
        this._drawEffectQuad(x, y, radius, this.iceLocations);
        gl.useProgram(this.program);
    }

    _drawEffectQuad(x, y, radius, locs) {
        const gl=this.gl, v=this._effectQuadVerts;
        v[0]=x-radius; v[1]=y-radius;
        v[4]=x+radius; v[5]=y-radius;
        v[8]=x+radius; v[9]=y+radius;
        v[12]=x-radius;v[13]=y+radius;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.effectQuadBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, v);
        gl.enableVertexAttribArray(locs.position);
        gl.vertexAttribPointer(locs.position, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(locs.texCoord);
        gl.vertexAttribPointer(locs.texCoord, 2, gl.FLOAT, false, 16, 8);
        gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    }

    fillText(text, x, y)   { this._drawText(text, x, y, false); }
    strokeText(text, x, y) { this._drawText(text, x, y, true); }

    _drawText(text, x, y, isStroke) {
        const s = this._state;
        if (!isStroke && this.bitmapFont) {
            let allIn = true;
            for (let i=0; i<text.length; i++) { if (!this.bitmapFont.has(text[i])) { allIn=false; break; } }
            if (allIn) { this.drawBitmapText(text, x, y, parseInt(s.font)||20, s.fillStyle, s.alpha, s.textAlign, s.textBaseline); return; }
        }
        const key = `${text}_${s.font}_${s.textAlign}_${s.textBaseline}_${isStroke?s.strokeStyle:s.fillStyle}_${isStroke?s.lineWidth:0}`;
        let info  = this.textCache.get(key);
        if (!info) {
            if (this.textCache.size >= this.maxTextCacheSize) this._cleanupTextCache();
            info = this._createTextTexture(text, s, isStroke);
            this.textCache.set(key, info);
        }
        let ox=0, oy=0;
        if (s.textAlign==='center') ox=-info.width/2; else if (s.textAlign==='right') ox=-info.width;
        if (s.textBaseline==='middle') oy=-info.height/2; else if (s.textBaseline==='bottom') oy=-info.height;
        else if (s.textBaseline==='top') oy=0; else oy=-info.height*0.8;
        this._drawTextureDirect(info.texture, x+ox, y+oy, info.width, info.height);
    }

    drawBitmapText(text, x, y, size, color='#ffffff', alpha=1.0, align='left', baseline='middle') {
        if (!text) return;
        text = text.toString();
        const rgba  = typeof color==='string' ? this._parseColor(color) : (Array.isArray(color)?color:[1,1,1,1]);
        const scale = size / 64;
        let totalW  = 0;
        for (const c of text) { const i=this.bitmapFont.get(c); totalW += i ? i.width*scale : size*0.5; }
        let curX = x;
        if (align==='center') curX-=totalW/2; else if (align==='right') curX-=totalW;
        let bOff = 0;
        if (baseline==='top') bOff=size*0.5; else if (baseline==='bottom') bOff=-size*0.5;
        for (const c of text) {
            const i = this.bitmapFont.get(c);
            if (i) {
                this._drawTextureDirect(i.texture, curX-i.padding*scale, y-(i.renderHeight/2)*scale+bOff, i.renderWidth*scale, i.renderHeight*scale, alpha, rgba, i.u0, i.v0, i.u1, i.v1);
                curX += i.width * scale;
            } else { curX += size * 0.5; }
        }
    }

drawGPUDamageNumber(text, x, y, vx, vy, startTime, duration, size, color, alpha=1.0) {
    if (!text) return;
    text = text.toString();
    const rgba      = typeof color==='string' ? this._parseColor(color) : (Array.isArray(color)?color:[1,1,1,1]);
    const baseScale = size / 64;
    let totalW = 0;
    for (const c of text) { const i=this.bitmapFont.get(c); totalW += i?i.width:32; }
    let curCharX = -totalW / 2;
    for (const c of text) {
        const i = this.bitmapFont.get(c);
        if (!i) { curCharX+=32; continue; }
        if (this.dnCurrentTexture!==i.texture || this.dnBatchCount>=this.dnMaxBatchSize) {
            this.flushDamageNumbers(); this.dnCurrentTexture=i.texture;
        }
        const x0=-i.padding,     y0=-(i.renderHeight/2);
        const x1=x0+i.renderWidth, y1=y0+i.renderHeight;
        const verts = [
            [x0, y0, i.u0, i.v0],
            [x1, y0, i.u1, i.v0],
            [x1, y1, i.u1, i.v1],
            [x0, y1, i.u0, i.v1]
        ];
        const o = this.dnBatchCount * 4 * this.dnVertexStride;
        const d = this.dnVertexData;
        for (let k=0; k<4; k++) {
            const vo = o + k * this.dnVertexStride;
            d[vo]=verts[k][0]; d[vo+1]=verts[k][1]; d[vo+2]=verts[k][2]; d[vo+3]=verts[k][3];
            d[vo+4]=x;         d[vo+5]=y;            d[vo+6]=curCharX;    d[vo+7]=0;
            d[vo+8]=vx;        d[vo+9]=vy;           d[vo+10]=startTime;  d[vo+11]=duration; d[vo+12]=baseScale;
            d[vo+13]=rgba[0];  d[vo+14]=rgba[1];     d[vo+15]=rgba[2];    d[vo+16]=alpha;
        }
        this.dnBatchCount++; curCharX+=i.width;
    }
}

    flushDamageNumbers() {
        if (this.dnBatchCount===0 || !this.dnCurrentTexture) return;
        const gl=this.gl;
        gl.useProgram(this.dnProgram);
        gl.uniform2f(this.dnLocations.resolution, this.width, this.height);
        gl.uniform1f(this.dnLocations.dpr, this.dpr||1);
        gl.uniform1f(this.dnLocations.currentTime, this.currentTime);
        gl.uniform2f(this.dnLocations.cameraPos, this.cameraX, this.cameraY);
        gl.uniform1f(this.dnLocations.gravity, 800.0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.dnCurrentTexture);
        gl.uniform1i(this.dnLocations.image, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.dnVertexBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.dnVertexData.subarray(0, this.dnBatchCount*4*this.dnVertexStride));
        const stride=this.dnVertexStride*4;
        gl.enableVertexAttribArray(this.dnLocations.posOffset);  gl.vertexAttribPointer(this.dnLocations.posOffset, 2,gl.FLOAT,false,stride,0);
        gl.enableVertexAttribArray(this.dnLocations.texCoord);   gl.vertexAttribPointer(this.dnLocations.texCoord,  2,gl.FLOAT,false,stride,8);
        gl.enableVertexAttribArray(this.dnLocations.startPos);   gl.vertexAttribPointer(this.dnLocations.startPos,  2,gl.FLOAT,false,stride,16);
        gl.enableVertexAttribArray(this.dnLocations.charOffset); gl.vertexAttribPointer(this.dnLocations.charOffset,2,gl.FLOAT,false,stride,24);
        gl.enableVertexAttribArray(this.dnLocations.velocity);   gl.vertexAttribPointer(this.dnLocations.velocity,  2,gl.FLOAT,false,stride,32);
        gl.enableVertexAttribArray(this.dnLocations.timeParams); gl.vertexAttribPointer(this.dnLocations.timeParams,3,gl.FLOAT,false,stride,40);
        gl.enableVertexAttribArray(this.dnLocations.color);      gl.vertexAttribPointer(this.dnLocations.color,     3,gl.FLOAT,false,stride,52);
        gl.enableVertexAttribArray(this.dnLocations.alpha);      gl.vertexAttribPointer(this.dnLocations.alpha,     1,gl.FLOAT,false,stride,64);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.dnIndexBuffer);
        gl.drawElements(gl.TRIANGLES, this.dnBatchCount*6, gl.UNSIGNED_SHORT, 0);
        this.drawCallCount++; this.triangleCount+=this.dnBatchCount*2;
        this.dnBatchCount=0;
        gl.useProgram(this.program);
    }

    beginPath()  { this.currentPath = []; }
    closePath()  { this.currentPath.push({ type: 'closePath' }); }
    moveTo(x,y)  { this.currentPath.push({ type:'moveTo', x, y }); }
    lineTo(x,y)  { this.currentPath.push({ type:'lineTo', x, y }); }
    rect(x,y,w,h){ this.currentPath.push({ type:'rect', x, y, w, h }); }
    arc(x,y,r,sa,ea,ac)           { this.currentPath.push({ type:'arc', x, y, r, sa, ea, ac }); }
    arcTo(x1,y1,x2,y2,r)          { this.currentPath.push({ type:'arcTo', x1, y1, x2, y2, r }); }
    ellipse(x,y,rx,ry,rot,sa,ea,ac){ this.currentPath.push({ type:'ellipse', x, y, rx, ry, rot, sa, ea, ac }); }
    quadraticCurveTo(cp1x,cp1y,x,y){ this.currentPath.push({ type:'quadraticCurveTo', cp1x, cp1y, x, y }); }

    fill()   { this._fillOrStroke(false); }
    stroke() { this._fillOrStroke(true); }

    _fillOrStroke(isStroke) {
        const s = this._state;
        const isComplex = this.currentPath.some(c =>
            ['lineTo','moveTo','rect','quadraticCurveTo','arcTo','closePath'].includes(c.type) ||
            (c.type==='arc' && (c.sa!==0 || Math.abs(c.ea-Math.PI*2)>0.01))
        );
        if (isComplex) { this._drawComplexPath(isStroke); return; }
        for (const c of this.currentPath) {
            if (c.type==='arc')     this._drawCircle(c.x, c.y, c.r, isStroke?s.strokeStyle:s.fillStyle, s.alpha, isStroke, s.lineWidth);
            if (c.type==='ellipse') this._drawEllipse(c.x, c.y, c.rx, c.ry, c.rot, isStroke?s.strokeStyle:s.fillStyle, s.alpha);
        }
    }

    _drawComplexPath(isStroke) {
        const s = this._state;
        let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
        for (const c of this.currentPath) {
            if (c.type==='rect') { minX=Math.min(minX,c.x); minY=Math.min(minY,c.y); maxX=Math.max(maxX,c.x+c.w); maxY=Math.max(maxY,c.y+c.h); }
            else if (c.x!==undefined) { const r=c.r||c.rx||c.ry||0; minX=Math.min(minX,c.x-r); minY=Math.min(minY,c.y-r); maxX=Math.max(maxX,c.x+r); maxY=Math.max(maxY,c.y+r); }
        }
        if (minX===Infinity) return;
        const pad=((s.lineWidth||1)+(s.shadowBlur||0)*2+5);
        minX-=pad; minY-=pad; maxX+=pad; maxY+=pad;
        const dpr=this.dpr||1, pW=Math.ceil((maxX-minX)*dpr)+2, pH=Math.ceil((maxY-minY)*dpr)+2;
        if (pW<=0||pH<=0||pW>2048||pH>2048) return;
        if (this.textCanvas.width!==pW||this.textCanvas.height!==pH) { this.textCanvas.width=pW; this.textCanvas.height=pH; }
        const ctx=this.textCtx;
        ctx.clearRect(0,0,pW,pH); ctx.save(); ctx.scale(dpr,dpr); ctx.translate(-Math.floor(minX),-Math.floor(minY));
        const _buildGrad = (g, ctx) => {
            const grad = g.type==='radial'
                ? ctx.createRadialGradient(g.x0-Math.floor(minX), g.y0-Math.floor(minY), g.r0, g.x1-Math.floor(minX), g.y1-Math.floor(minY), g.r1)
                : ctx.createLinearGradient(g.x0-Math.floor(minX), g.y0-Math.floor(minY), g.x1-Math.floor(minX), g.y1-Math.floor(minY));
            g.stops.forEach(st => grad.addColorStop(st.offset, st.color));
            return grad;
        };
        ctx.fillStyle   = s.fillStyle?.isGradient   ? _buildGrad(s.fillStyle, ctx)   : (s.fillStyle   || 'white');
        ctx.strokeStyle = s.strokeStyle?.isGradient ? _buildGrad(s.strokeStyle, ctx) : (s.strokeStyle || 'white');
        ctx.lineWidth=s.lineWidth; ctx.lineCap='round'; ctx.lineJoin='round';
        ctx.shadowBlur=s.shadowBlur; ctx.shadowColor=s.shadowColor;
        ctx.globalCompositeOperation=s.globalCompositeOperation||'source-over';
        ctx.beginPath();
        for (const c of this.currentPath) {
            if (c.type==='moveTo')             ctx.moveTo(c.x,c.y);
            else if (c.type==='lineTo')        ctx.lineTo(c.x,c.y);
            else if (c.type==='rect')          ctx.rect(c.x,c.y,c.w,c.h);
            else if (c.type==='quadraticCurveTo') ctx.quadraticCurveTo(c.cp1x,c.cp1y,c.x,c.y);
            else if (c.type==='arc')           ctx.arc(c.x,c.y,c.r,c.sa,c.ea,c.ac);
            else if (c.type==='ellipse')       ctx.ellipse(c.x,c.y,c.rx,c.ry,c.rot,c.sa,c.ea,c.ac);
            else if (c.type==='closePath')     ctx.closePath();
        }
        if (isStroke) ctx.stroke(); else ctx.fill();
        ctx.restore();
        const gl=this.gl, tex=gl.createTexture();
        try {
            gl.bindTexture(gl.TEXTURE_2D,tex);
            gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.textCanvas);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
            this._drawTextureDirect(tex, Math.floor(minX), Math.floor(minY), pW/dpr, pH/dpr, s.alpha);
            this.flush();
        } finally { gl.deleteTexture(tex); }
    }

    _drawRect(x, y, w, h, rgba, alpha) {
        if (this.currentTexture!==this.whiteTexture || this.batchCount>=this.maxBatchSize) { this.flush(); this.currentTexture=this.whiteTexture; }
        const m=this._state.matrix, x1=x+w, y1=y+h, o=this.batchCount*this.verticesPerSprite*this.vertexStride;
        this.addVertex(o+0,  m[0]*x+m[2]*y+m[4],   m[1]*x+m[3]*y+m[5],   0,0,alpha,rgba);
        this.addVertex(o+9,  m[0]*x1+m[2]*y+m[4],  m[1]*x1+m[3]*y+m[5],  1,0,alpha,rgba);
        this.addVertex(o+18, m[0]*x1+m[2]*y1+m[4], m[1]*x1+m[3]*y1+m[5], 1,1,alpha,rgba);
        this.addVertex(o+27, m[0]*x+m[2]*y1+m[4],  m[1]*x+m[3]*y1+m[5],  0,1,alpha,rgba);
        this.batchCount++;
    }

    _drawTextureDirect(texOrInfo, x, y, w, h, alphaOverride=null, rgbaOverride=null, u0=0, v0=0, u1=1, v1=1) {
        let tex=texOrInfo, fU0=u0, fV0=v0, fU1=u1, fV1=v1;
        if (texOrInfo && !(texOrInfo instanceof WebGLTexture) && !texOrInfo.texture) {
            const i=this.getTexture(texOrInfo); tex=i.texture||i;
            if (i.uv) { const uw=i.uv.u1-i.uv.u0,vh=i.uv.v1-i.uv.v0; fU0=i.uv.u0+u0*uw; fV0=i.uv.v0+v0*vh; fU1=i.uv.u0+u1*uw; fV1=i.uv.v0+v1*vh; }
        } else if (texOrInfo?.texture && !(texOrInfo instanceof WebGLTexture)) {
            tex=texOrInfo.texture;
            if (texOrInfo.uv) { const uw=texOrInfo.uv.u1-texOrInfo.uv.u0,vh=texOrInfo.uv.v1-texOrInfo.uv.v0; fU0=texOrInfo.uv.u0+u0*uw; fV0=texOrInfo.uv.v0+v0*vh; fU1=texOrInfo.uv.u0+u1*uw; fV1=texOrInfo.uv.v0+v1*vh; }
        }
        if (this.currentTexture!==tex || this.batchCount>=this.maxBatchSize) { if (this.batchCount>0) this.flush(); this.currentTexture=(tex instanceof WebGLTexture)?tex:this.whiteTexture; }
        const s=this._state, m=s.matrix, m0=m[0],m1=m[1],m2=m[2],m3=m[3],m4=m[4],m5=m[5];
        const alpha=alphaOverride!==null?alphaOverride:s.alpha;
        let rgba=rgbaOverride!==null?rgbaOverride:this.WHITE_RGBA;
        if (rgba?.isGradient || !rgba?.length || rgba.length<4) rgba=this.WHITE_RGBA;
        const x1=x+w, y1=y+h, o=this.batchCount*this.vertexCountPerSprite;
        this.addVertex(o+0,  m0*x+m2*y+m4,   m1*x+m3*y+m5,   fU0,fV0,alpha,rgba);
        this.addVertex(o+9,  m0*x1+m2*y+m4,  m1*x1+m3*y+m5,  fU1,fV0,alpha,rgba);
        this.addVertex(o+18, m0*x1+m2*y1+m4, m1*x1+m3*y1+m5, fU1,fV1,alpha,rgba);
        this.addVertex(o+27, m0*x+m2*y1+m4,  m1*x+m3*y1+m5,  fU0,fV1,alpha,rgba);
        this.batchCount++;
    }

    _drawCircle(x, y, radius, colorOrGrad, alpha, isStroke=false, lineWidth=1) {
        if (colorOrGrad?.isGradient && colorOrGrad.type==='radial') { this._drawRadialGradientEllipse(x,y,radius,radius,0,colorOrGrad,alpha); return; }
        const rgba=typeof colorOrGrad==='string'?this._parseColor(colorOrGrad):(Array.isArray(colorOrGrad)?colorOrGrad:[1,1,1,1]);
        const segs=Math.max(32,Math.min(128,Math.floor(radius/6)));
        const s=this._state, m=s.matrix;
        if (!isStroke && s.shadowBlur>0 && s.shadowColor!=='transparent' && rgba[3]>0.05 && alpha>0.01) {
            const sRGBA=this._parseColor(s.shadowColor), ob=s.shadowBlur;
            s.shadowBlur=0; this._drawCircle(x,y,radius+ob*0.4,sRGBA,alpha*rgba[3]*0.3,false); s.shadowBlur=ob;
        }
        if (this.currentTexture!==this.whiteTexture || this.batchCount+segs>=this.maxBatchSize) { if (this.batchCount>0) this.flush(); this.currentTexture=this.whiteTexture; }
        for (let i=0; i<segs; i++) {
            const a1=(i/segs)*Math.PI*2, a2=((i+1)/segs)*Math.PI*2;
            const x1=x+Math.cos(a1)*radius, y1=y+Math.sin(a1)*radius;
            const x2=x+Math.cos(a2)*radius, y2=y+Math.sin(a2)*radius;
            if (isStroke) this._drawLine(x1,y1,x2,y2,lineWidth,rgba,alpha,m);
            else          this._addTriangle(x,y,x1,y1,x2,y2,m,alpha,rgba);
        }
    }

    _drawEllipse(x, y, rx, ry, rot, colorOrGrad, alpha) {
        if (colorOrGrad?.isGradient && colorOrGrad.type==='radial') { this._drawRadialGradientEllipse(x,y,rx,ry,rot,colorOrGrad,alpha); return; }
        const rgba=typeof colorOrGrad==='string'?this._parseColor(colorOrGrad):(Array.isArray(colorOrGrad)?colorOrGrad:[1,1,1,1]);
        const segs=32, s=this._state, m=s.matrix, cosR=Math.cos(rot), sinR=Math.sin(rot);
        if (this.currentTexture!==this.whiteTexture || this.batchCount+segs>=this.maxBatchSize) { if (this.batchCount>0) this.flush(); this.currentTexture=this.whiteTexture; }
        for (let i=0; i<segs; i++) {
            const a1=(i/segs)*Math.PI*2, a2=((i+1)/segs)*Math.PI*2;
            const px1=Math.cos(a1)*rx, py1=Math.sin(a1)*ry, px2=Math.cos(a2)*rx, py2=Math.sin(a2)*ry;
            this._addTriangle(x, y, x+px1*cosR-py1*sinR, y+px1*sinR+py1*cosR, x+px2*cosR-py2*sinR, y+px2*sinR+py2*cosR, m, alpha, rgba);
        }
    }

    _drawRadialGradientEllipse(x, y, rx, ry, rot, gradient, alpha) {
        let key=''; for (const s of gradient.stops) key+=s.offset+s.color;
        let tex=this.gradientCache.get(key);
        if (!tex) {
            const sz=128, c=document.createElement('canvas'); c.width=c.height=sz;
            const ctx=c.getContext('2d'), g=ctx.createRadialGradient(sz/2,sz/2,0,sz/2,sz/2,sz/2);
            gradient.stops.forEach(s=>g.addColorStop(s.offset,s.color));
            ctx.fillStyle=g; ctx.beginPath(); ctx.arc(sz/2,sz/2,sz/2,0,Math.PI*2); ctx.fill();
            tex=this.gl.createTexture(); const gl=this.gl;
            gl.bindTexture(gl.TEXTURE_2D,tex);
            gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
            this.gradientCache.set(key,tex);
        }
        this.save(); this.translate(x,y); this.rotate(rot);
        this._drawTextureDirect(tex,-rx,-ry,rx*2,ry*2,alpha);
        this.restore();
    }

    _drawLine(x1, y1, x2, y2, width, rgba, alpha, m) {
        if (this.currentTexture!==this.whiteTexture || this.batchCount>=this.maxBatchSize) { if (this.batchCount>0) this.flush(); this.currentTexture=this.whiteTexture; }
        const dx=x2-x1, dy=y2-y1, len=Math.sqrt(dx*dx+dy*dy);
        if (len<=0) return;
        const nx=-dy/len*(width/2), ny=dx/len*(width/2);
        const o=this.batchCount*this.vertexCountPerSprite, m0=m[0],m1=m[1],m2=m[2],m3=m[3],m4=m[4],m5=m[5];
        this.addVertex(o+0,  m0*(x1+nx)+m2*(y1+ny)+m4, m1*(x1+nx)+m3*(y1+ny)+m5, 0,0,alpha,rgba);
        this.addVertex(o+9,  m0*(x2+nx)+m2*(y2+ny)+m4, m1*(x2+nx)+m3*(y2+ny)+m5, 1,0,alpha,rgba);
        this.addVertex(o+18, m0*(x2-nx)+m2*(y2-ny)+m4, m1*(x2-nx)+m3*(y2-ny)+m5, 1,1,alpha,rgba);
        this.addVertex(o+27, m0*(x1-nx)+m2*(y1-ny)+m4, m1*(x1-nx)+m3*(y1-ny)+m5, 0,1,alpha,rgba);
        this.batchCount++;
    }

    _addTriangle(x0, y0, x1, y1, x2, y2, m, alpha, rgba) {
        const o=this.batchCount*this.verticesPerSprite*this.vertexStride, m0=m[0],m1=m[1],m2=m[2],m3=m[3],m4=m[4],m5=m[5];
        this.addVertex(o+0,  m0*x0+m2*y0+m4, m1*x0+m3*y0+m5, 0,0,alpha,rgba);
        this.addVertex(o+9,  m0*x1+m2*y1+m4, m1*x1+m3*y1+m5, 1,0,alpha,rgba);
        this.addVertex(o+18, m0*x2+m2*y2+m4, m1*x2+m3*y2+m5, 1,1,alpha,rgba);
        this.addVertex(o+27, m0*x2+m2*y2+m4, m1*x2+m3*y2+m5, 1,1,alpha,rgba);
        this.batchCount++;
    }

    addVertex(offset, x, y, u, v, a, rgba) {
        const d=this.vertexData, r=rgba[0],g=rgba[1],b=rgba[2],r3=rgba[3];
        const isFlash=r3>5, cA=isFlash?1:(r3>1?1:r3), ca=a*cA;
        d[offset]=x; d[offset+1]=y; d[offset+2]=u; d[offset+3]=v; d[offset+4]=ca;
        d[offset+5]=r; d[offset+6]=g; d[offset+7]=b; d[offset+8]=isFlash?2:(ca>1?1:ca);
    }

    flush() {
        if (this.batchCount===0) return;
        const gl=this.gl;
        gl.useProgram(this.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertexData.subarray(0, this.batchCount*this.vertexCountPerSprite));
        gl.uniform2f(this.locations.resolution, this.width, this.height);
        gl.activeTexture(gl.TEXTURE0);
        const tex=this.currentTexture||this.whiteTexture;
        gl.bindTexture(gl.TEXTURE_2D, (tex instanceof WebGLTexture)?tex:this.whiteTexture);
        gl.uniform1i(this.locations.image, 0);
        const stride=this.vertexStride*4;
        gl.enableVertexAttribArray(this.locations.position); gl.vertexAttribPointer(this.locations.position,2,gl.FLOAT,false,stride,0);
        gl.enableVertexAttribArray(this.locations.texCoord); gl.vertexAttribPointer(this.locations.texCoord,2,gl.FLOAT,false,stride,8);
        gl.enableVertexAttribArray(this.locations.alpha);    gl.vertexAttribPointer(this.locations.alpha,   1,gl.FLOAT,false,stride,16);
        gl.enableVertexAttribArray(this.locations.color);    gl.vertexAttribPointer(this.locations.color,   4,gl.FLOAT,false,stride,20);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.drawElements(gl.TRIANGLES, this.batchCount*this.indicesPerSprite, gl.UNSIGNED_SHORT, 0);
        this.drawCallCount++; this.triangleCount+=this.batchCount*2;
        this.batchCount=0; this.currentTexture=null;
    }

    getTexture(image) {
        if (!image) return this.whiteTexture;
        if (image._glTextureInfo && !image._needsUpdate) return image._glTextureInfo;
        if (image.__isGLTexture || image instanceof WebGLTexture) { image.__isGLTexture=true; return image; }
        let uv=this.atlasCache.get(image);
        if (uv) {
            if (image._needsUpdate) { this._updateInAtlas(image); image._needsUpdate=false; }
            const info={texture:this.atlasTexture, uv, width:image.width, height:image.height};
            image._glTextureInfo=info; return info;
        }
        const iW=image.width, iH=image.height;
        if (iW>0 && iH>0 && iW<=512 && iH<=512 && !image.disableAutoAtlas) {
            uv=this._addToAtlas(image);
            if (uv) { const info={texture:this.atlasTexture,uv,width:iW,height:iH}; image._glTextureInfo=info; return info; }
        }
        let tex=this.textureCache.get(image);
        if (!tex) {
            if (this.textureCache.size>=this.maxTextureCacheSize) this._cleanupTextures();
            const gl=this.gl; tex=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,tex);
            try { gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image); } catch(e) { return this.whiteTexture; }
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
            gl.generateMipmap(gl.TEXTURE_2D);
            this.textureCache.set(image,tex);
        } else if (image._needsUpdate) {
            const gl=this.gl; gl.bindTexture(gl.TEXTURE_2D,tex);
            gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
            gl.generateMipmap(gl.TEXTURE_2D); image._needsUpdate=false;
        }
        this.textureUsage.set(image, Date.now());
        const info={texture:tex,width:iW,height:iH}; image._glTextureInfo=info; return info;
    }

    _addToAtlas(image) {
        if (!image||image.width<=0||image.height<=0) return null;
        const w=image.width+this.atlasPadding*2, h=image.height+this.atlasPadding*2;
        if (this.atlasX+w>this.atlasSize) { this.atlasX=0; this.atlasY+=this.atlasRowHeight; this.atlasRowHeight=0; }
        if (this.atlasY+h>this.atlasSize) return null;
        const x=this.atlasX+this.atlasPadding, y=this.atlasY+this.atlasPadding, gl=this.gl;
        gl.bindTexture(gl.TEXTURE_2D,this.atlasTexture);
        try { gl.texSubImage2D(gl.TEXTURE_2D,0,x,y,gl.RGBA,gl.UNSIGNED_BYTE,image); } catch(e) { return null; }
        const uv={u0:x/this.atlasSize, v0:y/this.atlasSize, u1:(x+image.width)/this.atlasSize, v1:(y+image.height)/this.atlasSize};
        this.atlasCache.set(image,uv); this.atlasX+=w; this.atlasRowHeight=Math.max(this.atlasRowHeight,h);
        return uv;
    }

    _updateInAtlas(image) {
        const uv=this.atlasCache.get(image); if (!uv) return;
        const gl=this.gl, x=Math.round(uv.u0*this.atlasSize), y=Math.round(uv.v0*this.atlasSize);
        gl.bindTexture(gl.TEXTURE_2D,this.atlasTexture);
        try { gl.texSubImage2D(gl.TEXTURE_2D,0,x,y,gl.RGBA,gl.UNSIGNED_BYTE,image); } catch(e) {}
    }

    _cleanupTextures() {
        const gl=this.gl;
        const sorted=Array.from(this.textureUsage.entries()).sort((a,b)=>a[1]-b[1]);
        const n=Math.ceil(this.maxTextureCacheSize*0.2);
        for (let i=0; i<n&&i<sorted.length; i++) {
            const img=sorted[i][0], tex=this.textureCache.get(img);
            if (tex&&tex!==this.whiteTexture) { gl.deleteTexture(tex); this.textureCache.delete(img); this.textureUsage.delete(img); }
        }
    }

    _cleanupTextCache() {
        const gl=this.gl;
        for (const info of this.textCache.values()) gl.deleteTexture(info.texture);
        this.textCache.clear();
    }

    _createTextTexture(text, state, isStroke) {
        this.textCtx.font=state.font;
        const w=Math.ceil(this.textCtx.measureText(text).width)+4, fs=parseInt(state.font)||20, h=Math.ceil(fs*1.4)+4;
        this.textCanvas.width=w; this.textCanvas.height=h;
        this.textCtx.font=state.font; this.textCtx.textAlign='left'; this.textCtx.textBaseline='top';
        if (isStroke) { this.textCtx.strokeStyle=state.strokeStyle; this.textCtx.lineWidth=state.lineWidth; this.textCtx.strokeText(text,2,2); }
        else          { this.textCtx.fillStyle=state.fillStyle; this.textCtx.fillText(text,2,2); }
        const gl=this.gl, tex=gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D,tex);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.textCanvas);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D,null);
        return { texture:tex, width:w, height:h };
    }

    _parseColor(color) {
        if (!color) return this.WHITE_RGBA;
        if (typeof color!=='string') return (Array.isArray(color)||color instanceof Float32Array)?color:this.WHITE_RGBA;
        const cached=this.colorCache.get(color); if (cached) return cached;
        let result;
        const n=color.toLowerCase().trim();
        if (n==='white'||n==='#fff'||n==='#ffffff')          result=this.WHITE_RGBA;
        else if (n==='black'||n==='#000'||n==='#000000')     result=new Float32Array([0,0,0,1]);
        else if (n==='transparent'||n==='rgba(0,0,0,0)')     result=new Float32Array([0,0,0,0]);
        else if (n.startsWith('#')) {
            const h=n.slice(1);
            result = h.length===3
                ? new Float32Array([parseInt(h[0]+h[0],16)/255, parseInt(h[1]+h[1],16)/255, parseInt(h[2]+h[2],16)/255, 1])
                : new Float32Array([parseInt(h.slice(0,2),16)/255, parseInt(h.slice(2,4),16)/255, parseInt(h.slice(4,6),16)/255, 1]);
        } else if (n.startsWith('rgb')) {
            const s=n.indexOf('(')+1, e=n.indexOf(')');
            if (s>0&&e>s) {
                const p=n.substring(s,e).split(',');
                const a=p[3]?parseFloat(p[3]):1;
                result=new Float32Array([(parseInt(p[0])||0)/255,(parseInt(p[1])||0)/255,(parseInt(p[2])||0)/255,isNaN(a)?1:a]);
            }
        }
        if (!result) result=this.WHITE_RGBA;
        if (this.colorCache.size<1000) this.colorCache.set(color,result);
        return result;
    }

    createLinearGradient(x0, y0, x1, y1) {
        return { isGradient:true, type:'linear', x0, y0, x1, y1, stops:[], addColorStop(o,c){this.stops.push({offset:o,color:c});} };
    }
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
        return { isGradient:true, type:'radial', x0, y0, r0, x1, y1, r1, stops:[], addColorStop(o,c){this.stops.push({offset:o,color:c});} };
    }}

