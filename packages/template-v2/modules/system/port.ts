export type SystemPort = {
  getVersion(): string
}

export function createSystemPort(): SystemPort {
  return {
    getVersion() {
      return '0.1.0'
    },
  }
}
