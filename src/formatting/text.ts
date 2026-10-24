import { decodeHTMLStrict } from 'entities';

const punctuation = /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/;

export function decodeText(source: string): string {
  let result = '';
  for (let i = 0; i < source.length;) {
    const character = source[i]!;
    if (character === '\\' && source[i + 1] && punctuation.test(source[i + 1]!)) {
      result += source[i + 1]; i += 2;
    } else if (character === '&') {
      const entity = /^&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][\da-zA-Z]+);/.exec(source.slice(i));
      if (entity) { result += decodeHTMLStrict(entity[0]); i += entity[0].length; }
      else { result += character; i++; }
    } else { result += character; i++; }
  }
  return result;
}

export function markdownText(text: string): string {
  return text.replace(/[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/g, character => `\\${character}`);
}

export function htmlText(text: string): string {
  return text.replace(/[&<>\\`*_~=[\]$%]/g, character => {
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    if (character === '>') return '&gt;';
    return `&#${character.charCodeAt(0)};`;
  });
}
