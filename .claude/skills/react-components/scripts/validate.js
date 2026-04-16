import fs from 'node:fs';
import path from 'node:path';
import swc from '@swc/core';

const HEX_COLOR_REGEX = /#[0-9A-Fa-f]{6}/;

async function validateComponent(filePath) {
  const code = fs.readFileSync(filePath, 'utf-8');
  const filename = path.basename(filePath);
  try {
    const ast = await swc.parse(code, { syntax: 'typescript', tsx: true });
    let hasInterface = false;
    const hexIssues = [];

    console.log('Scanning AST...');

    const walk = (node) => {
      if (!node) return;
      if (
        node.type === 'TsInterfaceDeclaration' &&
        node.id.value.endsWith('Props')
      )
        hasInterface = true;
      if (node.type === 'JSXAttribute' && node.name.name === 'className') {
        if (node.value?.value && HEX_COLOR_REGEX.test(node.value.value))
          hexIssues.push(node.value.value);
      }
      for (const key in node) {
        if (node[key] && typeof node[key] === 'object') walk(node[key]);
      }
    };
    walk(ast);

    console.log(`--- Validation for: ${filename} ---`);
    if (hasInterface) {
      console.log('PASS: Props declaration found.');
    } else {
      console.error("FAIL: MISSING Props interface (must end in 'Props').");
    }

    if (hexIssues.length === 0) {
      console.log('PASS: No hardcoded hex values found.');
    } else {
      console.error(`FAIL: Found ${hexIssues.length} hardcoded hex codes.`);
      hexIssues.forEach((hex) => console.error(`   - ${hex}`));
    }

    if (hasInterface && hexIssues.length === 0) {
      console.log('\nCOMPONENT VALID.');
      process.exit(0);
    } else {
      console.error('\nVALIDATION FAILED.');
      process.exit(1);
    }
  } catch (err) {
    console.error('PARSE ERROR:', err.message);
    process.exit(1);
  }
}

validateComponent(process.argv[2]);
