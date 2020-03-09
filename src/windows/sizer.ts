import { WindowInfo } from '../windows/window'
import { within } from '../support/utils'
import { size } from '../core/workspace'

const getSplits = (wins: WindowInfo[]) => {
  const vertical = new Set<number>()
  const horizontal = new Set<number>()
  wins.forEach(w => (vertical.add(w.col), horizontal.add(w.row)))
  return { vertical, horizontal }
}

const equalizeTo100 = (percentages: number[]) => {
  const total = percentages.reduce((total, num) => total + num, 0)
  if (total >= 100) return percentages

  const remainTo100 = 100 - total
  const items = percentages.slice()
  items[0] += remainTo100
  return items
}

// FIXME get real numbers
const rowHeightInPx = 14;
const colWidthInPx = 5;

export default (wins: WindowInfo[]) => {
  const windowsWithGridInfo = wins.map(w => ({
    ...w,
    top: w.row * rowHeightInPx,
    left: w.col * colWidthInPx
  }))

  // return only windowGridInfo
  return {
    windowGridInfo: windowsWithGridInfo,
  }
}
