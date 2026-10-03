import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { StatusPill, Text, useTheme } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { Page } from '@/components/Page';
import { useCurrentStore } from '@/features/store/queries';
import { useT } from '@/lib/i18n';
import { prefs, usePrefs } from '@/lib/prefs';

/** Store picker: shown when a person works at more than one store, and from "بدّل المحل". */
export default function Stores() {
  const theme = useTheme();
  const t = useT();
  const p = usePrefs();
  const { stores, access } = useCurrentStore();
  return (
    <Page title={t('merchant.stores.title')} subtitle={t('merchant.stores.subtitle')} back={access === 'ready'} maxWidth={640} testID="stores">
      <View style={{ gap: theme.space[3] }}>
        {stores.map((s) => {
          const current = s.orgId === p.storeId;
          return (
            <Pressable
              key={s.orgId}
              testID={`store-${s.orgId}`}
              accessibilityRole="button"
              onPress={() => {
                void prefs.setStore(s.orgId).then(() => router.replace('/'));
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space[4],
                padding: theme.space[4],
                borderRadius: theme.radius.xl,
                backgroundColor: theme.colors.surface,
                borderWidth: current ? 2 : 1,
                borderColor: current ? theme.colors.accent : theme.colors.border,
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
                <MIcon name={s.type === 'grocer' ? 'cart' : 'utensils'} size={26} color="accentText" />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="title" weight={700}>
                  {s.name}
                </Text>
                <Text variant="footnote" color="textMuted">
                  {t(s.type === 'grocer' ? 'merchant.stores.type_grocer' : 'merchant.stores.type_restaurant')}
                </Text>
              </View>
              <StatusPill tone={s.role === 'owner' ? 'accent' : 'neutral'} label={t(s.role === 'owner' ? 'merchant.stores.role_owner' : 'merchant.stores.role_staff')} />
              <MIcon name="chevron-forward" size={20} color="textMuted" />
            </Pressable>
          );
        })}
      </View>
    </Page>
  );
}
