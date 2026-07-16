import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme/useTheme';

export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors, dark } = useTheme();
  return (
    <NativeTabs
      backgroundColor={colors.glass}
      blurEffect={dark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
      iconColor={{ default: colors.secondaryLabel, selected: colors.brand }}
      indicatorColor={colors.brandSoft}
      labelStyle={{
        default: { color: colors.secondaryLabel, fontSize: 10, fontWeight: '600' },
        selected: { color: colors.brand, fontSize: 10, fontWeight: '700' },
      }}
      labelVisibilityMode="labeled"
      minimizeBehavior="onScrollDown"
      rippleColor={colors.brandSoft}
      tintColor={colors.brand}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon
          md={{ default: 'home', selected: 'home' }}
          sf={{ default: 'house', selected: 'house.fill' }}
        />
        <NativeTabs.Trigger.Label>{t('tabs.home')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="konular">
        <NativeTabs.Trigger.Icon
          md={{ default: 'menu_book', selected: 'menu_book' }}
          sf={{ default: 'books.vertical', selected: 'books.vertical.fill' }}
        />
        <NativeTabs.Trigger.Label>{t('tabs.topics')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="gelisim">
        <NativeTabs.Trigger.Icon
          md={{ default: 'show_chart', selected: 'show_chart' }}
          sf={{ default: 'chart.line.uptrend.xyaxis', selected: 'chart.line.uptrend.xyaxis' }}
        />
        <NativeTabs.Trigger.Label>{t('tabs.progress')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tercih">
        <NativeTabs.Trigger.Icon
          md={{ default: 'school', selected: 'school' }}
          sf={{ default: 'graduationcap', selected: 'graduationcap.fill' }}
        />
        <NativeTabs.Trigger.Label>{t('tabs.preferences')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="haberler">
        <NativeTabs.Trigger.Icon
          md={{ default: 'newspaper', selected: 'newspaper' }}
          sf={{ default: 'newspaper', selected: 'newspaper.fill' }}
        />
        <NativeTabs.Trigger.Label>{t('tabs.news')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
