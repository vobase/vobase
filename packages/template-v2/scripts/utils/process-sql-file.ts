import { dirname, join } from 'node:path';
import { Glob } from 'bun';

const INCLUDE_REGEX = /^--!include\s+(.*)$/gm;

export async function processSqlFile(filePath: string): Promise<string> {
  const fileContent = await Bun.file(filePath).text();
  const fileDir = dirname(filePath);

  const parts = fileContent.split(INCLUDE_REGEX);
  const resultParts: string[] = [parts[0] ?? ''];

  for (let i = 1; i < parts.length; i += 2) {
    const includePath = parts[i]?.trim();
    const glob = new Glob(includePath);
    const includedContents: string[] = [];

    for await (const file of glob.scan(fileDir)) {
      const includedFilePath = join(fileDir, file);
      const includedContent = await processSqlFile(includedFilePath);
      includedContents.push(includedContent);
    }

    resultParts.push(includedContents.join('\n\n'));

    if (parts[i + 1]) {
      resultParts.push(parts[i + 1] ?? '');
    }
  }

  return resultParts.join('');
}
