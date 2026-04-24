export interface CircuitBreakerOptions {
  threshold: number // failures before opening
  resetTimeout: number // ms before transitioning from open to half-open
}

type CircuitState = 'closed' | 'open' | 'half-open'

export class CircuitBreaker {
  private state: CircuitState = 'closed'
  private failures = 0
  private openedAt = 0
  private readonly threshold: number
  private readonly resetTimeout: number

  constructor(options: CircuitBreakerOptions) {
    this.threshold = options.threshold
    this.resetTimeout = options.resetTimeout
  }

  isOpen(): boolean {
    if (this.state === 'open') {
      // Check if we should transition to half-open
      if (Date.now() - this.openedAt >= this.resetTimeout) {
        this.state = 'half-open'
        return false
      }
      return true
    }
    return false
  }

  isHalfOpen(): boolean {
    // isOpen() may transition state, so call it first
    this.isOpen()
    return this.state === 'half-open'
  }

  recordFailure(): void {
    if (this.state === 'half-open') {
      // Re-open immediately from half-open
      this.state = 'open'
      this.openedAt = Date.now()
      return
    }

    this.failures++
    if (this.failures >= this.threshold) {
      this.state = 'open'
      this.openedAt = Date.now()
    }
  }

  recordSuccess(): void {
    this.failures = 0
    this.state = 'closed'
  }
}
