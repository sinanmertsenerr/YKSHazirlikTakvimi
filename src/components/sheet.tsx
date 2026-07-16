import { MaterialIcons } from '@expo/vector-icons';
import { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme/useTheme';

// Bottom sheet drawn with RN's own Modal instead of native sheet APIs (pageSheet,
// Compose ModalBottomSheet) so iOS and Android render the exact same surface.
export function Sheet({
  visible,
  onClose,
  onRequestClose,
  title,
  headerLeft,
  children,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  // Android hardware back. Defaults to onClose; pass a custom handler to e.g.
  // step back to a previous page inside the sheet instead of dismissing it.
  onRequestClose?: () => void;
  title: string;
  headerLeft?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { colors, radii, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <Modal
      animationType="slide"
      onRequestClose={onRequestClose ?? onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <Pressable
          accessibilityLabel={t('common.close')}
          accessibilityRole="button"
          onPress={onClose}
          style={[styles.backdrop, { backgroundColor: colors.scrim }]}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderTopLeftRadius: radii.sheet,
              borderTopRightRadius: radii.sheet,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.separator }]} />
          <View style={styles.header}>
            {headerLeft}
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={[typography.headline, styles.title, { color: colors.label }]}
            >
              {title}
            </Text>
            <Pressable
              accessibilityLabel={t('common.close')}
              accessibilityRole="button"
              hitSlop={6}
              onPress={onClose}
              style={styles.close}
            >
              <MaterialIcons color={colors.secondaryLabel} name="close" size={24} />
            </Pressable>
          </View>
          <View style={styles.body}>{children}</View>
          {footer}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill },
  sheet: { maxHeight: '85%', paddingHorizontal: 18, paddingTop: 8 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginBottom: 4 },
  title: { flex: 1, minWidth: 0 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  body: { flexShrink: 1, minHeight: 0 },
});
