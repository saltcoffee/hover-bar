import type { TextKey } from '../i18n';
import type { FormatUnavailableReason } from '../formatting/types';
import type { LinkUnavailableReason } from '../links/wikilink';
import type { SelectionRejection } from './context';

export function selectionFeedback(reason: SelectionRejection): TextKey {
  if (reason.kind === 'preferences') return reason.status === 'conflict' ? 'settingsConflict' : reason.status;
  const keys = {
    noEditor: 'noSelection', modeDisabled: 'modeDisabled', readOnly: 'readOnly', composing: 'composing',
    multipleSelections: 'multipleSelections', emptySelection: 'emptySelection', tooLong: 'tooLong',
    multipleLines: 'multipleLines', syntaxPending: 'syntaxPending', protectedSyntax: 'protectedSyntax', unsupportedFragment: 'unsupported',
  } as const;
  return keys[reason.kind];
}

export function actionFeedback(reason: FormatUnavailableReason | LinkUnavailableReason): TextKey {
  if (reason === 'invalidParameter') return 'failed';
  if (reason === 'invalidText' || reason === 'invalidTarget') return 'invalidLink';
  return reason;
}
