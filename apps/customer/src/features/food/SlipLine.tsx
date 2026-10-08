import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Rule, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/** A slip line: the label, a dotted leader and the amount; a saving in saffron; «ليش؟» opens the reason.
 * Shared by checkout's «الوصل» (c4) and every past order's receipt (o7). */
export function SlipLine({ label, amountIqd, reason, testID }: { label: string; amountIqd: number; reason?: string; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const [open, setOpen] = useState(false);
  const saving = amountIqd < 0;
  return (
    <View testID={testID} style={{ gap: 2, paddingVertical: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
        <Text variant="body" color={saving ? 'accentText' : 'text'} weight={saving ? 600 : 400} style={{ flexShrink: 1 }}>
          {label}
        </Text>
        {reason ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={`${t('checkout2.why')} ${label}`}
            onPress={() => setOpen((o) => !o)}
            testID={testID ? `${testID}-why` : undefined}
            style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', marginVertical: -12 }}
          >
            <Text variant="caption" weight={600} color="accentText">
              {t('checkout2.why')}
            </Text>
          </Pressable>
        ) : null}
        <Rule kind="dotted" color="borderStrong" thickness={1.5} style={{ flex: 1, minWidth: theme.space[3], alignSelf: 'center', marginTop: 8 }} />
        <Text variant="body" weight={saving ? 600 : 400} color={saving ? 'accentText' : 'text'} tabular testID={testID ? `${testID}-amount` : undefined}>
          {saving ? `−${amountParam(-amountIqd)}` : amountParam(amountIqd)}
        </Text>
      </View>
      {reason && open ? (
        <Text variant="footnote" color="textMuted" accessibilityLiveRegion="polite">
          {reason}
        </Text>
      ) : null}
    </View>
  );
}
