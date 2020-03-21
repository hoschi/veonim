import { SpawnOptions, ChildProcess, spawn } from 'child_process'
import { join } from 'path'

type Binary = (args?: string[], options?: SpawnOptions) => ChildProcess

interface INeovim {
  run: Binary,
  $VIMRUNTIME: string,
  $VIM: string,
}

const binpath = join(__dirname, '..', 'binaries')
const spawnBinary = (command: string, args?: string[], options?: SpawnOptions) => {
  const name = process.platform === 'win32' ? `${command}.exe` : command
  return spawn(name, args, options)
}

export const Neovim: INeovim = {
  run: (args, opts) => {
    const binPath = process.env.NVIM_DEV ? process.env.NVIM_DEV : join(binpath, 'neovim', 'bin', 'nvim')
    return spawnBinary(binPath, args, opts)
  },
  $VIMRUNTIME: join(binpath, 'neovim', 'share', 'nvim', 'runtime'),
  $VIM: join(binpath, 'neovim', 'share', 'nvim'),
}

export const Ripgrep: Binary = (args, opts) => spawnBinary(join(binpath, 'ripgrep', 'rg'), args, opts)
export const Archiver: Binary = (args, opts) => spawnBinary(join(binpath, 'archiver'), args, opts)
