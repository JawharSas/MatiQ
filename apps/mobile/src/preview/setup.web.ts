/**
 * Browser UI preview setup. react-native-web's Alert.alert is a no-op, so
 * confirmations (delete, dispute resolution, ...) would never fire; map them
 * to window.confirm, choosing the last (affirmative) button on OK.
 */
import { Alert, type AlertButton } from 'react-native';

Alert.alert = (title: string, message?: string, buttons?: AlertButton[]) => {
  const options = buttons ?? [{ text: 'OK' }];
  const affirmative = options[options.length - 1];
  const cancel = options.find((button) => button.style === 'cancel');
  if (options.length === 1 || window.confirm([title, message].filter(Boolean).join('\n\n'))) {
    affirmative?.onPress?.();
  } else {
    cancel?.onPress?.();
  }
};
