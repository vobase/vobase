/**
 * Creates a proxy that throws a descriptive error when any property is accessed.
 * Used for optional services (storage, channels) that are typed as non-optional
 * in VobaseCtx but may not be configured.
 */
export function createThrowProxy<T>(serviceName: string): T {
  return new Proxy(Object.create(null), {
    get(_target, prop) {
      if (prop === Symbol.toPrimitive || prop === Symbol.toStringTag || prop === 'inspect') {
        return undefined;
      }
      throw new Error(
        `${serviceName} is not configured. Add ${serviceName.toLowerCase()} configuration to your createApp() config to use ctx.${serviceName.toLowerCase()}.`,
      );
    },
  }) as T;
}
