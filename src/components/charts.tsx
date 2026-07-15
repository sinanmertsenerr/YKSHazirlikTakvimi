import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Bar, CartesianChart, Line } from 'victory-native';

import { useTheme } from '@/theme/useTheme';
import { formatNumber } from '@/utils/format';

type Point = { index: number; value: number; label: string };

export function NetLineChart({ data, target }: { data: Point[]; target?: number }) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const values = data.map((point) => point.value);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const last = values.at(-1) ?? 0;

  return (
    <View
      accessibilityLabel={t('progress.netChartA11y', {
        last: formatNumber(last, i18n.language),
        min: formatNumber(min, i18n.language),
        max: formatNumber(max, i18n.language),
        target:
          target == null
            ? ''
            : t('progress.targetA11y', {
                target: formatNumber(target, i18n.language),
              }),
      })}
      accessible
    >
      <View style={styles.chart}>
        <CartesianChart
          data={data.length ? data : [{ index: 0, value: 0, label: '' }]}
          domainPadding={{ left: 8, right: 8, top: 16, bottom: 8 }}
          xKey="index"
          yKeys={['value']}
        >
          {({ points }) => (
            <Line
              animate={{ type: 'timing', duration: 300 }}
              color={colors.tyt}
              curveType="natural"
              points={points.value}
              strokeCap="round"
              strokeJoin="round"
              strokeWidth={3}
            />
          )}
        </CartesianChart>
      </View>
      <View style={styles.chartLabels}>
        <Text numberOfLines={1} style={[styles.label, { color: colors.secondaryLabel }]}>
          {data[0]?.label ?? ''}
        </Text>
        <Text numberOfLines={1} style={[styles.label, { color: colors.brand }]}>
          {target == null ? '' : `${t('progress.target')} ${formatNumber(target, i18n.language)}`}
        </Text>
        <Text numberOfLines={1} style={[styles.label, { color: colors.secondaryLabel }]}>
          {data.at(-1)?.label ?? ''}
        </Text>
      </View>
    </View>
  );
}

export function YearBarChart({ data }: { data: Point[] }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <View accessibilityLabel={t('topics.yearlyChartA11y', { total })} accessible>
      <View style={styles.chart}>
        <CartesianChart
          data={data}
          domainPadding={{ left: 6, right: 6, top: 16 }}
          xKey="index"
          yKeys={['value']}
        >
          {({ points, chartBounds }) => (
            <Bar
              chartBounds={chartBounds}
              color={colors.brand}
              points={points.value}
              roundedCorners={{ topLeft: 5, topRight: 5 }}
            />
          )}
        </CartesianChart>
      </View>
      <View style={styles.yearLabels}>
        {data.map((item) => (
          <Text
            key={item.index}
            numberOfLines={1}
            style={[styles.yearLabel, { color: colors.secondaryLabel }]}
          >
            {item.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { height: 130 },
  chartLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  label: { flexShrink: 1, fontSize: 11, lineHeight: 14, fontWeight: '600' },
  yearLabels: { flexDirection: 'row', justifyContent: 'space-around' },
  yearLabel: { flexShrink: 1, fontSize: 9, lineHeight: 12 },
});
