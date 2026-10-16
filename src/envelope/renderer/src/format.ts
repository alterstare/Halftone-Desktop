// "1:02:03" / "4:05"
export function clock(s: number | null | undefined): string {
  if (s === null || s === undefined || !isFinite(s) || s < 0) return '--:--'
  const t = Math.floor(s)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const sec = String(t % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

// "2시간 5분" / "45분" / "1분 미만"
export function length(s: number | null | undefined): string {
  if (!s) return ''
  const m = Math.round(s / 60)
  if (m === 0) return '1분 미만'
  const h = Math.floor(m / 60)
  return h ? `${h}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`
}
