/**
 * Structured logging for AI operations.
 *
 * NOTE: @mastra/core@^1.15.0 does not export OtelExporter directly.
 * Mastra observability requires a Mastra class instance, which this codebase doesn't use.
 * This module provides structured JSON logging as a foundation for future OTel integration.
 *
 * When OTEL_EXPORTER_OTLP_ENDPOINT is set, logs a startup message indicating
 * that tracing is desired — a full OTel SDK setup can be wired in later.
 */
export function configureTracing(): { enabled: boolean } {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  if (endpoint) {
    console.log(
      JSON.stringify({
        level: 'info',
        module: 'ai',
        event: 'tracing_configured',
        endpoint,
        message:
          'OTEL endpoint detected. Structured logging active. Install @opentelemetry/sdk-node for full tracing.',
      }),
    );
    return { enabled: true };
  }

  return { enabled: false };
}
