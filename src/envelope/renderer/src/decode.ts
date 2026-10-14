// The main process asks for a track as 16 kHz mono PCM (speech engines take
// that). Web Audio decodes whatever Chromium plays and resamples on its own
// thread; the answer goes back as Int16.
export async function decodeTo16k(url: string): Promise<Int16Array> {
  const buf = await (await fetch(url)).arrayBuffer()
  const probe = new OfflineAudioContext(1, 1, 44100)
  const audio = await probe.decodeAudioData(buf)
  const length = Math.max(1, Math.ceil(audio.duration * 16000))
  const off = new OfflineAudioContext(1, length, 16000) // one channel: the mix is averaged
  const src = off.createBufferSource()
  src.buffer = audio
  src.connect(off.destination)
  src.start()
  const out = (await off.startRendering()).getChannelData(0)
  const pcm = new Int16Array(out.length)
  for (let i = 0; i < out.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(out[i] * 32767)))
  return pcm
}

// Answer decode requests (one at a time is plenty: jobs run one by one).
export function serveDecoding(): () => void {
  return window.api.onDecodeRequest(({ id, url }) => {
    decodeTo16k(url).then(
      (pcm) => window.api.decodeReply(id, pcm),
      (e) => window.api.decodeReply(id, null, String((e as Error)?.message ?? e))
    )
  })
}
