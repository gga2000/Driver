import { View } from 'react-native';
import { t, type MessageKey } from '@driver/i18n';
import { DATA_SAVER_PREFS, useDataSaver, type DataSaverPref } from '../network/data-saver';
import { useTheme } from '../theme/ThemeProvider';
import { Card } from './Card';
import { ListRow } from './ListRow';
import { SegmentedControl } from './SegmentedControl';

const LABEL: Record<DataSaverPref, MessageKey> = { auto: 'datasaver.auto', on: 'datasaver.on', off: 'datasaver.off' };

/**
 * "توفير البيانات" (maps program q2): automatic on a slow connection, or always on / off. Drawn as a
 * settings `ListRow` (icon tile, title, and a subtitle that says what it does now) like the rows
 * around it, with the three choices under it. `onChange` stores the choice in the app.
 */
export function DataSaverCard({ onChange, testID = 'data-saver' }: { onChange: (pref: DataSaverPref) => void; testID?: string }) {
  const theme = useTheme();
  const { pref, slow, lite } = useDataSaver();
  const hint: MessageKey = pref === 'auto' ? (slow ? 'datasaver.hint_auto_slow' : 'datasaver.hint_auto') : lite ? 'datasaver.hint_on' : 'datasaver.hint_off';
  return (
    <Card elevation={0} padding={0} testID={testID}>
      <ListRow testID={`${testID}-row`} leading="wifi" title={t('datasaver.title')} subtitle={t(hint)} chevron={false} />
      <View style={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[4] }}>
        <SegmentedControl accessibilityLabel={t('datasaver.title')} value={pref} onChange={onChange} options={DATA_SAVER_PREFS.map((p) => ({ value: p, label: t(LABEL[p]) }))} />
      </View>
    </Card>
  );
}
