import type { ReactNode } from 'react';
import { View } from 'react-native';
import { t } from '@driver/i18n';
import { Skeleton } from '../components/Skeleton';
import { useTheme } from '../theme/ThemeProvider';
import { HomeCard } from './cards';
import { homeSize } from './format';
import { useHomeLook } from './look';

/**
 * Loading shapes for the home (spec §7: "the card's shape, not a spinner"). Each matches the real piece's
 * size so nothing jumps when the data lands. Screen readers hear one «لحظة…» per piece.
 */
function Loading({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <View testID={testID} accessible accessibilityRole="progressbar" accessibilityLabel={t('status.loading')}>
      {children}
    </View>
  );
}

export function HomeMapCardSkeleton({ mapHeight = homeSize.mapIdle, testID }: { mapHeight?: number; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  return (
    <Loading testID={testID}>
      <View style={{ borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: look.panel.fill, boxShadow: look.card.shadow ?? undefined, borderWidth: look.card.edge ? 1 : 0, borderColor: look.card.edge ?? undefined }}>
        <Skeleton height={mapHeight} radius={0} />
        <View style={{ padding: theme.space[4], gap: theme.space[2] }}>
          <Skeleton width="55%" height={22} radius={theme.radius.sm} />
          <Skeleton width="100%" height={homeSize.button} radius={theme.radius.pill} />
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
          <Skeleton width={homeSize.foodTile} height={homeSize.boardTop} radius={tile.borderRadius} />
          <View style={{ flex: 1, gap }}>
            <Skeleton height={(homeSize.boardTop - gap) / 2} radius={tile.borderRadius} />
            <Skeleton height={(homeSize.boardTop - gap) / 2} radius={tile.borderRadius} />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap }}>
          <View style={{ flex: 1 }}>
            <Skeleton height={homeSize.boardBottom} radius={tile.borderRadius} />
          </View>
          <View style={{ flex: 1 }}>
            <Skeleton height={homeSize.boardBottom} radius={tile.borderRadius} />
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
        <Skeleton height={homeSize.dishPhoto} radius={0} />
        <View style={{ padding: theme.space[4], gap: theme.space[2] }}>
          <Skeleton width="70%" height={22} radius={theme.radius.sm} />
          <Skeleton width="50%" height={14} radius={theme.radius.sm} />
          <Skeleton height={homeSize.button} radius={theme.radius.pill} />
        </View>
      </HomeCard>
    </Loading>
  );
}

export function RestaurantRowSkeleton({ count = 2, width = homeSize.restWidth, testID }: { count?: number; width?: number; testID?: string }) {
  const theme = useTheme();
  return (
    <Loading testID={testID}>
      <View style={{ flexDirection: 'row', gap: theme.space[3], overflow: 'hidden' }}>
        {Array.from({ length: count }, (_, i) => (
          <HomeCard key={i} style={{ width, overflow: 'hidden' }}>
            <Skeleton height={homeSize.restPhoto} radius={0} />
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

/** Two dishes side by side, loading: the same photo height and card shape as `DishPair`. */
export function DishPairSkeleton({ testID }: { testID?: string }) {
  const theme = useTheme();
  return (
    <Loading testID={testID}>
      <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
        {[0, 1].map((i) => (
          <HomeCard key={i} style={{ flex: 1, overflow: 'hidden' }}>
            <Skeleton height={homeSize.pairPhoto} radius={0} />
            <View style={{ padding: theme.space[3], gap: theme.space[2] }}>
              <Skeleton width="80%" height={16} radius={theme.radius.sm} />
              <Skeleton width="50%" height={12} radius={theme.radius.sm} />
              <Skeleton width={theme.hitTarget} height={theme.hitTarget} radius={theme.hitTarget / 2} />
            </View>
          </HomeCard>
        ))}
      </View>
    </Loading>
  );
}
