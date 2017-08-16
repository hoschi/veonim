import { NewlineSplitter } from '../utils'
import { filter } from 'fuzzaldrin-plus'
import Ripgrep from '@veonim/ripgrep'

const INTERVAL = 250
const AMOUNT = 10
let results: string[] = []
let query = ''

const sendResults = ({ noFilter = false } = {}) => postMessage(['results', !noFilter && query
  ? filter(results, query).slice(0, AMOUNT)
  : results.slice(0, AMOUNT)
])

const getFiles = (cwd: string) => {
  results = []
  query = ''
  let alive = true
  let initialSent = false
  const timer = setInterval(() => sendResults(), INTERVAL)
  const rg = Ripgrep(['--files'], { cwd })

  rg.stdout.pipe(NewlineSplitter()).on('data', (path: string) => {
    if (!initialSent && results.length >= AMOUNT) (initialSent = true, sendResults({ noFilter: true }))
    results.push(path)
  })

  rg.on('exit', () => {
    alive = false
    if (!initialSent) (initialSent = true, sendResults({ noFilter: true }))
    clearInterval(timer)
    sendResults()
    postMessage(['done'])
  })

  setImmediate(() => sendResults({ noFilter: true }))
  return () => alive && rg.kill()
}

onmessage = ({ data: [e, data] }: MessageEvent) => {
  let stopSearch = () => {}
  if (e === 'stop') return stopSearch()
  if (e === 'load') return (stopSearch = getFiles(data))
  if (e === 'query') return (query = data, sendResults())
}
