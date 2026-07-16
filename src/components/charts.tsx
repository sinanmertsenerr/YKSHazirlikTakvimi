import { MaterialIcons } from '@expo/vector-icons';
import { useMemo, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { CartesianChart, Line } from 'victory-native';

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

type YearPoint = { year: number; value: number };
type YearCell = { year: number; value: number | null; pending: boolean };

const BAR_AREA_HEIGHT = 116;
const BUCKET_SIZE = 5;

const shortYear = (year: number) => `'${String(year).slice(-2)}`;

// Paginated bar chart with FIXED 5-year buckets ([2018–2022], [2023–2027], …). Each bucket
// always shows 5 year slots; years past the latest published one render as a muted "pending"
// slot ("–", distinct from a real 0) so a partial range never looks misleading. A new bucket
// appears on its own once published data reaches it. Swipe or use the arrows to move between
// buckets; columns are flex-sized so the chart is responsive to any screen width.
export function YearBarChart({ data }: { data: YearPoint[] }) {
  const { colors, typography } = useTheme();
  const { t } = useTranslation();
  const scrollRef = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);

  const { buckets, max, total } = useMemo(() => {
    const sorted = [...data].sort((left, right) => left.year - right.year);
    const firstYear = sorted[0]?.year;
    const lastYear = sorted[sorted.length - 1]?.year;
    if (firstYear === undefined || lastYear === undefined) {
      return { buckets: [] as YearCell[][], max: 1, total: 0 };
    }
    const valueByYear = new Map(sorted.map((point) => [point.year, point.value]));
    const lastBucketStart =
      firstYear + Math.floor((lastYear - firstYear) / BUCKET_SIZE) * BUCKET_SIZE;
    const lastBucketEnd = lastBucketStart + BUCKET_SIZE - 1;
    const cells: YearCell[] = [];
    for (let year = firstYear; year <= lastBucketEnd; year += 1) {
      const value = valueByYear.get(year);
      if (value !== undefined) cells.push({ year, value, pending: false });
      else if (year > lastYear) cells.push({ year, value: null, pending: true });
      else cells.push({ year, value: 0, pending: false });
    }
    const chunks: YearCell[][] = [];
    for (let i = 0; i < cells.length; i += BUCKET_SIZE) {
      chunks.push(cells.slice(i, i + BUCKET_SIZE));
    }
    return {
      buckets: chunks,
      max: Math.max(1, ...sorted.map((point) => point.value)),
      total: sorted.reduce((sum, point) => sum + point.value, 0),
    };
  }, [data]);

  const lastPage = Math.max(0, buckets.length - 1);
  const safePage = Math.min(page, lastPage);
  const visible = buckets[safePage] ?? [];
  const firstCell = visible[0];
  const lastCell = visible[visible.length - 1];
  const rangeLabel =
    firstCell && lastCell ? `${shortYear(firstCell.year)}–${shortYear(lastCell.year)}` : '';

  const goTo = (next: number) => {
    const clamped = Math.max(0, Math.min(lastPage, next));
    setPage(clamped);
    if (width) scrollRef.current?.scrollTo({ x: clamped * width, animated: true });
  };

  // Opens on the oldest bucket; the reader pages right toward newer years.
  const handleLayout = (nextWidth: number) => {
    if (nextWidth > 0 && nextWidth !== width) setWidth(nextWidth);
  };

  const handleMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width) setPage(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  return (
    <View accessible accessibilityLabel={t('topics.yearlyChartA11y', { total })}>
      <View onLayout={(event) => handleLayout(event.nativeEvent.layout.width)}>
        <ScrollView
          horizontal
          onMomentumScrollEnd={handleMomentumEnd}
          pagingEnabled
          ref={scrollRef}
          scrollEnabled={buckets.length > 1 && width > 0}
          showsHorizontalScrollIndicator={false}
        >
          {width > 0
            ? buckets.map((bucket, bucketIndex) => (
                <View key={bucketIndex} style={[styles.barPage, { width }]}>
                  {bucket.map((cell) => {
                    const barHeight =
                      cell.value && cell.value > 0
                        ? Math.max(6, (cell.value / max) * BAR_AREA_HEIGHT)
                        : 0;
                    return (
                      <View key={cell.year} style={styles.barColumn}>
                        <Text
                          style={[
                            typography.caption,
                            styles.barValue,
                            { color: cell.pending ? colors.tertiaryLabel : colors.label },
                          ]}
                        >
                          {cell.pending ? '–' : cell.value}
                        </Text>
                        <View style={styles.barTrack}>
                          {barHeight > 0 ? (
                            <View
                              style={[
                                styles.bar,
                                { height: barHeight, backgroundColor: colors.brand },
                              ]}
                            />
                          ) : null}
                        </View>
                        <Text
                          numberOfLines={1}
                          style={[
                            typography.caption,
                            { color: cell.pending ? colors.tertiaryLabel : colors.secondaryLabel },
                          ]}
                        >
                          {shortYear(cell.year)}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ))
            : null}
        </ScrollView>
      </View>
      {buckets.length > 1 ? (
        <View style={styles.pager}>
          <Pressable
            accessibilityLabel={t('common.previous')}
            accessibilityRole="button"
            disabled={safePage <= 0}
            hitSlop={8}
            onPress={() => goTo(safePage - 1)}
            style={styles.pagerButton}
          >
            <MaterialIcons
              color={safePage > 0 ? colors.brand : colors.tertiaryLabel}
              name="chevron-left"
              size={22}
            />
          </Pressable>
          <Text style={[typography.footnote, { color: colors.secondaryLabel }]}>{rangeLabel}</Text>
          <Pressable
            accessibilityLabel={t('common.next')}
            accessibilityRole="button"
            disabled={safePage >= lastPage}
            hitSlop={8}
            onPress={() => goTo(safePage + 1)}
            style={styles.pagerButton}
          >
            <MaterialIcons
              color={safePage < lastPage ? colors.brand : colors.tertiaryLabel}
              name="chevron-right"
              size={22}
            />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { height: 130 },
  chartLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  label: { flexShrink: 1, fontSize: 11, lineHeight: 14, fontWeight: '600' },
  barPage: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  barColumn: { flex: 1, alignItems: 'center', gap: 6 },
  barTrack: {
    width: '100%',
    height: BAR_AREA_HEIGHT,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bar: { width: '58%', maxWidth: 34, minWidth: 12, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  barValue: { fontWeight: '800' },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  pagerButton: { paddingVertical: 4, paddingHorizontal: 8, minWidth: 36, alignItems: 'center' },
});
