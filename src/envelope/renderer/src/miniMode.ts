// 최소화 모드 in / out. The motion (a picture of the window squeezed into the
// bar / stretched back, like Windows' minimize) is done by main.
export const enterMini = (): Promise<void> => window.api.setMini(true)
export const leaveMini = (): Promise<void> => window.api.setMini(false)
