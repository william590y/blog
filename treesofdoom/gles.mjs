/**
 * GLES 2 bridge for an ARM Android shared library running under Unicorn.
 * Every drawing operation is forwarded to a real browser WebGL context.
 * The original library remains responsible for shaders, assets, and gameplay.
 */
const GL = {
  ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893,
  STREAM_DRAW: 0x88e0, STATIC_DRAW: 0x88e4, DYNAMIC_DRAW: 0x88e8,
  FLOAT: 0x1406, FIXED: 0x140c, HALF_FLOAT_OES: 0x8d61,
  UNSIGNED_BYTE: 0x1401, UNSIGNED_SHORT: 0x1403, UNSIGNED_INT: 0x1405,
  INVALID_ENUM: 0x0500, INVALID_VALUE: 0x0501, INVALID_OPERATION: 0x0502,
  OUT_OF_MEMORY: 0x0505, UNPACK_ALIGNMENT: 0x0cf5, PACK_ALIGNMENT: 0x0d05,
};

/** Install the game library's GL imports. No GL context is created implicitly. */
export function installGLES(rt, gl, options = {}) {
  if (gl && typeof gl.getContext === 'function') {
    gl = gl.getContext('webgl', { alpha: false, antialias: false, depth: true, stencil: true }) ||
      gl.getContext('experimental-webgl', { alpha: false, antialias: false, depth: true, stencil: true });
  }
  if (!gl || typeof gl.drawElements !== 'function' || typeof gl.createShader !== 'function') {
    throw new Error('installGLES requires a real WebGL rendering context');
  }
  const textDecoder = new TextDecoder();
  const textEncoder = new TextEncoder();
  const stats = { calls: 0, draws: 0, triangles: 0, textureUploads: 0, shaders: [], frames: 0, errors: [] };
  const imported = new Set();
  const resources = new Map();
  const reverseResources = new WeakMap();
  const bufferStates = new Map();
  const shaderSources = new Map();
  const attributes = new Map();
  const uniforms = new Map();
  const uniformIds = new WeakMap();
  const strings = new Map();
  const errors = [];
  let nextId = 1;
  let nextUniformId = 1;
  let arrayBuffer = 0;
  let elementBuffer = 0;
  let unpackAlignment = 4;
  let packAlignment = 4;
  let clientElementBuffer = null;
  const maxMemoryRead = options.maxMemoryRead || 256 * 1024 * 1024;
  const extensions = {};
  for (const name of [
    'OES_element_index_uint', 'OES_texture_float', 'OES_texture_half_float',
    'OES_texture_float_linear', 'OES_texture_half_float_linear', 'OES_standard_derivatives',
    'WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_pvrtc',
    'WEBKIT_WEBGL_compressed_texture_pvrtc', 'WEBGL_compressed_texture_etc',
    'WEBGL_compressed_texture_etc1', 'WEBGL_compressed_texture_astc',
    'EXT_texture_filter_anisotropic', 'WEBKIT_EXT_texture_filter_anisotropic',
    'EXT_blend_minmax', 'WEBGL_depth_texture',
  ]) {
    const extension = gl.getExtension(name);
    if (extension) extensions[name] = extension;
  }

  function error(code) { if (!errors.includes(code)) errors.push(code); }
  function readBytes(ptr, len) {
    if (!Number.isSafeInteger(len) || len < 0 || len > maxMemoryRead) {
      throw new Error(`Invalid GLES memory read: ${len} bytes at 0x${ptr.toString(16)}`);
    }
    if (len === 0) return new Uint8Array(0);
    const bytes = rt.readBytes(ptr >>> 0, len);
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  }
  function copyBytes(ptr, len) { return readBytes(ptr, len).slice(); }
  function typed(ptr, count, Type) {
    const bytes = copyBytes(ptr, count * Type.BYTES_PER_ELEMENT);
    return new Type(bytes.buffer, bytes.byteOffset, count);
  }
  function writeI32(ptr, value) { if (ptr) rt.writeU32(ptr >>> 0, Number(value) >>> 0); }
  function writeF32(ptr, value) {
    const buf = new ArrayBuffer(4); new DataView(buf).setFloat32(0, Number(value), true);
    rt.writeBytes(ptr >>> 0, new Uint8Array(buf));
  }
  function writeString(ptr, max, string, lengthPtr = 0) {
    const bytes = textEncoder.encode(string || '');
    const length = Math.min(bytes.length, Math.max(0, max - 1));
    if (ptr && max > 0) {
      rt.writeBytes(ptr, bytes.subarray(0, length));
      rt.writeBytes((ptr + length) >>> 0, new Uint8Array([0]));
    }
    writeI32(lengthPtr, length);
  }
  function intern(string) {
    if (!strings.has(string)) {
      const bytes = textEncoder.encode(string + '\0');
      const ptr = rt.alloc(bytes.length); rt.writeBytes(ptr, bytes); strings.set(string, ptr);
    }
    return strings.get(string);
  }
  function addResource(kind, value, id = nextId++) {
    if (!value) return 0;
    nextId = Math.max(nextId, id + 1);
    resources.set(id, { kind, value }); reverseResources.set(value, id);
    return id;
  }
  function getResource(id, kind) {
    if (!id) return null;
    const r = resources.get(id);
    if (!r || r.kind !== kind) { error(GL.INVALID_OPERATION); return null; }
    return r.value;
  }
  function bindable(id, kind, create) {
    if (!id) return null;
    if (!resources.has(id)) addResource(kind, gl[create](), id);
    return getResource(id, kind);
  }
  function reg(name, fn) {
    imported.add(name);
    rt.registerImport(name, ctx => {
      stats.calls++;
      const result = fn(ctx);
      return typeof result === 'number' ? result : typeof result === 'boolean' ? Number(result) : 0;
    });
  }
  function gen(kind, create, count, ptr) {
    if (count < 0) { error(GL.INVALID_VALUE); return; }
    for (let i = 0; i < count; i++) writeI32(ptr + i * 4, addResource(kind, gl[create]()));
  }
  function del(kind, method, count, ptr) {
    for (let i = 0; i < count; i++) {
      const id = rt.readU32(ptr + i * 4); const r = resources.get(id);
      if (!r || r.kind !== kind) continue;
      gl[method](r.value); resources.delete(id); bufferStates.delete(id); shaderSources.delete(id);
      if (kind === 'buffer') {
        if (arrayBuffer === id) arrayBuffer = 0;
        if (elementBuffer === id) elementBuffer = 0;
      }
    }
  }
  function simple(name, method, signature) {
    reg(name, ctx => gl[method](...Array.from(signature, (type, i) =>
      type === 'f' ? ctx.argF32(i) : type === 'i' ? ctx.argI32(i) : type === 'b' ? !!ctx.argU32(i) : ctx.argU32(i))));
  }
  for (const [name, method, signature] of [
    ['glClear', 'clear', 'u'], ['glViewport', 'viewport', 'iiii'],
    ['glScissor', 'scissor', 'iiii'], ['glClearColor', 'clearColor', 'ffff'],
    ['glClearDepthf', 'clearDepth', 'f'], ['glClearStencil', 'clearStencil', 'i'],
    ['glDepthFunc', 'depthFunc', 'u'], ['glDepthMask', 'depthMask', 'b'],
    ['glDepthRangef', 'depthRange', 'ff'], ['glBlendFunc', 'blendFunc', 'uu'],
    ['glBlendFuncSeparate', 'blendFuncSeparate', 'uuuu'],
    ['glBlendEquation', 'blendEquation', 'u'], ['glBlendEquationSeparate', 'blendEquationSeparate', 'uu'],
    ['glBlendColor', 'blendColor', 'ffff'], ['glEnable', 'enable', 'u'], ['glDisable', 'disable', 'u'],
    ['glFrontFace', 'frontFace', 'u'], ['glCullFace', 'cullFace', 'u'],
    ['glColorMask', 'colorMask', 'bbbb'], ['glStencilMask', 'stencilMask', 'u'],
    ['glStencilFunc', 'stencilFunc', 'uiu'], ['glStencilOp', 'stencilOp', 'uuu'],
    ['glStencilMaskSeparate', 'stencilMaskSeparate', 'uu'],
    ['glStencilFuncSeparate', 'stencilFuncSeparate', 'uuiu'],
    ['glStencilOpSeparate', 'stencilOpSeparate', 'uuuu'],
    ['glActiveTexture', 'activeTexture', 'u'], ['glTexParameteri', 'texParameteri', 'uui'],
    ['glTexParameterf', 'texParameterf', 'uuf'], ['glGenerateMipmap', 'generateMipmap', 'u'],
    ['glCopyTexImage2D', 'copyTexImage2D', 'uiuiiiii'],
    ['glCopyTexSubImage2D', 'copyTexSubImage2D', 'uiiiiiii'],
    ['glRenderbufferStorage', 'renderbufferStorage', 'uuii'],
    ['glCheckFramebufferStatus', 'checkFramebufferStatus', 'u'],
    ['glPolygonOffset', 'polygonOffset', 'ff'], ['glLineWidth', 'lineWidth', 'f'],
    ['glHint', 'hint', 'uu'], ['glSampleCoverage', 'sampleCoverage', 'fb'],
    ['glFlush', 'flush', ''], ['glFinish', 'finish', ''], ['glIsEnabled', 'isEnabled', 'u'],
  ]) simple(name, method, signature);
  reg('glGetError', () => {
    const code = errors.length ? errors.shift() : gl.getError();
    if (code) {
      stats.errors.push(code);
      options.onDiagnostic?.({ kind: 'gl-error', code: `0x${code.toString(16)}` });
    }
    return code;
  });
  reg('glPixelStorei', c => {
    const pname = c.argU32(0), value = c.argI32(1);
    if ((pname === GL.UNPACK_ALIGNMENT || pname === GL.PACK_ALIGNMENT) && ![1, 2, 4, 8].includes(value)) {
      error(GL.INVALID_VALUE); return;
    }
    if (pname === GL.UNPACK_ALIGNMENT) unpackAlignment = value;
    if (pname === GL.PACK_ALIGNMENT) packAlignment = value;
    gl.pixelStorei(pname, value);
  });

  function parameter(pname) {
    switch (pname) {
      case 0x8df9: return 0; // NUM_SHADER_BINARY_FORMATS: no shader binary formats supported.
      case 0x8df8: return []; // SHADER_BINARY_FORMATS
      case 0x8dfa: return 1; // SHADER_COMPILER
      case 0x86a2: return (gl.getParameter(0x86a3) || []).length;
      case 0x8894: return arrayBuffer;
      case 0x8895: return elementBuffer;
      default: {
        const value = gl.getParameter(pname);
        if (value && typeof value === 'object' && reverseResources.has(value)) return reverseResources.get(value);
        return value;
      }
    }
  }
  for (const [name, write] of [['glGetIntegerv', writeI32], ['glGetFloatv', writeF32]]) {
    reg(name, c => {
      const value = parameter(c.argU32(0)), ptr = c.argU32(1);
      const values = value && typeof value !== 'string' && typeof value.length === 'number' ? value : [value ?? 0];
      for (let i = 0; i < values.length; i++) write(ptr + i * 4, values[i]);
    });
  }
  reg('glGetBooleanv', c => {
    const value = parameter(c.argU32(0));
    const values = value && typeof value.length === 'number' ? value : [value];
    rt.writeBytes(c.argU32(1), Uint8Array.from(values, v => v ? 1 : 0));
  });
  reg('glGetString', c => {
    const pname = c.argU32(0);
    if (pname === 0x1f02) return intern('OpenGL ES 2.0 (WebGL 1.0 ARM bridge)');
    if (pname === 0x8b8c) return intern('OpenGL ES GLSL ES 1.00 (WebGL)');
    if (pname === 0x1f03) {
      const names = ['GL_OES_mapbuffer'];
      for (const ext of Object.keys(extensions)) {
        if (ext.startsWith('OES_') || ext.startsWith('EXT_')) names.push('GL_' + ext);
        if (ext.includes('compressed_texture_pvrtc')) names.push('GL_IMG_texture_compression_pvrtc');
        if (ext === 'WEBGL_compressed_texture_etc1') names.push('GL_OES_compressed_ETC1_RGB8_texture');
        if (ext === 'WEBGL_compressed_texture_s3tc') names.push('GL_EXT_texture_compression_s3tc');
      }
      return intern([...new Set(names)].join(' '));
    }
    if (pname === 0x1f00 || pname === 0x1f01) return intern(String(gl.getParameter(pname)));
    error(GL.INVALID_ENUM); return 0;
  });

  for (const [kind, plural, create, remove] of [
    ['buffer', 'Buffers', 'createBuffer', 'deleteBuffer'], ['texture', 'Textures', 'createTexture', 'deleteTexture'],
    ['framebuffer', 'Framebuffers', 'createFramebuffer', 'deleteFramebuffer'],
    ['renderbuffer', 'Renderbuffers', 'createRenderbuffer', 'deleteRenderbuffer'],
  ]) {
    reg('glGen' + plural, c => gen(kind, create, c.argI32(0), c.argU32(1)));
    reg('glDelete' + plural, c => del(kind, remove, c.argI32(0), c.argU32(1)));
  }
  reg('glBindTexture', c => gl.bindTexture(c.argU32(0), bindable(c.argU32(1), 'texture', 'createTexture')));
  reg('glBindFramebuffer', c => gl.bindFramebuffer(c.argU32(0), bindable(c.argU32(1), 'framebuffer', 'createFramebuffer')));
  reg('glBindRenderbuffer', c => gl.bindRenderbuffer(c.argU32(0), bindable(c.argU32(1), 'renderbuffer', 'createRenderbuffer')));
  reg('glFramebufferTexture2D', c => gl.framebufferTexture2D(c.argU32(0), c.argU32(1), c.argU32(2), getResource(c.argU32(3), 'texture'), c.argI32(4)));
  reg('glFramebufferRenderbuffer', c => gl.framebufferRenderbuffer(c.argU32(0), c.argU32(1), c.argU32(2), getResource(c.argU32(3), 'renderbuffer')));
  reg('glBindBuffer', c => {
    const target = c.argU32(0), id = c.argU32(1);
    if (target !== GL.ARRAY_BUFFER && target !== GL.ELEMENT_ARRAY_BUFFER) { error(GL.INVALID_ENUM); return; }
    gl.bindBuffer(target, bindable(id, 'buffer', 'createBuffer'));
    if (target === GL.ARRAY_BUFFER) arrayBuffer = id; else elementBuffer = id;
    if (id && !bufferStates.has(id)) bufferStates.set(id, { bytes: new Uint8Array(0), usage: GL.STATIC_DRAW, mapped: 0 });
  });
  function boundBuffer(target) {
    const id = target === GL.ARRAY_BUFFER ? arrayBuffer : target === GL.ELEMENT_ARRAY_BUFFER ? elementBuffer : 0;
    if (!id) { error(GL.INVALID_OPERATION); return null; }
    return bufferStates.get(id);
  }
  reg('glBufferData', c => {
    const target = c.argU32(0), size = c.argI32(1), ptr = c.argU32(2), usage = c.argU32(3);
    const b = boundBuffer(target); if (!b) return;
    if (size < 0 || size > maxMemoryRead) { error(GL.INVALID_VALUE); return; }
    b.bytes = ptr ? copyBytes(ptr, size) : new Uint8Array(size); b.usage = usage;
    gl.bufferData(target, ptr ? b.bytes : size, usage);
  });
  reg('glBufferSubData', c => {
    const target = c.argU32(0), offset = c.argI32(1), size = c.argI32(2), ptr = c.argU32(3);
    const b = boundBuffer(target); if (!b) return;
    if (offset < 0 || size < 0 || offset + size > b.bytes.length) { error(GL.INVALID_VALUE); return; }
    const bytes = copyBytes(ptr, size); b.bytes.set(bytes, offset); gl.bufferSubData(target, offset, bytes);
  });
  reg('glMapBufferOES', c => {
    const target = c.argU32(0), access = c.argU32(1), b = boundBuffer(target);
    if (!b) return 0;
    if (access !== 0x88b9) { error(GL.INVALID_ENUM); return 0; } // WRITE_ONLY_OES
    if (b.mapped || !b.bytes.length) { error(GL.INVALID_OPERATION); return 0; }
    if (!b.mapAllocation || b.mapCapacity < b.bytes.length) {
      b.mapAllocation = rt.alloc(b.bytes.length); b.mapCapacity = b.bytes.length;
    }
    b.mapped = b.mapAllocation; rt.writeBytes(b.mapped, b.bytes); return b.mapped;
  });
  reg('glUnmapBufferOES', c => {
    const target = c.argU32(0), b = boundBuffer(target);
    if (!b || !b.mapped) { error(GL.INVALID_OPERATION); return 0; }
    b.bytes = copyBytes(b.mapped, b.bytes.length); b.mapped = 0;
    gl.bufferSubData(target, 0, b.bytes); return 1;
  });
  reg('glGetBufferParameteriv', c => {
    const target = c.argU32(0), pname = c.argU32(1), b = boundBuffer(target);
    if (!b) return;
    const value = pname === 0x88bc ? !!b.mapped : pname === 0x88bb ? 0x88b9 : gl.getBufferParameter(target, pname);
    writeI32(c.argU32(2), value);
  });

  function pixelData(ptr, width, height, format, type, alignment, padTrailingRow = false) {
    if (!ptr) return null;
    const components = ({ 0x1906: 1, 0x1909: 1, 0x190a: 2, 0x1907: 3, 0x1908: 4, 0x1902: 1 })[format];
    if (!components || width < 0 || height < 0) { error(GL.INVALID_ENUM); return null; }
    let Type = Uint8Array, bytesPerPixel = components;
    if ([0x8033, 0x8034, 0x8363].includes(type)) { Type = Uint16Array; bytesPerPixel = 2; }
    else if (type === GL.FLOAT) { Type = Float32Array; bytesPerPixel = components * 4; }
    else if (type === GL.HALF_FLOAT_OES || type === GL.UNSIGNED_SHORT) { Type = Uint16Array; bytesPerPixel = components * 2; }
    else if (type === GL.UNSIGNED_INT || type === 0x84fa) { Type = Uint32Array; bytesPerPixel = type === 0x84fa ? 4 : components * 4; }
    else if (type !== GL.UNSIGNED_BYTE) { error(GL.INVALID_ENUM); return null; }
    const rowBytes = width * bytesPerPixel;
    const stride = Math.ceil(rowBytes / alignment) * alignment;
    const byteLength = height ? stride * (height - 1) + rowBytes : 0;
    const pixels = typed(ptr, byteLength / Type.BYTES_PER_ELEMENT, Type);
    // Some offscreen WebGL implementations require the final alignment tail.
    // Allocate it on the host: GLES callers need not allocate/read those bytes.
    if (padTrailingRow && stride * height > byteLength) {
      const padded = new Type(stride * height / Type.BYTES_PER_ELEMENT);
      padded.set(pixels); return padded;
    }
    return pixels;
  }
  reg('glTexImage2D', c => {
    const target = c.argU32(0), level = c.argI32(1), internal = c.argI32(2), width = c.argI32(3), height = c.argI32(4);
    const border = c.argI32(5), format = c.argU32(6), type = c.argU32(7), ptr = c.argU32(8);
    gl.texImage2D(target, level, internal, width, height, border, format, type, pixelData(ptr, width, height, format, type, unpackAlignment, true));
    stats.textureUploads++;
  });
  reg('glTexSubImage2D', c => {
    const target = c.argU32(0), level = c.argI32(1), x = c.argI32(2), y = c.argI32(3), width = c.argI32(4), height = c.argI32(5);
    const format = c.argU32(6), type = c.argU32(7), ptr = c.argU32(8);
    gl.texSubImage2D(target, level, x, y, width, height, format, type, pixelData(ptr, width, height, format, type, unpackAlignment, true));
    stats.textureUploads++;
  });
  reg('glCompressedTexImage2D', c => {
    gl.compressedTexImage2D(c.argU32(0), c.argI32(1), c.argU32(2), c.argI32(3), c.argI32(4), c.argI32(5), copyBytes(c.argU32(7), c.argI32(6)));
    stats.textureUploads++;
  });
  reg('glCompressedTexSubImage2D', c => {
    gl.compressedTexSubImage2D(c.argU32(0), c.argI32(1), c.argI32(2), c.argI32(3), c.argI32(4), c.argI32(5), c.argU32(6), copyBytes(c.argU32(8), c.argI32(7)));
    stats.textureUploads++;
  });
  reg('glReadPixels', c => {
    const width = c.argI32(2), height = c.argI32(3), ptr = c.argU32(6);
    const pixels = pixelData(ptr, width, height, c.argU32(4), c.argU32(5), packAlignment);
    if (!pixels) return;
    gl.readPixels(c.argI32(0), c.argI32(1), width, height, c.argU32(4), c.argU32(5), pixels);
    rt.writeBytes(ptr, new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength));
  });

  reg('glCreateShader', c => addResource('shader', gl.createShader(c.argU32(0))));
  reg('glCreateProgram', () => addResource('program', gl.createProgram()));
  reg('glDeleteShader', c => {
    gl.deleteShader(getResource(c.argU32(0), 'shader')); resources.delete(c.argU32(0)); shaderSources.delete(c.argU32(0));
  });
  reg('glDeleteProgram', c => { gl.deleteProgram(getResource(c.argU32(0), 'program')); resources.delete(c.argU32(0)); });
  reg('glAttachShader', c => gl.attachShader(getResource(c.argU32(0), 'program'), getResource(c.argU32(1), 'shader')));
  reg('glDetachShader', c => gl.detachShader(getResource(c.argU32(0), 'program'), getResource(c.argU32(1), 'shader')));
  reg('glUseProgram', c => gl.useProgram(getResource(c.argU32(0), 'program')));
  reg('glShaderSource', c => {
    const id = c.argU32(0), count = c.argI32(1), sourcePtr = c.argU32(2), lengthsPtr = c.argU32(3);
    let source = '';
    for (let i = 0; i < count; i++) {
      const ptr = rt.readU32(sourcePtr + 4 * i), len = lengthsPtr ? rt.readU32(lengthsPtr + 4 * i) | 0 : -1;
      source += len < 0 ? rt.readCString(ptr) : textDecoder.decode(readBytes(ptr, len));
    }
    shaderSources.set(id, source); gl.shaderSource(getResource(id, 'shader'), source);
  });
  reg('glCompileShader', c => {
    const id = c.argU32(0), shader = getResource(id, 'shader'); gl.compileShader(shader);
    const success = gl.getShaderParameter(shader, 0x8b81), log = gl.getShaderInfoLog(shader) || '';
    stats.shaders.push({ id, success: !!success, log });
    if (!success) {
      options.onDiagnostic?.({ kind: 'shader', id, log, source: shaderSources.get(id) });
      options.onLog?.(`Original game shader ${id} failed to compile: ${log}`);
    }
  });
  reg('glLinkProgram', c => {
    const id = c.argU32(0), program = getResource(id, 'program'); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, 0x8b82)) {
      const log = gl.getProgramInfoLog(program);
      options.onDiagnostic?.({ kind: 'program', id, log });
      options.onLog?.(`Original game shader program ${id} failed to link: ${log}`);
    }
  });
  reg('glValidateProgram', c => gl.validateProgram(getResource(c.argU32(0), 'program')));
  reg('glBindAttribLocation', c => gl.bindAttribLocation(getResource(c.argU32(0), 'program'), c.argU32(1), rt.readCString(c.argU32(2))));
  reg('glGetAttribLocation', c => gl.getAttribLocation(getResource(c.argU32(0), 'program'), rt.readCString(c.argU32(1))));
  reg('glGetUniformLocation', c => {
    const program = getResource(c.argU32(0), 'program'), name = rt.readCString(c.argU32(1));
    let location = gl.getUniformLocation(program, name);
    // GLES permits an array's base name to address its first element. Some
    // WebGL adapters only resolve the explicit [0] spelling (e.g. stack-gl).
    if (location === null && !name.endsWith(']')) location = gl.getUniformLocation(program, name + '[0]');
    if (location === null) return -1;
    if (uniformIds.has(location)) return uniformIds.get(location);
    const id = nextUniformId++; uniformIds.set(location, id); uniforms.set(id, location); return id;
  });
  reg('glGetShaderiv', c => {
    const id = c.argU32(0), shader = getResource(id, 'shader'), pname = c.argU32(1);
    const value = pname === 0x8b84 ? (gl.getShaderInfoLog(shader) || '').length + 1 :
      pname === 0x8b88 ? (shaderSources.get(id) || '').length + 1 : gl.getShaderParameter(shader, pname);
    writeI32(c.argU32(2), value);
  });
  reg('glGetProgramiv', c => {
    const program = getResource(c.argU32(0), 'program'), pname = c.argU32(1);
    let value;
    if (pname === 0x8b84) value = (gl.getProgramInfoLog(program) || '').length + 1;
    else if (pname === 0x8b87 || pname === 0x8b8a) {
      const count = gl.getProgramParameter(program, pname === 0x8b87 ? 0x8b86 : 0x8b89); value = 0;
      for (let i = 0; i < count; i++) {
        const active = pname === 0x8b87 ? gl.getActiveUniform(program, i) : gl.getActiveAttrib(program, i);
        if (active) value = Math.max(value, active.name.length + 1);
      }
    } else value = gl.getProgramParameter(program, pname);
    writeI32(c.argU32(2), value);
  });
  for (const [name, method] of [['glGetShaderInfoLog', 'getShaderInfoLog'], ['glGetProgramInfoLog', 'getProgramInfoLog']]) {
    reg(name, c => writeString(c.argU32(3), c.argI32(1), gl[method](getResource(c.argU32(0), method === 'getShaderInfoLog' ? 'shader' : 'program')), c.argU32(2)));
  }
  for (const [name, method] of [['glGetActiveUniform', 'getActiveUniform'], ['glGetActiveAttrib', 'getActiveAttrib']]) {
    reg(name, c => {
      const info = gl[method](getResource(c.argU32(0), 'program'), c.argU32(1));
      if (!info) return;
      writeI32(c.argU32(4), info.size); writeI32(c.argU32(5), info.type);
      writeString(c.argU32(6), c.argI32(2), info.name, c.argU32(3));
    });
  }
  function location(id) { return id === -1 || id === 0xffffffff ? null : uniforms.get(id) ?? null; }
  for (let n = 1; n <= 4; n++) {
    for (const [suffix, Type] of [['iv', Int32Array], ['fv', Float32Array]]) {
      reg(`glUniform${n}${suffix}`, c => {
        const id = c.argI32(0), count = c.argI32(1);
        if (id === -1) return;
        if (count < 0) { error(GL.INVALID_VALUE); return; }
        gl[`uniform${n}${suffix}`](location(id), typed(c.argU32(2), count * n, Type));
      });
    }
    reg(`glUniform${n}i`, c => gl[`uniform${n}i`](location(c.argI32(0)), ...Array.from({ length: n }, (_, i) => c.argI32(i + 1))));
    reg(`glUniform${n}f`, c => gl[`uniform${n}f`](location(c.argI32(0)), ...Array.from({ length: n }, (_, i) => c.argF32(i + 1))));
  }
  for (let n = 2; n <= 4; n++) {
    reg(`glUniformMatrix${n}fv`, c => {
      const id = c.argI32(0), count = c.argI32(1);
      if (id === -1) return;
      if (count < 0) { error(GL.INVALID_VALUE); return; }
      gl[`uniformMatrix${n}fv`](location(id), !!c.argU32(2), typed(c.argU32(3), count * n * n, Float32Array));
    });
  }

  function attrib(index) {
    if (!attributes.has(index)) attributes.set(index, { enabled: false, size: 4, type: GL.FLOAT, normalized: false, stride: 0, pointer: 0, buffer: 0, clientBuffer: null });
    return attributes.get(index);
  }
  reg('glEnableVertexAttribArray', c => { attrib(c.argU32(0)).enabled = true; gl.enableVertexAttribArray(c.argU32(0)); });
  reg('glDisableVertexAttribArray', c => { attrib(c.argU32(0)).enabled = false; gl.disableVertexAttribArray(c.argU32(0)); });
  reg('glVertexAttribPointer', c => {
    const index = c.argU32(0), a = attrib(index);
    Object.assign(a, { size: c.argI32(1), type: c.argU32(2), normalized: !!c.argU32(3), stride: c.argI32(4), pointer: c.argU32(5), buffer: arrayBuffer });
    if (a.buffer && a.type !== GL.FIXED && a.type !== GL.HALF_FLOAT_OES) gl.vertexAttribPointer(index, a.size, a.type, a.normalized, a.stride, a.pointer);
  });
  reg('glVertexAttrib4fv', c => gl.vertexAttrib4fv(c.argU32(0), typed(c.argU32(1), 4, Float32Array)));
  function scalarBytes(type) { return ({ 0x1400: 1, 0x1401: 1, 0x1402: 2, 0x1403: 2, 0x1406: 4, 0x140c: 4, 0x8d61: 2 })[type] || 0; }
  function halfToFloat(bits) {
    const sign = bits & 0x8000 ? -1 : 1, exp = (bits >> 10) & 31, mantissa = bits & 1023;
    return exp === 0 ? sign * mantissa * 2 ** -24 : exp === 31 ? mantissa ? NaN : sign * Infinity : sign * (1 + mantissa / 1024) * 2 ** (exp - 15);
  }
  function prepareAttributes(maxIndex) {
    for (const [index, a] of attributes) {
      if (!a.enabled) continue;
      const convert = a.type === GL.FIXED || a.type === GL.HALF_FLOAT_OES;
      if (a.buffer && !convert) continue;
      const scalarSize = scalarBytes(a.type), elementSize = a.size * scalarSize, stride = a.stride || elementSize;
      if (!scalarSize || elementSize < 1 || maxIndex < 0) continue;
      const size = maxIndex * stride + elementSize;
      let bytes;
      if (a.buffer) {
        const state = bufferStates.get(a.buffer);
        if (!state || a.pointer + size > state.bytes.length) throw new Error(`Vertex attribute ${index} exceeds its native buffer`);
        bytes = state.bytes.subarray(a.pointer, a.pointer + size);
      } else bytes = readBytes(a.pointer, size);
      if (!a.clientBuffer) a.clientBuffer = gl.createBuffer();
      gl.bindBuffer(GL.ARRAY_BUFFER, a.clientBuffer);
      if (convert) {
        const converted = new Float32Array((maxIndex + 1) * a.size);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let v = 0; v <= maxIndex; v++) for (let k = 0; k < a.size; k++) {
          const offset = v * stride + k * scalarSize;
          converted[v * a.size + k] = a.type === GL.FIXED ? view.getInt32(offset, true) / 65536 : halfToFloat(view.getUint16(offset, true));
        }
        gl.bufferData(GL.ARRAY_BUFFER, converted, GL.STREAM_DRAW);
        gl.vertexAttribPointer(index, a.size, GL.FLOAT, false, 0, 0);
      } else {
        gl.bufferData(GL.ARRAY_BUFFER, bytes, GL.STREAM_DRAW);
        gl.vertexAttribPointer(index, a.size, a.type, a.normalized, a.stride, 0);
      }
    }
    gl.bindBuffer(GL.ARRAY_BUFFER, getResource(arrayBuffer, 'buffer'));
  }
  function recordDraw(mode, count) {
    stats.draws++;
    if (mode === 4) stats.triangles += Math.floor(count / 3);
    else if (mode === 5 || mode === 6) stats.triangles += Math.max(0, count - 2);
  }
  reg('glDrawArrays', c => {
    const mode = c.argU32(0), first = c.argI32(1), count = c.argI32(2);
    if (first < 0 || count < 0) { error(GL.INVALID_VALUE); return; }
    if (count) prepareAttributes(first + count - 1);
    gl.drawArrays(mode, first, count); recordDraw(mode, count);
  });
  reg('glDrawElements', c => {
    const mode = c.argU32(0), count = c.argI32(1), type = c.argU32(2), pointer = c.argU32(3);
    const bytesPerIndex = ({ 0x1401: 1, 0x1403: 2, 0x1405: 4 })[type];
    if (!bytesPerIndex) { error(GL.INVALID_ENUM); return; }
    if (count < 0) { error(GL.INVALID_VALUE); return; }
    if (type === GL.UNSIGNED_INT && !extensions.OES_element_index_uint) { error(GL.INVALID_ENUM); return; }
    let indexBytes;
    if (elementBuffer) {
      const state = bufferStates.get(elementBuffer);
      if (!state || pointer + count * bytesPerIndex > state.bytes.length) { error(GL.INVALID_OPERATION); return; }
      indexBytes = state.bytes.subarray(pointer, pointer + count * bytesPerIndex);
    } else indexBytes = readBytes(pointer, count * bytesPerIndex);
    let maxIndex = -1;
    const view = new DataView(indexBytes.buffer, indexBytes.byteOffset, indexBytes.byteLength);
    for (let i = 0; i < count; i++) {
      const value = bytesPerIndex === 1 ? view.getUint8(i) : bytesPerIndex === 2 ? view.getUint16(i * 2, true) : view.getUint32(i * 4, true);
      maxIndex = Math.max(maxIndex, value);
    }
    if (count) prepareAttributes(maxIndex);
    if (!elementBuffer) {
      if (!clientElementBuffer) clientElementBuffer = gl.createBuffer();
      gl.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, clientElementBuffer);
      gl.bufferData(GL.ELEMENT_ARRAY_BUFFER, indexBytes, GL.STREAM_DRAW);
    }
    gl.drawElements(mode, count, type, elementBuffer ? pointer : 0);
    if (!elementBuffer) gl.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, null);
    recordDraw(mode, count);
  });

  return {
    stats, imports: imported, extensions,
    frame() { stats.frames++; },
    dispose() {
      for (const a of attributes.values()) if (a.clientBuffer) gl.deleteBuffer(a.clientBuffer);
      if (clientElementBuffer) gl.deleteBuffer(clientElementBuffer);
      const deletion = { buffer: 'deleteBuffer', texture: 'deleteTexture', framebuffer: 'deleteFramebuffer', renderbuffer: 'deleteRenderbuffer', shader: 'deleteShader', program: 'deleteProgram' };
      for (const { kind, value } of resources.values()) gl[deletion[kind]](value);
      resources.clear();
    },
  };
}
