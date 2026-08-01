export interface UIService {
  log(message: string): void
  promptPlayer(names: string[], currentStored: string): Promise<string>
}
