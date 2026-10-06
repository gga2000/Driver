import { View } from 'react-native';
import { t, type MessageKey } from '@driver/i18n';
import { DATA_SAVER_PREFS, useDataSaver, type DataSaverPref } from '../network/data-saver';
import { useTheme } from '../theme/ThemeProvider';
import { Card } from './Card';
import { Icon } from '../icons/Icon';
import { SegmentedControl } from './SegmentedControl';
import { Text } from './Text';

const LABEL: Record<DataSaverPref, MessageKey> = { auto: 'datasaver.auto', on: 'datasaver.on', off: 'datasaver.off' };

/**
 * "توفير البيانات" (maps program q2): automatic on a slow connection, or always on / off. The line
 * under it says what it does now. `onChange` stores the choice in the app.
 */
export function DataSaverCard({ onChange, testID = 'data-saver' }: { onChange: (pref: DataSaverPref) => void; testID?: string }) {
  const theme = useTheme();
  const { pref, slow, lite } = useDataSaver();
  const hint: MessageKey = pref === 'auto' ? (slow ? 'datasaver.hint_auto_slow' : 'datasaver.hint_auto') : lite ? 'datasaver.hint_on' : 'datasaver.hint_off';
  return (
    <Card elevation={0} padding={4} testID={testID}>
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="wifi" size={20} color="text" />
          <Text variant="label" weight={700} style={{ flex: 1 }}>
            {t('datasaver.title')}
          </Text>
        </View>
        <SegmentedControl accessibilityLabel={t('datasaver.title')} value={pref} onChange={onChange} options={DATA_SAVER_PREFS.map((p) => ({ value: p, label: t(LABEL[p]) }))} />
        <Text variant="footnote" color={lite ? 'accentText' : 'textMuted'} testID={`${testID}-hint`}>
          {t(hint)}
        </Text>
      </View>
    </Card>
  );
}
