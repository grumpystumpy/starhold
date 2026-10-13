/* starhold api bundle — scripts/bundle-api.mjs */

"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// apps/server/src/vercel-entry.ts
var vercel_entry_exports = {};
__export(vercel_entry_exports, {
  default: () => handler
});
module.exports = __toCommonJS(vercel_entry_exports);

// node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = Symbol();

// node_modules/hono/dist/utils/buffer.js
var bufferToFormData = (arrayBuffer, contentType) => {
  return new Response(arrayBuffer, { headers: { "Content-Type": contentType.replace(/^[^;]+/, (mediaType) => mediaType.toLowerCase()) } }).formData();
};

// node_modules/hono/dist/utils/body.js
var MAX_NESTED_OBJECTS = 1e4;
var isRawRequest = (request) => "headers" in request;
var parseBody = async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const mediaType = (isRawRequest(request) ? request.headers : request.raw.headers).get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (mediaType === "multipart/form-data" || mediaType === "application/x-www-form-urlencoded") return parseFormData(request, {
    all,
    dot
  });
  return {};
};
async function parseFormData(request, options) {
  if (!isRawRequest(request) && request.bodyCache.formData) return convertFormDataToBodyData(await request.bodyCache.formData, options);
  const headers = isRawRequest(request) ? request.headers : request.raw.headers;
  const arrayBuffer = await request.arrayBuffer();
  const formDataPromise = bufferToFormData(arrayBuffer, headers.get("Content-Type") || "");
  if (!isRawRequest(request)) request.bodyCache.formData = formDataPromise;
  const formData = await formDataPromise;
  if (formData) return convertFormDataToBodyData(formData, options);
  return {};
}
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  const nestingState = { count: 0 };
  formData.forEach((value, key) => {
    if (!(options.all || key.endsWith("[]"))) form[key] = value;
    else handleParsingAllValues(form, key, value);
  });
  if (options.dot) Object.entries(form).forEach(([key, value]) => {
    if (key.includes(".")) {
      handleParsingNestedValues(form, key, value, nestingState);
      delete form[key];
    }
  });
  return form;
}
var handleParsingAllValues = (form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key])) form[key].push(value);
    else form[key] = [form[key], value];
  } else if (!key.endsWith("[]")) form[key] = value;
  else form[key] = [value];
};
var handleParsingNestedValues = (form, key, value, state) => {
  if (/(?:^|\.)__proto__\./.test(key)) return;
  let nestedForm = form;
  const keys = key.split(".", 34);
  if (keys.length > 33) throwNestingLimitExceeded();
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) nestedForm[key2] = value;
    else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        if (state.count++ >= MAX_NESTED_OBJECTS) throwNestingLimitExceeded();
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
};
var throwNestingLimitExceeded = () => {
  throw new Error("Nesting limit exceeded");
};

// node_modules/hono/dist/utils/url.js
var splitPath = (path) => {
  const paths = path.split("/");
  if (paths[0] === "") paths.shift();
  return paths;
};
var splitRoutingPath = (routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
};
var extractGroupsFromPath = (path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return {
    groups,
    path
  };
};
var replaceGroupMarks = (paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) if (paths[j].includes(mark)) {
      paths[j] = paths[j].replace(mark, groups[i][1]);
      break;
    }
  }
  return paths;
};
var patternCache = {};
var getPattern = (label, next) => {
  if (label === "*") return "*";
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match2[2]) patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [
        cacheKey,
        match2[1],
        new RegExp(`^${match2[2]}(?=/${next})`)
      ] : [
        label,
        match2[1],
        new RegExp(`^${match2[2]}$`)
      ];
      else patternCache[cacheKey] = [
        label,
        match2[1],
        true
      ];
    }
    return patternCache[cacheKey];
  }
  return null;
};
var tryDecode = (str, decoder) => {
  try {
    return decoder(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder(match2);
      } catch {
        return match2;
      }
    });
  }
};
var tryDecodeURI = (str) => tryDecode(str, decodeURI);
var getPath = (request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const hashIndex = url.indexOf("#", i);
      const end = queryIndex === -1 ? hashIndex === -1 ? void 0 : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
      const path = url.slice(start, end);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63 || charCode === 35) break;
  }
  return url.slice(start, i);
};
var getPathNoStrict = (request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
};
var mergePath = (base, sub, ...rest) => {
  if (rest.length) sub = mergePath(sub, ...rest);
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
};
var checkOptionalParameter = (path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) return null;
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) basePath += "/" + segment;
    else if (/\:/.test(segment)) {
      if (segment.charCodeAt(segment.length - 1) === 63) {
        if (results.length === 0 && basePath === "") results.push("/");
        else results.push(basePath);
        const optionalSegment = segment.slice(0, -1);
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else basePath += "/" + segment;
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
};
var tryDecodeURIComponent = (str) => str.indexOf("%") !== -1 ? tryDecode(str, decodeURIComponent_) : str;
var _decodeURI = (value) => {
  if (value.indexOf("+") !== -1) value = value.replace(/\+/g, " ");
  return tryDecodeURIComponent(value);
};
var _getQueryParam = (url, key, multiple) => {
  const hashIndex = url.indexOf("#", 8);
  if (hashIndex !== -1) url = url.slice(0, hashIndex);
  let encoded;
  if (!multiple && key && key.indexOf("%") === -1 && key.indexOf("+") === -1) {
    let keyIndex2 = url.indexOf("?", 8);
    if (keyIndex2 === -1) return;
    if (!url.startsWith(key, keyIndex2 + 1)) keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) return "";
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) return;
  }
  const results = /* @__PURE__ */ Object.create(null);
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) valueIndex = -1;
    let name = url.slice(keyIndex + 1, valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex);
    if (encoded) name = _decodeURI(name);
    keyIndex = nextKeyIndex;
    if (name === "") continue;
    let value;
    if (valueIndex === -1) value = "";
    else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) value = _decodeURI(value);
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) results[name] = [];
      results[name].push(value);
    } else results[name] ??= value;
  }
  return key ? results[key] : results;
};
var getQueryParam = _getQueryParam;
var getQueryParams = (url, key) => {
  return _getQueryParam(url, key, true);
};
var decodeURIComponent_ = decodeURIComponent;

// node_modules/hono/dist/request.js
var HonoRequest = class {
  /**
  * `.raw` can get the raw Request object.
  *
  * @see {@link https://hono.dev/docs/api/request#raw}
  *
  * @example
  * ```ts
  * // For Cloudflare Workers
  * app.post('/', async (c) => {
  *   const metadata = c.req.raw.cf?.hostMetadata?
  *   ...
  * })
  * ```
  */
  raw;
  #validatedData;
  #matchResult;
  routeIndex = 0;
  /**
  * `.path` can get the pathname of the request.
  *
  * @see {@link https://hono.dev/docs/api/request#path}
  *
  * @example
  * ```ts
  * app.get('/about/me', (c) => {
  *   const pathname = c.req.path // `/about/me`
  * })
  * ```
  */
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex]?.[1][key];
    const param = this.#getParamValue(paramKey);
    return param && tryDecodeURIComponent(param);
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex]?.[1] ?? {});
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) decoded[key] = tryDecodeURIComponent(value);
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) return this.raw.headers.get(name) ?? void 0;
    const headerData = /* @__PURE__ */ Object.create(null);
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return parseBody(this, options);
  }
  #cachedBody = (key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) return cachedBody;
    for (const anyCachedKey in bodyCache) return bodyCache[anyCachedKey].then((body) => {
      if (anyCachedKey === "json") body = JSON.stringify(body);
      const contentType = anyCachedKey === "formData" ? void 0 : raw2.headers.get("content-type");
      return new Response(body, { headers: contentType ? { "Content-Type": contentType } : void 0 })[key]();
    });
    return bodyCache[key] = raw2[key]();
  };
  /**
  * `.json()` can parse Request body of type `application/json`
  *
  * @see {@link https://hono.dev/docs/api/request#json}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.json()
  * })
  * ```
  */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
  * `.text()` can parse Request body of type `text/plain`
  *
  * @see {@link https://hono.dev/docs/api/request#text}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.text()
  * })
  * ```
  */
  text() {
    return this.#cachedBody("text");
  }
  /**
  * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
  *
  * @see {@link https://hono.dev/docs/api/request#arraybuffer}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.arrayBuffer()
  * })
  * ```
  */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
  * `.bytes()` parses the request body as a `Uint8Array`.
  *
  * @see {@link https://hono.dev/docs/api/request#bytes}
  *
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.bytes()
  * })
  * ```
  */
  bytes() {
    return this.#cachedBody("arrayBuffer").then((buffer) => new Uint8Array(buffer));
  }
  /**
  * Parses the request body as a `Blob`.
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.blob();
  * });
  * ```
  * @see https://hono.dev/docs/api/request#blob
  */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
  * Parses the request body as `FormData`.
  * @example
  * ```ts
  * app.post('/entry', async (c) => {
  *   const body = await c.req.formData();
  * });
  * ```
  * @see https://hono.dev/docs/api/request#formdata
  */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
  * Adds validated data to the request.
  *
  * @param target - The target of the validation.
  * @param data - The validated data to add.
  */
  addValidatedData(target, data) {
    (this.#validatedData ??= {})[target] = data;
  }
  valid(target) {
    return this.#validatedData?.[target];
  }
  /**
  * `.url` can get the request url strings.
  *
  * @see {@link https://hono.dev/docs/api/request#url}
  *
  * @example
  * ```ts
  * app.get('/about/me', (c) => {
  *   const url = c.req.url // `http://localhost:8787/about/me`
  *   ...
  * })
  * ```
  */
  get url() {
    return this.raw.url;
  }
  /**
  * `.method` can get the method name of the request.
  *
  * @see {@link https://hono.dev/docs/api/request#method}
  *
  * @example
  * ```ts
  * app.get('/about/me', (c) => {
  *   const method = c.req.method // `GET`
  * })
  * ```
  */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
  * `.matchedRoutes` can return a matched route in the handler
  *
  * @deprecated
  *
  * Use matchedRoutes helper defined in "hono/route" instead.
  *
  * @see {@link https://hono.dev/docs/api/request#matchedroutes}
  *
  * @example
  * ```ts
  * app.use('*', async function logger(c, next) {
  *   await next()
  *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
  *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
  *     console.log(
  *       method,
  *       ' ',
  *       path,
  *       ' '.repeat(Math.max(10 - path.length, 0)),
  *       name,
  *       i === c.req.routeIndex ? '<- respond from here' : ''
  *     )
  *   })
  * })
  * ```
  */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
  * `.routePath` can retrieve the path registered within the handler
  *
  * @deprecated
  *
  * Use routePath helper defined in "hono/route" instead.
  *
  * @see {@link https://hono.dev/docs/api/request#routepath}
  *
  * @example
  * ```ts
  * app.get('/posts/:id', (c) => {
  *   return c.json({ path: c.req.routePath })
  * })
  * ```
  */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = (value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
};
var resolveCallback = async (str, phase, preserveCallbacks, context, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) str = str.toString();
    if (str instanceof Promise) str = await str;
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) return Promise.resolve(str);
  if (buffer) buffer[0] += str;
  else buffer = [str];
  const resStr = Promise.all(callbacks.map((c) => c({
    phase,
    buffer,
    context
  }))).then((res) => Promise.all(res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context, buffer))).then(() => buffer[0]));
  if (preserveCallbacks) return raw(await resStr, callbacks);
  else return resStr;
};

// node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = (contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
};
var createResponseInstance = (body, init) => new Response(body, init);
var Context = class {
  #rawRequest;
  #req;
  /**
  * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
  *
  * @see {@link https://hono.dev/docs/api/context#env}
  *
  * @example
  * ```ts
  * // Environment object for Cloudflare Workers
  * app.get('*', async c => {
  *   const counter = c.env.COUNTER
  * })
  * ```
  */
  env = {};
  #var;
  finalized = false;
  /**
  * `.error` can get the error object from the middleware if the Handler throws an error.
  *
  * @see {@link https://hono.dev/docs/api/context#error}
  *
  * @example
  * ```ts
  * app.use('*', async (c, next) => {
  *   await next()
  *   if (c.error) {
  *     // do something...
  *   }
  * })
  * ```
  */
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  /**
  * Creates an instance of the Context class.
  *
  * @param req - The Request object.
  * @param options - Optional configuration options for the context.
  */
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  /**
  * `.req` is the instance of {@link HonoRequest}.
  */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
  * @see {@link https://hono.dev/docs/api/context#event}
  * The FetchEvent associated with the current request.
  *
  * @throws Will throw an error if the context does not have a FetchEvent.
  */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) return this.#executionCtx;
    else throw Error("This context has no FetchEvent");
  }
  /**
  * @see {@link https://hono.dev/docs/api/context#executionctx}
  * The ExecutionContext associated with the current request.
  *
  * @throws Will throw an error if the context does not have an ExecutionContext.
  */
  get executionCtx() {
    if (this.#executionCtx) return this.#executionCtx;
    else throw Error("This context has no ExecutionContext");
  }
  /**
  * @see {@link https://hono.dev/docs/api/context#res}
  * The Response object for the current request.
  */
  get res() {
    return this.#res ||= createResponseInstance(null, { headers: this.#preparedHeaders ??= new Headers() });
  }
  /**
  * Sets the Response object for the current request.
  *
  * @param _res - The Response object to set.
  */
  set res(_res) {
    if (this.#res && _res) {
      _res = createResponseInstance(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") continue;
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) _res.headers.append("set-cookie", cookie);
        } else _res.headers.set(k, v);
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  /**
  * `.render()` can create a response within a layout.
  *
  * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
  *
  * @example
  * ```ts
  * app.get('/', (c) => {
  *   return c.render('Hello!')
  * })
  * ```
  */
  render = (...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  };
  /**
  * Sets the layout for the response.
  *
  * @param layout - The layout to set.
  * @returns The layout function.
  */
  setLayout = (layout) => this.#layout = layout;
  /**
  * Gets the current layout for the response.
  *
  * @returns The current layout function.
  */
  getLayout = () => this.#layout;
  /**
  * `.setRenderer()` can set the layout in the custom middleware.
  *
  * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
  *
  * @example
  * ```tsx
  * app.use('*', async (c, next) => {
  *   c.setRenderer((content) => {
  *     return c.html(
  *       <html>
  *         <body>
  *           <p>{content}</p>
  *         </body>
  *       </html>
  *     )
  *   })
  *   await next()
  * })
  * ```
  */
  setRenderer = (renderer) => {
    this.#renderer = renderer;
  };
  /**
  * `.header()` can set headers.
  *
  * @see {@link https://hono.dev/docs/api/context#header}
  *
  * @example
  * ```ts
  * app.get('/welcome', (c) => {
  *   // Set headers
  *   c.header('X-Message', 'Hello!')
  *   c.header('Content-Type', 'text/plain')
  *
  *   // Append multiple headers using the append option (e.g. Vary)
  *   c.header('Vary', 'Accept-Encoding', { append: true })
  *   c.header('Vary', 'User-Agent', { append: true })
  *
  *   return c.body('Thank you for coming')
  * })
  * ```
  */
  header = (name, value, options) => {
    if (this.finalized) this.#res = createResponseInstance(this.#res.body, this.#res);
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) headers.delete(name);
    else if (options?.append) headers.append(name, value);
    else headers.set(name, value);
  };
  status = (status) => {
    this.#status = status;
  };
  /**
  * `.set()` can set the value specified by the key.
  *
  * @see {@link https://hono.dev/docs/api/context#set-get}
  *
  * @example
  * ```ts
  * app.use('*', async (c, next) => {
  *   c.set('message', 'Hono is hot!!')
  *   await next()
  * })
  * ```
  */
  set = (key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  };
  /**
  * `.get()` can use the value specified by the key.
  *
  * @see {@link https://hono.dev/docs/api/context#set-get}
  *
  * @example
  * ```ts
  * app.get('/', (c) => {
  *   const message = c.get('message')
  *   return c.text(`The message is "${message}"`)
  * })
  * ```
  */
  get = (key) => {
    return this.#var ? this.#var.get(key) : void 0;
  };
  /**
  * `.var` can access the value of a variable.
  *
  * @see {@link https://hono.dev/docs/api/context#var}
  *
  * @example
  * ```ts
  * const result = c.var.client.oneMethod()
  * ```
  */
  get var() {
    if (!this.#var) return {};
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    let responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders;
    if (typeof arg === "object" && arg.headers) {
      responseHeaders ??= new Headers();
      for (const [key, value] of new Headers(arg.headers)) if (key === "set-cookie") responseHeaders.append(key, value);
      else responseHeaders.set(key, value);
    }
    if (headers) {
      if (!responseHeaders) {
        let count = 0;
        for (const k in headers) if (++count > 1 || typeof headers[k] !== "string") {
          responseHeaders = new Headers();
          break;
        }
      }
      if (responseHeaders) for (const k in headers) {
        const v = headers[k];
        if (typeof v === "string") responseHeaders.set(k, v);
        else {
          responseHeaders.delete(k);
          for (const v2 of v) responseHeaders.append(k, v2);
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, {
      status,
      headers: responseHeaders ?? headers
    });
  }
  newResponse = (...args) => this.#newResponse(...args);
  /**
  * `.body()` can return the HTTP response.
  * You can set headers with `.header()` and set HTTP status code with `.status`.
  * This can also be set in `.text()`, `.json()` and so on.
  *
  * @see {@link https://hono.dev/docs/api/context#body}
  *
  * @example
  * ```ts
  * app.get('/welcome', (c) => {
  *   // Set headers
  *   c.header('X-Message', 'Hello!')
  *   c.header('Content-Type', 'text/plain')
  *   // Set HTTP status code
  *   c.status(201)
  *
  *   // Return the response body
  *   return c.body('Thank you for coming')
  * })
  * ```
  */
  body = (data, arg, headers) => this.#newResponse(data, arg, headers);
  /**
  * `.text()` can render text as `Content-Type:text/plain`.
  *
  * @see {@link https://hono.dev/docs/api/context#text}
  *
  * @example
  * ```ts
  * app.get('/say', (c) => {
  *   return c.text('Hello!')
  * })
  * ```
  */
  text = (text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(text, arg, setDefaultContentType(TEXT_PLAIN, headers));
  };
  /**
  * `.json()` can render JSON as `Content-Type:application/json`.
  *
  * @see {@link https://hono.dev/docs/api/context#json}
  *
  * @example
  * ```ts
  * app.get('/api', (c) => {
  *   return c.json({ message: 'Hello!' })
  * })
  * ```
  */
  json = (object, arg, headers) => {
    return this.#newResponse(JSON.stringify(object), arg, setDefaultContentType("application/json", headers));
  };
  html = (html, arg, headers) => {
    const res = (html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers));
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  };
  /**
  * `.redirect()` can Redirect, default status code is 302.
  *
  * @see {@link https://hono.dev/docs/api/context#redirect}
  *
  * @example
  * ```ts
  * app.get('/redirect', (c) => {
  *   return c.redirect('/')
  * })
  * app.get('/redirect-permanently', (c) => {
  *   return c.redirect('/', 301)
  * })
  * ```
  */
  redirect = (location, status) => {
    const locationString = String(location);
    this.header("Location", !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString));
    return this.newResponse(null, status ?? 302);
  };
  /**
  * `.notFound()` can return the Not Found Response.
  *
  * @see {@link https://hono.dev/docs/api/context#notfound}
  *
  * @example
  * ```ts
  * app.get('/notfound', (c) => {
  *   return c.notFound()
  * })
  * ```
  */
  notFound = () => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  };
};

// node_modules/hono/dist/compose.js
var compose = (middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) throw new Error("next() called multiple times");
      index = i;
      let res;
      let isError = false;
      let handler2;
      if (middleware[i]) {
        handler2 = middleware[i][0][0];
        context.req.routeIndex = i;
      } else handler2 = i === middleware.length && next || void 0;
      if (handler2) try {
        res = await handler2(context, () => dispatch(i + 1));
      } catch (err) {
        if (err instanceof Error && onError) {
          context.error = err;
          res = await onError(err, context);
          isError = true;
        } else throw err;
      }
      else if (context.finalized === false && onNotFound) res = await onNotFound(context);
      if (res && (context.finalized === false || isError)) context.res = res;
      return context;
    }
  };
};

// node_modules/hono/dist/router.js
var METHODS = [
  "get",
  "post",
  "put",
  "delete",
  "options",
  "patch",
  "query"
];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
};

// node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// node_modules/hono/dist/hono-base.js
var notFoundHandler = (c) => {
  return c.text("404 Not Found", 404);
};
var errorHandler = (err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
};
var Hono = class Hono2 {
  get;
  post;
  put;
  delete;
  options;
  patch;
  query;
  all;
  on;
  use;
  router;
  getPath;
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    [...METHODS, "all"].forEach((method) => {
      this[method] = (args1, ...args) => {
        const methodName = method.toUpperCase();
        if (typeof args1 === "string") this.#path = args1;
        else this.#addRoute(methodName, this.#path, args1);
        args.forEach((handler2) => {
          this.#addRoute(methodName, this.#path, handler2);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          const methodName = m.toUpperCase();
          for (const handler2 of handlers) this.#addRoute(methodName, this.#path, handler2);
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") this.#path = arg1;
      else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler2) => {
        this.#addRoute("ALL", this.#path, handler2);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new Hono2({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  errorHandler = errorHandler;
  /**
  * `.route()` allows grouping other Hono instance in routes.
  *
  * @see {@link https://hono.dev/docs/api/routing#grouping}
  *
  * @param {string} path - base Path
  * @param {Hono} app - other Hono instance
  * @returns {Hono} routed Hono instance
  *
  * @example
  * ```ts
  * const app = new Hono()
  * const app2 = new Hono()
  *
  * app2.get("/user", (c) => c.text("user"))
  * app.route("/api", app2) // GET /api/user
  * ```
  */
  route(path, app2) {
    const subApp = this.basePath(path);
    app2.routes.map((r) => {
      let handler2;
      if (app2.errorHandler === errorHandler) handler2 = r.handler;
      else {
        handler2 = async (c, next) => (await compose([], app2.errorHandler)(c, () => r.handler(c, next))).res;
        handler2[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler2, r.basePath);
    });
    return this;
  }
  /**
  * `.basePath()` allows base paths to be specified.
  *
  * @see {@link https://hono.dev/docs/api/routing#base-path}
  *
  * @param {string} path - base Path
  * @returns {Hono} changed Hono instance
  *
  * @example
  * ```ts
  * const api = new Hono().basePath('/api')
  * ```
  */
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  /**
  * `.onError()` handles an error and returns a customized Response.
  *
  * @see {@link https://hono.dev/docs/api/hono#error-handling}
  *
  * @param {ErrorHandler} handler - request Handler for error
  * @returns {Hono} changed Hono instance
  *
  * @example
  * ```ts
  * app.onError((err, c) => {
  *   console.error(`${err}`)
  *   return c.text('Custom Error Message', 500)
  * })
  * ```
  */
  onError = (handler2) => {
    this.errorHandler = handler2;
    return this;
  };
  /**
  * `.notFound()` allows you to customize a Not Found Response.
  *
  * @see {@link https://hono.dev/docs/api/hono#not-found}
  *
  * @param {NotFoundHandler} handler - request handler for not-found
  * @returns {Hono} changed Hono instance
  *
  * @example
  * ```ts
  * app.notFound((c) => {
  *   return c.text('Custom 404 Message', 404)
  * })
  * ```
  */
  notFound = (handler2) => {
    this.#notFoundHandler = handler2;
    return this;
  };
  /**
  * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
  *
  * @deprecated Use `mount()` from `hono/mount` instead. `.mount()` will be removed in v5.
  *
  * @see {@link https://hono.dev/docs/api/hono#mount}
  *
  * @param {string} path - base Path
  * @param {Function} applicationHandler - other Request Handler
  * @param {MountOptions} [options] - options of `.mount()`
  * @returns {Hono} mounted Hono instance
  *
  * @example
  * ```ts
  * import { Router as IttyRouter } from 'itty-router'
  * import { Hono } from 'hono'
  * // Create itty-router application
  * const ittyRouter = IttyRouter()
  * // GET /itty-router/hello
  * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
  *
  * const app = new Hono()
  * app.mount('/itty-router', ittyRouter.handle)
  * ```
  *
  * @example
  * ```ts
  * const app = new Hono()
  * // Send the request to another application without modification.
  * app.mount('/app', anotherApp, {
  *   replaceRequest: (req) => req,
  * })
  * ```
  */
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") optionHandler = options;
      else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) replaceRequest = (request) => request;
        else replaceRequest = options.replaceRequest;
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = this.getPath(request).slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler2 = async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) return res;
      await next();
    };
    this.#addRoute("ALL", mergePath(path, "*"), handler2);
    return this;
  }
  #addRoute(method, path, handler2, baseRoutePath) {
    path = mergePath(this._basePath, path);
    const r = {
      basePath: baseRoutePath !== void 0 ? mergePath(this._basePath, baseRoutePath) : this._basePath,
      path,
      method,
      handler: handler2
    };
    this.router.add(method, path, [handler2, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) return this.errorHandler(err, c);
    throw err;
  }
  #dispatch(request, executionCtx, env, method) {
    if (method === "HEAD") return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
    const path = this.getPath(request, { env });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then((resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context = await composed(c);
        if (!context.finalized) throw new Error("Context is not finalized. Did you forget to return a Response object or `await next()`?");
        return context.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  /**
  * `.fetch()` will be entry point of your app.
  *
  * @see {@link https://hono.dev/docs/api/hono#fetch}
  *
  * @param {Request} request - request Object of request
  * @param {Env} env - env Object
  * @param {ExecutionContext} executionCtx - context of execution
  * @returns {Response | Promise<Response>} response of request
  *
  */
  fetch = (request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  };
  /**
  * `.request()` is a useful method for testing.
  * You can pass a URL or pathname to send a GET request.
  * app will return a Response object.
  * ```ts
  * test('GET /hello is ok', async () => {
  *   const res = await app.request('/hello')
  *   expect(res.status).toBe(200)
  * })
  * ```
  * @see https://hono.dev/docs/api/hono#request
  */
  request = (input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    input = input.toString();
    return this.fetch(new Request(/^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`, requestInit), Env, executionCtx);
  };
  /**
  * `.fire()` automatically adds a global fetch event listener.
  * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
  * @deprecated
  * Use `fire` from `hono/service-worker` instead.
  * ```ts
  * import { Hono } from 'hono'
  * import { fire } from 'hono/service-worker'
  *
  * const app = new Hono()
  * // ...
  * fire(app)
  * ```
  * @see https://hono.dev/docs/api/hono#fire
  * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
  * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
  */
  fire = () => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  };
};

// node_modules/hono/dist/router/utils.js
var createNullObject = () => /* @__PURE__ */ Object.create(null);

// node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = ((method2, path2) => {
    const matcher = matchers[method2] || matchers["ALL"];
    const staticMatch = matcher[2][path2];
    if (staticMatch) return staticMatch;
    const match3 = path2.match(matcher[0]);
    if (!match3) return [[], emptyParam];
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  });
  this.match = match2;
  return match2(method, path);
}

// node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = Symbol();
var regExpMetaChars = /* @__PURE__ */ new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) return b.length === 1 ? a < b ? -1 : 1 : -1;
  if (b.length === 1) return 1;
  if (a === ".*" || a === "(?:|/.*)") return b === "(?:|/.*)" ? -1 : 1;
  else if (b === ".*" || b === "(?:|/.*)") return -1;
  if (a === "[^/]+") return 1;
  else if (b === "[^/]+") return -1;
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
var Node = class Node2 {
  #index;
  #varIndex;
  #children = createNullObject();
  insert(tokens, index, paramMap, context, isStatic) {
    let node = this;
    for (let i = 0, len = tokens.length; i < len; i++) {
      const token = tokens[i];
      const pattern = token.length === 1 ? token === "*" ? i === len - 1 ? [
        "",
        "",
        ".*"
      ] : [
        "",
        "",
        LABEL_REG_EXP_STR
      ] : null : token === "/*" ? [
        "",
        "",
        TAIL_WILDCARD_REG_EXP_STR
      ] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
      let nextNode;
      if (pattern) {
        const name = pattern[1];
        let regexpStr = pattern[2] || "[^/]+";
        if (name && pattern[2]) {
          if (regexpStr === ".*") throw PATH_ERROR;
          regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
          if (/\((?!\?:)/.test(regexpStr)) throw PATH_ERROR;
          if (regexpStr.length === 1 && regExpMetaChars.has(regexpStr)) throw PATH_ERROR;
        }
        nextNode = node.#children[regexpStr];
        if (!nextNode) {
          if (regexpStr !== ".*" && regexpStr !== "(?:|/.*)") {
            for (const k in node.#children) if ((regexpStr.length > 1 || k.length > 1) && k !== ".*" && k !== "(?:|/.*)") throw PATH_ERROR;
          }
          nextNode = node.#children[regexpStr] = new Node2();
        }
        if (name !== "") {
          nextNode.#varIndex ??= context.varIndex++;
          paramMap.push([name, nextNode.#varIndex]);
        }
      } else {
        nextNode = node.#children[token];
        if (!nextNode) {
          for (const k in node.#children) if (k.length > 1 && k !== ".*" && k !== "(?:|/.*)") throw PATH_ERROR;
          nextNode = node.#children[token] = new Node2();
        }
      }
      node = nextNode;
    }
    if (node.#index !== void 0) throw PATH_ERROR;
    node.#index = isStatic ? -1 : index;
  }
  buildRegExpStr() {
    const strList = Object.keys(this.#children).sort(compareKey).map((k) => {
      const c = this.#children[k];
      const childStr = c.buildRegExpStr();
      return childStr === "" ? "" : (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + childStr;
    }).filter(Boolean);
    if (typeof this.#index === "number" && this.#index !== -1) strList.unshift(`#${this.#index}`);
    if (strList.length === 0) return "";
    if (strList.length === 1) return strList[0];
    return "(?:" + strList.join("|") + ")";
  }
};

// node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
  #context = { varIndex: 0 };
  #root = new Node();
  #index = 0;
  paths = createNullObject();
  insert(path, isStatic) {
    if (isStatic) {
      this.#root.insert(path.split(""), 0, [], this.#context, true);
      return;
    }
    const paramAssoc = [];
    const groups = [];
    let markedPath = path;
    for (let i = 0; ; ) {
      let replaced = false;
      markedPath = markedPath.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) break;
    }
    const tokens = markedPath.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--) if (tokens[j].indexOf(mark) !== -1) {
        tokens[j] = tokens[j].replace(mark, groups[i][1]);
        break;
      }
    }
    this.#root.insert(tokens, this.#index, paramAssoc, this.#context, false);
    this.paths[path] = [this.#index++, paramAssoc];
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") return [
      /^$/,
      [],
      []
    ];
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [
      new RegExp(`^${regexp}`),
      indexReplacementMap,
      paramReplacementMap
    ];
  }
};

// node_modules/hono/dist/router/reg-exp-router/router.js
var wildcardRegExpCache = createNullObject();
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(`^${path.replace(/\/:[^/{}]+(?:\{\[\^\/]\+})?(?=[/{]|$)|\/?\*$|([.\\+*[^\]$()?{}|])/g, (match2, metaChar) => metaChar ? `\\${metaChar}` : match2 === "/*" ? TAIL_WILDCARD_REG_EXP_STR : match2 === "*" ? ".*" : `/:${LABEL_REG_EXP_STR}`)}$`);
}
function findMiddleware(middleware, path) {
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) if (buildWildcardRegExp(k).test(path)) return [...middleware[k]];
}
var RegExpRouter = class {
  name = "RegExpRouter";
  #middleware;
  #routes;
  #tries;
  constructor() {
    this.#middleware = { ["ALL"]: createNullObject() };
    this.#routes = { ["ALL"]: createNullObject() };
    this.#tries = { ["ALL"]: new Trie() };
  }
  #insertPath(method, path) {
    try {
      this.#tries[method].insert(path, !/\*|\/:/.test(path));
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
  }
  add(method, path, handler2) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware) throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    if (!middleware[method]) {
      this.#tries[method] = new Trie();
      for (const handlerMap of [middleware, routes]) {
        handlerMap[method] = createNullObject();
        for (const p in handlerMap["ALL"]) {
          handlerMap[method][p] = [...handlerMap["ALL"][p]];
          this.#insertPath(method, p);
        }
      }
    }
    if (path === "/*") path = "*";
    const methods = method === "ALL" ? Object.keys(middleware) : [method];
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      for (const m of methods) if (!middleware[m][path]) {
        this.#insertPath(m, path);
        middleware[m][path] = findMiddleware(middleware[m], path) || findMiddleware(middleware["ALL"], path) || [];
      }
      for (const handlerMap of [middleware, routes]) for (const m of methods) for (const p in handlerMap[m]) re.test(p) && handlerMap[m][p].push([handler2, path]);
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (const path2 of paths) for (const m of methods) {
      if (!routes[m][path2]) {
        this.#insertPath(m, path2);
        routes[m][path2] = findMiddleware(middleware[m], path2) || findMiddleware(middleware["ALL"], path2) || [];
      }
      routes[m][path2].push([handler2, path2]);
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = createNullObject();
    for (const method of Object.keys(this.#routes)) matchers[method] = this.#buildMatcher(method);
    this.#middleware = this.#routes = this.#tries = void 0;
    wildcardRegExpCache = createNullObject();
    return matchers;
  }
  #buildMatcher(method) {
    const middleware = this.#middleware[method];
    const routes = this.#routes[method];
    const trie = this.#tries[method];
    const staticMap = createNullObject();
    const handlerData = [];
    const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
    for (const r of [middleware, routes]) for (const path in r) {
      const handlers = r[path];
      const pathData = trie.paths[path];
      if (!pathData) {
        staticMap[path] = [handlers.map(([h]) => [h, createNullObject()]), emptyParam];
        continue;
      }
      handlerData[pathData[0]] = handlers.map(([h, handlerPath]) => [h, trie.paths[handlerPath][1].reduceRight((map, [key], i) => {
        map[key] = paramReplacementMap[pathData[1][i][1]];
        return map;
      }, createNullObject())]);
    }
    return [
      regexp,
      indexReplacementMap.map((i) => handlerData[i]),
      staticMap
    ];
  }
};

// node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler2) {
    if (!this.#routes) throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    this.#routes.push([
      method,
      path,
      handler2
    ]);
  }
  match(method, path) {
    if (!this.#routes) throw new Error("Fatal error");
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) router.add(...routes[i2]);
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) continue;
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) throw new Error("Fatal error");
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) throw new Error("No active router has been determined yet.");
    return this.#routers[0];
  }
};

// node_modules/hono/dist/router/trie-router/node.js
var emptyParams = createNullObject();
var order = 0;
var Node3 = class Node4 {
  #methods = [];
  #children = createNullObject();
  #patterns = [];
  #pattern;
  #params = emptyParams;
  insert(method, path, handler2) {
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = /* @__PURE__ */ new Set();
    let i = 0;
    for (const p of parts) {
      const nextP = parts[++i];
      const pattern = getPattern(p, nextP) || (nextP === void 0 && p && p.indexOf("*") === p.length - 1 ? p : null);
      const isParam = Array.isArray(pattern);
      const key = isParam ? pattern[0] : pattern || p;
      const child = curNode.#children[key] ||= new Node4();
      if (pattern && !child.#pattern) {
        child.#pattern = pattern;
        curNode.#patterns.push(child);
      }
      curNode = child;
      if (isParam) possibleKeys.add(pattern[1]);
    }
    curNode.#methods.push({ [method]: {
      handler: handler2,
      possibleKeys: [...possibleKeys],
      score: ++order
    } });
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m["ALL"];
      if (handlerSet) {
        handlerSet.params = createNullObject();
        handlerSets.push(handlerSet);
        for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
          const key = handlerSet.possibleKeys[i2];
          handlerSet.params[key] = params?.[key] && !i2 ? params[key] : nodeParams[key] ?? params?.[key];
        }
      }
    }
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    let curNodes = [this];
    const parts = splitPath(path);
    const curNodesQueue = [];
    const len = parts.length;
    let partOffsets = null;
    for (let i = 0; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
            this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
          } else tempNodes.push(nextNode);
        }
        for (const child of node.#patterns) {
          const pattern = child.#pattern;
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (typeof pattern === "string") {
            if (pattern === "*" || part.startsWith(pattern.slice(0, -1))) {
              this.#pushHandlerSets(handlerSets, child, method, node.#params);
              if (pattern === "*") {
                child.#params = params;
                tempNodes.push(child);
              }
            }
            continue;
          }
          const [, name, matcher] = pattern;
          if (!part && matcher === true) continue;
          if (matcher !== true) {
            if (!partOffsets) {
              partOffsets = [];
              let offset = path[0] === "/" ? 1 : 0;
              for (let p = 0; p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path.slice(partOffsets[i]);
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (m[0].length === restPathString.length && child.#children["*"]) this.#pushHandlerSets(handlerSets, child.#children["*"], method, node.#params, params);
              for (const _ in child.#children) {
                child.#params = params;
                const componentCount = m[0].match(/\//g)?.length ?? 0;
                (curNodesQueue[componentCount] ||= []).push(child);
                break;
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
              if (child.#children["*"]) this.#pushHandlerSets(handlerSets, child.#children["*"], method, params, node.#params);
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      const shifted = curNodesQueue.shift();
      curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
    }
    if (handlerSets[1]) handlerSets.sort((a, b) => {
      return a.score - b.score;
    });
    return [handlerSets.map(({ handler: handler2, params }) => [handler2, params])];
  }
};

// node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  name = "TrieRouter";
  #node = new Node3();
  add(method, path, handler2) {
    for (const result of checkOptionalParameter(path) || [path]) this.#node.insert(method, result, handler2);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// node_modules/hono/dist/hono.js
var Hono3 = class extends Hono {
  /**
  * Creates an instance of the Hono class.
  *
  * @param options - Optional configuration options for the Hono instance.
  */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({ routers: [new RegExpRouter(), new TrieRouter()] });
  }
};

// packages/game/src/catalog-buildings.ts
var BUILDINGS = {
  metalMine: {
    id: "metalMine",
    name: "Ore Extractor",
    description: "Pulls metal from the crust. Needs energy.",
    baseCost: { metal: 60, crystal: 15, deuterium: 0 },
    costGrowth: 1.5,
    baseBuildSeconds: 8,
    energyUsePerLevel: 10,
    produces: "metal"
  },
  crystalMine: {
    id: "crystalMine",
    name: "Crystal Lattice",
    description: "Grows crystal veins. Needs energy.",
    baseCost: { metal: 48, crystal: 24, deuterium: 0 },
    costGrowth: 1.6,
    baseBuildSeconds: 10,
    energyUsePerLevel: 12,
    produces: "crystal"
  },
  deutSynth: {
    id: "deutSynth",
    name: "Deut Still",
    description: "Condenses deuterium from the atmosphere. Needs energy.",
    baseCost: { metal: 225, crystal: 75, deuterium: 0 },
    costGrowth: 1.5,
    baseBuildSeconds: 12,
    energyUsePerLevel: 20,
    produces: "deuterium"
  },
  solarPlant: {
    id: "solarPlant",
    name: "Solar Array",
    description: "Produces energy for mines and industry.",
    baseCost: { metal: 75, crystal: 30, deuterium: 0 },
    costGrowth: 1.5,
    baseBuildSeconds: 8,
    energyProdFormula: "solar"
  },
  metalStorage: {
    id: "metalStorage",
    name: "Metal Vault",
    description: "Raises metal storage cap.",
    baseCost: { metal: 1e3, crystal: 0, deuterium: 0 },
    costGrowth: 2,
    baseBuildSeconds: 6
  },
  crystalStorage: {
    id: "crystalStorage",
    name: "Crystal Vault",
    description: "Raises crystal storage cap.",
    baseCost: { metal: 1e3, crystal: 500, deuterium: 0 },
    costGrowth: 2,
    baseBuildSeconds: 6
  },
  deutTank: {
    id: "deutTank",
    name: "Deut Tank",
    description: "Raises deuterium storage cap.",
    baseCost: { metal: 1e3, crystal: 1e3, deuterium: 0 },
    costGrowth: 2,
    baseBuildSeconds: 6
  },
  shipyard: {
    id: "shipyard",
    name: "Shipyard",
    description: "Unlocks and speeds hull construction.",
    // Metal/crystal only at L1 so the ships path is reachable before Deut Still.
    baseCost: { metal: 300, crystal: 150, deuterium: 0 },
    costGrowth: 2,
    baseBuildSeconds: 20
  },
  researchLab: {
    id: "researchLab",
    name: "Research Lab",
    description: "Unlocks empire-wide research. One project at a time.",
    // Metal/crystal only so mines-first sessions unlock research before Deut Still.
    baseCost: { metal: 180, crystal: 120, deuterium: 0 },
    costGrowth: 2,
    baseBuildSeconds: 18
  },
  lunarBase: {
    id: "lunarBase",
    name: "Lunar Base",
    description: "Expands moon fields so more lunar structures can be built.",
    baseCost: { metal: 2e3, crystal: 4e3, deuterium: 0 },
    costGrowth: 2,
    baseBuildSeconds: 30
  },
  sensorArray: {
    id: "sensorArray",
    name: "Sensor Phalanx",
    description: "Scans nearby systems for outbound fleets headed this way (moon only). Range grows with level.",
    baseCost: { metal: 4e3, crystal: 8e3, deuterium: 2e3 },
    costGrowth: 2,
    baseBuildSeconds: 40
  },
  jumpGate: {
    id: "jumpGate",
    name: "Jump Gate",
    description: "Links your moons for near-instant fleet hops. Both moons need a Jump Gate (moon only).",
    baseCost: { metal: 8e3, crystal: 16e3, deuterium: 8e3 },
    costGrowth: 2,
    baseBuildSeconds: 60
  }
};

// packages/game/src/catalog-units.ts
var SHIPS = {
  scout: {
    id: "scout",
    name: "Scout Skiff",
    description: "Fast recon hull. Light guns, tiny cargo.",
    cost: { metal: 220, crystal: 80, deuterium: 0 },
    buildSeconds: 15,
    shipyardLevel: 1,
    cargo: 50,
    attack: 8,
    shield: 4,
    hull: 20,
    speed: 12e3,
    fuelPerDistance: 0.2
  },
  hauler: {
    id: "hauler",
    name: "Ore Hauler",
    description: "Bulk cargo for loot and transport runs.",
    cost: { metal: 480, crystal: 480, deuterium: 0 },
    buildSeconds: 25,
    shipyardLevel: 2,
    cargo: 5e3,
    attack: 4,
    shield: 10,
    hull: 60,
    speed: 6e3,
    fuelPerDistance: 0.8
  },
  interceptor: {
    id: "interceptor",
    name: "Interceptor",
    description: "Light combat hull \u2014 main raid striker.",
    cost: { metal: 900, crystal: 250, deuterium: 0 },
    buildSeconds: 40,
    shipyardLevel: 3,
    cargo: 100,
    attack: 40,
    shield: 16,
    hull: 50,
    speed: 9e3,
    fuelPerDistance: 0.5
  },
  cruiser: {
    id: "cruiser",
    name: "Aegis Cruiser",
    description: "Mid-weight combat hull \u2014 tougher line ship for contested raids.",
    cost: { metal: 2400, crystal: 1e3, deuterium: 200 },
    buildSeconds: 70,
    shipyardLevel: 4,
    cargo: 400,
    attack: 90,
    shield: 50,
    hull: 180,
    speed: 5e3,
    fuelPerDistance: 1.5
  },
  bomber: {
    id: "bomber",
    name: "Breach Bomber",
    description: "Heavy gunship \u2014 high attack, slow cruise, deut-hungry.",
    cost: { metal: 3200, crystal: 1800, deuterium: 400 },
    buildSeconds: 95,
    shipyardLevel: 5,
    cargo: 80,
    attack: 160,
    shield: 20,
    hull: 90,
    speed: 3500,
    fuelPerDistance: 2
  },
  probe: {
    id: "probe",
    name: "Spy Probe",
    description: "Disposable sensor drone for espionage missions.",
    cost: { metal: 0, crystal: 100, deuterium: 0 },
    buildSeconds: 8,
    shipyardLevel: 1,
    cargo: 5,
    attack: 0,
    shield: 0,
    hull: 5,
    speed: 1e5,
    fuelPerDistance: 0.05
  },
  recycler: {
    id: "recycler",
    name: "Recycler",
    description: "Harvests metal and crystal from debris fields.",
    cost: { metal: 400, crystal: 200, deuterium: 100 },
    buildSeconds: 30,
    shipyardLevel: 2,
    cargo: 2e4,
    attack: 2,
    shield: 8,
    hull: 40,
    speed: 4e3,
    fuelPerDistance: 1
  },
  colonyShip: {
    id: "colonyShip",
    name: "Colony Ship",
    description: "Found a new outpost on an empty planet slot. Consumed on landing.",
    cost: { metal: 800, crystal: 800, deuterium: 200 },
    buildSeconds: 50,
    shipyardLevel: 2,
    cargo: 500,
    attack: 0,
    shield: 20,
    hull: 100,
    speed: 3e3,
    fuelPerDistance: 1.2
  }
};
var DEFENSES = {
  laserBattery: {
    id: "laserBattery",
    name: "Laser Battery",
    description: "Static guns that fight with the hangar on raids.",
    cost: { metal: 150, crystal: 50, deuterium: 0 },
    buildSeconds: 10,
    shipyardLevel: 1,
    attack: 16,
    shield: 4,
    hull: 30
  },
  shieldDome: {
    id: "shieldDome",
    name: "Shield Dome",
    description: "Planetary shield \u2014 soaks fire, low attack.",
    cost: { metal: 500, crystal: 300, deuterium: 0 },
    buildSeconds: 25,
    shipyardLevel: 2,
    attack: 2,
    shield: 80,
    hull: 100
  }
};

// packages/game/src/catalog-research.ts
var RESEARCH = {
  energyTech: {
    id: "energyTech",
    name: "Energy Tech",
    description: "+2% mine output per level (energy discipline).",
    baseCost: { metal: 0, crystal: 80, deuterium: 40 },
    costGrowth: 2,
    baseResearchSeconds: 20,
    labLevel: 1
  },
  combustionDrive: {
    id: "combustionDrive",
    name: "Combustion Drive",
    description: "+10% fleet cruise speed per level.",
    baseCost: { metal: 40, crystal: 0, deuterium: 60 },
    costGrowth: 2,
    baseResearchSeconds: 22,
    labLevel: 1
  },
  weaponsTech: {
    id: "weaponsTech",
    name: "Weapons Tech",
    description: "+8% ship/defense attack per level.",
    baseCost: { metal: 80, crystal: 20, deuterium: 0 },
    costGrowth: 2,
    baseResearchSeconds: 24,
    labLevel: 1
  },
  armourTech: {
    id: "armourTech",
    name: "Armour Tech",
    description: "+8% hull integrity per level.",
    baseCost: { metal: 100, crystal: 0, deuterium: 0 },
    costGrowth: 2,
    baseResearchSeconds: 24,
    labLevel: 1
  },
  shieldingTech: {
    id: "shieldingTech",
    name: "Shielding Tech",
    description: "+8% shields per level.",
    baseCost: { metal: 20, crystal: 60, deuterium: 0 },
    costGrowth: 2,
    baseResearchSeconds: 24,
    labLevel: 2
  },
  espionageTech: {
    id: "espionageTech",
    name: "Espionage Tech",
    description: "Deeper spy reports vs rival counter-intel.",
    baseCost: { metal: 20, crystal: 100, deuterium: 20 },
    costGrowth: 2,
    baseResearchSeconds: 20,
    labLevel: 1
  },
  astrophysics: {
    id: "astrophysics",
    name: "Astrophysics",
    description: "Each level allows +1 colony (beyond home) and +1 concurrent expedition.",
    baseCost: { metal: 40, crystal: 80, deuterium: 40 },
    costGrowth: 1.8,
    baseResearchSeconds: 30,
    labLevel: 1
  },
  computerTech: {
    id: "computerTech",
    name: "Computer Tech",
    description: "Each level allows +1 simultaneous fleet mission (base 1).",
    baseCost: { metal: 0, crystal: 40, deuterium: 80 },
    costGrowth: 2,
    baseResearchSeconds: 22,
    labLevel: 1
  }
};

// packages/game/src/catalog-rapid-fire.ts
var RAPID_FIRE = {
  scout: { probe: 2 },
  interceptor: { probe: 5, scout: 2 },
  cruiser: { hauler: 3, probe: 4 },
  bomber: { laserBattery: 4, scout: 2 }
};
function rapidFireFactor(firer, target) {
  const n = RAPID_FIRE[firer]?.[target] ?? 1;
  return n >= 1 ? n : 1;
}

// packages/game/src/catalog-officers.ts
var OFFICER_DURATION_MS = 7 * 24 * 60 * 60 * 1e3;
var OFFICER_ORDER = [
  "quartermaster",
  "archivist",
  "navigator",
  "warden",
  "engineer",
  "spymaster"
];
var OFFICERS = {
  quartermaster: {
    id: "quartermaster",
    name: "Quartermaster",
    description: "Boosts mine output while on duty.",
    cost: 50,
    durationMs: OFFICER_DURATION_MS,
    effects: [{ kind: "mineOutput", value: 1.1 }]
  },
  archivist: {
    id: "archivist",
    name: "Archivist",
    description: "Speeds empire research projects.",
    cost: 50,
    durationMs: OFFICER_DURATION_MS,
    effects: [{ kind: "researchSpeed", value: 1.15 }]
  },
  navigator: {
    id: "navigator",
    name: "Navigator",
    description: "Faster fleets and one extra fleet slot.",
    cost: 60,
    durationMs: OFFICER_DURATION_MS,
    effects: [
      { kind: "fleetSpeed", value: 1.1 },
      { kind: "fleetSlots", value: 1 }
    ]
  },
  warden: {
    id: "warden",
    name: "Warden",
    description: "Hardens planetary defenses in combat.",
    cost: 60,
    durationMs: OFFICER_DURATION_MS,
    effects: [{ kind: "defensePower", value: 1.15 }]
  },
  engineer: {
    id: "engineer",
    name: "Engineer",
    description: "Increases solar / energy output.",
    cost: 40,
    durationMs: OFFICER_DURATION_MS,
    effects: [{ kind: "energyOutput", value: 1.15 }]
  },
  spymaster: {
    id: "spymaster",
    name: "Spymaster",
    description: "Raises espionage detail floor.",
    cost: 70,
    durationMs: OFFICER_DURATION_MS,
    effects: [{ kind: "espionageLevel", value: 1 }]
  }
};

// packages/game/src/catalog-skills.ts
var SKILL_ORDER = [
  "eco_mines_1",
  "eco_energy_1",
  "eco_mines_2",
  "eco_capstone",
  "mil_fleet_1",
  "mil_slots_1",
  "mil_def_1",
  "mil_capstone",
  "exp_spy_1",
  "exp_research_1",
  "exp_spy_2",
  "exp_capstone"
];
var SKILLS = {
  eco_mines_1: {
    id: "eco_mines_1",
    branch: "economy",
    name: "Strip Mining I",
    description: "Permanent +5% mine output.",
    cost: 25,
    requires: [],
    effects: [{ kind: "mineOutput", value: 1.05 }]
  },
  eco_energy_1: {
    id: "eco_energy_1",
    branch: "economy",
    name: "Grid Tuning I",
    description: "Permanent +5% energy output.",
    cost: 25,
    requires: [],
    effects: [{ kind: "energyOutput", value: 1.05 }]
  },
  eco_mines_2: {
    id: "eco_mines_2",
    branch: "economy",
    name: "Strip Mining II",
    description: "Further +5% mine output.",
    cost: 40,
    requires: ["eco_mines_1"],
    effects: [{ kind: "mineOutput", value: 1.05 }]
  },
  eco_capstone: {
    id: "eco_capstone",
    branch: "economy",
    name: "Industrial Doctrine",
    description: "Capstone: +5% mines and +5% energy.",
    cost: 60,
    requires: ["eco_mines_2", "eco_energy_1"],
    effects: [
      { kind: "mineOutput", value: 1.05 },
      { kind: "energyOutput", value: 1.05 }
    ]
  },
  mil_fleet_1: {
    id: "mil_fleet_1",
    branch: "military",
    name: "Warp Discipline I",
    description: "Permanent +5% fleet speed.",
    cost: 25,
    requires: [],
    effects: [{ kind: "fleetSpeed", value: 1.05 }]
  },
  mil_slots_1: {
    id: "mil_slots_1",
    branch: "military",
    name: "Command Bandwidth",
    description: "Permanent +1 fleet slot.",
    cost: 25,
    requires: [],
    effects: [{ kind: "fleetSlots", value: 1 }]
  },
  mil_def_1: {
    id: "mil_def_1",
    branch: "military",
    name: "Hardened Emplacements",
    description: "Permanent +5% defense power.",
    cost: 40,
    requires: ["mil_fleet_1"],
    effects: [{ kind: "defensePower", value: 1.05 }]
  },
  mil_capstone: {
    id: "mil_capstone",
    branch: "military",
    name: "War College",
    description: "Capstone: +5% fleet speed and defense.",
    cost: 60,
    requires: ["mil_def_1", "mil_slots_1"],
    effects: [
      { kind: "fleetSpeed", value: 1.05 },
      { kind: "defensePower", value: 1.05 }
    ]
  },
  exp_spy_1: {
    id: "exp_spy_1",
    branch: "exploration",
    name: "Sensor Craft I",
    description: "Permanent +1 espionage detail.",
    cost: 25,
    requires: [],
    effects: [{ kind: "espionageLevel", value: 1 }]
  },
  exp_research_1: {
    id: "exp_research_1",
    branch: "exploration",
    name: "Archive Protocols",
    description: "Permanent +5% research speed.",
    cost: 25,
    requires: [],
    effects: [{ kind: "researchSpeed", value: 1.05 }]
  },
  exp_spy_2: {
    id: "exp_spy_2",
    branch: "exploration",
    name: "Sensor Craft II",
    description: "Further +1 espionage detail.",
    cost: 40,
    requires: ["exp_spy_1"],
    effects: [{ kind: "espionageLevel", value: 1 }]
  },
  exp_capstone: {
    id: "exp_capstone",
    branch: "exploration",
    name: "Deep Survey Corps",
    description: "Capstone: +10% research speed.",
    cost: 60,
    requires: ["exp_spy_2", "exp_research_1"],
    effects: [{ kind: "researchSpeed", value: 1.1 }]
  }
};

// packages/game/src/catalog.ts
var STARSHARDS_DAILY_LOGIN = 15;
var STARSHARDS_HIGHSCORE_TOP3 = 50;
var MAX_COMBAT_ROUNDS = 6;
var RAID_LOOT_SHARE = 0.5;
var DEBRIS_FROM_SHIPS = 0.3;
var MIN_FLIGHT_SECONDS = 8;
var FIELD_BAND = 15;
var FIELD_MIN = 250;
var FIELD_CENTER_BY_SLOT = {
  1: 265,
  2: 290,
  3: 315,
  4: 335,
  5: 350,
  6: 362,
  7: 372,
  8: 385,
  9: 372,
  10: 362,
  11: 350,
  12: 335,
  13: 315,
  14: 290,
  15: 265
};
var MOON_FIELDS_BASE = 1;
var MOON_FIELDS_PER_LUNAR_BASE = 3;
var MOON_DEBRIS_MIN = 5e3;
var MOON_CHANCE_CAP = 20;
var SPY_REPORT_TTL_MS = 20 * 60 * 1e3;
var PLANET_BUILDING_ORDER = [
  "metalMine",
  "crystalMine",
  "deutSynth",
  "solarPlant",
  "metalStorage",
  "crystalStorage",
  "deutTank",
  "shipyard",
  "researchLab"
];
var MOON_BUILDING_ORDER = [
  "lunarBase",
  "sensorArray",
  "jumpGate",
  "solarPlant",
  "metalStorage",
  "crystalStorage",
  "deutTank",
  "shipyard"
];
var SHIP_ORDER = [
  "scout",
  "hauler",
  "interceptor",
  "cruiser",
  "bomber",
  "probe",
  "recycler",
  "colonyShip"
];
var DEFENSE_ORDER = ["laserBattery", "shieldDome"];
var STARTING_RESOURCES = {
  metal: 500,
  crystal: 500,
  /** Enough for a few early fleet launches before Deut Still comes online. */
  deuterium: 100
};
var PRODUCTION_MULT = 4;
var MINE_BASE_PER_HOUR = {
  metal: 30,
  crystal: 20,
  deuterium: 10
};
var MINE_GROWTH = 1.1;
var MAP_GALAXIES = 10;
var MAP_SYSTEMS = 399;
var MAP_SLOTS = 15;
var DEEP_SPACE_SLOT = 16;
var EXPEDITION_SLOT = DEEP_SPACE_SLOT;
var UNIVERSE_SCHEMA_VERSION = 3;
var HOME_SLOT_PREFERENCE = [
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  3,
  13,
  2,
  14,
  1,
  15
];
var ASTEROID_COUNT_WEIGHTS = [
  { count: 0, weight: 70 },
  { count: 1, weight: 25 },
  { count: 2, weight: 5 }
];
var ASTEROID_RICHNESS = 3;
var SLOT_PRODUCTION_MULT = {
  1: { metal: 1, crystal: 1.3, deuterium: 0.7, energy: 1.3 },
  2: { metal: 1, crystal: 1.25, deuterium: 0.75, energy: 1.25 },
  3: { metal: 1, crystal: 1.2, deuterium: 0.8, energy: 1.2 },
  4: { metal: 1, crystal: 1.15, deuterium: 0.85, energy: 1.15 },
  5: { metal: 1, crystal: 1.1, deuterium: 0.9, energy: 1.1 },
  6: { metal: 1, crystal: 1.05, deuterium: 0.95, energy: 1.05 },
  7: { metal: 1, crystal: 1.02, deuterium: 0.98, energy: 1.02 },
  8: { metal: 1, crystal: 1, deuterium: 1, energy: 1 },
  9: { metal: 1, crystal: 0.98, deuterium: 1.02, energy: 0.98 },
  10: { metal: 1, crystal: 0.95, deuterium: 1.05, energy: 0.95 },
  11: { metal: 1, crystal: 0.9, deuterium: 1.1, energy: 0.9 },
  12: { metal: 1, crystal: 0.85, deuterium: 1.15, energy: 0.85 },
  13: { metal: 1, crystal: 0.8, deuterium: 1.2, energy: 0.8 },
  14: { metal: 1, crystal: 0.75, deuterium: 1.25, energy: 0.75 },
  15: { metal: 1, crystal: 0.7, deuterium: 1.3, energy: 0.7 }
};
var PIRATE_SYSTEMS_PER_BASE = 40;
var PIRATE_GROWTH_INTERVAL_MS = 6 * 60 * 60 * 1e3;
var PIRATE_TIER_CAP = 8;
var PIRATE_RESPAWN_DELAY_MIN_MS = 12 * 60 * 60 * 1e3;
var PIRATE_RESPAWN_DELAY_MAX_MS = 36 * 60 * 60 * 1e3;
var PIRATE_RAID_INTERVAL_MIN_MS = 8 * 60 * 60 * 1e3;
var PIRATE_RAID_INTERVAL_MAX_MS = 24 * 60 * 60 * 1e3;
var PIRATE_DESTROY_STARSHARDS_BASE = 40;
var PIRATE_DESTROY_STARSHARDS_PER_TIER = 5;
var PIRATE_DEFENSE_WIN_STARSHARDS = 10;
var PIRATE_RAID_POWER_FACTOR = 1.4;
var PIRATE_RAID_POWER_FLOOR = 40;

// packages/game/src/formulas-position.ts
function hashSeed(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
var NEUTRAL_MULT = {
  metal: 1,
  crystal: 1,
  deuterium: 1,
  energy: 1
};
function productionMultForSlot(slot) {
  const row = SLOT_PRODUCTION_MULT[slot];
  if (!row) return { ...NEUTRAL_MULT };
  return { ...row };
}
function rollPlanetFields(slot, seed) {
  const center = FIELD_CENTER_BY_SLOT[slot] ?? FIELD_CENTER_BY_SLOT[8];
  const span = FIELD_BAND * 2 + 1;
  const offset = hashSeed(seed) % span - FIELD_BAND;
  return Math.max(FIELD_MIN, center + offset);
}

// packages/game/src/formulas-build.ts
function isMoon(planet) {
  return planet.kind === "moon";
}
function buildingAllowedOn(planet, buildingId) {
  const order2 = isMoon(planet) ? MOON_BUILDING_ORDER : PLANET_BUILDING_ORDER;
  return order2.includes(buildingId);
}
function fieldsCap(planet) {
  if (isMoon(planet)) {
    const lunar = planet.buildings.lunarBase ?? 0;
    return MOON_FIELDS_BASE + lunar * MOON_FIELDS_PER_LUNAR_BASE;
  }
  if (typeof planet.fieldsCap === "number" && planet.fieldsCap > 0) {
    return planet.fieldsCap;
  }
  return rollPlanetFields(
    planet.coords.slot,
    `${planet.id}:${planet.coords.galaxy}:${planet.coords.system}:${planet.coords.slot}`
  );
}
function buildingUpgradeCost(buildingId, currentLevel) {
  const def = BUILDINGS[buildingId];
  const factor = Math.pow(def.costGrowth, currentLevel);
  return {
    metal: Math.floor(def.baseCost.metal * factor),
    crystal: Math.floor(def.baseCost.crystal * factor),
    deuterium: Math.floor(def.baseCost.deuterium * factor)
  };
}
function buildingUpgradeSeconds(buildingId, currentLevel) {
  const def = BUILDINGS[buildingId];
  return Math.max(
    1,
    Math.floor(def.baseBuildSeconds * Math.pow(def.costGrowth, currentLevel))
  );
}
function shipCost(shipId, count) {
  const def = SHIPS[shipId];
  return {
    metal: def.cost.metal * count,
    crystal: def.cost.crystal * count,
    deuterium: def.cost.deuterium * count
  };
}
function shipBuildSeconds(shipId, count, shipyardLevel) {
  const def = SHIPS[shipId];
  const speedFactor = 1 + Math.max(0, shipyardLevel - 1) * 0.1;
  return Math.max(1, Math.ceil(def.buildSeconds * count / speedFactor));
}
function defenseCost(defenseId, count) {
  const def = DEFENSES[defenseId];
  return {
    metal: def.cost.metal * count,
    crystal: def.cost.crystal * count,
    deuterium: def.cost.deuterium * count
  };
}
function defenseBuildSeconds(defenseId, count, shipyardLevel) {
  const def = DEFENSES[defenseId];
  const speedFactor = 1 + Math.max(0, shipyardLevel - 1) * 0.1;
  return Math.max(1, Math.ceil(def.buildSeconds * count / speedFactor));
}
function researchUpgradeCost(researchId, currentLevel) {
  const def = RESEARCH[researchId];
  const factor = Math.pow(def.costGrowth, currentLevel);
  return {
    metal: Math.floor(def.baseCost.metal * factor),
    crystal: Math.floor(def.baseCost.crystal * factor),
    deuterium: Math.floor(def.baseCost.deuterium * factor)
  };
}
function researchUpgradeSeconds(researchId, currentLevel, labLevel) {
  const def = RESEARCH[researchId];
  const labFactor = 1 + Math.max(0, labLevel - 1) * 0.15;
  return Math.max(
    1,
    Math.floor(
      def.baseResearchSeconds * Math.pow(def.costGrowth, currentLevel) / labFactor
    )
  );
}
function storageCap(level) {
  return Math.floor(1e4 * Math.pow(2, level));
}
function mineOutputPerHour(resource, level) {
  if (level <= 0) return 0;
  return Math.floor(
    MINE_BASE_PER_HOUR[resource] * level * Math.pow(MINE_GROWTH, level)
  );
}
function solarEnergy(level) {
  if (level <= 0) return 0;
  return Math.floor(20 * level * Math.pow(1.1, level));
}
function energyUsed(planet) {
  let used = 0;
  for (const [id, def] of Object.entries(BUILDINGS)) {
    if (!def.energyUsePerLevel) continue;
    const level = planet.buildings[id] ?? 0;
    used += def.energyUsePerLevel * level;
  }
  return used;
}
function energyProduced(planet, energyOutputMult = 1) {
  const base = solarEnergy(planet.buildings.solarPlant ?? 0);
  const mult = productionMultForSlot(planet.coords.slot).energy;
  return Math.floor(base * mult * Math.max(0, energyOutputMult));
}
function energyFactor(planet, energyOutputMult = 1) {
  const used = energyUsed(planet);
  if (used <= 0) return 1;
  const produced = energyProduced(planet, energyOutputMult);
  return Math.min(1, produced / used);
}
function storageFor(planet) {
  return {
    metal: storageCap(planet.buildings.metalStorage ?? 0),
    crystal: storageCap(planet.buildings.crystalStorage ?? 0),
    deuterium: storageCap(planet.buildings.deutTank ?? 0)
  };
}
function fieldsUsed(planet) {
  let used = 0;
  for (const level of Object.values(planet.buildings)) {
    used += level;
  }
  return used;
}
function fieldsRemaining(planet) {
  return Math.max(0, fieldsCap(planet) - fieldsUsed(planet));
}
function productionPerHour(planet, universeSpeed = 1, energyTechLevel = 0, boosts) {
  const energyMult = boosts?.energyOutput ?? 1;
  const mineMult = boosts?.mineOutput ?? 1;
  const factor = energyFactor(planet, energyMult);
  const techBonus = 1 + energyTechLevel * 0.02;
  const incomeScale = universeSpeed * PRODUCTION_MULT * techBonus * mineMult;
  const pos = productionMultForSlot(planet.coords.slot);
  return {
    metal: mineOutputPerHour("metal", planet.buildings.metalMine ?? 0) * factor * incomeScale * pos.metal,
    crystal: mineOutputPerHour("crystal", planet.buildings.crystalMine ?? 0) * factor * incomeScale * pos.crystal,
    deuterium: mineOutputPerHour("deuterium", planet.buildings.deutSynth ?? 0) * factor * incomeScale * pos.deuterium
  };
}
function canAfford(have, cost) {
  return Math.floor(have.metal) >= cost.metal && Math.floor(have.crystal) >= cost.crystal && Math.floor(have.deuterium) >= cost.deuterium;
}
function spend(have, cost) {
  return {
    metal: have.metal - cost.metal,
    crystal: have.crystal - cost.crystal,
    deuterium: have.deuterium - cost.deuterium
  };
}

// packages/game/src/formulas-travel.ts
function clampToStorage(resources, caps) {
  return {
    metal: Math.min(resources.metal, caps.metal),
    crystal: Math.min(resources.crystal, caps.crystal),
    deuterium: Math.min(resources.deuterium, caps.deuterium)
  };
}
function emptyResearch() {
  return {
    energyTech: 0,
    combustionDrive: 0,
    weaponsTech: 0,
    armourTech: 0,
    shieldingTech: 0,
    espionageTech: 0,
    astrophysics: 0,
    computerTech: 0
  };
}
function emptyDefenses() {
  const out = {};
  for (const id of DEFENSE_ORDER) out[id] = 0;
  return out;
}
function shipStockPoints(ships) {
  let points = 0;
  for (const [id, count] of Object.entries(ships)) {
    if (!count) continue;
    const c = SHIPS[id].cost;
    points += (c.metal + c.crystal + c.deuterium) * count / 1e3;
  }
  return points;
}
function planetPoints(planet) {
  let points = 0;
  for (const [id, level] of Object.entries(planet.buildings)) {
    for (let L = 0; L < level; L++) {
      const c = buildingUpgradeCost(id, L);
      points += (c.metal + c.crystal + c.deuterium) / 1e3;
    }
  }
  points += shipStockPoints(planet.ships);
  for (const [id, count] of Object.entries(planet.defenses ?? {})) {
    const c = DEFENSES[id].cost;
    points += (c.metal + c.crystal + c.deuterium) * count / 1e3;
  }
  return points;
}
function researchPoints(research) {
  let points = 0;
  for (const [id, level] of Object.entries(research)) {
    for (let L = 0; L < level; L++) {
      const c = researchUpgradeCost(id, L);
      points += (c.metal + c.crystal + c.deuterium) / 1e3;
    }
  }
  return points;
}
function economySnapshot(planet, universeSpeed = 1, energyTechLevel = 0, boosts) {
  const used = fieldsUsed(planet);
  const energyMult = boosts?.energyOutput ?? 1;
  return {
    productionPerHour: productionPerHour(
      planet,
      universeSpeed,
      energyTechLevel,
      boosts
    ),
    energy: {
      produced: energyProduced(planet, energyMult),
      used: energyUsed(planet),
      factor: energyFactor(planet, energyMult)
    },
    storage: storageFor(planet),
    fields: {
      used,
      cap: fieldsCap(planet),
      remaining: fieldsRemaining(planet)
    },
    positionMult: productionMultForSlot(planet.coords.slot)
  };
}
function emptyFleetShips() {
  const out = {};
  for (const id of SHIP_ORDER) out[id] = 0;
  return out;
}
function normalizeFleetShips(ships) {
  const out = emptyFleetShips();
  for (const id of SHIP_ORDER) {
    out[id] = Math.max(0, Math.floor(ships[id] ?? 0));
  }
  return out;
}
function fleetShipCount(ships) {
  let n = 0;
  for (const id of SHIP_ORDER) n += ships[id] ?? 0;
  return n;
}
function fleetCargoCapacity(ships) {
  let cap = 0;
  for (const id of SHIP_ORDER) {
    cap += (ships[id] ?? 0) * SHIPS[id].cargo;
  }
  return cap;
}
function coordDistance(a, b) {
  return Math.abs(a.galaxy - b.galaxy) * 100 + Math.abs(a.system - b.system) * 10 + Math.abs(a.slot - b.slot);
}
function coordsKey(c) {
  return `${c.galaxy}:${c.system}:${c.slot}`;
}
function fleetCruiseSpeed(ships) {
  let min = Infinity;
  for (const id of SHIP_ORDER) {
    const n = ships[id] ?? 0;
    if (n > 0) min = Math.min(min, SHIPS[id].speed);
  }
  return Number.isFinite(min) ? min : 1;
}
function flightSecondsOneWay(origin, target, ships, fleetSpeed, combustionDriveLevel = 0) {
  const distance = Math.max(1, coordDistance(origin, target));
  const cruise = fleetCruiseSpeed(ships) * (1 + combustionDriveLevel * 0.1);
  const raw2 = Math.ceil(
    distance * 1e6 / (cruise * Math.max(0.1, fleetSpeed))
  );
  return Math.max(MIN_FLIGHT_SECONDS, raw2);
}
function fuelCostOneWay(origin, target, ships) {
  const distance = Math.max(1, coordDistance(origin, target));
  let fuel = 0;
  for (const id of SHIP_ORDER) {
    fuel += (ships[id] ?? 0) * SHIPS[id].fuelPerDistance * distance;
  }
  return Math.max(1, Math.ceil(fuel));
}

// packages/game/src/formulas-combat.ts
function unitCombatPower(attack, shield, hull, research) {
  const w = 1 + (research?.weaponsTech ?? 0) * 0.08;
  const s = 1 + (research?.shieldingTech ?? 0) * 0.08;
  const a = 1 + (research?.armourTech ?? 0) * 0.08;
  return attack * w + 0.5 * shield * s + 0.3 * hull * a;
}
function unitAtk(attack, research) {
  return attack * (1 + (research?.weaponsTech ?? 0) * 0.08);
}
function unitHp(shield, hull, research) {
  const s = shield * (1 + (research?.shieldingTech ?? 0) * 0.08);
  const h = hull * (1 + (research?.armourTech ?? 0) * 0.08);
  return Math.max(1, s + h);
}
function fleetCombatPower(ships, research) {
  let power = 0;
  for (const id of SHIP_ORDER) {
    const n = ships[id] ?? 0;
    if (n <= 0) continue;
    const d = SHIPS[id];
    power += n * unitCombatPower(d.attack, d.shield, d.hull, research);
  }
  return power;
}
function defenseCombatPower(defenses, research) {
  let power = 0;
  for (const id of DEFENSE_ORDER) {
    const n = defenses[id] ?? 0;
    if (n <= 0) continue;
    const d = DEFENSES[id];
    power += n * unitCombatPower(d.attack, d.shield, d.hull, research);
  }
  return power;
}
function destroyedShipResources(before, after) {
  let metal = 0;
  let crystal = 0;
  for (const id of SHIP_ORDER) {
    const lost = Math.max(0, (before[id] ?? 0) - (after[id] ?? 0));
    if (lost <= 0) continue;
    const c = SHIPS[id].cost;
    metal += c.metal * lost;
    crystal += c.crystal * lost;
  }
  return { metal, crystal, deuterium: 0 };
}
function debrisFromDestroyed(destroyed) {
  return {
    metal: Math.floor(destroyed.metal * DEBRIS_FROM_SHIPS),
    crystal: Math.floor(destroyed.crystal * DEBRIS_FROM_SHIPS),
    deuterium: 0
  };
}
function shipCount(ships) {
  let n = 0;
  for (const id of SHIP_ORDER) n += ships[id] ?? 0;
  return n;
}
function defenseCount(defenses) {
  let n = 0;
  for (const id of DEFENSE_ORDER) n += defenses[id] ?? 0;
  return n;
}
function livingShipIds(ships) {
  return SHIP_ORDER.filter((id) => (ships[id] ?? 0) > 0);
}
function livingDefenseIds(defenses) {
  return DEFENSE_ORDER.filter((id) => (defenses[id] ?? 0) > 0);
}
function pickFocusTarget(ships, defenses) {
  let best = null;
  let bestCount = 0;
  for (const id of SHIP_ORDER) {
    const n = ships[id] ?? 0;
    if (n > bestCount) {
      best = id;
      bestCount = n;
    }
  }
  for (const id of DEFENSE_ORDER) {
    const n = defenses[id] ?? 0;
    if (n > bestCount) {
      best = id;
      bestCount = n;
    }
  }
  return best;
}
function targetHp(id, research) {
  if (SHIP_ORDER.includes(id)) {
    const d2 = SHIPS[id];
    return unitHp(d2.shield, d2.hull, research);
  }
  const d = DEFENSES[id];
  return unitHp(d.shield, d.hull, research);
}
function applyDamageToTarget(side, id, damage, research) {
  if (damage <= 0) return;
  const hp = targetHp(id, research);
  const pool = (side.residual[id] ?? 0) + damage;
  const kills = Math.floor(pool / hp);
  const rem = pool - kills * hp;
  side.residual[id] = rem;
  if (kills <= 0) return;
  if (SHIP_ORDER.includes(id)) {
    const sid = id;
    side.ships[sid] = Math.max(0, (side.ships[sid] ?? 0) - kills);
    if (side.ships[sid] === 0) side.residual[id] = 0;
  } else {
    const did = id;
    side.defenses[did] = Math.max(0, (side.defenses[did] ?? 0) - kills);
    if (side.defenses[did] === 0) side.residual[id] = 0;
  }
}
function collectFire(firerShips, firerDefenses, targetShips, targetDefenses, firerResearch) {
  const shots = [];
  const focus = pickFocusTarget(targetShips, targetDefenses);
  if (!focus) return shots;
  for (const id of livingShipIds(firerShips)) {
    const def = SHIPS[id];
    const atk = unitAtk(def.attack, firerResearch);
    if (atk <= 0) continue;
    const n = firerShips[id] ?? 0;
    const rf = rapidFireFactor(id, focus);
    shots.push({ target: focus, damage: n * atk * rf });
  }
  if (firerDefenses) {
    for (const id of livingDefenseIds(firerDefenses)) {
      const def = DEFENSES[id];
      const atk = unitAtk(def.attack, firerResearch);
      if (atk <= 0) continue;
      const n = firerDefenses[id] ?? 0;
      const rf = rapidFireFactor(id, focus);
      shots.push({ target: focus, damage: n * atk * rf });
    }
  }
  return shots;
}
function resolveCombat(attacker, defender, defenses = emptyDefenses(), attackerResearch, defenderResearch, mods) {
  const defensePowerMult = Math.max(0.01, mods?.defensePower ?? 1);
  const atkSide = {
    ships: normalizeFleetShips(attacker),
    defenses: emptyDefenses(),
    residual: {}
  };
  const defSide = {
    ships: normalizeFleetShips(defender),
    defenses: { ...emptyDefenses(), ...defenses },
    residual: {}
  };
  if (shipCount(atkSide.ships) <= 0) {
    return {
      outcome: "defender_win",
      attackerAfter: emptyFleetShips(),
      defenderAfter: defSide.ships,
      defensesAfter: defSide.defenses,
      rounds: 0,
      summary: "No attacking ships."
    };
  }
  if (shipCount(defSide.ships) + defenseCount(defSide.defenses) <= 0) {
    return {
      outcome: "attacker_win",
      attackerAfter: { ...atkSide.ships },
      defenderAfter: emptyFleetShips(),
      defensesAfter: emptyDefenses(),
      rounds: 0,
      summary: "Unopposed landing. Garrison empty."
    };
  }
  let rounds = 0;
  for (let r = 1; r <= MAX_COMBAT_ROUNDS; r++) {
    rounds = r;
    const atkShots = collectFire(
      atkSide.ships,
      null,
      defSide.ships,
      defSide.defenses,
      attackerResearch
    );
    const defShots = collectFire(
      defSide.ships,
      defSide.defenses,
      atkSide.ships,
      emptyDefenses(),
      defenderResearch
    );
    for (const shot of atkShots) {
      applyDamageToTarget(
        defSide,
        shot.target,
        shot.damage / defensePowerMult,
        defenderResearch
      );
    }
    for (const shot of defShots) {
      applyDamageToTarget(
        atkSide,
        shot.target,
        shot.damage * defensePowerMult,
        attackerResearch
      );
    }
    const atkAlive2 = shipCount(atkSide.ships) > 0;
    const defAlive2 = shipCount(defSide.ships) + defenseCount(defSide.defenses) > 0;
    if (!atkAlive2 || !defAlive2) break;
  }
  const atkAlive = shipCount(atkSide.ships) > 0;
  const defAlive = shipCount(defSide.ships) + defenseCount(defSide.defenses) > 0;
  let outcome;
  if (atkAlive && !defAlive) outcome = "attacker_win";
  else if (!atkAlive && defAlive) outcome = "defender_win";
  else if (!atkAlive && !defAlive) outcome = "draw";
  else outcome = "draw";
  const atkPower = fleetCombatPower(atkSide.ships, attackerResearch);
  const defPower = fleetCombatPower(defSide.ships, defenderResearch) + defenseCombatPower(defSide.defenses, defenderResearch);
  return {
    outcome,
    attackerAfter: atkSide.ships,
    defenderAfter: defSide.ships,
    defensesAfter: defSide.defenses,
    rounds,
    summary: `${outcome.split("_").join(" ")} after ${rounds} round${rounds === 1 ? "" : "s"} (surviving power atk ${atkPower.toFixed(0)} / def ${defPower.toFixed(0)}).`
  };
}
function computeRaidLoot(defenderResources, survivingAttacker) {
  const capacity = fleetCargoCapacity(survivingAttacker);
  if (capacity <= 0) {
    return { metal: 0, crystal: 0, deuterium: 0 };
  }
  const available = {
    metal: Math.floor(Math.floor(defenderResources.metal) * RAID_LOOT_SHARE),
    crystal: Math.floor(Math.floor(defenderResources.crystal) * RAID_LOOT_SHARE),
    deuterium: Math.floor(
      Math.floor(defenderResources.deuterium) * RAID_LOOT_SHARE
    )
  };
  let remaining = capacity;
  const loot = { metal: 0, crystal: 0, deuterium: 0 };
  for (const key of ["metal", "crystal", "deuterium"]) {
    const take = Math.min(available[key], remaining);
    loot[key] = take;
    remaining -= take;
  }
  return loot;
}
function espionageDetail(spyTech, targetLabLevel) {
  const score = spyTech - Math.floor(targetLabLevel / 2);
  if (score >= 4) return 3;
  if (score >= 2) return 2;
  if (score >= 0) return 1;
  return 0;
}
function maxFleetSlots(computerTech) {
  return 1 + Math.max(0, computerTech);
}
function maxColonies(astrophysics) {
  return 1 + Math.max(0, astrophysics);
}
function maxExpeditions(astrophysics) {
  return 1 + Math.max(0, astrophysics);
}

// packages/game/src/formulas-progress.ts
function xpToNext(level) {
  const L = Math.max(1, Math.floor(level));
  return Math.floor(100 * Math.pow(L, 1.45));
}
function levelBonuses(level) {
  const n = Math.max(0, Math.floor(level) - 1);
  return {
    production: 1 + 5e-3 * n,
    buildTime: Math.max(0.7, 1 - 4e-3 * n),
    researchTime: Math.max(0.7, 1 - 4e-3 * n),
    fleetTime: Math.max(0.75, 1 - 3e-3 * n),
    shipBuild: Math.max(0.65, 1 - 5e-3 * n),
    weaponsBonus: Math.floor(n / 5),
    shieldingBonus: Math.floor(n / 5)
  };
}
function ensurePlayerProgress(player) {
  if (player.level == null || player.level < 1) player.level = 1;
  if (player.xp == null || player.xp < 0) player.xp = 0;
  if (player.xpTotal == null || player.xpTotal < 0) player.xpTotal = 0;
}
function grantPlayerXp(player, amount) {
  const add = Math.max(0, Math.floor(amount));
  if (add <= 0) return 0;
  ensurePlayerProgress(player);
  let level = player.level ?? 1;
  let xp = player.xp ?? 0;
  let xpTotal = player.xpTotal ?? 0;
  xpTotal += add;
  xp += add;
  let gained = 0;
  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
    gained += 1;
  }
  player.level = level;
  player.xp = xp;
  player.xpTotal = xpTotal;
  return gained;
}
function xpForBuilding(targetLevel) {
  return 8 + 2 * Math.max(1, Math.floor(targetLevel));
}
function xpForResearch(targetLevel) {
  return 12 + 3 * Math.max(1, Math.floor(targetLevel));
}
function xpForCombatWin(destroyedEnemyCost) {
  const bonus = Math.min(200, Math.floor(Math.max(0, destroyedEnemyCost) / 500));
  return 25 + bonus;
}
function xpForCombatLose() {
  return 8;
}
function xpForExpedition() {
  return 15;
}
function xpForPirateBaseDestroy(baseLevel) {
  return 50 + 10 * Math.max(0, Math.floor(baseLevel));
}
function xpForPirateShipKills(destroyedEnemyCost) {
  return Math.min(
    100,
    Math.floor(Math.max(0, destroyedEnemyCost) / 1e3) * 5
  );
}
function resourcesCostTotal(res) {
  return Math.max(0, res.metal) + Math.max(0, res.crystal) + Math.max(0, res.deuterium ?? 0);
}
function effectiveCombatResearch(player) {
  if (!player) return void 0;
  ensurePlayerProgress(player);
  const lb = levelBonuses(player.level ?? 1);
  return {
    ...player.research,
    weaponsTech: (player.research.weaponsTech ?? 0) + lb.weaponsBonus,
    shieldingTech: (player.research.shieldingTech ?? 0) + lb.shieldingBonus
  };
}
function playerProgressView(player) {
  ensurePlayerProgress(player);
  const level = player.level ?? 1;
  const xp = player.xp ?? 0;
  const xpTotal = player.xpTotal ?? 0;
  return {
    level,
    xp,
    xpToNext: xpToNext(level),
    xpTotal
  };
}

// packages/game/src/world-asteroids.ts
function asteroidId(galaxy, system, index) {
  return `ast:${galaxy}:${system}:a${index}`;
}
function rollInRange(seed, min, max) {
  const span = max - min + 1;
  return min + hashSeed(seed) % span;
}
function rollAsteroidCount(universeSeed, galaxy, system) {
  const totalWeight = ASTEROID_COUNT_WEIGHTS.reduce(
    (sum, row) => sum + row.weight,
    0
  );
  let roll = hashSeed(`${universeSeed}:ast-count:${galaxy}:${system}`) % totalWeight;
  for (const row of ASTEROID_COUNT_WEIGHTS) {
    if (roll < row.weight) return row.count;
    roll -= row.weight;
  }
  return 0;
}
function createAsteroidField(universeSeed, galaxy, system, index) {
  const id = asteroidId(galaxy, system, index);
  const richness = ASTEROID_RICHNESS;
  const metalPer = rollInRange(`${universeSeed}:${id}:m`, 2e3, 8e3) * richness;
  const crystalPer = rollInRange(`${universeSeed}:${id}:c`, 1e3, 4e3) * richness;
  const deutPer = rollInRange(`${universeSeed}:${id}:d`, 0, 500) * richness;
  const coords = {
    galaxy,
    system,
    slot: 100 + index
  };
  return {
    id,
    coords,
    metal: metalPer,
    crystal: crystalPer,
    deuterium: deutPer,
    richness
  };
}
function seedUniverseAsteroids(universe) {
  const seed = universe.seed ?? universe.id;
  const asteroids = {};
  for (let galaxy = 1; galaxy <= MAP_GALAXIES; galaxy++) {
    for (let system = 1; system <= MAP_SYSTEMS; system++) {
      const count = rollAsteroidCount(seed, galaxy, system);
      for (let i = 0; i < count; i++) {
        const field = createAsteroidField(seed, galaxy, system, i);
        asteroids[field.id] = field;
      }
    }
  }
  universe.asteroids = asteroids;
}
function asteroidsInSystem(universe, galaxy, system) {
  const out = [];
  for (const field of Object.values(universe.asteroids ?? {})) {
    if (field.coords.galaxy === galaxy && field.coords.system === system) {
      out.push(field);
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
function harvestAsteroidField(universe, asteroidId2, cargoCap) {
  const field = universe.asteroids?.[asteroidId2];
  if (!field || field.richness <= 0 || cargoCap <= 0) {
    return { metal: 0, crystal: 0, deuterium: 0 };
  }
  let remaining = cargoCap;
  const takeMetal = Math.min(field.metal, remaining);
  remaining -= takeMetal;
  const takeCrystal = Math.min(field.crystal, remaining);
  remaining -= takeCrystal;
  const takeDeut = Math.min(field.deuterium, remaining);
  field.metal -= takeMetal;
  field.crystal -= takeCrystal;
  field.deuterium -= takeDeut;
  field.richness -= 1;
  if (field.richness <= 0 || field.metal <= 0 && field.crystal <= 0 && field.deuterium <= 0) {
    delete universe.asteroids[asteroidId2];
  } else {
    universe.asteroids[asteroidId2] = field;
  }
  return { metal: takeMetal, crystal: takeCrystal, deuterium: takeDeut };
}

// packages/game/src/world-boosts.ts
function emptyBoosts() {
  return {
    mineOutput: 1,
    researchSpeed: 1,
    fleetSpeed: 1,
    fleetSlots: 0,
    defensePower: 1,
    energyOutput: 1,
    espionageLevel: 0
  };
}
function applyEffect(boosts, effect) {
  switch (effect.kind) {
    case "mineOutput":
    case "researchSpeed":
    case "fleetSpeed":
    case "defensePower":
    case "energyOutput":
      boosts[effect.kind] *= effect.value;
      break;
    case "fleetSlots":
    case "espionageLevel":
      boosts[effect.kind] += effect.value;
      break;
    default: {
      const _exhaustive = effect.kind;
      throw new Error(`Unhandled effect kind: ${_exhaustive}`);
    }
  }
}
function pruneExpiredOfficers(player, now) {
  const live = (player.officers ?? []).filter((o) => o.expiresAt > now);
  player.officers = live;
  return live;
}
function playerBoosts(player, now) {
  const boosts = emptyBoosts();
  if (!player) return boosts;
  const officers = pruneExpiredOfficers(player, now);
  for (const o of officers) {
    const def = OFFICERS[o.officerId];
    if (!def) continue;
    for (const effect of def.effects) applyEffect(boosts, effect);
  }
  for (const id of player.skillsUnlocked ?? []) {
    const def = SKILLS[id];
    if (!def) continue;
    for (const effect of def.effects) applyEffect(boosts, effect);
  }
  return boosts;
}
function grantStarshards(player, amount) {
  const add = Math.max(0, Math.floor(amount));
  player.starshards = Math.max(0, Math.floor(player.starshards ?? 0) + add);
  return player.starshards;
}
function utcDayKey(now) {
  return new Date(now).toISOString().slice(0, 10);
}
function canClaimDailyLogin(player, now) {
  return player.lastDailyLoginUtc !== utcDayKey(now);
}
function grantPirateDestroyStarshards(player, tier) {
  const t = Math.max(0, Math.floor(tier));
  const amount = PIRATE_DESTROY_STARSHARDS_BASE + PIRATE_DESTROY_STARSHARDS_PER_TIER * t;
  grantStarshards(player, amount);
  return amount;
}
function grantPirateFleetKillStarshards(player) {
  grantStarshards(player, PIRATE_DEFENSE_WIN_STARSHARDS);
  return PIRATE_DEFENSE_WIN_STARSHARDS;
}
function expeditionStarshardsAmount(roll) {
  return 5 + roll % 21;
}

// packages/game/src/world-tick.ts
function advancePlanet(planet, universeSpeed, now, energyTechLevel = 0, boosts, owner) {
  let state = {
    ...planet,
    resources: { ...planet.resources },
    buildings: { ...planet.buildings },
    ships: { ...planet.ships },
    defenses: { ...planet.defenses ?? emptyDefenses() }
  };
  if (state.buildQueue && state.buildQueue.completesAt <= now) {
    const { buildingId, targetLevel } = state.buildQueue;
    state.buildings[buildingId] = targetLevel;
    state.buildQueue = null;
    if (owner) grantPlayerXp(owner, xpForBuilding(targetLevel));
  }
  if (state.shipQueue && state.shipQueue.completesAt <= now) {
    const { shipId, count } = state.shipQueue;
    state.ships[shipId] = (state.ships[shipId] ?? 0) + count;
    state.shipQueue = null;
  }
  if (state.defenseQueue && state.defenseQueue.completesAt <= now) {
    const { defenseId, count } = state.defenseQueue;
    state.defenses[defenseId] = (state.defenses[defenseId] ?? 0) + count;
    state.defenseQueue = null;
  }
  const elapsedMs = Math.max(0, now - state.lastTickAt);
  if (elapsedMs > 0) {
    const rates = productionPerHour(
      state,
      universeSpeed,
      energyTechLevel,
      boosts
    );
    const hours = elapsedMs / 36e5;
    const caps = storageFor(state);
    state.resources = clampToStorage(
      {
        metal: state.resources.metal + rates.metal * hours,
        crystal: state.resources.crystal + rates.crystal * hours,
        deuterium: state.resources.deuterium + rates.deuterium * hours
      },
      caps
    );
    state.lastTickAt = now;
  }
  return state;
}
function advanceResearch(universe, player, now) {
  if (!player.researchQueue || player.researchQueue.completesAt > now) return;
  const { researchId, targetLevel } = player.researchQueue;
  player.research[researchId] = targetLevel;
  player.researchQueue = null;
  grantPlayerXp(player, xpForResearch(targetLevel));
  universe.players[player.id] = player;
}
function addShipsToPlanet(planet, ships) {
  for (const id of SHIP_ORDER) {
    planet.ships[id] = (planet.ships[id] ?? 0) + (ships[id] ?? 0);
  }
}
function addCargoToPlanet(planet, cargo) {
  const caps = storageFor(planet);
  planet.resources = clampToStorage(
    {
      metal: planet.resources.metal + cargo.metal,
      crystal: planet.resources.crystal + cargo.crystal,
      deuterium: planet.resources.deuterium + cargo.deuterium
    },
    caps
  );
}
function subtractCargo(planet, cargo) {
  planet.resources = {
    metal: Math.max(0, planet.resources.metal - cargo.metal),
    crystal: Math.max(0, planet.resources.crystal - cargo.crystal),
    deuterium: Math.max(0, planet.resources.deuterium - cargo.deuterium)
  };
}
function addDebris(universe, coords, add) {
  const key = coordsKey(coords);
  const existing = universe.debris[key];
  if (!existing) {
    if (add.metal <= 0 && add.crystal <= 0) return;
    universe.debris[key] = {
      coords: { ...coords },
      metal: add.metal,
      crystal: add.crystal
    };
    return;
  }
  existing.metal += add.metal;
  existing.crystal += add.crystal;
  if (existing.metal <= 0 && existing.crystal <= 0) {
    delete universe.debris[key];
  }
}
function getDebris(universe, coords) {
  return universe.debris[coordsKey(coords)] ?? null;
}

// packages/game/src/world-pirates.ts
var PIRATE_NAMES = [
  "Black Comet Hold",
  "Corsair Nest",
  "Rogue Drift",
  "Scarlet Wake",
  "Iron Maw Outpost",
  "Void Reaver Camp",
  "Ashen Jolly",
  "Cutlass Beacon"
];
function pirateBaseId(galaxy, system, slot) {
  return `pir:${galaxy}:${system}:${slot}`;
}
function pirateDestroyStarshards(tier) {
  return PIRATE_DESTROY_STARSHARDS_BASE + PIRATE_DESTROY_STARSHARDS_PER_TIER * Math.max(0, Math.floor(tier));
}
function rollInRange2(seed, min, max) {
  const span = max - min + 1;
  return min + hashSeed(seed) % span;
}
function scaleShips(base, factor) {
  const out = emptyFleetShips();
  for (const id of SHIP_ORDER) {
    out[id] = Math.max(0, Math.floor((base[id] ?? 0) * factor));
  }
  if (fleetShipCount(out) < 1 && fleetShipCount(base) > 0) {
    for (const id of SHIP_ORDER) {
      if ((base[id] ?? 0) > 0) {
        out[id] = 1;
        break;
      }
    }
  }
  return out;
}
function pirateShipsForTier(tier) {
  const t = Math.max(0, Math.min(PIRATE_TIER_CAP, Math.floor(tier)));
  const ships = emptyFleetShips();
  ships.scout = 2 + t * 2;
  ships.interceptor = t >= 1 ? t : 0;
  ships.hauler = t >= 2 ? Math.ceil(t / 2) : 0;
  ships.cruiser = t >= 3 ? Math.floor((t - 2) / 2) : 0;
  ships.bomber = t >= 6 ? t - 5 : 0;
  return ships;
}
function pirateResourcesForTier(tier) {
  const t = Math.max(0, Math.floor(tier));
  return {
    metal: 800 + t * 400,
    crystal: 400 + t * 250,
    deuterium: 100 + t * 80
  };
}
function pirateName(seed, galaxy, system) {
  const idx = hashSeed(`${seed}:pname:${galaxy}:${system}`) % PIRATE_NAMES.length;
  return PIRATE_NAMES[idx];
}
function activePirateBases(universe) {
  return Object.values(universe.pirateBases ?? {}).filter(
    (b) => b.destroyedAt == null
  );
}
function pirateBaseAtCoords(universe, coords) {
  return activePirateBases(universe).find(
    (b) => b.coords.galaxy === coords.galaxy && b.coords.system === coords.system && b.coords.slot === coords.slot
  ) ?? null;
}
function systemOccupiedByPirate(universe, galaxy, system, exceptId) {
  return activePirateBases(universe).some(
    (b) => b.id !== exceptId && b.coords.galaxy === galaxy && b.coords.system === system
  );
}
function pickEmptySlot(universe, galaxy, system, seedKey) {
  const start = 1 + hashSeed(seedKey) % MAP_SLOTS;
  for (let i = 0; i < MAP_SLOTS; i++) {
    const slot = (start - 1 + i) % MAP_SLOTS + 1;
    const coords = { galaxy, system, slot };
    if (planetAtCoords(universe, coords)) continue;
    if (pirateBaseAtCoords(universe, coords)) continue;
    return slot;
  }
  return null;
}
function createPirateBase(universeSeed, galaxy, system, slot, now, tier = 0) {
  const id = pirateBaseId(galaxy, system, slot);
  return {
    id,
    coords: { galaxy, system, slot },
    name: pirateName(universeSeed, galaxy, system),
    tier,
    ships: pirateShipsForTier(tier),
    resources: pirateResourcesForTier(tier),
    lastGrewAt: now,
    lastRaidAt: now,
    destroyedAt: null
  };
}
function seedUniversePirates(universe, now = Date.now()) {
  const seed = universe.seed ?? universe.id;
  if (!universe.pirateBases) universe.pirateBases = {};
  const kept = {};
  for (const [id, base] of Object.entries(universe.pirateBases)) {
    if (base.destroyedAt != null) kept[id] = base;
  }
  const living = {};
  for (let galaxy = 1; galaxy <= MAP_GALAXIES; galaxy++) {
    for (let system = 1; system <= MAP_SYSTEMS; system++) {
      if (hashSeed(`${seed}:pirate-spawn:${galaxy}:${system}`) % PIRATE_SYSTEMS_PER_BASE !== 0) {
        continue;
      }
      const slot = pickEmptySlot(
        universe,
        galaxy,
        system,
        `${seed}:pirate-slot:${galaxy}:${system}`
      );
      if (slot == null) continue;
      const base = createPirateBase(seed, galaxy, system, slot, now, 0);
      living[base.id] = base;
    }
  }
  universe.pirateBases = { ...kept, ...living };
}
function nextRaidIntervalMs(baseId, at) {
  return rollInRange2(
    `${baseId}:raid-iv:${at}`,
    PIRATE_RAID_INTERVAL_MIN_MS,
    PIRATE_RAID_INTERVAL_MAX_MS
  );
}
function pirateRespawnAt(destroyedAt, baseId) {
  const delay = rollInRange2(
    `${baseId}:respawn:${destroyedAt}`,
    PIRATE_RESPAWN_DELAY_MIN_MS,
    PIRATE_RESPAWN_DELAY_MAX_MS
  );
  return destroyedAt + delay;
}
function scalePirateRaidFleet(full, defenderPower) {
  const fullPower = Math.max(1, fleetCombatPower(full));
  const cap = Math.max(PIRATE_RAID_POWER_FLOOR, defenderPower * PIRATE_RAID_POWER_FACTOR) || PIRATE_RAID_POWER_FLOOR;
  if (fullPower <= cap) return normalizeFleetShips(full);
  return scaleShips(full, cap / fullPower);
}
function growPirateBase(base, now) {
  if (base.destroyedAt != null) return;
  while (base.tier < PIRATE_TIER_CAP && now - base.lastGrewAt >= PIRATE_GROWTH_INTERVAL_MS) {
    base.tier += 1;
    base.lastGrewAt += PIRATE_GROWTH_INTERVAL_MS;
    base.ships = pirateShipsForTier(base.tier);
    const stock = pirateResourcesForTier(base.tier);
    base.resources = {
      metal: Math.max(base.resources.metal, stock.metal),
      crystal: Math.max(base.resources.crystal, stock.crystal),
      deuterium: Math.max(base.resources.deuterium, stock.deuterium)
    };
  }
  if (base.tier >= PIRATE_TIER_CAP && now - base.lastGrewAt >= PIRATE_GROWTH_INTERVAL_MS) {
    base.lastGrewAt = now;
  }
}
function markPirateDestroyed(base, now) {
  base.destroyedAt = now;
  base.ships = emptyFleetShips();
  base.resources = emptyCargo();
}
function findRespawnSite(universe, seedKey) {
  const startG = 1 + hashSeed(`${seedKey}:g`) % MAP_GALAXIES;
  const startS = 1 + hashSeed(`${seedKey}:s`) % MAP_SYSTEMS;
  for (let dg = 0; dg < MAP_GALAXIES; dg++) {
    const galaxy = (startG - 1 + dg) % MAP_GALAXIES + 1;
    for (let ds = 0; ds < MAP_SYSTEMS; ds++) {
      const system = (startS - 1 + ds) % MAP_SYSTEMS + 1;
      if (systemOccupiedByPirate(universe, galaxy, system)) continue;
      const slot = pickEmptySlot(
        universe,
        galaxy,
        system,
        `${seedKey}:slot:${galaxy}:${system}`
      );
      if (slot != null) return { galaxy, system, slot };
    }
  }
  return null;
}
function respawnDestroyedPirates(universe, now) {
  const seed = universe.seed ?? universe.id;
  const bases = universe.pirateBases ?? {};
  for (const id of Object.keys(bases)) {
    const base = bases[id];
    if (base.destroyedAt == null) continue;
    if (now < pirateRespawnAt(base.destroyedAt, base.id)) continue;
    const site = findRespawnSite(universe, `${seed}:respawn:${base.id}:${now}`);
    delete bases[id];
    if (!site) continue;
    const next = createPirateBase(
      seed,
      site.galaxy,
      site.system,
      site.slot,
      now,
      0
    );
    bases[next.id] = next;
  }
}
function planetDefensePower(planet, universe) {
  const owner = universe.players[planet.ownerPlayerId];
  return fleetCombatPower(planet.ships, owner?.research) + defenseCombatPower(planet.defenses ?? emptyDefenses(), owner?.research);
}
function pickRaidTarget(universe, base, now) {
  const roll = hashSeed(`${base.id}:target:${base.lastRaidAt}:${now}`);
  const others = activePirateBases(universe).filter((b) => b.id !== base.id);
  const planets = Object.values(universe.planets).filter(
    (p) => p.kind !== "moon"
  );
  if (planets.length > 0 && (others.length === 0 || roll % 10 < 7)) {
    const planet = planets[roll % planets.length];
    return { kind: "planet", planet };
  }
  if (others.length > 0) {
    const other = others[roll % others.length];
    return { kind: "pirate", other };
  }
  return null;
}
function applyPirateRaidOnPlanet(universe, base, planet, now) {
  const owner = universe.players[planet.ownerPlayerId];
  if (!owner) return;
  const defPower = planetDefensePower(planet, universe);
  const raidFleet = scalePirateRaidFleet(base.ships, defPower);
  if (fleetShipCount(raidFleet) < 1) return;
  const combat = resolveCombat(
    raidFleet,
    planet.ships,
    planet.defenses ?? emptyDefenses(),
    void 0,
    effectiveCombatResearch(owner)
  );
  planet.ships = combat.defenderAfter;
  planet.defenses = combat.defensesAfter;
  const sent = fleetShipCount(raidFleet);
  const survived = fleetShipCount(combat.attackerAfter);
  if (sent > 0) {
    const keep = survived / sent;
    base.ships = scaleShips(base.ships, Math.min(1, 0.5 + keep * 0.5));
  }
  if (combat.outcome === "attacker_win") {
    const loot = computeRaidLoot(planet.resources, combat.attackerAfter);
    subtractCargo(planet, loot);
    base.resources = {
      metal: base.resources.metal + loot.metal,
      crystal: base.resources.crystal + loot.crystal,
      deuterium: base.resources.deuterium + loot.deuterium
    };
    grantPlayerXp(owner, xpForCombatLose());
  } else if (combat.outcome === "defender_win") {
    grantPirateFleetKillStarshards(owner);
    const killed = resourcesCostTotal(
      destroyedShipResources(raidFleet, combat.attackerAfter)
    );
    grantPlayerXp(
      owner,
      xpForCombatWin(killed) + xpForPirateShipKills(killed)
    );
  } else {
    grantPlayerXp(owner, xpForCombatLose());
  }
  universe.players[owner.id] = owner;
  if (fleetShipCount(base.ships) <= 0) {
    markPirateDestroyed(base, now);
  }
}
function applyPirateRaidOnPirate(universe, base, other, now) {
  const raidFleet = scalePirateRaidFleet(
    base.ships,
    fleetCombatPower(other.ships)
  );
  if (fleetShipCount(raidFleet) < 1) return;
  const combat = resolveCombat(raidFleet, other.ships, emptyDefenses());
  other.ships = combat.defenderAfter;
  const sent = fleetShipCount(raidFleet);
  const survived = fleetShipCount(combat.attackerAfter);
  if (sent > 0) {
    const keep = survived / sent;
    base.ships = scaleShips(base.ships, Math.min(1, 0.5 + keep * 0.5));
  }
  if (combat.outcome === "attacker_win") {
    const loot = computeRaidLoot(other.resources, combat.attackerAfter);
    other.resources = {
      metal: Math.max(0, other.resources.metal - loot.metal),
      crystal: Math.max(0, other.resources.crystal - loot.crystal),
      deuterium: Math.max(0, other.resources.deuterium - loot.deuterium)
    };
    base.resources = {
      metal: base.resources.metal + loot.metal,
      crystal: base.resources.crystal + loot.crystal,
      deuterium: base.resources.deuterium + loot.deuterium
    };
  }
  if (fleetShipCount(other.ships) <= 0) {
    markPirateDestroyed(other, now);
  }
  if (fleetShipCount(base.ships) <= 0) {
    markPirateDestroyed(base, now);
  }
}
function runDuePirateRaids(universe, now) {
  for (const base of activePirateBases(universe)) {
    const dueAt = base.lastRaidAt + nextRaidIntervalMs(base.id, base.lastRaidAt);
    if (now < dueAt) continue;
    const target = pickRaidTarget(universe, base, now);
    base.lastRaidAt = now;
    if (!target) continue;
    if (target.kind === "planet") {
      applyPirateRaidOnPlanet(universe, base, target.planet, now);
    } else {
      applyPirateRaidOnPirate(universe, base, target.other, now);
    }
  }
}
function tickPirates(universe, now) {
  if (!universe.pirateBases) universe.pirateBases = {};
  for (const base of Object.values(universe.pirateBases)) {
    growPirateBase(base, now);
  }
  runDuePirateRaids(universe, now);
  respawnDestroyedPirates(universe, now);
}
function resolvePirateRaidArrival(universe, fleet, now) {
  const baseId = fleet.targetPirateBaseId;
  const base = baseId ? universe.pirateBases?.[baseId] : null;
  if (!base || base.destroyedAt != null) {
    return;
  }
  const owner = universe.players[fleet.ownerPlayerId];
  const defenderBefore = { ...base.ships };
  const tierAtFight = base.tier;
  const combat = resolveCombat(
    fleet.ships,
    defenderBefore,
    emptyDefenses(),
    effectiveCombatResearch(owner)
  );
  base.ships = combat.defenderAfter;
  const killed = resourcesCostTotal(
    destroyedShipResources(defenderBefore, combat.defenderAfter)
  );
  let loot = emptyCargo();
  if (combat.outcome === "attacker_win") {
    loot = computeRaidLoot(base.resources, combat.attackerAfter);
    base.resources = {
      metal: Math.max(0, base.resources.metal - loot.metal),
      crystal: Math.max(0, base.resources.crystal - loot.crystal),
      deuterium: Math.max(0, base.resources.deuterium - loot.deuterium)
    };
    markPirateDestroyed(base, now);
    if (owner) {
      grantPirateDestroyStarshards(owner, tierAtFight);
      grantPlayerXp(
        owner,
        xpForCombatWin(killed) + xpForPirateBaseDestroy(tierAtFight) + xpForPirateShipKills(killed)
      );
      universe.players[owner.id] = owner;
    }
  } else if (owner) {
    grantPlayerXp(owner, xpForCombatLose());
    universe.players[owner.id] = owner;
  }
  const reportId = `rpt_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  universe.reports[reportId] = {
    id: reportId,
    at: now,
    missionId: fleet.id,
    attackerPlayerId: fleet.ownerPlayerId,
    defenderPlayerId: "npc_pirates",
    attackerName: owner?.name ?? "Unknown",
    defenderName: base.name,
    targetCoords: { ...base.coords },
    attackerBefore: { ...fleet.ships },
    attackerAfter: combat.attackerAfter,
    defenderBefore,
    defenderAfter: combat.defenderAfter,
    defensesBefore: emptyDefenses(),
    defensesAfter: emptyDefenses(),
    loot,
    debrisCreated: emptyCargo(),
    outcome: combat.outcome,
    rounds: combat.rounds,
    summary: combat.outcome === "attacker_win" ? `${combat.summary} Pirate base destroyed (+${pirateDestroyStarshards(tierAtFight)} Starshards).` : combat.summary,
    moonFormed: false
  };
  fleet.ships = combat.attackerAfter;
  fleet.cargo = loot;
  fleet.reportId = reportId;
}

// packages/game/src/world-bootstrap.ts
function emptyBuildings() {
  return {
    metalMine: 0,
    crystalMine: 0,
    deutSynth: 0,
    solarPlant: 0,
    metalStorage: 0,
    crystalStorage: 0,
    deutTank: 0,
    shipyard: 0,
    researchLab: 0,
    lunarBase: 0,
    sensorArray: 0,
    jumpGate: 0
  };
}
function emptyShips() {
  return emptyFleetShips();
}
function emptyCargo() {
  return { metal: 0, crystal: 0, deuterium: 0 };
}
function fieldsSeedForCoords(universeSeed, coords) {
  return `${universeSeed}:fields:${coords.galaxy}:${coords.system}:${coords.slot}`;
}
function createUniverse(name = "Alpha Drift", speed = 1, fleetSpeed = speed) {
  const now = Date.now();
  const id = `uni_${now.toString(36)}`;
  const universe = {
    id,
    name,
    speed,
    fleetSpeed,
    createdAt: now,
    schemaVersion: UNIVERSE_SCHEMA_VERSION,
    seed: `seed_${id}`,
    players: {},
    planets: {},
    fleets: {},
    reports: {},
    spyReports: {},
    expeditionReports: {},
    debris: {},
    asteroids: {},
    pirateBases: {}
  };
  seedUniverseAsteroids(universe);
  seedUniversePirates(universe, now);
  return universe;
}
function nextCoords(universe) {
  const used = new Set(
    Object.values(universe.planets).filter((p) => p.kind !== "moon").map((p) => coordsKey(p.coords))
  );
  for (let galaxy = 1; galaxy <= MAP_GALAXIES; galaxy++) {
    for (let system = 1; system <= MAP_SYSTEMS; system++) {
      for (const slot of HOME_SLOT_PREFERENCE) {
        if (slot < 1 || slot > MAP_SLOTS) continue;
        const key = `${galaxy}:${system}:${slot}`;
        if (!used.has(key)) {
          return { galaxy, system, slot };
        }
      }
    }
  }
  throw new Error("Universe planet slots are full.");
}
function planetAtCoords(universe, coords) {
  const key = coordsKey(coords);
  return Object.values(universe.planets).find(
    (p) => p.kind !== "moon" && coordsKey(p.coords) === key
  ) ?? null;
}
function moonAtCoords(universe, coords) {
  const key = coordsKey(coords);
  return Object.values(universe.planets).find(
    (p) => p.kind === "moon" && coordsKey(p.coords) === key
  ) ?? null;
}
function ensureUniverseShape(universe) {
  if (!universe.fleets) universe.fleets = {};
  if (!universe.reports) universe.reports = {};
  if (!universe.spyReports) universe.spyReports = {};
  if (!universe.expeditionReports) universe.expeditionReports = {};
  if (!universe.debris) universe.debris = {};
  if (!universe.asteroids) universe.asteroids = {};
  if (!universe.pirateBases) universe.pirateBases = {};
  if (!universe.fleetSpeed) universe.fleetSpeed = universe.speed || 1;
  if (!universe.seed) universe.seed = `seed_${universe.id}`;
  for (const player of Object.values(universe.players)) {
    if (!player.planetIds?.length) {
      player.planetIds = [player.homePlanetId];
    }
    if (!player.activePlanetId) {
      player.activePlanetId = player.homePlanetId;
    }
    if (!player.research) player.research = emptyResearch();
    if (player.researchQueue === void 0) player.researchQueue = null;
    if (player.starshards === void 0) player.starshards = 0;
    if (!player.officers) player.officers = [];
    if (!player.skillsUnlocked) player.skillsUnlocked = [];
    if (player.highscoreStarshardsClaimed === void 0) {
      player.highscoreStarshardsClaimed = false;
    }
    if (player.level == null || player.level < 1) player.level = 1;
    if (player.xp == null || player.xp < 0) player.xp = 0;
    if (player.xpTotal == null || player.xpTotal < 0) player.xpTotal = 0;
  }
  const seed = universe.seed ?? universe.id;
  for (const planet of Object.values(universe.planets)) {
    if (!planet.kind) planet.kind = "planet";
    if (planet.parentPlanetId === void 0) planet.parentPlanetId = null;
    if (planet.moonId === void 0) planet.moonId = null;
    if (!planet.defenses) planet.defenses = emptyDefenses();
    if (planet.defenseQueue === void 0) planet.defenseQueue = null;
    if (!planet.buildings.researchLab) planet.buildings.researchLab = 0;
    if (!planet.buildings.lunarBase) planet.buildings.lunarBase = 0;
    if (!planet.buildings.sensorArray) planet.buildings.sensorArray = 0;
    if (!planet.buildings.jumpGate) planet.buildings.jumpGate = 0;
    if (planet.kind !== "moon" && (typeof planet.fieldsCap !== "number" || planet.fieldsCap <= 0)) {
      planet.fieldsCap = rollPlanetFields(
        planet.coords.slot,
        fieldsSeedForCoords(seed, planet.coords)
      );
    }
    for (const id of SHIP_ORDER) {
      if (planet.ships[id] === void 0) planet.ships[id] = 0;
    }
    if (!planet.ownerPlayerId) {
      const owner = Object.values(universe.players).find(
        (p) => p.homePlanetId === planet.id || p.planetIds?.includes(planet.id)
      );
      planet.ownerPlayerId = owner?.id ?? "";
    }
  }
}
function joinUniverse(universe, playerName, now = Date.now()) {
  ensureUniverseShape(universe);
  const trimmed = playerName.trim().slice(0, 24);
  if (!trimmed) {
    throw new Error("Commander name is required.");
  }
  const existing = Object.values(universe.players).find(
    (p) => p.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (existing) {
    const planet2 = universe.planets[existing.activePlanetId] ?? universe.planets[existing.homePlanetId];
    if (!planet2) throw new Error("Player home planet missing.");
    return { player: existing, planet: planet2 };
  }
  const playerId = `plyr_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const planetId = `plnt_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const coords = nextCoords(universe);
  const seed = universe.seed ?? universe.id;
  const fieldsCap2 = rollPlanetFields(
    coords.slot,
    fieldsSeedForCoords(seed, coords)
  );
  const planet = {
    id: planetId,
    ownerPlayerId: playerId,
    name: `${trimmed}'s Outpost`,
    coords,
    kind: "planet",
    parentPlanetId: null,
    moonId: null,
    fieldsCap: fieldsCap2,
    resources: { ...STARTING_RESOURCES },
    lastTickAt: now,
    buildings: emptyBuildings(),
    ships: emptyShips(),
    defenses: emptyDefenses(),
    buildQueue: null,
    shipQueue: null,
    defenseQueue: null
  };
  planet.buildings.metalMine = 1;
  planet.buildings.crystalMine = 1;
  planet.buildings.solarPlant = 1;
  const player = {
    id: playerId,
    name: trimmed,
    homePlanetId: planetId,
    planetIds: [planetId],
    activePlanetId: planetId,
    research: emptyResearch(),
    researchQueue: null,
    createdAt: now,
    level: 1,
    xp: 0,
    xpTotal: 0,
    starshards: 0,
    officers: [],
    skillsUnlocked: [],
    highscoreStarshardsClaimed: false
  };
  universe.players[playerId] = player;
  universe.planets[planetId] = planet;
  return { player, planet };
}
function activePlanet(universe, player) {
  const id = player.activePlanetId || player.homePlanetId;
  return universe.planets[id] ?? universe.planets[player.homePlanetId] ?? null;
}
function bestLabLevel(universe, player) {
  let best = 0;
  for (const id of player.planetIds) {
    const p = universe.planets[id];
    if (p) best = Math.max(best, p.buildings.researchLab ?? 0);
  }
  return best;
}

// packages/game/src/world-moons.ts
function moonRoll(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 100;
}
function moonChancePercent(debris) {
  const total = Math.max(0, debris.metal + debris.crystal);
  if (total < MOON_DEBRIS_MIN) return 0;
  return Math.min(MOON_CHANCE_CAP, Math.floor(total / 1e3));
}
function sensorPhalanxRange(level) {
  return Math.max(0, Math.floor(level));
}
function inSensorPhalanxRange(moonCoords, targetCoords, sensorLevel) {
  const range = sensorPhalanxRange(sensorLevel);
  if (range < 1) return false;
  if (moonCoords.galaxy !== targetCoords.galaxy) return false;
  return Math.abs(moonCoords.system - targetCoords.system) <= range;
}
function ownedPlanetCount(universe, playerId) {
  const player = universe.players[playerId];
  if (!player) return 0;
  let n = 0;
  for (const id of player.planetIds ?? []) {
    const body = universe.planets[id];
    if (body && body.kind !== "moon") n++;
  }
  return n;
}
function tryFormMoon(universe, parent, debrisCreated, reportId, now) {
  if (parent.kind === "moon") return null;
  if (parent.moonId && universe.planets[parent.moonId]) return null;
  const chance = moonChancePercent(debrisCreated);
  if (chance <= 0) return null;
  const roll = moonRoll(reportId);
  if (roll >= chance) return null;
  const owner = universe.players[parent.ownerPlayerId];
  if (!owner) return null;
  const moonId = `moon_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const moon = {
    id: moonId,
    ownerPlayerId: owner.id,
    name: `${parent.name} Moon`,
    coords: { ...parent.coords },
    kind: "moon",
    parentPlanetId: parent.id,
    moonId: null,
    fieldsCap: MOON_FIELDS_BASE,
    resources: { metal: 0, crystal: 0, deuterium: 0 },
    lastTickAt: now,
    buildings: emptyBuildings(),
    ships: emptyShips(),
    defenses: emptyDefenses(),
    buildQueue: null,
    shipQueue: null,
    defenseQueue: null
  };
  universe.planets[moonId] = moon;
  parent.moonId = moonId;
  parent.kind = parent.kind ?? "planet";
  universe.planets[parent.id] = parent;
  if (!owner.planetIds.includes(moonId)) {
    owner.planetIds.push(moonId);
  }
  universe.players[owner.id] = owner;
  return moon;
}

// packages/game/src/world-arrival-raid.ts
function resolveRaidArrival(universe, fleet, target, now) {
  const owner = universe.players[fleet.ownerPlayerId];
  const defenderOwner = universe.players[target.ownerPlayerId];
  const defenderBefore = { ...target.ships };
  const defensesBefore = { ...target.defenses ?? emptyDefenses() };
  const defensePower = playerBoosts(defenderOwner, now).defensePower;
  const combat = resolveCombat(
    fleet.ships,
    defenderBefore,
    defensesBefore,
    effectiveCombatResearch(owner),
    effectiveCombatResearch(defenderOwner),
    { defensePower }
  );
  target.ships = combat.defenderAfter;
  target.defenses = combat.defensesAfter;
  const debrisAtk = debrisFromDestroyed(
    destroyedShipResources(fleet.ships, combat.attackerAfter)
  );
  const debrisDef = debrisFromDestroyed(
    destroyedShipResources(defenderBefore, combat.defenderAfter)
  );
  const debrisCreated = {
    metal: debrisAtk.metal + debrisDef.metal,
    crystal: debrisAtk.crystal + debrisDef.crystal,
    deuterium: 0
  };
  addDebris(universe, target.coords, debrisCreated);
  let loot = emptyCargo();
  if (combat.outcome === "attacker_win") {
    loot = computeRaidLoot(target.resources, combat.attackerAfter);
    subtractCargo(target, loot);
  }
  const atkDestroyed = resourcesCostTotal(
    destroyedShipResources(defenderBefore, combat.defenderAfter)
  );
  const defDestroyed = resourcesCostTotal(
    destroyedShipResources(fleet.ships, combat.attackerAfter)
  );
  if (owner) {
    if (combat.outcome === "attacker_win") {
      grantPlayerXp(owner, xpForCombatWin(atkDestroyed));
    } else {
      grantPlayerXp(owner, xpForCombatLose());
    }
    universe.players[owner.id] = owner;
  }
  if (defenderOwner && defenderOwner.id !== owner?.id) {
    if (combat.outcome === "defender_win") {
      grantPlayerXp(defenderOwner, xpForCombatWin(defDestroyed));
    } else if (combat.outcome === "attacker_win") {
      grantPlayerXp(defenderOwner, xpForCombatLose());
    } else {
      grantPlayerXp(defenderOwner, xpForCombatLose());
    }
    universe.players[defenderOwner.id] = defenderOwner;
  }
  const reportId = `rpt_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const moon = tryFormMoon(universe, target, debrisCreated, reportId, now);
  const summary = moon ? `${combat.summary} A moon coalesced from the debris field.` : combat.summary;
  const report = {
    id: reportId,
    at: now,
    missionId: fleet.id,
    attackerPlayerId: fleet.ownerPlayerId,
    defenderPlayerId: target.ownerPlayerId,
    attackerName: owner?.name ?? "Unknown",
    defenderName: defenderOwner?.name ?? "Unknown",
    targetCoords: { ...target.coords },
    attackerBefore: { ...fleet.ships },
    attackerAfter: combat.attackerAfter,
    defenderBefore,
    defenderAfter: combat.defenderAfter,
    defensesBefore,
    defensesAfter: combat.defensesAfter,
    loot,
    debrisCreated,
    outcome: combat.outcome,
    rounds: combat.rounds,
    summary,
    moonFormed: Boolean(moon)
  };
  universe.reports[reportId] = report;
  fleet.ships = combat.attackerAfter;
  fleet.cargo = loot;
  fleet.reportId = reportId;
}

// packages/game/src/world-espionage.ts
function resolveEspionage(universe, fleet, target, now) {
  const spy = universe.players[fleet.ownerPlayerId];
  const targetOwner = universe.players[target.ownerPlayerId];
  if (!spy || !targetOwner) return;
  const spyBoost = playerBoosts(spy, now).espionageLevel;
  const detail = espionageDetail(
    (spy.research.espionageTech ?? 0) + spyBoost,
    target.buildings.researchLab ?? 0
  );
  const reportId = `spy_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const report = {
    id: reportId,
    at: now,
    missionId: fleet.id,
    spyPlayerId: spy.id,
    targetPlayerId: targetOwner.id,
    targetName: targetOwner.name,
    targetCoords: { ...target.coords },
    detail,
    resources: detail >= 1 ? { ...target.resources } : null,
    ships: detail >= 2 ? { ...target.ships } : null,
    defenses: detail >= 2 ? { ...target.defenses } : null,
    buildings: detail >= 3 ? { ...target.buildings } : null,
    research: detail >= 3 ? { ...targetOwner.research } : null,
    summary: detail <= 0 ? `Sensors jammed over ${targetOwner.name}'s world \u2014 almost nothing learned.` : detail === 1 ? `Resource scan of ${targetOwner.name} succeeded.` : detail === 2 ? `Fleet/defense scan of ${targetOwner.name} succeeded.` : `Full structural scan of ${targetOwner.name} succeeded.`
  };
  universe.spyReports[reportId] = report;
  fleet.reportId = reportId;
}

// packages/game/src/world-expedition.ts
function expeditionRoll(fleetId, at) {
  let h = at >>> 0;
  for (let i = 0; i < fleetId.length; i++) {
    h = Math.imul(h, 31) + fleetId.charCodeAt(i) >>> 0;
  }
  return h % 100;
}
function expeditionKindFromRoll(roll) {
  if (roll < 40) return "resources";
  if (roll < 55) return "ships";
  if (roll < 70) return "nothing";
  if (roll < 75) return "starshards";
  return "pirates";
}
function scaleShipsKeep(ships, keepRatio) {
  const out = emptyFleetShips();
  const ratio = Math.min(1, Math.max(0, keepRatio));
  for (const id of SHIP_ORDER) {
    out[id] = Math.floor((ships[id] ?? 0) * ratio);
  }
  return normalizeFleetShips(out);
}
function resourceFind(ships, roll) {
  const cap = fleetCargoCapacity(ships);
  if (cap <= 0) {
    return { metal: 0, crystal: 0, deuterium: 0 };
  }
  const power = Math.max(1, fleetCombatPower(ships));
  const budget = Math.min(
    cap,
    Math.floor(80 + (cap * 0.35 + power * 0.5) * (0.55 + roll % 20 / 40))
  );
  const metal = Math.floor(budget * 0.55);
  const crystal = Math.floor(budget * 0.3);
  let deuterium = budget - metal - crystal;
  if (deuterium < 0) deuterium = 0;
  let total = metal + crystal + deuterium;
  if (total > cap) deuterium = Math.max(0, deuterium - (total - cap));
  return { metal, crystal, deuterium };
}
function resolveExpeditionArrival(universe, fleet, now) {
  if (!universe.expeditionReports) universe.expeditionReports = {};
  const roll = expeditionRoll(fleet.id, fleet.arrivesAt);
  const kind = expeditionKindFromRoll(roll);
  const before = normalizeFleetShips(fleet.ships);
  let cargoGained = { metal: 0, crystal: 0, deuterium: 0 };
  const shipsDelta = {};
  let starshardsGained = 0;
  let summary;
  switch (kind) {
    case "resources": {
      cargoGained = resourceFind(before, roll);
      fleet.cargo = { ...cargoGained };
      summary = `Anomaly yield: ${cargoGained.metal}m / ${cargoGained.crystal}c / ${cargoGained.deuterium}d.`;
      break;
    }
    case "ships": {
      if (roll % 2 === 0) {
        const n = 1 + roll % 3;
        fleet.ships.scout = (fleet.ships.scout ?? 0) + n;
        shipsDelta.scout = n;
        summary = `Salvage drones joined the fleet (+${n} Scout Skiff).`;
      } else {
        fleet.ships.hauler = (fleet.ships.hauler ?? 0) + 1;
        shipsDelta.hauler = 1;
        summary = "Derelict freighter claimed (+1 Ore Hauler).";
      }
      fleet.ships = normalizeFleetShips(fleet.ships);
      break;
    }
    case "nothing": {
      fleet.cargo = { metal: 0, crystal: 0, deuterium: 0 };
      summary = "Empty void \u2014 instruments found nothing of value.";
      break;
    }
    case "starshards": {
      fleet.cargo = { metal: 0, crystal: 0, deuterium: 0 };
      starshardsGained = expeditionStarshardsAmount(roll);
      const owner = universe.players[fleet.ownerPlayerId];
      if (owner) {
        grantStarshards(owner, starshardsGained);
        universe.players[owner.id] = owner;
      }
      summary = `Rare stellar fragment cache \u2014 +${starshardsGained} Starshards.`;
      break;
    }
    case "pirates": {
      const after = scaleShipsKeep(before, 0.7);
      for (const id of SHIP_ORDER) {
        const delta = (after[id] ?? 0) - (before[id] ?? 0);
        if (delta !== 0) shipsDelta[id] = delta;
      }
      fleet.ships = after;
      const crumb = Math.min(40, fleetCargoCapacity(after));
      cargoGained = {
        metal: Math.floor(crumb * 0.5),
        crystal: Math.floor(crumb * 0.3),
        deuterium: Math.max(0, crumb - Math.floor(crumb * 0.5) - Math.floor(crumb * 0.3))
      };
      fleet.cargo = { ...cargoGained };
      summary = `Pirate ambush \u2014 ~30% hulls lost. Scrap salvage ${cargoGained.metal}m/${cargoGained.crystal}c/${cargoGained.deuterium}d.`;
      break;
    }
    default: {
      const _exhaustive = kind;
      throw new Error(`Unhandled expedition kind: ${_exhaustive}`);
    }
  }
  if (kind !== "nothing") {
    const owner = universe.players[fleet.ownerPlayerId];
    if (owner) {
      grantPlayerXp(owner, xpForExpedition());
      universe.players[owner.id] = owner;
    }
  }
  const reportId = `xpd_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const report = {
    id: reportId,
    at: now,
    missionId: fleet.id,
    playerId: fleet.ownerPlayerId,
    targetCoords: { ...fleet.targetCoords },
    kind,
    cargoGained,
    shipsDelta,
    starshardsGained: starshardsGained || void 0,
    summary
  };
  universe.expeditionReports[reportId] = report;
  fleet.reportId = reportId;
}

// packages/game/src/world-spy-prune.ts
function pruneSpyReports(universe, now = Date.now(), ttlMs = SPY_REPORT_TTL_MS) {
  let removed = 0;
  for (const [id, report] of Object.entries(universe.spyReports ?? {})) {
    if (now - report.at > ttlMs) {
      delete universe.spyReports[id];
      removed += 1;
    }
  }
  return removed;
}

// packages/game/src/world-arrival.ts
function effectiveFleetSpeed(universe, ownerPlayerId, now) {
  const owner = universe.players[ownerPlayerId];
  const boosts = playerBoosts(owner, now);
  const lb = levelBonuses(owner?.level ?? 1);
  return universe.fleetSpeed * Math.max(0.01, boosts.fleetSpeed) / Math.max(0.01, lb.fleetTime);
}
function resolveFleetArrival(universe, fleet, now) {
  const origin = universe.planets[fleet.originPlanetId];
  if (!origin) {
    delete universe.fleets[fleet.id];
    return;
  }
  const owner = universe.players[fleet.ownerPlayerId];
  const drive = owner?.research.combustionDrive ?? 0;
  if (fleet.phase === "outbound") {
    if (fleet.mission === "raid") {
      const target = fleet.targetPlanetId ? universe.planets[fleet.targetPlanetId] : null;
      if (!target) {
        delete universe.fleets[fleet.id];
        return;
      }
      resolveRaidArrival(universe, fleet, target, now);
    } else if (fleet.mission === "espionage") {
      const target = fleet.targetPlanetId ? universe.planets[fleet.targetPlanetId] : null;
      if (!target) {
        delete universe.fleets[fleet.id];
        return;
      }
      resolveEspionage(universe, fleet, target, now);
    } else if (fleet.mission === "transport") {
      const target = fleet.targetPlanetId ? universe.planets[fleet.targetPlanetId] : null;
      if (!target || target.ownerPlayerId !== fleet.ownerPlayerId) {
        delete universe.fleets[fleet.id];
        return;
      }
      addCargoToPlanet(target, fleet.cargo);
      fleet.cargo = emptyCargo();
      addShipsToPlanet(target, fleet.ships);
      delete universe.fleets[fleet.id];
      return;
    } else if (fleet.mission === "deploy") {
      const target = fleet.targetPlanetId ? universe.planets[fleet.targetPlanetId] : null;
      if (target && target.ownerPlayerId === fleet.ownerPlayerId) {
        addShipsToPlanet(target, fleet.ships);
        delete universe.fleets[fleet.id];
        return;
      }
    } else if (fleet.mission === "jump") {
      const target = fleet.targetPlanetId ? universe.planets[fleet.targetPlanetId] : null;
      if (!target || target.kind !== "moon" || target.ownerPlayerId !== fleet.ownerPlayerId) {
        delete universe.fleets[fleet.id];
        return;
      }
      addShipsToPlanet(target, fleet.ships);
      delete universe.fleets[fleet.id];
      return;
    } else if (fleet.mission === "colonize") {
      const occupied = planetAtCoords(universe, fleet.targetCoords);
      if (occupied) {
      } else if ((fleet.ships.colonyShip ?? 0) < 1) {
      } else if (!owner) {
        delete universe.fleets[fleet.id];
        return;
      } else if (ownedPlanetCount(universe, owner.id) >= maxColonies(owner.research.astrophysics)) {
      } else {
        const planetId = `plnt_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        const colonyCoords = { ...fleet.targetCoords };
        const colony = {
          id: planetId,
          ownerPlayerId: owner.id,
          name: `${owner.name}'s Colony`,
          coords: colonyCoords,
          kind: "planet",
          parentPlanetId: null,
          moonId: null,
          fieldsCap: rollPlanetFields(
            colonyCoords.slot,
            fieldsSeedForCoords(universe.seed ?? universe.id, colonyCoords)
          ),
          resources: { metal: 500, crystal: 500, deuterium: 0 },
          lastTickAt: now,
          buildings: emptyBuildings(),
          ships: emptyShips(),
          defenses: emptyDefenses(),
          buildQueue: null,
          shipQueue: null,
          defenseQueue: null
        };
        colony.buildings.solarPlant = 1;
        const remaining = normalizeFleetShips(fleet.ships);
        remaining.colonyShip = Math.max(0, remaining.colonyShip - 1);
        addShipsToPlanet(colony, remaining);
        universe.planets[planetId] = colony;
        owner.planetIds.push(planetId);
        universe.players[owner.id] = owner;
        delete universe.fleets[fleet.id];
        return;
      }
    } else if (fleet.mission === "harvest") {
      const field = getDebris(universe, fleet.targetCoords);
      if (field) {
        const cap = fleetCargoCapacityForHarvest(fleet.ships);
        const takeMetal = Math.min(field.metal, cap);
        let remainingCap = cap - takeMetal;
        const takeCrystal = Math.min(field.crystal, remainingCap);
        fleet.cargo = {
          metal: takeMetal,
          crystal: takeCrystal,
          deuterium: 0
        };
        field.metal -= takeMetal;
        field.crystal -= takeCrystal;
        if (field.metal <= 0 && field.crystal <= 0) {
          delete universe.debris[coordsKey(fleet.targetCoords)];
        }
      }
    } else if (fleet.mission === "harvestAsteroid") {
      const asteroidId2 = fleet.targetAsteroidId;
      if (asteroidId2) {
        const cap = fleetCargoCapacityForHarvest(fleet.ships);
        fleet.cargo = harvestAsteroidField(universe, asteroidId2, cap);
      }
    } else if (fleet.mission === "expedition") {
      resolveExpeditionArrival(universe, fleet, now);
    } else if (fleet.mission === "pirateRaid") {
      resolvePirateRaidArrival(universe, fleet, now);
    }
    const returnSecs = flightSecondsOneWay(
      fleet.targetCoords,
      origin.coords,
      fleet.ships,
      effectiveFleetSpeed(universe, fleet.ownerPlayerId, now),
      drive
    );
    if (fleetShipCount(fleet.ships) <= 0) {
      delete universe.fleets[fleet.id];
      return;
    }
    fleet.phase = "returning";
    fleet.arrivesAt = now + returnSecs * 1e3;
    universe.fleets[fleet.id] = fleet;
    return;
  }
  addShipsToPlanet(origin, fleet.ships);
  addCargoToPlanet(origin, fleet.cargo);
  delete universe.fleets[fleet.id];
}
function fleetCargoCapacityForHarvest(ships) {
  let cap = 0;
  for (const id of SHIP_ORDER) {
    cap += (ships[id] ?? 0) * SHIPS[id].cargo;
  }
  return cap;
}
function advanceFleets(universe, now) {
  ensureUniverseShape(universe);
  const due = Object.values(universe.fleets).filter((f) => f.arrivesAt <= now).sort((a, b) => a.arrivesAt - b.arrivesAt);
  for (const fleet of due) {
    const live = universe.fleets[fleet.id];
    if (!live || live.arrivesAt > now) continue;
    resolveFleetArrival(universe, live, now);
  }
}
function advanceUniverse(universe, now = Date.now()) {
  ensureUniverseShape(universe);
  for (const player of Object.values(universe.players)) {
    advanceResearch(universe, player, now);
  }
  for (const id of Object.keys(universe.planets)) {
    const planet = universe.planets[id];
    const owner = universe.players[planet.ownerPlayerId];
    const energyTech = owner?.research.energyTech ?? 0;
    const boosts = playerBoosts(owner, now);
    const lb = levelBonuses(owner?.level ?? 1);
    universe.planets[id] = advancePlanet(
      planet,
      universe.speed,
      now,
      energyTech,
      {
        mineOutput: lb.production * boosts.mineOutput,
        energyOutput: boosts.energyOutput
      },
      owner
    );
    if (owner) universe.players[owner.id] = owner;
  }
  advanceFleets(universe, now);
  tickPirates(universe, now);
  pruneSpyReports(universe, now);
}

// packages/game/src/world-queues.ts
function resolveActionPlanet(universe, player, planetId) {
  const id = planetId || player.activePlanetId || player.homePlanetId;
  if (!player.planetIds.includes(id)) return null;
  return universe.planets[id] ?? null;
}
function setActivePlanet(universe, playerId, planetId, now = Date.now()) {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  advanceUniverse(universe, now);
  if (!player.planetIds.includes(planetId)) {
    return { ok: false, error: "You do not own that planet." };
  }
  const planet = universe.planets[planetId];
  if (!planet) return { ok: false, error: "Planet missing." };
  player.activePlanetId = planetId;
  universe.players[playerId] = player;
  return { ok: true, planet };
}
function queueBuildingUpgrade(universe, playerId, buildingId, now = Date.now(), planetId) {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  if (!BUILDINGS[buildingId]) return { ok: false, error: "Unknown building." };
  advanceUniverse(universe, now);
  const planet = resolveActionPlanet(universe, player, planetId);
  if (!planet) return { ok: false, error: "Planet missing." };
  if (!buildingAllowedOn(planet, buildingId)) {
    return {
      ok: false,
      error: planet.kind === "moon" ? "That structure cannot be built on a moon." : "That structure can only be built on a moon."
    };
  }
  if (buildingId === "sensorArray" && (planet.buildings.lunarBase ?? 0) < 1) {
    return { ok: false, error: "Sensor Phalanx needs Lunar Base level 1." };
  }
  if (buildingId === "jumpGate" && (planet.buildings.lunarBase ?? 0) < 1) {
    return { ok: false, error: "Jump Gate needs Lunar Base level 1." };
  }
  if (planet.buildQueue) {
    return { ok: false, error: "A building is already under construction." };
  }
  const current = planet.buildings[buildingId] ?? 0;
  if (buildingId === "lunarBase") {
    const nextCap = MOON_FIELDS_BASE + (current + 1) * MOON_FIELDS_PER_LUNAR_BASE;
    if (nextCap < fieldsUsed(planet) + 1) {
      return { ok: false, error: "No free planet fields remaining." };
    }
  } else if (fieldsRemaining(planet) < 1) {
    return { ok: false, error: "No free planet fields remaining." };
  }
  const cost = buildingUpgradeCost(buildingId, current);
  if (!canAfford(planet.resources, cost)) {
    return { ok: false, error: "Not enough resources." };
  }
  const lb = levelBonuses(player.level ?? 1);
  const seconds = Math.max(
    1,
    Math.ceil(
      buildingUpgradeSeconds(buildingId, current) * lb.buildTime / universe.speed
    )
  );
  planet.resources = spend(planet.resources, cost);
  planet.buildQueue = {
    kind: "building",
    buildingId,
    targetLevel: current + 1,
    completesAt: now + seconds * 1e3
  };
  universe.planets[planet.id] = planet;
  return { ok: true, planet };
}
function queueShipBuild(universe, playerId, shipId, count, now = Date.now(), planetId) {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const def = SHIPS[shipId];
  if (!def) return { ok: false, error: "Unknown ship." };
  const qty = Math.floor(count);
  if (qty < 1 || qty > 50) {
    return { ok: false, error: "Build between 1 and 50 ships at a time." };
  }
  advanceUniverse(universe, now);
  const planet = resolveActionPlanet(universe, player, planetId);
  if (!planet) return { ok: false, error: "Planet missing." };
  if (planet.shipQueue) {
    return { ok: false, error: "Shipyard is already busy." };
  }
  const yard = planet.buildings.shipyard ?? 0;
  if (yard < def.shipyardLevel) {
    return {
      ok: false,
      error: `Needs Shipyard level ${def.shipyardLevel} (you have ${yard}).`
    };
  }
  const cost = shipCost(shipId, qty);
  if (!canAfford(planet.resources, cost)) {
    return { ok: false, error: "Not enough resources." };
  }
  const lb = levelBonuses(player.level ?? 1);
  const seconds = Math.max(
    1,
    Math.ceil(
      shipBuildSeconds(shipId, qty, yard) * lb.shipBuild / universe.speed
    )
  );
  planet.resources = spend(planet.resources, cost);
  planet.shipQueue = {
    kind: "ship",
    shipId,
    count: qty,
    completesAt: now + seconds * 1e3,
    unitSeconds: Math.ceil(seconds / qty)
  };
  universe.planets[planet.id] = planet;
  return { ok: true, planet };
}
function queueDefenseBuild(universe, playerId, defenseId, count, now = Date.now(), planetId) {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const def = DEFENSES[defenseId];
  if (!def) return { ok: false, error: "Unknown defense." };
  const qty = Math.floor(count);
  if (qty < 1 || qty > 50) {
    return { ok: false, error: "Build between 1 and 50 defenses at a time." };
  }
  advanceUniverse(universe, now);
  const planet = resolveActionPlanet(universe, player, planetId);
  if (!planet) return { ok: false, error: "Planet missing." };
  if (planet.defenseQueue) {
    return { ok: false, error: "Defense yard is already busy." };
  }
  const yard = planet.buildings.shipyard ?? 0;
  if (yard < def.shipyardLevel) {
    return {
      ok: false,
      error: `Needs Shipyard level ${def.shipyardLevel} (you have ${yard}).`
    };
  }
  const cost = defenseCost(defenseId, qty);
  if (!canAfford(planet.resources, cost)) {
    return { ok: false, error: "Not enough resources." };
  }
  const seconds = Math.max(
    1,
    Math.ceil(defenseBuildSeconds(defenseId, qty, yard) / universe.speed)
  );
  planet.resources = spend(planet.resources, cost);
  planet.defenseQueue = {
    kind: "defense",
    defenseId,
    count: qty,
    completesAt: now + seconds * 1e3,
    unitSeconds: Math.ceil(seconds / qty)
  };
  universe.planets[planet.id] = planet;
  return { ok: true, planet };
}

// packages/game/src/world-research-queue.ts
function queueResearch(universe, playerId, researchId, now = Date.now()) {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const def = RESEARCH[researchId];
  if (!def) return { ok: false, error: "Unknown research." };
  advanceUniverse(universe, now);
  if (player.researchQueue) {
    return { ok: false, error: "Research is already in progress." };
  }
  const lab = bestLabLevel(universe, player);
  if (lab < def.labLevel) {
    return {
      ok: false,
      error: `Needs Research Lab level ${def.labLevel} (best lab ${lab}).`
    };
  }
  const planet = activePlanet(universe, player);
  if (!planet) return { ok: false, error: "Planet missing." };
  const current = player.research[researchId] ?? 0;
  if (current + 1 > lab) {
    return {
      ok: false,
      error: `Lab level ${lab} can only research up to level ${lab}.`
    };
  }
  const cost = researchUpgradeCost(researchId, current);
  if (!canAfford(planet.resources, cost)) {
    return { ok: false, error: "Not enough resources on active planet." };
  }
  const researchSpeed = playerBoosts(player, now).researchSpeed;
  const lb = levelBonuses(player.level ?? 1);
  const seconds = Math.max(
    1,
    Math.ceil(
      researchUpgradeSeconds(researchId, current, lab) * lb.researchTime / universe.speed / Math.max(0.01, researchSpeed)
    )
  );
  planet.resources = spend(planet.resources, cost);
  player.researchQueue = {
    kind: "research",
    researchId,
    targetLevel: current + 1,
    completesAt: now + seconds * 1e3
  };
  universe.planets[planet.id] = planet;
  universe.players[player.id] = player;
  return { ok: true, planet };
}

// packages/game/src/world-launch-target.ts
function resolveLaunchTarget(universe, player, origin, mission, ships, targetPlanetId, targetCoordsOpt, targetAsteroidIdOpt, targetPirateBaseIdOpt) {
  let targetCoords;
  let targetPlanet = null;
  let targetPlayerId = null;
  let targetAsteroidId = null;
  let targetPirateBaseId = null;
  if (mission === "expedition") {
    if (!targetCoordsOpt) {
      return { ok: false, error: "targetCoords required for expedition." };
    }
    targetCoords = { ...targetCoordsOpt };
    if (targetCoords.galaxy < 1 || targetCoords.galaxy > MAP_GALAXIES || targetCoords.system < 1 || targetCoords.system > MAP_SYSTEMS || targetCoords.slot !== EXPEDITION_SLOT) {
      return {
        ok: false,
        error: `Expedition requires deep-space slot ${EXPEDITION_SLOT}.`
      };
    }
    const activeExpeditions = Object.values(universe.fleets).filter(
      (f) => f.ownerPlayerId === player.id && f.mission === "expedition"
    ).length;
    const cap = maxExpeditions(player.research.astrophysics);
    if (activeExpeditions >= cap) {
      return {
        ok: false,
        error: `Expedition limit reached (Astrophysics \u2192 ${cap} concurrent).`
      };
    }
    return {
      ok: true,
      targetCoords,
      targetPlanet: null,
      targetPlayerId: null,
      targetAsteroidId: null,
      targetPirateBaseId: null
    };
  }
  if (mission === "pirateRaid") {
    const pirateId = targetPirateBaseIdOpt?.trim();
    if (!pirateId) {
      return { ok: false, error: "pirateBaseId required for pirateRaid." };
    }
    const base = universe.pirateBases?.[pirateId];
    if (!base || base.destroyedAt != null) {
      return { ok: false, error: "Pirate base not found." };
    }
    targetPirateBaseId = pirateId;
    targetCoords = { ...base.coords };
    return {
      ok: true,
      targetCoords,
      targetPlanet: null,
      targetPlayerId: null,
      targetAsteroidId: null,
      targetPirateBaseId
    };
  }
  if (mission === "harvestAsteroid") {
    const asteroidId2 = targetAsteroidIdOpt?.trim();
    if (!asteroidId2) {
      return { ok: false, error: "asteroidId required for harvestAsteroid." };
    }
    const field = universe.asteroids?.[asteroidId2];
    if (!field || field.richness <= 0) {
      return { ok: false, error: "Asteroid field not found." };
    }
    if ((ships.recycler ?? 0) < 1) {
      return { ok: false, error: "Asteroid harvest requires a Recycler." };
    }
    targetAsteroidId = asteroidId2;
    targetCoords = { ...field.coords };
    return {
      ok: true,
      targetCoords,
      targetPlanet: null,
      targetPlayerId: null,
      targetAsteroidId,
      targetPirateBaseId: null
    };
  }
  if (mission === "colonize" || mission === "harvest") {
    if (!targetCoordsOpt) {
      return {
        ok: false,
        error: "targetCoords required for colonize/harvest."
      };
    }
    targetCoords = { ...targetCoordsOpt };
    if (targetCoords.galaxy < 1 || targetCoords.galaxy > MAP_GALAXIES || targetCoords.system < 1 || targetCoords.system > MAP_SYSTEMS || targetCoords.slot < 1 || targetCoords.slot > MAP_SLOTS) {
      return { ok: false, error: "Coordinates out of map bounds." };
    }
    targetPlanet = planetAtCoords(universe, targetCoords);
    if (mission === "colonize") {
      if (targetPlanet) {
        return { ok: false, error: "Slot is already occupied." };
      }
      if (pirateBaseAtCoords(universe, targetCoords)) {
        return { ok: false, error: "Pirate base occupies that slot." };
      }
      if ((ships.colonyShip ?? 0) < 1) {
        return { ok: false, error: "Colonize requires a Colony Ship." };
      }
      if (ownedPlanetCount(universe, player.id) >= maxColonies(player.research.astrophysics)) {
        return {
          ok: false,
          error: `Colony limit reached (Astrophysics \u2192 ${maxColonies(player.research.astrophysics)} worlds).`
        };
      }
    } else {
      const field = getDebris(universe, targetCoords);
      if (!field || field.metal <= 0 && field.crystal <= 0) {
        return { ok: false, error: "No debris at those coordinates." };
      }
      if ((ships.recycler ?? 0) < 1) {
        return { ok: false, error: "Harvest requires a Recycler." };
      }
    }
  } else {
    if (!targetPlanetId) {
      return { ok: false, error: "targetPlanetId required." };
    }
    targetPlanet = universe.planets[targetPlanetId] ?? null;
    if (!targetPlanet) return { ok: false, error: "Target planet not found." };
    targetCoords = { ...targetPlanet.coords };
    targetPlayerId = targetPlanet.ownerPlayerId;
    if (mission === "transport") {
      if (targetPlanet.ownerPlayerId !== player.id) {
        return { ok: false, error: "Transport only between your planets." };
      }
      if (targetPlanet.id === origin.id) {
        return { ok: false, error: "Cannot transport to the same planet." };
      }
    } else if (mission === "deploy") {
      if (targetPlanet.id === origin.id) {
        return { ok: false, error: "Cannot deploy to the same planet." };
      }
    } else if (mission === "raid") {
      if (targetPlanet.id === origin.id) {
        return { ok: false, error: "Cannot send a fleet to your own planet." };
      }
      if (targetPlanet.ownerPlayerId === player.id) {
        return {
          ok: false,
          error: "Use transport or deploy to move between your own planets."
        };
      }
    } else if (mission === "espionage") {
      if (targetPlanet.ownerPlayerId === player.id) {
        return { ok: false, error: "Cannot spy on yourself." };
      }
      if ((ships.probe ?? 0) < 1) {
        return { ok: false, error: "Espionage requires a Spy Probe." };
      }
    } else if (mission === "jump") {
      if (origin.kind !== "moon") {
        return { ok: false, error: "Jump Gate hops must start from a moon." };
      }
      if ((origin.buildings.jumpGate ?? 0) < 1) {
        return { ok: false, error: "Origin moon needs Jump Gate level 1." };
      }
      if (targetPlanet.kind !== "moon") {
        return { ok: false, error: "Jump Gate hops must target a moon." };
      }
      if (targetPlanet.ownerPlayerId !== player.id) {
        return { ok: false, error: "Jump Gate only links your own moons." };
      }
      if (targetPlanet.id === origin.id) {
        return { ok: false, error: "Cannot jump to the same moon." };
      }
      if ((targetPlanet.buildings.jumpGate ?? 0) < 1) {
        return { ok: false, error: "Target moon needs Jump Gate level 1." };
      }
    }
  }
  return {
    ok: true,
    targetCoords,
    targetPlanet,
    targetPlayerId,
    targetAsteroidId,
    targetPirateBaseId
  };
}

// packages/game/src/world-launch.ts
var MISSIONS = [
  "deploy",
  "raid",
  "transport",
  "espionage",
  "colonize",
  "harvest",
  "harvestAsteroid",
  "expedition",
  "pirateRaid",
  "jump"
];
function launchFleet(universe, playerIdOrOpts, targetPlanetId, mission, shipsInput, nowArg) {
  const opts = typeof playerIdOrOpts === "string" ? {
    playerId: playerIdOrOpts,
    targetPlanetId,
    mission,
    ships: shipsInput ?? {},
    now: nowArg
  } : playerIdOrOpts;
  ensureUniverseShape(universe);
  const now = opts.now ?? Date.now();
  const player = universe.players[opts.playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  if (!MISSIONS.includes(opts.mission)) {
    return { ok: false, error: "Unknown mission type." };
  }
  const ships = normalizeFleetShips(opts.ships);
  if (fleetShipCount(ships) < 1) {
    return { ok: false, error: "Select at least one ship." };
  }
  advanceUniverse(universe, now);
  const origin = resolveActionPlanet(universe, player, opts.originPlanetId);
  if (!origin) return { ok: false, error: "Planet missing." };
  const boosts = playerBoosts(player, now);
  const slotCap = maxFleetSlots(player.research.computerTech) + boosts.fleetSlots;
  const activeFleets = Object.values(universe.fleets).filter(
    (f) => f.ownerPlayerId === player.id
  ).length;
  if (activeFleets >= slotCap) {
    return {
      ok: false,
      error: `Fleet slot limit reached (Computer Tech \u2192 ${slotCap} slots).`
    };
  }
  const target = resolveLaunchTarget(
    universe,
    player,
    origin,
    opts.mission,
    ships,
    opts.targetPlanetId,
    opts.targetCoords,
    opts.asteroidId,
    opts.pirateBaseId
  );
  if (!target.ok) return target;
  const {
    targetCoords,
    targetPlanet,
    targetPlayerId,
    targetAsteroidId,
    targetPirateBaseId
  } = target;
  for (const id of SHIP_ORDER) {
    const need = ships[id] ?? 0;
    const have = origin.ships[id] ?? 0;
    if (need > have) {
      return {
        ok: false,
        error: `Not enough ${SHIPS[id].name} in hangar (have ${have}, need ${need}).`
      };
    }
  }
  let cargo = emptyCargo();
  if (opts.mission === "transport") {
    const want = {
      metal: Math.max(0, Math.floor(opts.cargo?.metal ?? 0)),
      crystal: Math.max(0, Math.floor(opts.cargo?.crystal ?? 0)),
      deuterium: Math.max(0, Math.floor(opts.cargo?.deuterium ?? 0))
    };
    const cap = fleetCargoCapacityForHarvest(ships);
    const total = want.metal + want.crystal + want.deuterium;
    if (total < 1) {
      return { ok: false, error: "Load at least some cargo to transport." };
    }
    if (total > cap) {
      return { ok: false, error: `Cargo exceeds fleet capacity (${cap}).` };
    }
    if (!canAfford(origin.resources, want)) {
      return { ok: false, error: "Not enough resources to load." };
    }
    cargo = want;
  }
  const fuel = fuelCostOneWay(origin.coords, targetCoords, ships);
  if (Math.floor(origin.resources.deuterium) < fuel) {
    return {
      ok: false,
      error: `Not enough deuterium for fuel (need ${fuel}).`
    };
  }
  for (const id of SHIP_ORDER) {
    origin.ships[id] = (origin.ships[id] ?? 0) - (ships[id] ?? 0);
  }
  if (opts.mission === "transport") {
    origin.resources = spend(origin.resources, cargo);
  }
  origin.resources = spend(origin.resources, {
    metal: 0,
    crystal: 0,
    deuterium: fuel
  });
  const lb = levelBonuses(player.level ?? 1);
  const oneWay = opts.mission === "jump" ? 1 : flightSecondsOneWay(
    origin.coords,
    targetCoords,
    ships,
    // Stack: base → combustion → level time → officers/skills fleetSpeed.
    universe.fleetSpeed * Math.max(0.01, boosts.fleetSpeed) / Math.max(0.01, lb.fleetTime),
    player.research.combustionDrive ?? 0
  );
  const fleetId = `flt_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const fleet = {
    id: fleetId,
    ownerPlayerId: player.id,
    originPlanetId: origin.id,
    targetPlanetId: targetPlanet?.id ?? null,
    targetPlayerId,
    targetCoords,
    targetAsteroidId,
    targetPirateBaseId,
    mission: opts.mission,
    ships: { ...ships },
    cargo: { ...cargo },
    departedAt: now,
    arrivesAt: now + oneWay * 1e3,
    phase: "outbound",
    reportId: null
  };
  universe.fleets[fleetId] = fleet;
  universe.planets[origin.id] = origin;
  return { ok: true, fleet, planet: origin };
}

// packages/game/src/world-view.ts
function empirePoints(universe, player) {
  let points = researchPoints(player.research);
  for (const id of player.planetIds ?? []) {
    const planet = universe.planets[id];
    if (planet) points += planetPoints(planet);
  }
  for (const fleet of Object.values(universe.fleets)) {
    if (fleet.ownerPlayerId === player.id) {
      points += shipStockPoints(fleet.ships);
    }
  }
  return Math.floor(points);
}
function highscoresBoard(universe) {
  const rows = Object.values(universe.players).map((p) => {
    const home = universe.planets[p.homePlanetId];
    return {
      playerId: p.id,
      name: p.name,
      points: empirePoints(universe, p),
      coords: home?.coords ?? { galaxy: 0, system: 0, slot: 0 },
      planetCount: ownedPlanetCount(universe, p.id),
      level: p.level ?? 1,
      xpTotal: p.xpTotal ?? 0
    };
  });
  rows.sort(
    (a, b) => b.points - a.points || b.level - a.level || b.xpTotal - a.xpTotal || a.playerId.localeCompare(b.playerId)
  );
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}
function publicRoster(universe) {
  return Object.values(universe.players).map((p) => {
    const planet = universe.planets[p.homePlanetId];
    return {
      id: p.id,
      name: p.name,
      coords: planet?.coords ?? { galaxy: 0, system: 0, slot: 0 },
      pointsHint: empirePoints(universe, p),
      planetId: p.homePlanetId
    };
  });
}
function galaxyViewFor(universe, playerId, galaxy, system) {
  ensureUniverseShape(universe);
  const g = Math.min(MAP_GALAXIES, Math.max(1, Math.floor(galaxy)));
  const s = Math.min(MAP_SYSTEMS, Math.max(1, Math.floor(system)));
  const slots = [];
  for (let slot = 1; slot <= MAP_SLOTS; slot++) {
    const coords = { galaxy: g, system: s, slot };
    const planet = planetAtCoords(universe, coords);
    const moon = moonAtCoords(universe, coords);
    const debris = getDebris(universe, coords);
    const owner = planet ? universe.players[planet.ownerPlayerId] : void 0;
    slots.push({
      coords,
      planetId: planet?.id ?? null,
      playerId: owner?.id ?? null,
      playerName: owner?.name ?? null,
      allianceTag: null,
      pointsHint: planet ? Math.floor(planetPoints(planet)) : 0,
      debris: debris ? { metal: debris.metal, crystal: debris.crystal } : null,
      isOwn: owner?.id === playerId,
      hasMoon: Boolean(moon),
      moonId: moon?.id ?? null,
      activity: planet ? "planet" : "empty"
    });
  }
  const pirate = Object.values(universe.pirateBases ?? {}).find(
    (b) => b.destroyedAt == null && b.coords.galaxy === g && b.coords.system === s
  );
  if (pirate) {
    const slot = slots.find((row) => row.coords.slot === pirate.coords.slot);
    if (slot && slot.activity === "empty") {
      slot.activity = "pirate";
    }
  }
  return {
    galaxy: g,
    system: s,
    slots,
    deepSpace: { coords: { galaxy: g, system: s, slot: DEEP_SPACE_SLOT } },
    asteroids: asteroidsInSystem(universe, g, s),
    pirateBase: pirate ? {
      id: pirate.id,
      coords: pirate.coords,
      name: pirate.name,
      tier: pirate.tier,
      threatHint: pirate.tier >= 5 ? "high" : pirate.tier >= 2 ? "medium" : "low"
    } : null
  };
}
function maybeGrantHighscoreStarshards(universe, playerId) {
  const player = universe.players[playerId];
  if (!player || player.highscoreStarshardsClaimed) return;
  if (Object.keys(universe.players).length < 2) return;
  const board = highscoresBoard(universe);
  const row = board.find((e) => e.playerId === playerId);
  if (!row || row.rank > 3) return;
  player.highscoreStarshardsClaimed = true;
  grantStarshards(player, STARSHARDS_HIGHSCORE_TOP3);
  universe.players[player.id] = player;
}
function playerView(universe, playerId, now = Date.now(), galaxy, system) {
  advanceUniverse(universe, now);
  ensureUniverseShape(universe);
  const player = universe.players[playerId];
  if (!player) throw new Error("Unknown player.");
  pruneExpiredOfficers(player, now);
  maybeGrantHighscoreStarshards(universe, playerId);
  const planet = activePlanet(universe, player);
  if (!planet) throw new Error("Planet missing.");
  const boosts = playerBoosts(player, now);
  const fleets = Object.values(universe.fleets).filter((f) => f.ownerPlayerId === playerId).sort((a, b) => a.arrivesAt - b.arrivesAt);
  const reports = Object.values(universe.reports).filter(
    (r) => r.attackerPlayerId === playerId || r.defenderPlayerId === playerId
  ).sort((a, b) => b.at - a.at).slice(0, 12);
  const spyReports = Object.values(universe.spyReports).filter((r) => r.spyPlayerId === playerId).sort((a, b) => b.at - a.at).slice(0, 12);
  const expeditionReports = Object.values(universe.expeditionReports ?? {}).filter((r) => r.playerId === playerId).sort((a, b) => b.at - a.at).slice(0, 12);
  const g = galaxy ?? planet.coords.galaxy;
  const s = system ?? planet.coords.system;
  const sensorLevel = planet.buildings.sensorArray ?? 0;
  const sensorContacts = planet.kind === "moon" && sensorLevel >= 1 ? Object.values(universe.fleets).filter(
    (f) => f.phase === "outbound" && inSensorPhalanxRange(planet.coords, f.targetCoords, sensorLevel)
  ).sort((a, b) => a.arrivesAt - b.arrivesAt).slice(0, 20) : [];
  return {
    now,
    universe: {
      id: universe.id,
      name: universe.name,
      speed: universe.speed,
      fleetSpeed: universe.fleetSpeed
    },
    player,
    planet,
    ownedPlanets: player.planetIds.map((id) => {
      const p = universe.planets[id];
      if (!p) return null;
      return {
        id: p.id,
        name: p.name,
        coords: p.coords,
        isHome: p.id === player.homePlanetId,
        isActive: p.id === player.activePlanetId,
        isMoon: p.kind === "moon",
        jumpGateLevel: p.buildings.jumpGate ?? 0
      };
    }).filter((x) => x !== null),
    economy: economySnapshot(
      planet,
      universe.speed,
      player.research.energyTech ?? 0,
      {
        mineOutput: levelBonuses(player.level ?? 1).production * boosts.mineOutput,
        energyOutput: boosts.energyOutput
      }
    ),
    roster: publicRoster(universe),
    highscores: highscoresBoard(universe),
    galaxy: galaxyViewFor(universe, playerId, g, s),
    fleets,
    reports,
    spyReports,
    expeditionReports,
    sensorContacts,
    starshards: player.starshards ?? 0,
    officers: player.officers ?? [],
    skillsUnlocked: player.skillsUnlocked ?? [],
    officerCatalog: OFFICER_ORDER.map((id) => OFFICERS[id]),
    skillCatalog: SKILL_ORDER.map((id) => SKILLS[id]),
    dailyLoginAvailable: canClaimDailyLogin(player, now),
    progress: playerProgressView(player)
  };
}

// packages/game/src/world-migrate.ts
function universeSchemaVersion(universe) {
  return universe.schemaVersion ?? 1;
}
function migrateOrResetUniverse(data, opts) {
  const version = universeSchemaVersion(data);
  if (version >= UNIVERSE_SCHEMA_VERSION && data.id) {
    ensureUniverseShape(data);
    return { universe: data, didReset: false, archived: null };
  }
  if (version === 2 && UNIVERSE_SCHEMA_VERSION >= 3 && data.id) {
    ensureUniverseShape(data);
    data.schemaVersion = UNIVERSE_SCHEMA_VERSION;
    return { universe: data, didReset: false, archived: null };
  }
  const fresh = createUniverse(
    opts?.name ?? data.name ?? "Alpha Drift",
    opts?.speed ?? data.speed ?? 1,
    opts?.fleetSpeed ?? data.fleetSpeed ?? data.speed ?? 1
  );
  ensureUniverseShape(fresh);
  return { universe: fresh, didReset: true, archived: data };
}
function archiveUniverseKey(universeId, ts = Date.now()) {
  return `starhold:universe:archive:${universeId}:${ts}`;
}

// packages/game/src/world-starshards.ts
function claimDailyLogin(universe, playerId, now = Date.now()) {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  advanceUniverse(universe, now);
  if (!canClaimDailyLogin(player, now)) {
    return { ok: false, error: "Daily Starshards already claimed today (UTC)." };
  }
  player.lastDailyLoginUtc = utcDayKey(now);
  grantStarshards(player, STARSHARDS_DAILY_LOGIN);
  universe.players[player.id] = player;
  return { ok: true, starshardsGranted: STARSHARDS_DAILY_LOGIN };
}
function activateOfficer(universe, playerId, officerId, now = Date.now()) {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const def = OFFICERS[officerId];
  if (!def) return { ok: false, error: "Unknown officer." };
  advanceUniverse(universe, now);
  pruneExpiredOfficers(player, now);
  const balance = Math.floor(player.starshards ?? 0);
  if (balance < def.cost) {
    return {
      ok: false,
      error: `Need ${def.cost} Starshards (have ${balance}).`
    };
  }
  player.starshards = balance - def.cost;
  const others = (player.officers ?? []).filter(
    (o) => o.officerId !== officerId
  );
  others.push({
    officerId,
    activatedAt: now,
    expiresAt: now + def.durationMs
  });
  player.officers = others;
  universe.players[player.id] = player;
  return { ok: true };
}
function unlockSkill(universe, playerId, skillId, now = Date.now()) {
  const player = universe.players[playerId];
  if (!player) return { ok: false, error: "Unknown player." };
  const def = SKILLS[skillId];
  if (!def) return { ok: false, error: "Unknown skill." };
  advanceUniverse(universe, now);
  const unlocked = new Set(player.skillsUnlocked ?? []);
  if (unlocked.has(skillId)) {
    return { ok: false, error: "Skill already unlocked." };
  }
  for (const req of def.requires) {
    if (!unlocked.has(req)) {
      return { ok: false, error: `Requires skill ${req} first.` };
    }
  }
  const balance = Math.floor(player.starshards ?? 0);
  if (balance < def.cost) {
    return {
      ok: false,
      error: `Need ${def.cost} Starshards (have ${balance}).`
    };
  }
  player.starshards = balance - def.cost;
  player.skillsUnlocked = [...unlocked, skillId];
  universe.players[player.id] = player;
  return { ok: true };
}

// node_modules/uncrypto/dist/crypto.node.mjs
var import_node_crypto = __toESM(require("node:crypto"), 1);
var subtle = import_node_crypto.default.webcrypto?.subtle || {};

// node_modules/@upstash/redis/chunk-4WQYU7T6.mjs
var __defProp2 = Object.defineProperty;
var __export2 = (target, all) => {
  for (var name in all)
    __defProp2(target, name, { get: all[name], enumerable: true });
};
var error_exports = {};
__export2(error_exports, {
  UpstashError: () => UpstashError,
  UpstashJSONParseError: () => UpstashJSONParseError,
  UrlError: () => UrlError
});
var UpstashError = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "UpstashError";
  }
};
var UrlError = class extends Error {
  constructor(url) {
    super(
      `Upstash Redis client was passed an invalid URL. You should pass a URL starting with https. Received: "${url}". `
    );
    this.name = "UrlError";
  }
};
var UpstashJSONParseError = class extends UpstashError {
  constructor(body, options) {
    const truncatedBody = body.length > 200 ? body.slice(0, 200) + "..." : body;
    super(`Unable to parse response body: ${truncatedBody}`, options);
    this.name = "UpstashJSONParseError";
  }
};
function parseRecursive(obj) {
  const parsed = Array.isArray(obj) ? obj.map((o) => {
    try {
      return parseRecursive(o);
    } catch {
      return o;
    }
  }) : JSON.parse(obj);
  if (typeof parsed === "number" && parsed.toString() !== obj) {
    return obj;
  }
  return parsed;
}
function parseResponse(result) {
  try {
    return parseRecursive(result);
  } catch {
    return result;
  }
}
function deserializeScanResponse(result) {
  return [result[0], ...parseResponse(result.slice(1))];
}
function deserializeScanWithTypesResponse(result) {
  const [cursor, keys] = result;
  const parsedKeys = [];
  for (let i = 0; i < keys.length; i += 2) {
    parsedKeys.push({ key: keys[i], type: keys[i + 1] });
  }
  return [cursor, parsedKeys];
}
function mergeHeaders(...headers) {
  const merged = {};
  for (const header of headers) {
    if (!header) continue;
    for (const [key, value] of Object.entries(header)) {
      if (value !== void 0 && value !== null) {
        merged[key] = value;
      }
    }
  }
  return merged;
}
function kvArrayToObject(v) {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) return v;
  if (!Array.isArray(v)) return {};
  const obj = {};
  for (let i = 0; i < v.length; i += 2) {
    if (typeof v[i] === "string") obj[v[i]] = v[i + 1];
  }
  return obj;
}
var MAX_BUFFER_SIZE = 1024 * 1024;
var HttpClient = class {
  baseUrl;
  headers;
  options;
  readYourWrites;
  upstashSyncToken = "";
  hasCredentials;
  retry;
  constructor(config) {
    this.options = {
      backend: config.options?.backend,
      agent: config.agent,
      responseEncoding: config.responseEncoding ?? "base64",
      // default to base64
      cache: config.cache,
      signal: config.signal,
      keepAlive: config.keepAlive ?? true
    };
    this.upstashSyncToken = "";
    this.readYourWrites = config.readYourWrites ?? true;
    this.baseUrl = (config.baseUrl || "").replace(/\/$/, "");
    const urlRegex = /^https?:\/\/[^\s#$./?].\S*$/;
    if (this.baseUrl && !urlRegex.test(this.baseUrl)) {
      throw new UrlError(this.baseUrl);
    }
    this.headers = {
      "Content-Type": "application/json",
      ...config.headers
    };
    this.hasCredentials = Boolean(this.baseUrl && this.headers.authorization.split(" ")[1]);
    if (this.options.responseEncoding === "base64") {
      this.headers["Upstash-Encoding"] = "base64";
    }
    this.retry = typeof config.retry === "boolean" && !config.retry ? {
      attempts: 1,
      backoff: () => 0
    } : {
      attempts: config.retry?.retries ?? 5,
      backoff: config.retry?.backoff ?? ((retryCount) => Math.exp(retryCount) * 50)
    };
  }
  mergeTelemetry(telemetry) {
    this.headers = merge(this.headers, "Upstash-Telemetry-Runtime", telemetry.runtime);
    this.headers = merge(this.headers, "Upstash-Telemetry-Platform", telemetry.platform);
    this.headers = merge(this.headers, "Upstash-Telemetry-Sdk", telemetry.sdk);
  }
  async request(req) {
    if (this.readYourWrites) {
      this.headers["upstash-sync-token"] = this.upstashSyncToken;
    }
    const requestHeaders = mergeHeaders(this.headers, req.headers ?? {});
    const requestUrl = [this.baseUrl, ...req.path ?? []].join("/");
    const isEventStream = requestHeaders.Accept === "text/event-stream";
    const signal = req.signal ?? this.options.signal;
    const isSignalFunction = typeof signal === "function";
    const requestOptions = {
      cache: this.options.cache,
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(req.body),
      keepalive: this.options.keepAlive,
      agent: this.options.agent,
      signal: isSignalFunction ? signal() : signal,
      /**
       * Fastly specific
       */
      backend: this.options.backend
    };
    if (!this.hasCredentials) {
      console.warn(
        "[Upstash Redis] Redis client was initialized without url or token. Failed to execute command."
      );
    }
    let res = null;
    let error = null;
    for (let i = 0; i <= this.retry.attempts; i++) {
      if (i > 0 && requestHeaders["Upstash-Telemetry-Sdk"]) {
        requestHeaders["Upstash-Telemetry-Retry"] = String(i);
      }
      try {
        res = await fetch(requestUrl, requestOptions);
        break;
      } catch (error_) {
        if (requestOptions.signal?.aborted && isSignalFunction) {
          throw error_;
        } else if (requestOptions.signal?.aborted) {
          const myBlob = new Blob([
            JSON.stringify({ result: requestOptions.signal.reason ?? "Aborted" })
          ]);
          const myOptions = {
            status: 200,
            statusText: requestOptions.signal.reason ?? "Aborted"
          };
          res = new Response(myBlob, myOptions);
          break;
        }
        error = error_;
        if (i < this.retry.attempts) {
          await new Promise((r) => setTimeout(r, this.retry.backoff(i)));
        }
      }
    }
    if (!res) {
      throw error ?? new Error("Exhausted all retries");
    }
    if (!res.ok) {
      let body2;
      const rawBody2 = await res.text();
      try {
        body2 = JSON.parse(rawBody2);
      } catch (error2) {
        throw new UpstashJSONParseError(rawBody2, { cause: error2 });
      }
      throw new UpstashError(`${body2.error}, command was: ${JSON.stringify(req.body)}`);
    }
    if (this.readYourWrites) {
      const headers = res.headers;
      this.upstashSyncToken = headers.get("upstash-sync-token") ?? "";
    }
    if (isEventStream && req && req.onMessage && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      (async () => {
        try {
          let buffer = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            if (buffer.length > MAX_BUFFER_SIZE) {
              throw new Error("Buffer size exceeded (1MB)");
            }
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6);
                req.onMessage?.(data);
              }
            }
          }
        } catch (error2) {
          if (error2 instanceof Error && error2.name === "AbortError") {
          } else {
            console.error("Stream reading error:", error2);
          }
        } finally {
          try {
            await reader.cancel();
          } catch {
          }
        }
      })();
      return { result: 1 };
    }
    let body;
    const rawBody = await res.text();
    try {
      body = JSON.parse(rawBody);
    } catch (error2) {
      throw new UpstashJSONParseError(rawBody, { cause: error2 });
    }
    if (this.readYourWrites) {
      const headers = res.headers;
      this.upstashSyncToken = headers.get("upstash-sync-token") ?? "";
    }
    if (this.options.responseEncoding === "base64") {
      if (Array.isArray(body)) {
        return body.map(({ result: result2, error: error2 }) => ({
          result: decode(result2),
          error: error2
        }));
      }
      const result = decode(body.result);
      return { result, error: body.error };
    }
    return body;
  }
};
function base64decode(b64) {
  let dec = "";
  try {
    const binString = atob(b64);
    const size = binString.length;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      bytes[i] = binString.charCodeAt(i);
    }
    dec = new TextDecoder().decode(bytes);
  } catch {
    dec = b64;
  }
  return dec;
}
function decode(raw2) {
  let result = void 0;
  switch (typeof raw2) {
    case "undefined": {
      return raw2;
    }
    case "number": {
      result = raw2;
      break;
    }
    case "object": {
      if (Array.isArray(raw2)) {
        result = raw2.map(
          (v) => typeof v === "string" ? base64decode(v) : Array.isArray(v) ? v.map((element) => decode(element)) : v
        );
      } else {
        result = null;
      }
      break;
    }
    case "string": {
      result = raw2 === "OK" ? "OK" : base64decode(raw2);
      break;
    }
    default: {
      break;
    }
  }
  return result;
}
function merge(obj, key, value) {
  if (!value) {
    return obj;
  }
  if (!obj[key]) {
    obj[key] = value;
    return obj;
  }
  const values = obj[key].split(",").map((v) => v.trim());
  if (!values.includes(value.trim())) {
    obj[key] = [obj[key], value].join(",");
  }
  return obj;
}
var defaultSerializer = (c) => {
  switch (typeof c) {
    case "string":
    case "number":
    case "boolean": {
      return c;
    }
    default: {
      return JSON.stringify(c);
    }
  }
};
var Command = class {
  command;
  serialize;
  deserialize;
  headers;
  path;
  onMessage;
  isStreaming;
  signal;
  /**
   * Create a new command instance.
   *
   * You can define a custom `deserialize` function. By default we try to deserialize as json.
   */
  constructor(command, opts) {
    this.serialize = defaultSerializer;
    this.deserialize = opts?.automaticDeserialization === void 0 || opts.automaticDeserialization ? opts?.deserialize ?? parseResponse : (x) => x;
    this.command = command.map((c) => this.serialize(c));
    this.headers = opts?.headers;
    this.path = opts?.path;
    this.onMessage = opts?.streamOptions?.onMessage;
    this.isStreaming = opts?.streamOptions?.isStreaming ?? false;
    this.signal = opts?.streamOptions?.signal;
    if (opts?.latencyLogging) {
      const originalExec = this.exec.bind(this);
      this.exec = async (client) => {
        const start = performance.now();
        const result = await originalExec(client);
        const end = performance.now();
        const loggerResult = (end - start).toFixed(2);
        console.log(
          `Latency for \x1B[38;2;19;185;39m${this.command[0].toString().toUpperCase()}\x1B[0m: \x1B[38;2;0;255;255m${loggerResult} ms\x1B[0m`
        );
        return result;
      };
    }
  }
  /**
   * Execute the command using a client.
   */
  async exec(client) {
    const { result, error } = await client.request({
      body: this.command,
      path: this.path,
      upstashSyncToken: client.upstashSyncToken,
      headers: this.headers,
      onMessage: this.onMessage,
      isStreaming: this.isStreaming,
      signal: this.signal
    });
    if (error) {
      throw new UpstashError(error);
    }
    if (result === void 0) {
      throw new TypeError("Request did not return a result");
    }
    return this.deserialize(result);
  }
};
var ExecCommand = class extends Command {
  constructor(cmd, opts) {
    const normalizedCmd = cmd.map((arg) => typeof arg === "string" ? arg : String(arg));
    super(normalizedCmd, opts);
  }
};
var FIELD_TYPES = [
  "TEXT",
  "U64",
  "I64",
  "F64",
  "BOOL",
  "DATE",
  "KEYWORD",
  "FACET"
];
function isFieldType(value) {
  return typeof value === "string" && FIELD_TYPES.includes(value);
}
function isDetailedField(value) {
  return typeof value === "object" && value !== null && "type" in value && isFieldType(value.type);
}
function isNestedSchema(value) {
  return typeof value === "object" && value !== null && !isDetailedField(value);
}
function flattenSchema(schema, pathPrefix = []) {
  const fields = [];
  for (const [key, value] of Object.entries(schema)) {
    const currentPath = [...pathPrefix, key];
    const pathString = currentPath.join(".");
    if (isFieldType(value)) {
      fields.push({
        path: pathString,
        type: value
      });
    } else if (isDetailedField(value)) {
      fields.push({
        path: pathString,
        type: value.type,
        fast: "fast" in value ? value.fast : void 0,
        noTokenize: "noTokenize" in value ? value.noTokenize : void 0,
        noStem: "noStem" in value ? value.noStem : void 0,
        from: "from" in value ? value.from : void 0
      });
    } else if (isNestedSchema(value)) {
      const nestedFields = flattenSchema(value, currentPath);
      fields.push(...nestedFields);
    }
  }
  return fields;
}
function deserializeQueryResponse(rawResponse) {
  return rawResponse.map((itemRaw) => {
    const raw2 = itemRaw;
    const key = raw2[0];
    const score = Number(raw2[1]);
    const rawFields = raw2[2];
    if (rawFields === void 0) {
      return { key, score };
    }
    if (!Array.isArray(rawFields) || rawFields.length === 0) {
      return { key, score, data: {} };
    }
    let data = {};
    for (const fieldRaw of rawFields) {
      const key2 = fieldRaw[0];
      const value = fieldRaw[1];
      const pathParts = key2.split(".");
      if (pathParts.length === 1) {
        data[key2] = value;
      } else {
        let currentObj = data;
        for (let i = 0; i < pathParts.length - 1; i++) {
          const pathPart = pathParts[i];
          if (!(pathPart in currentObj)) {
            currentObj[pathPart] = {};
          }
          currentObj = currentObj[pathPart];
        }
        currentObj[pathParts.at(-1)] = value;
      }
    }
    if ("$" in data) {
      data = data["$"];
    }
    return { key, score, data };
  });
}
function deserializeDescribeResponse(rawResponse) {
  const description = {};
  for (let i = 0; i < rawResponse.length; i += 2) {
    const descriptor = rawResponse[i];
    switch (descriptor) {
      case "name": {
        description["name"] = rawResponse[i + 1];
        break;
      }
      case "type": {
        description["dataType"] = rawResponse[i + 1].toLowerCase();
        break;
      }
      case "prefixes": {
        description["prefixes"] = rawResponse[i + 1];
        break;
      }
      case "language": {
        description["language"] = rawResponse[i + 1];
        break;
      }
      case "schema": {
        const schema = {};
        for (const fieldDescription of rawResponse[i + 1]) {
          const fieldName = fieldDescription[0];
          const fieldInfo = { type: fieldDescription[1] };
          if (fieldDescription.length > 2) {
            for (let j = 2; j < fieldDescription.length; j++) {
              const fieldOption = fieldDescription[j];
              switch (fieldOption) {
                case "NOSTEM": {
                  fieldInfo.noStem = true;
                  break;
                }
                case "NOTOKENIZE": {
                  fieldInfo.noTokenize = true;
                  break;
                }
                case "FAST": {
                  fieldInfo.fast = true;
                  break;
                }
                case "FROM": {
                  fieldInfo.from = fieldDescription[++j];
                  break;
                }
              }
            }
          }
          schema[fieldName] = fieldInfo;
        }
        description["schema"] = schema;
        break;
      }
    }
  }
  return description;
}
function parseCountResponse(rawResponse) {
  return typeof rawResponse === "number" ? rawResponse : Number.parseInt(rawResponse, 10);
}
function deserializeAggregateResponse(rawResponse) {
  return parseAggregationArray(rawResponse);
}
function parseAggregationArray(arr) {
  const result = {};
  for (let i = 0; i < arr.length; i += 2) {
    const key = arr[i];
    const value = arr[i + 1];
    if (Array.isArray(value)) {
      if (value.length > 0 && typeof value[0] === "string") {
        result[key] = value[0] === "buckets" ? parseBucketsValue(value) : parseStatsValue(value);
      } else {
        result[key] = parseAggregationArray(value);
      }
    } else {
      result[key] = value;
    }
  }
  return result;
}
function coerceNumericString(value) {
  if (typeof value === "string" && value !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return value;
}
function parseStatsValue(arr) {
  const result = {};
  for (let i = 0; i < arr.length; i += 2) {
    const key = arr[i];
    const value = arr[i + 1];
    if (Array.isArray(value) && value.length > 0) {
      if (typeof value[0] === "string") {
        result[key] = parseStatsValue(value);
      } else if (Array.isArray(value[0]) && typeof value[0][0] === "string") {
        result[key] = value.map((item) => parseStatsValue(item));
      } else {
        result[key] = value;
      }
    } else {
      result[key] = coerceNumericString(value);
    }
  }
  return result;
}
function parseBucketsValue(arr) {
  if (arr[0] === "buckets" && Array.isArray(arr[1])) {
    const result = {
      buckets: arr[1].map((bucket) => {
        const bucketObj = {};
        for (let i = 0; i < bucket.length; i += 2) {
          const key = bucket[i];
          const value = bucket[i + 1];
          bucketObj[key] = Array.isArray(value) && value.length > 0 && typeof value[0] === "string" ? parseStatsValue(value) : value;
        }
        return bucketObj;
      })
    };
    for (let i = 2; i < arr.length; i += 2) {
      result[arr[i]] = arr[i + 1];
    }
    return result;
  }
  return arr;
}
function buildQueryCommand(redisCommand, name, options) {
  const query = JSON.stringify(options?.filter ?? {});
  const command = [redisCommand, name, query];
  if (options?.limit !== void 0) {
    command.push("LIMIT", options.limit.toString());
  }
  if (options?.offset !== void 0) {
    command.push("OFFSET", options.offset.toString());
  }
  if (options?.select && Object.keys(options.select).length === 0) {
    command.push("NOCONTENT");
  }
  if (options) {
    if ("orderBy" in options && options.orderBy) {
      command.push("ORDERBY");
      for (const [field, direction] of Object.entries(options.orderBy)) {
        command.push(field, direction);
      }
    } else if ("scoreFunc" in options && options.scoreFunc) {
      command.push("SCOREFUNC", ...buildScoreFunc(options.scoreFunc));
    }
  }
  if (options?.highlight) {
    command.push(
      "HIGHLIGHT",
      "FIELDS",
      options.highlight.fields.length.toString(),
      ...options.highlight.fields
    );
    if (options.highlight.preTag && options.highlight.postTag) {
      command.push("TAGS", options.highlight.preTag, options.highlight.postTag);
    }
  }
  if (options?.select && Object.keys(options.select).length > 0) {
    command.push(
      "SELECT",
      Object.keys(options.select).length.toString(),
      ...Object.keys(options.select)
    );
  }
  return command;
}
function buildScoreFunc(scoreBy) {
  const result = [];
  if (typeof scoreBy === "string") {
    result.push("FIELDVALUE", scoreBy);
  } else if ("fields" in scoreBy) {
    if (scoreBy.combineMode) {
      result.push("COMBINEMODE", scoreBy.combineMode.toUpperCase());
    }
    if (scoreBy.scoreMode) {
      result.push("SCOREMODE", scoreBy.scoreMode.toUpperCase());
    }
    for (const field of scoreBy.fields) {
      result.push(...buildScoreFuncField(field));
    }
  } else {
    result.push(...buildScoreFuncField(scoreBy));
  }
  return result;
}
function buildScoreFuncField(field) {
  const result = [];
  if (typeof field === "string") {
    result.push("FIELDVALUE", field);
  } else {
    if (field.scoreMode) {
      result.push("SCOREMODE", field.scoreMode.toUpperCase());
    }
    result.push("FIELDVALUE", field.field);
    if (field.modifier) {
      result.push("MODIFIER", field.modifier.toUpperCase());
    }
    if (field.factor !== void 0) {
      result.push("FACTOR", field.factor.toString());
    }
    if (field.missing !== void 0) {
      result.push("MISSING", field.missing.toString());
    }
  }
  return result;
}
function buildCreateIndexCommand(params) {
  const { name, schema, dataType, language, skipInitialScan, existsOk } = params;
  let source;
  if (params.dataType === "stream") {
    source = ["ON", "STREAM", params.stream];
  } else {
    const prefixArray = Array.isArray(params.prefix) ? params.prefix : [params.prefix];
    source = [
      "ON",
      dataType.toUpperCase(),
      "PREFIX",
      prefixArray.length.toString(),
      ...prefixArray
    ];
  }
  const payload = [
    name,
    ...skipInitialScan ? ["SKIPINITIALSCAN"] : [],
    ...existsOk ? ["EXISTSOK"] : [],
    ...source,
    ...language ? ["LANGUAGE", language] : [],
    "SCHEMA"
  ];
  const fields = flattenSchema(schema);
  for (const field of fields) {
    payload.push(field.path, field.type);
    if (field.fast) {
      payload.push("FAST");
    }
    if (field.noTokenize) {
      payload.push("NOTOKENIZE");
    }
    if (field.noStem) {
      payload.push("NOSTEM");
    }
    if (field.from) {
      payload.push("FROM", field.from);
    }
  }
  return ["SEARCH.CREATE", ...payload];
}
function buildAggregateCommand(name, options) {
  const query = JSON.stringify(options?.filter ?? {});
  const aggregations = JSON.stringify(options.aggregations);
  return ["SEARCH.AGGREGATE", name, query, aggregations];
}
var SearchIndex = class {
  name;
  schema;
  client;
  constructor({ name, schema, client }) {
    this.name = name;
    this.schema = schema;
    this.client = client;
  }
  async waitIndexing() {
    const command = ["SEARCH.WAITINDEXING", this.name];
    return await new ExecCommand(command).exec(this.client);
  }
  async describe() {
    const command = ["SEARCH.DESCRIBE", this.name];
    const rawResult = await new ExecCommand(command).exec(
      this.client
    );
    if (!rawResult) return null;
    return deserializeDescribeResponse(rawResult);
  }
  async query(options) {
    const command = buildQueryCommand("SEARCH.QUERY", this.name, options);
    const rawResult = await new ExecCommand(command).exec(
      this.client
    );
    if (!rawResult) return rawResult;
    return deserializeQueryResponse(rawResult);
  }
  async aggregate(options) {
    const command = buildAggregateCommand(this.name, options);
    const rawResult = await new ExecCommand(
      command
    ).exec(this.client);
    return deserializeAggregateResponse(rawResult);
  }
  async count({ filter }) {
    const command = buildQueryCommand("SEARCH.COUNT", this.name, { filter });
    const rawResult = await new ExecCommand(command).exec(
      this.client
    );
    return { count: parseCountResponse(rawResult) };
  }
  async drop() {
    const command = ["SEARCH.DROP", this.name];
    const result = await new ExecCommand(command).exec(this.client);
    return result;
  }
  async addAlias({ alias }) {
    const command = ["SEARCH.ALIASADD", alias, this.name];
    const result = await new ExecCommand(command).exec(this.client);
    return result;
  }
};
async function createIndex(client, params) {
  const { name, schema } = params;
  const createIndexCommand = buildCreateIndexCommand(params);
  await new ExecCommand(createIndexCommand).exec(client);
  return initIndex(client, { name, schema });
}
function initIndex(client, params) {
  const { name, schema } = params;
  return new SearchIndex({ name, schema, client });
}
async function listAliases(client) {
  const command = ["SEARCH.LISTALIASES"];
  const rawResult = await new ExecCommand(command).exec(client);
  if (rawResult === 0 || Array.isArray(rawResult) && rawResult.length === 0) {
    return {};
  }
  if (!Array.isArray(rawResult)) {
    return {};
  }
  const aliases = {};
  for (const pair of rawResult) {
    if (Array.isArray(pair) && pair.length === 2) {
      const [alias, index] = pair;
      aliases[alias] = index;
    }
  }
  return aliases;
}
async function addAlias(client, { indexName, alias }) {
  const command = ["SEARCH.ALIASADD", alias, indexName];
  const result = await new ExecCommand(command).exec(client);
  return result;
}
async function delAlias(client, { alias }) {
  const command = ["SEARCH.ALIASDEL", alias];
  const result = await new ExecCommand(command).exec(client);
  return result;
}
function float32ToBase64(vector) {
  const bytes = new Uint8Array(vector.length * 4);
  const view = new DataView(bytes.buffer);
  for (const [i, value] of vector.entries()) {
    view.setFloat32(i * 4, value, true);
  }
  let binary = "";
  const chunkSize = 32768;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCodePoint(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
function serializeVector(vector) {
  if (Array.isArray(vector)) {
    return ["VALUES", vector.length, ...vector];
  }
  if (vector instanceof Float32Array) {
    return ["BASE64-FP32", float32ToBase64(vector)];
  }
  return ["BASE64-FP32", vector.base64];
}
function deserializeVectorValues(result) {
  if (result === null) {
    return null;
  }
  return result.map(Number);
}
function deserializeVectorQueryResponse(result) {
  return result.map(([id, score]) => ({ id: String(id), score: Number(score) }));
}
function deserializeVectorInfoResponse(result) {
  if (result === null) {
    return null;
  }
  const fields = Array.isArray(result) ? Object.fromEntries(
    Array.from({ length: Math.floor(result.length / 2) }, (_, i) => [
      String(result[i * 2]),
      result[i * 2 + 1]
    ])
  ) : result;
  return {
    dimension: Number(fields.dimension),
    metric: String(fields.metric).toUpperCase()
  };
}
var VectorAddCommand = class extends Command {
  constructor([index, id, vector], cmdOpts) {
    super(["VECTOR.ADD", index, id, ...serializeVector(vector)], cmdOpts);
  }
};
var VectorCountCommand = class extends Command {
  constructor([index], cmdOpts) {
    super(["VECTOR.COUNT", index], cmdOpts);
  }
};
var VectorCreateCommand = class extends Command {
  constructor([index, opts], cmdOpts) {
    const command = [
      "VECTOR.CREATE",
      index,
      "DIM",
      opts.dimension,
      "METRIC",
      opts.metric
    ];
    if (opts.existsOk) {
      command.push("EXISTSOK");
    }
    super(command, cmdOpts);
  }
};
var VectorDelCommand = class extends Command {
  constructor([index, id], cmdOpts) {
    super(["VECTOR.DEL", index, id], cmdOpts);
  }
};
var VectorDropCommand = class extends Command {
  constructor([index], cmdOpts) {
    super(["VECTOR.DROP", index], cmdOpts);
  }
};
var VectorGetCommand = class extends Command {
  constructor([index, id], cmdOpts) {
    super(["VECTOR.GET", index, id], {
      deserialize: deserializeVectorValues,
      ...cmdOpts
    });
  }
};
var VectorInfoCommand = class extends Command {
  constructor([index], cmdOpts) {
    super(["VECTOR.INFO", index], {
      deserialize: deserializeVectorInfoResponse,
      ...cmdOpts
    });
  }
};
var VectorQueryCommand = class extends Command {
  constructor([index, opts], cmdOpts) {
    const command = ["VECTOR.QUERY", index, "TOPK", opts.topK];
    if (opts.profile) {
      command.push("PROFILE", opts.profile);
    }
    command.push(...serializeVector(opts.vector));
    super(command, {
      deserialize: deserializeVectorQueryResponse,
      ...cmdOpts
    });
  }
};
var VectorIndex = class {
  name;
  client;
  commandOptions;
  constructor({ name, client, commandOptions }) {
    this.name = name;
    this.client = client;
    this.commandOptions = commandOptions;
  }
  /**
   * Adds a vector to the index, or overwrites the vector stored under `id`.
   *
   * @returns `1` if a new vector was inserted, `0` if an existing one was overwritten.
   */
  add(id, vector) {
    return new VectorAddCommand([this.name, id, vector], this.commandOptions).exec(this.client);
  }
  /**
   * Returns the vector stored under `id`, or `null` if it does not exist.
   */
  get(id) {
    return new VectorGetCommand([this.name, id], this.commandOptions).exec(this.client);
  }
  /**
   * Returns the `topK` nearest neighbours of the query vector.
   */
  query(options) {
    return new VectorQueryCommand([this.name, options], this.commandOptions).exec(this.client);
  }
  /**
   * Deletes the vector stored under `id`.
   *
   * @returns `1` if the vector existed and was removed, `0` otherwise.
   */
  delete(id) {
    return new VectorDelCommand([this.name, id], this.commandOptions).exec(this.client);
  }
  /**
   * Returns the number of vectors in the index.
   */
  count() {
    return new VectorCountCommand([this.name], this.commandOptions).exec(this.client);
  }
  /**
   * Returns the dimension and metric of the index, or `null` if it does not exist.
   */
  info() {
    return new VectorInfoCommand([this.name], this.commandOptions).exec(this.client);
  }
  /**
   * Drops the index and all vectors in it.
   *
   * @returns `1` if the index existed and was dropped, `0` otherwise.
   */
  drop() {
    return new VectorDropCommand([this.name], this.commandOptions).exec(this.client);
  }
};
async function createVectorIndex(client, { name, ...opts }, commandOptions) {
  await new VectorCreateCommand([name, opts], commandOptions).exec(client);
  return new VectorIndex({ name, client, commandOptions });
}
function initVectorIndex(client, name, commandOptions) {
  return new VectorIndex({ name, client, commandOptions });
}
function deserialize(result) {
  if (result.length === 0) {
    return null;
  }
  const obj = {};
  for (let i = 0; i < result.length; i += 2) {
    const key = result[i];
    const value = result[i + 1];
    try {
      obj[key] = JSON.parse(value);
    } catch {
      obj[key] = value;
    }
  }
  return obj;
}
var HRandFieldCommand = class extends Command {
  constructor(cmd, opts) {
    const command = ["hrandfield", cmd[0]];
    if (typeof cmd[1] === "number") {
      command.push(cmd[1]);
    }
    if (cmd[2]) {
      command.push("WITHVALUES");
    }
    super(command, {
      // @ts-expect-error to silence compiler
      deserialize: cmd[2] ? (result) => deserialize(result) : opts?.deserialize,
      ...opts
    });
  }
};
var AppendCommand = class extends Command {
  constructor(cmd, opts) {
    super(["append", ...cmd], opts);
  }
};
var ArCountCommand = class extends Command {
  constructor(cmd, opts) {
    super(["ARCOUNT", ...cmd], opts);
  }
};
var ArDelCommand = class extends Command {
  constructor(cmd, opts) {
    super(["ARDEL", ...cmd], opts);
  }
};
var ArDelRangeCommand = class extends Command {
  constructor([key, ...ranges], opts) {
    super(["ARDELRANGE", key, ...ranges.flat()], opts);
  }
};
var ArGetCommand = class extends Command {
  constructor(cmd, opts) {
    super(["ARGET", ...cmd], opts);
  }
};
var ArGetRangeCommand = class extends Command {
  constructor(cmd, opts) {
    super(["ARGETRANGE", ...cmd], opts);
  }
};
var ArGrepCommand = class extends Command {
  constructor([key, start, end, opts], cmdOpts) {
    const command = ["ARGREP", key, start, end];
    for (const predicate of opts.predicates) {
      if ("exact" in predicate) {
        command.push("EXACT", predicate.exact);
      } else if ("match" in predicate) {
        command.push("MATCH", predicate.match);
      } else if ("glob" in predicate) {
        command.push("GLOB", predicate.glob);
      } else {
        command.push("RE", predicate.re);
      }
    }
    if (opts.combine) {
      command.push(opts.combine.toUpperCase());
    }
    if (opts.noCase) {
      command.push("NOCASE");
    }
    if (opts.withValues) {
      command.push("WITHVALUES");
    }
    if (opts.limit !== void 0) {
      command.push("LIMIT", opts.limit);
    }
    super(command, {
      deserialize: (result) => parseResponse(result).map(
        (item) => Array.isArray(item) ? [String(item[0]), item[1]] : String(item)
      ),
      ...cmdOpts
    });
  }
};
function toCamelCase(field) {
  return field.replaceAll(/-([a-z])/g, (_, char) => char.toUpperCase());
}
function deserializeArInfoResponse(result) {
  const entries = Array.isArray(result) ? Array.from({ length: Math.floor(result.length / 2) }, (_, i) => [
    result[i * 2],
    result[i * 2 + 1]
  ]) : Object.entries(result);
  const indexFields = /* @__PURE__ */ new Set(["len", "nextInsertIndex"]);
  const info = {};
  for (const [field, value] of entries) {
    const name = toCamelCase(String(field));
    if (indexFields.has(name)) {
      info[name] = String(value);
      continue;
    }
    const numeric = typeof value === "number" ? value : Number(value);
    info[name] = Number.isNaN(numeric) ? value : numeric;
  }
  return info;
}
var ArInfoCommand = class extends Command {
  constructor([key, opts], cmdOpts) {
    const command = ["ARINFO", key];
    if (opts?.full) {
      command.push("FULL");
    }
    super(command, {
      deserialize: deserializeArInfoResponse,
      ...cmdOpts
    });
  }
};
var ArInsertCommand = class extends Command {
  constructor(cmd, opts) {
    super(["ARINSERT", ...cmd], {
      deserialize: String,
      ...opts
    });
  }
};
var ArLastItemsCommand = class extends Command {
  constructor([key, count, opts], cmdOpts) {
    const command = ["ARLASTITEMS", key, count];
    if (opts?.rev) {
      command.push("REV");
    }
    super(command, cmdOpts);
  }
};
var ArLenCommand = class extends Command {
  constructor(cmd, opts) {
    super(["ARLEN", ...cmd], {
      deserialize: String,
      ...opts
    });
  }
};
var ArMGetCommand = class extends Command {
  constructor(cmd, opts) {
    super(["ARMGET", ...cmd], opts);
  }
};
var ArMSetCommand = class extends Command {
  constructor([key, values], opts) {
    const pairs = Array.isArray(values) ? values : Object.entries(values);
    super(["ARMSET", key, ...pairs.flatMap(([index, value]) => [index, value])], opts);
  }
};
var ArNextCommand = class extends Command {
  constructor(cmd, opts) {
    super(["ARNEXT", ...cmd], {
      deserialize: (result) => result === null ? null : String(result),
      ...opts
    });
  }
};
var ArOpCommand = class extends Command {
  constructor([key, start, end, operation], opts) {
    const command = ["AROP", key, start, end];
    if (typeof operation === "string") {
      command.push(operation.toUpperCase());
    } else {
      command.push("MATCH", operation.match);
    }
    super(command, {
      deserialize: (result) => result === null ? null : Number(result),
      ...opts
    });
  }
};
var ArRingCommand = class extends Command {
  constructor(cmd, opts) {
    super(["ARRING", ...cmd], {
      deserialize: String,
      ...opts
    });
  }
};
var ArScanCommand = class extends Command {
  constructor([key, start, end, opts], cmdOpts) {
    const command = ["ARSCAN", key, start, end];
    if (opts?.limit !== void 0) {
      command.push("LIMIT", opts.limit);
    }
    super(command, {
      deserialize: (result) => parseResponse(result).map(([index, value]) => [
        String(index),
        value
      ]),
      ...cmdOpts
    });
  }
};
var ArSeekCommand = class extends Command {
  constructor(cmd, opts) {
    super(["ARSEEK", ...cmd], opts);
  }
};
var ArSetCommand = class extends Command {
  constructor(cmd, opts) {
    super(["ARSET", ...cmd], opts);
  }
};
var BitCountCommand = class extends Command {
  constructor([key, start, end], opts) {
    const command = ["bitcount", key];
    if (typeof start === "number") {
      command.push(start);
    }
    if (typeof end === "number") {
      command.push(end);
    }
    super(command, opts);
  }
};
var BitFieldCommand = class {
  constructor(args, client, opts, execOperation = (command) => command.exec(this.client)) {
    this.client = client;
    this.opts = opts;
    this.execOperation = execOperation;
    this.command = ["bitfield", ...args];
  }
  command;
  chain(...args) {
    this.command.push(...args);
    return this;
  }
  get(...args) {
    return this.chain("get", ...args);
  }
  set(...args) {
    return this.chain("set", ...args);
  }
  incrby(...args) {
    return this.chain("incrby", ...args);
  }
  overflow(overflow) {
    return this.chain("overflow", overflow);
  }
  exec() {
    const command = new Command(this.command, this.opts);
    return this.execOperation(command);
  }
};
var BitOpCommand = class extends Command {
  constructor(cmd, opts) {
    super(["bitop", ...cmd], opts);
  }
};
var BitPosCommand = class extends Command {
  constructor(cmd, opts) {
    super(["bitpos", ...cmd], opts);
  }
};
var ClientSetInfoCommand = class extends Command {
  constructor([attribute, value], opts) {
    super(["CLIENT", "SETINFO", attribute.toUpperCase(), value], opts);
  }
};
var CopyCommand = class extends Command {
  constructor([key, destinationKey, opts], commandOptions) {
    super(["COPY", key, destinationKey, ...opts?.replace ? ["REPLACE"] : []], {
      ...commandOptions,
      deserialize(result) {
        if (result > 0) {
          return "COPIED";
        }
        return "NOT_COPIED";
      }
    });
  }
};
var DBSizeCommand = class extends Command {
  constructor(opts) {
    super(["dbsize"], opts);
  }
};
var DecrCommand = class extends Command {
  constructor(cmd, opts) {
    super(["decr", ...cmd], opts);
  }
};
var DecrByCommand = class extends Command {
  constructor(cmd, opts) {
    super(["decrby", ...cmd], opts);
  }
};
var DelCommand = class extends Command {
  constructor(cmd, opts) {
    super(["del", ...cmd], opts);
  }
};
var EchoCommand = class extends Command {
  constructor(cmd, opts) {
    super(["echo", ...cmd], opts);
  }
};
var EvalROCommand = class extends Command {
  constructor([script, keys, args], opts) {
    super(["eval_ro", script, keys.length, ...keys, ...args ?? []], opts);
  }
};
var EvalCommand = class extends Command {
  constructor([script, keys, args], opts) {
    super(["eval", script, keys.length, ...keys, ...args ?? []], opts);
  }
};
var EvalshaROCommand = class extends Command {
  constructor([sha, keys, args], opts) {
    super(["evalsha_ro", sha, keys.length, ...keys, ...args ?? []], opts);
  }
};
var EvalshaCommand = class extends Command {
  constructor([sha, keys, args], opts) {
    super(["evalsha", sha, keys.length, ...keys, ...args ?? []], opts);
  }
};
var ExistsCommand = class extends Command {
  constructor(cmd, opts) {
    super(["exists", ...cmd], opts);
  }
};
var ExpireCommand = class extends Command {
  constructor(cmd, opts) {
    super(["expire", ...cmd.filter(Boolean)], opts);
  }
};
var ExpireAtCommand = class extends Command {
  constructor(cmd, opts) {
    super(["expireat", ...cmd], opts);
  }
};
var FCallCommand = class extends Command {
  constructor([functionName, keys, args], opts) {
    super(["fcall", functionName, ...keys ? [keys.length, ...keys] : [0], ...args ?? []], opts);
  }
};
var FCallRoCommand = class extends Command {
  constructor([functionName, keys, args], opts) {
    super(
      ["fcall_ro", functionName, ...keys ? [keys.length, ...keys] : [0], ...args ?? []],
      opts
    );
  }
};
var FlushAllCommand = class extends Command {
  constructor(args, opts) {
    const command = ["flushall"];
    if (args && args.length > 0 && args[0].async) {
      command.push("async");
    }
    super(command, opts);
  }
};
var FlushDBCommand = class extends Command {
  constructor([opts], cmdOpts) {
    const command = ["flushdb"];
    if (opts?.async) {
      command.push("async");
    }
    super(command, cmdOpts);
  }
};
var FunctionDeleteCommand = class extends Command {
  constructor([libraryName], opts) {
    super(["function", "delete", libraryName], opts);
  }
};
var FunctionFlushCommand = class extends Command {
  constructor(opts) {
    super(["function", "flush"], opts);
  }
};
var FunctionListCommand = class extends Command {
  constructor([args], opts) {
    const command = ["function", "list"];
    if (args?.libraryName) {
      command.push("libraryname", args.libraryName);
    }
    if (args?.withCode) {
      command.push("withcode");
    }
    super(command, { deserialize: deserialize2, ...opts });
  }
};
function deserialize2(result) {
  if (!Array.isArray(result)) return [];
  return result.map((libRaw) => {
    const lib = kvArrayToObject(libRaw);
    const functionsParsed = lib.functions.map(
      (fnRaw) => kvArrayToObject(fnRaw)
    );
    return {
      libraryName: lib.library_name,
      engine: lib.engine,
      functions: functionsParsed.map((fn) => ({
        name: fn.name,
        description: fn.description ?? void 0,
        flags: fn.flags
      })),
      libraryCode: lib.library_code
    };
  });
}
var FunctionLoadCommand = class extends Command {
  constructor([args], opts) {
    super(["function", "load", ...args.replace ? ["replace"] : [], args.code], opts);
  }
};
var FunctionStatsCommand = class extends Command {
  constructor(opts) {
    super(["function", "stats"], { deserialize: deserialize3, ...opts });
  }
};
function deserialize3(result) {
  const rawEngines = kvArrayToObject(kvArrayToObject(result).engines);
  const parsedEngines = Object.fromEntries(
    Object.entries(rawEngines).map(([key, value]) => [key, kvArrayToObject(value)])
  );
  const final = {
    engines: Object.fromEntries(
      Object.entries(parsedEngines).map(([key, value]) => [
        key,
        {
          librariesCount: value.libraries_count,
          functionsCount: value.functions_count
        }
      ])
    )
  };
  return final;
}
var GeoAddCommand = class extends Command {
  constructor([key, arg1, ...arg2], opts) {
    const command = ["geoadd", key];
    if ("nx" in arg1 && arg1.nx) {
      command.push("nx");
    } else if ("xx" in arg1 && arg1.xx) {
      command.push("xx");
    }
    if ("ch" in arg1 && arg1.ch) {
      command.push("ch");
    }
    if ("latitude" in arg1 && arg1.latitude) {
      command.push(arg1.longitude, arg1.latitude, arg1.member);
    }
    command.push(
      ...arg2.flatMap(({ latitude, longitude, member }) => [longitude, latitude, member])
    );
    super(command, opts);
  }
};
var GeoDistCommand = class extends Command {
  constructor([key, member1, member2, unit = "M"], opts) {
    super(["GEODIST", key, member1, member2, unit], opts);
  }
};
var GeoHashCommand = class extends Command {
  constructor(cmd, opts) {
    const [key] = cmd;
    const members = Array.isArray(cmd[1]) ? cmd[1] : cmd.slice(1);
    super(["GEOHASH", key, ...members], opts);
  }
};
var GeoPosCommand = class extends Command {
  constructor(cmd, opts) {
    const [key] = cmd;
    const members = Array.isArray(cmd[1]) ? cmd[1] : cmd.slice(1);
    super(["GEOPOS", key, ...members], {
      deserialize: (result) => transform(result),
      ...opts
    });
  }
};
function transform(result) {
  const final = [];
  for (const pos of result) {
    if (!pos?.[0] || !pos?.[1]) {
      continue;
    }
    final.push({ lng: Number.parseFloat(pos[0]), lat: Number.parseFloat(pos[1]) });
  }
  return final;
}
var GeoSearchCommand = class extends Command {
  constructor([key, centerPoint, shape, order2, opts], commandOptions) {
    const command = ["GEOSEARCH", key];
    if (centerPoint.type === "FROMMEMBER" || centerPoint.type === "frommember") {
      command.push(centerPoint.type, centerPoint.member);
    }
    if (centerPoint.type === "FROMLONLAT" || centerPoint.type === "fromlonlat") {
      command.push(centerPoint.type, centerPoint.coordinate.lon, centerPoint.coordinate.lat);
    }
    if (shape.type === "BYRADIUS" || shape.type === "byradius") {
      command.push(shape.type, shape.radius, shape.radiusType);
    }
    if (shape.type === "BYBOX" || shape.type === "bybox") {
      command.push(shape.type, shape.rect.width, shape.rect.height, shape.rectType);
    }
    command.push(order2);
    if (opts?.count) {
      command.push("COUNT", opts.count.limit, ...opts.count.any ? ["ANY"] : []);
    }
    const transform2 = (result) => {
      if (!opts?.withCoord && !opts?.withDist && !opts?.withHash) {
        return result.map((member) => {
          try {
            return { member: JSON.parse(member) };
          } catch {
            return { member };
          }
        });
      }
      return result.map((members) => {
        let counter = 1;
        const obj = {};
        try {
          obj.member = JSON.parse(members[0]);
        } catch {
          obj.member = members[0];
        }
        if (opts.withDist) {
          obj.dist = Number.parseFloat(members[counter++]);
        }
        if (opts.withHash) {
          obj.hash = members[counter++].toString();
        }
        if (opts.withCoord) {
          obj.coord = {
            long: Number.parseFloat(members[counter][0]),
            lat: Number.parseFloat(members[counter][1])
          };
        }
        return obj;
      });
    };
    super(
      [
        ...command,
        ...opts?.withCoord ? ["WITHCOORD"] : [],
        ...opts?.withDist ? ["WITHDIST"] : [],
        ...opts?.withHash ? ["WITHHASH"] : []
      ],
      {
        deserialize: transform2,
        ...commandOptions
      }
    );
  }
};
var GeoSearchStoreCommand = class extends Command {
  constructor([destination, key, centerPoint, shape, order2, opts], commandOptions) {
    const command = ["GEOSEARCHSTORE", destination, key];
    if (centerPoint.type === "FROMMEMBER" || centerPoint.type === "frommember") {
      command.push(centerPoint.type, centerPoint.member);
    }
    if (centerPoint.type === "FROMLONLAT" || centerPoint.type === "fromlonlat") {
      command.push(centerPoint.type, centerPoint.coordinate.lon, centerPoint.coordinate.lat);
    }
    if (shape.type === "BYRADIUS" || shape.type === "byradius") {
      command.push(shape.type, shape.radius, shape.radiusType);
    }
    if (shape.type === "BYBOX" || shape.type === "bybox") {
      command.push(shape.type, shape.rect.width, shape.rect.height, shape.rectType);
    }
    command.push(order2);
    if (opts?.count) {
      command.push("COUNT", opts.count.limit, ...opts.count.any ? ["ANY"] : []);
    }
    super([...command, ...opts?.storeDist ? ["STOREDIST"] : []], commandOptions);
  }
};
var GetCommand = class extends Command {
  constructor(cmd, opts) {
    super(["get", ...cmd], opts);
  }
};
var GetBitCommand = class extends Command {
  constructor(cmd, opts) {
    super(["getbit", ...cmd], opts);
  }
};
var GetDelCommand = class extends Command {
  constructor(cmd, opts) {
    super(["getdel", ...cmd], opts);
  }
};
var GetExCommand = class extends Command {
  constructor([key, opts], cmdOpts) {
    const command = ["getex", key];
    if (opts) {
      if ("ex" in opts && typeof opts.ex === "number") {
        command.push("ex", opts.ex);
      } else if ("px" in opts && typeof opts.px === "number") {
        command.push("px", opts.px);
      } else if ("exat" in opts && typeof opts.exat === "number") {
        command.push("exat", opts.exat);
      } else if ("pxat" in opts && typeof opts.pxat === "number") {
        command.push("pxat", opts.pxat);
      } else if ("persist" in opts && opts.persist) {
        command.push("persist");
      }
    }
    super(command, cmdOpts);
  }
};
var GetRangeCommand = class extends Command {
  constructor(cmd, opts) {
    super(["getrange", ...cmd], opts);
  }
};
var GetSetCommand = class extends Command {
  constructor(cmd, opts) {
    super(["getset", ...cmd], opts);
  }
};
var HDelCommand = class extends Command {
  constructor(cmd, opts) {
    super(["hdel", ...cmd], opts);
  }
};
var HExistsCommand = class extends Command {
  constructor(cmd, opts) {
    super(["hexists", ...cmd], opts);
  }
};
var HExpireCommand = class extends Command {
  constructor(cmd, opts) {
    const [key, fields, seconds, option] = cmd;
    const fieldArray = Array.isArray(fields) ? fields : [fields];
    super(
      [
        "hexpire",
        key,
        seconds,
        ...option ? [option] : [],
        "FIELDS",
        fieldArray.length,
        ...fieldArray
      ],
      opts
    );
  }
};
var HExpireAtCommand = class extends Command {
  constructor(cmd, opts) {
    const [key, fields, timestamp, option] = cmd;
    const fieldArray = Array.isArray(fields) ? fields : [fields];
    super(
      [
        "hexpireat",
        key,
        timestamp,
        ...option ? [option] : [],
        "FIELDS",
        fieldArray.length,
        ...fieldArray
      ],
      opts
    );
  }
};
var HExpireTimeCommand = class extends Command {
  constructor(cmd, opts) {
    const [key, fields] = cmd;
    const fieldArray = Array.isArray(fields) ? fields : [fields];
    super(["hexpiretime", key, "FIELDS", fieldArray.length, ...fieldArray], opts);
  }
};
var HPersistCommand = class extends Command {
  constructor(cmd, opts) {
    const [key, fields] = cmd;
    const fieldArray = Array.isArray(fields) ? fields : [fields];
    super(["hpersist", key, "FIELDS", fieldArray.length, ...fieldArray], opts);
  }
};
var HPExpireCommand = class extends Command {
  constructor(cmd, opts) {
    const [key, fields, milliseconds, option] = cmd;
    const fieldArray = Array.isArray(fields) ? fields : [fields];
    super(
      [
        "hpexpire",
        key,
        milliseconds,
        ...option ? [option] : [],
        "FIELDS",
        fieldArray.length,
        ...fieldArray
      ],
      opts
    );
  }
};
var HPExpireAtCommand = class extends Command {
  constructor(cmd, opts) {
    const [key, fields, timestamp, option] = cmd;
    const fieldArray = Array.isArray(fields) ? fields : [fields];
    super(
      [
        "hpexpireat",
        key,
        timestamp,
        ...option ? [option] : [],
        "FIELDS",
        fieldArray.length,
        ...fieldArray
      ],
      opts
    );
  }
};
var HPExpireTimeCommand = class extends Command {
  constructor(cmd, opts) {
    const [key, fields] = cmd;
    const fieldArray = Array.isArray(fields) ? fields : [fields];
    super(["hpexpiretime", key, "FIELDS", fieldArray.length, ...fieldArray], opts);
  }
};
var HPTtlCommand = class extends Command {
  constructor(cmd, opts) {
    const [key, fields] = cmd;
    const fieldArray = Array.isArray(fields) ? fields : [fields];
    super(["hpttl", key, "FIELDS", fieldArray.length, ...fieldArray], opts);
  }
};
var HGetCommand = class extends Command {
  constructor(cmd, opts) {
    super(["hget", ...cmd], opts);
  }
};
function deserialize4(result) {
  if (result.length === 0) {
    return null;
  }
  const obj = {};
  for (let i = 0; i < result.length; i += 2) {
    const key = result[i];
    const value = result[i + 1];
    try {
      const valueIsNumberAndNotSafeInteger = !Number.isNaN(Number(value)) && !Number.isSafeInteger(Number(value));
      obj[key] = valueIsNumberAndNotSafeInteger ? value : JSON.parse(value);
    } catch {
      obj[key] = value;
    }
  }
  return obj;
}
var HGetAllCommand = class extends Command {
  constructor(cmd, opts) {
    super(["hgetall", ...cmd], {
      deserialize: (result) => deserialize4(result),
      ...opts
    });
  }
};
function deserialize5(fields, result) {
  if (result.every((field) => field === null)) {
    return null;
  }
  const obj = {};
  for (const [i, field] of fields.entries()) {
    try {
      obj[field] = JSON.parse(result[i]);
    } catch {
      obj[field] = result[i];
    }
  }
  return obj;
}
var HMGetCommand = class extends Command {
  constructor([key, ...fields], opts) {
    super(["hmget", key, ...fields], {
      deserialize: (result) => deserialize5(fields, result),
      ...opts
    });
  }
};
var HGetDelCommand = class extends Command {
  constructor([key, ...fields], opts) {
    super(["hgetdel", key, "FIELDS", fields.length, ...fields], {
      deserialize: (result) => deserialize5(fields.map(String), result),
      ...opts
    });
  }
};
var HGetExCommand = class extends Command {
  constructor([key, opts, ...fields], cmdOpts) {
    const command = ["hgetex", key];
    if ("ex" in opts && typeof opts.ex === "number") {
      command.push("EX", opts.ex);
    } else if ("px" in opts && typeof opts.px === "number") {
      command.push("PX", opts.px);
    } else if ("exat" in opts && typeof opts.exat === "number") {
      command.push("EXAT", opts.exat);
    } else if ("pxat" in opts && typeof opts.pxat === "number") {
      command.push("PXAT", opts.pxat);
    } else if ("persist" in opts && opts.persist) {
      command.push("PERSIST");
    }
    command.push("FIELDS", fields.length, ...fields);
    super(command, {
      deserialize: (result) => deserialize5(fields.map(String), result),
      ...cmdOpts
    });
  }
};
var HIncrByCommand = class extends Command {
  constructor(cmd, opts) {
    super(["hincrby", ...cmd], opts);
  }
};
var HIncrByFloatCommand = class extends Command {
  constructor(cmd, opts) {
    super(["hincrbyfloat", ...cmd], opts);
  }
};
var HKeysCommand = class extends Command {
  constructor([key], opts) {
    super(["hkeys", key], opts);
  }
};
var HLenCommand = class extends Command {
  constructor(cmd, opts) {
    super(["hlen", ...cmd], opts);
  }
};
var HMSetCommand = class extends Command {
  constructor([key, kv], opts) {
    super(["hmset", key, ...Object.entries(kv).flatMap(([field, value]) => [field, value])], opts);
  }
};
var HScanCommand = class extends Command {
  constructor([key, cursor, cmdOpts], opts) {
    const command = ["hscan", key, cursor];
    if (cmdOpts?.match) {
      command.push("match", cmdOpts.match);
    }
    if (typeof cmdOpts?.count === "number") {
      command.push("count", cmdOpts.count);
    }
    super(command, {
      deserialize: deserializeScanResponse,
      ...opts
    });
  }
};
var HSetCommand = class extends Command {
  constructor([key, kv], opts) {
    super(["hset", key, ...Object.entries(kv).flatMap(([field, value]) => [field, value])], opts);
  }
};
var HSetExCommand = class extends Command {
  constructor([key, opts, kv], cmdOpts) {
    const command = ["hsetex", key];
    if (opts.conditional) {
      command.push(opts.conditional.toUpperCase());
    }
    if (opts.expiration) {
      if ("ex" in opts.expiration && typeof opts.expiration.ex === "number") {
        command.push("EX", opts.expiration.ex);
      } else if ("px" in opts.expiration && typeof opts.expiration.px === "number") {
        command.push("PX", opts.expiration.px);
      } else if ("exat" in opts.expiration && typeof opts.expiration.exat === "number") {
        command.push("EXAT", opts.expiration.exat);
      } else if ("pxat" in opts.expiration && typeof opts.expiration.pxat === "number") {
        command.push("PXAT", opts.expiration.pxat);
      } else if ("keepttl" in opts.expiration && opts.expiration.keepttl) {
        command.push("KEEPTTL");
      }
    }
    const entries = Object.entries(kv);
    command.push("FIELDS", entries.length);
    for (const [field, value] of entries) {
      command.push(field, value);
    }
    super(command, cmdOpts);
  }
};
var HSetNXCommand = class extends Command {
  constructor(cmd, opts) {
    super(["hsetnx", ...cmd], opts);
  }
};
var HStrLenCommand = class extends Command {
  constructor(cmd, opts) {
    super(["hstrlen", ...cmd], opts);
  }
};
var HTtlCommand = class extends Command {
  constructor(cmd, opts) {
    const [key, fields] = cmd;
    const fieldArray = Array.isArray(fields) ? fields : [fields];
    super(["httl", key, "FIELDS", fieldArray.length, ...fieldArray], opts);
  }
};
var HValsCommand = class extends Command {
  constructor(cmd, opts) {
    super(["hvals", ...cmd], opts);
  }
};
var IncrCommand = class extends Command {
  constructor(cmd, opts) {
    super(["incr", ...cmd], opts);
  }
};
var IncrByCommand = class extends Command {
  constructor(cmd, opts) {
    super(["incrby", ...cmd], opts);
  }
};
var IncrByFloatCommand = class extends Command {
  constructor(cmd, opts) {
    super(["incrbyfloat", ...cmd], opts);
  }
};
var JsonArrAppendCommand = class extends Command {
  constructor(cmd, opts) {
    super(["JSON.ARRAPPEND", ...cmd], opts);
  }
};
var JsonArrIndexCommand = class extends Command {
  constructor(cmd, opts) {
    super(["JSON.ARRINDEX", ...cmd], opts);
  }
};
var JsonArrInsertCommand = class extends Command {
  constructor(cmd, opts) {
    super(["JSON.ARRINSERT", ...cmd], opts);
  }
};
var JsonArrLenCommand = class extends Command {
  constructor(cmd, opts) {
    super(["JSON.ARRLEN", cmd[0], cmd[1] ?? "$"], opts);
  }
};
var JsonArrPopCommand = class extends Command {
  constructor(cmd, opts) {
    super(["JSON.ARRPOP", ...cmd], opts);
  }
};
var JsonArrTrimCommand = class extends Command {
  constructor(cmd, opts) {
    const path = cmd[1] ?? "$";
    const start = cmd[2] ?? 0;
    const stop = cmd[3] ?? 0;
    super(["JSON.ARRTRIM", cmd[0], path, start, stop], opts);
  }
};
var JsonClearCommand = class extends Command {
  constructor(cmd, opts) {
    super(["JSON.CLEAR", ...cmd], opts);
  }
};
var JsonDelCommand = class extends Command {
  constructor(cmd, opts) {
    super(["JSON.DEL", ...cmd], opts);
  }
};
var JsonForgetCommand = class extends Command {
  constructor(cmd, opts) {
    super(["JSON.FORGET", ...cmd], opts);
  }
};
var JsonGetCommand = class extends Command {
  constructor(cmd, opts) {
    const command = ["JSON.GET"];
    if (typeof cmd[1] === "string") {
      command.push(...cmd);
    } else {
      command.push(cmd[0]);
      if (cmd[1]) {
        if (cmd[1].indent) {
          command.push("INDENT", cmd[1].indent);
        }
        if (cmd[1].newline) {
          command.push("NEWLINE", cmd[1].newline);
        }
        if (cmd[1].space) {
          command.push("SPACE", cmd[1].space);
        }
      }
      command.push(...cmd.slice(2));
    }
    super(command, opts);
  }
};
var JsonMergeCommand = class extends Command {
  constructor(cmd, opts) {
    const command = ["JSON.MERGE", ...cmd];
    super(command, opts);
  }
};
var JsonMGetCommand = class extends Command {
  constructor(cmd, opts) {
    super(["JSON.MGET", ...cmd[0], cmd[1]], opts);
  }
};
var JsonMSetCommand = class extends Command {
  constructor(cmd, opts) {
    const command = ["JSON.MSET"];
    for (const c of cmd) {
      command.push(c.key, c.path, c.value);
    }
    super(command, opts);
  }
};
var JsonNumIncrByCommand = class extends Command {
  constructor(cmd, opts) {
    super(["JSON.NUMINCRBY", ...cmd], opts);
  }
};
var JsonNumMultByCommand = class extends Command {
  constructor(cmd, opts) {
    super(["JSON.NUMMULTBY", ...cmd], opts);
  }
};
var JsonObjKeysCommand = class extends Command {
  constructor(cmd, opts) {
    super(["JSON.OBJKEYS", ...cmd], opts);
  }
};
var JsonObjLenCommand = class extends Command {
  constructor(cmd, opts) {
    super(["JSON.OBJLEN", ...cmd], opts);
  }
};
var JsonRespCommand = class extends Command {
  constructor(cmd, opts) {
    super(["JSON.RESP", ...cmd], opts);
  }
};
var JsonSetCommand = class extends Command {
  constructor(cmd, opts) {
    const command = ["JSON.SET", cmd[0], cmd[1], cmd[2]];
    if (cmd[3]) {
      if (cmd[3].nx) {
        command.push("NX");
      } else if (cmd[3].xx) {
        command.push("XX");
      }
    }
    super(command, opts);
  }
};
var JsonStrAppendCommand = class extends Command {
  constructor(cmd, opts) {
    super(["JSON.STRAPPEND", ...cmd], opts);
  }
};
var JsonStrLenCommand = class extends Command {
  constructor(cmd, opts) {
    super(["JSON.STRLEN", ...cmd], opts);
  }
};
var JsonToggleCommand = class extends Command {
  constructor(cmd, opts) {
    super(["JSON.TOGGLE", ...cmd], opts);
  }
};
var JsonTypeCommand = class extends Command {
  constructor(cmd, opts) {
    super(["JSON.TYPE", ...cmd], opts);
  }
};
var KeysCommand = class extends Command {
  constructor(cmd, opts) {
    super(["keys", ...cmd], opts);
  }
};
var LIndexCommand = class extends Command {
  constructor(cmd, opts) {
    super(["lindex", ...cmd], opts);
  }
};
var LInsertCommand = class extends Command {
  constructor(cmd, opts) {
    super(["linsert", ...cmd], opts);
  }
};
var LLenCommand = class extends Command {
  constructor(cmd, opts) {
    super(["llen", ...cmd], opts);
  }
};
var LMoveCommand = class extends Command {
  constructor(cmd, opts) {
    super(["lmove", ...cmd], opts);
  }
};
var LmPopCommand = class extends Command {
  constructor(cmd, opts) {
    const [numkeys, keys, direction, count] = cmd;
    super(["LMPOP", numkeys, ...keys, direction, ...count ? ["COUNT", count] : []], opts);
  }
};
var LPopCommand = class extends Command {
  constructor(cmd, opts) {
    super(["lpop", ...cmd], opts);
  }
};
var LPosCommand = class extends Command {
  constructor(cmd, opts) {
    const args = ["lpos", cmd[0], cmd[1]];
    if (typeof cmd[2]?.rank === "number") {
      args.push("rank", cmd[2].rank);
    }
    if (typeof cmd[2]?.count === "number") {
      args.push("count", cmd[2].count);
    }
    if (typeof cmd[2]?.maxLen === "number") {
      args.push("maxLen", cmd[2].maxLen);
    }
    super(args, opts);
  }
};
var LPushCommand = class extends Command {
  constructor(cmd, opts) {
    super(["lpush", ...cmd], opts);
  }
};
var LPushXCommand = class extends Command {
  constructor(cmd, opts) {
    super(["lpushx", ...cmd], opts);
  }
};
var LRangeCommand = class extends Command {
  constructor(cmd, opts) {
    super(["lrange", ...cmd], opts);
  }
};
var LRemCommand = class extends Command {
  constructor(cmd, opts) {
    super(["lrem", ...cmd], opts);
  }
};
var LSetCommand = class extends Command {
  constructor(cmd, opts) {
    super(["lset", ...cmd], opts);
  }
};
var LTrimCommand = class extends Command {
  constructor(cmd, opts) {
    super(["ltrim", ...cmd], opts);
  }
};
var MGetCommand = class extends Command {
  constructor(cmd, opts) {
    const keys = Array.isArray(cmd[0]) ? cmd[0] : cmd;
    super(["mget", ...keys], opts);
  }
};
var MSetCommand = class extends Command {
  constructor([kv], opts) {
    super(["mset", ...Object.entries(kv).flatMap(([key, value]) => [key, value])], opts);
  }
};
var MSetNXCommand = class extends Command {
  constructor([kv], opts) {
    super(["msetnx", ...Object.entries(kv).flat()], opts);
  }
};
var PersistCommand = class extends Command {
  constructor(cmd, opts) {
    super(["persist", ...cmd], opts);
  }
};
var PExpireCommand = class extends Command {
  constructor(cmd, opts) {
    super(["pexpire", ...cmd], opts);
  }
};
var PExpireAtCommand = class extends Command {
  constructor(cmd, opts) {
    super(["pexpireat", ...cmd], opts);
  }
};
var PfAddCommand = class extends Command {
  constructor(cmd, opts) {
    super(["pfadd", ...cmd], opts);
  }
};
var PfCountCommand = class extends Command {
  constructor(cmd, opts) {
    super(["pfcount", ...cmd], opts);
  }
};
var PfMergeCommand = class extends Command {
  constructor(cmd, opts) {
    super(["pfmerge", ...cmd], opts);
  }
};
var PingCommand = class extends Command {
  constructor(cmd, opts) {
    const command = ["ping"];
    if (cmd?.[0] !== void 0) {
      command.push(cmd[0]);
    }
    super(command, opts);
  }
};
var PSetEXCommand = class extends Command {
  constructor(cmd, opts) {
    super(["psetex", ...cmd], opts);
  }
};
var PTtlCommand = class extends Command {
  constructor(cmd, opts) {
    super(["pttl", ...cmd], opts);
  }
};
var PublishCommand = class extends Command {
  constructor(cmd, opts) {
    super(["publish", ...cmd], opts);
  }
};
var RandomKeyCommand = class extends Command {
  constructor(opts) {
    super(["randomkey"], opts);
  }
};
var RenameCommand = class extends Command {
  constructor(cmd, opts) {
    super(["rename", ...cmd], opts);
  }
};
var RenameNXCommand = class extends Command {
  constructor(cmd, opts) {
    super(["renamenx", ...cmd], opts);
  }
};
var RPopCommand = class extends Command {
  constructor(cmd, opts) {
    super(["rpop", ...cmd], opts);
  }
};
var RPushCommand = class extends Command {
  constructor(cmd, opts) {
    super(["rpush", ...cmd], opts);
  }
};
var RPushXCommand = class extends Command {
  constructor(cmd, opts) {
    super(["rpushx", ...cmd], opts);
  }
};
var SAddCommand = class extends Command {
  constructor(cmd, opts) {
    super(["sadd", ...cmd], opts);
  }
};
var ScanCommand = class extends Command {
  constructor([cursor, opts], cmdOpts) {
    const command = ["scan", cursor];
    if (opts?.match) {
      command.push("match", opts.match);
    }
    if (typeof opts?.count === "number") {
      command.push("count", opts.count);
    }
    if (opts && "withType" in opts && opts.withType === true) {
      command.push("withtype");
    } else if (opts && "type" in opts && opts.type && opts.type.length > 0) {
      command.push("type", opts.type);
    }
    super(command, {
      // @ts-expect-error ignore types here
      deserialize: opts?.withType ? deserializeScanWithTypesResponse : deserializeScanResponse,
      ...cmdOpts
    });
  }
};
var SCardCommand = class extends Command {
  constructor(cmd, opts) {
    super(["scard", ...cmd], opts);
  }
};
var ScriptExistsCommand = class extends Command {
  constructor(hashes, opts) {
    super(["script", "exists", ...hashes], {
      deserialize: (result) => result,
      ...opts
    });
  }
};
var ScriptFlushCommand = class extends Command {
  constructor([opts], cmdOpts) {
    const cmd = ["script", "flush"];
    if (opts?.sync) {
      cmd.push("sync");
    } else if (opts?.async) {
      cmd.push("async");
    }
    super(cmd, cmdOpts);
  }
};
var ScriptLoadCommand = class extends Command {
  constructor(args, opts) {
    super(["script", "load", ...args], opts);
  }
};
var SDiffCommand = class extends Command {
  constructor(cmd, opts) {
    super(["sdiff", ...cmd], opts);
  }
};
var SDiffStoreCommand = class extends Command {
  constructor(cmd, opts) {
    super(["sdiffstore", ...cmd], opts);
  }
};
var SetCommand = class extends Command {
  constructor([key, value, opts], cmdOpts) {
    const command = ["set", key, value];
    if (opts) {
      if ("nx" in opts && opts.nx) {
        command.push("nx");
      } else if ("xx" in opts && opts.xx) {
        command.push("xx");
      }
      if ("get" in opts && opts.get) {
        command.push("get");
      }
      if ("ex" in opts && typeof opts.ex === "number") {
        command.push("ex", opts.ex);
      } else if ("px" in opts && typeof opts.px === "number") {
        command.push("px", opts.px);
      } else if ("exat" in opts && typeof opts.exat === "number") {
        command.push("exat", opts.exat);
      } else if ("pxat" in opts && typeof opts.pxat === "number") {
        command.push("pxat", opts.pxat);
      } else if ("keepTtl" in opts && opts.keepTtl) {
        command.push("keepTtl");
      }
    }
    super(command, cmdOpts);
  }
};
var SetBitCommand = class extends Command {
  constructor(cmd, opts) {
    super(["setbit", ...cmd], opts);
  }
};
var SetExCommand = class extends Command {
  constructor(cmd, opts) {
    super(["setex", ...cmd], opts);
  }
};
var SetNxCommand = class extends Command {
  constructor(cmd, opts) {
    super(["setnx", ...cmd], opts);
  }
};
var SetRangeCommand = class extends Command {
  constructor(cmd, opts) {
    super(["setrange", ...cmd], opts);
  }
};
var SInterCommand = class extends Command {
  constructor(cmd, opts) {
    super(["sinter", ...cmd], opts);
  }
};
var SInterCardCommand = class extends Command {
  constructor(cmd, cmdOpts) {
    const [keys, opts] = cmd;
    const command = ["sintercard", keys.length, ...keys];
    if (opts?.limit !== void 0) {
      command.push("LIMIT", opts.limit);
    }
    super(command, cmdOpts);
  }
};
var SInterStoreCommand = class extends Command {
  constructor(cmd, opts) {
    super(["sinterstore", ...cmd], opts);
  }
};
var SIsMemberCommand = class extends Command {
  constructor(cmd, opts) {
    super(["sismember", ...cmd], opts);
  }
};
var SMembersCommand = class extends Command {
  constructor(cmd, opts) {
    super(["smembers", ...cmd], opts);
  }
};
var SMIsMemberCommand = class extends Command {
  constructor(cmd, opts) {
    super(["smismember", cmd[0], ...cmd[1]], opts);
  }
};
var SMoveCommand = class extends Command {
  constructor(cmd, opts) {
    super(["smove", ...cmd], opts);
  }
};
var SPopCommand = class extends Command {
  constructor([key, count], opts) {
    const command = ["spop", key];
    if (typeof count === "number") {
      command.push(count);
    }
    super(command, opts);
  }
};
var SRandMemberCommand = class extends Command {
  constructor([key, count], opts) {
    const command = ["srandmember", key];
    if (typeof count === "number") {
      command.push(count);
    }
    super(command, opts);
  }
};
var SRemCommand = class extends Command {
  constructor(cmd, opts) {
    super(["srem", ...cmd], opts);
  }
};
var SScanCommand = class extends Command {
  constructor([key, cursor, opts], cmdOpts) {
    const command = ["sscan", key, cursor];
    if (opts?.match) {
      command.push("match", opts.match);
    }
    if (typeof opts?.count === "number") {
      command.push("count", opts.count);
    }
    super(command, {
      deserialize: deserializeScanResponse,
      ...cmdOpts
    });
  }
};
var StrLenCommand = class extends Command {
  constructor(cmd, opts) {
    super(["strlen", ...cmd], opts);
  }
};
var SUnionCommand = class extends Command {
  constructor(cmd, opts) {
    super(["sunion", ...cmd], opts);
  }
};
var SUnionStoreCommand = class extends Command {
  constructor(cmd, opts) {
    super(["sunionstore", ...cmd], opts);
  }
};
var TimeCommand = class extends Command {
  constructor(opts) {
    super(["time"], opts);
  }
};
var TouchCommand = class extends Command {
  constructor(cmd, opts) {
    super(["touch", ...cmd], opts);
  }
};
var TtlCommand = class extends Command {
  constructor(cmd, opts) {
    super(["ttl", ...cmd], opts);
  }
};
var TypeCommand = class extends Command {
  constructor(cmd, opts) {
    super(["type", ...cmd], opts);
  }
};
var UnlinkCommand = class extends Command {
  constructor(cmd, opts) {
    super(["unlink", ...cmd], opts);
  }
};
var XAckCommand = class extends Command {
  constructor([key, group, id], opts) {
    const ids = Array.isArray(id) ? [...id] : [id];
    super(["XACK", key, group, ...ids], opts);
  }
};
var XAckDelCommand = class extends Command {
  constructor([key, group, opts, ...ids], cmdOpts) {
    const command = ["XACKDEL", key, group];
    command.push(opts.toUpperCase(), "IDS", ids.length, ...ids);
    super(command, cmdOpts);
  }
};
var XAddCommand = class extends Command {
  constructor([key, id, entries, opts], commandOptions) {
    const command = ["XADD", key];
    if (opts) {
      if (opts.nomkStream) {
        command.push("NOMKSTREAM");
      }
      if (opts.trim) {
        command.push(opts.trim.type, opts.trim.comparison, opts.trim.threshold);
        if (opts.trim.limit !== void 0) {
          command.push("LIMIT", opts.trim.limit);
        }
      }
    }
    command.push(id);
    for (const [k, v] of Object.entries(entries)) {
      command.push(k, v);
    }
    super(command, commandOptions);
  }
};
var XAutoClaim = class extends Command {
  constructor([key, group, consumer, minIdleTime, start, options], opts) {
    const commands = [];
    if (options?.count) {
      commands.push("COUNT", options.count);
    }
    if (options?.justId) {
      commands.push("JUSTID");
    }
    super(["XAUTOCLAIM", key, group, consumer, minIdleTime, start, ...commands], opts);
  }
};
var XClaimCommand = class extends Command {
  constructor([key, group, consumer, minIdleTime, id, options], opts) {
    const ids = Array.isArray(id) ? [...id] : [id];
    const commands = [];
    if (options?.idleMS) {
      commands.push("IDLE", options.idleMS);
    }
    if (options?.idleMS) {
      commands.push("TIME", options.timeMS);
    }
    if (options?.retryCount) {
      commands.push("RETRYCOUNT", options.retryCount);
    }
    if (options?.force) {
      commands.push("FORCE");
    }
    if (options?.justId) {
      commands.push("JUSTID");
    }
    if (options?.lastId) {
      commands.push("LASTID", options.lastId);
    }
    super(["XCLAIM", key, group, consumer, minIdleTime, ...ids, ...commands], opts);
  }
};
var XDelCommand = class extends Command {
  constructor([key, ids], opts) {
    const cmds = Array.isArray(ids) ? [...ids] : [ids];
    super(["XDEL", key, ...cmds], opts);
  }
};
var XDelExCommand = class extends Command {
  constructor([key, opts, ...ids], cmdOpts) {
    const command = ["XDELEX", key];
    if (opts) {
      command.push(opts.toUpperCase());
    }
    command.push("IDS", ids.length, ...ids);
    super(command, cmdOpts);
  }
};
var XGroupCommand = class extends Command {
  constructor([key, opts], commandOptions) {
    const command = ["XGROUP"];
    switch (opts.type) {
      case "CREATE": {
        command.push("CREATE", key, opts.group, opts.id);
        if (opts.options) {
          if (opts.options.MKSTREAM) {
            command.push("MKSTREAM");
          }
          if (opts.options.ENTRIESREAD !== void 0) {
            command.push("ENTRIESREAD", opts.options.ENTRIESREAD.toString());
          }
        }
        break;
      }
      case "CREATECONSUMER": {
        command.push("CREATECONSUMER", key, opts.group, opts.consumer);
        break;
      }
      case "DELCONSUMER": {
        command.push("DELCONSUMER", key, opts.group, opts.consumer);
        break;
      }
      case "DESTROY": {
        command.push("DESTROY", key, opts.group);
        break;
      }
      case "SETID": {
        command.push("SETID", key, opts.group, opts.id);
        if (opts.options?.ENTRIESREAD !== void 0) {
          command.push("ENTRIESREAD", opts.options.ENTRIESREAD.toString());
        }
        break;
      }
      default: {
        throw new Error("Invalid XGROUP");
      }
    }
    super(command, commandOptions);
  }
};
var XInfoCommand = class extends Command {
  constructor([key, options], opts) {
    const cmds = [];
    if (options.type === "CONSUMERS") {
      cmds.push("CONSUMERS", key, options.group);
    } else {
      cmds.push("GROUPS", key);
    }
    super(["XINFO", ...cmds], opts);
  }
};
var XLenCommand = class extends Command {
  constructor(cmd, opts) {
    super(["XLEN", ...cmd], opts);
  }
};
var XPendingCommand = class extends Command {
  constructor([key, group, start, end, count, options], opts) {
    const consumers = options?.consumer === void 0 ? [] : Array.isArray(options.consumer) ? [...options.consumer] : [options.consumer];
    super(
      [
        "XPENDING",
        key,
        group,
        ...options?.idleTime ? ["IDLE", options.idleTime] : [],
        start,
        end,
        count,
        ...consumers
      ],
      opts
    );
  }
};
function deserialize6(result) {
  const obj = {};
  for (const e of result) {
    for (let i = 0; i < e.length; i += 2) {
      const streamId = e[i];
      const entries = e[i + 1];
      if (!(streamId in obj)) {
        obj[streamId] = {};
      }
      for (let j = 0; j < entries.length; j += 2) {
        const field = entries[j];
        const value = entries[j + 1];
        try {
          obj[streamId][field] = JSON.parse(value);
        } catch {
          obj[streamId][field] = value;
        }
      }
    }
  }
  return obj;
}
var XRangeCommand = class extends Command {
  constructor([key, start, end, count], opts) {
    const command = ["XRANGE", key, start, end];
    if (typeof count === "number") {
      command.push("COUNT", count);
    }
    super(command, {
      deserialize: (result) => deserialize6(result),
      ...opts
    });
  }
};
var UNBALANCED_XREAD_ERR = "ERR Unbalanced XREAD list of streams: for each stream key an ID or '$' must be specified";
var XReadCommand = class extends Command {
  constructor([key, id, options], opts) {
    if (Array.isArray(key) && Array.isArray(id) && key.length !== id.length) {
      throw new Error(UNBALANCED_XREAD_ERR);
    }
    const commands = [];
    if (typeof options?.count === "number") {
      commands.push("COUNT", options.count);
    }
    if (typeof options?.blockMS === "number") {
      commands.push("BLOCK", options.blockMS);
    }
    commands.push(
      "STREAMS",
      ...Array.isArray(key) ? [...key] : [key],
      ...Array.isArray(id) ? [...id] : [id]
    );
    super(["XREAD", ...commands], opts);
  }
};
var UNBALANCED_XREADGROUP_ERR = "ERR Unbalanced XREADGROUP list of streams: for each stream key an ID or '$' must be specified";
var XReadGroupCommand = class extends Command {
  constructor([group, consumer, key, id, options], opts) {
    if (Array.isArray(key) && Array.isArray(id) && key.length !== id.length) {
      throw new Error(UNBALANCED_XREADGROUP_ERR);
    }
    const commands = [];
    if (typeof options?.count === "number") {
      commands.push("COUNT", options.count);
    }
    if (typeof options?.blockMS === "number") {
      commands.push("BLOCK", options.blockMS);
    }
    if (typeof options?.NOACK === "boolean" && options.NOACK) {
      commands.push("NOACK");
    }
    commands.push(
      "STREAMS",
      ...Array.isArray(key) ? [...key] : [key],
      ...Array.isArray(id) ? [...id] : [id]
    );
    super(["XREADGROUP", "GROUP", group, consumer, ...commands], opts);
  }
};
var XRevRangeCommand = class extends Command {
  constructor([key, end, start, count], opts) {
    const command = ["XREVRANGE", key, end, start];
    if (typeof count === "number") {
      command.push("COUNT", count);
    }
    super(command, {
      deserialize: (result) => deserialize7(result),
      ...opts
    });
  }
};
function deserialize7(result) {
  const obj = {};
  for (const e of result) {
    for (let i = 0; i < e.length; i += 2) {
      const streamId = e[i];
      const entries = e[i + 1];
      if (!(streamId in obj)) {
        obj[streamId] = {};
      }
      for (let j = 0; j < entries.length; j += 2) {
        const field = entries[j];
        const value = entries[j + 1];
        try {
          obj[streamId][field] = JSON.parse(value);
        } catch {
          obj[streamId][field] = value;
        }
      }
    }
  }
  return obj;
}
var XTrimCommand = class extends Command {
  constructor([key, options], opts) {
    const { limit, strategy, threshold, exactness = "~" } = options;
    super(["XTRIM", key, strategy, exactness, threshold, ...limit ? ["LIMIT", limit] : []], opts);
  }
};
var ZAddCommand = class extends Command {
  constructor([key, arg1, ...arg2], opts) {
    const command = ["zadd", key];
    if ("nx" in arg1 && arg1.nx) {
      command.push("nx");
    } else if ("xx" in arg1 && arg1.xx) {
      command.push("xx");
    }
    if ("ch" in arg1 && arg1.ch) {
      command.push("ch");
    }
    if ("incr" in arg1 && arg1.incr) {
      command.push("incr");
    }
    if ("lt" in arg1 && arg1.lt) {
      command.push("lt");
    } else if ("gt" in arg1 && arg1.gt) {
      command.push("gt");
    }
    if ("score" in arg1 && "member" in arg1) {
      command.push(arg1.score, arg1.member);
    }
    command.push(...arg2.flatMap(({ score, member }) => [score, member]));
    super(command, opts);
  }
};
var ZCardCommand = class extends Command {
  constructor(cmd, opts) {
    super(["zcard", ...cmd], opts);
  }
};
var ZCountCommand = class extends Command {
  constructor(cmd, opts) {
    super(["zcount", ...cmd], opts);
  }
};
var ZIncrByCommand = class extends Command {
  constructor(cmd, opts) {
    super(["zincrby", ...cmd], opts);
  }
};
var ZInterStoreCommand = class extends Command {
  constructor([destination, numKeys, keyOrKeys, opts], cmdOpts) {
    const command = ["zinterstore", destination, numKeys];
    if (Array.isArray(keyOrKeys)) {
      command.push(...keyOrKeys);
    } else {
      command.push(keyOrKeys);
    }
    if (opts) {
      if ("weights" in opts && opts.weights) {
        command.push("weights", ...opts.weights);
      } else if ("weight" in opts && typeof opts.weight === "number") {
        command.push("weights", opts.weight);
      }
      if ("aggregate" in opts) {
        command.push("aggregate", opts.aggregate);
      }
    }
    super(command, cmdOpts);
  }
};
var ZLexCountCommand = class extends Command {
  constructor(cmd, opts) {
    super(["zlexcount", ...cmd], opts);
  }
};
var ZPopMaxCommand = class extends Command {
  constructor([key, count], opts) {
    const command = ["zpopmax", key];
    if (typeof count === "number") {
      command.push(count);
    }
    super(command, opts);
  }
};
var ZPopMinCommand = class extends Command {
  constructor([key, count], opts) {
    const command = ["zpopmin", key];
    if (typeof count === "number") {
      command.push(count);
    }
    super(command, opts);
  }
};
var ZRangeCommand = class extends Command {
  constructor([key, min, max, opts], cmdOpts) {
    const command = ["zrange", key, min, max];
    if (opts?.byScore) {
      command.push("byscore");
    }
    if (opts?.byLex) {
      command.push("bylex");
    }
    if (opts?.rev) {
      command.push("rev");
    }
    if (opts?.count !== void 0 && opts.offset !== void 0) {
      command.push("limit", opts.offset, opts.count);
    }
    if (opts?.withScores) {
      command.push("withscores");
    }
    super(command, cmdOpts);
  }
};
var ZRankCommand = class extends Command {
  constructor(cmd, opts) {
    super(["zrank", ...cmd], opts);
  }
};
var ZRemCommand = class extends Command {
  constructor(cmd, opts) {
    super(["zrem", ...cmd], opts);
  }
};
var ZRemRangeByLexCommand = class extends Command {
  constructor(cmd, opts) {
    super(["zremrangebylex", ...cmd], opts);
  }
};
var ZRemRangeByRankCommand = class extends Command {
  constructor(cmd, opts) {
    super(["zremrangebyrank", ...cmd], opts);
  }
};
var ZRemRangeByScoreCommand = class extends Command {
  constructor(cmd, opts) {
    super(["zremrangebyscore", ...cmd], opts);
  }
};
var ZRevRankCommand = class extends Command {
  constructor(cmd, opts) {
    super(["zrevrank", ...cmd], opts);
  }
};
var ZScanCommand = class extends Command {
  constructor([key, cursor, opts], cmdOpts) {
    const command = ["zscan", key, cursor];
    if (opts?.match) {
      command.push("match", opts.match);
    }
    if (typeof opts?.count === "number") {
      command.push("count", opts.count);
    }
    super(command, {
      deserialize: deserializeScanResponse,
      ...cmdOpts
    });
  }
};
var ZScoreCommand = class extends Command {
  constructor(cmd, opts) {
    super(["zscore", ...cmd], opts);
  }
};
var ZUnionCommand = class extends Command {
  constructor([numKeys, keyOrKeys, opts], cmdOpts) {
    const command = ["zunion", numKeys];
    if (Array.isArray(keyOrKeys)) {
      command.push(...keyOrKeys);
    } else {
      command.push(keyOrKeys);
    }
    if (opts) {
      if ("weights" in opts && opts.weights) {
        command.push("weights", ...opts.weights);
      } else if ("weight" in opts && typeof opts.weight === "number") {
        command.push("weights", opts.weight);
      }
      if ("aggregate" in opts) {
        command.push("aggregate", opts.aggregate);
      }
      if (opts.withScores) {
        command.push("withscores");
      }
    }
    super(command, cmdOpts);
  }
};
var ZUnionStoreCommand = class extends Command {
  constructor([destination, numKeys, keyOrKeys, opts], cmdOpts) {
    const command = ["zunionstore", destination, numKeys];
    if (Array.isArray(keyOrKeys)) {
      command.push(...keyOrKeys);
    } else {
      command.push(keyOrKeys);
    }
    if (opts) {
      if ("weights" in opts && opts.weights) {
        command.push("weights", ...opts.weights);
      } else if ("weight" in opts && typeof opts.weight === "number") {
        command.push("weights", opts.weight);
      }
      if ("aggregate" in opts) {
        command.push("aggregate", opts.aggregate);
      }
    }
    super(command, cmdOpts);
  }
};
var ZDiffStoreCommand = class extends Command {
  constructor(cmd, opts) {
    super(["zdiffstore", ...cmd], opts);
  }
};
var ZMScoreCommand = class extends Command {
  constructor(cmd, opts) {
    const [key, members] = cmd;
    super(["zmscore", key, ...members], opts);
  }
};
var Pipeline = class {
  client;
  commands;
  commandOptions;
  multiExec;
  constructor(opts) {
    this.client = opts.client;
    this.commands = [];
    this.commandOptions = opts.commandOptions;
    this.multiExec = opts.multiExec ?? false;
    if (this.commandOptions?.latencyLogging) {
      const originalExec = this.exec.bind(this);
      this.exec = async (options) => {
        const start = performance.now();
        const result = await (options ? originalExec(options) : originalExec());
        const end = performance.now();
        const loggerResult = (end - start).toFixed(2);
        console.log(
          `Latency for \x1B[38;2;19;185;39m${this.multiExec ? ["MULTI-EXEC"] : ["PIPELINE"].toString().toUpperCase()}\x1B[0m: \x1B[38;2;0;255;255m${loggerResult} ms\x1B[0m`
        );
        return result;
      };
    }
  }
  exec = async (options) => {
    if (this.commands.length === 0) {
      throw new Error("Pipeline is empty");
    }
    const path = this.multiExec ? ["multi-exec"] : ["pipeline"];
    const res = await this.client.request({
      path,
      body: Object.values(this.commands).map((c) => c.command)
    });
    return options?.keepErrors ? res.map(({ error, result }, i) => {
      return {
        error,
        result: this.commands[i].deserialize(result)
      };
    }) : res.map(({ error, result }, i) => {
      if (error) {
        throw new UpstashError(
          `Command ${i + 1} [ ${this.commands[i].command[0]} ] failed: ${error}`
        );
      }
      return this.commands[i].deserialize(result);
    });
  };
  /**
   * Returns the length of pipeline before the execution
   */
  length() {
    return this.commands.length;
  }
  /**
   * Pushes a command into the pipeline and returns a chainable instance of the
   * pipeline
   */
  chain(command) {
    this.commands.push(command);
    return this;
  }
  /**
   * @see https://redis.io/commands/append
   */
  append = (...args) => this.chain(new AppendCommand(args, this.commandOptions));
  /**
   * @see https://upstash.com/docs/redis/commands/array/arcount
   */
  arcount = (...args) => this.chain(new ArCountCommand(args, this.commandOptions));
  /**
   * @see https://upstash.com/docs/redis/commands/array/ardel
   */
  ardel = (...args) => this.chain(new ArDelCommand(args, this.commandOptions));
  /**
   * @see https://upstash.com/docs/redis/commands/array/ardelrange
   */
  ardelrange = (...args) => this.chain(new ArDelRangeCommand(args, this.commandOptions));
  /**
   * @see https://upstash.com/docs/redis/commands/array/arget
   */
  arget = (...args) => this.chain(new ArGetCommand(args, this.commandOptions));
  /**
   * @see https://upstash.com/docs/redis/commands/array/argetrange
   */
  argetrange = (...args) => this.chain(new ArGetRangeCommand(args, this.commandOptions));
  /**
   * @see https://upstash.com/docs/redis/commands/array/argrep
   */
  argrep = (key, start, end, opts) => this.chain(new ArGrepCommand([key, start, end, opts], this.commandOptions));
  /**
   * @see https://upstash.com/docs/redis/commands/array/arinfo
   */
  arinfo = (...args) => this.chain(new ArInfoCommand(args, this.commandOptions));
  /**
   * @see https://upstash.com/docs/redis/commands/array/arinsert
   */
  arinsert = (key, ...values) => this.chain(new ArInsertCommand([key, ...values], this.commandOptions));
  /**
   * @see https://upstash.com/docs/redis/commands/array/arlastitems
   */
  arlastitems = (...args) => this.chain(new ArLastItemsCommand(args, this.commandOptions));
  /**
   * @see https://upstash.com/docs/redis/commands/array/arlen
   */
  arlen = (...args) => this.chain(new ArLenCommand(args, this.commandOptions));
  /**
   * @see https://upstash.com/docs/redis/commands/array/armget
   */
  armget = (...args) => this.chain(new ArMGetCommand(args, this.commandOptions));
  /**
   * @see https://upstash.com/docs/redis/commands/array/armset
   */
  armset = (key, values) => this.chain(new ArMSetCommand([key, values], this.commandOptions));
  /**
   * @see https://upstash.com/docs/redis/commands/array/arnext
   */
  arnext = (...args) => this.chain(new ArNextCommand(args, this.commandOptions));
  /**
   * @see https://upstash.com/docs/redis/commands/array/arop
   */
  arop = (key, start, end, operation) => this.chain(new ArOpCommand([key, start, end, operation], this.commandOptions));
  /**
   * @see https://upstash.com/docs/redis/commands/array/arring
   */
  arring = (key, size, ...values) => this.chain(new ArRingCommand([key, size, ...values], this.commandOptions));
  /**
   * @see https://upstash.com/docs/redis/commands/array/arscan
   */
  arscan = (...args) => this.chain(new ArScanCommand(args, this.commandOptions));
  /**
   * @see https://upstash.com/docs/redis/commands/array/arseek
   */
  arseek = (...args) => this.chain(new ArSeekCommand(args, this.commandOptions));
  /**
   * @see https://upstash.com/docs/redis/commands/array/arset
   */
  arset = (key, index, ...values) => this.chain(new ArSetCommand([key, index, ...values], this.commandOptions));
  /**
   * @see https://redis.io/commands/bitcount
   */
  bitcount = (...args) => this.chain(new BitCountCommand(args, this.commandOptions));
  /**
   * Returns an instance that can be used to execute `BITFIELD` commands on one key.
   *
   * @example
   * ```typescript
   * redis.set("mykey", 0);
   * const result = await redis.pipeline()
   *   .bitfield("mykey")
   *   .set("u4", 0, 16)
   *   .incr("u4", "#1", 1)
   *   .exec();
   * console.log(result); // [[0, 1]]
   * ```
   *
   * @see https://redis.io/commands/bitfield
   */
  bitfield = (...args) => new BitFieldCommand(args, this.client, this.commandOptions, this.chain.bind(this));
  /**
   * @see https://redis.io/commands/bitop
   */
  bitop = (op, destinationKey, sourceKey, ...sourceKeys) => this.chain(
    new BitOpCommand([op, destinationKey, sourceKey, ...sourceKeys], this.commandOptions)
  );
  /**
   * @see https://redis.io/commands/bitpos
   */
  bitpos = (...args) => this.chain(new BitPosCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/client-setinfo
   */
  clientSetinfo = (...args) => this.chain(new ClientSetInfoCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/copy
   */
  copy = (...args) => this.chain(new CopyCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/zdiffstore
   */
  zdiffstore = (...args) => this.chain(new ZDiffStoreCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/dbsize
   */
  dbsize = () => this.chain(new DBSizeCommand(this.commandOptions));
  /**
   * @see https://redis.io/commands/decr
   */
  decr = (...args) => this.chain(new DecrCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/decrby
   */
  decrby = (...args) => this.chain(new DecrByCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/del
   */
  del = (...args) => this.chain(new DelCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/echo
   */
  echo = (...args) => this.chain(new EchoCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/eval_ro
   */
  evalRo = (...args) => this.chain(new EvalROCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/eval
   */
  eval = (...args) => this.chain(new EvalCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/evalsha_ro
   */
  evalshaRo = (...args) => this.chain(new EvalshaROCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/evalsha
   */
  evalsha = (...args) => this.chain(new EvalshaCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/exists
   */
  exists = (...args) => this.chain(new ExistsCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/expire
   */
  expire = (...args) => this.chain(new ExpireCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/expireat
   */
  expireat = (...args) => this.chain(new ExpireAtCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/flushall
   */
  flushall = (args) => this.chain(new FlushAllCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/flushdb
   */
  flushdb = (...args) => this.chain(new FlushDBCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/geoadd
   */
  geoadd = (...args) => this.chain(new GeoAddCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/geodist
   */
  geodist = (...args) => this.chain(new GeoDistCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/geopos
   */
  geopos = (...args) => this.chain(new GeoPosCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/geohash
   */
  geohash = (...args) => this.chain(new GeoHashCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/geosearch
   */
  geosearch = (...args) => this.chain(new GeoSearchCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/geosearchstore
   */
  geosearchstore = (...args) => this.chain(new GeoSearchStoreCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/get
   */
  get = (...args) => this.chain(new GetCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/getbit
   */
  getbit = (...args) => this.chain(new GetBitCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/getdel
   */
  getdel = (...args) => this.chain(new GetDelCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/getex
   */
  getex = (...args) => this.chain(new GetExCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/getrange
   */
  getrange = (...args) => this.chain(new GetRangeCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/getset
   */
  getset = (key, value) => this.chain(new GetSetCommand([key, value], this.commandOptions));
  /**
   * @see https://redis.io/commands/hdel
   */
  hdel = (...args) => this.chain(new HDelCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hexists
   */
  hexists = (...args) => this.chain(new HExistsCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hexpire
   */
  hexpire = (...args) => this.chain(new HExpireCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hexpireat
   */
  hexpireat = (...args) => this.chain(new HExpireAtCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hexpiretime
   */
  hexpiretime = (...args) => this.chain(new HExpireTimeCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/httl
   */
  httl = (...args) => this.chain(new HTtlCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hpexpire
   */
  hpexpire = (...args) => this.chain(new HPExpireCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hpexpireat
   */
  hpexpireat = (...args) => this.chain(new HPExpireAtCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hpexpiretime
   */
  hpexpiretime = (...args) => this.chain(new HPExpireTimeCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hpttl
   */
  hpttl = (...args) => this.chain(new HPTtlCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hpersist
   */
  hpersist = (...args) => this.chain(new HPersistCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hget
   */
  hget = (...args) => this.chain(new HGetCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hgetall
   */
  hgetall = (...args) => this.chain(new HGetAllCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hgetdel
   */
  hgetdel = (...args) => this.chain(new HGetDelCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hgetex
   */
  hgetex = (...args) => this.chain(new HGetExCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hincrby
   */
  hincrby = (...args) => this.chain(new HIncrByCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hincrbyfloat
   */
  hincrbyfloat = (...args) => this.chain(new HIncrByFloatCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hkeys
   */
  hkeys = (...args) => this.chain(new HKeysCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hlen
   */
  hlen = (...args) => this.chain(new HLenCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hmget
   */
  hmget = (...args) => this.chain(new HMGetCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hmset
   */
  hmset = (key, kv) => this.chain(new HMSetCommand([key, kv], this.commandOptions));
  /**
   * @see https://redis.io/commands/hrandfield
   */
  hrandfield = (key, count, withValues) => this.chain(new HRandFieldCommand([key, count, withValues], this.commandOptions));
  /**
   * @see https://redis.io/commands/hscan
   */
  hscan = (...args) => this.chain(new HScanCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hset
   */
  hset = (key, kv) => this.chain(new HSetCommand([key, kv], this.commandOptions));
  /**
   * @see https://redis.io/commands/hsetex
   */
  hsetex = (...args) => this.chain(new HSetExCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hsetnx
   */
  hsetnx = (key, field, value) => this.chain(new HSetNXCommand([key, field, value], this.commandOptions));
  /**
   * @see https://redis.io/commands/hstrlen
   */
  hstrlen = (...args) => this.chain(new HStrLenCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/hvals
   */
  hvals = (...args) => this.chain(new HValsCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/incr
   */
  incr = (...args) => this.chain(new IncrCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/incrby
   */
  incrby = (...args) => this.chain(new IncrByCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/incrbyfloat
   */
  incrbyfloat = (...args) => this.chain(new IncrByFloatCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/keys
   */
  keys = (...args) => this.chain(new KeysCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/lindex
   */
  lindex = (...args) => this.chain(new LIndexCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/linsert
   */
  linsert = (key, direction, pivot, value) => this.chain(new LInsertCommand([key, direction, pivot, value], this.commandOptions));
  /**
   * @see https://redis.io/commands/llen
   */
  llen = (...args) => this.chain(new LLenCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/lmove
   */
  lmove = (...args) => this.chain(new LMoveCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/lpop
   */
  lpop = (...args) => this.chain(new LPopCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/lmpop
   */
  lmpop = (...args) => this.chain(new LmPopCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/lpos
   */
  lpos = (...args) => this.chain(new LPosCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/lpush
   */
  lpush = (key, ...elements) => this.chain(new LPushCommand([key, ...elements], this.commandOptions));
  /**
   * @see https://redis.io/commands/lpushx
   */
  lpushx = (key, ...elements) => this.chain(new LPushXCommand([key, ...elements], this.commandOptions));
  /**
   * @see https://redis.io/commands/lrange
   */
  lrange = (...args) => this.chain(new LRangeCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/lrem
   */
  lrem = (key, count, value) => this.chain(new LRemCommand([key, count, value], this.commandOptions));
  /**
   * @see https://redis.io/commands/lset
   */
  lset = (key, index, value) => this.chain(new LSetCommand([key, index, value], this.commandOptions));
  /**
   * @see https://redis.io/commands/ltrim
   */
  ltrim = (...args) => this.chain(new LTrimCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/mget
   */
  mget = (...args) => this.chain(new MGetCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/mset
   */
  mset = (kv) => this.chain(new MSetCommand([kv], this.commandOptions));
  /**
   * @see https://redis.io/commands/msetnx
   */
  msetnx = (kv) => this.chain(new MSetNXCommand([kv], this.commandOptions));
  /**
   * @see https://redis.io/commands/persist
   */
  persist = (...args) => this.chain(new PersistCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/pexpire
   */
  pexpire = (...args) => this.chain(new PExpireCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/pexpireat
   */
  pexpireat = (...args) => this.chain(new PExpireAtCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/pfadd
   */
  pfadd = (...args) => this.chain(new PfAddCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/pfcount
   */
  pfcount = (...args) => this.chain(new PfCountCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/pfmerge
   */
  pfmerge = (...args) => this.chain(new PfMergeCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/ping
   */
  ping = (args) => this.chain(new PingCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/psetex
   */
  psetex = (key, ttl, value) => this.chain(new PSetEXCommand([key, ttl, value], this.commandOptions));
  /**
   * @see https://redis.io/commands/pttl
   */
  pttl = (...args) => this.chain(new PTtlCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/publish
   */
  publish = (...args) => this.chain(new PublishCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/randomkey
   */
  randomkey = () => this.chain(new RandomKeyCommand(this.commandOptions));
  /**
   * @see https://redis.io/commands/rename
   */
  rename = (...args) => this.chain(new RenameCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/renamenx
   */
  renamenx = (...args) => this.chain(new RenameNXCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/rpop
   */
  rpop = (...args) => this.chain(new RPopCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/rpush
   */
  rpush = (key, ...elements) => this.chain(new RPushCommand([key, ...elements], this.commandOptions));
  /**
   * @see https://redis.io/commands/rpushx
   */
  rpushx = (key, ...elements) => this.chain(new RPushXCommand([key, ...elements], this.commandOptions));
  /**
   * @see https://redis.io/commands/sadd
   */
  sadd = (key, member, ...members) => this.chain(new SAddCommand([key, member, ...members], this.commandOptions));
  /**
   * @see https://redis.io/commands/scan
   */
  scan = (...args) => this.chain(new ScanCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/scard
   */
  scard = (...args) => this.chain(new SCardCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/script-exists
   */
  scriptExists = (...args) => this.chain(new ScriptExistsCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/script-flush
   */
  scriptFlush = (...args) => this.chain(new ScriptFlushCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/script-load
   */
  scriptLoad = (...args) => this.chain(new ScriptLoadCommand(args, this.commandOptions));
  /*)*
   * @see https://redis.io/commands/sdiff
   */
  sdiff = (...args) => this.chain(new SDiffCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/sdiffstore
   */
  sdiffstore = (...args) => this.chain(new SDiffStoreCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/set
   */
  set = (key, value, opts) => this.chain(new SetCommand([key, value, opts], this.commandOptions));
  /**
   * @see https://redis.io/commands/setbit
   */
  setbit = (...args) => this.chain(new SetBitCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/setex
   */
  setex = (key, ttl, value) => this.chain(new SetExCommand([key, ttl, value], this.commandOptions));
  /**
   * @see https://redis.io/commands/setnx
   */
  setnx = (key, value) => this.chain(new SetNxCommand([key, value], this.commandOptions));
  /**
   * @see https://redis.io/commands/setrange
   */
  setrange = (...args) => this.chain(new SetRangeCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/sinter
   */
  sinter = (...args) => this.chain(new SInterCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/sintercard
   */
  sintercard = (...args) => this.chain(new SInterCardCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/sinterstore
   */
  sinterstore = (...args) => this.chain(new SInterStoreCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/sismember
   */
  sismember = (key, member) => this.chain(new SIsMemberCommand([key, member], this.commandOptions));
  /**
   * @see https://redis.io/commands/smembers
   */
  smembers = (...args) => this.chain(new SMembersCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/smismember
   */
  smismember = (key, members) => this.chain(new SMIsMemberCommand([key, members], this.commandOptions));
  /**
   * @see https://redis.io/commands/smove
   */
  smove = (source, destination, member) => this.chain(new SMoveCommand([source, destination, member], this.commandOptions));
  /**
   * @see https://redis.io/commands/spop
   */
  spop = (...args) => this.chain(new SPopCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/srandmember
   */
  srandmember = (...args) => this.chain(new SRandMemberCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/srem
   */
  srem = (key, ...members) => this.chain(new SRemCommand([key, ...members], this.commandOptions));
  /**
   * @see https://redis.io/commands/sscan
   */
  sscan = (...args) => this.chain(new SScanCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/strlen
   */
  strlen = (...args) => this.chain(new StrLenCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/sunion
   */
  sunion = (...args) => this.chain(new SUnionCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/sunionstore
   */
  sunionstore = (...args) => this.chain(new SUnionStoreCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/time
   */
  time = () => this.chain(new TimeCommand(this.commandOptions));
  /**
   * @see https://redis.io/commands/touch
   */
  touch = (...args) => this.chain(new TouchCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/ttl
   */
  ttl = (...args) => this.chain(new TtlCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/type
   */
  type = (...args) => this.chain(new TypeCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/unlink
   */
  unlink = (...args) => this.chain(new UnlinkCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/zadd
   */
  zadd = (...args) => {
    if ("score" in args[1]) {
      return this.chain(
        new ZAddCommand([args[0], args[1], ...args.slice(2)], this.commandOptions)
      );
    }
    return this.chain(
      new ZAddCommand(
        [args[0], args[1], ...args.slice(2)],
        this.commandOptions
      )
    );
  };
  /**
   * @see https://redis.io/commands/xadd
   */
  xadd = (...args) => this.chain(new XAddCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/xack
   */
  xack = (...args) => this.chain(new XAckCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/xackdel
   */
  xackdel = (...args) => this.chain(new XAckDelCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/xdel
   */
  xdel = (...args) => this.chain(new XDelCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/xdelex
   */
  xdelex = (...args) => this.chain(new XDelExCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/xgroup
   */
  xgroup = (...args) => this.chain(new XGroupCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/xread
   */
  xread = (...args) => this.chain(new XReadCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/xreadgroup
   */
  xreadgroup = (...args) => this.chain(new XReadGroupCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/xinfo
   */
  xinfo = (...args) => this.chain(new XInfoCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/xlen
   */
  xlen = (...args) => this.chain(new XLenCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/xpending
   */
  xpending = (...args) => this.chain(new XPendingCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/xclaim
   */
  xclaim = (...args) => this.chain(new XClaimCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/xautoclaim
   */
  xautoclaim = (...args) => this.chain(new XAutoClaim(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/xtrim
   */
  xtrim = (...args) => this.chain(new XTrimCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/xrange
   */
  xrange = (...args) => this.chain(new XRangeCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/xrevrange
   */
  xrevrange = (...args) => this.chain(new XRevRangeCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/zcard
   */
  zcard = (...args) => this.chain(new ZCardCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/zcount
   */
  zcount = (...args) => this.chain(new ZCountCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/zincrby
   */
  zincrby = (key, increment, member) => this.chain(new ZIncrByCommand([key, increment, member], this.commandOptions));
  /**
   * @see https://redis.io/commands/zinterstore
   */
  zinterstore = (...args) => this.chain(new ZInterStoreCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/zlexcount
   */
  zlexcount = (...args) => this.chain(new ZLexCountCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/zmscore
   */
  zmscore = (...args) => this.chain(new ZMScoreCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/zpopmax
   */
  zpopmax = (...args) => this.chain(new ZPopMaxCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/zpopmin
   */
  zpopmin = (...args) => this.chain(new ZPopMinCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/zrange
   */
  zrange = (...args) => this.chain(new ZRangeCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/zrank
   */
  zrank = (key, member) => this.chain(new ZRankCommand([key, member], this.commandOptions));
  /**
   * @see https://redis.io/commands/zrem
   */
  zrem = (key, ...members) => this.chain(new ZRemCommand([key, ...members], this.commandOptions));
  /**
   * @see https://redis.io/commands/zremrangebylex
   */
  zremrangebylex = (...args) => this.chain(new ZRemRangeByLexCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/zremrangebyrank
   */
  zremrangebyrank = (...args) => this.chain(new ZRemRangeByRankCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/zremrangebyscore
   */
  zremrangebyscore = (...args) => this.chain(new ZRemRangeByScoreCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/zrevrank
   */
  zrevrank = (key, member) => this.chain(new ZRevRankCommand([key, member], this.commandOptions));
  /**
   * @see https://redis.io/commands/zscan
   */
  zscan = (...args) => this.chain(new ZScanCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/zscore
   */
  zscore = (key, member) => this.chain(new ZScoreCommand([key, member], this.commandOptions));
  /**
   * @see https://redis.io/commands/zunionstore
   */
  zunionstore = (...args) => this.chain(new ZUnionStoreCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/zunion
   */
  zunion = (...args) => this.chain(new ZUnionCommand(args, this.commandOptions));
  /**
   * @see https://redis.io/commands/?group=json
   */
  get json() {
    return {
      /**
       * @see https://redis.io/commands/json.arrappend
       */
      arrappend: (...args) => this.chain(new JsonArrAppendCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.arrindex
       */
      arrindex: (...args) => this.chain(new JsonArrIndexCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.arrinsert
       */
      arrinsert: (...args) => this.chain(new JsonArrInsertCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.arrlen
       */
      arrlen: (...args) => this.chain(new JsonArrLenCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.arrpop
       */
      arrpop: (...args) => this.chain(new JsonArrPopCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.arrtrim
       */
      arrtrim: (...args) => this.chain(new JsonArrTrimCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.clear
       */
      clear: (...args) => this.chain(new JsonClearCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.del
       */
      del: (...args) => this.chain(new JsonDelCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.forget
       */
      forget: (...args) => this.chain(new JsonForgetCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.get
       */
      get: (...args) => this.chain(new JsonGetCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.merge
       */
      merge: (...args) => this.chain(new JsonMergeCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.mget
       */
      mget: (...args) => this.chain(new JsonMGetCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.mset
       */
      mset: (...args) => this.chain(new JsonMSetCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.numincrby
       */
      numincrby: (...args) => this.chain(new JsonNumIncrByCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.nummultby
       */
      nummultby: (...args) => this.chain(new JsonNumMultByCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.objkeys
       */
      objkeys: (...args) => this.chain(new JsonObjKeysCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.objlen
       */
      objlen: (...args) => this.chain(new JsonObjLenCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.resp
       */
      resp: (...args) => this.chain(new JsonRespCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.set
       */
      set: (...args) => this.chain(new JsonSetCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.strappend
       */
      strappend: (...args) => this.chain(new JsonStrAppendCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.strlen
       */
      strlen: (...args) => this.chain(new JsonStrLenCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.toggle
       */
      toggle: (...args) => this.chain(new JsonToggleCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/commands/json.type
       */
      type: (...args) => this.chain(new JsonTypeCommand(args, this.commandOptions))
    };
  }
  get functions() {
    return {
      /**
       * @see https://redis.io/docs/latest/commands/function-load/
       */
      load: (...args) => this.chain(new FunctionLoadCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/docs/latest/commands/function-list/
       */
      list: (...args) => this.chain(new FunctionListCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/docs/latest/commands/function-delete/
       */
      delete: (...args) => this.chain(new FunctionDeleteCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/docs/latest/commands/function-flush/
       */
      flush: () => this.chain(new FunctionFlushCommand(this.commandOptions)),
      /**
       * @see https://redis.io/docs/latest/commands/function-stats/
       */
      stats: () => this.chain(new FunctionStatsCommand(this.commandOptions)),
      /**
       * @see https://redis.io/docs/latest/commands/fcall/
       */
      call: (...args) => this.chain(new FCallCommand(args, this.commandOptions)),
      /**
       * @see https://redis.io/docs/latest/commands/fcall_ro/
       */
      callRo: (...args) => this.chain(new FCallRoCommand(args, this.commandOptions))
    };
  }
};
var MAX_PIPELINE_SIZE = 1e3;
var READ_COMMANDS = /* @__PURE__ */ new Set([
  // Array
  "arcount",
  "arget",
  "argetrange",
  "argrep",
  "arinfo",
  "arlastitems",
  "arlen",
  "armget",
  "arnext",
  "arop",
  "arscan",
  // String
  "get",
  "getrange",
  "mget",
  "strlen",
  // Bit
  "bitcount",
  "bitpos",
  "getbit",
  // Hash
  "hexists",
  "hget",
  "hgetall",
  "hkeys",
  "hlen",
  "hmget",
  "hrandfield",
  "hscan",
  "hstrlen",
  "httl",
  "hvals",
  "hexpiretime",
  "hpexpiretime",
  "hpttl",
  // List
  "lindex",
  "llen",
  "lpos",
  "lrange",
  // Set
  "scard",
  "sdiff",
  "sinter",
  "sintercard",
  "sismember",
  "smembers",
  "smismember",
  "srandmember",
  "sscan",
  "sunion",
  // Sorted set
  "zcard",
  "zcount",
  "zlexcount",
  "zmscore",
  "zrange",
  "zrank",
  "zrevrank",
  "zscan",
  "zscore",
  "zunion",
  // Key metadata
  "exists",
  "type",
  "ttl",
  "pttl",
  "randomkey",
  "touch",
  // HyperLogLog
  "pfcount",
  // Stream
  "xinfo",
  "xlen",
  "xpending",
  "xrange",
  "xread",
  "xrevrange",
  // Geo
  "geodist",
  "geohash",
  "geopos",
  "geosearch",
  // Script / eval
  "scriptExists",
  "evalRo",
  "evalshaRo",
  // Utility
  "dbsize",
  "echo",
  "ping",
  "time",
  "scan",
  "keys",
  // JSON namespace
  "arrindex",
  "arrlen",
  "objkeys",
  "objlen",
  "resp",
  // Functions namespace
  "list",
  "stats",
  "callRo"
]);
var EXCLUDE_COMMANDS = /* @__PURE__ */ new Set([
  "scan",
  "keys",
  "flushdb",
  "flushall",
  "dbsize",
  "hscan",
  "hgetall",
  "hkeys",
  "lrange",
  "sscan",
  "smembers",
  "xrange",
  "xrevrange",
  "zscan",
  "zrange",
  "exec"
]);
function createAutoPipelineProxy(_redis, namespace = "root") {
  const redis2 = _redis;
  if (!redis2.autoPipelineExecutor) {
    redis2.autoPipelineExecutor = new AutoPipelineExecutor(redis2);
  }
  return new Proxy(redis2, {
    get: (redis22, command) => {
      if (command === "pipelineCounter") {
        return redis22.autoPipelineExecutor.pipelineCounter;
      }
      if (namespace === "root" && command === "json") {
        return createAutoPipelineProxy(redis22, "json");
      }
      if (namespace === "root" && command === "functions") {
        return createAutoPipelineProxy(redis22, "functions");
      }
      if (namespace === "root") {
        const commandInRedisButNotPipeline = command in redis22 && !(command in redis22.autoPipelineExecutor.pipeline);
        const isCommandExcluded = EXCLUDE_COMMANDS.has(command);
        if (commandInRedisButNotPipeline || isCommandExcluded) {
          return redis22[command];
        }
      }
      const pipeline = redis22.autoPipelineExecutor.pipeline;
      const targetFunction = namespace === "json" ? pipeline.json[command] : namespace === "functions" ? pipeline.functions[command] : pipeline[command];
      const isFunction = typeof targetFunction === "function";
      if (isFunction) {
        return (...args) => {
          const commandMode = READ_COMMANDS.has(command) ? "read" : "write";
          return redis22.autoPipelineExecutor.withAutoPipeline(commandMode, (pipeline2) => {
            const targetFunction2 = namespace === "json" ? pipeline2.json[command] : namespace === "functions" ? pipeline2.functions[command] : pipeline2[command];
            targetFunction2(...args);
          });
        };
      }
      return targetFunction;
    }
  });
}
var AutoPipelineExecutor = class {
  pipelinePromises = /* @__PURE__ */ new WeakMap();
  activeReadPipeline = null;
  activeWritePipeline = null;
  readIndex = 0;
  writeIndex = 0;
  redis;
  pipeline;
  // only to make sure that proxy can work
  pipelineCounter = 0;
  // to keep track of how many times a pipeline was executed
  constructor(redis2) {
    this.redis = redis2;
    this.pipeline = redis2.pipeline();
  }
  async withAutoPipeline(commandMode, executeWithPipeline) {
    const isRead = commandMode === "read";
    const activePipeline = isRead ? this.activeReadPipeline : this.activeWritePipeline;
    const pipeline = activePipeline ?? this.redis.pipeline();
    if (!activePipeline) {
      if (isRead) {
        this.activeReadPipeline = pipeline;
        this.readIndex = 0;
      } else {
        this.activeWritePipeline = pipeline;
        this.writeIndex = 0;
      }
    }
    const index = isRead ? this.readIndex++ : this.writeIndex++;
    executeWithPipeline(pipeline);
    if (isRead && this.readIndex >= MAX_PIPELINE_SIZE) {
      this.activeReadPipeline = null;
    } else if (!isRead && this.writeIndex >= MAX_PIPELINE_SIZE) {
      this.activeWritePipeline = null;
    }
    const pipelineDone = this.deferExecution().then(() => {
      if (!this.pipelinePromises.has(pipeline)) {
        const pipelinePromise = pipeline.exec({ keepErrors: true });
        this.pipelineCounter += 1;
        this.pipelinePromises.set(pipeline, pipelinePromise);
        if (this.activeReadPipeline === pipeline) {
          this.activeReadPipeline = null;
        }
        if (this.activeWritePipeline === pipeline) {
          this.activeWritePipeline = null;
        }
      }
      return this.pipelinePromises.get(pipeline);
    });
    const results = await pipelineDone;
    const commandResult = results[index];
    if (commandResult.error) {
      throw new UpstashError(`Command failed: ${commandResult.error}`);
    }
    return commandResult.result;
  }
  async deferExecution() {
    await Promise.resolve();
    await Promise.resolve();
  }
};
var PSubscribeCommand = class extends Command {
  constructor(cmd, opts) {
    const sseHeaders = {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    };
    super([], {
      ...opts,
      headers: sseHeaders,
      path: ["psubscribe", ...cmd],
      streamOptions: {
        isStreaming: true,
        onMessage: opts?.streamOptions?.onMessage,
        signal: opts?.streamOptions?.signal
      }
    });
  }
};
var Subscriber = class extends EventTarget {
  subscriptions;
  client;
  listeners;
  opts;
  constructor(client, channels, isPattern = false, opts) {
    super();
    this.client = client;
    this.subscriptions = /* @__PURE__ */ new Map();
    this.listeners = /* @__PURE__ */ new Map();
    this.opts = opts;
    for (const channel of channels) {
      if (isPattern) {
        this.subscribeToPattern(channel);
      } else {
        this.subscribeToChannel(channel);
      }
    }
  }
  subscribeToChannel(channel) {
    const controller = new AbortController();
    const command = new SubscribeCommand([channel], {
      streamOptions: {
        signal: controller.signal,
        onMessage: (data) => this.handleMessage(data, false)
      }
    });
    command.exec(this.client).catch((error) => {
      if (error.name !== "AbortError") {
        this.dispatchToListeners("error", error);
      }
    });
    this.subscriptions.set(channel, {
      command,
      controller,
      isPattern: false
    });
  }
  subscribeToPattern(pattern) {
    const controller = new AbortController();
    const command = new PSubscribeCommand([pattern], {
      streamOptions: {
        signal: controller.signal,
        onMessage: (data) => this.handleMessage(data, true)
      }
    });
    command.exec(this.client).catch((error) => {
      if (error.name !== "AbortError") {
        this.dispatchToListeners("error", error);
      }
    });
    this.subscriptions.set(pattern, {
      command,
      controller,
      isPattern: true
    });
  }
  handleMessage(data, isPattern) {
    const messageData = data.replace(/^data:\s*/, "");
    const firstCommaIndex = messageData.indexOf(",");
    const secondCommaIndex = messageData.indexOf(",", firstCommaIndex + 1);
    const thirdCommaIndex = isPattern ? messageData.indexOf(",", secondCommaIndex + 1) : -1;
    if (firstCommaIndex !== -1 && secondCommaIndex !== -1) {
      const type = messageData.slice(0, firstCommaIndex);
      if (isPattern && type === "pmessage" && thirdCommaIndex !== -1) {
        const pattern = messageData.slice(firstCommaIndex + 1, secondCommaIndex);
        const channel = messageData.slice(secondCommaIndex + 1, thirdCommaIndex);
        const messageStr = messageData.slice(thirdCommaIndex + 1);
        try {
          const message = this.opts?.automaticDeserialization === false ? messageStr : JSON.parse(messageStr);
          this.dispatchToListeners("pmessage", { pattern, channel, message });
          this.dispatchToListeners(`pmessage:${pattern}`, { pattern, channel, message });
        } catch (error) {
          this.dispatchToListeners("error", new Error(`Failed to parse message: ${error}`));
        }
      } else {
        const channel = messageData.slice(firstCommaIndex + 1, secondCommaIndex);
        const messageStr = messageData.slice(secondCommaIndex + 1);
        try {
          if (type === "subscribe" || type === "psubscribe" || type === "unsubscribe" || type === "punsubscribe") {
            const count = Number.parseInt(messageStr);
            this.dispatchToListeners(type, count);
          } else {
            const message = this.opts?.automaticDeserialization === false ? messageStr : parseWithTryCatch(messageStr);
            this.dispatchToListeners(type, { channel, message });
            this.dispatchToListeners(`${type}:${channel}`, { channel, message });
          }
        } catch (error) {
          this.dispatchToListeners("error", new Error(`Failed to parse message: ${error}`));
        }
      }
    }
  }
  dispatchToListeners(type, data) {
    const listeners = this.listeners.get(type);
    if (listeners) {
      for (const listener of listeners) {
        listener(data);
      }
    }
  }
  on(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, /* @__PURE__ */ new Set());
    }
    this.listeners.get(type)?.add(listener);
  }
  removeAllListeners() {
    this.listeners.clear();
  }
  async unsubscribe(channels) {
    if (channels) {
      for (const channel of channels) {
        const subscription = this.subscriptions.get(channel);
        if (subscription) {
          try {
            subscription.controller.abort();
          } catch {
          }
          this.subscriptions.delete(channel);
        }
      }
    } else {
      for (const subscription of this.subscriptions.values()) {
        try {
          subscription.controller.abort();
        } catch {
        }
      }
      this.subscriptions.clear();
      this.removeAllListeners();
    }
  }
  getSubscribedChannels() {
    return [...this.subscriptions.keys()];
  }
};
var SubscribeCommand = class extends Command {
  constructor(cmd, opts) {
    const sseHeaders = {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    };
    super([], {
      ...opts,
      headers: sseHeaders,
      path: ["subscribe", ...cmd],
      streamOptions: {
        isStreaming: true,
        onMessage: opts?.streamOptions?.onMessage,
        signal: opts?.streamOptions?.signal
      }
    });
  }
};
var parseWithTryCatch = (str) => {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
};
var Script = class {
  script;
  /**
   * @deprecated This property is initialized to an empty string and will be set in the init method
   * asynchronously. Do not use this property immidiately after the constructor.
   *
   * This property is only exposed for backwards compatibility and will be removed in the
   * future major release.
   */
  sha1;
  initPromise;
  redis;
  constructor(redis2, script) {
    this.redis = redis2;
    this.script = script;
    this.sha1 = "";
    void this.init(script);
  }
  /**
   * Initialize the script by computing its SHA-1 hash.
   */
  init(script) {
    if (!this.initPromise) {
      this.initPromise = this.digest(script).then((sha1) => {
        this.sha1 = sha1;
      });
    }
    return this.initPromise;
  }
  /**
   * Send an `EVAL` command to redis.
   */
  async eval(keys, args) {
    await this.init(this.script);
    return await this.redis.eval(this.script, keys, args);
  }
  /**
   * Calculates the sha1 hash of the script and then calls `EVALSHA`.
   */
  async evalsha(keys, args) {
    await this.init(this.script);
    return await this.redis.evalsha(this.sha1, keys, args);
  }
  /**
   * Optimistically try to run `EVALSHA` first.
   * If the script is not loaded in redis, it will fall back and try again with `EVAL`.
   *
   * Following calls will be able to use the cached script
   */
  async exec(keys, args) {
    await this.init(this.script);
    const res = await this.redis.evalsha(this.sha1, keys, args).catch(async (error) => {
      if (error instanceof Error && error.message.toLowerCase().includes("noscript")) {
        return await this.redis.eval(this.script, keys, args);
      }
      throw error;
    });
    return res;
  }
  /**
   * Compute the sha1 hash of the script and return its hex representation.
   */
  async digest(s) {
    const data = new TextEncoder().encode(s);
    const hashBuffer = await subtle.digest("SHA-1", data);
    const hashArray = [...new Uint8Array(hashBuffer)];
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
};
var ScriptRO = class {
  script;
  /**
   * @deprecated This property is initialized to an empty string and will be set in the init method
   * asynchronously. Do not use this property immidiately after the constructor.
   *
   * This property is only exposed for backwards compatibility and will be removed in the
   * future major release.
   */
  sha1;
  initPromise;
  redis;
  constructor(redis2, script) {
    this.redis = redis2;
    this.sha1 = "";
    this.script = script;
    void this.init(script);
  }
  init(script) {
    if (!this.initPromise) {
      this.initPromise = this.digest(script).then((sha1) => {
        this.sha1 = sha1;
      });
    }
    return this.initPromise;
  }
  /**
   * Send an `EVAL_RO` command to redis.
   */
  async evalRo(keys, args) {
    await this.init(this.script);
    return await this.redis.evalRo(this.script, keys, args);
  }
  /**
   * Calculates the sha1 hash of the script and then calls `EVALSHA_RO`.
   */
  async evalshaRo(keys, args) {
    await this.init(this.script);
    return await this.redis.evalshaRo(this.sha1, keys, args);
  }
  /**
   * Optimistically try to run `EVALSHA_RO` first.
   * If the script is not loaded in redis, it will fall back and try again with `EVAL_RO`.
   *
   * Following calls will be able to use the cached script
   */
  async exec(keys, args) {
    await this.init(this.script);
    const res = await this.redis.evalshaRo(this.sha1, keys, args).catch(async (error) => {
      if (error instanceof Error && error.message.toLowerCase().includes("noscript")) {
        return await this.redis.evalRo(this.script, keys, args);
      }
      throw error;
    });
    return res;
  }
  /**
   * Compute the sha1 hash of the script and return its hex representation.
   */
  async digest(s) {
    const data = new TextEncoder().encode(s);
    const hashBuffer = await subtle.digest("SHA-1", data);
    const hashArray = [...new Uint8Array(hashBuffer)];
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
};
var Redis = class {
  client;
  opts;
  enableTelemetry;
  enableAutoPipelining;
  /**
   * Create a new redis client
   *
   * @example
   * ```typescript
   * const redis = new Redis({
   *  url: "<UPSTASH_REDIS_REST_URL>",
   *  token: "<UPSTASH_REDIS_REST_TOKEN>",
   * });
   * ```
   */
  constructor(client, opts) {
    this.client = client;
    this.opts = opts;
    this.enableTelemetry = opts?.enableTelemetry ?? true;
    if (opts?.readYourWrites === false) {
      this.client.readYourWrites = false;
    }
    this.enableAutoPipelining = opts?.enableAutoPipelining ?? true;
  }
  get readYourWritesSyncToken() {
    return this.client.upstashSyncToken;
  }
  set readYourWritesSyncToken(session) {
    this.client.upstashSyncToken = session;
  }
  get json() {
    return {
      /**
       * @see https://redis.io/commands/json.arrappend
       */
      arrappend: (...args) => new JsonArrAppendCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.arrindex
       */
      arrindex: (...args) => new JsonArrIndexCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.arrinsert
       */
      arrinsert: (...args) => new JsonArrInsertCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.arrlen
       */
      arrlen: (...args) => new JsonArrLenCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.arrpop
       */
      arrpop: (...args) => new JsonArrPopCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.arrtrim
       */
      arrtrim: (...args) => new JsonArrTrimCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.clear
       */
      clear: (...args) => new JsonClearCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.del
       */
      del: (...args) => new JsonDelCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.forget
       */
      forget: (...args) => new JsonForgetCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.get
       */
      get: (...args) => new JsonGetCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.merge
       */
      merge: (...args) => new JsonMergeCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.mget
       */
      mget: (...args) => new JsonMGetCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.mset
       */
      mset: (...args) => new JsonMSetCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.numincrby
       */
      numincrby: (...args) => new JsonNumIncrByCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.nummultby
       */
      nummultby: (...args) => new JsonNumMultByCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.objkeys
       */
      objkeys: (...args) => new JsonObjKeysCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.objlen
       */
      objlen: (...args) => new JsonObjLenCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.resp
       */
      resp: (...args) => new JsonRespCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.set
       */
      set: (...args) => new JsonSetCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.strappend
       */
      strappend: (...args) => new JsonStrAppendCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.strlen
       */
      strlen: (...args) => new JsonStrLenCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.toggle
       */
      toggle: (...args) => new JsonToggleCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/commands/json.type
       */
      type: (...args) => new JsonTypeCommand(args, this.opts).exec(this.client)
    };
  }
  get functions() {
    return {
      /**
       * @see https://redis.io/docs/latest/commands/function-load/
       */
      load: (...args) => new FunctionLoadCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/docs/latest/commands/function-list/
       */
      list: (...args) => new FunctionListCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/docs/latest/commands/function-delete/
       */
      delete: (...args) => new FunctionDeleteCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/docs/latest/commands/function-flush/
       */
      flush: () => new FunctionFlushCommand(this.opts).exec(this.client),
      /**
       * @see https://redis.io/docs/latest/commands/function-stats/
       *
       * Note: `running_script` field is not supported and therefore not included in the type.
       */
      stats: () => new FunctionStatsCommand(this.opts).exec(this.client),
      /**
       * @see https://redis.io/docs/latest/commands/fcall/
       */
      call: (...args) => new FCallCommand(args, this.opts).exec(this.client),
      /**
       * @see https://redis.io/docs/latest/commands/fcall_ro/
       */
      callRo: (...args) => new FCallRoCommand(args, this.opts).exec(this.client)
    };
  }
  /**
   * Wrap a new middleware around the HTTP client.
   */
  use = (middleware) => {
    const makeRequest = this.client.request.bind(this.client);
    this.client.request = (req) => middleware(req, makeRequest);
  };
  /**
   * Technically this is not private, we can hide it from intellisense by doing this
   */
  addTelemetry = (telemetry) => {
    if (!this.enableTelemetry) {
      return;
    }
    try {
      this.client.mergeTelemetry(telemetry);
    } catch {
    }
  };
  /**
   * Creates a new script.
   *
   * Scripts offer the ability to optimistically try to execute a script without having to send the
   * entire script to the server. If the script is loaded on the server, it tries again by sending
   * the entire script. Afterwards, the script is cached on the server.
   *
   * @param script - The script to create
   * @param opts - Optional options to pass to the script `{ readonly?: boolean }`
   * @returns A new script
   *
   * @example
   * ```ts
   * const redis = new Redis({...})
   *
   * const script = redis.createScript<string>("return ARGV[1];")
   * const arg1 = await script.eval([], ["Hello World"])
   * expect(arg1, "Hello World")
   * ```
   * @example
   * ```ts
   * const redis = new Redis({...})
   *
   * const script = redis.createScript<string>("return ARGV[1];", { readonly: true })
   * const arg1 = await script.evalRo([], ["Hello World"])
   * expect(arg1, "Hello World")
   * ```
   */
  createScript(script, opts) {
    return opts?.readonly ? new ScriptRO(this, script) : new Script(this, script);
  }
  get search() {
    return {
      createIndex: (params) => {
        return createIndex(this.client, params);
      },
      index: (params) => {
        return initIndex(this.client, params);
      },
      alias: {
        list: () => {
          return listAliases(this.client);
        },
        add: ({ indexName, alias }) => {
          return addAlias(this.client, { indexName, alias });
        },
        delete: ({ alias }) => {
          return delAlias(this.client, { alias });
        }
      }
    };
  }
  /**
   * Vector index commands.
   *
   * @example
   * ```typescript
   * const index = await redis.vector.createIndex({ name: "docs", dimension: 3, metric: "COSINE" });
   * await index.add("doc-1", [0.1, 0.2, 0.3]);
   * const hits = await index.query({ vector: [0.1, 0.2, 0.3], topK: 5 });
   * ```
   */
  get vector() {
    return {
      /**
       * Creates a vector index and returns a handle to it.
       */
      createIndex: (params) => {
        return createVectorIndex(this.client, params, this.opts);
      },
      /**
       * Returns a handle to an existing vector index without sending any command.
       */
      index: (name) => {
        return initVectorIndex(this.client, name, this.opts);
      }
    };
  }
  /**
   * Create a new pipeline that allows you to send requests in bulk.
   *
   * @see {@link Pipeline}
   */
  pipeline = () => new Pipeline({
    client: this.client,
    commandOptions: this.opts,
    multiExec: false
  });
  autoPipeline = () => {
    return createAutoPipelineProxy(this);
  };
  /**
   * Create a new transaction to allow executing multiple steps atomically.
   *
   * All the commands in a transaction are serialized and executed sequentially. A request sent by
   * another client will never be served in the middle of the execution of a Redis Transaction. This
   * guarantees that the commands are executed as a single isolated operation.
   *
   * @see {@link Pipeline}
   */
  multi = () => new Pipeline({
    client: this.client,
    commandOptions: this.opts,
    multiExec: true
  });
  /**
   * Returns an instance that can be used to execute `BITFIELD` commands on one key.
   *
   * @example
   * ```typescript
   * redis.set("mykey", 0);
   * const result = await redis.bitfield("mykey")
   *   .set("u4", 0, 16)
   *   .incr("u4", "#1", 1)
   *   .exec();
   * console.log(result); // [0, 1]
   * ```
   *
   * @see https://redis.io/commands/bitfield
   */
  bitfield = (...args) => new BitFieldCommand(args, this.client, this.opts);
  /**
   * @see https://redis.io/commands/append
   */
  append = (...args) => new AppendCommand(args, this.opts).exec(this.client);
  /**
   * @see https://upstash.com/docs/redis/commands/array/arcount
   */
  arcount = (...args) => new ArCountCommand(args, this.opts).exec(this.client);
  /**
   * @see https://upstash.com/docs/redis/commands/array/ardel
   */
  ardel = (...args) => new ArDelCommand(args, this.opts).exec(this.client);
  /**
   * @see https://upstash.com/docs/redis/commands/array/ardelrange
   */
  ardelrange = (...args) => new ArDelRangeCommand(args, this.opts).exec(this.client);
  /**
   * @see https://upstash.com/docs/redis/commands/array/arget
   */
  arget = (...args) => new ArGetCommand(args, this.opts).exec(this.client);
  /**
   * @see https://upstash.com/docs/redis/commands/array/argetrange
   */
  argetrange = (...args) => new ArGetRangeCommand(args, this.opts).exec(this.client);
  /**
   * @see https://upstash.com/docs/redis/commands/array/argrep
   */
  argrep = (key, start, end, opts) => new ArGrepCommand([key, start, end, opts], this.opts).exec(this.client);
  /**
   * @see https://upstash.com/docs/redis/commands/array/arinfo
   */
  arinfo = (...args) => new ArInfoCommand(args, this.opts).exec(this.client);
  /**
   * @see https://upstash.com/docs/redis/commands/array/arinsert
   */
  arinsert = (key, ...values) => new ArInsertCommand([key, ...values], this.opts).exec(this.client);
  /**
   * @see https://upstash.com/docs/redis/commands/array/arlastitems
   */
  arlastitems = (...args) => new ArLastItemsCommand(args, this.opts).exec(this.client);
  /**
   * @see https://upstash.com/docs/redis/commands/array/arlen
   */
  arlen = (...args) => new ArLenCommand(args, this.opts).exec(this.client);
  /**
   * @see https://upstash.com/docs/redis/commands/array/armget
   */
  armget = (...args) => new ArMGetCommand(args, this.opts).exec(this.client);
  /**
   * @see https://upstash.com/docs/redis/commands/array/armset
   */
  armset = (key, values) => new ArMSetCommand([key, values], this.opts).exec(this.client);
  /**
   * @see https://upstash.com/docs/redis/commands/array/arnext
   */
  arnext = (...args) => new ArNextCommand(args, this.opts).exec(this.client);
  /**
   * @see https://upstash.com/docs/redis/commands/array/arop
   */
  arop = (key, start, end, operation) => new ArOpCommand([key, start, end, operation], this.opts).exec(this.client);
  /**
   * @see https://upstash.com/docs/redis/commands/array/arring
   */
  arring = (key, size, ...values) => new ArRingCommand([key, size, ...values], this.opts).exec(this.client);
  /**
   * @see https://upstash.com/docs/redis/commands/array/arscan
   */
  arscan = (...args) => new ArScanCommand(args, this.opts).exec(this.client);
  /**
   * @see https://upstash.com/docs/redis/commands/array/arseek
   */
  arseek = (...args) => new ArSeekCommand(args, this.opts).exec(this.client);
  /**
   * @see https://upstash.com/docs/redis/commands/array/arset
   */
  arset = (key, index, ...values) => new ArSetCommand([key, index, ...values], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/bitcount
   */
  bitcount = (...args) => new BitCountCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/bitop
   */
  bitop = (op, destinationKey, sourceKey, ...sourceKeys) => new BitOpCommand([op, destinationKey, sourceKey, ...sourceKeys], this.opts).exec(
    this.client
  );
  /**
   * @see https://redis.io/commands/bitpos
   */
  bitpos = (...args) => new BitPosCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/client-setinfo
   */
  clientSetinfo = (...args) => new ClientSetInfoCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/copy
   */
  copy = (...args) => new CopyCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/dbsize
   */
  dbsize = () => new DBSizeCommand(this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/decr
   */
  decr = (...args) => new DecrCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/decrby
   */
  decrby = (...args) => new DecrByCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/del
   */
  del = (...args) => new DelCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/echo
   */
  echo = (...args) => new EchoCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/eval_ro
   */
  evalRo = (...args) => new EvalROCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/eval
   */
  eval = (...args) => new EvalCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/evalsha_ro
   */
  evalshaRo = (...args) => new EvalshaROCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/evalsha
   */
  evalsha = (...args) => new EvalshaCommand(args, this.opts).exec(this.client);
  /**
   * Generic method to execute any Redis command.
   */
  exec = (args) => new ExecCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/exists
   */
  exists = (...args) => new ExistsCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/expire
   */
  expire = (...args) => new ExpireCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/expireat
   */
  expireat = (...args) => new ExpireAtCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/flushall
   */
  flushall = (args) => new FlushAllCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/flushdb
   */
  flushdb = (...args) => new FlushDBCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/geoadd
   */
  geoadd = (...args) => new GeoAddCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/geopos
   */
  geopos = (...args) => new GeoPosCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/geodist
   */
  geodist = (...args) => new GeoDistCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/geohash
   */
  geohash = (...args) => new GeoHashCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/geosearch
   */
  geosearch = (...args) => new GeoSearchCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/geosearchstore
   */
  geosearchstore = (...args) => new GeoSearchStoreCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/get
   */
  get = (...args) => new GetCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/getbit
   */
  getbit = (...args) => new GetBitCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/getdel
   */
  getdel = (...args) => new GetDelCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/getex
   */
  getex = (...args) => new GetExCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/getrange
   */
  getrange = (...args) => new GetRangeCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/getset
   */
  getset = (key, value) => new GetSetCommand([key, value], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hdel
   */
  hdel = (...args) => new HDelCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hexists
   */
  hexists = (...args) => new HExistsCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hexpire
   */
  hexpire = (...args) => new HExpireCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hexpireat
   */
  hexpireat = (...args) => new HExpireAtCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hexpiretime
   */
  hexpiretime = (...args) => new HExpireTimeCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/httl
   */
  httl = (...args) => new HTtlCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hpexpire
   */
  hpexpire = (...args) => new HPExpireCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hpexpireat
   */
  hpexpireat = (...args) => new HPExpireAtCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hpexpiretime
   */
  hpexpiretime = (...args) => new HPExpireTimeCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hpttl
   */
  hpttl = (...args) => new HPTtlCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hpersist
   */
  hpersist = (...args) => new HPersistCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hget
   */
  hget = (...args) => new HGetCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hgetall
   */
  hgetall = (...args) => new HGetAllCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hgetdel
   */
  hgetdel = (...args) => new HGetDelCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hgetex
   */
  hgetex = (...args) => new HGetExCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hincrby
   */
  hincrby = (...args) => new HIncrByCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hincrbyfloat
   */
  hincrbyfloat = (...args) => new HIncrByFloatCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hkeys
   */
  hkeys = (...args) => new HKeysCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hlen
   */
  hlen = (...args) => new HLenCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hmget
   */
  hmget = (...args) => new HMGetCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hmset
   */
  hmset = (key, kv) => new HMSetCommand([key, kv], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hrandfield
   */
  hrandfield = (key, count, withValues) => new HRandFieldCommand([key, count, withValues], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hscan
   */
  hscan = (...args) => new HScanCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hset
   */
  hset = (key, kv) => new HSetCommand([key, kv], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hsetex
   */
  hsetex = (...args) => new HSetExCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hsetnx
   */
  hsetnx = (key, field, value) => new HSetNXCommand([key, field, value], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hstrlen
   */
  hstrlen = (...args) => new HStrLenCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/hvals
   */
  hvals = (...args) => new HValsCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/incr
   */
  incr = (...args) => new IncrCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/incrby
   */
  incrby = (...args) => new IncrByCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/incrbyfloat
   */
  incrbyfloat = (...args) => new IncrByFloatCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/keys
   */
  keys = (...args) => new KeysCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/lindex
   */
  lindex = (...args) => new LIndexCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/linsert
   */
  linsert = (key, direction, pivot, value) => new LInsertCommand([key, direction, pivot, value], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/llen
   */
  llen = (...args) => new LLenCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/lmove
   */
  lmove = (...args) => new LMoveCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/lpop
   */
  lpop = (...args) => new LPopCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/lmpop
   */
  lmpop = (...args) => new LmPopCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/lpos
   */
  lpos = (...args) => new LPosCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/lpush
   */
  lpush = (key, ...elements) => new LPushCommand([key, ...elements], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/lpushx
   */
  lpushx = (key, ...elements) => new LPushXCommand([key, ...elements], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/lrange
   */
  lrange = (...args) => new LRangeCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/lrem
   */
  lrem = (key, count, value) => new LRemCommand([key, count, value], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/lset
   */
  lset = (key, index, value) => new LSetCommand([key, index, value], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/ltrim
   */
  ltrim = (...args) => new LTrimCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/mget
   */
  mget = (...args) => new MGetCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/mset
   */
  mset = (kv) => new MSetCommand([kv], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/msetnx
   */
  msetnx = (kv) => new MSetNXCommand([kv], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/persist
   */
  persist = (...args) => new PersistCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/pexpire
   */
  pexpire = (...args) => new PExpireCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/pexpireat
   */
  pexpireat = (...args) => new PExpireAtCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/pfadd
   */
  pfadd = (...args) => new PfAddCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/pfcount
   */
  pfcount = (...args) => new PfCountCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/pfmerge
   */
  pfmerge = (...args) => new PfMergeCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/ping
   */
  ping = (args) => new PingCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/psetex
   */
  psetex = (key, ttl, value) => new PSetEXCommand([key, ttl, value], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/psubscribe
   */
  psubscribe = (patterns) => {
    const patternArray = Array.isArray(patterns) ? patterns : [patterns];
    return new Subscriber(this.client, patternArray, true, this.opts);
  };
  /**
   * @see https://redis.io/commands/pttl
   */
  pttl = (...args) => new PTtlCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/publish
   */
  publish = (...args) => new PublishCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/randomkey
   */
  randomkey = () => new RandomKeyCommand().exec(this.client);
  /**
   * @see https://redis.io/commands/rename
   */
  rename = (...args) => new RenameCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/renamenx
   */
  renamenx = (...args) => new RenameNXCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/rpop
   */
  rpop = (...args) => new RPopCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/rpush
   */
  rpush = (key, ...elements) => new RPushCommand([key, ...elements], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/rpushx
   */
  rpushx = (key, ...elements) => new RPushXCommand([key, ...elements], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/sadd
   */
  sadd = (key, member, ...members) => new SAddCommand([key, member, ...members], this.opts).exec(this.client);
  scan(cursor, opts) {
    return new ScanCommand([cursor, opts], this.opts).exec(this.client);
  }
  /**
   * @see https://redis.io/commands/scard
   */
  scard = (...args) => new SCardCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/script-exists
   */
  scriptExists = (...args) => new ScriptExistsCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/script-flush
   */
  scriptFlush = (...args) => new ScriptFlushCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/script-load
   */
  scriptLoad = (...args) => new ScriptLoadCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/sdiff
   */
  sdiff = (...args) => new SDiffCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/sdiffstore
   */
  sdiffstore = (...args) => new SDiffStoreCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/set
   */
  set = (key, value, opts) => new SetCommand([key, value, opts], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/setbit
   */
  setbit = (...args) => new SetBitCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/setex
   */
  setex = (key, ttl, value) => new SetExCommand([key, ttl, value], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/setnx
   */
  setnx = (key, value) => new SetNxCommand([key, value], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/setrange
   */
  setrange = (...args) => new SetRangeCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/sinter
   */
  sinter = (...args) => new SInterCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/sintercard
   */
  sintercard = (...args) => new SInterCardCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/sinterstore
   */
  sinterstore = (...args) => new SInterStoreCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/sismember
   */
  sismember = (key, member) => new SIsMemberCommand([key, member], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/smismember
   */
  smismember = (key, members) => new SMIsMemberCommand([key, members], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/smembers
   */
  smembers = (...args) => new SMembersCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/smove
   */
  smove = (source, destination, member) => new SMoveCommand([source, destination, member], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/spop
   */
  spop = (...args) => new SPopCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/srandmember
   */
  srandmember = (...args) => new SRandMemberCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/srem
   */
  srem = (key, ...members) => new SRemCommand([key, ...members], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/sscan
   */
  sscan = (...args) => new SScanCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/strlen
   */
  strlen = (...args) => new StrLenCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/subscribe
   */
  subscribe = (channels) => {
    const channelArray = Array.isArray(channels) ? channels : [channels];
    return new Subscriber(this.client, channelArray, false, this.opts);
  };
  /**
   * @see https://redis.io/commands/sunion
   */
  sunion = (...args) => new SUnionCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/sunionstore
   */
  sunionstore = (...args) => new SUnionStoreCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/time
   */
  time = () => new TimeCommand().exec(this.client);
  /**
   * @see https://redis.io/commands/touch
   */
  touch = (...args) => new TouchCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/ttl
   */
  ttl = (...args) => new TtlCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/type
   */
  type = (...args) => new TypeCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/unlink
   */
  unlink = (...args) => new UnlinkCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/xadd
   */
  xadd = (...args) => new XAddCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/xack
   */
  xack = (...args) => new XAckCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/xackdel
   */
  xackdel = (...args) => new XAckDelCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/xdel
   */
  xdel = (...args) => new XDelCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/xdelex
   */
  xdelex = (...args) => new XDelExCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/xgroup
   */
  xgroup = (...args) => new XGroupCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/xread
   */
  xread = (...args) => new XReadCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/xreadgroup
   */
  xreadgroup = (...args) => new XReadGroupCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/xinfo
   */
  xinfo = (...args) => new XInfoCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/xlen
   */
  xlen = (...args) => new XLenCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/xpending
   */
  xpending = (...args) => new XPendingCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/xclaim
   */
  xclaim = (...args) => new XClaimCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/xautoclaim
   */
  xautoclaim = (...args) => new XAutoClaim(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/xtrim
   */
  xtrim = (...args) => new XTrimCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/xrange
   */
  xrange = (...args) => new XRangeCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/xrevrange
   */
  xrevrange = (...args) => new XRevRangeCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/zadd
   */
  zadd = (...args) => {
    if ("score" in args[1]) {
      return new ZAddCommand([args[0], args[1], ...args.slice(2)], this.opts).exec(
        this.client
      );
    }
    return new ZAddCommand(
      [args[0], args[1], ...args.slice(2)],
      this.opts
    ).exec(this.client);
  };
  /**
   * @see https://redis.io/commands/zcard
   */
  zcard = (...args) => new ZCardCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/zcount
   */
  zcount = (...args) => new ZCountCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/zdiffstore
   */
  zdiffstore = (...args) => new ZDiffStoreCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/zincrby
   */
  zincrby = (key, increment, member) => new ZIncrByCommand([key, increment, member], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/zinterstore
   */
  zinterstore = (...args) => new ZInterStoreCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/zlexcount
   */
  zlexcount = (...args) => new ZLexCountCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/zmscore
   */
  zmscore = (...args) => new ZMScoreCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/zpopmax
   */
  zpopmax = (...args) => new ZPopMaxCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/zpopmin
   */
  zpopmin = (...args) => new ZPopMinCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/zrange
   */
  zrange = (...args) => new ZRangeCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/zrank
   */
  zrank = (key, member) => new ZRankCommand([key, member], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/zrem
   */
  zrem = (key, ...members) => new ZRemCommand([key, ...members], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/zremrangebylex
   */
  zremrangebylex = (...args) => new ZRemRangeByLexCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/zremrangebyrank
   */
  zremrangebyrank = (...args) => new ZRemRangeByRankCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/zremrangebyscore
   */
  zremrangebyscore = (...args) => new ZRemRangeByScoreCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/zrevrank
   */
  zrevrank = (key, member) => new ZRevRankCommand([key, member], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/zscan
   */
  zscan = (...args) => new ZScanCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/zscore
   */
  zscore = (key, member) => new ZScoreCommand([key, member], this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/zunion
   */
  zunion = (...args) => new ZUnionCommand(args, this.opts).exec(this.client);
  /**
   * @see https://redis.io/commands/zunionstore
   */
  zunionstore = (...args) => new ZUnionStoreCommand(args, this.opts).exec(this.client);
};
var VERSION = "v1.39.0";

// node_modules/@upstash/redis/nodejs.mjs
var BUILD = /* @__PURE__ */ Symbol("build");
var TextFieldBuilder = class _TextFieldBuilder {
  _noTokenize;
  _noStem;
  _from;
  constructor(noTokenize = { noTokenize: false }, noStem = { noStem: false }, from = { from: null }) {
    this._noTokenize = noTokenize;
    this._noStem = noStem;
    this._from = from;
  }
  noTokenize() {
    return new _TextFieldBuilder({ noTokenize: true }, this._noStem, this._from);
  }
  noStem() {
    return new _TextFieldBuilder(this._noTokenize, { noStem: true }, this._from);
  }
  from(field) {
    return new _TextFieldBuilder(this._noTokenize, this._noStem, { from: field });
  }
  [BUILD]() {
    return {
      type: "TEXT",
      ...this._noTokenize.noTokenize ? { noTokenize: true } : {},
      ...this._noStem.noStem ? { noStem: true } : {},
      ...this._from.from ? { from: this._from.from } : {}
    };
  }
};
var NumericFieldBuilder = class _NumericFieldBuilder {
  type;
  _from;
  constructor(type, from = { from: null }) {
    this.type = type;
    this._from = from;
  }
  from(field) {
    return new _NumericFieldBuilder(this.type, { from: field });
  }
  [BUILD]() {
    return this._from.from ? {
      type: this.type,
      fast: true,
      from: this._from.from
    } : {
      type: this.type,
      fast: true
    };
  }
};
var BoolFieldBuilder = class _BoolFieldBuilder {
  _fast;
  _from;
  constructor(fast = { fast: false }, from = { from: null }) {
    this._fast = fast;
    this._from = from;
  }
  fast() {
    return new _BoolFieldBuilder({ fast: true }, this._from);
  }
  from(field) {
    return new _BoolFieldBuilder(this._fast, { from: field });
  }
  [BUILD]() {
    const hasFast = this._fast.fast;
    const hasFrom = Boolean(this._from.from);
    if (hasFast && hasFrom) {
      return {
        type: "BOOL",
        fast: true,
        from: this._from.from
      };
    }
    if (hasFast) {
      return {
        type: "BOOL",
        fast: true
      };
    }
    if (hasFrom) {
      return {
        type: "BOOL",
        from: this._from.from
      };
    }
    return { type: "BOOL" };
  }
};
var DateFieldBuilder = class _DateFieldBuilder {
  _fast;
  _from;
  constructor(fast = { fast: false }, from = { from: null }) {
    this._fast = fast;
    this._from = from;
  }
  fast() {
    return new _DateFieldBuilder({ fast: true }, this._from);
  }
  from(field) {
    return new _DateFieldBuilder(this._fast, { from: field });
  }
  [BUILD]() {
    const hasFast = this._fast.fast;
    const hasFrom = Boolean(this._from.from);
    if (hasFast && hasFrom) {
      return {
        type: "DATE",
        fast: true,
        from: this._from.from
      };
    }
    if (hasFast) {
      return {
        type: "DATE",
        fast: true
      };
    }
    if (hasFrom) {
      return {
        type: "DATE",
        from: this._from.from
      };
    }
    return { type: "DATE" };
  }
};
var KeywordFieldBuilder = class {
  [BUILD]() {
    return { type: "KEYWORD" };
  }
};
var FacetFieldBuilder = class {
  [BUILD]() {
    return { type: "FACET" };
  }
};
if (typeof atob === "undefined") {
  global.atob = (b64) => Buffer.from(b64, "base64").toString("utf8");
}
var Redis2 = class _Redis extends Redis {
  /**
   * Create a new redis client by providing a custom `Requester` implementation
   *
   * @example
   * ```ts
   *
   * import { UpstashRequest, Requester, UpstashResponse, Redis } from "@upstash/redis"
   *
   *  const requester: Requester = {
   *    request: <TResult>(req: UpstashRequest): Promise<UpstashResponse<TResult>> => {
   *      // ...
   *    }
   *  }
   *
   * const redis = new Redis(requester)
   * ```
   */
  constructor(configOrRequester) {
    if ("request" in configOrRequester) {
      super(configOrRequester);
      return;
    }
    if (!configOrRequester.url) {
      console.warn(
        `[Upstash Redis] The 'url' property is missing or undefined in your Redis config. To create a database instantly (no signup needed), run: curl -X POST https://upstash.com/start-redis`
      );
    } else if (configOrRequester.url.startsWith(" ") || configOrRequester.url.endsWith(" ") || /\r|\n/.test(configOrRequester.url)) {
      console.warn(
        "[Upstash Redis] The redis url contains whitespace or newline, which can cause errors!"
      );
    }
    if (!configOrRequester.token) {
      console.warn(
        `[Upstash Redis] The 'token' property is missing or undefined in your Redis config. To create a database instantly (no signup needed), run: curl -X POST https://upstash.com/start-redis`
      );
    } else if (configOrRequester.token.startsWith(" ") || configOrRequester.token.endsWith(" ") || /\r|\n/.test(configOrRequester.token)) {
      console.warn(
        "[Upstash Redis] The redis token contains whitespace or newline, which can cause errors!"
      );
    }
    const client = new HttpClient({
      baseUrl: configOrRequester.url,
      retry: configOrRequester.retry,
      headers: { authorization: `Bearer ${configOrRequester.token}` },
      agent: configOrRequester.agent,
      responseEncoding: configOrRequester.responseEncoding,
      cache: configOrRequester.cache ?? "no-store",
      signal: configOrRequester.signal,
      keepAlive: configOrRequester.keepAlive,
      readYourWrites: configOrRequester.readYourWrites
    });
    const safeEnv = typeof process === "object" && process && typeof process.env === "object" && process.env ? process.env : {};
    super(client, {
      automaticDeserialization: configOrRequester.automaticDeserialization,
      enableTelemetry: configOrRequester.enableTelemetry ?? !safeEnv.UPSTASH_DISABLE_TELEMETRY,
      latencyLogging: configOrRequester.latencyLogging,
      enableAutoPipelining: configOrRequester.enableAutoPipelining
    });
    const nodeVersion = typeof process === "object" && process ? process.version : void 0;
    this.addTelemetry({
      runtime: (
        // @ts-expect-error to silence compiler
        typeof EdgeRuntime === "string" ? "edge-light" : nodeVersion ? `node@${nodeVersion}` : "unknown"
      ),
      platform: safeEnv.UPSTASH_CONSOLE ? "console" : safeEnv.VERCEL ? "vercel" : safeEnv.AWS_REGION ? "aws" : "unknown",
      sdk: `@upstash/redis@${VERSION}`
    });
    if (this.enableAutoPipelining) {
      return this.autoPipeline();
    }
  }
  /**
   * Create a new Upstash Redis instance from environment variables.
   *
   * Use this to automatically load connection secrets from your environment
   * variables. For instance when using the Vercel integration.
   *
   * This tries to load connection details from your environment using `process.env`:
   * - URL: `UPSTASH_REDIS_REST_URL` or fallback to `KV_REST_API_URL`
   * - Token: `UPSTASH_REDIS_REST_TOKEN` or fallback to `KV_REST_API_TOKEN`
   *
   * The fallback variables provide compatibility with Vercel KV and other platforms
   * that may use different naming conventions.
   */
  static fromEnv(config) {
    if (typeof process !== "object" || !process || typeof process.env !== "object" || !process.env) {
      throw new TypeError(
        '[Upstash Redis] Unable to get environment variables, `process.env` is undefined. If you are deploying to cloudflare, please import from "@upstash/redis/cloudflare" instead'
      );
    }
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    if (!url) {
      console.warn(
        "[Upstash Redis] Unable to find environment variable: `UPSTASH_REDIS_REST_URL`. To create a database instantly (no signup needed), run: curl -X POST https://upstash.com/start-redis"
      );
    }
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    if (!token) {
      console.warn(
        "[Upstash Redis] Unable to find environment variable: `UPSTASH_REDIS_REST_TOKEN`. To create a database instantly (no signup needed), run: curl -X POST https://upstash.com/start-redis"
      );
    }
    return new _Redis({ ...config, url, token });
  }
};

// apps/server/src/store.ts
var UNIVERSE_NAME = process.env.STARHOLD_UNIVERSE_NAME ?? "Alpha Drift";
var UNIVERSE_SPEED = Number(process.env.STARHOLD_UNIVERSE_SPEED ?? 8);
var REDIS_KEY = process.env.STARHOLD_UNIVERSE_KEY ?? `starhold:universe:v${UNIVERSE_SCHEMA_VERSION}`;
var LOCK_KEY = `${REDIS_KEY}:lock`;
var memoryUniverse = null;
var redis;
var resolvedMode;
function redisCredentials(env = process.env) {
  const upstashUrl = env.UPSTASH_REDIS_REST_URL?.trim();
  const upstashToken = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (upstashUrl && upstashToken) {
    return { url: upstashUrl, token: upstashToken, mode: "upstash" };
  }
  const kvUrl = env.KV_REST_API_URL?.trim();
  const kvToken = env.KV_REST_API_TOKEN?.trim();
  if (kvUrl && kvToken) {
    return { url: kvUrl, token: kvToken, mode: "kv" };
  }
  return null;
}
function getRedis() {
  if (redis !== void 0) return redis;
  const creds = redisCredentials(process.env);
  if (!creds) {
    redis = null;
    resolvedMode = "memory";
    return null;
  }
  resolvedMode = creds.mode;
  redis = new Redis2({ url: creds.url, token: creds.token });
  return redis;
}
function storageMode() {
  if (resolvedMode) return resolvedMode;
  const creds = redisCredentials(process.env);
  return creds?.mode ?? "memory";
}
function freshUniverse() {
  return createUniverse(UNIVERSE_NAME, UNIVERSE_SPEED);
}
async function loadUniverse(client) {
  if (!client) {
    if (!memoryUniverse) memoryUniverse = freshUniverse();
    ensureUniverseShape(memoryUniverse);
    return memoryUniverse;
  }
  let data = await client.get(REDIS_KEY);
  if (!data || typeof data !== "object" || !data.id) {
    const legacy = await client.get("starhold:universe:v1");
    if (legacy && typeof legacy === "object" && legacy.id) {
      data = legacy;
    }
  }
  if (data && typeof data === "object" && data.id) {
    const migrated = migrateOrResetUniverse(data, {
      name: UNIVERSE_NAME,
      speed: UNIVERSE_SPEED
    });
    if (migrated.didReset && migrated.archived) {
      const archiveKey = archiveUniverseKey(
        migrated.archived.id,
        Date.now()
      );
      await client.set(archiveKey, migrated.archived);
      await client.set(REDIS_KEY, migrated.universe);
      await client.del("starhold:universe:v1").catch(() => void 0);
      return migrated.universe;
    }
    ensureUniverseShape(migrated.universe);
    return migrated.universe;
  }
  const created = freshUniverse();
  ensureUniverseShape(created);
  await client.set(REDIS_KEY, created);
  return created;
}
async function saveUniverse(client, state) {
  if (!client) {
    memoryUniverse = state;
    return;
  }
  await client.set(REDIS_KEY, state);
}
async function acquireLock(client) {
  const result = await client.set(LOCK_KEY, String(Date.now()), {
    nx: true,
    px: 8e3
  });
  return result === "OK";
}
async function releaseLock(client) {
  await client.del(LOCK_KEY);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function withUniverse(fn) {
  const client = getRedis();
  if (!client) {
    const universe = await loadUniverse(null);
    return await fn(universe);
  }
  for (let attempt = 0; attempt < 12; attempt++) {
    if (await acquireLock(client)) {
      try {
        const universe = await loadUniverse(client);
        const result = await fn(universe);
        await saveUniverse(client, universe);
        return result;
      } finally {
        await releaseLock(client);
      }
    }
    await sleep(40 + attempt * 40);
  }
  throw new Error("Universe busy \u2014 retry in a moment.");
}

// apps/server/src/app.ts
function allowedOrigins() {
  const fromEnv = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const defaults = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "https://starhold-two.vercel.app"
  ];
  const vercel = process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : [];
  return /* @__PURE__ */ new Set([...defaults, ...fromEnv, ...vercel]);
}
async function simpleCors(c, next) {
  const origin = c.req.header("Origin");
  const allow = origin && (allowedOrigins().has(origin) || process.env.VERCEL === "1");
  if (c.req.method === "OPTIONS") {
    const res = new Response(null, { status: 204 });
    if (origin && allow) {
      res.headers.set("Access-Control-Allow-Origin", origin);
      res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.headers.set("Access-Control-Allow-Headers", "Content-Type");
      res.headers.set("Vary", "Origin");
    }
    return res;
  }
  await next();
  if (origin && allow) {
    c.res.headers.set("Access-Control-Allow-Origin", origin);
    c.res.headers.set("Vary", "Origin");
  }
}
function createApp() {
  const app2 = new Hono3();
  app2.use("*", simpleCors);
  app2.notFound(
    (c) => c.json({ error: "Not found", path: c.req.path }, 404)
  );
  app2.onError((err, c) => {
    console.error("[starhold-api]", err);
    return c.json(
      { error: err instanceof Error ? err.message : "Server error" },
      500
    );
  });
  app2.get("/api/health", async (c) => {
    try {
      return await withUniverse((universe) => {
        ensureUniverseShape(universe);
        return c.json({
          ok: true,
          storage: storageMode(),
          universe: universe.name,
          players: Object.keys(universe.players).length,
          speed: universe.speed,
          fleetSpeed: universe.fleetSpeed,
          fleets: Object.keys(universe.fleets ?? {}).length,
          debris: Object.keys(universe.debris ?? {}).length
        });
      });
    } catch (err) {
      return c.json(
        {
          ok: false,
          storage: storageMode(),
          error: err instanceof Error ? err.message : "Health failed."
        },
        503
      );
    }
  });
  app2.get("/api/universe", async (c) => {
    return withUniverse((universe) => {
      ensureUniverseShape(universe);
      const now = Date.now();
      return c.json({
        now,
        id: universe.id,
        name: universe.name,
        speed: universe.speed,
        fleetSpeed: universe.fleetSpeed,
        players: Object.values(universe.players).map((p) => {
          const planet = universe.planets[p.homePlanetId];
          return {
            id: p.id,
            name: p.name,
            coords: planet?.coords ?? null,
            planetId: p.homePlanetId
          };
        })
      });
    });
  });
  app2.post("/api/join", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      return await withUniverse((universe) => {
        const { player } = joinUniverse(universe, body.name ?? "");
        return c.json(playerView(universe, player.id));
      });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Join failed." },
        400
      );
    }
  });
  app2.get("/api/state", async (c) => {
    const playerId = c.req.query("playerId")?.trim();
    if (!playerId) {
      return c.json({ error: "playerId query required." }, 400);
    }
    try {
      const galaxy = Number(c.req.query("galaxy") || 0) || void 0;
      const system = Number(c.req.query("system") || 0) || void 0;
      return await withUniverse(
        (universe) => c.json(playerView(universe, playerId, Date.now(), galaxy, system))
      );
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "State failed." },
        404
      );
    }
  });
  app2.post("/api/upgrade", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.playerId || !body.buildingId) {
      return c.json({ error: "playerId and buildingId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = queueBuildingUpgrade(
        universe,
        body.playerId,
        body.buildingId,
        Date.now(),
        body.planetId
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId));
    });
  });
  app2.post("/api/build-ship", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.playerId || !body.shipId) {
      return c.json({ error: "playerId and shipId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = queueShipBuild(
        universe,
        body.playerId,
        body.shipId,
        body.count ?? 1,
        Date.now(),
        body.planetId
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId));
    });
  });
  app2.post("/api/build-defense", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.playerId || !body.defenseId) {
      return c.json({ error: "playerId and defenseId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = queueDefenseBuild(
        universe,
        body.playerId,
        body.defenseId,
        body.count ?? 1,
        Date.now(),
        body.planetId
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId));
    });
  });
  app2.post("/api/research", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.playerId || !body.researchId) {
      return c.json({ error: "playerId and researchId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = queueResearch(universe, body.playerId, body.researchId);
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId));
    });
  });
  app2.post("/api/select-planet", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.playerId || !body.planetId) {
      return c.json({ error: "playerId and planetId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = setActivePlanet(
        universe,
        body.playerId,
        body.planetId
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId));
    });
  });
  app2.post("/api/launch-fleet", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.playerId || !body.mission) {
      return c.json({ error: "playerId and mission required." }, 400);
    }
    return withUniverse((universe) => {
      const result = launchFleet(universe, {
        playerId: body.playerId,
        mission: body.mission,
        ships: body.ships ?? {},
        targetPlanetId: body.targetPlanetId,
        targetCoords: body.targetCoords,
        asteroidId: body.asteroidId,
        pirateBaseId: body.pirateBaseId,
        cargo: body.cargo,
        originPlanetId: body.originPlanetId
      });
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId));
    });
  });
  app2.post("/api/claim-daily", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.playerId) {
      return c.json({ error: "playerId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = claimDailyLogin(universe, body.playerId);
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId));
    });
  });
  app2.post("/api/activate-officer", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.playerId || !body.officerId) {
      return c.json({ error: "playerId and officerId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = activateOfficer(
        universe,
        body.playerId,
        body.officerId
      );
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId));
    });
  });
  app2.post("/api/unlock-skill", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.playerId || !body.skillId) {
      return c.json({ error: "playerId and skillId required." }, 400);
    }
    return withUniverse((universe) => {
      const result = unlockSkill(universe, body.playerId, body.skillId);
      if (!result.ok) return c.json({ error: result.error }, 400);
      return c.json(playerView(universe, body.playerId));
    });
  });
  return app2;
}
var app = createApp();

// apps/server/src/vercel-entry.ts
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function handler(req, res) {
  try {
    const host = req.headers.host ?? "localhost";
    const proto = (typeof req.headers["x-forwarded-proto"] === "string" ? req.headers["x-forwarded-proto"] : null) ?? "https";
    const url = new URL(req.url ?? "/", `${proto}://${host}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === void 0) continue;
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else {
        headers.set(key, value);
      }
    }
    const method = req.method ?? "GET";
    const rawBody = method === "GET" || method === "HEAD" ? void 0 : await readBody(req);
    const body = rawBody && rawBody.length > 0 ? new Uint8Array(rawBody.buffer, rawBody.byteOffset, rawBody.byteLength) : void 0;
    const requestInit = {
      method,
      headers,
      body
    };
    if (body) requestInit.duplex = "half";
    const request = new Request(url, requestInit);
    const response = await app.fetch(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "transfer-encoding") return;
      res.setHeader(key, value);
    });
    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
  } catch (err) {
    console.error("[starhold-api]", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : "Server error"
        })
      );
    }
  }
}

module.exports = module.exports.default;

