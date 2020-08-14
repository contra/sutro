import { promisify } from 'handle-async'
import { pipeline } from 'stream'
import through2 from 'through2'
import { NotFoundError, UnauthorizedError } from './errors'
import parseIncludes from './parseIncludes'
import cacheControl from './cacheControl'

const defaultCacheHeaders = {
  private: true,
  noCache: true
}

const traceAsync = async (trace, name, promise) => {
  if (!trace) return promise // no tracing, just return
  const ourTrace = trace.start(name)
  try {
    const res = await promise
    ourTrace.end()
    return res
  } catch (err) {
    ourTrace.end()
    throw err
  }
}

const streamResponse = async (stream, req, res, codes) => {
  let hasFirstChunk = false
  return new Promise((resolve, reject) => {
    const ourStream = pipeline(
      stream,
      through2((chunk, _, cb) => {
        // wait until we get a chunk without an error before writing the headers
        if (hasFirstChunk) return cb(null, chunk)
        hasFirstChunk = true
        if (stream.contentType) res.type(stream.contentType)
        res.status(codes.success)
        cb(null, chunk)
      }),
      (err) => {
        if (!err || req.timedout) return resolve() // timed out, no point throwing a duplicate error
        reject(err)
      }
    )

    // just use a regular pipe to res, since pipeline would close it on error
    // which would make us unable to send an error back out
    res.once('close', () => stream.destroy()) // make sure we don't keep working if the response closed!
    ourStream.pipe(res)
  })
}

const sendBufferResponse = (resultData, req, res, codes) => {
  res.status(codes.success)
  res.type('json')
  if (Buffer.isBuffer(resultData)) {
    res.send(resultData)
  } else if (typeof resultData === 'string') {
    res.send(Buffer.from(resultData))
  } else {
    res.json(resultData)
  }

  res.end()
}

const sendResponse = async ({ opt, successCode, resultData }) => {
  const { _res, _req, method, noResponse } = opt
  const codes = {
    noResponse: successCode || 204,
    success: successCode || 200
  }

  // no response
  if (resultData == null) {
    if (method === 'GET') throw new NotFoundError()
    return _res.status(codes.noResponse).end()
  }

  // user asked for no body (save bandwidth)
  if (noResponse) {
    return _res.status(codes.noResponse).end()
  }

  // stream response
  if (resultData.pipe && resultData.on) {
    await streamResponse(resultData, _req, _res, codes)
    return
  }

  // json obj response
  sendBufferResponse(resultData, _req, _res, codes)
}

const exec = async (req, res, { endpoint, successCode, trace }) => {
  const opt = {
    ...req.params,
    ip: req.ip,
    url: req.url,
    protocol: req.protocol,
    method: req.method,
    subdomains: req.subdomains,
    path: req.path,
    headers: req.headers,
    cookies: req.cookies,
    user: req.user,
    data: req.body,
    options: req.query,
    session: req.session,
    includes: parseIncludes(req.query.includes),
    noResponse: req.query.response === 'false',
    onFinish: (fn) => { res.once('finish', fn.bind(null, req, res)) },
    withRaw: (fn) => { fn(req, res) },
    _req: req,
    _res: res
  }

  // check isAuthorized
  const authorized = !endpoint.isAuthorized || await traceAsync(trace, 'sutro/isAuthorized', promisify(endpoint.isAuthorized.bind(null, opt)))
  if (authorized !== true) throw new UnauthorizedError()
  if (req.timedout) return

  let resultData

  // check cache
  const cacheKey = endpoint.cache && endpoint.cache.key && await traceAsync(trace, 'sutro/cache.key', promisify(endpoint.cache.key.bind(null, opt)))
  if (req.timedout) return

  const cachedData = endpoint.cache && endpoint.cache.get && await traceAsync(trace, 'sutro/cache.get', promisify(endpoint.cache.get.bind(null, opt, cacheKey)))
  if (req.timedout) return

  // call execute
  if (!cachedData) {
    const executeFn = typeof endpoint === 'function' ? endpoint : endpoint.execute
    const rawData = typeof executeFn === 'function'
      ? await traceAsync(trace, 'sutro/execute', promisify(executeFn.bind(null, opt)))
      : executeFn || null
    if (req.timedout) return

    // call format on execute result
    resultData = endpoint.format
      ? await traceAsync(trace, 'sutro/format', promisify(endpoint.format.bind(null, opt, rawData)))
      : rawData
    if (req.timedout) return
  } else {
    resultData = cachedData
  }

  // call cacheControl
  const cacheHeaders = endpoint.cache && endpoint.cache.header
    ? typeof endpoint.cache.header === 'function'
      ? await traceAsync(trace, 'sutro/cache.header', promisify(endpoint.cache.header.bind(null, opt, resultData)))
      : endpoint.cache.header
    : defaultCacheHeaders
  if (req.timedout) return
  if (cacheHeaders) res.set('Cache-Control', cacheControl(cacheHeaders))

  // send the data out
  await sendResponse({ opt, successCode, resultData })

  // write to cache if we got a fresh response
  if (!cachedData && endpoint.cache && endpoint.cache.set) {
    await traceAsync(trace, 'sutro/cache.set', promisify(endpoint.cache.set.bind(null, opt, resultData, cacheKey)))
  }
}

export default (resource, { trace } = {}) => {
  // wrap it so it has a name
  const handleAPIRequest = async (req, res, next) => {
    if (req.timedout) return
    try {
      await traceAsync(trace, 'sutro/handleAPIRequest', exec(req, res, { ...resource, trace }))
    } catch (err) {
      return next(err)
    }
  }
  return handleAPIRequest
}
