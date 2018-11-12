// SPEC: https://github.com/msgpack/msgpack/blob/master/spec.md

const NOT_SUPPORTED = Symbol('NOT_SUPPORTED')
const EMPTY_OBJECT = Object.create(null)
const EMPTY_ARR: any[] = []
const EMPTY_STR = ''

let skipStringAllocationBecauseMsgpackIsFuckingSlow = false
let partialBuffer: Buffer
let incomplete = false
let ix = 0

const superparse = (raw: Buffer) => {
  const m = raw[ix]

  // fixint
  if (m >= 0x00 && m <= 0x7f) return (ix++, m - 0x00)

  // fixarr
  else if (m >= 0x90 && m <= 0x9f) return (ix++, toArr(raw, m - 0x90))

  // uint8
  else if (m === 0xcc) return (ix+=2, raw[ix - 1])

  // fixstr
  else if (m >= 0xa0 && m <= 0xbf) return (ix++, toStr(raw, m - 0xa0))

  // str8
  else if (m === 0xd9) return (ix+=2, toStr(raw, raw[ix - 1]))

  // fixmap
  else if (m >= 0x80 && m <= 0x8f) return (ix++, toMap(raw, m - 0x80))

  // arr16
  else if (m === 0xdc) return (ix+=3, toArr(raw, raw[ix - 2] + raw[ix - 1]))

  // negative fixint
  else if (m >= 0xe0 && m <= 0xff) return (ix++, m - 0x100)

  else if (m === 0xc3) return (ix++, true)
  else if (m === 0xc2) return (ix++, false)
  else if (m === 0xc0) return (ix++, null)

  // uint16
  else if (m === 0xcd) return (ix+=3, (raw[ix - 2] << 8) + raw[ix - 1] )

  // str16
  else if (m === 0xda) return (ix+=3, toStr(raw, raw[ix - 2] + raw[ix - 1]))

  // map16
  else if (m === 0xde) return (ix+=3, toMap(raw, raw[ix - 2] + raw[ix - 1]))

  // int8
  else if (m === 0xd0) {
    const val = raw[ix + 1]
    ix += 2
    return (val & 0x80) ? val - 0x100 : val
  }

  // int16
  else if (m === 0xd1) {
    const val = (raw[ix + 1] << 8) + raw[ix + 2]
    ix += 3
    return (val & 0x8000) ? val - 0x10000 : val
  }

  // uint32
  else if (m === 0xce) {
    const val = (raw[ix + 1] * 16777216) + (raw[ix + 2] << 16) + (raw[ix + 3] << 8) + raw[ix + 4]
    ix += 5
    return val
  }

  // int32
  else if (m === 0xd2) {
    const val = (raw[ix + 1] << 24) | (raw[ix + 2] << 16) | (raw[ix + 3] << 8) | raw[ix + 4]
    ix += 5
    return val
  }

  // str32
  else if (m === 0xdb) {
    const val = toStr(raw, raw[ix + 1] + raw[ix + 2] + raw[ix + 3] + raw[ix + 4])
    ix += 5
    return val
  }

  // arr32
  else if (m === 0xdd) {
    const val = toArr(raw, raw[ix + 1] + raw[ix + 2] + raw[ix + 3] + raw[ix + 4])
    ix += 5
    return val
  }

  // map32
  else if (m === 0xdf) {
    const val = toMap(raw, raw[ix + 1] + raw[ix + 2] + raw[ix + 3] + raw[ix + 4])
    ix += 5
    return val
  }

  // fixext1
  else if (m === 0xd4) return parseExt(raw, 1)

  // fixext2
  else if (m === 0xd5) return parseExt(raw, 2)

  // fixext4
  else if (m === 0xd6) return parseExt(raw, 4)

  // fixext8
  else if (m === 0xd7) return parseExt(raw, 8)

  // fixext16
  else if (m === 0xd8) return parseExt(raw, 16)

  // uint64
  else if (m === 0xcf) (ix += 9, NOT_SUPPORTED)

  // int64
  else if (m === 0xd3) (ix += 9, NOT_SUPPORTED)

  else if (m === undefined) {
    incomplete = true
    partialBuffer = raw
    return
  }

  else return (ix += 1, NOT_SUPPORTED)
}

const toMap = (raw: Buffer, length: number): any => {
  if (length === 0) return EMPTY_OBJECT

  const res = Object.create(null)

  for (let it = 0; it < length; it++) {
    const key = superparse(raw)
    const val = superparse(raw)
    res[key] = val
  }

  return res
}

const toStr = (raw: Buffer, length: number) => {
  ix += length
  if (length === 0) return EMPTY_STR
  // this is probably the most clever line in this module. deserializing
  // msgpack is fucking slow in v8. outside of JSON, allocating strings is
  // super slow and the bulk of our string allocs come from "grid_line" events
  // which contain 1 char strings.
  //
  // i've already setup the webgl renderer to take in ascii char codes and
  // translate them to texture coordinates, so creating strings for rendering
  // purposes is a waste of time
  //
  // the only downside to this approach is for any events that are not
  // "grid_line" - those events will need to deal with either strings or an
  // ascii char code (and maybe convert the char code to string).  we can do
  // this based on the nvim api protocol types, so anywhere where we expect
  // strings we can check for a number and convert it to str.
  if (length === 1 && skipStringAllocationBecauseMsgpackIsFuckingSlow) return raw[ix - 1]
  return raw.toString('utf8', ix - length, ix)
}

const toArr = (raw: Buffer, length: number): any[] => {
  if (length === 0) return EMPTY_ARR
  const res = new Array(length)
  for (let it = 0; it < length; it++) res[it] = superparse(raw)
  return res
}

const parseExt = (raw: Buffer, size: number) => {
  const previx = ix
  const kind = raw[ix + 1] - 0x00
  const start = ix + 2
  const end = start + size
  ix = 0
  const id: any = superparse(raw.slice(start, end))
  ix = previx + 2 + size
  return { id, kind }
}

type RedrawEvent = [string, any[]]
type RedrawFunc = (redrawEvents: RedrawEvent[]) => void
type APIFunc = (event: any) => void

let redrawFn: RedrawFunc = () => {}
let apiFn: APIFunc = () => {}

export const onRedraw = (fn: RedrawFunc) => redrawFn = fn
// TODO: butttttt yeah, we may need to register multiple api funcs here
export const onApi = (fn: APIFunc) => apiFn = fn

// msgpack encoded form of ---> [2, 'redraw'
const redrawEventKey = Buffer.from([ 0x93, 0x02, 0xa6, 0x72, 0x65, 0x64, 0x72, 0x61, 0x77 ])

export const decode = (raw: Buffer) => {
  const workingBuffer = incomplete
    ? Buffer.concat([ partialBuffer, raw ])
    : raw

  // if we have a "redraw" event we will skip allocation of strings that are
  // only 1 byte long.  strings that are 1 byte long happen to be ascii chars.
  // we can handle these ascii code points as raw numbers in the rendering
  // redraw logic. this greaty improves performance as allocating strings
  // is too damn slow in v8. would have been much better if neovim used JSON
  // or if i wasn't a noob and picked a statically compiled language like rust
  const part = workingBuffer.slice(0, redrawEventKey.length)
  skipStringAllocationBecauseMsgpackIsFuckingSlow = redrawEventKey.equals(part)

  const bufsize = workingBuffer.length
  if (incomplete) incomplete = false
  ix = 0

  while (ix < bufsize) {
    const res = superparse(workingBuffer)
    if (incomplete) return
    if (res[1] === 'redraw') redrawFn(res[2])
    else apiFn(res)
  }
}
