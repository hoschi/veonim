import { asColor, ID, onFnCall, merge, prefixWith, getPipeName } from '../support/utils'
import MsgpackStreamDecoder from '../messaging/msgpack-decoder'
import MsgpackStreamEncoder from '../messaging/msgpack-encoder'
import { startupFuncs, startupCmds } from '../neovim/startup'
import { Api, Prefixes } from '../neovim/protocol'
import { Color, Highlight } from '../neovim/types'
import { Neovim } from '../support/binaries'
import { ChildProcess } from 'child_process'
import SetupRPC from '../messaging/rpc'
import { homedir } from 'os'

type RedrawFn = (m: any[]) => void
type ExitFn = (id: number, code: number) => void

interface VimInstance {
  id: number,
  proc: ChildProcess,
  attached: boolean,
  pipeName: string,
}

interface NewVimResponse {
  id: number,
  path: string,
}

let vimOptions : any = {
  ext_popupmenu: true,
  ext_tabline: true,
  ext_wildmenu: true,
  ext_cmdline: true,
  ext_messages: true,
  ext_multigrid: true,
  ext_hlstate: true,
}

if (process.env.NVIM_DEV) {
  vimOptions.ext_windows = true
}
// FIXME remove me
console.log('vim options', vimOptions)

const ids = {
  vim: ID(),
  activeVim: -1,
}

const clientSize = {
  width: 0,
  height: 0,
}

let onExitFn: ExitFn = () => {}
const prefix = prefixWith(Prefixes.Core)
const vimInstances = new Map<number, VimInstance>()
const msgpackDecoder = new MsgpackStreamDecoder()
const msgpackEncoder = new MsgpackStreamEncoder()

const spawnVimInstance = (pipeName: string) => Neovim.run([
  '--cmd', `com! -nargs=+ -range -complete=custom,VeonimCmdCompletions Veonim call Veonim(<f-args>)`,
  '--cmd', `com! -nargs=1 Plug call add(g:_veonim_plugins, <args>)`,
  '--embed',
  '--listen',
  pipeName
], {
  cwd: homedir(),
  env: {
    ...process.env,
    VIM: Neovim.$VIM,
    VIMRUNTIME: Neovim.$VIMRUNTIME,
  },
})

const createNewVimInstance = (): number => {
  const pipeName = getPipeName('veonim-instance')
  const proc = spawnVimInstance(pipeName)
  const id = ids.vim.next()

  vimInstances.set(id, { id, proc, pipeName, attached: false })

  proc.on('error', (e: any) => console.error(`vim ${id} err ${e}`))
  // someone fucked up the types so i gotta do this shit with the !!!!! symbols
  proc.stdout!.on('error', (e: any) => console.error(`vim ${id} stdout err ${(JSON.stringify(e))}`))
  proc.stdin!.on('error', (e: any) => console.error(`vim ${id} stdin err ${(JSON.stringify(e))}`))
  proc.on('exit', (c: any) => onExitFn(id, c))

  return id
}

export const switchTo = (id: number) => {
  if (!vimInstances.has(id)) return
  const { proc, attached } = vimInstances.get(id)!

  if (ids.activeVim > -1) {
    msgpackEncoder.unpipe()
    vimInstances.get(ids.activeVim)!.proc.stdout!.unpipe()
  }

  msgpackEncoder.pipe(proc.stdin!)
  // don't kill decoder stream when this stdout stream ends (need for other stdouts)
  proc.stdout!.pipe(msgpackDecoder, { end: false })
  ids.activeVim = id

  // sending resize (even of the same size) makes vim instance clear/redraw screen
  // this is how to repaint the UI with the new vim instance. not the most obvious...
  if (attached) api.uiTryResize(clientSize.width, clientSize.height)
}

export const create = async ({ dir } = {} as { dir?: string }): Promise<NewVimResponse> => {
  const id = createNewVimInstance()
  switchTo(id)

  api.command(`${startupFuncs()} | ${startupCmds}`)
  dir && api.command(`cd ${dir}`)

  const { pipeName } = vimInstances.get(id)!
  return { id, path: pipeName }
}

export const attachTo = (id: number) => {
  if (!vimInstances.has(id)) return
  const vim = vimInstances.get(id)!
  if (vim.attached) return
  api.uiAttach(clientSize.width, clientSize.height, vimOptions)
  // highlight groups defined before nvim_ui_attach get reset
  api.command(`highlight ${Highlight.Undercurl} gui=undercurl`)
  api.command(`highlight ${Highlight.Underline} gui=underline`)
  vim.attached = true
}

const { notify, request, onEvent, onData } = SetupRPC(m => msgpackEncoder.write(m))
msgpackDecoder.on('data', ([type, ...d]: [number, any]) => onData(type, d))

const req: Api = onFnCall((name: string, args: any[] = []) => request(prefix(name), args))
const api: Api = onFnCall((name: string, args: any[]) => notify(prefix(name), args))

export const onExit = (fn: ExitFn) => { onExitFn = fn }
export const onRedraw = (fn: RedrawFn) => onEvent('redraw', fn)
export const input = (keys: string) => api.input(keys)
export const getMode = () => req.getMode() as Promise<{ mode: string, blocking: boolean }>

export const resizeGrid = (grid: number, width: number, height: number) => {
  if (ids.activeVim > -1) {
    console.log('---------- Step X')
    api.uiTryResizeGrid(grid, width, height)
  }
}

export const resize = (width: number, height: number) => {
  merge(clientSize, { width, height })
  if (ids.activeVim > -1) api.uiTryResize(width, height)
}

export const getColor = async (id: number) => {
  const { foreground, background } = await req.getHlById(id, true) as Color
  return {
    fg: asColor(foreground),
    bg: asColor(background),
  }
}
