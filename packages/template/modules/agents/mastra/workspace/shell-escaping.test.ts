import { describe, expect, test } from 'bun:test';

/**
 * End-to-end shell escaping tests.
 *
 * These verify that the just-bash interpreter correctly handles escaped
 * metacharacters in vobase command arguments — the same escaping pattern
 * we instruct agents to use in AGENTS.md.
 */
describe('shell escaping through just-bash', () => {
  /** Captured args from the last vobase command invocation. */
  let captured: string[] = [];

  async function createBashWithCapture() {
    const { Bash, InMemoryFs } = await import('just-bash');
    const fs = new InMemoryFs();

    const vobaseCmd = {
      name: 'vobase',
      trusted: true,
      execute: async (args: string[]) => {
        captured = args;
        return { stdout: 'ok', stderr: '', exitCode: 0 };
      },
    };

    return new Bash({ fs, customCommands: [vobaseCmd] });
  }

  test('escaped dollar sign preserves literal value', async () => {
    const bash = await createBashWithCapture();
    await bash.exec('vobase reply "The consultation costs \\$80"');
    expect(captured[0]).toBe('reply');
    expect(captured.join(' ')).toContain('$80');
  });

  test('unescaped dollar sign gets expanded (broken)', async () => {
    const bash = await createBashWithCapture();
    await bash.exec('vobase reply "The consultation costs $80"');
    expect(captured[0]).toBe('reply');
    // $8 is an unset variable → expands to empty, leaving just "0"
    expect(captured.join(' ')).not.toContain('$80');
  });

  test('escaped backticks preserve literal value', async () => {
    const bash = await createBashWithCapture();
    await bash.exec('vobase reply "Use the \\`check-slots\\` command"');
    expect(captured.join(' ')).toContain('`check-slots`');
  });

  test('single-quoted arguments bypass expansion', async () => {
    const bash = await createBashWithCapture();
    await bash.exec("vobase reply 'The cost is $80 per visit'");
    expect(captured.join(' ')).toContain('$80');
  });

  test('mixed escaping in realistic agent reply', async () => {
    const bash = await createBashWithCapture();
    await bash.exec(
      'vobase reply "General Consultation: \\$80, Health Screening: \\$150"',
    );
    expect(captured.join(' ')).toContain('$80');
    expect(captured.join(' ')).toContain('$150');
  });
});
