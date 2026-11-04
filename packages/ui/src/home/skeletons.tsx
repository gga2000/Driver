import { View } from 'react-native';
import { t } from '@driver/i18n';
import { Skeleton } from '../components/Skeleton';
import { useTheme } from '../theme/ThemeProvider';
import { HomeCard } from './cards';
import { useHomeLook } from './look';

/**
 * Loading shapes for the home (spec §7: "the card's shape, not a spinner"). Each matches the real piece's
 * size so nothing jumps when the data lands. Screen readers hear one «لحظة…» per piece.
 */
function Loading({ children, testID }: { children: React.ReactNode; testID?: string }) {
  return (
    <View testID={testID} accessible accessibilityRole="progressbar" accessibilityLabel={t('status.loading')}>
      {children}
    </View>
  );
}

export function HomeMapCardSkeleton({ mapHeight = 200, testID }: { mapHeight?: number; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <Loading testID={testID}>
      <View style={{ borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: look.panel.fill }}>
        <View style={{ height: mapHeight, backgroundColor: look.map.land }} />
        <View style={{ padding: theme.space[4], gap: theme.space[2] }}>
          <Skeleton width="55%" height={22} radius={theme.radius.sm} />
          <Skeleton width="100%" height={48} radius={theme.radius.pill} />
        </View>
      </View>
    </Loading>
  );
}

export function LiveBoardSkeleton({ testID }: { testID?: string }) {
  const theme = useTheme();
  const gap = theme.space[2];
  const tile = { borderRadius: theme.radius.xl } as const;
  return (
    <Loading testID={testID}>
      <View style={{ gap }}>
        <View style={{ flexDirection: 'row', gap }}>
          <Skeleton width={108} height={216} radius={tile.borderRadius} />
          <View style={{ flex: 1, gap }}>
            <Skeleton height={104} radius={tile.borderRadius} />
            <Skeleton height={104} radius={tile.borderRadius} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap }}>
          <View style={{ flex: 1 }}>
            <Skeleton height={96} radius={tile.borderRadius} />
          </View>
          <View style={{ flex: 1 }}>
            <Skeleton height={96} radius={tile.borderRadius} />
          </View>
        </View>
      </View>
    </Loading>
  );
}

export function DishCardSkeleton({ testID }: { testID?: string }) {
  const theme = useTheme();
  return (
    <Loading testID={testID}>
      <HomeCard style={{ overflow: 'hidden' }}>
        <Skeleton height={188} radius={0} />
        <View style={{ padding: theme.space[4], gap: theme.space[2] }}>
          <Skeleton width="70%" height={22} radius={theme.radius.sm} />
          <Skeleton width="50%" height={14} radius={theme.radius.sm} />
          <Skeleton height={48} radius={theme.radius.pill} />
        </View>
      </HomeCard>
    </Loading>
  );
}

export function RestaurantRowSkeleton({ count = 2, width = 228, testID }: { count?: number; width?: number; testID?: string }) {
  const theme = useTheme();
  return (
    <Loading testID={testID}>
      <View style={{ flexDirection: 'row', gap: theme.space[3], overflow: 'hidden' }}>
        {Array.from({ length: count }, (_, i) => (
          <HomeCard key={i} style={{ width, overflow: 'hidden' }}>
            <Skeleton height={128} radius={0} />
            <View style={{ padding: theme.space[3], gap: theme.space[2] }}>
              <Skeleton width="80%" height={16} radius={theme.radius.sm} />
              <Skeleton width="55%" height={12} radius={theme.radius.sm} />
            </View>
          </HomeCard>
        ))}
      </View>
    </Loading>
  );
}
