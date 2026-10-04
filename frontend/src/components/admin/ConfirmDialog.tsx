import { Alert } from 'react-native';

/**
 * Native confirmation dialog for destructive admin actions (spec §3.3).
 * Returns whether the admin confirmed — usage:
 *
 *   if (await confirmDestructive('Suspend driver?', '…', 'Suspend')) { … }
 */
export function confirmDestructive(
  title: string,
  message: string,
  confirmLabel = 'Confirm',
): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
