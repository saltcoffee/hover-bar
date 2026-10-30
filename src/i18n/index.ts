import { en, type Strings, type TextKey } from './en';
import { zhCN } from './zh-cn';

export type { TextKey } from './en';
export type Translate = (key: TextKey, parameters?: Readonly<Record<string, string | number>>) => string;

export function stringsFor(language: string): Strings {
  return /^zh(?:[-_]|$)/i.test(language) ? zhCN : en;
}

export function translator(language: () => string): Translate {
  return (key, parameters) => stringsFor(language())[key].replace(/\{(\w+)\}/g, (match: string, name: string) => parameters?.[name] === undefined ? match : String(parameters[name]));
}
