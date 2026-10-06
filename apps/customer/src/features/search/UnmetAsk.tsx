import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { foldArabic } from '@driver/contracts';
import { Button, Icon, Text, useTheme } from '@driver/ui';
import { CITY_ID, useDeliverTo } from '@/features/food/queries';
import { useApi } from '@/lib/api';
import { useT } from '@/lib/i18n';

/** Terms already told this session, so the answer stays «وصلت» when the person types it again. */
const told = new Set<string>();

/**
 * Zero results that ask instead of shrugging (joy h4, discovery D-13): «ما عدنا «بيتزا» بعد. نگول
 * للمطاعم إن أكو ناس تريدها؟» → «إي گولولهم» sends the words and the deliver-to zone (`search.unmet`,
 * no name) for the Console's list. Only on the customer's yes; nothing is logged silently.
 */
export function UnmetAsk({ query }: { query: string }) {
  const theme = useTheme();
  const t = useT();
  const api = useApi();
  const { dropoff } = useDeliverTo();
  const key = foldArabic(query);
  const [sent, setSent] = useState(() => told.has(key));
  const send = useMutation(
    api.search.unmet.mutationOptions({
      onSuccess: () => {
        told.add(key);
        setSent(true);
      },
    }),
  );
  const done = sent || told.has(key);
  return (
    <View testID="search-unmet" style={{ alignSelf: 'stretch', gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors.surfaceSunken }}>
      <Text variant="body" align="center">
        {t('search.unmet_ask', { query: query.trim() })}
      </Text>
      {done ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[2], minHeight: 44 }} accessibilityLiveRegion="polite">
          <Icon name="check" size={18} color="successText" />
          <Text variant="label" weight={600} color="successText" testID="search-unmet-sent">
            {t('search.unmet_sent')}
          </Text>
        </View>
      ) : (
        <>
          <Button
            testID="search-unmet-yes"
            variant="secondary"
            label={t('search.unmet_yes')}
            loading={send.isPending}
            onPress={() => send.mutate({ cityId: CITY_ID, term: query.trim().slice(0, 60), zoneKey: dropoff?.zoneKey ?? null })}
            style={{ alignSelf: 'center' }}
          />
          {send.isError ? (
            <Text variant="footnote" color="dangerText" align="center">
              {t('search.unmet_failed')}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}
